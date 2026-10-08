// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {compileProgram,compileHir,sourceInput,runBytecode,runRequestSequence,createCompilerSession} from '../../compiler/pipeline.mjs';
import {printHir,readHir,lowerHir,verifyHir} from '../../compiler/hir.mjs';
import {validateFrontendSnapshot,analyzeFrontend} from '../../compiler/frontend.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});
const value=(type,value)=>({type,value});
function oracleScalar(type,input){
 // Frozen integer bitwords use the existing decimal request/result ABI;
 // this only encodes transport and never computes conversion expectations.
 if(input.decimal!==undefined)return input.decimal;
 if(type==='f32'||type==='f64')return input.rawBits;
 const width=BigInt(type==='isize'||type==='usize'?64:Number(type.slice(1))),bits=BigInt('0x'+input.rawBits);
 assert.ok(bits>=0n&&bits<(1n<<width));
 return (type.startsWith('i')&&(bits&(1n<<(width-1n)))!==0n?bits-(1n<<width):bits).toString();
}
async function frozen(name,hash){const b=await readFile(new URL('./fixtures/'+name,import.meta.url));assert.equal(createHash('sha256').update(b).digest('hex'),hash);return JSON.parse(b.toString('utf8'));}
async function compiled(source,optimize=false){const p=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(p.status,'ok',JSON.stringify(p));return p;}
async function rawPair(id,program,requests){
 const executable=tools().vm,args=['--requests',JSON.stringify(requests)];const child=spawnSync(executable,args,{input:program.bytecode,windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
 const directory=process.env.TSFG_CONVERSION_EVIDENCE_DIR;
 if(directory){await mkdir(directory,{recursive:true});await Promise.all([writeFile(path.join(directory,id+'.tbc'),program.bytecode),writeFile(path.join(directory,id+'.hir'),printHir(program.hir)),writeFile(path.join(directory,id+'.mlir'),program.core),writeFile(path.join(directory,id+'.requests.json'),JSON.stringify(requests)+'\n'),writeFile(path.join(directory,id+'.stdout'),child.stdout??''),writeFile(path.join(directory,id+'.stderr'),child.stderr??''),writeFile(path.join(directory,id+'.terminal.json'),JSON.stringify({executable,args,status:child.status,signal:child.signal,error:child.error?.message??null})+'\n')]);}
 assert.equal(child.status,0,child.stderr?.toString());return JSON.parse(child.stdout.toString('utf8'));
}
test('2508 independently frozen conversion expectations execute through all 286 entries in both optimizer modes',async()=>{
 const oracle=await frozen('exact-conversion-oracle.PREPARED.json','9a4642bf36e2f7985170fd1f87873fa2e0c2d6693e8bd5f4426702fa457c049f');assert.equal(oracle.cases.length,2508);
 const modes={'range-check':'checked','integer-wrap':'wrap','equal-width-reinterpret':'reinterpret'},groups=new Map();
 for(const row of oracle.cases){const key=[modes[row.mode],row.from,row.to].join('-');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}assert.equal(groups.size,286);
 for(const optimize of [false,true])for(const [key,rows]of groups){const first=rows[0],mode=modes[first.mode],call=`${mode}_${first.to}_from_${first.from}(input)`,source=`export function entry(input: ${first.from}): ${first.to} { return ${call}; }`,p=await compiled(source,optimize);
  const requests=rows.map(row=>({arguments:[value(row.from,oracleScalar(row.from,row.input))]})),outcomes=await rawPair(`oracle-${key}-${optimize}`,p,requests);assert.equal(outcomes.length,rows.length);
  for(const [index,row]of rows.entries()){const got=outcomes[index],label=JSON.stringify({id:row.id,mode:row.mode,from:row.from,to:row.to,input:row.input,got});assert.equal(got.activeRequests,'0',label);
   if(row.expected.kind==='trap'){assert.equal(got.status,'failed',label);assert.equal(got.code,row.expected.reason==='non-finite'?'r01-t-conversion-nonfinite':'r01-t-conversion-range',label);assert.deepEqual(got.ruleIds,['r01-conversions']);assert.equal(source.slice(Number(got.source.start),Number(got.source.end)),call,label);}
   else{assert.equal(got.status,'returned',label);assert.deepEqual(got.result,value(row.to,oracleScalar(row.to,row.expected)),label);}
  }
 }
});
test('36 independently frozen nonfinite policies preserve infinity/canonical checked NaN and all raw roundtrip bits',async()=>{
 const oracle=await frozen('nonfinite-conversion-oracle.PREPARED.json','73d58b7f26710291596369a7f65f914d34d5e54e37a8097b30e40e2ac6aad64b');assert.equal(oracle.rows.length,36);
 for(const optimize of [false,true])for(const row of oracle.rows){const call=row.mode==='checked'?`checked_${row.to}_from_${row.from}(input)`:`reinterpret_${row.to}_from_${row.via}(reinterpret_${row.via}_from_${row.from}(input))`,p=await compiled(`export function entry(input: ${row.from}): ${row.to} { return ${call}; }`,optimize);const [got]=await rawPair(row.id+'-'+optimize,p,[{arguments:[value(row.from,row.inputBits)]}]);assert.equal(got.status,'returned',row.id);assert.deepEqual(got.result,value(row.to,row.expected.rawBits),row.id);assert.equal(got.activeRequests,'0');}
});
test('conversion unused traps, first failure, argument order, recovery and scalar Fuel/depth are observable',async()=>{
 for(const optimize of [false,true]){
  const source='/*😀*/ export function entry(x:f64):i8 { const unused:i8=checked_i8_from_f64(x); return checked_i8_from_f64(x / 0.0); }',p=await compiled(source,optimize),good=await compiled('export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',optimize);
  const outcomes=await runRequestSequence([p.bytecode,good.bytecode],{...tools(),requests:[{arguments:[value('f64','4072c00000000000')]},{arguments:[value('f64','3ff0000000000000')],semanticFuel:1,depth:1}]});assert.equal(outcomes[0].code,'r01-t-conversion-range');assert.equal(source.slice(Number(outcomes[0].source.start),Number(outcomes[0].source.end)),'checked_i8_from_f64(x)');assert.deepEqual(outcomes[1].result,value('i8','1'));assert.equal(outcomes[1].fuelConsumed,'1');assert.equal(outcomes[1].fuelRemaining,'0');for(const out of outcomes)assert.equal(out.activeRequests,'0');
  const ordered=await compiled('export function entry(x:f64):i8 { return join(checked_i8_from_f64(x),checked_i8_from_f64(x / 0.0)); } function join(a:i8,b:i8):i8 { return a; }',optimize);const [failure]=await runBytecode(ordered.bytecode,{...tools(),requests:[{arguments:[value('f64','4072c00000000000')]}]});assert.equal(failure.code,'r01-t-conversion-range');
  const [nonfinite]=await runBytecode(good.bytecode,{...tools(),requests:[{arguments:[value('f64','7ff0000000000001')]}]});assert.equal(nonfinite.code,'r01-t-conversion-nonfinite');
 }
});
test('official conversion provenance cannot be forged, while ordinary same-name functions execute their bodies',async()=>{
 const source='export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',input=await sourceInput(source),result=await analyzeFrontend(input,{executable:tools().frontend});assert.equal(result.status,'ok',JSON.stringify(result));
 for(const mutate of [s=>s.functions[0].body[0].expression.conversion.entryId='sha256:'+'0'.repeat(64),s=>s.functions[0].body[0].expression.conversion.brandRefs[0].range.start++,s=>s.functions[0].body[0].expression.conversion.declarationPath='/foreign/minimal-conversions-v5.d.ts']){const s=structuredClone(result.snapshot);mutate(s);assert.throws(()=>validateFrontendSnapshot(s));}
 const p=await compiled(source),hir=readHir(Buffer.from(printHir(p.hir)));assert.equal(lowerHir(hir),lowerHir(p.hir));const forged=structuredClone(hir);forged.inputScope.files[0].content+=' ';assert.throws(()=>verifyHir(forged));
 for(const invalid of ['export function entry(x:f64):i8 { return checked_i8_from_f64(); }','export function entry(x:f64):i8 { return checked_i8_from_f64<f64>(x); }','export function entry(x:f64):i8 { return reinterpret_i8_from_f64(x); }','export function entry(x:f32):u8 { return wrap_u8_from_f32(x); }','export function entry(x:bool):i8 { return checked_i8_from_bool(x); }','export function entry(x:f64):i8 { return x as i8; }']){const got=await compileProgram(await sourceInput(invalid),tools());assert.equal(got.status,'error',invalid);assert.equal(got.bytecode,undefined);}
 for(const source of ['function checked_i8_from_f64(x:f64):i8 { return 42; } export function entry(x:f64):i8 { return checked_i8_from_f64(x); }','function checked_i8_from_f64(x:f64):i8 { return 42; } function entry(x:f64):i8 { return checked_i8_from_f64(x); }']){
  const ordinary=await compiled(source);assert.ok(!ordinary.core.includes('tsfg_core.convert_checked'));const [got]=await runBytecode(ordinary.bytecode,{...tools(),requests:[{functionId:ordinary.hir.functions[1].id,arguments:[value('f64','7ff0000000000001')],depth:2,semanticFuel:2}]});assert.deepEqual(got.result,value('i8','42'));assert.equal(got.fuelConsumed,'2');assert.equal(got.fuelRemaining,'0');
 }
});
test('conversion canonical exchange and cold/incremental source metamorphisms retain results',async()=>{
 for(const optimize of [false,true])for(const text of ['checked_i8_from_f64(x)','checked_i8_from_f64 /*comment*/ ( (x), )','checked_i8_from_f64((+(x)))']){
  const input=await sourceInput(`/*😀*/ export function entry(x:f64):i8 { return ${text}; }`),session=createCompilerSession({...tools(),optimize}),first=await session.compile(input),second=await session.compile(input),cold=await compileProgram(input,{...tools(),optimize});for(const p of [first,second,cold]){assert.equal(p.status,'ok',JSON.stringify(p));const span=p.hir.functions[0].body[0].value.range;assert.equal(input.files[0].content.slice(span.start,span.end),text);}assert.deepEqual(first.bytecode,second.bytecode);assert.deepEqual(first.bytecode,cold.bytecode);
  assert.deepEqual(await runBytecode(first.bytecode,{...tools(),command:'--roundtrip'}),first.bytecode);const [got]=await runBytecode(first.bytecode,{...tools(),requests:[{arguments:[value('f64','3ffc000000000000')]}]});assert.deepEqual(got.result,value('i8','1'));
  const old=Buffer.from(first.bytecode);old.writeUInt32LE(8,8);await assert.rejects(()=>runBytecode(old,tools()));
 }
});

test('cold Snapshot and HIR independently reject unsupported scopes, cross-scope origins and ordinary-body conversion routes',async()=>{
 const source='export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',input=await sourceInput(source),analyzed=await analyzeFrontend(input,{executable:tools().frontend});assert.equal(analyzed.status,'ok');
 const high=await compileHir(input,tools());assert.equal(high.status,'ok');
 /** @type {Array<(scope:any)=>void>} */
 const mutations=[scope=>scope.config.strict=false,scope=>scope.config.allowJs=true,scope=>scope.config.allowJS=true,scope=>scope.target.pointerBits='32',scope=>scope.files.push({path:'/foreign/unadmitted.js',content:'export const x=1;'}),scope=>scope.files.push({...scope.files[0]}),scope=>scope.files[0].unregistered=true,scope=>scope.declarations.paths.push('/src/missing.d.ts')];
 function rebindSnapshot(snapshot){snapshot.inputIdentity=sha256(canonical(snapshot.identityInput));const id=sha256(canonical({contractVersion:snapshot.contractVersion,schemaHash:snapshot.schemaHash,inputIdentity:snapshot.inputIdentity,frontendSource:snapshot.frontendSource}));const visit=value=>{if(value&&typeof value==='object')for(const key of Object.keys(value)){if(key==='snapshotId')value[key]=id;else visit(value[key]);}};visit(snapshot);}
 for(const mutate of mutations){
  const s=structuredClone(analyzed.snapshot);mutate(s.identityInput);rebindSnapshot(s);s.functions[0].body[0].expression.conversion.inputIdentity=s.inputIdentity;assert.throws(()=>validateFrontendSnapshot(s));
  const h=structuredClone(high.hir);mutate(h.inputScope);h.inputIdentity=sha256(canonical(h.inputScope));h.functions[0].body[0].value.origin.inputIdentity=h.inputIdentity;assert.throws(()=>verifyHir(h));assert.throws(()=>lowerHir(h));
 }
 // A valid additional declaration file changes the scope but cannot reuse a
 // previously projected origin. Its presence alone remains an admitted profile.
 const extra={path:'/src/extra.d.ts',content:'declare const hidden: boolean;'};
 for(const layer of ['snapshot','hir']){const s=structuredClone(layer==='snapshot'?analyzed.snapshot:high.hir),scope=layer==='snapshot'?s.identityInput:s.inputScope;scope.files.push(extra);scope.files.sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));if(layer==='snapshot')rebindSnapshot(s);else s.inputIdentity=sha256(canonical(scope));assert.throws(()=>layer==='snapshot'?validateFrontendSnapshot(s):verifyHir(s));}
 const extraInput=structuredClone(input);extraInput.files.push(extra);const extraHigh=await compileHir(extraInput,tools());assert.equal(extraHigh.status,'ok',JSON.stringify(extraHigh));verifyHir(extraHigh.hir);
 const ordinaryInput=await sourceInput(source+' function checked_i8_from_f64(x:f64):i8 { return 42; }'),ordinary=await compileHir(ordinaryInput,tools());assert.equal(ordinary.status,'ok');verifyHir(ordinary.hir);const h=structuredClone(ordinary.hir),call=h.functions[0].body[0].value;assert.equal(call.kind,'call');h.functions[0].body[0].value={kind:'conversion',type:call.type,range:call.range,origin:{...high.hir.functions[0].body[0].value.origin,inputIdentity:h.inputIdentity},operand:call.arguments[0]};assert.throws(()=>verifyHir(h));assert.throws(()=>lowerHir(h));
 const ordinarySnapshot=await analyzeFrontend(ordinaryInput,{executable:tools().frontend});assert.equal(ordinarySnapshot.status,'ok');const s=structuredClone(ordinarySnapshot.snapshot),expression=s.functions[0].body[0].expression;assert.equal(expression.kind,'call');s.functions[0].body[0].expression={kind:'conversion',type:expression.type,typeRef:expression.typeRef,node:expression.node,range:expression.range,conversion:{...analyzed.snapshot.functions[0].body[0].expression.conversion,inputIdentity:s.inputIdentity},operand:expression.arguments[0]};s.nodes.find(node=>node.id===expression.node.id).kind='conversion';assert.throws(()=>validateFrontendSnapshot(s));
 // The whole source still owns the body even if a forged table omits it.
 const omittedHir=structuredClone(h);omittedHir.functions=[omittedHir.functions[0]];assert.throws(()=>verifyHir(omittedHir));assert.throws(()=>lowerHir(omittedHir));
 const omittedSnapshot=structuredClone(s);omittedSnapshot.functions=[omittedSnapshot.functions[0]];
 const keepNodes=new Set(),keepSymbols=new Set([omittedSnapshot.functions[0].symbol.id,...omittedSnapshot.functions[0].parameters.map(p=>p.id)]);
 const collect=value=>{if(value&&typeof value==='object'){if(value.node?.id)keepNodes.add(value.node.id);for(const child of Object.values(value))collect(child);}};collect(omittedSnapshot.functions[0]);
 omittedSnapshot.nodes=omittedSnapshot.nodes.filter(node=>keepNodes.has(node.id));omittedSnapshot.symbols=omittedSnapshot.symbols.filter(symbol=>keepSymbols.has(symbol.id));assert.throws(()=>validateFrontendSnapshot(omittedSnapshot));
 const joinedSnapshot=structuredClone(omittedSnapshot);joinedSnapshot.functions[0].range.end=s.functions[1].range.end;joinedSnapshot.nodes.find(node=>node.id===joinedSnapshot.functions[0].node.id).range.end=s.functions[1].range.end;assert.throws(()=>validateFrontendSnapshot(joinedSnapshot));
 for(const [version,source]of [['minimal-bool-v1','export function entry(x:bool):bool { return x; }'],['minimal-scalars-v2','export function entry(x:i32):i32 { return x; }'],['minimal-integers-v3','export function entry(x:i8):i8 { return x; }'],['minimal-floats-v4','export function entry(x:f32):f32 { return x; }']]){const oldInput=version.endsWith('v1')||version.endsWith('v2')?{sourceRoot:'/src',rootFile:'/src/main.ts',files:[{path:'/src/main.ts',content:source},{path:`/src/${version}.d.ts`,content:await readFile(new URL(`../../compiler/${version}.d.ts`,import.meta.url),'utf8')}],declarations:{version,paths:[`/src/${version}.d.ts`]},config:{strict:true,noEmit:true,allowJs:false}}:await sourceInput(source,{declarationVersion:version});oldInput.files.push(extra);const old=await compileHir(oldInput,tools());assert.equal(old.status,'ok',JSON.stringify(old));verifyHir(old.hir);assert.ok(!lowerHir(old.hir).includes('tsfg_core.convert_'));}
});


