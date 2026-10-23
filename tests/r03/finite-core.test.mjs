// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir,printHir,readHir} from '../../compiler/hir.mjs';
import {buildFiniteActualDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteFieldPhases} from '../../compiler/finite-field-phases.mjs';
import {buildFiniteFieldReaching} from '../../compiler/finite-field-reaching.mjs';
import {finiteCallables} from '../../compiler/finite-callables.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import entryManifest from './testdata/typed-array-entry/manifest.json' with {type:'json'};
import independentExpected from './testdata/typed-array-entry/finite-core-expected.json' with {type:'json'};
import reachingExpected from './testdata/typed-array-entry/field-reaching.json' with {type:'json'};
import finiteContract from '../../contracts/finite-core-development.json' with {type:'json'};
import {staticPublication,optionalArrayPublication} from './typed-array-publication-fixtures.mjs';
const entryRoot=new URL('./testdata/typed-array-entry/',import.meta.url);
async function entryBytes(id) {
  const packet=entryManifest.packets.find(row=>row.sourceSHA256===id);
  assert.ok(packet,'selected actual packet');const bytes=await readFile(new URL(packet.file,entryRoot));
  assert.equal(sha256(bytes).slice(7),packet.packageSHA256);return bytes;
}

async function load(dir,id,publish=false) {
  const bytes=await readFile(new URL('./testdata/'+dir+'/'+id+'-package.json',import.meta.url));
  return loadBytes(bytes,publish);
}
/** @param {Buffer} bytes @param {boolean|'views'} [publish] */
function loadBytes(bytes,publish=false) {
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId};
  const publicationContext=publish==='views'?optionalArrayPublication(facts):publish?staticPublication(facts):undefined;
  const built=buildHir(facts,context,publicationContext);assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  return {hir:built.hir,context,publicationContext};
}
const probe=()=>load('typed-array-actual-v8','c4cd2bcc06fe4844f95fce28a0ba398afb1a8139f5c7bb594cc7a8474a223cb4');
const direct=()=>load('typed-array-reference-domain','7c258eb5388544dd79d724ba144befbaa06b77d100cef7dad9363c38b8cc4aea');
function domain(plan,node){return plan.domains.find(domain=>domain.id===node.domainId);}

test('actual published entry evidence admits reverse readonly view without deep freezing the actual instance',async()=>{
  const bytes=await entryBytes('e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a');
  const {hir,context}=loadBytes(bytes),plan=buildFiniteActualDomains(hir,context),fn=hir.functions.find(row=>row.name==='f');
  const parameter=plan.nodes.find(row=>row.id===fn.id+'/binding/'+fn.parameters[0].id);
  assert.deepEqual(new Set(domain(plan,parameter).actualTypes),new Set(hir.types.filter(type=>type.kind==='reference').map(type=>type.id)));
  assert.equal(hir.entryCompatibilityRoots.length,1);assert.equal(hir.entryCompatibilityRoots[0].roots.length,1);
});

test('actual entry evidence rejects missing parameters, foreign anchors and out-of-scope view roots',async()=>{
  const original=JSON.parse((await entryBytes('e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a')).toString('utf8'));
  for(const mutate of [
    value=>{value.payload.entryCompatibilityRoots=[];},
    value=>{value.payload.entryCompatibilityRoots[0].origin.start++;},
    value=>{value.payload.entryCompatibilityRoots[0].parameterBinding=value.payload.functions[0].id;},
    value=>{value.payload.entryCompatibilityRoots[0].viewType=value.payload.entryCompatibilityRoots[0].roots[0].sourceType;},
    value=>{value.payload.entryCompatibilityRoots.push(structuredClone(value.payload.entryCompatibilityRoots[0]));},
    value=>{value.payload.entryCompatibilityRoots[0].roots=[];}
  ]) {
    const value=structuredClone(original);mutate(value);
    value.packageId=sha256('tsfg.array-facts.package.v8\0'+value.schemaHash+'\0'+canonical(value.payload));
    assert.throws(()=>readTypedArrayFacts(Buffer.from(canonical(value)+'\n')),error=>
      error instanceof TypeError&&'code' in error&&['r03-typed-array-compatibility-entry','r03-typed-array-compatibility-order','r03-typed-array-compatibility-closure'].includes(String(error.code)));
  }
});

test('actual new entry protocol preserves every selected whole Source closure through owned HIR roundtrip',async t=>{
  const packets=entryManifest.packets;assert.equal(packets.length,122);
  for(const packet of packets)await t.test(packet.sourceSHA256,async()=>{
    const bytes=await entryBytes(packet.sourceSHA256);
    const {hir,context,publicationContext}=loadBytes(bytes,'views');
    assert.equal(hir.format.contractVersion,finiteContract.hir);
    assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publicationContext)),context,publicationContext),hir);
    assert.equal(hir.entryCompatibilityRoots.length,
      [...new Set(hir.exports.map(row=>row.functionId))].reduce((count,id)=>count+hir.functions.find(fn=>fn.id===id).parameters.length,0));
  });
});

