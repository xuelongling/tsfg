// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,buildInitialArrayPublication,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';

/** @type {{name:string,fixture:string,sha:string,fn:string,position:string,range?:[number,number],binary?:boolean,productive?:boolean}[]} */
const cases=[
  {name:'a terminal compound old read blocks the RHS sink write and the target writeback',
    fixture:'old-value-terminal',sha:'6a33970814041f757694f14cb3750e8553593de9cf4f77bef2aefa75c150aaca',fn:'compound',position:'expression'},
  {name:'a terminal compound initializer blocks its RHS, local binding and later return',
    fixture:'initializer-old-value-terminal',sha:'a9318de78658057189a4900d6ba7ffc0930a21f13a0b1a06ccb48696e8b6cd4e',fn:'nestedCompound',position:'initializer',range:[184,189]},
  {name:'a terminal compound return blocks the RHS and publishes no normal result',
    fixture:'return-old-value-terminal',sha:'75c966c303c6574b3443fd5a0b69c7aa4244baa8f34c80063cd27308cdd1f0b6',fn:'returnCompound',position:'value',range:[171,176]},
  {name:'a terminal grouped left operand blocks the compound RHS and the later binary sibling',
    fixture:'binary-left-old-value-terminal',sha:'c377fabaeaf36d7da6689fea9291f8445e0e28e2365bf2cf79ce0f6d09a59cef',fn:'binaryMissing',
    position:'initializer',range:[252,257],binary:true},
  {name:'a proved old value preserves both strict binary operands and their effects',
    fixture:'binary-left-old-value-present',sha:'4d733c5e739b0256d52e79fa7736fda4abd8b0990e8cdf4ddb43089408861436',fn:'binaryPresent',
    position:'initializer',range:[255,260],binary:true,productive:true},
];
for(const row of cases)test(row.name,async t=>{
  const bytes=await readFile(new URL('./testdata/typed-array-terminal-compound/'+row.fixture+'-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:'+row.sha);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=buildInitialArrayPublication(context),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built,compound=hir.functions.find(fn=>fn.name===row.fn),mark=hir.functions.find(fn=>fn.name==='mark');
  assert.ok(compound&&mark);
  const later=row.binary?hir.functions.find(fn=>fn.name==='later'):undefined;
  if(row.binary)assert.ok(later);
  const top=compound.id+'/body/2/'+row.position,target=top+(row.binary?'/left/operand':''),old=target+'/old-value';
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
    if(later)normal.push(top,top+'/left',top+'/right');
    if(row.position==='initializer'){
      const local=compound.body[2];
      assert.ok(local.kind==='local'&&local.binding.name==='result');
      normal.push(compound.id+'/binding/'+local.binding.id,compound.id+'/body/3/value');
    }
    if(row.productive&&plan===proofs.reached){
      const parameter=compound.parameters[0],binding=compound.id+'/binding/'+parameter.id;
      const owner=binding+'/entry-owner/'+parameter.type;
      for(const id of [binding,target+'/value/arguments/0',top+'/right/arguments/0']){
        const value=plan.nodes.find(node=>node.id===id);assert.ok(value);
        assert.deepEqual(value.arrayOwners,[owner],id);
      }
    }
    if(!row.productive&&plan===proofs.reached){
      normal.push(sink);
      if(later)normal.push(later.id+'/binding/'+later.parameters[0].id);
    }
    for(const id of normal){
      const value=plan.nodes.find(node=>node.id===id);assert.ok(value);
      assert.deepEqual([value.domainId,value.arrayOwners,value.pending],[normalDomain,[],[]],id);
    }
    assert.equal(plan.carrierNodes.find(row=>row.id===old).domainId,scalar);
    assert.equal(plan.carrierNodes.find(row=>row.id===elements).domainId,normalDomain);
    const writes=plan.arrayReaching.writes,versions=[mark.id+'/body/0/expression/array-version',target+'/array-version'];
    if(row.productive)versions.push(initial);
    if(later)versions.push(later.id+'/body/0/expression/array-version');
    assert.deepEqual(writes.map(row=>row.id).sort(),versions.sort());
    const rhsWrite=writes.find(row=>row.id.startsWith(mark.id));
    assert.equal(source.slice(rhsWrite.origin.start,rhsWrite.origin.end),'sink[0] = 7.0');
    if(later){
      const siblingWrite=writes.find(row=>row.id.startsWith(later.id));
      assert.equal(source.slice(siblingWrite.origin.start,siblingWrite.origin.end),'sink[1] = 9.0');
    }
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
    assert.equal(adds.length,later?2:1);
    const write=occurrence(line=>line.includes('"tsfg_core.domain.array_store"')&&line.includes('array_node = "'+target+'"'));
    const operations=[created,read,rhs,adds[0],write];
    if(later)operations.push(occurrence(line=>line.includes('func.call')&&line.includes('tsfg_core.function_id = "'+later.id+'"')),adds[1]);
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