test('independent Core and wire verifiers reject illegal nominal pairs, reserved bits and forged register uses',async()=>{
 const source='export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',p=await compiled(source);
 for(const operation of ['convert_wrap','reinterpret']){const core=p.core.replace('tsfg_core.convert_checked','tsfg_core.'+operation),child=spawnSync(tools().core,['--canonicalize'],{input:core,windowsHide:true});assert.equal(child.status,3);assert.match(child.stderr.toString(),/core-ir-conversion-type/);}
 const offset=p.bytecode.length-32;assert.equal(p.bytecode[offset],34);
 for(const {field,newValue,code}of [{field:7,newValue:1,code:'r04-reserved'},{field:6,newValue:2,code:'r04-conversion-type'},{field:1,newValue:2,code:'r04-conversion-type'},{field:4,newValue:255,code:'r04-register'}]){
  const bytes=Buffer.from(p.bytecode);bytes[offset+field]=newValue;createHash('sha256').update(bytes.subarray(80)).digest().copy(bytes,48);await assert.rejects(()=>runBytecode(bytes,tools()),new RegExp(code));
 }
 const wrong=Buffer.from(p.bytecode);wrong[12]^=1;await assert.rejects(()=>runBytecode(wrong,tools()),/r04-schema/);
 const foreign=structuredClone(p.hir);foreign.functions[0].body[0].value.origin.brandRefs[0].range.end++;assert.throws(()=>verifyHir(foreign));
});

