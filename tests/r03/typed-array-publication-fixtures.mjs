// SPDX-License-Identifier: MIT
// Input publication builder from official static declarations, not inferred body effects.
import {createHash} from 'node:crypto';
const hash=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
const jcs=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(jcs).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}';
const signature=(result,parameters)=>hash('tsfg.signature\0('+parameters.join(',')+')->'+result);
export function optionalArrayPublication(facts,rules={}) {
  const types=new Map(facts.payload.types.map(type=>[type.id,type]));
  const view=id=>types.get(id)?.kind==='readSpan'||types.get(id)?.kind==='union'&&types.get(id).members.some(view);
  const actual=value=>{
    if(!value||typeof value!=='object')return false;
    if(['flowType','returnType','declaredType'].some(key=>typeof value[key]==='string'&&view(value[key])))return true;
    return Object.values(value).some(actual);
  };
  return actual(facts.payload.functions)||facts.payload.types.some(type=>actual(type.constructor))?staticPublication(facts,rules):undefined;
}
export function staticPublication(facts,rules={}) {
  const payload=facts.payload,types=new Map(payload.types.map(row=>[row.id,row])),names=new Map();
  const name=id=>{
    if(names.has(id))return names.get(id);const row=types.get(id);
    const value=row.kind==='array'?'Array<'+name(row.elementType)+'>':row.kind==='readSpan'?'ReadSpan<'+name(row.elementType)+'>'
      :row.kind==='union'?'Union<'+row.members.map(name).sort().join(',')+'>'
      :['value','reference'].includes(row.kind)?(row.kind==='value'?'value':'ref')+'<'+row.runtimeKey+'>'
      :row.kind==='scalar'?row.name:row.kind;names.set(id,value);return value;
  };
  const typeId=id=>hash('tsfg.type\0'+name(id));
  const owned=id=>['array','readSpan'].includes(types.get(id).kind)
    ||types.get(id).kind==='union'&&types.get(id).members.some(owned);
  const view=id=>types.get(id).kind==='readSpan'||types.get(id).kind==='union'&&types.get(id).members.some(view);
  const sourceFunctions=[...payload.functions,...payload.types.flatMap(row=>row.constructor?[row.constructor]:[])].map(fn=>{
    const parameters=[...(fn.ownerType?[fn.ownerType]:[]),...fn.parameters.map(p=>p.declaredType)];
    const functionName=fn.ownerType?name(fn.ownerType)+'.'+fn.name:fn.name;
    const signatureHash=signature(name(fn.returnType),parameters.map(name));
    const functionId=hash('tsfg.function\0'+fn.sourcePath+'\0'+functionName+'\0'+signatureHash.slice(7));
    return {fn,parameters,functionId,signatureHash,constructionBody:payload.types.some(row=>row.constructor?.id===fn.id)};
  });
  const implicit=payload.types.filter(type=>type.construction&&!type.constructor).map(type=>{
    const construction=type.construction,functionId=hash('tsfg.construction\0'+typeId(type.id));
    const parameters=[type.id,...construction.parameters.map(row=>row.type)];
    return {fn:{id:functionId,name:'<implicit-construction>',sourcePath:construction.origin.source,returnType:type.id},
      parameters,functionId,signatureHash:signature(name(type.id),[name(type.id),...construction.signature.parameters.map(name)]),constructionBody:true};
  });
  const functions=[...sourceFunctions,...implicit].sort((a,b)=>a.functionId<b.functionId?-1:a.functionId>b.functionId?1:0);
  const ids=new Map(functions.map(row=>[row.fn.id,row.functionId]));
  const scope={profile:'typed-array-owner-relative-fixed-v5',rootFile:payload.rootFile,
    functions:functions.map(({fn,parameters,functionId,signatureHash})=>({functionId,name:fn.name,sourcePath:fn.sourcePath,
      signatureHash,parameterTypes:parameters.map(typeId),returnType:typeId(fn.returnType)})),
    exports:payload.exports.map(row=>({name:row.name,functionId:ids.get(row.functionId)}))};
  const contracts=functions.map(({fn,parameters,functionId,signatureHash,constructionBody})=>{
    const rule=rules[fn.ownerType?types.get(fn.ownerType).name+'.'+fn.name:fn.name]??rules[fn.name]??{};
    const upper={parameters:parameters.flatMap((type,index)=>owned(type)?[{index,read:true,
      write:!view(type)&&!constructionBody,structural:!view(type)&&!constructionBody,...(rule.parameters?.[index]??{})}]:[]),
      local:rule.local??(constructionBody?{read:false,write:false,structural:false}:{read:true,write:true,structural:true}),returnOrigin:Object.hasOwn(rule,'returnOrigin')?rule.returnOrigin
        :view(fn.returnType)&&parameters.some(owned)?{kind:'parameter',index:parameters.findIndex(owned)}:null};
    const body={functionId,signatureHash,upper};return {...body,digest:hash('tsfg.array-published-contract.v5\0'+jcs(body))};
  });
  const scopeDigest=hash('tsfg.array-call-scope.v5\0'+jcs(scope));
  return {family:'tsfg.array-publication-context-candidate',version:5,mode:'fixed',scopeDigest,
    expectedDigest:hash('tsfg.array-publication.v5\0'+jcs({scopeDigest,contracts})),contracts};
}
