// SPDX-License-Identifier: MIT
// Qualified complete Source facts exercise var lifetime, not let-like row storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,readCommonProgramHir,printCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {commonProgramPlan} from '../../compiler/common-program-plan.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {canonical} from '../../compiler/identity.mjs';
const cases=[
  {
    "name": "no-init",
    "bytes": 12430,
    "sha": "5f1e1bc974e77bdbf5d2afe148a855fb7f88012dc2de88e44ade8ee33ae5d8ea",
    "sourceSHA": "b70db868135e3ec4261408a8ad369ec79bd37c532f9d6406661e378232753541",
    "declaredType": "union<i32,undefined>",
    "varCount": 1,
    "assignments": 0,
    "parameter": false
  },
  {
    "name": "redeclared",
    "bytes": 13377,
    "sha": "5c4a967450443954e9368e9bdf04de6eb8a36c017425c20c5ad8f7c904439bd8",
    "sourceSHA": "30cef2397f498fd781e8b080949ef48bf62325071e2fe5dbc2d37325bebd1a40",
    "declaredType": "union<i32,undefined>",
    "varCount": 3,
    "assignments": 2,
    "parameter": false
  },
  {
    "name": "parameter-redeclared",
    "bytes": 12735,
    "sha": "52c3124f60e21a9ea82fe74122c4e360378d8c4af64987025abd4d2c77dc86bb",
    "sourceSHA": "b083d4fd5c81b32dff758b4a3e9ff0822c603f6812ad21e8dec19965a273cd98",
    "declaredType": "union<i32,undefined>",
    "varCount": 1,
    "assignments": 0,
    "parameter": true
  },
  {
    "name": "shadowed-owner",
    "bytes": 15881,
    "sha": "91ccd1539d95ef32125bc69621ab9311b2e2ae643fce14dca6e8300fc5b2f51c",
    "sourceSHA": "9fef2b5903ed5d5ba37a0485c367101c0b99b916d118b9e1229209e663a6c040",
    "declaredType": "union<i32,undefined>",
    "varCount": 1,
    "assignments": 1,
    "parameter": false
  },
  {
    "name": "inferred-parameter",
    "bytes": 11437,
    "sha": "fc657afe69ac858cbbd85d588ab4d07bfdcfff1ebbf0dd06bcb70504a02fb826",
    "sourceSHA": "87fa6d05ef6667cfb968411a81475577e8d7701067596af97f105b67b8908901",
    "declaredType": "i32",
    "varCount": 1,
    "assignments": 1,
    "parameter": false
  },
  {
    "name": "inferred-narrowed",
    "bytes": 12249,
    "sha": "aba4c1cfc9ca5dbbf1b4fb19f7a3ed3e7f7be6ad51ee1a74e0470973e815f177",
    "sourceSHA": "ec9e1172614554edbcffd3eaab940ee23c8140fc533ce1795f34688b80aa30fe",
    "declaredType": "i32",
    "varCount": 1,
    "assignments": 1,
    "parameter": false
  }

];
const rows=body=>body.flatMap(row=>[row,...rows(row.body??[]),...rows(row.then??[]),...rows(row.else??[]),
  ...rows(row.tryBlock?.body??[]),...rows(row.catchClause?.block?.body??[]),...rows(row.finallyBlock?.body??[])]);

test('a Source3 inferred var cannot widen its original initializer declaration',()=>{
  const original=JSON.parse(readFileSync(new URL('./testdata/common-var-binding-v3/inferred-narrowed.json',import.meta.url),'utf8')),
    changed=structuredClone(original),owner=changed.payload.functions.find(fn=>fn.name==='varBinding'),cell=owner.bindings.find(b=>b.name==='x');
  assert.equal(cell.annotationRange,null);assert.equal(cell.declaredType,'i32');
  assert.equal(rows(owner.body).find(row=>row.kind==='varDeclaration'&&row.binding===cell.id).initializer.flowType,'i32');
  cell.declaredType='union<i32,undefined>';
  assert.equal(changed.packageId,original.packageId);
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(changed)+'\n')),{code:'r03-common-program-type'});
});

