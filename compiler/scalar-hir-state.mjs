// SPDX-License-Identifier: MIT
import { scalarOperations as operations, scalarComparisons as comparisons, scalarPrecedence as precedence } from "./scalar-operators.mjs";
// Ordinary local flow is independently source-bound; module-qualified globals
// keep their own source guards while numeric operation rules remain shared.
import { identifierName } from './module-facts.mjs';
import { localReferenceTarget, expressionLeaf } from './scalar-source.mjs';
import { scalarTypeIds } from './identity.mjs';

const types=scalarTypeIds;
const exactKeys=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function checkedExpressionPresence(value) {
  if (value.kind === "group") return checkedExpressionPresence(value.operand);
  if (value.kind === "absence") return value.absence === "undefined" ? 2 : 4;
  if (value.kind === "reference" || value.kind === "write" && ["&&=","||="].includes(value.operator))
    return (value.presenceFlow?.undefined ? 2 : 0) | (value.presenceFlow?.null ? 4 : 0);
  if (value.kind === "write" && ["=","??="].includes(value.operator)) return checkedExpressionPresence(value.right);
  return 0;
}
function expressionPrecedence(value) {
  if (value.kind === "write") return -2;
  if (["binary", "shortCircuit", "presenceTest"].includes(value.kind)) return precedence[value.operator];
  if (value.kind === "unary") return 9;
  // Explicit groups and the remaining checked atomic/update forms bind tighter.
  return Infinity;
}
const sourceTokens = (source, start, end) => source.slice(start, end)
  .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, "").replace(/\s/g, "");
