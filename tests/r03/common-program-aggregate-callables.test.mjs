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
function reassignmentProgram(mode,family='local'){
  const donor=fs.readFileSync(new URL('./testdata/common-aggregate-callables/different-code-match-safe.json',import.meta.url));
  assert.equal(sha256(donor),'sha256:b2b2861cd5fa38e438a5d910d6f52340c53cf7f2e4f36c49c334e10b0e77ddcd');
  const packet=structuredClone(readCommonProgramFacts(donor)),p=packet.payload,root=p.rootFile;
  const file=p.files.find(row=>row.path===root),fn=p.functions.find(row=>row.name==='captureSpanOrdinary');
  const previousId=fn.id,signature=fn.body[1].value.signature;
  const first=p.functions.find(row=>row.name==='makeFirstReader'),second=p.functions.find(row=>row.name==='makeSecondReader');
  const callable=first.returnType,bodyStart=file.content.indexOf('{',fn.returnAnnotationRange.end)+1;
  const numeric=mode==='='||mode==='??=',call='(f = makeSecondReader())()',comparison=call+' === 0';
  const unconditional=mode==='unconditional'||mode==='=',branch=mode==='if',order=family==='element receiver',logicalAssignment=mode==='&&='||mode==='||=';
  const stored=numeric||logicalAssignment&&family!=='local';
  const valueType=logicalAssignment?'bool':'i32',initialToken=logicalAssignment?'false':'0';
  const receiverValue=logicalAssignment?comparison:call,rhsText=order?(logicalAssignment?'f() === 0':'f()'):receiverValue;
  const left=order?'(values = ['+receiverValue+'])[0]':{local:'gate',global:'leftTotal',field:'new Box().n',element:'values[0]'}[family];
  const declaration=family==='local'?'let gate: i32 = 0;':
    (order?'let':'const')+' values: '+valueType+'[] = ['+initialToken+'];';
  const effect=stored?left+' '+mode+' '+rhsText+';':unconditional?comparison+';':branch?'if (flag) { '+comparison+'; }':'flag '+mode+' ('+comparison+');';
  file.content=file.content.slice(0,bodyStart)+'\n  let f: () => i32 = makeFirstReader();\n  '+
    (stored&&(family==='local'||family==='element'||order)?declaration+'\n  ':'')+effect+'\n  return f();\n}\n';
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
  let statement,outerRhs=null;
  const body=[{kind:'letDeclaration',binding,range:declarationRange,initializer:direct(first,firstInit)}];
  const initialValue=(type,range)=>type==='bool'?expr('booleanLiteral',type,range,{token:initialToken}):
    expr('numericLiteral',type,range,{token:'0',decimal:'0'});
  const asBoolean=called=>binary(called,'===',initialValue('i32',locate('0',called.range.end)));
  if(stored){
    const location=locate(left,at.start);
    const allocation=range=>sha256('tsfg.array-facts.allocation.v8\0'+canonical({sourcePath:root,declarationRange:range}));
    let kind='bindingAssignment',target;
    if(family==='local'){
      const gate=locate('gate',declarationRange.end),gateId=originId(root,gate),initial=locate('0',gate.end),range=span(gate.start,initial.end);
      fn.bindings.push({...fn.bindings[0],id:gateId,name:'gate',nameRange:gate,annotationRange:locate('i32',gate.end),declarationRange:range,declaredType:'i32'});
      body.push({kind:'letDeclaration',binding:gateId,range,initializer:initialValue('i32',initial)});
      target={kind:'bindingTarget',binding:gateId,type:'i32',range:location};
    }else if(family==='global'){
      const global=p.globals.find(row=>row.binding.name===left);
      assert.equal(global.binding.writable,true);
      target={kind:'bindingTarget',binding:global.binding.id,type:'i32',range:location};
    }else if(family==='field'){
      const old=p.functions.find(row=>row.name==='ordinary').body[0].initializer,range=locate('new Box()',location.start);
      const member=p.types.find(row=>row.id===old.type).fields.find(row=>row.name==='n');
      const receiver={...old,range,calleeRange:locate('Box',location.start),allocationSite:allocation(range)};
      kind='fieldAssignment';
      target={kind:'fieldTarget',type:'i32',range:location,property:member.id,nameRange:span(location.end-1,location.end),receiver};
    }else{
      const name='values',nameRange=locate(name,declarationRange.end),id=originId(root,nameRange),initial=locate('['+initialToken+']',nameRange.end);
      const annotationRange=locate(valueType+'[]',nameRange.end),range=span(nameRange.start,initial.end),type='array<'+valueType+'>';
      if(logicalAssignment){
        // The Array declaration is the same owned minimal-arrays-v8.d.ts.
        p.types.push({...p.types.find(row=>row.id==='array<i32>'),id:type,elementType:valueType});
        p.types.sort((a,b)=>byteOrder(a.id,b.id));
      }
      fn.bindings.push({...fn.bindings[0],id,name,nameRange,writable:order,annotationRange,elementAnnotationRange:span(annotationRange.start,annotationRange.end-2),
        declarationRange:range,declaredType:type});
      body.push({kind:order?'letDeclaration':'constDeclaration',binding:id,range,initializer:expr('arrayLiteral',type,initial,{
        allocationSite:allocation(initial),elements:[initialValue(valueType,span(initial.start+1,initial.end-1))]})});
      const nameUse=locate(name,location.start),index=initialValue('u32',span(location.end-2,location.end-1));
      let receiver=expr('bindingReference',type,nameUse,{binding:id});
      if(order){
        const receiverElement=logicalAssignment?asBoolean(called):called;
        const selected=span(receiverElement.range.start-1,receiverElement.range.end+1);
        const write=expr('bindingAssignment',type,span(nameUse.start,selected.end),{
          target:{kind:'bindingTarget',type,binding:id,range:nameUse},operator:'=',operatorRange:locate('=',nameUse.end),
          value:expr('arrayLiteral',type,selected,{allocationSite:allocation(selected),elements:[receiverElement]})});
        receiver=grouped(write);
        const rhs=locate('f()',location.end);
        outerRhs=indirect(expr('bindingReference',callable,span(rhs.start,rhs.start+1),{binding}),rhs);
      }
      kind=mode==='='?'elementAssignment':'elementCompoundAssignment';
      target={kind:'elementTarget',type:valueType,range:location,receiver,index};
    }
    const raw=outerRhs??called,value=logicalAssignment?asBoolean(raw):raw;
    statement={kind:'expression',range:at,value:expr(kind,valueType,span(location.start,value.range.end),{
      target,operator:mode,operatorRange:locate(mode,location.end),value})};
  }else{
    const test=asBoolean(called);
    const condition=unconditional?null:expr('bindingReference','bool',locate('flag',at.start),{binding:fn.parameters[0].id});
    if(logicalAssignment){
      const value=grouped(test);
      statement={kind:'expression',range:at,value:expr('bindingAssignment','bool',span(condition.range.start,value.range.end),{
        target:{kind:'bindingTarget',binding:fn.parameters[0].id,type:'bool',range:condition.range},
        operator:mode,operatorRange:locate(mode,condition.range.end),value})};
    }else statement=branch?{kind:'if',range:at,condition,then:[{kind:'expression',range:locate(comparison+';',at.start),value:test}],else:[]}:
      {kind:'expression',range:at,value:unconditional?test:binary(condition,mode,grouped(test))};
  }
  const returned=locate('return f();',at.end),site=locate('f()',returned.start);
  fn.body=[...body,statement,{kind:'return',range:returned,value:indirect(expr('bindingReference',callable,span(site.start,site.start+1),{binding}),site)}];
  return {hir:coldReframedHir(packet,fn,previousId,file),site,inner:called.range,rhs:outerRhs?.range};
}