test('cold conversion origins reject foreign merged declarations after coherent scope rebinding',async()=>{
 const input=await sourceInput('export function entry(x:f64):i8 { return checked_i8_from_f64(x); }');
 const analyzed=await analyzeFrontend(input,{executable:tools().frontend}),high=await compileHir(input,tools());
 assert.equal(analyzed.status,'ok');assert.equal(high.status,'ok');
 /** @type {Array<[string,boolean,boolean?]>} */
 const declarations=[
  ['declare const hidden:boolean;',true],
  ['declare function checked_i8_from_f64(value:f64):i8;',false],
  ['declare function /*entry*/ checked_i8_from_f\\u00364(value:f64):i8;',false],
  ['declare const __tsfg_i8:unique symbol;',false],
  ['declare const hidden:boolean, __tsfg_i8:unique symbol;',false],
  ['declare const {checked_i8_from_f64}: {checked_i8_from_f64:(value:f64)=>i8};',false],
  ['type i8 = number;',false],
  ['export {}; declare global { function checked_i8_from_f64(value:f64):i8; }',false],
  ['export {}; declare global { const __tsfg_i8:unique symbol; }',false],
  ['export {}; global { function checked_i8_from_f64(value:f64):i8; }',false],
  ['declare module "other" { global { function checked_i8_from_f64(value:f64):i8; } }',false],
  ['export declare function checked_i8_from_f64(value:f64):i8; export declare const __tsfg_i8:unique symbol;',true],
  ['declare namespace Extra { function checked_i8_from_f64(value:f64):i8; const __tsfg_i8:unique symbol; }',true],
  ['interface Extra { checked_i8_from_f64(value:f64):i8; __tsfg_i8:boolean; } declare const hidden:i8;',true],
  ['interface global { checked_i8_from_f64(value:f64):i8; }',true],
  ['/* declare function checked_i8_from_f64(value:f64):i8; */ declare const text:"declare const __tsfg_i8:unique symbol;";',true],
  ['declare function checked_i8_from_f64(value:f64):i8;',true,false],
 ];
 for(const [content,accepted,rooted=true]of declarations){
  const extra={path:'/src/extra.d.ts',content},request=structuredClone(input);request.files.push(extra);if(rooted)request.declarations.paths.push(extra.path);
  const official=await analyzeFrontend(request,{executable:tools().frontend});assert.equal(official.status,accepted?'ok':'error',content);
  const h=structuredClone(high.hir);h.inputScope.files.push(extra);h.inputScope.files.sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));if(rooted)h.inputScope.declarations.paths.push(extra.path);
  h.inputIdentity=sha256(canonical(h.inputScope));h.functions[0].body[0].value.origin.inputIdentity=h.inputIdentity;
  const s=structuredClone(analyzed.snapshot);s.identityInput=structuredClone(h.inputScope);s.inputIdentity=h.inputIdentity;if(rooted)s.inputs.push({path:extra.path,sha256:sha256(content),kind:'declaration-root'});s.inputs.sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  const id=sha256(canonical({contractVersion:s.contractVersion,schemaHash:s.schemaHash,inputIdentity:s.inputIdentity,frontendSource:s.frontendSource}));
  const visit=value=>{if(value&&typeof value==='object'){if(value.snapshotId)value.snapshotId=id;for(const child of Object.values(value))visit(child);}};visit(s);s.functions[0].body[0].expression.conversion.inputIdentity=s.inputIdentity;
  if(accepted){validateFrontendSnapshot(s);verifyHir(h);readHir(Buffer.from(printHir(h)));assert.match(lowerHir(h),/tsfg_core.convert_checked/);}
  else{assert.throws(()=>validateFrontendSnapshot(s),undefined,content);assert.throws(()=>verifyHir(h),undefined,content);assert.throws(()=>readHir(Buffer.from(canonical(h)+'\n')),undefined,content);assert.throws(()=>lowerHir(h),undefined,content);}
 }
});