function identifierToken(source, anchor) {
  // This owned token guard preserves internal spelling. Only surrounding
  // trivia is removed; a split token cannot manufacture a checked identifier.
  try { return identifierName(source.slice(anchor.start, anchor.end)); }
  catch { return undefined; }
}
function bindingFact(binding, parent, source) {
  return exactKeys(binding, ["id", "name", "type", "writable", "range", ...(binding?.presence ? ["presence"] : [])])
    && validText(binding.name) && Object.values(types).includes(binding.type)
    && typeof binding.writable === "boolean" && range(binding.range, parent)
    && identifierToken(source, binding.range) === binding.name;
}
function scalarOperator(source, start, end, operator) {
  const spelling = source.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, comment => " ".repeat(comment.length));
  if (spelling.trim() !== operator) return false;
  const position = start + spelling.search(/\S/);
  // TS scans adjacent ++/-- as one token. Trivia may separate scalar signs;
  // persisted HIR must not reinterpret an unsupported update expression.
  return !["+", "-"].includes(operator)
    || (source[position - 1] !== operator && source[position + 1] !== operator);
}
const declaredStates = shape => 1 | (shape?.undefined ? 2 : 0) | (shape?.null ? 4 : 0);
const cloneLocals = locals => new Map([...locals].map(([id, local]) => [id, { ...local }]));
function expressionStates(value, locals) {
  if (value.kind === "reference") return locals.get(value.binding)?.states ?? 1;
  if (value.kind === "absence") return value.absence === "undefined" ? 2 : 4;
  if (value.kind === "group") return expressionStates(value.operand, locals);
  if (value.kind === "write" && value.operator === "=") return expressionStates(value.right, locals);
  if (value.kind === "write" && ["??=","&&=","||="].includes(value.operator)) return locals.get(localReferenceTarget(value.left)?.binding)?.states ?? 1;
  return 1;
}
function narrowLocals(locals, value, truth) {
  if (value.kind === "group") return narrowLocals(locals, value.operand, truth);
  if (value.kind === "unary" && value.operator === "!") return narrowLocals(locals, value.operand, !truth);
  if (value.kind === "shortCircuit" && (value.operator === "&&" && truth || value.operator === "||" && !truth)) {
    narrowLocals(locals, value.left, truth); narrowLocals(locals, value.right, truth); return;
  }
  if (value.kind !== "presenceTest") return;
  const left=expressionLeaf(value.left),right=expressionLeaf(value.right);
  const reference = left.kind === "reference" ? left : right;
  const absence = left.kind === "absence" ? left : right;
  const local = locals.get(reference.binding), bit = absence.absence === "undefined" ? 2 : 4;
  local.states &= truth === (value.operator === "===") ? bit : ~bit;
}
function loopCarriedStates(statement, locals, fail) {
  // Compute may-states from owned expression effects, independently of the
  // producer's flow claims. The ordinary verifier still authenticates every
  // claim, source anchor and payload read after this finite back-edge pass.
  let remaining = 4096, work = 4096 * (1 + locals.size * 3);
  // Share a finite work bound across nested solvers; resetting one pass's
  // node counter must not permit exponential nested-loop traversal.
  const tick = () => { if (--remaining < 0 || --work < 0) fail(); };
  const merge = (target, alternatives) => {
    for (const [id, local] of target) local.states = alternatives.reduce((states, branch) => states | branch.get(id).states, 0);
  };
  const expression = (value, state) => {
    tick();
    if (!value) fail();
    if (value.kind === "reference") {
      if (!state.has(value.binding)) fail();
      return state.get(value.binding).states;
    }
    if (value.kind === "absence") return value.absence === "undefined" ? 2 : 4;
    if (value.kind === "group") return expression(value.operand, state);
    if (value.kind === "update") {
      const local = state.get(localReferenceTarget(value.operand)?.binding);
      if (!local) fail();
      local.states = 1; return 1;
    }
    if (value.kind === "write") {
      const id = localReferenceTarget(value.left)?.binding, local = state.get(id);
      if (!local) fail();
      const previous = local.states;
      const conditional = ["??=", "&&=", "||="].includes(value.operator);
      const right = conditional ? cloneLocals(state) : state;
      if (value.operator === "??=") right.get(id).states &= 6;
      if (value.operator === "&&=") right.get(id).states &= 1;
      const result = expression(value.right, right);
      if (conditional) merge(state, [state, right]);
      local.states = value.operator === "??=" ? (previous & 1) | (previous & 6 ? result : 0)
        : value.operator === "&&=" ? previous | (previous & 1 ? result : 0)
        : value.operator === "||=" ? (previous & 1) | result
        : value.operator === "=" ? result : 1;
      return local.states;
    }
    if (value.kind === "shortCircuit") {
      expression(value.left, state);
      const selected = cloneLocals(state), skipped = cloneLocals(state);
      narrowLocals(selected, value.left, value.operator === "&&");
      narrowLocals(skipped, value.left, value.operator !== "&&");
      expression(value.right, selected); merge(state, [selected, skipped]); return 1;
    }
    if (["binary", "presenceTest"].includes(value.kind)) { expression(value.left, state); expression(value.right, state); }
    else if (["unary", "conversion"].includes(value.kind)) expression(value.operand, state);
    else if (value.kind === "call") { for (const argument of value.arguments) expression(argument, state); }
    else if (!["constant", "floating", "boolean"].includes(value.kind)) fail();
    return 1;
  };
  const body = (statements, state, depth) => {
    if (depth > 128 || !Array.isArray(statements)) fail();
    for (const item of statements) {
      tick();
      if (item.kind === "local") {
        const states = item.initializer ? expression(item.initializer, state) : 2;
        state.set(item.binding.id, { ...item.binding, states });
      } else if (item.kind === "assign") {
        const states = expression(item.value, state), local = state.get(item.target.binding);
        if (!local) fail();
        local.states = states;
      } else if (item.kind === "evaluate") expression(item.value, state);
      else if (item.kind === "return") { expression(item.value, state); return true; }
      else if (item.kind === "block") {
        const scoped = cloneLocals(state), returned = body(item.body, scoped, depth + 1);
        merge(state, [scoped]); if (returned) return true;
      } else if (item.kind === "if") {
        expression(item.condition, state);
        const left = cloneLocals(state), right = cloneLocals(state);
        narrowLocals(left, item.condition, true); narrowLocals(right, item.condition, false);
        const leftReturn = body(item.thenBody, left, depth + 1), rightReturn = body(item.elseBody, right, depth + 1);
        merge(state, leftReturn ? [right] : rightReturn ? [left] : [left, right]);
        if (leftReturn && rightReturn) return true;
      } else if (item.kind === "while") loop(item, state, depth + 1);
      else fail();
    }
    return false;
  };
  const loop = (item, state, depth) => {
    const initial = cloneLocals(state), head = cloneLocals(state);
    // Each successful iteration adds at least one of three state bits to a
    // finite binding set. No runtime block/register/argument limit changes.
    for (let iteration = 0; iteration <= state.size * 3; iteration++) {
      const savedBudget = remaining; remaining = 4096;
      const back = cloneLocals(head);
      expression(item.condition, back); narrowLocals(back, item.condition, true);
      const returned = body(item.body, back, depth);
      remaining = savedBudget;
      let changed = false;
      for (const [id, local] of head) {
        const states = local.states | initial.get(id).states | (returned ? 0 : back.get(id).states);
        changed ||= states !== local.states; local.states = states;
      }
      if (!changed) {
        merge(state, [head]); expression(item.condition, state); narrowLocals(state, item.condition, false);
        return head;
      }
    }
    fail();
  };
  // The normal verifier consumes the loop condition itself; install the
  // fixed head rather than the abstract exit's narrowed state here.
  const head = loop(statement, cloneLocals(locals), 0);
  merge(locals, [head]);
}
const validText = value => typeof value === "string" && value.length > 0 && !value.includes("\0")
  && Buffer.byteLength(value) <= 4096 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
function range(value, parent) {
  return exactKeys(value, ["start", "end"]) && Number.isSafeInteger(value.start)
    && Number.isSafeInteger(value.end) && value.start >= parent.start
    && value.end <= parent.end && value.start < value.end;
}

function noShortIf(statement) {
  // A verified braced block closes the dangling-else boundary. An unbraced
  // while or either tail of a matched if retains any unmatched inner if.
  if (statement.kind === "while") return noShortIf(statement.body[0]);
  if (statement.kind === "if") return statement.elseBody.length === 1
    && noShortIf(statement.thenBody[0]) && noShortIf(statement.elseBody[0]);
  return ["block", "return", "assign", "evaluate"].includes(statement.kind);
}

export { checkedExpressionPresence, operations, comparisons, precedence, expressionPrecedence, sourceTokens, identifierToken, bindingFact, scalarOperator, declaredStates, cloneLocals, expressionStates, narrowLocals, loopCarriedStates, validText, range, noShortIf };
