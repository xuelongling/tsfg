// SPDX-License-Identifier: MIT
import { array, record, check, same, text } from './reference-common.mjs';
import { verifyReferenceNumericLiteral, referenceValueType } from './reference-types.mjs';
import { referenceMembers, verifyReferenceWitness } from './reference-relations.mjs';
const expressionKeys = ['argumentCompatibility','arguments','compatibility','dispatch','id','kind','left','operator',
  'numericLiteral','origin','permission','receiver','resolvedSignature','right','staticTarget','symbol','token','type'];
const empty = { argumentCompatibility: [], arguments: [], compatibility: null, dispatch: '', left: null,
  numericLiteral: null, operator: '', permission: null, receiver: null, resolvedSignature: null, right: null, staticTarget: '', symbol: '', token: '' };
export function verifyReferenceBodies(state) {
  const { graph, types, symbols, classes, fields, origin } = state;
  const expressions = new Set();
  let activeConstructor = null, superCalls = [];
  const witness = (value, sourceType, targetType, anchor) => verifyReferenceWitness(state, value, sourceType, targetType, anchor);
  function ordered(values) {
    for (let index = 1; index < values.length; index++) {
      const previous = values[index - 1].origin, current = values[index].origin;
      check(previous.source === current.source && previous.end <= current.start, 'origin',
        'owned evaluation anchors overlap or reverse source order', current);
    }
  }
  function expression(value, parent, owner, parameters, write = false, contextType = '') {
    record(value, expressionKeys); origin(value.origin, parent); text(value.id);
    check(/^e[1-9][0-9]*$/.test(value.id) && !expressions.has(value.id) && types.has(value.type), 'closure');
    expressions.add(value.id); state.typeUses.add(value.type);
    const allowed = new Set();
    const permit = (...keys) => keys.forEach(key => allowed.add(key));
    switch (value.kind) {
    case 'number':
      permit('token','numericLiteral'); verifyReferenceNumericLiteral(state, value, contextType); break;
    case 'boolean':
      permit('token'); check(types.get(value.type).kind === 'boolean' && ['true','false'].includes(value.token), 'expression'); break;
    case 'this':
      permit('symbol'); check(value.symbol === owner.symbol && [owner.thisType, owner.instanceType].includes(value.type), 'closure'); break;
    case 'reference': {
      permit('symbol'); const symbol = symbols.get(value.symbol), type = types.get(value.type);
      if (symbol?.kind === 'class') {
        const declaration = classes.get(type?.declaration);
        check(type?.kind === 'class-constructor' && declaration?.symbol === value.symbol && symbol.type === value.type, 'closure');
      } else {
        const parameter = parameters.get(value.symbol);
        check(parameter && parameter.type === value.type && ['parameter','implicit-parameter'].includes(symbol?.kind), 'closure');
      }
      break;
    }
    case 'super': {
      permit('symbol'); const base = classes.get(owner.base), type = types.get(value.type);
      check(base && value.symbol === base.symbol && (value.type === base.constructorType
        || type?.kind === 'class-this-view' && type.declaration === base.id && type.thisArgument === owner.thisType), 'inheritance');
      break;
    }
    case 'field': {
      permit('symbol','permission','receiver'); const field = fields.get(value.symbol);
      check(field && field.type === value.type && value.receiver, 'closure');
      expression(value.receiver, value.origin, owner, parameters);
      check(referenceMembers(state, value.receiver.type).has(value.symbol), 'closure');
      record(value.permission, ['readable','readonly','writable','writeUse']);
      check(Object.values(value.permission).every(flag => typeof flag === 'boolean') && value.permission.readable
        && value.permission.readonly === field.readonly && value.permission.writeUse === write
        && (!write || value.permission.writable), 'permission'); break;
    }
    case 'method-call': {
      permit('symbol','permission','receiver','dispatch','staticTarget','arguments','argumentCompatibility','resolvedSignature');
      const method = state.methods.get(value.staticTarget);
      check(method && method.symbol === value.symbol && ['virtual','direct-base-method'].includes(value.dispatch) && value.receiver, 'call');
      expression(value.receiver, value.origin, owner, parameters);
      check(referenceMembers(state, value.receiver.type).has(method.symbol)
        && (value.dispatch === 'direct-base-method') === (value.receiver.kind === 'super'), 'call');
      record(value.permission, ['readable','readonly','writable','writeUse']);
      check(Object.values(value.permission).every(flag => typeof flag === 'boolean')
        && value.permission.readable && !value.permission.writeUse, 'permission');
      callArguments(value, method.signature, owner, parameters);
      check(value.type === value.resolvedSignature.return, 'call');
      break;
    }
    case 'construct': {
      permit('receiver','dispatch','staticTarget','arguments','argumentCompatibility','resolvedSignature');
      const result = types.get(value.type), declaration = classes.get(result?.declaration);
      check(result?.kind === 'class-instance' && declaration && value.dispatch === 'direct-constructor'
        && value.staticTarget === declaration.constructor.id && value.receiver?.kind === 'reference', 'call');
      expression(value.receiver, value.origin, owner, parameters);
      check(value.receiver.symbol === declaration.symbol && value.receiver.type === declaration.constructorType, 'call');
      callArguments(value, declaration.constructor.signature, owner, parameters);
      check(value.resolvedSignature.return === value.type, 'call');
      break;
    }
    case 'super-construct': {
      permit('receiver','dispatch','staticTarget','arguments','argumentCompatibility','resolvedSignature');
      const base = classes.get(owner.base);
      check(activeConstructor === owner && base && types.get(value.type).kind === 'void' && value.dispatch === 'direct-base-constructor'
        && value.staticTarget === base.constructor.id && value.receiver?.kind === 'super', 'initialization');
      expression(value.receiver, value.origin, owner, parameters);
      check(value.receiver.type === base.constructorType, 'call');
      callArguments(value, base.constructor.signature, owner, parameters); superCalls.push(value.id);
      break;
    }
    case 'assignment':
      permit('operator','left','right','compatibility');
      check(value.operator === '=' && value.left?.kind === 'field' && value.right, 'expression');
      expression(value.left, value.origin, owner, parameters, true);
      expression(value.right, value.origin, owner, parameters, false, value.left.type);
      ordered([value.left, value.right]);
      check(value.type === value.right.type, 'expression');
      witness(value.compatibility, value.right.type, value.left.type, value.right.origin); break;
    case 'reference-identity':
      permit('operator','left','right');
      check(types.get(value.type).kind === 'boolean' && ['===','!=='].includes(value.operator) && value.left && value.right, 'expression');
      expression(value.left, value.origin, owner, parameters); expression(value.right, value.origin, owner, parameters);
      ordered([value.left, value.right]);
      // Official checking already accepted comparability. These category checks
      // preserve reference operands without recomputing TS relations or folding
      // object equality from class provenance, names, layouts or static type IDs.
      check([value.left, value.right].every(operand => referenceValueType(types.get(operand.type))), 'expression');
      break;
    case 'binary':
      permit('operator','left','right'); check(value.operator === '+' && value.left && value.right, 'expression');
      expression(value.left, value.origin, owner, parameters); expression(value.right, value.origin, owner, parameters);
      ordered([value.left, value.right]);
      check([value.type,value.left.type,value.right.type].every(id => types.get(id).kind === 'number'), 'expression'); break;
    default: check(false, 'unsupported', 'unsupported owned expression: ' + value.kind, value.origin);
    }
    check(!write || value.kind === 'field', 'permission');
    for (const [key, expected] of Object.entries(empty)) if (!allowed.has(key)) check(same(value[key], expected), 'expression');
  }
  function callArguments(value, signature, owner, parameters) {
    record(value.resolvedSignature, ['parameters','return']);
    // Unsupported official signature substitution is explicit. No type relation
    // is recomputed here; ordinary override/member variance is not ID equality.
    check(same(value.resolvedSignature, signature), 'unsupported', 'specialized call signature is not consumed yet', value.origin);
    array(value.arguments); array(value.argumentCompatibility);
    check(value.arguments.length === signature.parameters.length && value.argumentCompatibility.length === value.arguments.length, 'call');
    for (const [index, argument] of value.arguments.entries()) {
      expression(argument, value.origin, owner, parameters, false, signature.parameters[index].type);
      witness(value.argumentCompatibility[index], argument.type, signature.parameters[index].type, argument.origin);
    }
    ordered([value.receiver, ...value.arguments]);
  }
  function body(statements, parent, owner, parameters, result, constructor = false) {
    let returned = false; activeConstructor = constructor ? owner : null; superCalls = [];
    for (const statement of array(statements)) {
      record(statement, ['compatibility','expression','kind','origin']); origin(statement.origin, parent);
      check(!returned && ['expression','return'].includes(statement.kind), 'body');
      if (statement.expression !== null) expression(statement.expression, statement.origin, owner, parameters, false,
        statement.kind === 'return' ? result : '');
      if (statement.kind === 'return') {
        check(!constructor, 'unsupported', 'constructor return forms are not consumed yet', statement.origin);
        if (statement.expression === null) check(types.get(result).kind === 'void' && statement.compatibility === null, 'witness');
        else witness(statement.compatibility, statement.expression.type, result, statement.expression.origin);
        returned = true;
      } else check(statement.expression !== null && statement.compatibility === null, 'body');
    }
    ordered(statements);
    check(constructor || types.get(result).kind === 'void' || returned, 'body');
    if (constructor) check(owner.constructor.kind === 'implicit-derived' ? superCalls.length === 0
      : owner.base ? superCalls.length === 1 && superCalls[0] === owner.constructor.superCall
      : superCalls.length === 0, 'initialization');
    activeConstructor = null;
  }
  for (const owner of classes.values()) {
    for (const field of owner.fields) {
      if (field.initializer === null) check(field.initializerCompatibility === null, 'witness');
      else {
        expression(field.initializer, field.origin, owner, new Map(), false, field.type);
        witness(field.initializerCompatibility, field.initializer.type, field.type, field.initializer.origin);
      }
    }
    body(owner.constructor.body, owner.constructor.origin, owner, owner.constructorParameters, owner.instanceType, true);
    for (const method of owner.methods) {
      const stateMethod = state.methods.get(method.id);
      body(method.body, method.origin, owner, stateMethod.parameters, method.signature.return);
    }
  }
  for (let index = 1; index <= expressions.size; index++) check(expressions.has('e' + index), 'closure');
}
