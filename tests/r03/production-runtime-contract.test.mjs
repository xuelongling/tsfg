// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs,{mkdtemp,writeFile,unlink,rmdir,symlink} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {requireOrdinaryEAncestor} from '../../eng/output-storage.mjs';
import oracle from './host-counter-semantic-oracle.json' with {type:'json'};
import {createCounterHostContract,verifyCounterHostContract} from '../../eng/host-semantic-contract.mjs';
import {verifiedConsumer} from '../../compiler/pipeline.mjs';
import {expectedStringCore,expectedStringPacket,stringCases} from './formal-string-gold.mjs';
import {aotMetadataObject} from './aot-compiler-coff.mjs';
import declarations from '../../eng/build-inputs.json' with {type:'json'};

const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const jcs=value=>value&&typeof value==='object'
  ?Array.isArray(value)?'['+value.map(jcs).join(',')+']'
    :'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}'
  :JSON.stringify(value);
function identity(target,core=hash('complete program A')){
  const copy=structuredClone(oracle.identity);
  const value={...copy,buildIdentity:{...copy.buildIdentity,
    options:/** @type {Record<string,string|boolean|undefined>} */({...copy.buildIdentity.options})}};
  value.buildIdentity.options.sourceTarget=target;
  if(target==='tsfg-aot')value.buildIdentity.options.programCore=core;
  const {digest,...body}=value.buildIdentity;
  value.buildIdentity.digest=hash(jcs(body));
  return value;
}

test('ordinary AOT HSC binds its own actual target without changing Counter semantics',()=>{
  const compiled=identity('tsfg-aot');
  const actual=createCounterHostContract(compiled);
  const expected={...oracle.expectedContract,buildIdentityDigest:compiled.buildIdentity.digest};
  const {digest,...body}=expected;
  expected.digest=hash('tsfg.host-semantic-contract.v1\0'+jcs(body));
  assert.deepEqual(actual.contract,expected);
  assert.notEqual(actual.contract.digest,oracle.expectedContract.digest);
  assert.deepEqual(verifyCounterHostContract(Buffer.from(jcs(expected)+'\n'),compiled),expected);
  assert.throws(()=>verifyCounterHostContract(Buffer.from(oracle.expectedCanonicalText),compiled),/host-semantic-contract/);
});

test('complete program Core changes the normal AOT BI and its actual HSC binding',()=>{
  const first=identity('tsfg-aot'),second=identity('tsfg-aot',hash('complete program B'));
  const firstContract=createCounterHostContract(first),secondContract=createCounterHostContract(second);
  assert.notEqual(first.buildIdentity.digest,second.buildIdentity.digest);
  assert.notEqual(firstContract.contract.digest,secondContract.contract.digest);
  assert.equal(firstContract.contract.buildIdentityDigest,first.buildIdentity.digest);
  assert.throws(()=>verifyCounterHostContract(Buffer.from(firstContract.contractText),second),/contract mismatch/);
  for(const value of [undefined,'not-a-digest']){
    const invalid=identity('tsfg-aot');
    if(value===undefined)delete invalid.buildIdentity.options.programCore;
    else invalid.buildIdentity.options.programCore=value;
    const {digest,...body}=invalid.buildIdentity;
    invalid.buildIdentity.digest=hash(jcs(body));
    assert.throws(()=>createCounterHostContract(invalid),/host-semantic-contract/);
  }
  const vm=identity('tsfg-vm');
  vm.buildIdentity.options.programCore=first.buildIdentity.options.programCore;
  assert.throws(()=>createCounterHostContract(vm),/identity shape/);
});

test('ordinary AOT target admits no other target, changed source or additional identity claim',()=>{
  assert.throws(()=>createCounterHostContract(identity('arbitrary-native')),/unsupported identity/);
  const changed=identity('tsfg-aot');
  changed.buildInputSet.entries[0].sha256='sha256:'+'0'.repeat(64);
  assert.throws(()=>createCounterHostContract(changed),/host-semantic-contract/);
  const claim=identity('tsfg-aot');
  claim.buildIdentity.options.qualified=true;
  assert.throws(()=>createCounterHostContract(claim),/identity shape/);
});

