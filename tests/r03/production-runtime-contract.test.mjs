// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,unlink,rmdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import {requireOrdinaryEAncestor} from '../../eng/output-storage.mjs';
import oracle from './host-counter-semantic-oracle.json' with {type:'json'};
import {createCounterHostContract,verifyCounterHostContract} from '../../eng/host-semantic-contract.mjs';

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
