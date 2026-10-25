// SPDX-License-Identifier: MIT
// Fixed upper consumption and ordinary control completions share one owned
// Program. Language throws are routed structurally; request traps never enter EH.
import {commonCheck as check,commonSame as same} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
export const commonFacets=Object.freeze(['allocation','managedReference','ehControl','mayThrow','await','lock','escape','unknownHost']);
export function commonEffects(hir,spend,physical=null) {
  const collections=commonCollections(spend);
  spend(hir.types.length+hir.functions.length+hir.globals.length);
  const types=new Map(hir.types.map(row=>[row.id,row])),functions=new Map(hir.functions.map(row=>[row.id,row]));
  const globals=new Map(hir.globals.map(row=>[row.id,row])),referenceMemo=new Map();
  function reference(id,active=new Set()) {
    if(id===null||id==='void')return false;
    spend();if(referenceMemo.has(id))return referenceMemo.get(id);check(!active.has(id),'type');active.add(id);
    const t=types.get(id);check(t,'type');const result=['unknown','reference','array','readSpan','string'].includes(t.kind)
      ||t.kind==='union'&&t.members.some(id=>reference(id,collections.set(active)))
      ||t.kind==='value'&&t.fields.some(field=>reference(field.type,collections.set(active)));
    referenceMemo.set(id,result);return result;
  }
  const ownerParameters=fn=>{spend(fn.parameters.length+1);return [...(fn.ownerType?[{id:fn.receiverBinding,type:fn.ownerType}]:[]),...fn.parameters];};
  const blank=fn=>({globals:{reads:[],writes:[]},parameters:ownerParameters(fn).map((_,index)=>({index,read:false,write:false,structural:false})),
    facets:Object.fromEntries(commonFacets.map(flag=>[flag,false]))});
  function derive(fn,records) {
    const result=blank(fn),read=new Set(),write=new Set(),params=ownerParameters(fn),origins=new Map(),calls=[];
    result.facets.managedReference=physical?.references.get(fn.id)??false;result.facets.escape=physical?.escaping.get(fn.id)??false;
    params.forEach((p,index)=>{spend();origins.set(p.id,reference(p.type)?new Set(['p:'+index]):new Set());});
    if(reference(fn.returnType)||params.some(p=>reference(p.type)))result.facets.managedReference=true;
    const mergeFacets=facets=>{for(const key of commonFacets)if(key!=='mayThrow')result.facets[key] ||= facets[key];};
    const mark=(set,flag)=>{for(const origin of set){spend();if(origin.startsWith('g:'))(flag==='read'?read:write).add(origin.slice(2));
      if(origin.startsWith('p:'))result.parameters[Number(origin.slice(2))][flag]=true;}};
    const union=sets=>{const result=new Set();for(const values of sets)for(const value of values){spend();result.add(value);}return result;};
    const mergeOrigins=(a,b)=>{for(const [id,values]of b){spend();a.set(id,union([a.get(id)??new Set(),values]));}};
    function expression(value,environment=origins) {
      spend();let throwing=false,owner=new Set();
      const visit=child=>{const result=expression(child,environment);throwing ||= result.throwing;return result.owner;};
      const touch=()=>{if(reference(value.type))result.facets.managedReference=true;};touch();
      if(['bindingReference','bindingTarget','thisReference'].includes(value.kind))owner=environment.get(value.kind==='thisReference'?fn.receiverBinding:value.binding)??new Set();
      else if(['globalReference','globalTarget'].includes(value.kind)){
        check(globals.has(value.global),'identity');owner=new Set(['g:'+value.global]);if(value.kind==='globalReference')read.add(value.global);
      }else if(['parentheses','as','nonNull'].includes(value.kind))owner=visit(value.expression);
      else if(value.kind==='arrayLiteral'){
        value.elements.forEach(visit);result.facets.allocation=true;result.facets.managedReference=true;owner=new Set(['local:'+value.allocationSite]);
      }else if(['fieldAccess','fieldTarget','checkedElementAccess','elementTarget','arrayLength','readSpanLength','lengthTarget'].includes(value.kind)){
        owner=visit(value.receiver);if(value.index)visit(value.index);
        if(['fieldAccess','checkedElementAccess','arrayLength','readSpanLength'].includes(value.kind))mark(owner,'read');
      }else if(['bindingAssignment','elementAssignment','elementCompoundAssignment','lengthAssignment','fieldAssignment','bindingUpdate','elementUpdate','fieldUpdate'].includes(value.kind)) {
        const selected=visit(value.target);if(value.operator!=='=')mark(selected,'read');
        const assigned=value.value?visit(value.value):new Set();mark(selected,'write');
        if(value.kind==='lengthAssignment'||value.kind.startsWith('element'))mark(selected,'structural');
        if(value.target.binding&&!value.target.global&&value.operator==='=')environment.set(value.target.binding,assigned);owner=assigned;
      }else if(value.kind==='new'||value.kind==='superConstruct') {
        const arguments_=value.arguments.map(visit),type=types.get(value.kind==='new'?value.type:value.callee);check(type,'type');
        if(type.kind==='reference'){result.facets.allocation=true;result.facets.managedReference=true;}
        owner=new Set(['local:'+(value.allocationSite??value.construction)]);
        for(const field of type.fields??[])if(field.initializer)visit(field.initializer);
        if(type.construction.functionId){const called=consume(type.construction.functionId,[owner,...arguments_],value);throwing ||= called.facets.mayThrow;}
      }else if(value.kind==='call') {
        const arguments_=[...(value.receiver?[visit(value.receiver)]:[]),...value.arguments.map(visit)];
        if(value.callee==='intrinsic:readSpan')owner=arguments_[0];
        else {const record=consume(value.callee,arguments_,value);throwing ||= record.facets.mayThrow;
          if(reference(value.type))owner=new Set(['unknown:'+value.callee]);}
      }else {
        for(const key of ['expression','left','right','receiver','index','value'])if(value[key])visit(value[key]);
        if(value.kind==='stringConcat'){result.facets.allocation=true;result.facets.managedReference=true;}
      }
      return {owner,throwing};
    }
    function consume(id,args,value) {
      spend();const callee=functions.get(id),upper=records.get(id);check(callee&&upper,'publication','missing complete function contract');
      calls.push({functionId:fn.id,target:id,range:value.range});mergeFacets(upper.facets);
      upper.globals.reads.forEach(id=>{spend();read.add(id);});upper.globals.writes.forEach(id=>{spend();write.add(id);});
      for(const p of upper.parameters)for(const flag of ['read','write','structural'])if(p[flag])mark(args[p.index]??new Set(),flag);
      return upper;
    }
    function body(rows,environment=origins) {
      let completions=new Set(['normal']);
      for(const row of rows) {
        spend();if(!completions.has('normal'))break;completions.delete('normal');let current=new Set(['normal']);
        const inspect=value=>expression(value,environment),possibleThrow=result=>{if(result.throwing)current.add('throw');return result.owner;};
        if(['constDeclaration','letDeclaration','initialize'].includes(row.kind)) {
          const assigned=possibleThrow(inspect(row.initializer));environment.set(row.binding,assigned);if(row.global)write.add(row.global);
        }else if(row.kind==='expression')possibleThrow(inspect(row.value));
        else if(row.kind==='return') {
          if(row.value){const assigned=possibleThrow(inspect(row.value));if(reference(fn.returnType))result.facets.escape=true;if(types.get(fn.returnType)?.kind==='readSpan')
            check(!collections.array(assigned).some(owner=>owner.startsWith('local:')||owner.startsWith('unknown:')),'readspan-return-escape',undefined,{primary:{sourceId:fn.sourcePath,...row.range}});}
          current.delete('normal');current.add('return');
        }else if(row.kind==='throw') {
          possibleThrow(inspect(row.value));result.facets.ehControl=true;current=new Set(['throw']);
        }else if(row.kind==='block')current=body(row.body,collections.map(environment));
        else if(row.kind==='if') {
          const condition=inspect(row.condition);const yes=collections.map(environment),no=collections.map(environment);
          current=union([body(row.then,yes),body(row.else,no)]);mergeOrigins(environment,yes);mergeOrigins(environment,no);if(condition.throwing)current.add('throw');
        }else if(row.kind==='while') {
          const condition=inspect(row.condition),loop=collections.map(environment),loopCompletions=body(row.body,loop);mergeOrigins(environment,loop);
          current=union([new Set(['normal']),new Set([...loopCompletions].filter(c=>c!=='normal'))]);if(condition.throwing)current.add('throw');
        }else if(row.kind==='try') {
          result.facets.ehControl=true;const attempted=collections.map(environment);current=body(row.tryBlock.body,attempted);mergeOrigins(environment,attempted);
          if(row.catchClause&&current.delete('throw')) {
            const caught=collections.map(environment);if(row.catchClause.binding)caught.set(row.catchClause.binding.id,new Set(['unknown:catch']));
            current=union([current,body(row.catchClause.block.body,caught)]);mergeOrigins(environment,caught);
          }
          if(row.finallyBlock) {
            const final=collections.map(environment),completed=body(row.finallyBlock.body,final);mergeOrigins(environment,final);
            current=union([completed.has('normal')?current:new Set(),new Set([...completed].filter(c=>c!=='normal'))]);
          }
        }
        completions=union([completions,current]);
      }
      return completions;
    }
    const completions=body(fn.body);result.facets.mayThrow=completions.has('throw');
    result.globals={reads:collections.sorted(read),writes:collections.sorted(write)};return {upper:result,calls,completions:collections.sorted(completions)};
  }
  function derived() {
    const rows=new Map(hir.functions.map(fn=>[fn.id,blank(fn)]));let changed=true;
    while(changed){changed=false;for(const fn of hir.functions){spend();const next=derive(fn,rows).upper;
      if(!same(rows.get(fn.id),next)){rows.set(fn.id,next);changed=true;}}}return rows;
  }
  return {reference,ownerParameters,blank,derive,derived,types,functions,globals};
}