test('AOT consumer admits the published executable role from its output inventory',async t=>{
  const directory=path.join(import.meta.dirname,'aot-role-admission-fixture');
  const {hir}=stringCases()[0],core=Buffer.from(expectedStringCore(hir)),wire=expectedStringPacket(hir);
  const tableIdentity=packet=>hash(Buffer.concat([Buffer.from('tsfg.aot-compiled-module.v4\0'),packet]));
  const object=aotMetadataObject(hir.inputIdentity,tableIdentity(wire));
  // In-memory file admission fixture. These executable/object labels are inert
  // data, and this check never starts the request runner.
  const files=new Map([
    ['tsfg-aot.exe',Buffer.from('test executable row')],
    ['tsfg-aot.pdb',Buffer.from('test debug row')],
    ['program.mlir',core],['program.tbc',wire],['program.obj',object],
  ]);
  const product=new URL('../../',import.meta.url);
  const paths=declarations.entries.filter(row=>row.projectId==='tsfg').map(row=>row.path).sort();
  const entries=await Promise.all(paths.map(async name=>({projectId:'tsfg',repositoryRelativePath:name,
    normalizedMode:'100644',sha256:hash(await fs.readFile(new URL(name,product)))})));
  const {buildIdentity}=identity('tsfg-aot',hash(core));
  const inputs={entries,schemaVersion:'1'};
  const buildInputSet={...inputs,digest:hash(jcs(inputs))};
  buildIdentity.buildInputSetDigest=buildInputSet.digest;
  const {digest:unboundDigest,...body}=buildIdentity;
  buildIdentity.digest=hash(jcs(body));
  const host=createCounterHostContract({buildIdentity,buildInputSet});
  files.set('host-semantic-contract.json',Buffer.from(host.contractText));
  const manifest={buildIdentity,buildInputSet,executionBackend:'aot-v4',
    program:{core:hash(core),bytecode:hash(wire),object:hash(files.get('program.obj')),
      compiledTableId:tableIdentity(wire)},
    outputs:[...files].map(([name,bytes])=>({path:name,sha256:hash(bytes)}))};
  const reads=[],readFile=fs.readFile;
  t.mock.method(fs,'readFile',async (file,...args)=>{
    if(typeof file==='string'&&path.dirname(file)===directory){
      const name=path.basename(file);reads.push(name);
      return name==='artifact-manifest.json'?JSON.stringify(manifest):files.get(name);
    }
    return Reflect.apply(readFile,fs,[file,...args]);
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});

  const executable=path.join(directory,'tsfg-aot.exe');
  assert.equal(await verifiedConsumer(executable,'aot'),executable);
  await t.test('object from another String input is rejected at receipt admission',async()=>{
    const {hir: other}=stringCases()[1],otherWire=expectedStringPacket(other);
    const foreign=aotMetadataObject(other.inputIdentity,tableIdentity(otherWire));
    const objectRow=manifest.outputs.find(row=>row.path==='program.obj');
    assert.ok(objectRow);
    files.set('program.obj',foreign);
    objectRow.sha256=manifest.program.object=hash(foreign);
    try{
      await assert.rejects(verifiedConsumer(executable,'aot'),/r03-aot-object: compiled program identity differs/);
    }finally{
      files.set('program.obj',object);
      objectRow.sha256=manifest.program.object=hash(object);
    }
  });
  await t.test('bytecode from another String input is rejected at receipt admission',async()=>{
    const other=stringCases()[1].hir,otherWire=expectedStringPacket(other);
    assert.notEqual(other.inputIdentity,hir.inputIdentity);
    const wireRow=manifest.outputs.find(row=>row.path==='program.tbc');
    assert.ok(wireRow);
    files.set('program.tbc',otherWire);
    wireRow.sha256=manifest.program.bytecode=hash(otherWire);
    manifest.program.compiledTableId=tableIdentity(otherWire);
    try{
      await assert.rejects(verifiedConsumer(executable,'aot'),/r04-producer-input-identity/);
    }finally{
      files.set('program.tbc',wire);
      wireRow.sha256=manifest.program.bytecode=hash(wire);
      manifest.program.compiledTableId=tableIdentity(wire);
    }
  });
  for(const name of ['program.obj','program.tbc','program.mlir','tsfg-aot.pdb','host-semantic-contract.json'])
    await t.test(name,async()=>{
      reads.length=0;
      await assert.rejects(verifiedConsumer(path.join(directory,name),'aot'),/r03-tool-aot: published executable must be tsfg-aot.exe/);
      assert.deepEqual(reads,[]);
    });
});

test('shared VM/AOT output storage accepts absent owned descendants and preserves builder failure identity',async()=>{
  assert.match(process.env.TMP??'',/^E:[\\/]/i);
  const directory=await mkdtemp(path.join(process.env.TMP,'output-storage-'));
  const file=path.join(directory,'file');
  try{
    const failure=new Error('actual builder-owned identity');
    await requireOrdinaryEAncestor(path.join(directory,'absent','output'),()=>failure);
    await writeFile(file,'not a directory');
    let reason;
    await assert.rejects(requireOrdinaryEAncestor(file,value=>{reason=value;return failure;}),error=>error===failure);
    assert.equal(reason,'invalid');
  }finally{
    await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await rmdir(directory);
  }
});

test('dangling output junction retains the builder integrity failure before realpath',async()=>{
  assert.match(process.env.TMP??'',/^E:[\\/]/i);
  const directory=await mkdtemp(path.join(process.env.TMP,'output-junction-'));
  const link=path.join(directory,'dangling'),missing=path.join(directory,'absent-target');
  let linked=false;
  try{
    await symlink(missing,link,'junction');linked=true;
    const failure=new Error('builder output-integrity');
    let reason;
    await assert.rejects(requireOrdinaryEAncestor(link,value=>{reason=value;return failure;}),error=>error===failure);
    assert.equal(reason,'invalid');
  }finally{
    if(linked)await unlink(link);
    await rmdir(directory);
  }
});
