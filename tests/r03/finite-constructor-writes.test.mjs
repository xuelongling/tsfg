// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,buildInitialArrayPublication,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteFieldPhases} from '../../compiler/finite-field-phases.mjs';
import {sha256} from '../../compiler/identity.mjs';

// Source-only expectations from the existing accepted fe82/e4f inputs. These
// describe static permission and real SSA order, never executed payload values.
const input={
  own:{source:'fe82bbf8cf08c1c8a188040c28045067f831ca768ad8273b59cf0a23a7050777',folder:'typed-array-source514',
    packet:'2b3001140d229dea794442b5d1fc77fd7e3dadfc2e90df2d35a7ae78ff25f9e7',
    sourceText:'class Base{protected constructor(public readonly n:i32){}} class D extends Base{readonly x:i32;constructor(a:i32[],i:u32){super(a[i]);this.x=a[i];}} export function make(a:i32[],i:u32):D{return new D(a,i);}'},
  view:{source:'e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a',folder:'typed-array-reference-domain',
    packet:'e56cebf4ab207153f5a53d1acd738337a64a93c1fe85148f9ce78733d013e18b',
    sourceText:'class Frozen{readonly n:i32=1;} class Writable{n:i32=1;} export function f(a:Frozen):i32{const b:Writable=a;b.n=7;return a.n;}'}
};
async function actual(row) {
  const bytes=await readFile(new URL('./testdata/'+row.folder+'/'+row.source+'-package.json',import.meta.url));
  assert.equal(sha256(bytes).slice(7),row.packet);const facts=readTypedArrayFacts(bytes);
  assert.equal(facts.payload.files.find(row=>row.path==='/src/main.ts').content,row.sourceText);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const result=buildHir(facts,context);assert.equal(result.status,'ok',JSON.stringify(result.diagnostics));
  return {hir:result.hir,context};
}
test('accepted own readonly constructor store retains direct receiver, successful super and completed native phase',async()=>{
  const {hir,context}=await actual(input.own),derived=hir.types.find(row=>row.base),field=derived.fields[0];
  assert.equal(field.name,'x');assert.equal(field.readonly,true);
  const frame=hir.functions.find(row=>row.id===derived.constructor);assert.equal(frame.role,'construction-body');
  assert.equal(frame.ownerType,derived.id);
  const phases=buildFiniteFieldPhases(hir,context),phase=phases.find(row=>row.ownerType===derived.id);
  assert.deepEqual(phase.events.map(row=>[row.kind,row.output.field,row.output.state]),[['nativeDefine',field.id,'defined-native-undefined']]);
  const core=lowerFormalHir(hir,context),start=core.indexOf('func.func @"f'+frame.id.slice(7)+'"(');
  assert.ok(start>=0);const text=core.slice(start,core.indexOf('\n  }',start));
  const receiver=text.match(/\((%v\d+):/)[1],store=text.split('\n').find(row=>row.includes('"tsfg_core.domain.field_store"'));
  assert.ok(store);
  assert.ok(store.includes('"tsfg_core.domain.field_store"('+receiver+', '));
  assert.ok(store.includes('member = "'+field.id+'"')&&store.includes('receiver_view = "'+derived.id+'"'));
  const superAt=text.indexOf('"tsfg_core.domain.super"'),phaseAt=text.indexOf('"tsfg_core.domain.initialize_fields"'),
    defineAt=text.indexOf('"tsfg_core.domain.field_define"'),storeAt=text.indexOf(store);
  assert.ok(superAt>=0&&phaseAt>superAt&&defineAt>phaseAt&&storeAt>defineAt);
  const rhs=text.lastIndexOf('"tsfg_core.domain.array_read"',storeAt);
  assert.ok(rhs>defineAt&&rhs<storeAt,'checked RHS executes after actual native definition and before the body store');
  const from=input.own.sourceText.indexOf('this.x=a[i]');
  assert.ok(store.includes('tsfg_source.start = '+from+' : i64')&&store.includes('tsfg_source.end = '+(from+11)+' : i64'));
  assert.equal(text.split('"tsfg_core.domain.field_store"').length-1,1,'body assignment remains an ordinary successful store');
});
test('the existing mutable static alias remains writable on a readonly-declared actual instance',async()=>{
  const {hir,context}=await actual(input.view),frozen=hir.types.find(row=>row.fields?.some(field=>field.readonly)),
    writable=hir.types.find(row=>row.fields?.some(field=>!field.readonly));
  assert.equal(frozen.fields[0].name,'n');assert.equal(writable.fields[0].name,'n');
  const core=lowerFormalHir(hir,context),store=core.split('\n').find(row=>row.includes('"tsfg_core.domain.field_store"'));
  assert.ok(store);
  assert.ok(store.includes('receiver_view = "'+writable.id+'"'));
  assert.ok(store.includes(frozen.id)&&store.includes(frozen.fields[0].id),'actual field dispatch keeps readonly declaration identity');
  assert.notEqual(hir.functions.find(row=>row.name==='f').role,'construction-body','ordinary function did not acquire a construction role');
});

async function initializerProof(file,digest){
  const bytes=await readFile(new URL('./testdata/typed-array-reference-domain/'+file+'-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:'+digest);
  const facts=readTypedArrayFacts(bytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publicationContext=buildInitialArrayPublication(context);
  const built=buildHir(facts,context,publicationContext);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built;
  const proofs=buildFiniteCoreDomains(hir,context,{publicationContext});
  const phases=buildFiniteFieldPhases(hir,context,{publicationContext});
  return {hir,proofs,phases,context,publicationContext};
}
test('a checked field initializer stops subsequent initialization and normal construction',async()=>{
  const {hir,proofs,phases}=await initializerProof('initializer-order','5e4374117a2e272310c4003c9069cdb3ab0ddee34ebc5070b8113e6e0dbd818b');
  for(const [name,continues] of [['stops',false],['good',true]]) {
    const fn=hir.functions.find(row=>row.name===name);
    const phase=phases.find(row=>row.ownerType===fn.body[0].initializer.type);
    assert.ok(phase);
    const {constructionId}=phase;
    const [first,tail]=phase.events.map(({output})=>output.valueNode);
    assert.equal(phase.events.length,2);
    for(const plan of [proofs.definition,proofs.reached]){
      const reads=new Map(plan.arrayReaching.reads.map(row=>[row.node,row]));
      assert.equal(reads.get(first)?.status,continues?'proven':'missing',name+' first initializer');
      assert.equal(reads.get(tail)?.status,continues?'proven':'pending',name+' next initializer');
      const reachedWrites=plan.fieldReaching.phaseWrites.filter(row=>row.id.startsWith(constructionId+'/'));
      assert.deepEqual(reachedWrites.map(row=>row.node).sort(),continues?[first,tail].sort():[]);
      assert.equal(plan.fieldReaching.completions.some(row=>row.construction===constructionId),continues);
      const result=plan.nodes.find(row=>row.id===fn.id+'/return');
      assert.ok(result);
      const domain=plan.domains.find(row=>row.id===result.domainId);
      assert.deepEqual(domain.actualTypes,continues?[fn.returnType.id]:[]);
      const fieldRead=plan.fieldReaching.reads.find(row=>row.node===fn.id+'/body/1/value');
      assert.deepEqual(fieldRead?.reaching.flatMap(row=>row.sources),continues?[tail]:[]);
    }
  }
});

test('derived field initialization requires successful super and stops at its first failing read',async()=>{
  const {hir,proofs,phases}=await initializerProof('derived-initializer-order','42a9625af3afedf27e0691c7962042917d2df5ab8b614dbe3eaa92da9f54f0fe');
  const expected={blocked:['pending','pending'],stops:['missing','pending'],good:['proven','proven']};
  for(const [name,status] of Object.entries(expected)) {
    const fn=hir.functions.find(row=>row.name===name),type=hir.types.find(row=>row.id===fn.body[0].initializer.type);
    const phase=phases.find(row=>row.ownerType===type.id),base=phases.find(row=>row.ownerType===type.base);
    assert.equal(phase.activation,'after-successful-super');
    const [first,tail]=phase.events.map(row=>row.output.valueNode);
    assert.equal(phase.events.length,2);
    for(const plan of [proofs.definition,proofs.reached]) {
      const reads=new Map(plan.arrayReaching.reads.map(row=>[row.node,row]));
      assert.deepEqual([reads.get(first)?.status,reads.get(tail)?.status],status,name+' initializer reads');
      const writes=plan.fieldReaching.phaseWrites.filter(row=>row.id.startsWith(phase.constructionId+'/'));
      assert.deepEqual(writes.map(row=>row.node).sort(),name==='good'?[first,tail].sort():[],name+' reached writes');
      const completed=id=>plan.fieldReaching.completions.some(row=>row.construction===id);
      assert.equal(completed(base.constructionId),name!=='blocked',name+' base completion');
      assert.equal(completed(phase.constructionId),name==='good',name+' derived completion');
      const result=plan.nodes.find(row=>row.id===fn.id+'/return');
      const domain=plan.domains.find(row=>row.id===result.domainId);
      assert.deepEqual(domain.actualTypes,name==='good'?[fn.returnType.id]:[],name+' returned value');
    }
  }
});

test('mutually exclusive super calls meet at a single lexical initializer',async()=>{
  const {hir,proofs,phases,context,publicationContext}=await initializerProof('multi-super-initializer','e28589ca07d0dd98d1ac851ddd1345d4ea6019706b266f2ab4df39f90f375726');
  const fn=hir.functions.find(row=>row.name==='entry'),type=hir.types.find(row=>row.id===fn.body[0].initializer.type);
  const constructor=hir.functions.find(row=>row.id===type.constructor),branch=constructor.body[0];
  assert.equal(branch.then[0].expression.kind,'superConstruct');
  assert.equal(branch.else[0].expression.kind,'superConstruct');
  const phase=phases.find(row=>row.ownerType===type.id),[event]=phase.events;
  const node=event.output.valueNode;
  for(const plan of [proofs.definition,proofs.reached]) {
    const reads=plan.arrayReaching.reads.filter(row=>row.node===node);
    assert.deepEqual(reads.map(row=>row.status),['proven']);
    assert.equal(reads[0].versions.length,1);
    assert.equal(plan.fieldReaching.phaseWrites.filter(row=>row.node===node).length,1);
    const result=plan.nodes.find(row=>row.id===fn.id+'/return');
    const domain=plan.domains.find(row=>row.id===result.domainId);
    assert.deepEqual(domain.actualTypes,[fn.returnType.id]);
  }
  const core=lowerFormalHir(hir,context,publicationContext);
  const start=core.indexOf('  func.func @"f'+constructor.id.slice(7)+'"(');
  assert.ok(start>=0);
  const body=core.slice(start,core.indexOf('\n  }',start));
  const arms=[...body.matchAll(/"tsfg_core\.domain\.super"\(%v0\)[^\n]*\n    cf\.br \^(bb\d+)/g)];
  assert.equal(arms.length,2);
  assert.equal(arms[0][1],arms[1][1]);
  const join=body.slice(body.indexOf('^'+arms[0][1],(arms[1].index??0)+arms[1][0].length));
  for(const name of ['initialize_fields','array_create','array_read','field_initialize']){
    const op='"tsfg_core.domain.'+name+'"';
    assert.equal(body.split(op).length-1,1);
    assert.ok(join.includes(op));
  }
  assert.ok(join.includes('"tsfg_core.domain.initialize_fields"(%v0)'));
});


test('branch-local super arguments run before one shared phase and their original suffix',async()=>{
  const {hir,context,publicationContext}=await initializerProof(
    'super-prefix-suffix','d83249ceccb0056cb9fa050d0b29506438b257397b1833d40a7d5345f6721ac3');
  const entry=hir.functions.find(row=>row.name==='entry');
  const owner=hir.types.find(row=>row.id===entry.body[0].initializer.type);
  const constructor=hir.functions.find(row=>row.id===owner.constructor);
  const core=lowerFormalHir(hir,context,publicationContext);
  const start=core.indexOf('  func.func @"f'+constructor.id.slice(7)+'"(');
  assert.ok(start>=0);
  const body=core.slice(start,core.indexOf('\n  }',start));
  const [prefix,rest]=body.split('"tsfg_core.domain.initialize_fields"');
  assert.ok(rest);
  assert.equal(body.split('"tsfg_core.domain.initialize_fields"').length,2);
  assert.equal(body.split('"tsfg_core.domain.array_create"').length,2);
  const armLines=[...prefix.matchAll(/value = (11|22) : i32[^\n]*\n[^]*?"tsfg_core\.domain\.super"[^\n]*\n[^\n]*\n    cf\.br \^(bb\d+)/g)];
  assert.deepEqual(armLines.map(arm=>arm[1]),['11','22']);
  assert.equal(armLines[0][2],armLines[1][2]);
  const [phase,suffixes]=rest.split('cf.cond_br');
  assert.ok(phase.includes('"tsfg_core.domain.field_initialize"'));
  const stores=[...suffixes.matchAll(/value = (31|42) : i32[^\n]*\n[^]*?"tsfg_core\.domain\.field_store"[^\n]*/g)];
  assert.deepEqual(stores.map(store=>store[1]),['31','42']);
});



for(const [kind,file,digest] of [
  ['scalar','super-prefix-live-local','dfc44eba7593f4c84c65c5ffbfa0da14d1d7a0aad661db5fa06ce10027a9efa4'],
  ['Array','super-prefix-live-array','8b964015e0253fd14e68f51e706001b6e3562614d45f61470ecf57ef748ab234'],
])test('a shared '+kind+' field initializer preserves each arm-local value',async()=>{
  const {hir,context,publicationContext}=await initializerProof(file,digest);
  const entry=hir.functions.find(row=>row.name==='entry');
  const owner=hir.types.find(row=>row.id===entry.body[0].initializer.type);
  const constructor=hir.functions.find(row=>row.id===owner.constructor);
  const core=lowerFormalHir(hir,context,publicationContext);
  const start=core.indexOf('  func.func @"f'+constructor.id.slice(7)+'"(');
  assert.ok(start>=0);
  const body=core.slice(start,core.indexOf('\n  }',start));
  const blocks=new Map([...body.matchAll(/^  \^(bb\d+)(?:\(([^\n]*)\))?:\n((?:    [^\n]*\n?)+)/gm)]
    .map(([,id,parameters,text])=>[id,{parameters:parameters??'',text}]));
  const arms=[...blocks.values()].filter(block=>block.text.includes('"tsfg_core.domain.super"'));
  assert.equal(arms.length,2);
  const edges=arms.map(({text})=>text.match(/cf\.br \^(bb\d+)\(([^:\n]+) : /));
  assert.equal(edges[0][1],edges[1][1]);
  const join=blocks.get(edges[0][1]);
  const parameters=join.parameters.split(', ').map(parameter=>parameter.split(': ')[0]);
  assert.equal(body.split('"tsfg_core.domain.initialize_fields"').length,2);
  assert.ok(join.text.includes('"tsfg_core.domain.field_initialize"'));
  assert.equal(body.split('"tsfg_core.domain.array_create"').length-1,kind==='Array'?1:0);
  const dispatch=join.text.match(/cf\.cond_br (%v\d+), \^(bb\d+), \^(bb\d+)/);
  assert.equal(dispatch[1],parameters[0]);
  const origin=(text,value)=>{
    const views=new Map([...text.matchAll(/(%v\d+) = "tsfg_core\.domain\.view"\((%v\d+)\)/g)]
      .map(([,result,input])=>[result,input]));
    while(views.has(value))value=views.get(value);
    return value;
  };
  for(const [index,side] of ['then','else'].entries()){
    const prefix=arms[index].text,suffix=blocks.get(dispatch[index+2]).text;
    const call=prefix.match(/"tsfg_core\.domain\.super"\(%v\d+, (%v\d+)\)[^\n]+/);
    const store=suffix.match(/"tsfg_core\.domain\.field_store"\(%v\d+, (%v\d+)\)[^\n]+/);
    const branch=constructor.body[0][side];
    for(const [line,range] of [[call[0],branch[1].expression.range],[store[0],branch[2].expression.range]]){
      assert.ok(line.includes('tsfg_source.start = '+range.start+' : i64'));
      assert.ok(line.includes('tsfg_source.end = '+range.end+' : i64'));
    }
    const values=edges[index][2].trim().split(', ');
    assert.ok(prefix.includes(values[0]+' = "tsfg_core.constant"() {value = '+[1,0][index]+' : i1'));
    const slot=parameters.indexOf(origin(suffix,store[1]));
    assert.ok(slot>0);
    assert.equal(values[slot],call[1]);
    assert.ok(prefix.includes(origin(prefix,call[1])+' = "tsfg_core.constant"() {value = '+[11,22][index]+' : i32'));
  }
});

test('failed super arguments and nested initializer operands stop their own continuation',async()=>{
  const {hir,proofs,phases,context,publicationContext}=await initializerProof('constructor-expression-failures','e5599012fe72a1f0ccd8e33650b66098cbbb41dd2846df89598bb2f80473c1c9');
  const entry=hir.functions.find(row=>row.name==='entry'),nested=hir.functions.find(row=>row.name==='nested');
  const multi=hir.types.find(row=>row.id===entry.body[0].initializer.type);
  const own=phases.find(row=>row.ownerType===multi.id).events[0].output.valueNode;
  const firstArgument=multi.constructor+'/body/0/then/0/expression/arguments/0';
  const skippedWrite=multi.constructor+'/body/0/then/1/expression/value';
  const nestedPhase=phases.find(row=>row.ownerType===nested.body[0].initializer.type);
  const [first,tail]=nestedPhase.events.map(row=>row.output.valueNode);
  for(const plan of [proofs.definition,proofs.reached]){
    assert.equal(plan.arrayReaching.reads.find(row=>row.node===firstArgument)?.status,'missing');
    const inventory=plan.fieldReaching.writes.filter(row=>row.node===skippedWrite);
    assert.equal(inventory.length,1,'the skipped store still has a lexical version for Core');
    const reading=plan.fieldReaching.reads.find(row=>row.node===entry.id+'/body/1/value');
    assert.deepEqual(reading?.reaching.flatMap(row=>row.sources),[own],'only the successful arm contributes its initializer');
    const nestedRead=plan.arrayReaching.reads.find(row=>row.node.startsWith(first+'/'));
    assert.equal(nestedRead?.status,'missing');
    assert.equal(plan.arrayReaching.reads.find(row=>row.node===tail)?.status,'pending');
    assert.ok(!plan.fieldReaching.phaseWrites.some(row=>row.id.startsWith(nestedPhase.constructionId+'/')));
    assert.ok(!plan.fieldReaching.completions.some(row=>row.construction===nestedPhase.constructionId));
    const result=plan.nodes.find(row=>row.id===nested.id+'/return');
    const domain=plan.domains.find(row=>row.id===result.domainId);
    assert.deepEqual(domain.actualTypes,[]);
  }
  const core=lowerFormalHir(hir,context,publicationContext);
  const start=core.indexOf('  func.func @"f'+multi.constructor.slice(7)+'"(');
  assert.ok(start>=0);
  const body=core.slice(start,core.indexOf('\n  }',start));
  const arms=[...body.matchAll(/"tsfg_core\.domain\.super"[^\n]*\n    (%v\d+) = "tsfg_core\.constant"\(\) \{value = ([01]) : i1[^\n]*\n    cf\.br \^(bb\d+)\(\1,/g)];
  assert.deepEqual(arms.map(arm=>arm[2]),['1','0']);
  assert.equal(arms[0][3],arms[1][3]);
  const selector=body.match(new RegExp('^  \\^'+arms[0][3]+'\\((%v\\d+): i1','m'))?.[1];
  assert.ok(selector);
  const initializations=body.split('"tsfg_core.domain.initialize_fields"');
  assert.equal(initializations.length,2);
  const resume=initializations[1].match(new RegExp('cf\\.cond_br '+selector+', \\^(bb\\d+), \\^bb\\d+'));
  assert.ok(resume);
  const continuation=initializations[1].slice(initializations[1].indexOf('\n  ^'+resume[1]+':'));
  assert.match(continuation,/^\n  \^bb\d+:\n(?:(?!  \^)[^\n]*\n)*?    "tsfg_core\.domain\.field_store"/);
});

test('a failed initializer preserves only the effects before its checked read',async()=>{
  const {hir,proofs,phases}=await initializerProof('initializer-effect-prefix','49f2f016b5cab752215451826ba7497eeba97e7388800b447ac9f10da01e0084');
  const entry=hir.functions.find(row=>row.name==='entry');
  const owner=hir.types.find(row=>row.id===entry.body[0].initializer.type);
  const before=hir.functions.find(row=>row.ownerType===owner.id&&row.name==='before');
  const after=hir.functions.find(row=>row.ownerType===owner.id&&row.name==='after');
  assert.ok(before&&after);
  const phase=phases.find(row=>row.ownerType===owner.id);
  const [marker,first,tail]=phase.events.map(row=>row.output.valueNode);
  for(const plan of [proofs.definition,proofs.reached]){
    assert.equal(plan.arrayReaching.reads.find(row=>row.node.startsWith(first+'/'))?.status,'missing');
    assert.equal(plan.arrayReaching.reads.find(row=>row.node===tail)?.status,'pending');
    assert.deepEqual(plan.fieldReaching.phaseWrites.filter(row=>row.id.startsWith(phase.constructionId+'/')).map(row=>row.node),[marker]);
    assert.ok(plan.fieldReaching.callContexts.some(row=>row.target===before.id&&row.fields.length),'receiver reaches the earlier call');
    assert.ok(!plan.fieldReaching.callContexts.some(row=>row.target===after.id&&row.fields.length),'later call receives no state');
    assert.ok(!plan.fieldReaching.completions.some(row=>row.construction===phase.constructionId));
  }
});
