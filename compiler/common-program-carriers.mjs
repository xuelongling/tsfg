// SPDX-License-Identifier: MIT
// Conditional storage capacities have one physical layout. Actual flow remains
// in the separate graph solver; widening storage never creates a Source value.
import {canonical,sha256,scalarName} from './identity.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
export function selectCommonCarriers({model,plans},values) {
  const {types,spend,payload}=model,collections=commonCollections(spend),domains=new Map(),layouts=new Map(),active=new Set(),a=values.abstract;
  const align=(n,boundary)=>Math.ceil(n/boundary)*boundary;
  const bindingValues=new Map(),results=new Map(),registers=new Map(),bindings=new Map(),functions=new Map(),methods=new Map();
  const merge=(into,from)=>{if(from)a.merge(into,from);};
  for(const id of model.bindings.keys())bindingValues.set(id,a.empty());
  for(const [id,v]of values.fieldSeeds)merge(bindingValues.get(id),v);
  for(const [id,v]of values.globalSeeds)merge(bindingValues.get(id),v);
  for(const [id,v]of values.elementSeeds)bindingValues.set(id,a.copy(v));
  for(const [key,v]of values.capacity.observed)if(key.startsWith('binding/'))merge(bindingValues.get(key.slice(8)),v);
  for(const plan of plans)results.set(plan.owner.id,a.empty());
  for(const context of values.capacity.contexts.values())merge(results.get(context.plan.owner.id),context.returned);
  function domain(value) {
    spend();if(value?.unknown)return payload;check((value?.tags.size??0)<=256,'limit');const alternatives=collections.sorted(value?.tags??[]);
    if(alternatives.length===1&&!['undefined','null','void'].includes(types.get(alternatives[0])?.kind))return alternatives[0];
    const id=sha256('tsfg.actual-domain.v1\0'+canonical(alternatives));
    if(!domains.has(id)){check(domains.size<4096,'limit');domains.set(id,{id,actualTypes:alternatives});}return id;
  }
  for(const [id,v]of bindingValues)bindings.set(id,domain(v));
  const bound=(fn,name)=>values.capacity.observed.get(fn+'/'+name);
  for(const plan of plans) {
    const fn=plan.owner.id,rows=new Map();registers.set(fn,rows);
    const parameters=plan.parameters.map(p=>bindings.get(p.id));
    functions.set(fn,{id:fn,parameters,result:plan.returnType==='void'||types.get(plan.returnType)?.kind==='void'?'void':domain(results.get(fn))});
    for(const [name,row]of plan.graph.registers){spend();const op=row.operation?.name;
      const carrier=row.view.startsWith('cell:')?row.view:row.view===payload?payload
        :['tsfg_program.constant','tsfg_program.floating','tsfg_program.boolean','tsfg_program.construct_value','tsfg_program.allocate_reference','tsfg_program.array_create','tsfg_program.readspan'].includes(op)?row.view
          :domain(bound(fn,name));rows.set(name,carrier);}
  }
  const joined=ids=>{
    const value=a.empty();for(const id of ids){spend();check(id!=='void','ssa');if(id===payload)value.unknown=true;
      else if(domains.has(id))for(const tag of domains.get(id).actualTypes){spend();value.tags.add(tag);}else{check(types.has(id),'type');value.tags.add(id);}}
    return domain(value);
  };
  for(const plan of plans)for(const block of plan.graph.blocks)for(const op of block.instructions)if(op.name==='tsfg_program.invoke_method'){
    const targets=[];for(const row of op.properties.dispatch){spend();const abi=functions.get(row.target);check(abi,'ssa');targets.push(abi);}
    spend(op.operands.length);const parameters=op.operands.map((_,i)=>{spend(2*targets.length);const choices=targets.filter(target=>target.parameters.length>i).map(target=>target.parameters[i]);
      return choices.length?joined(choices):registers.get(plan.owner.id).get(op.operands[i]);});
    spend(plan.graph.blocks.length+targets.length);const normal=plan.graph.blocks.find(block=>block.name===op.successors[0]);
    methods.set(op,{parameters,result:normal.parameters.length?joined(targets.map(target=>target.result)):'void'});
  }
  function layout(id) {
    spend();if(layouts.has(id))return layouts.get(id);check(!active.has(id),'type','cyclic physical inline layout');active.add(id);
    let bytes=0,alignment=1,roots=0;const t=types.get(id),d=domains.get(id);
    if(id===payload||t?.kind==='unknown'){bytes=16;alignment=8;roots=1;}
    else if(t?.kind==='scalar'){const width={bool:1,i8:1,u8:1,i16:2,u16:2,i32:4,u32:4,f32:4,i64:8,u64:8,isize:8,usize:8,f64:8}[scalarName(id)];check(width,'type');bytes=alignment=width;}
    else if(['reference','array','string'].includes(t?.kind)){bytes=alignment=8;roots=1;}
    else if(t?.kind==='readSpan'){bytes=16;alignment=8;roots=1;}
    else if(t?.kind==='value') {
      for(const field of a.fields(id)){spend();const child=layout(bindings.get(field.sourceBinding));bytes=align(bytes,child.alignment)+child.byteSize;alignment=Math.max(alignment,child.alignment);roots+=child.referenceCount;}
      bytes=align(bytes,alignment);
    }else if(d) {
      for(const member of d.actualTypes){const child=layout(member);bytes=Math.max(bytes,child.byteSize);alignment=Math.max(alignment,child.alignment);roots=Math.max(roots,child.referenceCount);}
      const reference=d.actualTypes.length>0&&d.actualTypes.every(member=>['reference','array','string'].includes(types.get(member)?.kind));
      const tagged=d.actualTypes.length>1&&!reference;d.representation=!d.actualTypes.length?'bottom':reference?'reference':d.actualTypes.length===1?'absence':'finite-union';
      d.tagBytes=tagged?2:0;if(tagged){bytes=align(align(2,alignment)+bytes,Math.max(2,alignment));alignment=Math.max(2,alignment);}
      Object.assign(d,{alignment,byteSize:bytes,referenceCount:roots});
    }else check(id==='void'||['undefined','null','void'].includes(t?.kind),'type','unowned physical carrier');
    check(bytes<=65536&&roots<=256,'limit');active.delete(id);const result={byteSize:bytes,alignment,referenceCount:roots};layouts.set(id,result);return result;
  }
  // Layout can discover field domains, so selections above precede all layout.
  for(const id of domains.keys())layout(id);for(const type of types.values())if(type.kind!=='union')layout(type.id);
  // A reference's public carrier is an eight-byte handle. Its separately
  // allocated body still obeys the complete inherited field storage limits.
  const bodies=new Map();
  for(const type of types.values())if(type.kind==='reference'){
    let byteSize=0,alignment=1,referenceCount=0;
    for(const field of a.fields(type.id)){spend();const child=layout(bindings.get(field.sourceBinding));
      byteSize=align(byteSize,child.alignment)+child.byteSize;alignment=Math.max(alignment,child.alignment);referenceCount+=child.referenceCount;
      check(byteSize<=65536&&referenceCount<=256,'limit','reference body storage bound');}
    byteSize=align(byteSize,alignment);check(byteSize<=65536,'limit','reference body storage bound');bodies.set(type.id,{byteSize,alignment,referenceCount});
  }
  const coreType=id=>{
    if(id==='void')return '()';if(id.startsWith('cell:'))return '!tsfg_program.cell<'+JSON.stringify(id.slice(5))+'>';
    const name=scalarName(id);if(name)return name==='bool'?'i1':['i32','f32','f64'].includes(name)?name:'!tsfg_core.integer<'+JSON.stringify(name)+'>';
    check(id===payload||types.has(id)||domains.has(id),'type');return '!tsfg_program.carrier<'+JSON.stringify(id)+'>';
  };
  const entries=rows=>collections.sorted(rows,([a],[b])=>a<b?-1:a>b?1:0);
  const record=()=>{spend(domains.size+bindings.size+functions.size);return {domains:entries(domains).map(([,row])=>row),
    bindings:entries(bindings).map(([id,carrier])=>({id,carrier})),functions:entries(functions).map(([,row])=>row)};};
  return {domains,bindings,functions,methods,registers,bindingValues,layouts,bodies,layout,coreType,record,arrayType:a.arrayType,select:domain};
}