test('formal HIR0.14 routes to ordinary Core instead of the String consumer',async()=>{
  const {hir,context}=await probe(),core=lowerFormalHir(hir,context);
  assert.equal(typeof core,'string');assert.match(core,/tsfg_core\.finite_domains/);
  assert.match(core,/tsfg_core\.domain\.array_store/);assert.doesNotMatch(core,/private_profile|tsfg_array\./);
});

test('actual Source scalar/absence transport has per-slot finite domains and native scalar ABI',async()=>{
  const {hir,context}=await probe(),plan=buildFiniteActualDomains(hir,context),fn=hir.functions[0];
  const scalar=plan.nodes.find(node=>node.id===fn.id+'/binding/'+fn.parameters[0].id);
  assert.equal(domain(plan,scalar).nativeType,'u32');assert.equal(domain(plan,scalar).referenceCount,0);
  const returned=plan.nodes.find(node=>node.id===fn.id+'/return'),types=domain(plan,returned).actualTypes;
  assert.deepEqual(new Set(types.map(id=>hir.types.find(type=>type.id===id).kind)),new Set(['undefined']));
  assert.equal(types.length,1);assert.equal(domain(plan,returned).referenceCount,0);
  const maximum=plan.carrierNodes.find(row=>row.id===returned.id);
  assert.equal(domain(plan,maximum).actualTypes.length,2);assert.equal(domain(plan,maximum).tagBytes,2);
  assert.equal(plan.abi.find(row=>row.functionId===fn.id).result,maximum.domainId);
});

test('writable covariant alias flows actual Base replacement into original Derived read without retagging',async()=>{
  const {hir,context}=await direct(),plan=buildFiniteActualDomains(hir,context);
  const derived=hir.types.find(type=>type.base),base=hir.types.find(type=>type.id===derived.base);
  const read=plan.expressions.find(row=>row.kind==='arrayReadChecked'),readNode=plan.nodes.find(row=>row.id===read.id);
  assert.equal(readNode.viewType,derived.id);
  assert.deepEqual(new Set(domain(plan,readNode).actualTypes),new Set([base.id]));
  assert.deepEqual(new Set(domain(plan,plan.carrierNodes.find(row=>row.id===read.id)).actualTypes),new Set([derived.id,base.id]));
  assert.equal(domain(plan,readNode).representation,'reference');assert.equal(domain(plan,readNode).tagBytes,0);
  assert.equal(domain(plan,readNode).referenceCount,1);assert.deepEqual(readNode.pending,[]);
});

test('bounded local closure cancels/fails without publishing or contaminating a later plan',async()=>{
  const {hir,context}=await probe();
  assert.throws(()=>buildFiniteActualDomains(hir,context,{work:8}),/work limit/);
  assert.throws(()=>buildFiniteActualDomains(hir,context,{cancelled:()=>true}),/cancelled/);
  assert.deepEqual(buildFiniteActualDomains(hir,context),buildFiniteActualDomains(hir,context));
});

test('actual compound call lowers receiver/index once and checked old read precedes RHS',async()=>{
  const {hir,context}=await load('typed-array-actual-v8','f2c9d4e124c4cc6331012390387c1e803adf0c4707ef653d9de4303066d75954');
  const core=lowerFormalHir(hir,context),callee=name=>'callee = @"f'+hir.functions.find(fn=>fn.name===name).id.slice(7)+'"';
  for(const name of ['receiver','index','rhs'])assert.equal(core.split(callee(name)).length-1,1);
  const receiver=core.indexOf(callee('receiver')),index=core.indexOf(callee('index')),
    read=core.indexOf('"tsfg_core.domain.array_read"',index),rhs=core.indexOf(callee('rhs')),
    store=core.indexOf('"tsfg_core.domain.array_store"',rhs);
  assert.ok(receiver<index&&index<read&&read<rhs&&rhs<store);
  assert.match(core.slice(rhs,store),/"tsfg_core.add"/);
});

test('actual covariant alias formal transport invokes same storage/view domain without numeric boxing',async()=>{
  const {hir,context}=await direct(),core=lowerFormalHir(hir,context);
  assert.match(core,/"tsfg_core.domain.construct"/);assert.match(core,/"tsfg_core.domain.identity_equal"/);
  assert.match(core,/"tsfg_core.domain.array_store"/);assert.match(core,/"tsfg_core.domain.array_read"/);
  assert.doesNotMatch(core,/box|private_profile/);
});

test('actual invoked implicit constructors lower their owned forward and initializer bodies into Core SSA',async()=>{
  const {hir,context}=await direct(),core=lowerFormalHir(hir,context),owners=hir.types.filter(type=>type.construction);
  assert.equal(core.split('"tsfg_core.domain.initialize_fields"').length-1,2,'both actual implicit constructor bodies consume their field initialization');
  assert.equal(core.split('"tsfg_core.domain.field_initialize"').length-1,2);
  assert.equal(core.split('"tsfg_core.domain.super"').length-1,1,'implicit derived forwards the same receiver to direct base');
  assert.equal(core.split('"tsfg_core.domain.construct"').length-1,2,'only the two original new expressions allocate');
  for(const owner of owners)assert.ok(core.includes('tsfg_core.function_id = "'+owner.construction.id+'"'),'original implicit construction identity is an actual body');
  const derived=owners.find(type=>type.base),field=derived.construction.initialization[0],
    store=core.split('\n').find(line=>line.includes('"tsfg_core.domain.field_initialize"')&&line.includes(field.field));
  assert.ok(store.includes('tsfg_source.start = '+field.origin.start+' : i64'));
  assert.ok(store.includes('tsfg_source.end = '+field.origin.end+' : i64'));
});

