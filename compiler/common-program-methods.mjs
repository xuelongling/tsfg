// SPDX-License-Identifier: MIT
// A finite method table describes eligible implementations, never receiver
// values. Only actual-flow/entry authority can introduce an actual nominal tag.
import {selectReferenceMethod} from './reference-methods.mjs';
import {commonCheck as check,commonFailure,commonSame as same,commonRecord as record} from './common-program-common.mjs';
export function commonMethods(hir,spend) {
  spend(2*hir.types.length+2*hir.functions.length);
  const types=new Map(hir.types.map(t=>[t.id,t])),functions=new Map(hir.functions.map(f=>[f.id,f])),
    sourceTypes=new Map(hir.types.map(t=>[t.sourceType,t.id])),sourceFunctions=new Map(hir.functions.map(f=>[f.sourceBinding,f.id])),mappings=new Map(),cache=new Map();
  const owned=new Set();spend(types.size);
  for(const type of types.values()){
    const names=new Set();for(const id of type.methods??[]){spend();const fn=functions.get(id);
      check(fn?.kind==='method'&&fn.ownerType===type.id&&!owned.has(id)&&!names.has(fn.name),'method','method owner or directory differs');owned.add(id);names.add(fn.name);
      const seen=new Set();let base=types.get(type.base),inherited;
      while(base&&!inherited){spend();check(!seen.has(base.id),'method','inheritance cycle');seen.add(base.id);
        for(const member of base.methods??[]){spend();const candidate=functions.get(member);check(candidate,'method');if(candidate.name===fn.name){inherited=candidate;break;}}base=types.get(base.base);}
      check((fn.overrideTarget??null)===(inherited?.id??null),'method','override target differs from the effective inherited member');
    }
  }
  for(const fn of functions.values()){spend();if(fn.kind==='method')check(owned.has(fn.id),'method','method missing from owner directory');}
  for(const row of hir.snapshot.payload.compatibilityWitnesses){
    spend();const proof=row.compatibility,source=sourceTypes.get(proof.sourceType),view=sourceTypes.get(proof.targetType);check(source&&view,'method');
    for(const pair of proof.members){
      spend();const from=sourceFunctions.get(pair.source),to=sourceFunctions.get(pair.target);if(!from&&!to)continue;
      check(from&&to&&functions.get(from).kind==='method'&&functions.get(to).kind==='method','method');
      const key=source+'\0'+view+'\0'+to;check(!mappings.has(key)||mappings.get(key)===from,'method','conflicting verified member mappings');mappings.set(key,from);
    }
  }
  const relation=(actual,view,member)=>{
    let type=types.get(actual),mapped,nominal=false;const seen=new Set();
    while(type){spend();check(!seen.has(type.id),'method','inheritance cycle');seen.add(type.id);
      nominal ||= type.id===view;mapped ??= mappings.get(type.id+'\0'+view+'\0'+member);type=types.get(type.base);}
    return {mapped,nominal};
  };
  const selected=(actual,view,member)=>{
    const {mapped,nominal}=relation(actual,view,member);return nominal||mapped?selectReferenceMethod(types,functions,actual,member,mapped,spend,
      message=>commonFailure('method',message)):undefined;
  };
  const dispatch=(member,view)=>{
    spend();const key=view+'\0'+member;if(cache.has(key))return cache.get(key);
    const callee=functions.get(member);check(callee?.kind==='method'&&['reference','value'].includes(types.get(view)?.kind),'method');const rows=[];
    spend(types.size);
    for(const type of types.values())if(['reference','value'].includes(type.kind)){
      spend();const target=selected(type.id,view,member);if(!target)continue;
      check(target.parameters.length<=callee.parameters.length,'capability','actual method requires more arguments than the static call');
      check(callee.returnType==='void'||types.get(callee.returnType)?.kind==='void'||!(target.returnType==='void'||types.get(target.returnType)?.kind==='void'),'method');
      check(rows.length<256,'limit','method dispatch alternatives');rows.push({receiver_type:type.id,target:target.id,signature_hash:target.signatureHash});
    }
    check(rows.length>0,'method','method has no eligible implementation');spend(rows.length);rows.sort((a,b)=>{spend();return a.receiver_type<b.receiver_type?-1:a.receiver_type>b.receiver_type?1:0;});
    cache.set(key,rows);return rows;
  };
  return {dispatch,verify(properties,view){
    record(properties,['function_id','signature_hash','dispatch']);
    const callee=functions.get(properties.function_id);check(callee?.kind==='method'&&properties.signature_hash===callee.signatureHash,'method');
    check(Array.isArray(properties.dispatch)&&properties.dispatch.length<=256,'method');spend(properties.dispatch.length);
    for(const row of properties.dispatch){record(row,['receiver_type','target','signature_hash']);
      for(const key of ['receiver_type','target','signature_hash']){check(typeof row[key]==='string'&&row[key].length<=128,'method');spend(row[key].length);}}
    check(same(properties.dispatch,dispatch(callee.id,view)),'method','method dispatch table differs from complete owned directory');return properties.dispatch;
  }};
}
