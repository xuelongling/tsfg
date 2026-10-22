// SPDX-License-Identifier: MIT
// Only statically definite density violations are rejected. Unknown accesses retain checks.
import {check} from './typed-array-schema.mjs';
import {hasConditionalArrayRhs} from './array-analysis-types.mjs';

export function validateTypedArrayDensity(payload) {
  for(const fn of [...payload.functions,...payload.types.flatMap(row=>row.constructor?[row.constructor]:[])]) {
    let bindings=new Map(),lengths=new Map();
    const forget=()=>{for(const id of lengths.keys())lengths.set(id,null);};
    const literal=value=>value?.kind==='numericLiteral'&&value.type==='u32'?Number(value.decimal):null;
    function expression(value) {
      if(!value)return null;
      if(value.kind==='bindingReference')return bindings.get(value.binding)??null;
      if(['parentheses','nonNull','as'].includes(value.kind))return expression(value.expression);
      if(value.kind==='arrayLiteral') {
        for(const child of value.elements)expression(child);
        lengths.set(value.allocationSite,value.elements.length);return value.allocationSite;
      }
      if(value.kind==='bindingAssignment') {
        const owner=expression(value.value);bindings.set(value.target.binding,owner);return owner;
      }
      if(hasConditionalArrayRhs(value)) {
        expression(value.left);const before=new Map(bindings);expression(value.right);
        for(const [id,owner]of before)if(bindings.get(id)!==owner)bindings.set(id,null);
        forget();return null;
      }
      if(['elementAssignment','lengthAssignment','elementCompoundAssignment','elementUpdate'].includes(value.kind)) {
        const owner=expression(value.target.receiver);expression(value.target.index);expression(value.value);
        const old=lengths.get(owner)??null,resize=value.kind==='lengthAssignment';
        const next=literal(resize?value.value:value.target.index);
        const primary={sourceId:fn.sourcePath,...value.range};
        if(owner&&old!==null&&next!==null)check(next<=old,
          resize?'dense-growth':'dense-gap',primary);
        if(!owner)forget();
        else lengths.set(owner,next===null?null:resize?next:old===null?null:Math.max(old,next+1));
        return null;
      }
      if(value.target)expression(value.target);
      for(const key of ['receiver','index','expression','left','right','value'])expression(value[key]);
      for(const child of value.arguments??[])expression(child);
      // A complete ordinary call may mutate aliased storage. It never creates
      // a static noalias/length proof; the ReadSpan intrinsic is readonly.
      if(value.kind==='call'&&value.callee!==payload.readSpanIntrinsic.id)forget();
      if(['fieldAssignment','fieldUpdate','new','superConstruct'].includes(value.kind))forget();
      return null;
    }
    function body(rows) {
      for(const row of rows) {
        if(['constDeclaration','letDeclaration'].includes(row.kind))bindings.set(row.binding,expression(row.initializer));
        else {
          expression(row.condition);expression(row.value);
          if(row.then||row.else) {
            const priorBindings=new Map(bindings),priorLengths=new Map(lengths);
            body(row.then??[]);const yesBindings=bindings,yesLengths=lengths;
            bindings=new Map(priorBindings);lengths=new Map(priorLengths);body(row.else??[]);
            for(const [id,owner]of priorBindings)bindings.set(id,yesBindings.get(id)===bindings.get(id)?bindings.get(id):null);
            for(const id of new Set([...yesLengths.keys(),...lengths.keys()]))
              lengths.set(id,yesLengths.get(id)===lengths.get(id)?lengths.get(id):null);
          }
          if(row.body) {
            forget();const before=new Map(bindings);body(row.body);
            for(const [id,owner]of before)if(bindings.get(id)!==owner)bindings.set(id,null);forget();
          }
        }
      }
    }
    body(fn.body);
  }
}
