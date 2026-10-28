// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256} from '../../compiler/identity.mjs';

test('actual pure as payload survives local aliases, parameter-property storage and current field return',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-source514/d6f038213a47b7ddee00213fda2dabbaa629cfc0ae30a001433d48b5a7b3488b-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:777eb4d42d235a6a4d53ac974e7b13f0d88e0f28dcbf37eeac9ff5659cd5b34e');
  const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(row=>row.path===facts.payload.rootFile);
  assert.equal(sha256(source.content),'sha256:d6f038213a47b7ddee00213fda2dabbaa629cfc0ae30a001433d48b5a7b3488b');
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir,fn=hir.functions.find(row=>row.name==='f'),types=new Map(hir.types.map(row=>[row.id,row]));
  const owner=hir.types.find(row=>row.kind==='reference'),field=owner.fields[0],ctor=hir.functions.find(row=>row.id===owner.constructor);
  const assertion=fn.body[0].initializer,alias=fn.body[1],construction=fn.body[2].initializer;
  assert.equal(assertion.kind,'assertType');assert.equal(assertion.operand.kind,'arrayReadChecked');
  for(const id of [assertion.type,fn.body[0].binding.type,alias.binding.type,field.type,fn.returnType.id])assert.equal(types.get(id).kind,'undefined');
  assert.equal(alias.initializer.binding,fn.body[0].binding.id);assert.equal(construction.arguments[0].binding,alias.binding.id);
  const formal=ctor.id+'/binding/'+field.parameterBinding,read=fn.id+'/body/0/initializer/operand';
  const paths=[read,fn.id+'/body/0/initializer',fn.id+'/binding/'+fn.body[0].binding.id,
    fn.id+'/body/1/initializer',fn.id+'/binding/'+alias.binding.id,fn.id+'/body/2/initializer/arguments/0',
    formal,'field/'+owner.id+'/'+field.id,fn.id+'/body/3/value',fn.id+'/return'];
  const plans=buildFiniteCoreDomains(hir,context);
  for(const plan of [plans.reached,plans.definition]){
    const carriers=paths.map(id=>plan.carrierNodes.find(row=>row.id===id));assert.ok(carriers.every(Boolean));
    assert.equal(new Set(carriers.map(row=>row.domainId)).size,1);
    const domain=plan.domains.find(row=>row.id===carriers[0].domainId);
    assert.deepEqual(new Set(domain.actualTypes.map(id=>types.get(id).name)),new Set(['i32','undefined']));
    assert.equal(domain.representation,'finite-union');assert.equal(domain.tagBytes,2);assert.equal(domain.byteSize,8);
    assert.equal(plan.abi.find(row=>row.functionId===fn.id).result,domain.id);
    const parameter=ctor.parameters.findIndex(row=>row.id===field.parameterBinding);
    assert.equal(plan.abi.find(row=>row.functionId===ctor.id).parameters[parameter],domain.id);
    const reaching=plan.fieldReaching.reads.find(row=>row.node===fn.id+'/body/3/value').reaching;
    assert.equal(reaching.length,1);assert.deepEqual(reaching[0].sources,[formal]);
    const version=plan.fieldReaching.phaseWrites.find(row=>row.node===formal&&row.field===field.id);
    assert.equal(version.state,'initialized');assert.deepEqual(reaching[0].versions,[version.id]);
    const orderedRead=plan.arrayReaching.reads.find(row=>row.node===read);
    assert.equal(orderedRead.status,'pending');assert.deepEqual(orderedRead.versions,[]);assert.deepEqual(orderedRead.sources,[]);
    // Source obligations survive each alias and field transfer; carrier tags
    // cannot invent a productive external Array cell/version proof.
    const obligation=plan.nodes.find(row=>row.id===read).pending;
    assert.ok(obligation.length>0);
    for(const id of paths)assert.deepEqual(plan.nodes.find(row=>row.id===id).pending,obligation);
  }
  assert.deepEqual(verifyHir(hir,context),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
  const core=lowerFormalHir(hir,context),lines=core.split('\n').filter(line=>!line.startsWith('module attributes'));
  const assigned=lines.filter(line=>line.trim().startsWith('%')&&line.includes(' = "'));
  assert.deepEqual(assigned.map(line=>line.match(/= "([^"]+)"/)[1]),
    ['tsfg_core.domain.array_read','tsfg_core.domain.view','tsfg_core.domain.construct','tsfg_core.domain.field_read']);
  const [readOp,viewOp,constructOp,fieldOp]=assigned,results=assigned.map(line=>line.trim().split(' = ')[0]);
  const domain=plans.definition.abi.find(row=>row.functionId===fn.id).result;
  assert.ok(viewOp.includes('('+results[0]+')'));assert.ok(constructOp.includes('('+results[1]+')'));assert.ok(fieldOp.includes('('+results[2]+')'));
  for(const line of [readOp,viewOp,fieldOp])assert.ok(line.includes('domain = "'+domain+'"'));
  assert.ok(viewOp.endsWith(': (!tsfg_core.domain<"'+domain+'">) -> !tsfg_core.domain<"'+domain+'">'));
  assert.ok(lines.some(line=>line.includes('"func.return"('+results[3]+')')&&line.includes('!tsfg_core.domain<"'+domain+'">')));
  const initialize=lines.find(line=>line.includes('"tsfg_core.domain.field_initialize"'));
  assert.ok(initialize.includes('(%v0, %v1)'));assert.ok(initialize.includes('input_domain = "'+domain+'"'));
});