test('cold conversion declaration loading follows referenced files while unused VFS declarations stay inert',async()=>{
 const input=await sourceInput('export function entry(x:f64):i8 { return checked_i8_from_f64(x); }');
 const analyzed=await analyzeFrontend(input,{executable:tools().frontend}),high=await compileHir(input,tools());assert.equal(analyzed.status,'ok');assert.equal(high.status,'ok');
 const foreign='declare function checked_i8_from_f64(value:f64):i8;';
 /** @type {Array<[string,string,string,string,boolean,boolean]>} */
 const cases=[
  ['path-reference','/src/dep.d.ts','/// <reference path="./dep.d.ts" />',foreign,true,false],
  ['side-import','/src/dep.d.ts','import "./dep";',foreign,true,false],
  ['from-import','/src/dep.d.ts','import {other} from "./dep";','export const other:boolean; declare global { function checked_i8_from_f64(value:f64):i8; }',true,false],
  ['type-import','/src/dep.d.ts','type Other = import("./dep").Other;','export type Other=boolean; declare global { function checked_i8_from_f64(value:f64):i8; }',true,false],
  ['types-reference','/src/node_modules/@types/foo/index.d.ts','/// <reference types="foo" />',foreign,true,false],
  ['bare-types-import','/src/node_modules/@types/foo/index.d.ts','import "foo";',foreign,true,false],
  ['bare-package-import','/src/node_modules/foo/index.d.ts','import "foo";',foreign,true,false],
  ['unused-types','/src/node_modules/@types/foo/index.d.ts','',foreign,false,true],
  ['unused-file','/src/dep.d.ts','// inert',foreign,false,true],
  ['legal-reference','/src/dep.d.ts','/// <reference path="./dep.d.ts" />','declare const hidden:i8;',true,true],
 ];
 for(const [name,dependencyPath,content,dependency,rooted,accepted]of cases){
  const h=structuredClone(high.hir);h.inputScope.files.push({path:'/src/extra.d.ts',content},{path:dependencyPath,content:dependency});if(rooted)h.inputScope.declarations.paths.push('/src/extra.d.ts');h.inputScope.files.sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));h.inputIdentity=sha256(canonical(h.inputScope));h.functions[0].body[0].value.origin.inputIdentity=h.inputIdentity;
  const request=h.inputScope,official=await analyzeFrontend(request,{executable:tools().frontend});assert.equal(official.status,accepted?'ok':'error',name);
  const s=structuredClone(analyzed.snapshot);s.identityInput=structuredClone(request);s.inputIdentity=h.inputIdentity;if(rooted)s.inputs.push({path:'/src/extra.d.ts',sha256:sha256(content),kind:'declaration-root'});
  const id=sha256(canonical({contractVersion:s.contractVersion,schemaHash:s.schemaHash,inputIdentity:s.inputIdentity,frontendSource:s.frontendSource}));const visit=value=>{if(value&&typeof value==='object'){if(value.snapshotId)value.snapshotId=id;for(const child of Object.values(value))visit(child);}};visit(s);s.functions[0].body[0].expression.conversion.inputIdentity=s.inputIdentity;
  if(accepted){validateFrontendSnapshot(s);verifyHir(h);readHir(Buffer.from(printHir(h)));assert.match(lowerHir(h),/tsfg_core.convert_checked/);}
  else{assert.throws(()=>validateFrontendSnapshot(s),undefined,name);assert.throws(()=>verifyHir(h),undefined,name);assert.throws(()=>readHir(Buffer.from(canonical(h)+'\n')),undefined,name);assert.throws(()=>lowerHir(h),undefined,name);}
  if(process.env.TSFG_CONVERSION_EVIDENCE_DIR){
   const directory=process.env.TSFG_CONVERSION_EVIDENCE_DIR;await mkdir(directory,{recursive:true});const rawInput=Buffer.from(JSON.stringify(request)),executable=tools().frontend,before=createHash('sha256').update(await readFile(executable)).digest('hex'),child=spawnSync(executable,[],{input:rawInput,windowsHide:true,timeout:30000,maxBuffer:1024*1024});assert.equal(child.status,0,name);assert.equal(createHash('sha256').update(await readFile(executable)).digest('hex'),before);assert.equal(JSON.parse(child.stdout.toString()).status,accepted?'ok':'error',name);
   await Promise.all([writeFile(path.join(directory,name+'.input'),rawInput),writeFile(path.join(directory,name+'.stdout'),child.stdout),writeFile(path.join(directory,name+'.stderr'),child.stderr),writeFile(path.join(directory,name+'.terminal.json'),JSON.stringify({executable,args:[],status:child.status,signal:child.signal,error:child.error?.message??null,executableSHA256:before})+'\n'),writeFile(path.join(directory,name+'.owned.json'),JSON.stringify({snapshot:s,hir:h})+'\n')]);
  }
 }
});

