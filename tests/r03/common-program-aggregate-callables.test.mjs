// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,readCommonProgramHir,printCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonTargets} from '../../compiler/common-program-targets.mjs';
import {originId,signatureId,byteOrder} from '../../compiler/typed-array-schema.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {aggregateCallableModel,aggregatePureCompanionModel} from './common-program-aggregate-callable-models.mjs';
for(const mode of ['held','same-code','single','pure','nested','throw','coexisting'])test('normalized aggregate callable independently holds each selected owner: '+mode,()=>{
  const value=aggregateCallableModel(mode);assert.doesNotThrow(()=>analyzeCommonGraphs(value.program,value.records));
});
test('normalized pure companion alternative cannot hold another field borrowed owner',()=>{
  const value=aggregatePureCompanionModel();assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending'&&e.primary?.start===290&&e.primary?.end===299);
});
for(const mode of ['bad','bad-throw'])test('normalized aggregate callable cannot borrow a sibling alternative owner: '+mode,()=>{
  const value=aggregateCallableModel(mode);assert.throws(()=>analyzeCommonGraphs(value.program,value.records),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending'&&e.primary?.sourceId==='/unit-model.ts'&&e.primary?.start===290&&e.primary?.end===299);
});
for(const reason of ['budget','cancel'])test('normalized aggregate proof propagates '+reason+' without partial success',()=>{
  const measured=aggregateCallableModel();let work=0;measured.program.model.spend=(n=1)=>{work+=n;};
  analyzeCommonGraphs(measured.program,measured.records);
  const value=aggregateCallableModel(),meter=commonMeter(work-1),cancelled=new Error('aggregate proof cancelled');let remaining=work-1,result;
  value.program.model.spend=(n=1)=>{if(reason==='budget')meter(n);else if((remaining-=n)<0)throw cancelled;};
  assert.throws(()=>{result=analyzeCommonGraphs(value.program,value.records);},/** @param {any} e */e=>
    reason==='cancel'?e===cancelled:e.code==='r03-common-program-limit');assert.equal(result,undefined);
});
const fixture=name=>projectCommonProgram(readCommonProgramFacts(fs.readFileSync(new URL('./testdata/common-aggregate-callables/'+name+'.json',import.meta.url))));
for(const name of ['same-code-match-safe','different-code-match-safe','shared-environment-descriptor-safe'])test('official whole Program aggregate callable independently retains its owner: '+name,()=>{
  const hir=fixture(name);assert.doesNotThrow(()=>emitCommonProgramCore(hir,createCommonProgramPublication(hir),{
    targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}));
});
for(const [name,start,end]of [['wrong-owner-alternative-conflict',1760,1778],['descriptor-only-alternative-conflict',1721,1739]])test('official whole Program preserves unsafe owner boundary: '+name,()=>{
  const hir=fixture(name);assert.throws(()=>emitCommonProgramCore(hir,createCommonProgramPublication(hir),{
    targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),/** @param {any} e */e=>
    e.code==='r03-common-program-borrow-pending'&&e.primary?.sourceId===hir.rootFile&&e.primary.start===start&&e.primary.end===end);
});

// Whole checked component variant of the original distinct Code+Env packet.
// Only the last application body and its source-dependent identities change.
function reassignmentProgram(mode){
  const donor=fs.readFileSync(new URL('./testdata/common-aggregate-callables/different-code-match-safe.json',import.meta.url));
  assert.equal(sha256(donor),'sha256:b2b2861cd5fa38e438a5d910d6f52340c53cf7f2e4f36c49c334e10b0e77ddcd');
  const packet=structuredClone(readCommonProgramFacts(donor)),p=packet.payload,root=p.rootFile;
  const file=p.files.find(row=>row.path===root),fn=p.functions.find(row=>row.name==='captureSpanOrdinary');
  const previousId=fn.id,signature=fn.body[1].value.signature;
  const first=p.functions.find(row=>row.name==='makeFirstReader'),second=p.functions.find(row=>row.name==='makeSecondReader');
  const callable=first.returnType,bodyStart=file.content.indexOf('{',fn.returnAnnotationRange.end)+1;
  const comparison='(f = makeSecondReader())() === 0',unconditional=mode==='unconditional',branch=mode==='if';
  const effect=unconditional?comparison+';':branch?'if (flag) { '+comparison+'; }':'flag '+mode+' ('+comparison+');';
  file.content=file.content.slice(0,bodyStart)+'\n  let f: () => i32 = makeFirstReader();\n  '+effect+'\n  return f();\n}\n';
  const span=(start,end)=>({start,end});
  const locate=(text,start=bodyStart)=>{const index=file.content.indexOf(text,start);assert.ok(index>=0,text);return span(index,index+text.length);};
  fn.declarationRange.end=file.content.length-1;
  fn.id=sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath:root,declarationRange:fn.declarationRange}));
  fn.parameters[0].lexicalOwner=fn.id;
  const nameRange=locate('f:',bodyStart),firstInit=locate('makeFirstReader()');
  nameRange.end--;
  const binding=originId(root,nameRange),declarationRange=span(nameRange.start,firstInit.end);
  fn.bindings=[{...fn.bindings[0],id:binding,name:'f',lexicalOwner:fn.id,nameRange,annotationRange:locate('() => i32'),
    declarationRange,declaredType:callable,writable:true}];
  const expr=(kind,type,range,extra={})=>({kind,type,flowType:type,range,...extra});
  const direct=(callee,range)=>expr('call',callable,range,{callee:callee.id,calleeRange:span(range.start,range.end-2),arguments:[],
    signature:{id:signatureId(root,callee.declarationRange),sourcePath:root,declarationRange:callee.declarationRange,parameters:[],returnType:callable}});
  const indirect=(expression,range)=>expr('indirectCall','i32',range,{expression,signature,arguments:[],calleeRange:expression.range});
  const grouped=expression=>expr('parentheses',expression.type,span(expression.range.start-1,expression.range.end+1),{expression});
  const binary=(left,operator,right)=>expr('binary','bool',span(left.range.start,right.range.end),
    {left,operator,operatorRange:locate(operator,left.range.end),right});
  const at=locate(effect),target=locate('f = ',at.start),secondInit=locate('makeSecondReader()',target.end);
  const assignment=expr('bindingAssignment',callable,span(target.start,secondInit.end),
    {target:{kind:'bindingTarget',binding,type:callable,range:span(target.start,target.start+1)},
      operator:'=',operatorRange:locate('=',target.start),value:direct(second,secondInit)});
  const callee=grouped(assignment),called=indirect(callee,span(callee.range.start,callee.range.end+2));
  const test=binary(called,'===',expr('numericLiteral','i32',locate('0',called.range.end),{token:'0',decimal:'0'}));
  const condition=unconditional?null:expr('bindingReference','bool',locate('flag',at.start),{binding:fn.parameters[0].id});
  const returned=locate('return f();',at.end),site=locate('f()',returned.start);
  const statement=branch?{kind:'if',range:at,condition,then:[{kind:'expression',range:locate(comparison+';',at.start),value:test}],else:[]}:
    {kind:'expression',range:at,value:unconditional?test:binary(condition,mode,grouped(test))};
  fn.body=[
    {kind:'letDeclaration',binding,range:declarationRange,initializer:direct(first,firstInit)},
    statement,
    {kind:'return',range:returned,value:indirect(expr('bindingReference',callable,span(site.start,site.start+1),{binding}),site)},
  ];
  file.sha256=sha256(file.content).slice(7);file.byteLength=Buffer.byteLength(file.content);file.utf16Length=file.content.length;
  const files=p.files.map(({path,sha256})=>({path,sha256}));
  for(const type of p.types)if(type.nominalKey)type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files,nominalKey:type.nominalKey}));
  for(const row of p.functions)if(row.sourcePath===root&&row.lexicalParent===null)row.declarationScope.end=file.utf16Length;
  for(const row of p.modules.find(row=>row.sourcePath===root).exports)if(row.target===previousId)
    Object.assign(row,{target:fn.id,range:fn.declarationRange,definitionRange:fn.declarationRange});
  for(const rows of [p.closure.roots,p.closure.requiredRoots])for(const row of rows){
    if(row.sourcePath===root&&row.kind==='module-initialization')row.range.end=file.utf16Length;
    if(row.target===previousId)Object.assign(row,{target:fn.id,range:fn.declarationRange});
  }
  for(const row of [...p.exports,...p.entryCompatibilityRoots])if(row.functionId===previousId)row.functionId=fn.id;
  const entry=row=>row.functionId+'\0'+row.parameterBinding;
  p.entryCompatibilityRoots.sort((left,right)=>byteOrder(entry(left),entry(right)));
  const tuples=rows=>rows.map(({kind,sourcePath,name})=>({kind,sourcePath,name}));
  const request={family:'tsfg.program-facts-request-candidate',version:packet.version,schemaHash:packet.schemaHash,
    input:{sourceRoot:p.sourceRoot,rootFile:root,files:p.files.map(({path,content,sha256})=>({path,content,sha256})),
      declarations:p.declarations,config:p.config,target:p.target,compilationClosure:{roots:tuples(p.closure.roots),requiredRoots:tuples(p.closure.requiredRoots)},
      hostImports:p.hostImports.map(({sourcePath,name,capabilityId,parameterTypes,returnType})=>({sourcePath,name,capabilityId,parameterTypes,returnType}))}};
  packet.requestId=sha256('tsfg.program-facts.request.v2\0'+canonical(request)+'\n');
  packet.packageId=sha256('tsfg.program-facts.package.v2\0'+packet.schemaHash+'\0'+canonical(p));
  const owned=projectCommonProgram(readCommonProgramFacts(Buffer.from(canonical(packet)+'\n')));
  return {hir:readCommonProgramHir(Buffer.from(printCommonProgramHir(owned))),site,inner:called.range};
}

for(const mode of ['unconditional','if','&&','||'])test('retained-derived local callable reassignment through '+mode,()=>{
  const {hir,site,inner}=reassignmentProgram(mode),fn=hir.functions.find(row=>row.name==='captureSpanOrdinary');
  const reader=name=>hir.functions.find(row=>row.name===name).id;
  const targets=commonTargets(hir,commonMeter());
  assert.deepEqual(targets.site(fn.id,inner),{top:false,functions:[reader('readSecond')]});
  const expected=mode==='unconditional'?[reader('readSecond')]:[reader('readFirst'),reader('readSecond')].sort();
  assert.deepEqual(targets.site(fn.id,site),{top:false,functions:expected});
  assert.doesNotThrow(()=>emitCommonProgramCore(hir,createCommonProgramPublication(hir),{
    targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()}));
});
