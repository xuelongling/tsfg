// SPDX-License-Identifier: MIT
// Independent SPIR-V word/SSA oracle for genuine scalar i32 operations.
// Opcode/layout grammar is separate from the compiler and its serializer.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const only=(rows,label)=>{assert.equal(rows.length,1,label);return rows[0];};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>'sha256:'+createHash('sha256').update(canonical(value)+'\n').digest('hex');
const integerOperations=new Map(Object.entries({
  '2:+':{opcode:128,kind:'i32-add',operation:'spirv.IAdd',bitwise:false},
  '2:-':{opcode:130,kind:'i32-sub',operation:'spirv.ISub',bitwise:false},
  '2:*':{opcode:132,kind:'i32-mul',operation:'spirv.IMul',bitwise:false},
  '1:-':{opcode:126,kind:'i32-negate',operation:'spirv.SNegate',bitwise:false},
  '2:|':{opcode:197,kind:'i32-or',operation:'spirv.BitwiseOr',bitwise:true},
  '2:^':{opcode:198,kind:'i32-xor',operation:'spirv.BitwiseXor',bitwise:true},
  '2:&':{opcode:199,kind:'i32-and',operation:'spirv.BitwiseAnd',bitwise:true},
  '1:~':{opcode:200,kind:'i32-not',operation:'spirv.Not',bitwise:true},
}));
function integerOperation(operator,arity){
  assert.ok(arity===1||arity===2);
  const expected=integerOperations.get(arity+':'+operator);assert.ok(expected,'supported i32 operator and arity');return expected;
}
function literalString(args,start){
  const bytes=[];
  for(let index=start;index<args.length;index++)for(let shift=0;shift<32;shift+=8){
    const byte=(args[index]>>>shift)&255;
    if(byte===0){for(let padding=shift+8;padding<32;padding+=8)assert.equal((args[index]>>>padding)&255,0);
      return {text:new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes)),next:index+1};}
    bytes.push(byte);
  }
  assert.fail('unterminated SPIR-V literal string');
}

