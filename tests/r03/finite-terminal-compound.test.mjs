// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,buildInitialArrayPublication,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteArrayReaching} from '../../compiler/finite-array-reaching.mjs';
import {canonical,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';

/** @type {{name:string,fixture:string,sha:string,fn:string,position:string,range?:[number,number],binary?:'left'|'right',productive?:boolean}[]} */
const cases=[
  {name:'a terminal compound old read blocks the RHS sink write and the target writeback',
    fixture:'old-value-terminal',sha:'6a33970814041f757694f14cb3750e8553593de9cf4f77bef2aefa75c150aaca',fn:'compound',position:'expression'},
  {name:'a terminal compound initializer blocks its RHS, local binding and later return',
    fixture:'initializer-old-value-terminal',sha:'a9318de78658057189a4900d6ba7ffc0930a21f13a0b1a06ccb48696e8b6cd4e',fn:'nestedCompound',position:'initializer',range:[184,189]},
  {name:'a terminal compound return blocks the RHS and publishes no normal result',
    fixture:'return-old-value-terminal',sha:'75c966c303c6574b3443fd5a0b69c7aa4244baa8f34c80063cd27308cdd1f0b6',fn:'returnCompound',position:'value',range:[171,176]},
  {name:'a terminal grouped left operand blocks the compound RHS and the later binary sibling',
    fixture:'binary-left-old-value-terminal',sha:'c377fabaeaf36d7da6689fea9291f8445e0e28e2365bf2cf79ce0f6d09a59cef',fn:'binaryMissing',
    position:'initializer',range:[252,257],binary:'left'},
  {name:'a proved old value preserves both strict binary operands and their effects',
    fixture:'binary-left-old-value-present',sha:'4d733c5e739b0256d52e79fa7736fda4abd8b0990e8cdf4ddb43089408861436',fn:'binaryPresent',
    position:'initializer',range:[255,260],binary:'left',productive:true},
  {name:'a prior sink write preserves the terminal old read on the strict right',
    fixture:'binary-right-old-value-terminal',sha:'ae66cf006956a606f38e85da9eb99bff20c2d95d3f6b9cc4dec98819fc95a496',fn:'rightMissing',
    position:'initializer',range:[268,273],binary:'right'},
  {name:'a prior sink write preserves the initial old-value source on the strict right',
    fixture:'binary-right-old-value-present',sha:'5ad521e5a988cbccb3cad4ff12f22425121dee8c67e3019e9836587f005c2c23',fn:'rightPresent',
    position:'initializer',range:[271,276],binary:'right',productive:true},
];
for(const row of cases)test(row.name,async t=>{
  const bytes=await readFile(new URL('./testdata/typed-array-terminal-compound/'+row.fixture+'-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:'+row.sha);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=buildInitialArrayPublication(context),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const earlier=row.binary==='right';
  const {hir}=built,compound=hir.functions.find(fn=>fn.name===row.fn),mark=hir.functions.find(fn=>fn.name===(earlier?'rhs':'mark'));
  assert.ok(compound&&mark);
  const sibling=row.binary?hir.functions.find(fn=>fn.name===(earlier?'earlier':'later')):undefined;
  if(row.binary)assert.ok(sibling);
  const top=compound.id+'/body/2/'+row.position,target=top+(row.binary?'/'+row.binary+'/operand':''),old=target+'/old-value';
  const siblingNode=top+(earlier?'/left':'/right');
  const array=compound.id+'/body/0/initializer',elements=array+'/elements';
  const sink=mark.id+'/binding/'+mark.parameters[0].id,initial=array+'/initial/0/array-version';
  const bottom=sha256('tsfg.actual-domain.v1\0[]'),scalar=sha256('tsfg.actual-domain.v1\0'+canonical([compound.returnType.id]));
  const normalDomain=row.productive?scalar:bottom;
  const source=facts.payload.files.find(row=>row.path===compound.sourcePath).content;
  const proofs=buildFiniteCoreDomains(hir,context,{publicationContext:publication});
  for(const plan of [proofs.reached,proofs.definition]){
    assert.equal(plan.arrayReaching.reads.length,1);
    const [read]=plan.arrayReaching.reads;
    assert.deepEqual([read.node,read.owner,read.index,read.status,read.versions,read.sources],
      [old,array,'c:0',row.productive?'proven':'missing',row.productive?[initial]:[],row.productive?[elements+'/0']:[]]);
    assert.equal(source.slice(read.origin.start,read.origin.end),'a[at]');
    if(row.range)assert.deepEqual(read.origin,{source:'/src/main.ts',start:row.range[0],end:row.range[1]});
    const normal=[old,target,target+'/value',elements,compound.id+'/return'];
    if(row.binary)normal.push(top,top+'/'+row.binary);
    if(sibling&&!earlier)normal.push(siblingNode);
    if(row.position==='initializer'){
      const local=compound.body[2];
      assert.ok(local.kind==='local'&&local.binding.name==='result');
      normal.push(compound.id+'/binding/'+local.binding.id,compound.id+'/body/3/value');
    }
    if(earlier){
      const value=plan.nodes.find(node=>node.id===siblingNode);assert.ok(value);
      assert.deepEqual([value.domainId,value.arrayOwners,value.pending],[scalar,[],[]],siblingNode);
    }
    if((row.productive||earlier)&&plan===proofs.reached){
      const parameter=compound.parameters[0],binding=compound.id+'/binding/'+parameter.id;
      const owner=binding+'/entry-owner/'+parameter.type;
      const arguments_=[binding,siblingNode+'/arguments/0'];
      if(row.productive)arguments_.push(target+'/value/arguments/0');
      if(earlier&&sibling)arguments_.push(sibling.id+'/binding/'+sibling.parameters[0].id);
      for(const id of arguments_){
        const value=plan.nodes.find(node=>node.id===id);assert.ok(value);
        assert.deepEqual(value.arrayOwners,[owner],id);
      }
    }
    if(!row.productive&&plan===proofs.reached){
      normal.push(sink);
      if(sibling&&!earlier)normal.push(sibling.id+'/binding/'+sibling.parameters[0].id);
    }
    for(const id of normal){
      const value=plan.nodes.find(node=>node.id===id);assert.ok(value);
      assert.deepEqual([value.domainId,value.arrayOwners,value.pending],[normalDomain,[],[]],id);
    }
    assert.equal(plan.carrierNodes.find(row=>row.id===old).domainId,scalar);
    assert.equal(plan.carrierNodes.find(row=>row.id===elements).domainId,normalDomain);
    const writes=plan.arrayReaching.writes,versions=[mark.id+'/body/0/expression/array-version',target+'/array-version'];
    if(row.productive)versions.push(initial);
    if(sibling)versions.push(sibling.id+'/body/0/expression/array-version');
    assert.deepEqual(writes.map(row=>row.id).sort(),versions.sort());
    const rhsWrite=writes.find(row=>row.id.startsWith(mark.id));
    assert.equal(source.slice(rhsWrite.origin.start,rhsWrite.origin.end),earlier?'sink[1] = 9.0':'sink[0] = 7.0');
    if(sibling){
      const siblingWrite=writes.find(row=>row.id.startsWith(sibling.id));
      assert.equal(source.slice(siblingWrite.origin.start,siblingWrite.origin.end),earlier?'sink[0] = 7.0':'sink[1] = 9.0');
    }
  }

  if(row.binary==='left') {
    const local=compound.body[2],original=local.initializer,returned=compound.body[3];
    assert.equal(original.left.operand.kind,'arrayCompoundAssignment');
    const {receiver,index,type,range}=original.left.operand.target;
    // Component exercise using the same checked array operand and source range.
    const tail={kind:'arrayReadChecked',receiver,index,type,range};
    const compare={...original,operator:'===',type:scalarTypeIds.bool};
    const flag={kind:'boolean',value:true,type:scalarTypeIds.bool,range:original.range};
    for(const operator of ['&&','||','??']){
      const numeric=operator==='??',base=compound.id+'/body/2/expression';
      const expression={...original,kind:'shortCircuit',operator,left:numeric?original.left:compare,
        right:numeric?original.right:flag,type:numeric?type:scalarTypeIds.bool};
      const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const site=base+(numeric?'/left/operand':'/left/left/operand'),terminal=site+'/old-value';
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[terminal],operator);
      assert.equal(reaching.reads.find(read=>read.node===terminal)?.status,row.productive?'proven':'missing',operator);
      assert.equal(reaching.reads.find(read=>read.node===compound.id+'/body/3/value')?.status,row.productive?'proven':'pending',operator);
      assert.ok(reaching.writes.some(write=>write.id===site+'/array-version'),operator);
    }
    const sinkArgument=original.left.operand.value.arguments[0];
    const unknown={...compare,left:{kind:'arrayLength',receiver:sinkArgument,type:index.type,range:index.range},right:index};
    const base=compound.id+'/body/2/expression',site=base+'/right/left/operand',old=site+'/old-value';
    for(const operator of ['&&','||'])for(const route of ['required','skipped','possible'])
      await t.test(operator+' RHS '+route,()=>{
        const left=route==='possible'?unknown:{...flag,value:(operator==='&&')===(route==='required')};
        const expression={...original,kind:'shortCircuit',type:scalarTypeIds.bool,operator,left,right:compare};
        const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
        const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
        const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
        assert.deepEqual([...terminalReads??[]],route==='required'&&!row.productive?[old]:[]);
        const oldRead=reaching.reads.find(read=>read.node===old),after=reaching.reads.find(read=>read.node===compound.id+'/body/3/value');
        assert.equal(oldRead?.status,route==='skipped'?'pending':row.productive?'proven':'missing');
        assert.equal(after?.status,row.productive?'proven':route==='required'?'pending':'missing');
        if(row.productive)assert.deepEqual(after?.versions,
          (route==='required'?[site+'/array-version']:route==='skipped'?[initial]:[initial,site+'/array-version']).sort());
        for(const version of [site+'/array-version',mark.id+'/body/0/expression/array-version',sibling.id+'/body/0/expression/array-version'])
          assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
      });
    await t.test('a required if condition controls both arms and the suffix',()=>{
      const arm=[{kind:'expression',expression:tail,range:tail.range}];
      const branch={kind:'if',condition:compare,then:arm,else:arm,range:local.range};
      const fn={...compound,body:[...compound.body.slice(0,2),branch,{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',target=root+'/2/condition/left/operand',failed=target+'/old-value';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[failed]);
      const oldRead=reaching.reads.find(read=>read.node===failed);
      assert.equal(oldRead?.status,row.productive?'proven':'missing');
      assert.equal(source.slice(oldRead.origin.start,oldRead.origin.end),'a[at]');
      for(const path of ['/2/then/0/expression','/2/else/0/expression','/3/value']) {
        const read=reaching.reads.find(read=>read.node===root+path);
        assert.equal(read?.status,row.productive?'proven':'pending',path);
        assert.deepEqual(read?.versions,row.productive?[target+'/array-version']:[],path);
      }
      for(const version of [target+'/array-version',mark.id+'/body/0/expression/array-version',sibling.id+'/body/0/expression/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
    await t.test('a terminal Array element prevents later elements and the resulting Array',()=>{
      const created=compound.body[0].initializer;
      assert.ok(created.kind==='arrayCreate'&&receiver.kind==='reference');
      const later={...original,left:original.right,right:tail};
      const literal={...created,elements:[original.left,later],range:original.range};
      const stored={...local,binding:{...local.binding,type:literal.type},initializer:literal};
      const resultRead={...tail,receiver:{...receiver,binding:stored.binding.id,type:literal.type}};
      const fn={...compound,body:[...compound.body.slice(0,2),stored,{...returned,value:resultRead}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',literalPath=root+'/2/initializer';
      const old=literalPath+'/elements/0/operand/old-value';
      const initialized=[0,1].map(index=>literalPath+'/initial/'+index+'/array-version');
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
      assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
      const laterRead=reaching.reads.find(read=>read.node===literalPath+'/elements/1/right');
      assert.equal(laterRead?.status,row.productive?'proven':'pending');
      const after=reaching.reads.find(read=>read.node===root+'/3/value');
      assert.equal(after?.status,row.productive?'proven':'pending');
      assert.deepEqual(after?.versions,row.productive?[initialized[0]]:[]);
      for(const version of [...initialized,mark.id+'/body/0/expression/array-version',sibling.id+'/body/0/expression/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
    await t.test('local assignment publishes its new Array only after the RHS completes',()=>{
      const created=compound.body[0].initializer;
      assert.ok(created.kind==='arrayCreate'&&receiver.kind==='reference');
      const declared={...local,binding:{...local.binding,type:created.type,writable:true},initializer:receiver};
      const target={...receiver,binding:declared.binding.id};
      const value={...created,elements:[original.left,tail],range:original.range};
      const assignment={kind:'expression',expression:{kind:'assignment',target,value,type:created.type,range:original.range},range:local.range};
      const fn={...compound,body:[...compound.body.slice(0,2),declared,assignment,{...returned,value:{...tail,receiver:target}}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',rhs=root+'/3/expression/value',old=rhs+'/elements/0/operand/old-value';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
      assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
      assert.equal(reaching.reads.find(read=>read.node===rhs+'/elements/1')?.status,row.productive?'proven':'pending');
      const after=reaching.reads.find(read=>read.node===root+'/4/value');
      assert.equal(after?.status,row.productive?'proven':'pending');
      assert.deepEqual(after?.versions,row.productive?[rhs+'/initial/0/array-version']:[]);
      for(const version of [rhs+'/elements/0/operand/array-version',rhs+'/initial/0/array-version',rhs+'/initial/1/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
    await t.test('a dense Array store publishes its slot only after the RHS completes',()=>{
      const dense={kind:'arrayStoreDenseChecked',target:original.left.operand.target,
        value:original.left,type,range:original.range};
      const assignment={kind:'expression',expression:dense,range:local.range};
      const fn={...compound,body:[...compound.body.slice(0,2),assignment,{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',outer=root+'/2/expression',inner=outer+'/value/operand',old=inner+'/old-value';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
      assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
      const after=reaching.reads.find(read=>read.node===root+'/3/value');
      assert.equal(after?.status,row.productive?'proven':'pending');
      assert.deepEqual(after?.versions,row.productive?[outer+'/array-version']:[]);
      for(const version of [inner+'/array-version',outer+'/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
    for(const wrapper of ['plain','group','assertType','nonNull'])await t.test(`a definite checked Array read failure under ${wrapper} blocks a later dense store`,()=>{
      const value=mark.body[1].value;
      assert.ok(value.kind==='floating');
      const dense={kind:'arrayStoreDenseChecked',target:original.left.operand.target,value,type,range:original.range};
      const expression=wrapper==='plain'?tail:{kind:wrapper,type:tail.type,range:tail.range,operand:tail};
      const first={kind:'expression',expression,range:tail.range};
      const store={kind:'expression',expression:dense,range:local.range};
      const fn={...compound,body:[...compound.body.slice(0,2),first,store,{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',written=root+'/3/expression/array-version';
      const readPath=root+'/2/expression'+(wrapper==='plain'?'':'/operand');
      const before=reaching.reads.find(read=>read.node===readPath);
      const after=reaching.reads.find(read=>read.node===root+'/4/value');
      assert.ok(before&&after);
      assert.deepEqual([before.status,before.versions],row.productive?['proven',[initial]]:['missing',[]]);
      assert.deepEqual([after.status,after.versions],row.productive?['proven',[written]]:['pending',[]]);
      assert.ok(reaching.writes.some(write=>write.id===written),'lexical write remains recorded');
      assert.equal(terminalReads,null,'ordinary reads do not add a compound old-value record');
    });
    for(const kind of ['read','store','compound','update'])for(const failed of ['receiver','index'])
      await t.test(`an Array ${kind} stops after its ${failed} fails`,()=>{
        const created=compound.body[0].initializer,constant=mark.body[1].value;
        assert.ok(created.kind==='arrayCreate'&&constant.kind==='floating');
        const literal=elements=>({...created,elements,range:original.range});
        const operandReceiver=literal(failed==='receiver'?[original.left,tail]:[constant,constant]);
        const operandIndex={kind:'arrayLength',receiver:literal(failed==='receiver'?[tail]:[original.left]),
          type:index.type,range:index.range};
        const targetOperand={...original.left.operand.target,receiver:operandReceiver,index:operandIndex};
        const expression={
          read:{...tail,receiver:operandReceiver,index:operandIndex},
          store:{kind:'arrayStoreDenseChecked',target:targetOperand,value:tail,type,range:original.range},
          compound:{...original.left.operand,target:targetOperand,value:tail},
          update:{kind:'arrayUpdate',target:targetOperand,operator:'++',prefix:true,type,range:original.range},
        }[kind];
        const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
        const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
        const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
        const root=compound.id+'/body',outer=root+'/2/expression',target=outer+(kind==='read'?'':'/target'),
          left=target+'/receiver',right=target+'/index/receiver',inner=(failed==='receiver'?left:right)+'/elements/0/operand',
          old=inner+'/old-value';
        assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
        assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
        const afterOperands={read:[outer],store:[outer+'/value'],compound:[outer+'/old-value',outer+'/value'],
          update:[outer+'/old-value']}[kind];
        for(const path of [...afterOperands,root+'/3/value',
          ...(failed==='receiver'?[left+'/elements/1',right+'/elements/0']:[])]) {
          assert.equal(reaching.reads.find(read=>read.node===path)?.status,row.productive?'proven':'pending',path);
        }
        const versions=[inner+'/array-version',left+'/initial/0/array-version',left+'/initial/1/array-version',right+'/initial/0/array-version'];
        if(kind!=='read')versions.push(outer+'/array-version');
        for(const version of versions)assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
      });
    for(const outerHasValue of [false,true])await t.test(
      outerHasValue?'a compound RHS failure prevents the outer write':'a compound old read failure precedes its RHS',()=>{
        const created=compound.body[0].initializer,constant=mark.body[1].value;
        assert.ok(created.kind==='arrayCreate'&&constant.kind==='floating'&&receiver.kind==='reference');
        const initialized={...created,elements:outerHasValue?[constant]:[]};
        const stored={...local,binding:{...local.binding,type:created.type},initializer:initialized};
        const targetReceiver={...receiver,binding:stored.binding.id,type:created.type};
        const operation=original.left.operand,target={...operation.target,receiver:targetReceiver};
        const expression={...operation,target,value:original.left};
        const assignment={kind:'expression',expression,range:local.range};
        const fn={...compound,body:[...compound.body.slice(0,2),stored,assignment,{...returned,value:{...tail,receiver:targetReceiver}}]};
        const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
        const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
        const root=compound.id+'/body',outer=root+'/3/expression',inner=outer+'/value/operand';
        const outerOld=outer+'/old-value',innerOld=inner+'/old-value';
        const expectedTerminal=outerHasValue?(row.productive?[]:[innerOld]):[outerOld];
        assert.deepEqual([...terminalReads??[]],expectedTerminal);
        assert.equal(reaching.reads.find(read=>read.node===outerOld)?.status,outerHasValue?'proven':'missing');
        assert.equal(reaching.reads.find(read=>read.node===innerOld)?.status,
          outerHasValue?(row.productive?'proven':'missing'):'pending');
        const suffix=reaching.reads.find(read=>read.node===root+'/4/value');
        assert.equal(suffix?.status,expectedTerminal.length?'pending':'proven');
        assert.deepEqual(suffix?.versions,expectedTerminal.length?[]:[outer+'/array-version']);
        for(const version of [outer+'/array-version',inner+'/array-version'])
          assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
      });
    for(const side of ['receiver','value'])await t.test(`Array resize preserves the first failure in its ${side}`,()=>{
      const created=compound.body[0].initializer,constant=mark.body[1].value;
      assert.ok(created.kind==='arrayCreate'&&constant.kind==='floating');
      const literal=elements=>({...created,elements,range:original.range});
      const marker={...tail,receiver:literal([constant])};
      const first=literal(side==='receiver'?[original.left,constant]:[original.right,marker]);
      const second=literal(side==='value'?[original.left]:[original.right,marker]);
      const value={kind:'arrayLength',receiver:second,type:index.type,range:index.range};
      const expression={kind:'arrayResizeChecked',target:{receiver:first,type:index.type,range:local.range},
        value,type:index.type,range:original.range};
      const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',outer=root+'/2/expression',target=outer+'/target/receiver',rhs=outer+'/value/receiver';
      const inner=(side==='receiver'?target:rhs)+'/elements/0/operand',markerPath=(side==='receiver'?rhs:target)+'/elements/1';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[inner+'/old-value']);
      assert.equal(reaching.reads.find(read=>read.node===markerPath)?.status,row.productive||side==='value'?'proven':'pending');
      assert.equal(reaching.reads.find(read=>read.node===root+'/3/value')?.status,row.productive?'proven':'pending');
      assert.ok(reaching.writes.some(write=>write.id===inner+'/array-version'));
    });
    await t.test('a failed call input prevents later input reads and the caller continuation',()=>{
      const call=original.right;
      assert.equal(call.kind,'call');
      const parameters=[...sibling.parameters,...['first','second'].map(name=>({...local.binding,id:local.binding.id+'/'+name,name}))];
      const callee={...sibling,parameters};
      const expression={...call,arguments:[...call.arguments,original.left,tail]};
      const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item===sibling?callee:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',callPath=root+'/2/expression';
      const site=callPath+'/arguments/'+call.arguments.length+'/operand',old=site+'/old-value';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
      assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
      for(const path of [callPath+'/arguments/'+(call.arguments.length+1),root+'/3/value']) {
        const read=reaching.reads.find(item=>item.node===path);
        assert.equal(read?.status,row.productive?'proven':'pending',path);
        assert.deepEqual(read?.versions,row.productive?[site+'/array-version']:[],path);
      }
      for(const version of [site+'/array-version',sibling.id+'/body/0/expression/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
  }

  /** @param {string} text */
  const checkBody=text=>{
    const symbol='f'+compound.id.slice(7),lines=text.split(/\r?\n/);
    const start=lines.findIndex(line=>line.includes('func.func @'+symbol+'(')||line.includes('func.func @"'+symbol+'"(')
      ||line.startsWith('  "func.func"()')&&line.includes('sym_name = "'+symbol+'"'));
    assert.ok(start>=0);
    const end=lines.findIndex((line,index)=>index>start&&/^  }(?:\)|$)/.test(line));
    assert.ok(end>start);
    const body=lines.slice(start,end);
    /** @param {(line:string)=>boolean} matches */
    const occurrence=matches=>{
      const found=body.filter(matches);
      assert.equal(found.length,1);
      return found[0];
    };
    const created=occurrence(line=>line.includes('"tsfg_core.domain.array_create"'));
    assert.ok(created.includes('element_domain = "'+normalDomain+'"'));
    assert.equal(created.includes('"tsfg_core.domain.array_create"()'),!row.productive);
    assert.equal(created.includes('array_versions = "[]"'),!row.productive);
    const read=occurrence(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes('array_node = "'+old+'"'));
    assert.match(read,/ -> f64$/);
    const rhs=occurrence(line=>line.includes('func.call')&&line.includes('tsfg_core.function_id = "'+mark.id+'"'));
    const adds=body.filter(line=>line.includes('"tsfg_core.add"'));
    assert.equal(adds.length,sibling?2:1);
    const write=occurrence(line=>line.includes('"tsfg_core.domain.array_store"')&&line.includes('array_node = "'+target+'"'));
    const operations=[created,read,rhs,adds[0],write];
    if(sibling){
      const call=occurrence(line=>line.includes('func.call')&&line.includes('tsfg_core.function_id = "'+sibling.id+'"'));
      if(earlier)operations.splice(1,0,call);
      else operations.push(call);
      operations.push(adds[1]);
    }
    const order=operations.map(line=>body.indexOf(line));
    assert.ok(order.every((position,index)=>index===0||order[index-1]<position));
  };
  const core=lowerFormalHir(hir,context,publication);
  checkBody(core);
  if(process.env.TSFG_CORE_IR_EXE)await t.test('both static modes retain the original checked occurrence and lexical effect order',async()=>{
    const canonicalized=await invokeCore(core);
    accepted(canonicalized);
    checkBody(canonicalized.stdout.toString('utf8'));
    const optimized=await invokeCore(core,'--optimize');
    accepted(optimized);
    assert.deepEqual(optimized.stdout,canonicalized.stdout);
  });
});

for(const row of [
  {fn:'fieldMissing',fixture:'field-tail-old-value-terminal',sha:'72338395d763abcaed19e6886b03f90849096e8a7a24fe137e82cfa62e7761ce',present:false,delta:0},
  {fn:'fieldPresent',fixture:'field-tail-old-value-present',sha:'2fb8044049a7022e1d54520e70308202841a1240aee352a73e8f2cbdde930376',present:true,delta:3},
  {fn:'fieldMissing',fixture:'field-write-tail-old-value-terminal',sha:'0ef476873a1b30b76238fdcb39de9a0d46c5fe2589b32c030f67b89f89a2769c',present:false,delta:0,write:true},
  {fn:'fieldPresent',fixture:'field-write-tail-old-value-present',sha:'22e3d52a15925f440446bd49b7ff7b9381d904c8c449b7e17f6c89069701f2c7',present:true,delta:3,write:true},
])test('a mixed compound old read preserves only normal field flow: '+row.fixture,async t=>{
  const bytes=await readFile(new URL('./testdata/typed-array-terminal-compound/'+row.fixture+'-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:'+row.sha);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=buildInitialArrayPublication(context),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built,fn=hir.functions.find(fn=>fn.name===row.fn),rhs=hir.functions.find(fn=>fn.name==='rhs');
  const box=hir.types.find(type=>type.kind==='reference'&&type.nominalKey?.declarationPath[0]==='Box');
  assert.ok(fn&&rhs&&box?.kind==='reference');
  const field=box.fields.find(field=>field.name==='n'),constructor=hir.functions.find(fn=>fn.construction===box.construction.id);
  assert.ok(field&&constructor);
  const body=fn.id+'/body',target=body+'/3/expression',old=target+'/old-value',array=body+'/1/initializer';
  const tail=body+(row.write?'/5/value':'/4/value');
  const write=body+'/4/expression',writeValue=write+'/value',writeVersion=write+'/field-version/'+box.id+'/'+field.id;
  const tailOffset=(row.write?282:267)+row.delta;
  const f64=sha256('tsfg.actual-domain.v1\0'+canonical([fn.returnType.id])),bottom=sha256('tsfg.actual-domain.v1\0[]');
  const normal=row.present?f64:bottom,proofs=buildFiniteCoreDomains(hir,context,{publicationContext:publication});
  for(const plan of [proofs.reached,proofs.definition]){
    const read=plan.arrayReaching.reads.find(read=>read.node===old);
    assert.deepEqual([read.owner,read.index,read.status,read.versions,read.sources,read.origin],
      [array,'c:0',row.present?'proven':'missing',row.present?[array+'/initial/0/array-version']:[],
        row.present?[array+'/elements/0']:[],{source:'/src/main.ts',start:238+row.delta,end:243+row.delta}]);
    const phase=plan.fieldReaching.phaseWrites.find(write=>write.field===field.id&&write.state==='initialized');
    assert.ok(phase);
    const parameter=constructor.id+'/binding/'+constructor.parameters[1].id;
    assert.deepEqual([phase.node,phase.actualTypes],[parameter,[box.id]]);
    if(row.write)assert.deepEqual(plan.fieldReaching.writes,[{id:writeVersion,node:writeValue,actualType:box.id,field:field.id,
      origin:{source:'/src/main.ts',start:260+row.delta,end:271+row.delta}}]);
    const successful=plan.fieldReaching.reads.find(read=>read.node===tail);
    if(row.present)assert.deepEqual(successful.reaching,[{actualType:box.id,field:field.id,
      versions:[row.write?writeVersion:phase.id],sources:[row.write?writeValue:parameter]}]);
    else assert.equal(successful,undefined);
    assert.deepEqual(plan.carrierFields.find(value=>value.id===tail).targets.map(value=>value.fieldId),[field.id]);
    const actual=[array+'/elements',old,target+'/value',tail,fn.id+'/return'];
    if(row.write)actual.push(writeValue);
    if(!row.present&&plan===proofs.reached)actual.push(rhs.id+'/binding/'+rhs.parameters[0].id);
    for(const id of actual){
      const value=plan.nodes.find(node=>node.id===id);
      assert.deepEqual([value.domainId,value.pending,value.arrayOwners],[normal,[],[]],id);
    }
    assert.deepEqual(plan.arrayReaching.writes.filter(write=>write.kind==='store').map(write=>write.id).sort(),
      [rhs.id+'/body/0/expression/array-version',target+'/array-version'].sort());
  }
  // The terminal path keeps its lexical field dispatch and checked operation.
  /** @param {string} text */
  function check(text){
    const lines=text.split(/\r?\n/);
    /** @param {(line:string)=>boolean} matches */
    const occurrence=matches=>{const found=lines.filter(matches);assert.equal(found.length,1);return found[0];};
    const receiver=occurrence(line=>line.includes('"tsfg_core.domain.construct"'));
    const oldRead=occurrence(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes('array_node = "'+old+'"'));
    const call=occurrence(line=>line.includes('func.call')&&line.includes('tsfg_core.function_id = "'+rhs.id+'"'));
    const store=occurrence(line=>line.includes('"tsfg_core.domain.array_store"')&&line.includes('array_node = "'+target+'"'));
    const readField=occurrence(line=>line.includes('"tsfg_core.domain.field_read"'));
    assert.ok(readField.includes('field_dispatch')&&readField.includes(field.id));
    assert.ok(readField.includes('tsfg_source.start = '+tailOffset+' : i64')&&readField.includes('tsfg_source.end = '+(tailOffset+5)+' : i64'));
    assert.equal(readField.includes('field_reaching'),row.present);
    const operations=[receiver,oldRead,call,store];
    if(row.write){
      const fieldStore=occurrence(line=>line.includes('"tsfg_core.domain.field_store"'));
      assert.ok(fieldStore.includes('field_versions')&&fieldStore.includes(writeVersion));
      operations.push(fieldStore);
    }
    operations.push(readField);
    const order=operations.map(line=>lines.indexOf(line));
    assert.ok(order.every((index,position)=>position===0||index>order[position-1]));
  }
  const core=lowerFormalHir(hir,context,publication);check(core);
  if(process.env.TSFG_CORE_IR_EXE)await t.test('static Core verifies original lexical order and field authority',async()=>{
    const base=await invokeCore(core);accepted(base);check(base.stdout.toString('utf8'));
    const optimized=await invokeCore(core,'--optimize');accepted(optimized);assert.deepEqual(optimized.stdout,base.stdout);
  });
});
