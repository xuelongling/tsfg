// SPDX-License-Identifier: MIT
// Complete synthetic Core declarations: these are not Source/HIR producer qualification.
import assert from 'node:assert/strict';
import {hash,jcs,scalarIds,arrayId,viewId,sourceId,allocationId,functionIds,contextFor} from './literal-core.mjs';
const range=(start,end)=>({start,end});
const flags=(read=false,write=false,structural=false)=>({read,write,structural});
export function structural(template,specs,callerName,calls,rootFile='/readspan26d-semantic/oracle-structural.ts') {
  const model=structuredClone(template);
  model.rootFile=rootFile;model.inputIdentity=hash('independent-core-structural:'+jcs({specs,callerName,calls,rootFile}));
  model.facts={requestId:hash('independent-core-facts:'+model.inputIdentity)};
  const content=' '.repeat(specs.length*4000);
  model.sources=model.sources.filter(s=>s.path!==template.rootFile).concat([{path:rootFile,content,hash:hash(content)}])
    .sort((a,b)=>a.path<b.path?-1:1);
  const ids={f64:scalarIds.f64,u32:scalarIds.u32,'array.f64':arrayId,'readspan.f64':viewId};
  model.functions=specs.map((s,i)=>{
    const b=i*4000,nameRange=range(b+9,b+9+s.name.length),result=s.result??'f64';
    const identity=functionIds(rootFile,s.name,s.parameters,result);
    const parameters=s.parameters.map((type,slot)=>{
      const start=b+40+24*slot,reference=['array.f64','readspan.f64'].includes(type);
      const annotationRange=range(start+5,start+(reference?20:8)),nameRange=range(start,start+2);
      return{id:sourceId(rootFile,nameRange),name:'p'+slot,type:ids[type],writable:type!=='readspan.f64',
        nameRange,range:range(start,annotationRange.end),annotationRange,
        ...(reference?{elementAnnotationRange:range(annotationRange.start+(type==='readspan.f64'?5:0),annotationRange.start+(type==='readspan.f64'?8:3))}:{})};
    });
    const returnAnnotationRange=range(b+250,b+(result==='readspan.f64'?268:253));
    const value=s.returnSlot===undefined?{kind:'floating',type:scalarIds.f64,bits:'0x3ff0000000000000',
      range:range(b+3707,b+3708)}:{kind:'reference',type:ids[result],binding:parameters[s.returnSlot].id,range:range(b+3707,b+3709)};
    return{id:identity.id,signatureHash:identity.signature,name:s.name,nameRange,sourcePath:rootFile,
      sourceBinding:sourceId(rootFile,nameRange),range:range(b,b+3900),parameters,returnType:{id:ids[result]},
      returnAnnotationRange,...(result==='readspan.f64'?{returnElementAnnotationRange:range(b+260,b+263)}:{}),
      body:[{kind:'return',range:range(b+3700,b+3711),value}]};
  });
  const caller=model.functions.find(f=>f.name===callerName);assert.ok(caller);
  const callStatements=calls.map((c,i)=>{
    const target=model.functions.find(f=>f.name===c.target);assert.ok(target);
    const start=caller.range.start+300+100*i,calleeRange=range(start,start+target.name.length);
    const args=c.slots.map((slot,k)=>{const p=caller.parameters[slot];assert.equal(p.type,target.parameters[k].type);
      return{kind:'reference',binding:p.id,type:p.type,range:range(calleeRange.end+2+k*5,calleeRange.end+4+k*5)};});
    const end=args.length?args.at(-1).range.end+2:calleeRange.end+2;
    return{kind:'expression',range:range(start,end+1),expression:{kind:'arrayDirectCall',target:target.id,
      sourceCallee:target.sourceBinding,type:target.returnType.id,calleeRange,range:range(start,end),arguments:args}};
  });
  caller.body.unshift(...callStatements);
  model.exports=model.functions.filter(f=>f.returnType.id!==viewId).map(f=>({functionId:f.id,name:f.name})).sort((a,b)=>a.name<b.name?-1:1);
  const uppers=new Map(model.functions.map((f,i)=>{const spec=specs[i];return[f.id,{local:{...flags(),...spec.local},
    parameters:f.parameters.flatMap((p,index)=>[arrayId,viewId].includes(p.type)?[{index,...flags(),...(spec.effects?.[index]??{})}]:[]),
    returnOrigin:spec.result==='readspan.f64'?{kind:'parameter',index:spec.returnSlot}:null}];}));
  return{model,context:contextFor(model,uppers),callerId:caller.id};
}
export function models(template){
  const A='array.f64',F='f64',V='readspan.f64',read={read:true},write={write:true,structural:true};
  const allRead=Object.fromEntries(Array.from({length:8},(_,i)=>[i,read]));
  const zero=structural(template,[{name:'scalar',parameters:[F],returnSlot:0},{name:'caller',parameters:[F],returnSlot:0}],
    'caller',Array.from({length:2},()=>({target:'scalar',slots:[0]})));
  const long4097=longPath(template,4097);
  const n32=structural(template,[{name:'scalar',parameters:[F],returnSlot:0},{name:'caller',parameters:[F],returnSlot:0}],
    'caller',Array.from({length:32},()=>({target:'scalar',slots:[0]})));
  const eight=structural(template,[{name:'read8',parameters:Array(8).fill(A),effects:allRead},
    {name:'caller',parameters:Array(8).fill(A),effects:allRead}], 'caller',Array.from({length:2},()=>({target:'read8',slots:[0,1,2,3,4,5,6,7]})));
  const alias=structural(template,[{name:'writeSlot1',parameters:[F,A],effects:{1:write}},
    {name:'caller',parameters:[F,A,A],effects:{1:write,2:write}}], 'caller',[
      {target:'writeSlot1',slots:[0,1]},{target:'writeSlot1',slots:[0,2]}]);
  const local=structural(template,[{name:'local',parameters:[F],returnSlot:0,local:read},
    {name:'caller',parameters:[F],returnSlot:0,local:read}], 'caller',Array.from({length:2},()=>({target:'local',slots:[0]})));
  const localWrite=structural(template,[{name:'local',parameters:[F],returnSlot:0,local:{write:true}},
    {name:'caller',parameters:[F],returnSlot:0,local:{write:true}}], 'caller',Array.from({length:2},()=>({target:'local',slots:[0]})));
  const localStructural=structural(template,[{name:'local',parameters:[F],returnSlot:0,local:{structural:true}},
    {name:'caller',parameters:[F],returnSlot:0,local:{structural:true}}], 'caller',Array.from({length:2},()=>({target:'local',slots:[0]})));
  const irrelevantLocal=structural(template,[{name:'scalar',parameters:[F],returnSlot:0},
    {name:'unselected',parameters:[F],returnSlot:0,local:read},
    {name:'caller',parameters:[F],returnSlot:0,local:read}], 'caller',Array.from({length:2},()=>({target:'scalar',slots:[0]})));
  // Nonzero original full-slot View return origin; both calls return the same caller slot2 owner.
  const viewOrigin=structural(template,[{name:'viewIdentity',parameters:[F,V],result:V,returnSlot:1,effects:{1:read}},
    {name:'caller',parameters:[F,A,V],effects:{1:{},2:read}}], 'caller',[
      {target:'viewIdentity',slots:[0,2]},{target:'viewIdentity',slots:[0,2]}]);
  function memberBoundary(fail){
    const rs=[...Array(9).fill(8),...Array(4).fill(6),...Array(4).fill(3),...Array(3).fill(5),...Array(4).fill(1)];
    if(fail){rs[13]=2;rs[14]=4;}
    const os=[...rs];if(fail){os[20]++;os[21]++;os[22]++;os[23]+=2;}else{os[20]++;os[21]++;}
    const sizes=[...new Set(rs)].sort((a,b)=>a-b);
    const specs=sizes.map(r=>({name:'read'+r,parameters:Array(8).fill(A),effects:Object.fromEntries(Array.from({length:r},(_,i)=>[i,read]))}));
    specs.push({name:'caller',parameters:Array(8).fill(A),effects:allRead});
    const calls=rs.map((r,i)=>({target:'read'+r,slots:Array.from({length:8},(_,k)=>k<os[i]?k:0)}));
    const made=structural(template,specs,'caller',calls);made.boundary={r:rs,o:os,n:24,expectedMembers:fail?65537:65536};return made;
  }
  return{scalarZeroOwners:zero,sites32:n32,eightOwners64RR:eight,fullSlotParameterAlias:alias,
    selectedLocal:local,selectedLocalWrite:localWrite,selectedLocalStructural:localStructural,
    callerAndUnselectedLocal:irrelevantLocal,nonzeroViewReturnOrigin:viewOrigin,
    outputMembers65536:memberBoundary(false),outputMembers65537:memberBoundary(true),sourcePath4097:long4097};
}
export function longPath(template,length){
  const prefix='/readspan26d-semantic/',suffix='.ts';
  const rootFile=prefix+'p'.repeat(length-prefix.length-suffix.length)+suffix;
  return structural(template,[{name:'scalar',parameters:['f64'],returnSlot:0},{name:'caller',parameters:['f64'],returnSlot:0}],
    'caller',Array.from({length:2},()=>({target:'scalar',slots:[0]})),rootFile);
}
export function mixedFreshOutput(template,controlCharacters,asciiCharacters=0){
  const rootFile='/readspan26d-semantic/p'+'\u0001'.repeat(controlCharacters)+'q'.repeat(asciiCharacters)+'.ts',A='array.f64',read={read:true};
  const specs=[{name:'read8',parameters:Array(8).fill(A),effects:Object.fromEntries(Array.from({length:8},(_,i)=>[i,read]))},
    {name:'read6',parameters:Array(8).fill(A),effects:Object.fromEntries([0,1,4,5,6,7].map(i=>[i,read]))},
    {name:'caller',parameters:Array(4).fill(A),effects:Object.fromEntries(Array.from({length:4},(_,i)=>[i,read])),local:read}];
  const calls=Array.from({length:28},(_,i)=>({target:i===27?'read6':'read8',slots:[0,1,2,3,0,1,2,3]}));
  const data=structural(template,specs,'caller',calls,rootFile),caller=data.model.functions.at(-1),b=caller.range.start;
  const locals=Array.from({length:4},(_,i)=>{
    const s=b+300+i*80,nameRange=range(s+6,s+8),allocationRange=range(s+19,s+38);
    return{kind:'local',range:range(s,s+39),binding:{id:sourceId(rootFile,nameRange),name:'a'+i,nameRange,
      range:range(s+6,s+38),annotationRange:range(s+11,s+16),elementAnnotationRange:range(s+11,s+14),type:arrayId,writable:true},
      initializer:{kind:'arrayCreate',type:arrayId,range:allocationRange,allocationSite:allocationId(rootFile,allocationRange),
        elements:[{kind:'floating',type:scalarIds.f64,bits:'0x3ff0000000000000',range:range(s+20,s+21)}]}};
  });
  function shift(v){if(v===null||typeof v!=='object')return;
    if(Object.keys(v).length===2&&typeof v.start==='number'&&typeof v.end==='number'){v.start+=400;v.end+=400;return;}
    for(const x of Object.values(v))shift(x);}
  for(const statement of caller.body.slice(0,-1)){shift(statement);
    statement.expression.arguments.slice(4).forEach((a,i)=>{a.binding=locals[i].binding.id;});}
  caller.body.unshift(...locals);
  data.model.inputIdentity=hash('independent-mixed-fresh-output:'+jcs({rootFile,callCount:28,selected:'27read8+1read6'}));
  data.model.facts.requestId=hash('independent-core-facts:'+data.model.inputIdentity);
  data.context=contextFor(data.model,new Map(data.context.contracts.map(c=>[c.functionId,c.upper])));
  return data;
}
export function longConflict(template,controlCharacters){
  const rootFile='/readspan26d-semantic/p'+'\u0001'.repeat(controlCharacters)+'.ts',F='f64',A='array.f64',write={write:true,structural:true};
  return structural(template,[{name:'writeSlot1',parameters:[F,A],effects:{1:write}},
    {name:'caller',parameters:[F,A,A],effects:{1:write,2:write}}], 'caller',[
      {target:'writeSlot1',slots:[0,1]},{target:'writeSlot1',slots:[0,2]}],rootFile);
}