test('actual source, Core and VM endpoint pairs bind both modes to exact current consumer bytes',async()=>{
 const cases=[['checked','export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',value('f64','3ffc000000000000'),value('i8','1')],['wrap','export function entry(x:i64):u8 { return wrap_u8_from_i64(x); }',value('i64','-257'),value('u8','255')],['reinterpret','export function entry(x:f32):u32 { return reinterpret_u32_from_f32(x); }',value('f32','ffc12345'),value('u32','4290847557')]];
 for(const optimize of [false,true])for(const [id,source,inputValue,expected]of cases){
  const sourceClaim=await sourceInput(source),inputBytes=Buffer.from(JSON.stringify(sourceClaim)),prefix=`endpoints-${id}-${optimize}`;
  async function endpoint(role,args,input,suffix){const executable=tools()[role],before=createHash('sha256').update(await readFile(executable)).digest('hex'),child=spawnSync(executable,args,{input,windowsHide:true,maxBuffer:16*1024*1024,timeout:300000}),after=createHash('sha256').update(await readFile(executable)).digest('hex');assert.equal(after,before);assert.equal(child.status,0,child.stderr?.toString());const directory=process.env.TSFG_CONVERSION_EVIDENCE_DIR;if(directory){await mkdir(directory,{recursive:true});await Promise.all([writeFile(path.join(directory,prefix+'-'+suffix+'.input'),input),writeFile(path.join(directory,prefix+'-'+suffix+'.stdout'),child.stdout),writeFile(path.join(directory,prefix+'-'+suffix+'.stderr'),child.stderr),writeFile(path.join(directory,prefix+'-'+suffix+'.terminal.json'),JSON.stringify({role,executable,args,status:child.status,signal:child.signal,error:child.error?.message??null,rawExecutableBefore:before,rawExecutableAfter:after})+'\n')]);}return child.stdout;}
  const actual=JSON.parse((await endpoint('frontend',[],inputBytes,'frontend')).toString('utf8'));assert.equal(actual.status,'ok');
  const analyzed=await analyzeFrontend(sourceClaim,{executable:tools().frontend});assert.equal(analyzed.status,'ok');validateFrontendSnapshot(analyzed.snapshot);
  const hirResult=await compileHir(sourceClaim,tools());assert.equal(hirResult.status,'ok');verifyHir(hirResult.hir);const coreInput=Buffer.from(lowerHir(hirResult.hir)),core=await endpoint('core',[optimize?'--optimize':'--canonicalize'],coreInput,'core-validate'),packet=await endpoint('core',['--emit-bytecode'],core,'core-bytecode');
  const formal=await compiled(source,optimize);assert.deepEqual(packet,formal.bytecode);assert.equal(core.toString('utf8'),formal.core);
  const requests=[{arguments:[inputValue]}],outcomes=JSON.parse((await endpoint('vm',['--requests',JSON.stringify(requests)],packet,'vm')).toString('utf8'));assert.deepEqual(outcomes[0].result,expected);assert.equal(outcomes[0].activeRequests,'0');
  if(process.env.TSFG_CONVERSION_EVIDENCE_DIR)await writeFile(path.join(process.env.TSFG_CONVERSION_EVIDENCE_DIR,prefix+'-owned-snapshot-hir.json'),JSON.stringify({snapshot:analyzed.snapshot,hir:hirResult.hir})+'\n');
 }
});
