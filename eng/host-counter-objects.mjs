// SPDX-License-Identifier: MIT
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {canonical,own} from '../compiler/identity.mjs';
import profileData from '../contracts/host-counter-semantic-v1.json' with {type:'json'};
import {inspectCounterObject,inspectCounterBridgeObject} from './host-counter-binary.mjs';

const digest=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const reject=()=>{throw new TypeError('vm-host-certificate: unknown code, ABI, stack or producer identity');};
const profile=own(profileData),hashPattern=/^sha256:[0-9a-f]{64}$/;

// This gate binds the exact reviewed source bytes, not a caller's MC label.
// The second pass compares policy with strict facts from the actual objects.
export function validateCounterSourceBinding(lock,before,objects=undefined) {
  if(lock?.schemaVersion!=='1'||lock.status!=='admitted'||lock.summaryVersion!=='tsfg-host-cost-v1'
    ||lock.issuer!=='tsfg-compiler-control-plane'||lock.purpose!=='runtime-owned-counter-call-graph-mc'
    ||lock.authorityDomain!=='fixed-runtime-counter-leaf-and-owned-bridge-only'||lock.protocolVersion!=='0.2.0'
    ||lock.inputFormat!=='AMD64-COFF'||lock.maxInputBytes!==16777216
    ||canonical(lock.adapterSources)!==canonical(profile.implementation))reject();
  const binding=lock.adapterSourceBinding;
  if(binding?.algorithm!=='sha256(UTF8(tsfg.host-counter-source-binding.v1 + NUL + JCS({adapterSources,priorProofIdentity})))'
    ||!hashPattern.test(binding.priorProofIdentity??'')||binding.producerRoleUnchanged!==true
    ||binding.qualification!=='fixed-counter-fragment-only; additional admitted Runtime phase remains unqualified')reject();
  const identity=digest('tsfg.host-counter-source-binding.v1\0'+canonical({adapterSources:lock.adapterSources,priorProofIdentity:binding.priorProofIdentity}));
  if(binding.currentProofIdentity!==identity||lock.proofIdentity!==identity
    ||lock.adapterSources[0].sha256!==before.sourceHash||lock.adapterSources[1].sha256!==before.bridgeSourceHash)reject();
  if(!Array.isArray(lock.adapterCodePolicy)||lock.adapterCodePolicy.length!==2)reject();
  for(const [role,symbol] of [['leaf','tsfg_host_counter'],['bridge','tsfg_host_counter_bridge']]) {
    const policies=lock.adapterCodePolicy.filter(policy=>policy?.role===role),policy=policies[0];
    if(policies.length!==1||policy.symbol!==symbol||!hashPattern.test(policy.codeHash??'')
      ||!Number.isSafeInteger(policy.instructionUpperBound)||policy.instructionUpperBound<1
      ||!Number.isSafeInteger(policy.calleeStackBytes)||policy.calleeStackBytes<0)reject();
    if(objects) {
      const facts=objects[role];
      if(!facts||facts.symbol!==policy.symbol||facts.codeHash!==policy.codeHash
        ||facts.instructionUpperBound!==policy.instructionUpperBound||facts.calleeStackBytes!==policy.calleeStackBytes)reject();
    }
  }
}

// Compile the same fixed Counter sources with the locked compiler/header closure.
// Object facts remain independent of the optional MC and Runtime proof chains.
export async function prepareCounterObjects({productRoot,product,stage,tools,environment,run}) {
  const object=path.join(stage,'host_counter.obj'),source=path.join(product,'runtime/host_counter.c');
  const bridgeObject=path.join(stage,'host_counter_bridge.obj'),bridgeSource=path.join(product,'runtime/host_counter_bridge.c');
  const sourceBytes=await readFile(source),bridgeBytes=await readFile(bridgeSource);
  const lockPath=path.join(productRoot,'eng/host-cost-source.lock.json'),lockBytes=await readFile(lockPath);
  const lock=own(JSON.parse(lockBytes.toString('utf8')));
  const sourceHashes={sourceHash:digest(sourceBytes),bridgeSourceHash:digest(bridgeBytes)};
  validateCounterSourceBinding(lock,sourceHashes);
  const compilerBytes=await readFile(tools.clangcl);
  const relativeHeaders=['llvm/lib/clang/22/include/stdint.h','msvc-tools/VC/Tools/MSVC/14.44.35207/include/stdint.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/vcruntime.h','msvc-tools/VC/Tools/MSVC/14.44.35207/include/sal.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/concurrencysal.h','llvm/lib/clang/22/include/vadefs.h',
    'msvc-tools/VC/Tools/MSVC/14.44.35207/include/vadefs.h'];
  const closure=path.resolve(path.dirname(tools.clangcl),'../..');
  const headers=await Promise.all(relativeHeaders.map(async name=>{const file=path.join(closure,name);return {path:file,sha256:digest(await readFile(file))};}));
  const before={compiler:tools.clangcl,compilerHash:digest(compilerBytes),sourceHash:digest(sourceBytes),bridgeSourceHash:digest(bridgeBytes),headers};
  await writeFile(path.join(stage,'host.before.json'),JSON.stringify(before,null,2)+'\n');
  const args=['/nologo','/c','/O2','/GS-','/Zl','/Brepro','/showIncludes','/clang:-fno-ident',source,`/Fo${object}`];
  const result=await run({executable:tools.clangcl,args,cwd:product,environment:{...environment,INCLUDE:tools.include.join(';')},label:'host-counter'});
  if(result.code!==0)reject();
  const bridgeArgs=[...args.slice(0,-2),bridgeSource,`/Fo${bridgeObject}`];
  const bridgeResult=await run({executable:tools.clangcl,args:bridgeArgs,cwd:product,environment:{...environment,INCLUDE:tools.include.join(';')},label:'host-counter-bridge'});
  if(bridgeResult.code!==0)reject();
  for(const label of ['host-counter','host-counter-bridge']){
  const trace=(await readFile(path.join(stage,`${label}.log`),'utf8')).split(/\r?\n/)
    .flatMap(line=>{const match=/^Note: including file:\s+(.+)$/.exec(line);return match?[path.resolve(match[1].trim())]:[];});
  if(new Set(trace).size!==headers.length||trace.some(file=>!headers.some(h=>h.path.toLowerCase()===file.toLowerCase())))reject();
  }
  for(const header of headers)if(digest(await readFile(header.path))!==header.sha256)reject();
  if(digest(await readFile(source))!==before.sourceHash||digest(await readFile(bridgeSource))!==before.bridgeSourceHash||digest(await readFile(tools.clangcl))!==before.compilerHash)reject();
  const leaf=inspectCounterObject(await readFile(object)),bridge=inspectCounterBridgeObject(await readFile(bridgeObject));
  if(!lockBytes.equals(await readFile(lockPath)))reject();
  validateCounterSourceBinding(lock,before,{leaf,bridge});
  return {object,bridgeObject,leaf,bridge,before,sourceLockHash:digest(lockBytes)};
}