export function verifyGpuI32Words(words,entryName,operator,arity=2){
  const arithmeticOpcode=integerOperation(operator,arity).opcode;
  assert.ok(Array.isArray(words)&&words.length>=5);words.forEach(word=>assert.ok(Number.isInteger(word)&&word>=0&&word<=0xffffffff));
  assert.equal(words[0],0x07230203);assert.equal(words[1],0x00010300);assert.ok(words[3]>1);assert.equal(words[4],0);
  const rows=[],permitted=new Set([5,14,15,16,17,19,21,30,32,33,43,54,56,59,61,62,65,71,72,arithmeticOpcode,248,253]);
  for(let start=5;start<words.length;){const count=words[start]>>>16,opcode=words[start]&0xffff;
    assert.ok(count>0&&start+count<=words.length);assert.ok(permitted.has(opcode),'permitted SPIR-V 1.3 instruction');
    rows.push({start,opcode,args:words.slice(start+1,start+count),functionId:null});start+=count;}
  const of=opcode=>rows.filter(row=>row.opcode===opcode),id=value=>assert.ok(Number.isInteger(value)&&value>0&&value<words[3]);
  assert.deepEqual(of(17).map(row=>row.args),[[1]],'Shader only');assert.deepEqual(only(of(14),'memory model').args,[0,1]);
  const entry=only(of(15),'GLCompute entry');assert.equal(entry.args[0],5);id(entry.args[1]);
  const entryLiteral=literalString(entry.args,2);assert.equal(entryLiteral.text,entryName);assert.equal(entryLiteral.next,entry.args.length);
  const mode=only(of(16),'LocalSize');assert.deepEqual(mode.args,[entry.args[1],17,1,1,1]);
  const resultPosition=new Map([[19,0],[21,0],[30,0],[32,0],[33,0],[43,1],[54,1],[59,1],[61,1],[65,1],[arithmeticOpcode,1],[248,0]]),definitions=new Map();
  let currentFunction=null;
  for(const row of rows){if(row.opcode===54){assert.equal(currentFunction,null);currentFunction=row.args[1];}row.functionId=currentFunction;
    if(resultPosition.has(row.opcode)){const result=row.args[resultPosition.get(row.opcode)];id(result);assert.ok(!definitions.has(result));definitions.set(result,row);}
    if(row.opcode===56){assert.notEqual(currentFunction,null);currentFunction=null;}}
  assert.equal(currentFunction,null);
  const definition=(value,opcode)=>{id(value);const row=definitions.get(value);assert.ok(row,'defined binary ID');if(opcode!==undefined)assert.equal(row.opcode,opcode);return row;};
  const signedI32=value=>assert.deepEqual(definition(value,21).args.slice(1),[32,1]);
  const fn=only(of(54),'one function');assert.equal(fn.args.length,4);assert.equal(fn.args[1],entry.args[1]);assert.equal(fn.args[2],0);
  assert.deepEqual(definition(fn.args[0],19).args,[fn.args[0]]);assert.deepEqual(definition(fn.args[3],33).args.slice(1),[fn.args[0]]);
  assert.equal(of(56).length,1);assert.equal(only(of(248),'one linear label').functionId,fn.args[1]);
  const names=new Map();for(const row of of(5)){definition(row.args[0]);const name=literalString(row.args,1);assert.equal(name.next,row.args.length);names.set(row.args[0],name.text);}
  assert.equal(names.get(fn.args[1]),entryName);
  const decorations=of(71),offsets=of(72),decoration=(target,kind)=>decorations.filter(row=>row.args[0]===target&&row.args[1]===kind);
  decorations.forEach(row=>{definition(row.args[0]);assert.ok([2,24,25,33,34].includes(row.args[1]));assert.equal(row.args.length,[33,34].includes(row.args[1])?3:2);});
  offsets.forEach(row=>{definition(row.args[0],30);assert.deepEqual(row.args.slice(1),[0,35,0]);});
  const globals=of(59).filter(row=>row.functionId===null),slots=new Map();assert.equal(globals.length,2);
  for(const variable of globals){assert.equal(variable.args.length,3);assert.equal(variable.args[2],12);
    const pointer=definition(variable.args[0],32);assert.equal(pointer.args.length,3);assert.equal(pointer.args[1],12);
    const structure=definition(pointer.args[2],30);assert.equal(structure.args.length,2);signedI32(structure.args[1]);
    assert.equal(decoration(structure.args[0],2).length,1);assert.equal(offsets.filter(row=>row.args[0]===structure.args[0]).length,1);
    assert.deepEqual(only(decoration(variable.args[1],34),'descriptor set').args.slice(2),[0]);
    const slot=only(decoration(variable.args[1],33),'binding').args[2];assert.ok((slot===0||slot===1)&&!slots.has(slot));slots.set(slot,variable);
    assert.equal(decoration(variable.args[1],24).length,slot===0?1:0);assert.equal(decoration(variable.args[1],25).length,slot===1?1:0);}
  assert.deepEqual([...slots.keys()].sort(),[0,1]);
  const body=rows.filter(row=>row.functionId===fn.args[1]),local=only(body.filter(row=>row.opcode===59),'one Function cell');
  assert.equal(local.args.length,3);assert.equal(local.args[2],7);const localType=definition(local.args[0],32);assert.equal(localType.args[1],7);signedI32(localType.args[2]);
  function pointerRoot(value){const row=definition(value);
    if(row.opcode===59){const slot=[...slots].find(([,variable])=>variable.args[1]===value);if(slot)return {kind:'descriptor',binding:slot[0]};assert.equal(value,local.args[1]);return {kind:'local',value};}
    assert.equal(row.opcode,65);assert.equal(row.args.length,4);const parent=pointerRoot(row.args[2]);assert.equal(parent.kind,'descriptor');
    const zero=definition(row.args[3],43);assert.equal(zero.args.length,3);assert.equal(zero.args[2],0);signedI32(zero.args[0]);
    const pointer=definition(row.args[0],32);assert.equal(pointer.args[1],12);signedI32(pointer.args[2]);return parent;}
  const loads=of(61),stores=of(62);assert.equal(loads.length,2);assert.equal(stores.length,2);
  loads.forEach(row=>{assert.equal(row.functionId,fn.args[1]);assert.equal(row.args.length,3);signedI32(row.args[0]);
    assert.equal(definition(definition(row.args[2]).args[0],32).args[2],row.args[0]);});
  stores.forEach(row=>{assert.equal(row.functionId,fn.args[1]);assert.equal(row.args.length,2);const value=definition(row.args[1]);signedI32(value.args[0]);
    assert.equal(definition(definition(row.args[0]).args[0],32).args[2],value.args[0]);});
  const at=(list,slot)=>list.filter(row=>{const pointer=pointerRoot(row.args[row.opcode===61?2:0]);return pointer.kind==='descriptor'&&pointer.binding===slot;});
  const parameterLoad=only(at(loads,0),'parameter read'),localLoad=only(loads.filter(row=>pointerRoot(row.args[2]).kind==='local'),'parameter reload');
  const localStore=only(stores.filter(row=>pointerRoot(row.args[0]).kind==='local'),'parameter initialization');
  assert.equal(localStore.args[1],parameterLoad.args[1]);assert.equal(localStore.args[0],localLoad.args[2]);assert.equal(at(loads,1).length,0);assert.equal(at(stores,0).length,0);
  const arithmetic=only(of(arithmeticOpcode),'Source integer arithmetic');assert.equal(arithmetic.functionId,fn.args[1]);assert.equal(arithmetic.args.length,arity+2);signedI32(arithmetic.args[0]);
  assert.equal(arithmetic.args[2],localLoad.args[1]);const seven=arity===2?definition(arithmetic.args[3],43):null;
  if(seven){assert.deepEqual(seven.args.slice(2),[7]);signedI32(seven.args[0]);assert.equal(seven.args[0],arithmetic.args[0]);}
  const write=only(at(stores,1),'unique return store');assert.equal(write.args[1],arithmetic.args[1]);
  const ret=only(of(253),'void physical return');assert.equal(ret.functionId,fn.args[1]);assert.deepEqual(ret.args,[]);
  const ordered=[parameterLoad,localStore,localLoad,arithmetic,write,ret];assert.ok(ordered.every((row,index)=>index===0||row.start>ordered[index-1].start));
  assert.ok(of(56)[0].start>ret.start);
  return {seven,arithmetic,write,parameterLoad,mode,offsets,wordCount:words.length};
}