test('actual implicit inherited signatures forward scalar, reference, value and ReadSpan payloads without inventing instances',async t=>{
  for(const id of ['87131d58f03fdc39f35b821b1f08435d421c41271db6771c996a9a8a38047cd6',
    '2ccc5de4b45f62e9586cc187c89cf8c72edeb99fb0e5f657ed796c20478a7e1d'])await t.test(id,async()=>{
    const {hir,context,publicationContext}=await load('typed-array-source514',id,id.startsWith('2ccc5de4')),
      plan=buildFiniteActualDomains(hir,context,{publicationContext}),core=lowerFormalHir(hir,context,publicationContext);
    const implicit=hir.types.filter(type=>type.construction&&!type.constructor);
    for(const type of implicit) {
      const parameter=plan.nodes.find(row=>row.id===type.construction.id+'/binding/'+type.construction.receiver.id),
        reached=domain(plan,parameter).actualTypes.length>0;
      assert.ok(core.includes('tsfg_core.function_id = "'+type.construction.id+'"'),
        'quantified definition ABI retains every body, independently of reached receiver evidence');
      if(!reached)assert.deepEqual(domain(plan,parameter).actualTypes,[]);
    }
    assert.match(core,/implicit_forward = /);
    assert.equal(core.split('"tsfg_core.domain.construct"').length-1,1,'implicit forwarding never allocates a base instance');
  });
});

test('actual ESNext constructor phase prepends native parameter definitions and publishes assigned versions after ordinary fields',async()=>{
  const {hir,context}=await load('typed-array-source514','fd57e617782517801d7af66b05c4dab26971a8493d35a5137768fc999b2e29d7');
  const plans=buildFiniteFieldPhases(hir,context),base=hir.types.find(type=>type.kind==='reference'&&!type.base),
    derived=hir.types.find(type=>type.base);
  const basePlan=plans.find(row=>row.ownerType===base.id),derivedPlan=plans.find(row=>row.ownerType===derived.id);
  assert.deepEqual(basePlan.events.map(event=>event.kind),['nativeDefine','nativeDefine','initializerWrite','parameterWrite','parameterWrite']);
  assert.deepEqual(derivedPlan.events.map(event=>event.kind),['nativeDefine','initializerWrite','parameterWrite']);
  for(const plan of [basePlan,derivedPlan])for(const event of plan.events.filter(event=>event.kind==='parameterWrite')) {
    const prior=plan.events.find(row=>row.output.id===event.input);
    assert.equal(prior.output.state,'defined-native-undefined');assert.equal(prior.output.valueNode,null);
    assert.equal(event.output.state,'initialized');assert.ok(event.output.parameterBinding);
    assert.equal(event.output.previous,prior.output.id);
  }
  const core=lowerFormalHir(hir,context);
  const superAt=core.indexOf('"tsfg_core.domain.super"'),initAt=core.indexOf('"tsfg_core.domain.initialize_fields"',superAt);
  assert.ok(superAt>=0&&initAt>superAt);assert.match(core,/field_plan = /);
});

test('actual constructor initializers execute in Core SSA rather than only surviving in a phase plan',async()=>{
  const {hir,context}=await load('typed-array-source514','fd57e617782517801d7af66b05c4dab26971a8493d35a5137768fc999b2e29d7');
  const core=lowerFormalHir(hir,context),tick=hir.functions.find(fn=>fn.name==='tick');
  const calls=core.split('\n').filter(line=>line.includes('"func.call"')&&line.includes('callee = @"f'+tick.id.slice(7)+'"'));
  assert.equal(calls.length,5,'before/super arguments/base body/derived initializer/derived body each call once');
  assert.equal(core.split('"tsfg_core.domain.field_define"').length-1,3);
  assert.equal(core.split('"tsfg_core.domain.field_initialize"').length-1,5);
  assert.equal(core.split('"tsfg_core.domain.construct"').length-1,1,'super never allocates a Base receiver');
  const derived=hir.types.find(type=>type.base),field=derived.construction.initialization.find(row=>row.value),
    start='tsfg_source.start = '+field.value.range.start+' : i64',end='tsfg_source.end = '+field.value.range.end+' : i64';
  const initializerCall=core.split('\n').find(line=>line.includes('"func.call"')&&line.includes(start)&&line.includes(end));
  assert.ok(initializerCall,'original initializer call anchor is an actual SSA operation');
  const superAt=core.indexOf('"tsfg_core.domain.super"'),callAt=core.indexOf(initializerCall),
    storeAt=core.indexOf('"tsfg_core.domain.field_initialize"',callAt);
  assert.ok(superAt<callAt&&callAt<storeAt,'successful super precedes original initializer and its successful write');
});