for(const sample of cases)test('complete official var form: '+sample.name,()=>{
  const bytes=readFileSync(new URL('./testdata/common-var-binding-v3/'+sample.name+'.json',import.meta.url));
  assert.equal(bytes.length,sample.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),sample.sha);
  const original=JSON.parse(bytes.toString('utf8')),source=original.payload.files.find(file=>file.path==='/src/main.ts'),
    sourceOwner=original.payload.functions.find(fn=>fn.name==='varBinding'),
    sourceCell=[...sourceOwner.parameters,...sourceOwner.bindings].find(b=>b.name==='x'),
    declarations=rows(sourceOwner.body).filter(row=>row.kind==='varDeclaration'&&row.binding===sourceCell.id);
  assert.equal(source.sha256,sample.sourceSHA);assert.equal(createHash('sha256').update(source.content).digest('hex'),sample.sourceSHA);
  assert.equal(sourceCell.declaredType,sample.declaredType);assert.equal(sourceCell.lexicalOwner,sourceOwner.id);
  assert.equal(sourceCell.kind,sample.parameter?'parameter':'local');assert.equal(declarations.length,sample.varCount);
  assert.equal(declarations.filter(row=>row.initializer).length,sample.assignments);
  for(const row of declarations)assert.equal(source.content.slice(row.nameRange.start,row.nameRange.end),'x');
  const hir=projectCommonProgram(readCommonProgramFacts(bytes)),owner=hir.functions.find(fn=>fn.sourceBinding===sourceOwner.id),
    cell=[...owner.parameters,...owner.bindings].find(b=>b.id===sourceCell.id),
    layout=hir.environments.find(env=>env.slots.some(slot=>slot.binding===cell.id));
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  assert.ok(layout);assert.equal(layout.owner,owner.id);assert.equal(layout.scope,undefined);
  assert.equal(layout.slots.filter(slot=>slot.binding===cell.id).length,1);
  assert.equal(hir.types.find(t=>t.id===cell.type).sourceType,sample.declaredType);
  for(const declaration of declarations){
    const retained=rows(owner.body).find(row=>row.kind==='varDeclaration'&&row.range.start===declaration.range.start);
    assert.ok(retained);assert.equal(retained.binding,cell.id);assert.deepEqual(retained.nameRange,declaration.nameRange);
    assert.deepEqual(retained.annotationRange,declaration.annotationRange);
    assert.equal(Object.hasOwn(retained,'initializer'),Object.hasOwn(declaration,'initializer'));
    if(declaration.initializer)assert.deepEqual(retained.initializer.range,declaration.initializer.range);
  }
  const planned=commonProgramPlan(hir),plan=planned.plans.find(p=>p.owner.id===owner.id),entry=plan.entry.instructions,
    all=plan.graph.blocks.flatMap(block=>block.instructions),allocation=entry.find(op=>op.name==='tsfg_program.env_alloc'&&op.properties.layout===layout.id),
    initializations=all.filter(op=>op.name==='tsfg_program.env_init'&&op.properties.binding===cell.id),
    stores=all.filter(op=>op.name==='tsfg_program.env_store'&&op.properties.binding===cell.id);
  assert.ok(allocation);assert.equal(initializations.length,1);assert.ok(entry.includes(initializations[0]));
  assert.equal(initializations[0].operands[0],allocation.result);assert.deepEqual(initializations[0].range,sourceCell.declarationRange);
  assert.equal(stores.length,sample.assignments);
  assert.deepEqual(stores.map(op=>op.range),declarations.filter(row=>row.initializer).map(row=>row.range));
  for(const store of stores)assert.equal(store.operands[0],allocation.result);
  for(const declaration of declarations.filter(row=>!row.initializer)){
    assert.ok(!stores.some(op=>op.range.start===declaration.range.start));
  }
  let initial=initializations[0].operands[1],origin=all.find(op=>op.result===initial);
  while(origin?.name==='tsfg_program.value_copy'){initial=origin.operands[0];origin=all.find(op=>op.result===initial);}
  if(sample.parameter){
    assert.equal(owner.bindings.some(b=>b.id===cell.id),false,'a parameter redeclaration must not create another local');
    const index=plan.parameters.findIndex(p=>p.id===cell.id);assert.ok(index>=0);
    assert.equal(initial,plan.entry.parameters[index].name,'the original incoming parameter must survive a no-init var');
    assert.notEqual(origin?.name,'tsfg_program.undefined');
  }else assert.equal(origin?.name,'tsfg_program.undefined','every local var starts once at actual undefined');
  const closures=hir.functions.filter(fn=>fn.captures.some(c=>c.binding===cell.id));assert.equal(closures.length,2);
  for(const closure of closures)assert.equal(closure.lexicalEnvironment,layout.id);
  if(sample.name==='shadowed-owner'){
    const unrelated=hir.functions.find(fn=>fn.name==='unrelated'),inner=unrelated.bindings.find(b=>b.name==='x');
    assert.notEqual(inner.id,cell.id);assert.equal(inner.lexicalOwner,unrelated.id);
    assert.ok(!layout.slots.some(slot=>slot.binding===inner.id));
    const other=planned.plans.find(p=>p.owner.id===unrelated.id),operations=other.graph.blocks.flatMap(b=>b.instructions),
      initial=operations.filter(op=>op.name==='tsfg_program.store'&&op.properties.binding===inner.id&&op.properties.initialize),
      assigned=operations.filter(op=>op.name==='tsfg_program.store'&&op.properties.binding===inner.id&&!op.properties.initialize);
    assert.equal(initial.length,1);assert.equal(assigned.length,1);assert.equal(initial[0].operands[0],assigned[0].operands[0]);
  }
  const publication=createCommonProgramPublication(hir),request={targets:[]},program=commonProgramCore(hir,publication,request,{borrowProof:true});
  assert.ok(program.borrowProof);
  const storage=program.representation.bindings.find(row=>row.id===cell.id),domain=program.representation.domains.find(row=>row.id===storage.carrier),
    undefinedType='sha256:'+createHash('sha256').update('tsfg.type\0undefined').digest('hex'),i32Type=hir.types.find(t=>t.sourceType==='i32').id;
  assert.ok(domain?.actualTypes.includes(undefinedType));assert.ok(domain.actualTypes.includes(i32Type));
  assert.equal(hir.types.find(t=>t.id===cell.type).sourceType,sample.declaredType,'physical capacity must not widen the official declaration');
  if(process.env.TSFG_VAR_BINDING_CORE_ROOT){
    mkdirSync(process.env.TSFG_VAR_BINDING_CORE_ROOT,{recursive:true});
    for(const [suffix,text]of [['.mlir',program.text],['.proof.json',canonical(program.borrowProof)+'\n'],['.owned.json',canonical({hir,publication,request})+'\n']]){
      const path=process.env.TSFG_VAR_BINDING_CORE_ROOT+'/'+sample.name+suffix;
      if(existsSync(path))assert.equal(readFileSync(path,'utf8'),text);else writeFileSync(path,text,{flag:'wx'});
    }
  }
});