export function verifyGpuI32Report(report,oracle,plan,operator){
  assert.equal(report.family,'tsfg.gpu-i32-arithmetic-reader-test-report');assert.equal(report.version,1);
  assert.equal(report.operator,operator);assert.equal(report.ownedAfterInputRelease,true);
  assert.equal(report.readerApiPositiveCount,1);assert.equal(report.readerApiRejectionCount,4);
  assert.equal(report.readerApiRejections.length,4);assert.equal(new Set(report.readerApiRejections.map(row=>row.name)).size,4);
  report.readerApiRejections.forEach(row=>{assert.equal(row.code,'core-ir-common-gpu-artifact-content');assert.equal(row.selfConsistentArtifactDigest,true);assert.equal(row.ownedOutputUnchanged,true);});
  assert.deepEqual(report.execution,{source:false,vm:false,numerical:false,hostPreflight:false,device:false});
  const ast=only(oracle.functions.filter(row=>row.name==='constantKernel'),'official arithmetic Source function');
  assert.equal(ast.operator,operator);const unary=ast.literal===null,arity=unary?1:2;
  assert.equal(report.arity,arity);const expected=integerOperation(operator,arity);
  if(!unary)assert.equal(ast.literalToken,'7');
  const source=range=>({sourceId:'/src/main.ts',...range});
  assert.deepEqual(report.officialLiteral,unary?null:source(ast.literal));
  const baseline=report.sourceBaseline,ops=baseline.operations,one=name=>only(ops.filter(row=>row.name===name),'one Source '+name);
  const fn=plan.kernels[0].functionId;assert.equal(baseline.functionId,fn);assert.deepEqual(baseline.source,source(ast.range));
  const entry=one('fuel'),cell=one('cell'),initial=one('store'),load=one('load'),constant=unary?null:one('constant'),arithmetic=one(unary?'unary':'binary'),returned=one('func.return');
  assert.equal(ops.filter(row=>row.name===(unary?'binary':'unary')).length,0);if(unary)assert.equal(ops.filter(row=>row.name==='constant').length,0);
  const numeric=ops.filter(row=>row.name==='numeric_use');assert.equal(numeric.length,arity);
  const ranges={fuel:ast.range,cell:ast.parameterRange,store:ast.parameterRange,load:ast.parameterUse,constant:ast.literal,numeric_use:ast.expression,binary:ast.expression,unary:ast.expression,value_copy:ast.return,'func.return':ast.return};
  ops.forEach(row=>{assert.ok(Object.hasOwn(ranges,row.name));assert.deepEqual(row.source,source(ranges[row.name]));});
  assert.equal(entry.properties.event,1);assert.equal(cell.properties.binding,ast.parameterId);
  assert.deepEqual(initial.operands,[cell.result,0]);assert.equal(initial.properties.initialize,true);
  assert.deepEqual(load.operands,[cell.result]);if(constant){assert.equal(constant.properties.decimal,'7');assert.equal(constant.properties.token,'7');}
  const operands=constant?[load.result,constant.result]:[load.result];
  numeric.forEach((row,index)=>{assert.equal(row.properties.operator,operator);assert.equal(row.properties.index,index);assert.deepEqual(row.operands,[operands[index]]);assert.equal(row.successors.length,1);
    assert.equal(row.successors[0],index+1<numeric.length?numeric[index+1].point.block:arithmetic.point.block);});
  assert.equal(arithmetic.properties.operator,operator);
  const copies=new Map(ops.filter(row=>row.name==='value_copy').map(row=>[row.result,row]));
  let result=returned.operands[0];const seen=new Set();
  while(copies.has(result)){assert.ok(!seen.has(result));seen.add(result);result=only(copies.get(result).operands,'one return-copy operand');}
  assert.equal(result,arithmetic.result);assert.equal(seen.size,copies.size);
  const out=report.emittedModule,typed=report.typedPending;
  assert.equal(out.family,'tsfg.gpu-binding-module');assert.equal(out.version,1);assert.equal(out.scope,'host-preflight-required');
  assert.equal(out.launchAuthorized,false);assert.equal(out.hostPreflightFulfilled,false);assert.equal(out.deviceExecution,false);
  assert.equal(out.inputIdentity,plan.inputIdentity);assert.equal(out.planDigest,digest(plan));assert.deepEqual(out.bindings,plan.bindings);assert.deepEqual(out.layout,plan.layout);
  assert.equal(out.profile.name,'single-source-call-v1');assert.deepEqual(out.profile.dispatch,[1,1,1]);assert.deepEqual(out.profile.localSize,[1,1,1]);
  assert.equal(out.profile.activeSourceInstances,1);assert.equal(out.profile.targetApi,'vulkan');assert.equal(out.profile.targetApiVersion,'1.1');assert.equal(out.profile.spirvVersion,'1.3');
  assert.deepEqual(out.sourceOperations.map(row=>({name:row.name,point:row.point,source:row.source,functionId:row.functionId})),ops.map(row=>({name:row.name,point:row.point,source:row.source,functionId:fn})));
  assert.equal(out.obligations.length,arity+2);const fuel=out.obligations[0],numericObligations=out.obligations.slice(1,arity+1),relation=out.obligations[arity+1],left=numericObligations[0];
  assert.deepEqual(out.obligations.map(row=>row.kind),['fuel',...numeric.map(()=>'numeric-use'),expected.kind]);
  assert.deepEqual(out.obligations.map(row=>row.status),['unfulfilled',...numeric.map((_,index)=>index===0?'unfulfilled':'proven-i32'),'unfulfilled']);
  [entry,...numeric,arithmetic].forEach((row,index)=>{assert.equal(out.obligations[index].id,index);assert.equal(out.obligations[index].functionId,fn);assert.deepEqual(out.obligations[index].source,row.source);assert.deepEqual(out.obligations[index].point,row.point);});
  numericObligations.forEach((row,index)=>{assert.equal(row.operator,operator);assert.equal(row.index,index);assert.equal(row.operand,numeric[index].operands[0]);assert.equal(row.condition,'actual-initialized-i32');});
  assert.equal(fuel.event,1);assert.equal(relation.operator,operator);
  assert.equal(relation.condition,expected.bitwise?'gpu-i32-bitwise-relation':'gpu-i32-numeric-relation');
  assert.equal(relation.semantics,expected.bitwise?'source-i32-bitwise-32':'source-i32-modulo-2^32');assert.deepEqual(relation.dependsOn,[left.id]);
  const site=(row,id)=>({obligationId:id,functionId:fn,point:row.point,source:row.source});
  assert.deepEqual(out.discharges,[{...site(arithmetic,relation.id),basis:expected.bitwise?'R03 integer bitwise operations':'R01 section 4.2',
    operation:expected.operation,relation:expected.bitwise?'32-bit-pattern-exact':'low-32-bits-exact',requires:[left.id],status:'discharged'}]);
  const host=out.hostPreflight;assert.equal(host.status,'unfulfilled');assert.equal(host.steps.length,arity+1);
  assert.deepEqual(host.steps.map(row=>row.status),Array.from({length:arity+1},()=>'unfulfilled'));assert.deepEqual(host.steps[0].checkOrder,['depth','fuel']);
  assert.equal(host.steps[0].activeDepth,1);assert.equal(host.steps[0].fuelCost,1);assert.deepEqual(host.steps[0].source,entry.source);
  host.steps.slice(1).forEach((row,index)=>{assert.equal(row.operator,operator);assert.equal(row.index,index);assert.deepEqual(row.source,numeric[index].source);assert.equal(row.requiresInitialized,true);assert.equal(row.requiresActualTag,'i32');assert.equal(row.undefinedOutcome,'request-trap-at-this-operation');});
  assert.deepEqual(host.steps[1].origin,{kind:'binding',binding:plan.bindings[0]});if(!unary)assert.deepEqual(host.steps[2].origin,{kind:'constant-i32',decimal:'7'});
  assert.equal(out.wordsDigest,digest(out.words));const {artifactDigest,...withoutDigest}=out;assert.equal(artifactDigest,digest(withoutDigest));
  assert.equal(typed.profile,'single-source-call-v1');assert.equal(typed.launchAuthorized,false);assert.equal(typed.hostPreflightFulfilled,false);assert.equal(typed.functionId,fn);assert.equal(typed.entryPoint,out.entryPoint);
  assert.deepEqual(typed.words,out.words);assert.deepEqual(typed.descriptors,plan.bindings);
  assert.deepEqual(typed.discharges,[{site:site(arithmetic,relation.id),prerequisites:[left.id]}]);
  assert.deepEqual(typed.hostSteps,[{kind:'entry-budget',site:site(entry,0),event:1,activeDepth:1,fuelCost:1},...numeric.map((row,index)=>({kind:'numeric-use',site:site(row,index+1),operator,index,operand:row.operands[0],origin:index===0?{kind:'binding',descriptorIndex:0}:{kind:'constant-i32',bits:7,decimal:'7'}}))]);
  assert.equal(typed.identity.wordsDigest,out.wordsDigest);assert.equal(typed.identity.artifactDigest,out.artifactDigest);
  const binary=verifyGpuI32Words(out.words,out.entryPoint,operator,arity);
  return {binary,sourceEvents:ops.length,words:out.words.length};
}