test('actual constructor field storage includes native undefined while successful base completion qualifies the later read',async()=>{
  const {hir,context}=await load('typed-array-source514','fd57e617782517801d7af66b05c4dab26971a8493d35a5137768fc999b2e29d7');
  const plan=buildFiniteActualDomains(hir,context),base=hir.types.find(type=>type.kind==='reference'&&!type.base),
    derived=hir.types.find(type=>type.base),log=base.fields.find(field=>field.name==='log'),
    storage=plan.nodes.find(row=>row.id==='field/'+derived.id+'/'+log.id),read=plan.fields.find(row=>row.member===log.id);
  assert.ok(domain(plan,storage).actualTypes.includes(sha256('tsfg.type\0undefined')),'native prefix definition is a real initialized absence, not an omitted value');
  const result=domain(plan,plan.nodes.find(row=>row.id===read.id));
  assert.deepEqual(result.actualTypes,[log.type],'same receiver successful base parameter write reaches derived initializer');
  const proof=plan.fieldReaching.reads.find(row=>row.node===read.id);
  assert.equal(proof.reaching[0].field,log.id);
  assert.ok(proof.reaching[0].versions.every(id=>id.startsWith(base.construction.id+'/field/')));
  assert.match(lowerFormalHir(hir,context),/"tsfg_core.domain.field_read"/);
});

