// SPDX-License-Identifier: MIT
// Protocol metadata and marker serialization only. No facts/HIR/Program is
// admitted, generated, executed or claimed by these literal vectors.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,Hash} from 'node:crypto';
import descriptor from '../../contracts/common-program-core-development.json' with {type:'json'};
import fixture from './testdata/receiver-descriptor/operation-contracts.json' with {type:'json'};
import {commonCoreFormat,commonCoreSchema} from '../../compiler/common-program-plan.mjs';
import {appendCommonProgramMarker} from '../../compiler/common-program-core.mjs';
import {commonTextBudget} from '../../compiler/common-program-budget.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

// Handwritten expected signatures come from the frozen receiver interface,
// not from Source lowering, Core reconstruction or the descriptor under test.
test('receiver private4 binds all nine exact independent operation signatures',()=>{
  assert.equal(descriptor.version,4);assert.equal(commonCoreFormat.version,4);
  assert.equal(commonCoreSchema,fixture.schema);
  assert.deepEqual(descriptor.representation.fields,fixture.representationTables);
  assert.equal(descriptor.marker.fields.includes('version:i32=4'),true);
  assert.equal(descriptor.marker.fields.includes('version:i32=3'),false);
  assert.deepEqual(Object.keys(descriptor.receiverProtocol.operations).sort(),
    fixture.operations.map(row=>row.name).sort());
  for(const {name,properties,minOperands:min,maxOperands:max,results,successors}of fixture.operations){
    const shape=descriptor.receiverProtocol.operations[name];
    assert.deepEqual(descriptor.operationProperties[name],properties,name+' property set');
    assert.equal(shape.operands.length,min,name+' required operands');
    assert.equal(shape.operands.length+('optionalOperand' in shape?1:0),max,name+' maximum operands');
    assert.equal(shape.result===null?0:1,results,name+' direct results');
    assert.equal(shape.successors.length,successors,name+' successors');
    if(successors)assert.deepEqual(shape.successors,[
      {completion:'normal',parameters:['selected owner-view value']},
      {completion:'language',parameters:['universal payload']}
    ],name+' channel order and selected payload');
  }
  // These are shape counterexamples, not an assertion that a Core/Runtime
  // reader has been executed or already rejects a constructed Program.
  for(const {name,properties,minOperands:min,maxOperands:max,results,successors}of fixture.invalidShapes){
    const shape=descriptor.receiverProtocol.operations[name];
    assert.notDeepEqual([descriptor.operationProperties[name],shape.operands.length,
      shape.operands.length+('optionalOperand' in shape?1:0),shape.result===null?0:1,shape.successors.length],
      [properties,min,max,results,successors],name+' malformed metadata vector');
  }
});

test('shared C++ declarations and marker reader bind the same private4 profile',async()=>{
  const header=await readFile(new URL('../../compiler/core-ir/common-program.h',import.meta.url),'utf8'),
    parser=await readFile(new URL('../../compiler/core-ir/common-program.cpp',import.meta.url),'utf8');
  assert.ok(header.includes('inline constexpr int32_t profileVersion=4;'));
  assert.ok(header.includes('inline constexpr llvm::StringLiteral schema="'+fixture.schema+'";'));
  assert.ok(parser.includes('version.getInt()!=profileVersion'));
  assert.equal(parser.includes('version.getInt()!=3'),false);
  for(const {name,successors,cppClass:className}of fixture.operations){
    const traits=successors?'mlir::OpTrait::NSuccessors<2>::Impl,mlir::OpTrait::IsTerminator'
      :'mlir::OpTrait::ZeroSuccessors,WholeProgramOnly';
    const expected='TSFG_PROGRAM_OP('+className+',"'+name+'",'+traits+')';
    assert.equal(header.split(expected).length-1,1,name+' has one exact declaration');
  }
  assert.deepEqual(descriptor.receiverProtocol.excludedUses,[
    'actual-type/domain membership','Binding or Cell storage','ordinary user parameters/results',
    'Host arguments/results','closure environments','ordinary value operations'
  ]);
});

