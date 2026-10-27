// SPDX-License-Identifier: MIT
import {sourceRange} from './typed-array-schema.mjs';
import {canonical} from './identity.mjs';

/** Project only inert syntax around an already owned expression.
 * @param {import('./system-query-facts.mjs').SystemQueryLoopExpression} value
 * @returns {string|null}
 */
export function queryViewBinding(value){
  while(value.kind==='parentheses')value=value.expression;
  return value.kind==='bindingReference'?value.binding:null;
}

// One Source-owned expression boundary shared by tuple bodies and helpers.
// Scope entries carry the original binding, component and permission; a type
// identity alone never grants a writable view.
export function queryExpressionDecoder({ast,grammar,bodyRange,scope,component,fields,call,spend,fail}){
  /** @param {import('./system-query-facts.mjs').CheckedArrayExpression} value @param {'read'|'write'|'readwrite'} [access] @returns {import('./system-query-facts.mjs').SystemQueryLoopExpression} */
  function expression(value,access='read',depth=0){
    spend();if(depth>=32)fail('Query expression path exceeds32','capability');
    sourceRange(value.range,grammar.text,bodyRange);
    const target=value.kind==='fieldTarget';
    if(!component.types.has(value.type)||!target&&value.flowType!==value.type)fail('original Query expression logical type differs','type');
    const type=component.semantic.typeIds.get(value.type),base={type,sourceType:value.type,range:{...value.range}};
    const originalKind=value.kind==='bindingReference'?'KindIdentifier':value.kind==='fieldAccess'||target?'KindPropertyAccessExpression':value.kind==='call'?'KindCallExpression':value.kind==='parentheses'?'KindParenthesizedExpression':'KindBinaryExpression';
    if(!ast.nodes.some(node=>node.sourcePath===grammar.source.path&&node.kind===originalKind&&canonical(node.range)===canonical(value.range)))fail('original Query expression AST differs','source');
    if(value.kind==='bindingReference'){
      const binding=scope.get(value.binding);
      if(!binding||binding.sourceType!==value.type||!binding.mode&&value.type!=='f32')fail('original Query expression binding differs','source');
      grammar.name(value.range,binding.declaration.name);return {...base,kind:'bindingReference',binding:value.binding,access:'read'};
    }
    if(value.kind==='call')return call(value,scope,value=>expression(value,'read',depth+1));
    if(value.kind==='parentheses'){
      const inner=expression(value.expression,'read',depth+1);
      if(inner.sourceType!==value.type)fail('grouping logical type differs','type');
      grammar.sequence(value.range,['(',value.expression.range,')']);return {...base,kind:'parentheses',expression:inner};
    }
    if(value.kind==='fieldAccess'||target){
      if(value.receiver.kind!=='bindingReference')fail('direct original Query field receiver required','capability');
      const receiver=expression(value.receiver,'read',depth+1),binding=scope.get(receiver.binding),field=fields.get(value.property);
      let owner=binding?.sourceType;
      while(owner){
        spend();const type=component.types.get(owner),selected=type.fields?.find(row=>row.name===field?.name);
        if(selected){if(selected.id!==value.property)fail('original first selected field declaration differs','source');break;}
        owner=type.base;
      }
      if(!binding?.mode||!field||!owner||value.type!=='f32'||field.sourceType!==value.type||field.access!=='public')fail('original component field ownership/type/access differs','type');
      if(target&&(access==='read'||binding.mode!=='write'||field.readonly))fail('Read borrow or declared readonly field cannot be written','permission');
      grammar.name(value.nameRange,field.name);grammar.sequence(value.range,[value.receiver.range,'.',value.nameRange]);
      return {...base,kind:target?'fieldTarget':'fieldAccess',receiver,property:field.fieldId,sourceField:field.sourceField,nameRange:{...value.nameRange},access:target?access:'read'};
    }
    if(value.kind==='binary'){
      if(!['+','-','*','/'].includes(value.operator)||value.type!=='f32')fail('owned f32 binary operator required','capability');
      const left=expression(value.left,'read',depth+1),right=expression(value.right,'read',depth+1);
      if(left.sourceType!=='f32'||right.sourceType!=='f32')fail('original f32 operand types differ','type');
      grammar.sequence(value.operatorRange,[value.operator]);grammar.sequence(value.range,[value.left.range,value.operatorRange,value.right.range]);
      return {...base,kind:'binary',operator:value.operator,operatorRange:{...value.operatorRange},left,right};
    }
    if(value.kind==='fieldAssignment'){
      if(!['=','+='].includes(value.operator)||value.type!=='f32'||value.target.kind!=='fieldTarget')fail('owned f32 field assignment required','capability');
      const target=expression(value.target,value.operator==='='?'write':'readwrite',depth+1),assigned=expression(value.value,'read',depth+1);
      if(target.sourceType!=='f32'||assigned.sourceType!=='f32')fail('original f32 assignment types differ','type');
      grammar.sequence(value.operatorRange,[value.operator]);grammar.sequence(value.range,[value.target.range,value.operatorRange,value.value.range]);
      return {...base,kind:'fieldAssignment',operator:value.operator,operatorRange:{...value.operatorRange},target,value:assigned};
    }
    fail('Query expression has no owned typed representation','capability');
  }
  return expression;
}