test('actual managed String retains UTF16 units and uses existing ordinary String operations inside a finite union',async()=>{
  const {hir,context}=await load('typed-array-actual-v8','619021d061e1003c598032e3bdaf00ece6600b52927d3718334a723a4c1e821e');
  const core=lowerFormalHir(hir,context);
  assert.match(core,/"tsfg_string.constant"\(\) \{code_units = array<i32: 55296>/);
  assert.match(core,/"tsfg_string.constant"\(\) \{code_units = array<i32: 0>/);
  assert.match(core,/"tsfg_string.concat"/);assert.match(core,/!tsfg_string\.string/);
});

test('actual ReadSpan shares its array owner and only a dominating presence guard refines its payload',async()=>{
  const {hir,context,publicationContext}=await load('typed-array-actual-v8','d70e95378e645d194db0875bfa9de4bbe1e774bde2ffa5a2872ce21d1ef89969',true);
  const plan=buildFiniteActualDomains(hir,context,{publicationContext}),span=plan.expressions.find(row=>row.kind==='call'),
    spanNode=plan.nodes.find(row=>row.id===span.id),parameter=plan.nodes.find(row=>row.id===hir.functions[0].id+'/binding/'+hir.functions[0].parameters[0].id);
  assert.deepEqual(spanNode.arrayOwners,parameter.arrayOwners);assert.equal(spanNode.arrayOwners.length,1);
  const result=plan.nodes.find(row=>row.id===hir.functions[0].id+'/return');
  assert.equal(domain(plan,result).actualTypes.length,1);assert.equal(hir.types.find(type=>type.id===domain(plan,result).actualTypes[0]).kind,'string');
  const core=lowerFormalHir(hir,context,publicationContext);assert.match(core,/"tsfg_core.domain.read_span"/);
  assert.match(core,/"tsfg_core.domain.presence_equal"/);assert.match(core,/"tsfg_core.domain.refine"/);
});

const primitiveIds={bool:'aa472de340f45c64b9b63c95cd7765ab411f657f86b86e553d7cb0c2b7d2e7fc',
  f32:'b57349de40276d9a0b502b3386f3fa46cb811b1323643e19634630e4524bcdee',f64:'ef37f9372bf3611c8d6fb98090975753ba0cd55d13add934d833002fbe0ba59f',
  i16:'3e2d14aefad4ab8761eb84d5f40fc5ded27896feb7d8ee76f58e031a0684b58d',i32:'c2617fc070134d565698557894af91f09389d1f5d6345b9cedb42dbccc4e4b0e',
  i64:'fb282a8ef2d3ffd2843c7a9fc2c0ff0a1d8ff3c6c4b6f8708d68a7e2e079402d',i8:'42f526ac3038cb92a1e69b226c946168d48d4204604bb7d80944e683f9bda665',
  isize:'ee82f91d94c2530044a0ad3ec9feda3f28127f6570f08de16135cfe6f44c7d2b',null:'ca98004cc1c61d677e62590dafd17b730be783a51927b67ecaa85b10a01cd9eb',
  string:'8f14f0588de5e2f68a09131c667acf048908677ab004b55e68c9f63aa890bf3f',u16:'94f31f656b548a9ea8c185b5b1d0356b65cec2ecb8d10b28cf670c9883124b28',
  u32:'1e79877c6a55db7b4cbd69ffa2e2dff4860e1ba7d894bc0a06b81e36518eb16f',u64:'12de200abdd1a6fb06e80c53a7368ba384947605a8f764ff3ee8b4d6d8ca7fac',
  u8:'6d2fc32fa7ac7e8b7a43173818d393b08d3ad99dbe4dc244133dfa82f7cb602d',undefined:'bb03df1aa82e0ada35a5cb138e92b08f2803c8c5b2f7b203ccf8e1f3aac1ea89',
  usize:'8ad3b2148809b4f20c2322d1c1c6b187bbed97151628f171c46b95ca32c949ff'};
for(const [name,id] of Object.entries(primitiveIds))test('actual concrete element formal transport: '+name,async()=>{
  const {hir,context}=await load('typed-array-actual-v8',id),plan=buildFiniteActualDomains(hir,context);
  const returned=plan.carrierNodes.find(row=>row.id===hir.functions[0].id+'/return'),representation=domain(plan,returned);
  assert.equal(representation.actualTypes.length,1);assert.equal(representation.referenceCount,name==='string'?1:0);
  assert.ok(plan.nodes.find(row=>row.id===returned.id).pending.length,'unproved entry read never publishes its carrier as an actual source');
  if(!['null','undefined','string'].includes(name))assert.equal(representation.nativeType,name);
  assert.match(lowerFormalHir(hir,context),/"tsfg_core.domain.array_read"/);
});

async function entryActual(id) {
  return loadBytes(await entryBytes(id));
}
test('actual host entry parameters may share one covariant array owner',async()=>{
  const {hir,context}=await entryActual('06b4f526067edba140db846a26d32539bcee0c402d9797002ca5fee8a936f041');
  const plan=buildFiniteActualDomains(hir,context),derived=hir.types.find(type=>type.base),
    read=plan.expressions.find(row=>row.kind==='arrayReadChecked'),value=plan.carrierNodes.find(row=>row.id===read.id);
  assert.deepEqual(new Set(domain(plan,value).actualTypes),new Set([derived.id,derived.base]));
  assert.ok(plan.nodes.find(row=>row.id===read.id).pending.length,'may-alias capacity does not prove first write or length');
});

test('actual distinct native entry representations retain separate native domains',async()=>{
  const {hir,context}=await entryActual('fe96067658500046a532a07df42adbc372b311686c1ff4017d92fa5aeb3b0578');
  const plan=buildFiniteActualDomains(hir,context),params=hir.functions[0].parameters;
  for(const [index,name] of ['i32','u32'].entries()) {
    const parameter=plan.nodes.find(row=>row.id===hir.functions[0].id+'/binding/'+params[index].id);
    const elements=plan.nodes.find(row=>row.id===parameter.arrayOwners[0]+'/elements');
    assert.equal(domain(plan,elements).nativeType,name);assert.equal(domain(plan,elements).referenceCount,0);
  }
  assert.match(lowerFormalHir(hir,context),/"tsfg_core.add"/);
});

test('actual different exports conservatively share compatible persistent published resources',async()=>{
  const {hir,context}=await entryActual('fd1633b7257bbd3c9438a00f716fbe01700373d05ce535de9ef81731aeb5f47c');
  const plan=buildFiniteActualDomains(hir,context),read=plan.expressions.find(row=>row.kind==='arrayReadChecked');
  assert.equal(plan.published.length,2);assert.equal(plan.aliases.length,1);
  assert.deepEqual(new Set(domain(plan,plan.carrierNodes.find(row=>row.id===read.id)).actualTypes),
    new Set(hir.types.filter(row=>row.kind==='reference').map(row=>row.id)));
  assert.ok(plan.nodes.find(row=>row.id===read.id).pending.length);
  assert.match(lowerFormalHir(hir,context),/"tsfg_core.domain.array_store"/);
});

test('actual M12 method view flows receiver and return through its implementation rather than the static header',async()=>{
  const {hir,context}=await load('typed-array-source514','38da6ecc5dd455700f3a667ae47e6110f1a58a6d74025a4f409deab4b509d7cf');
  const plan=buildFiniteActualDomains(hir,context),actual=hir.types.find(type=>type.nominalKey?.declarationPath[0]==='A'),
    view=hir.types.find(type=>type.nominalKey?.declarationPath[0]==='B');
  const implementation=hir.functions.find(fn=>fn.ownerType===actual.id&&fn.name==='m'),header=hir.functions.find(fn=>fn.ownerType===view.id&&fn.name==='m');
  const receiver=fn=>plan.nodes.find(row=>row.id===fn.id+'/binding/'+fn.parameters[0].id);
  assert.deepEqual(domain(plan,receiver(implementation)).actualTypes,[actual.id]);
  assert.deepEqual(domain(plan,receiver(header)).actualTypes,[],'unused nominal B implementation is retained but not seeded');
  const call=plan.calls.find(row=>row.member===header.id);
  assert.deepEqual(call.targets.map(row=>({actualType:row.actualType,functionId:row.functionId})),[{actualType:actual.id,functionId:implementation.id}]);
});

test('actual inherited method call consumes the finite dispatch in the ordinary Core route',async()=>{
  const {hir,context}=await load('typed-array-source514','a72e067ed8bbbeb893ed9c082a28a7f15b27cbca23bfb4640e60b66763806d95');
  const plan=buildFiniteActualDomains(hir,context),core=lowerFormalHir(hir,context),
    method=hir.functions.find(fn=>fn.name==='m'),derived=hir.types.find(type=>type.base);
  assert.equal(plan.calls.length,1);
  assert.deepEqual(plan.carrierCalls[0].targets.map(row=>[row.actualType,row.functionId]),[[derived.id,method.id]]);
  assert.deepEqual(plan.calls[0].targets,[],'unproved receiver read supplies no actual method invocation seed');
  assert.match(core,/"tsfg_core.domain.method_call"/);
  assert.ok(core.includes('dispatch = '));assert.match(core,/receiver_view = /);
  assert.equal(core.split('callee = @"f'+method.id.slice(7)+'"').length-1,0,'method implementation is selected from actual receiver authority');
});

test('actual readonly structural aliases carry exact target-to-actual fields into Core reads and stores',async()=>{
  const {hir,context}=await entryActual('e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a');
  const plan=buildFiniteActualDomains(hir,context),core=lowerFormalHir(hir,context);
  const frozen=hir.types.find(type=>type.fields?.some(field=>field.readonly)),
    writable=hir.types.find(type=>type.kind==='reference'&&type.id!==frozen.id);
  const read=plan.fields.find(row=>row.kind==='read'),store=plan.fields.find(row=>row.kind==='store');
  assert.equal(read.viewType,frozen.id);assert.equal(store.viewType,writable.id);
  for(const operation of [read,store])assert.deepEqual(operation.targets.map(row=>[row.actualType,row.fieldId,row.fieldType]),
    [frozen,writable].sort((a,b)=>a.id<b.id?-1:1).map(type=>[type.id,type.fields[0].id,type.fields[0].type]));
  for(const name of ['field_read','field_store']) {
    const line=core.split('\n').find(line=>line.includes('"tsfg_core.domain.'+name+'"'));
    assert.ok(line.includes('field_dispatch = '),'production field operation consumes actual member selection');
    assert.ok(line.includes('receiver_view = '));
  }
  assert.equal(frozen.fields[0].readonly,true,'actual readonly declaration is preserved');
  assert.equal(writable.fields[0].readonly,false,'store permission comes from verified writable static view');
  const reaching=plan.fieldReaching.reads.find(row=>row.node===read.id);
  assert.equal(reaching.reaching.length,2,'both actual variants retain the same successful write through the definite alias');
  for(const target of reaching.reaching)assert.deepEqual(target.sources,[store.id+'/value']);
});

test('memory constraint unit invalidates strong versions across possibly aliasing parameters and actual callee writes',async()=>{
  const {hir,context}=await entryActual('e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a');
  const plan=buildFiniteActualDomains(hir,context),original=hir.functions.find(fn=>fn.name==='f'),
    selectedStore=plan.fields.find(row=>row.kind==='store'),selectedRead=plan.fields.find(row=>row.kind==='read');
  // Derived constraint fragments test invalidation, not official Source facts
  // or execution. The positive full Source route above supplies the real input.
  for(const boundary of ['parameter','call']) {
    const fn=structuredClone(original),extra=structuredClone(fn.body[1]);
    const laterRead=selectedRead.id.replace('/body/2/','/body/3/');
    let fields=[{...selectedRead,id:laterRead},selectedStore],functions;
    if(boundary==='parameter') {
      const second={...fn.parameters[0],id:'unit-second-parameter'};fn.parameters.push(second);
      extra.expression.target.receiver.binding=second.id;
      fields.push({...selectedStore,id:fn.id+'/body/2/expression'});functions=[fn];
    }else {
      const callee={...structuredClone(fn),id:'unit-field-writer',body:[structuredClone(extra)]};
      extra.expression={kind:'call',target:callee.id,arguments:[],type:fn.returnType.id,range:extra.range};
      functions=[fn,callee];
    }
    fn.body.splice(2,0,extra);
    const reaching=buildFiniteFieldReaching({...hir,functions},{fields,calls:[],nodes:[],domains:[]},()=>{});
    assert.deepEqual(reaching.reads.find(row=>row.node===laterRead).reaching,[],boundary+' cannot silently supply noalias/noeffect');
  }
});

test('actual ordered field read captures its prior i32 write while storage retains later valid undefined',async()=>{
  const bytes=await readFile(new URL(reachingExpected.file,entryRoot));
  assert.equal(sha256(bytes).slice(7),reachingExpected.packageSHA256);
  const {hir,context}=loadBytes(bytes),plan=buildFiniteActualDomains(hir,context),fn=hir.functions[0],
    read=plan.fields.find(row=>row.kind==='read'),first=plan.fields.find(row=>row.id.includes('/body/0/')),
    later=plan.fields.find(row=>row.id.includes('/body/2/'));
  const value=plan.nodes.find(row=>row.id===read.id),returned=plan.nodes.find(row=>row.id===fn.id+'/return');
  assert.equal(domain(plan,value).nativeType,'i32');assert.equal(domain(plan,value).referenceCount,0);
  assert.equal(domain(plan,returned).id,domain(plan,value).id);
  const selected=read.targets[0],storage=plan.nodes.find(row=>row.id==='field/'+selected.actualType+'/'+selected.fieldId);
  assert.deepEqual(new Set(domain(plan,storage).actualTypes.map(id=>hir.types.find(type=>type.id===id).kind)),new Set(['scalar','undefined']));
  const proof=plan.fieldReaching.reads.find(row=>row.node===read.id);
  assert.deepEqual(proof.reaching[0].sources,[first.id+'/value']);
  assert.ok(!proof.reaching[0].sources.includes(later.id+'/value'),'future store cannot reach captured prior read');
  const core=lowerFormalHir(hir,context),line=core.split('\n').find(line=>line.includes('"tsfg_core.domain.field_read"'));
  assert.ok(line.includes('field_reaching = '));assert.match(line,/-> i32/);
  assert.ok(line.includes('tsfg_source.start = 89 : i64'));assert.ok(line.includes('tsfg_source.end = 92 : i64'));
  const stores=core.split('\n').filter(line=>line.includes('"tsfg_core.domain.field_store"'));
  assert.equal(stores.length,2);
  for(const statement of stores)for(const attribute of ['field_versions = ','memory_node = ','input_node = '])assert.ok(statement.includes(attribute));
  assert.match(core,/"tsfg_core.domain.literal"/,'later undefined remains an actual successful value write');
});

test('memory constraint unit never treats an inline value copy as a reference alias',async()=>{
  const {hir}=await load('typed-array-source514','2b95554986d9aff742030c402a842c1de3113e4d8199b4bc169bf94a1daa2717');
  const pair=hir.types.find(type=>type.kind==='value'),field=pair.fields[0],fn=hir.functions[0],parameter=fn.parameters[0].id;
  const reference=binding=>({kind:'reference',binding,type:pair.id}),range={start:0,end:0},
    target={actualType:pair.id,fieldId:field.id,fieldType:field.type};
  // The actual Pair catalogue supplies identity/layout; this deliberately small
  // derived constraint fragment supplies only the copy-boundary unit oracle.
  const body=[{kind:'local',binding:{id:'unit-value-copy',type:pair.id},initializer:reference(parameter)},
    {kind:'expression',expression:{kind:'fieldAssignment',type:field.type,range,target:{receiver:reference('unit-value-copy'),property:field.id},
      value:{kind:'constant',type:field.type,range}}},
    {kind:'return',value:{kind:'fieldAccess',receiver:reference(parameter),property:field.id,type:field.type,range}}];
  const reaching=buildFiniteFieldReaching({...hir,functions:[{...fn,parameters:[{...fn.parameters[0],type:pair.id}],body}]},
    {calls:[],nodes:[],domains:[],fields:[{id:fn.id+'/body/1/expression',targets:[target]},
      {id:fn.id+'/body/2/value',targets:[target]}]},()=>{});
  assert.deepEqual(reaching.reads[0].reaching,[],'copy mutation supplies no reaching version for original value');
  assert.equal(reaching.writes.length,1,'successful write still has its own explicit version');
});

test('memory constraint unit joins both successful branch versions and retains an unknown predecessor',async()=>{
  const {hir,context}=await entryActual('e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a');
  const plan=buildFiniteActualDomains(hir,context),original=hir.functions.find(fn=>fn.name==='f'),
    store=plan.fields.find(row=>row.kind==='store'),read=plan.fields.find(row=>row.kind==='read');
  for(const both of [true,false]) {
    const fn=structuredClone(original),assignment=fn.body[1];
    fn.body[1]={kind:'if',condition:{kind:'boolean',type:fn.returnType.id},then:[assignment],else:both?[structuredClone(assignment)]:[]};
    const fields=[read,...['then','else'].map(branch=>({...store,id:fn.id+'/body/1/'+branch+'/0/expression'}))];
    const reaching=buildFiniteFieldReaching({...hir,functions:[fn]},{fields,calls:[],nodes:[],domains:[]},()=>{});
    const observed=reaching.reads.find(row=>row.node===read.id).reaching;
    if(both) {
      assert.equal(observed.length,read.targets.length);
      for(const target of observed)assert.deepEqual(target.sources,
        ['else','then'].map(branch=>fn.id+'/body/1/'+branch+'/0/expression/value'));
    }
    else assert.deepEqual(observed,[],'one unwritten predecessor cannot supply a strong read version');
  }
});

test('memory constraint unit carries a successful caller version into a read-only callee',async()=>{
  const {hir,context}=await entryActual('e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a');
  const plan=buildFiniteActualDomains(hir,context),original=hir.functions.find(fn=>fn.name==='f'),
    store=plan.fields.find(row=>row.kind==='store'),read=plan.fields.find(row=>row.kind==='read');
  // A derived constraint fragment, not a synthetic official Source packet or
  // execution oracle. The original field operation/member authority is kept.
  const helper={...original,id:original.id+'/constraint-read',body:[structuredClone(original.body[2])]},
    call={kind:'call',target:helper.id,type:original.returnType.id,range:original.range,
      arguments:[{kind:'reference',binding:original.parameters[0].id,type:original.parameters[0].type,range:original.range}]},
    caller={...original,body:[...original.body.slice(0,2),{kind:'return',value:call,range:original.range}]},
    helperRead={...read,id:helper.id+'/body/0/value'},
    result=buildFiniteFieldReaching({...hir,functions:[caller,helper]},
      {fields:[store,helperRead],calls:[],nodes:[],domains:[]},()=>{}),reaching=result.reads.find(row=>row.node===helperRead.id);
  assert.equal(reaching.reaching.length,read.targets.length);
  for(const target of reaching.reaching)assert.deepEqual(target.sources,[store.id+'/value']);
  const unknown={...original,id:original.id+'/constraint-unknown',body:[{kind:'return',value:call,range:original.range}]},
    mixed=buildFiniteFieldReaching({...hir,functions:[caller,helper,unknown]},
      {fields:[store,helperRead],calls:[],nodes:[],domains:[]},()=>{});
  assert.equal(mixed.reads.find(row=>row.node===helperRead.id).reaching.length,0,
    'one unqualified caller prevents borrowing another caller\'s strong field version');
});

test('memory constraint unit consumes successful callee writes only on the call continuation',async()=>{
  const {hir,context}=await entryActual('e4f00044a7053cd8d9cb87fc6f2bef2102f35e459ff1f0971289ce9974522f6a');
  const plan=buildFiniteActualDomains(hir,context),original=hir.functions.find(fn=>fn.name==='f'),
    store=plan.fields.find(row=>row.kind==='store'),read=plan.fields.find(row=>row.kind==='read'),
    helper={...original,id:original.id+'/constraint-write'},
    call={kind:'call',target:helper.id,type:original.returnType.id,range:original.range,
      arguments:[{kind:'reference',binding:original.parameters[0].id,type:original.parameters[0].type,range:original.range}]},
    caller={...original,body:[{kind:'expression',expression:call,range:original.range},structuredClone(original.body[2])]},
    helperStore={...store,id:store.id.replace(original.id,helper.id)},
    helperRead={...read,id:read.id.replace(original.id,helper.id)},callerRead={...read,id:original.id+'/body/1/value'},
    result=buildFiniteFieldReaching({...hir,functions:[caller,helper]},
      {fields:[helperStore,helperRead,callerRead],calls:[],nodes:[],domains:[]},()=>{}),reaching=result.reads.find(row=>row.node===callerRead.id);
  assert.equal(reaching.reaching.length,read.targets.length);
  for(const target of reaching.reaching)assert.deepEqual(target.sources,[helperStore.id+'/value']);
});

test('formal definition ABI retains all independent whole callable identities without claiming reached instances',async t=>{
  let definitions=0;
  for(const sample of independentExpected.cases)await t.test(sample.case,async()=>{
    const {hir,context}=await entryActual(sample.sourceSHA256),core=lowerFormalHir(hir,context),callables=finiteCallables(hir),
      expected=independentExpected.perSlotAbiExpectations.filter(row=>row.case===sample.case);
    assert.deepEqual(callables.map(fn=>fn.id).sort(),expected.map(fn=>fn.functionId??fn.constructionId).sort());
    for(const fn of callables)assert.ok(core.includes('func.func @"f'+fn.id.slice(7)+'"'));
    assert.equal(core.split('  func.func @').length-1,callables.length);definitions+=callables.length;
    if(sample.case==='readonly') {
      const reached=buildFiniteActualDomains(hir,context);
      for(const fn of callables.filter(row=>row.role==='construction-body'))
        assert.deepEqual(domain(reached,reached.nodes.find(row=>row.id===fn.id+'/binding/'+fn.parameters[0].id)).actualTypes,[]);
    }
  });
  assert.equal(definitions,22,'independent identities only; their new universal ABI bounds need separate verification');
});

test('actual reached finite call bounds match the independently frozen whole Source oracle',async t=>{
  const oracle=independentExpected;
  assert.equal(oracle.independentOracleSHA256,'31a60526827356f5bed3b1aec40d11c0fbaf4bf624763f5b9ca7d0a138b9c829');
  for(const sample of oracle.cases) {
    const {hir,context}=await entryActual(sample.sourceSHA256),plan=buildFiniteActualDomains(hir,context);
    for(const expected of oracle.perSlotAbiExpectations.filter(row=>row.case===sample.case&&row.reachedCallFlow!=='empty/uninvoked'))
      await t.test(sample.case+' '+expected.entity,()=>{
        const actual=plan.abi.find(row=>row.functionId===(expected.functionId??expected.constructionId));
        assert.ok(actual,'complete reached callable');
        assert.deepEqual(actual.parameters,expected.parameters.map(row=>row.domainId));
        assert.equal(actual.result,expected.result?.domainId??null);assert.equal(actual.id,expected.abiHash);
      });
  }
});

test('actual whole constructor phase definitions match independent native-prefix and completion expectations',async t=>{
  const oracle=independentExpected;
  assert.equal(oracle.independentOracleSHA256,'31a60526827356f5bed3b1aec40d11c0fbaf4bf624763f5b9ca7d0a138b9c829');
  for(const sample of oracle.cases) {
    const {hir,context}=await entryActual(sample.sourceSHA256),plans=buildFiniteFieldPhases(hir,context);
    for(const expected of oracle.fieldPhaseExpectations.filter(row=>row.case===sample.case))
      await t.test(sample.case+' '+expected.ownerType,()=>{
        const actual=plans.find(row=>row.constructionId===expected.constructionId);assert.ok(actual,'complete construction plan');
        for(const key of ['ownerType','receiverBinding','activation','entry','completion'])assert.deepEqual(actual[key],expected[key]);
        assert.equal(actual.events.length,expected.events.length);
        for(const [index,event] of expected.events.entries()) {
          const observed=actual.events[index];
          for(const key of ['ordinal','kind','input'])assert.deepEqual(observed[key],event[key]);
          // The independent oracle explicitly leaves normalized valueNode text
          // pending; all frozen phase/state/identity/origin fields are exact.
          for(const key of ['id','field','previous','state','parameterBinding','origin'])
            assert.deepEqual(observed.output[key],event.output[key]);
        }
      });
  }
});