function checkReassignment(mode,family,checkCore=true){
  const {hir,site,inner,rhs}=reassignmentProgram(mode,family),fn=hir.functions.find(row=>row.name==='captureSpanOrdinary');
  const reader=name=>hir.functions.find(row=>row.name===name).id;
  const targets=commonTargets(hir,commonMeter());
  assert.deepEqual(targets.site(fn.id,inner),{top:false,functions:[reader('readSecond')]});
  const expected=mode==='unconditional'||mode==='='||rhs?[reader('readSecond')]:[reader('readFirst'),reader('readSecond')].sort();
  if(checkCore)assert.doesNotThrow(()=>emitCommonProgramCore(hir,createCommonProgramPublication(hir),{
    targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()}));
  assert.deepEqual(targets.site(fn.id,site),{top:false,functions:expected});
  if(rhs)assert.deepEqual(targets.site(fn.id,rhs),{top:false,functions:expected});
}
for(const mode of ['unconditional','if','&&','||','&&=','||=','=','??='])test('retained-derived local callable reassignment through '+mode,()=>checkReassignment(mode,'local'));
for(const family of ['global','field','element','element receiver'])for(const mode of ['=','??='])
  test('retained-derived '+family+' numeric target through '+mode,()=>checkReassignment(mode,family));