test('the real marker serializer prints private4 and hashes only its typed metadata strings',async()=>{
  // Deliberately not passing facts, HIR or Program admission fixtures: the
  // caller-owned serialization boundary accepts already prepared text parts.
  const hir='{"fixture":"metadata-only"}',representation='{"bindings":[],"domains":[],"functions":[],"internalConstructors":[]}',
    publication={fixture:'not-admitted'},request={targets:[]},proof={fixture:'not-admitted'},
    spend=commonMeter(1000000),text=commonTextBudget(spend);
  appendCommonProgramMarker(text,{hir,representation,publication,request,proof},spend);
  const printed=text.finish();
  assert.ok(printed.startsWith(', tsfg_program.program = {family = "tsfg.core-program-development", version = 4 : i32'));
  assert.equal(printed.includes('version = 3 : i32'),false);
  const strings=new Map([...printed.matchAll(/([a-z_]+) = ("(?:\\.|[^"\\])*")/g)]
    .map(/** @returns {[string,string]} */ match=>{
      /** @type {unknown} */ const value=JSON.parse(match[2]);assert.ok(typeof value==='string');
      return [match[1],value];
    }));
  const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
  assert.equal(strings.get('schema'),fixture.schema);
  assert.equal(strings.get('hir'),hir);assert.equal(strings.get('hir_hash'),hash(hir+'\n'));
  assert.equal(strings.get('representation'),representation);
  assert.equal(strings.get('representation_hash'),hash(representation+'\n'));
  for(const [key,expected]of Object.entries({publication,request,proof})){
    const encoded=strings.get(key);assert.ok(encoded!==undefined);assert.deepEqual(JSON.parse(encoded),expected);
  }
  const expected=', tsfg_program.program = {family = "tsfg.core-program-development", version = 4 : i32'
    +Object.entries({schema:fixture.schema,hir,hir_hash:hash(hir+'\n'),representation,
      representation_hash:hash(representation+'\n'),publication:JSON.stringify(publication),
      request:JSON.stringify(request),proof:JSON.stringify(proof)})
      .map(([key,value])=>', '+key+' = '+JSON.stringify(value)).join('')+'}';
  assert.equal(printed,expected,'work prepayment leaves the complete marker bytes unchanged');
});

test('marker formatting keeps the existing shared text-budget failure',()=>{
  const spend=commonMeter(1000000),text=commonTextBudget(spend,32);
  assert.throws(()=>appendCommonProgramMarker(text,{hir:'{}',representation:'{}',
    publication:{},request:{},proof:{}},spend),{code:'r03-common-program-limit'});
});

test('marker work exhaustion happens before either large LF hash begins',t=>{
  // Transparent builtin mocks preserve the real work. These are literal
  // metadata probes, not a Source Program or a replacement hash/serializer.
  const hashed=t.mock.method(Hash.prototype,'update'),encoded=t.mock.method(JSON,'stringify'),large='x'.repeat(10000);
  for(const key of /** @type {const} */(['hir','representation'])){
    hashed.mock.resetCalls();encoded.mock.resetCalls();
    const spend=commonMeter(5000),text=commonTextBudget(spend),parts={hir:'{}',representation:'{}',publication:{},request:{},proof:{}};
    parts[key]=large;
    assert.throws(()=>appendCommonProgramMarker(text,parts,spend),{code:'r03-common-program-limit'});
    assert.ok(encoded.mock.calls.some(call=>call.arguments[0]===commonCoreFormat.family),'prefix fits the same writer budget');
    assert.equal(hashed.mock.calls.some(call=>call.arguments[0]===large+'\n'),false,key+' hash has not started');
    if(key==='representation')assert.ok(hashed.mock.calls.some(call=>call.arguments[0]==='{}\n'),'earlier small hash was prepaid and executed');
  }
});

test('marker work exhaustion happens before a large typed DTO is canonicalized',t=>{
  const encoded=t.mock.method(JSON,'stringify'),large='x'.repeat(10000);
  for(const key of /** @type {const} */(['publication','request','proof'])){
    encoded.mock.resetCalls();
    const spend=commonMeter(5000),text=commonTextBudget(spend),parts={hir:'{}',representation:'{}',publication:{payload:''},request:{payload:''},proof:{payload:''}};
    parts[key]={payload:large};
    assert.throws(()=>appendCommonProgramMarker(text,parts,spend),{code:'r03-common-program-limit'});
    assert.ok(encoded.mock.calls.some(call=>call.arguments[0]===commonCoreFormat.family),'prefix fits the same writer budget');
    assert.equal(encoded.mock.calls.some(call=>call.arguments[0]===large),false,key+' canonical stringify has not started');
  }
});