for(const family of ['element','element receiver'])for(const mode of ['&&=','||='])
  test('retained-derived '+family+' Boolean target analysis through '+mode,()=>checkReassignment(mode,family,false));

function coldReframedHir(packet,fn,previousId,file){
  const p=packet.payload,root=p.rootFile;
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
  return readCommonProgramHir(Buffer.from(printCommonProgramHir(owned)));
}

// The full retained Program supplies the nullable callable type and both
// original code identities. Alter only its last application body.
function nullishProgram(mode){
  const donor=fs.readFileSync(new URL('./testdata/common-nullable-capture/function-undefined-local-let.json',import.meta.url));
  assert.equal(sha256(donor),'sha256:6b696f8fdbfceb0241ba8e5ed641b7e848512ff164c92a5e99c2e3bff19594bc');
  const packet=structuredClone(readCommonProgramFacts(donor)),p=packet.payload,root=p.rootFile;
  const file=p.files.find(row=>row.path===root),fn=p.functions.find(row=>row.name==='loopRead');
  const previousId=fn.id,signature=p.functions.find(row=>row.name==='captureSpanOrdinary').body[1].value.signature;
  const factory=p.functions.find(row=>row.name==='makeOwnedReader'),leaf=p.functions.find(row=>row.name==='nullableLeaf');
  const callable=factory.returnType,optional='union<'+callable+',undefined>',bodyStart=file.content.indexOf('{',fn.returnAnnotationRange.end)+1;
  const hasWrite=mode!=='result',branch=mode==='explicit-branch';
  const declaration='let gate: (() => i32) | undefined = undefined;';
  const initialize='if (n === 0) { gate = makeOwnedReader(3); }';
  const local='let f: () => i32 = makeOwnedReader(1);';
  const selection='const selected: () => i32 = gate ?? '+(hasWrite?'(f = nullableLeaf)':'nullableLeaf')+';';
  const explicit='if (gate === undefined) { f = nullableLeaf; }';
  const returned='return '+(mode==='result'?'selected()':branch?'f()':'f() + selected()')+';';
  const rows=hasWrite?[declaration,initialize,local,branch?explicit:selection,returned]:[declaration,initialize,selection,returned];
  file.content=file.content.slice(0,bodyStart)+'\n  '+rows.join('\n  ')+'\n}\n';
  const span=(start,end)=>({start,end});
  const find=(text,start=bodyStart)=>{const at=file.content.indexOf(text,start);if(at<0)assert.fail(text);return span(at,at+text.length);};
  fn.declarationRange.end=file.content.length-1;
  fn.id=sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath:root,declarationRange:fn.declarationRange}));
  fn.parameters[0].lexicalOwner=fn.id;
  fn.bindings=[];
  fn.body=[];
  const expr=(kind,type,range,extra={})=>({kind,type,flowType:type,range,...extra});
  const binding=(kind,name,type,annotation,initializer,at)=>{
    const token=find(name,at.start),nameRange=span(token.start,token.end);
    const id=originId(root,nameRange),range=span(nameRange.start,initializer.range.end);
    const annotationRange=find(annotation,nameRange.end);
    fn.bindings.push({id,name,lexicalOwner:fn.id,kind:'local',declaredType:type,writable:kind==='letDeclaration',
      annotationRange,elementAnnotationRange:null,nameRange,declarationRange:range});
    return {kind,binding:id,range,initializer};
  };
  const literal=(token,start,type='i32')=>expr(type==='undefined'?'undefinedLiteral':'numericLiteral',type,find(token,start),
    type==='undefined'?{}:{token,decimal:token});
  const direct=(callee,at,argument)=>expr('call',callable,at,{callee:callee.id,calleeRange:span(at.start,at.start+callee.name.length),arguments:[argument],
    signature:{id:signatureId(root,callee.declarationRange),sourcePath:root,declarationRange:callee.declarationRange,parameters:['i32'],returnType:callable}});
  const use=(type,range,binding)=>expr('bindingReference',type,range,{binding});
  const binary=(left,operator,right,type)=>expr('binary',type,span(left.range.start,right.range.end),{left,operator,operatorRange:find(operator,left.range.end),right});
  const assign=(binding,type,loc,value)=>expr('bindingAssignment',type,span(loc.start,value.range.end),
    {flowType:value.flowType,target:{kind:'bindingTarget',binding,type,range:loc},operator:'=',operatorRange:find('=',loc.end),value});
  const indirect=(name,binding,start)=>{
    const range=find(name+'()',start),calleeRange=span(range.start,range.end-2);
    return expr('indirectCall','i32',range,{expression:use(callable,calleeRange,binding),signature,arguments:[],calleeRange});
  };
  const gateRow=find(declaration),gate=binding('letDeclaration','gate',optional,'(() => i32) | undefined',
    literal('undefined',find(' = ',gateRow.start).end,'undefined'),gateRow);
  const init=find(initialize),factoryRange=find('makeOwnedReader(3)',init.start);
  const gateWrite=assign(gate.binding,optional,find('gate',init.start),direct(factory,factoryRange,literal('3',factoryRange.start)));
  const condition=binary(use('i32',find('n',init.start),fn.parameters[0].id),'===',literal('0',init.start),'bool');
  fn.body.push(gate,{kind:'if',range:init,condition,then:[{kind:'expression',range:span(gateWrite.range.start,gateWrite.range.end+1),value:gateWrite}],else:[]});
  let f;
  if(hasWrite){
    const at=find(local),call=find('makeOwnedReader(1)',at.start);
    f=binding('letDeclaration','f',callable,'() => i32',direct(factory,call,literal('1',call.start)),at);
    fn.body.push(f);
  }
  const at=find(branch?explicit:selection),gateRead=use(optional,find('gate',at.start),gate.binding);
  const leafReference=expr('functionReference',callable,find('nullableLeaf',at.start),{functionId:leaf.id});
  const right=hasWrite?assign(f.binding,callable,find('f',find('f =',at.start).start),leafReference):leafReference;
  let selected;
  if(branch){
    const absent=literal('undefined',gateRead.range.end,'undefined');
    fn.body.push({kind:'if',range:at,condition:binary(gateRead,'===',absent,'bool'),
      then:[{kind:'expression',range:span(right.range.start,right.range.end+1),value:right}],else:[]});
  }else{
    const rhs=hasWrite?expr('parentheses',callable,span(right.range.start-1,right.range.end+1),{expression:right}):right;
    selected=binding('constDeclaration','selected',callable,'() => i32',binary(gateRead,'??',rhs,callable),at);
    fn.body.push(selected);
  }
  const returnRange=find(returned,at.end),calls=[];
  if(hasWrite)calls.push(indirect('f',f.binding,returnRange.start));
  if(!branch)calls.push(indirect('selected',selected.binding,returnRange.start));
  fn.body.push({kind:'return',range:returnRange,value:calls.length===1?calls[0]:binary(calls[0],'+',calls[1],'i32')});
  return {hir:coldReframedHir(packet,fn,previousId,file),sites:calls.map(call=>call.range)};
}

for(const mode of ['result','result-and-skip','explicit-branch'])test('retained-derived nullable callable coalescing '+mode,()=>{
  const {hir,sites}=nullishProgram(mode),fn=hir.functions.find(row=>row.name==='loopRead');
  const selected=commonTargets(hir,commonMeter());
  const functions=['readOwned','nullableLeaf'].map(name=>hir.functions.find(row=>row.name===name).id).sort();
  const targets=hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort();
  assert.doesNotThrow(()=>emitCommonProgramCore(hir,createCommonProgramPublication(hir),{targets}));
  for(const site of sites)assert.deepEqual(selected.site(fn.id,site),{top:false,functions});
});
