// SPDX-License-Identifier: MIT
import path from 'node:path';
import { budget, check, failure, readJson, validateShape, canonical, same, own, sha256, format, schemaHash, compare } from './module-callable-common.mjs';
import { verifySource } from './module-callable-source.mjs';
import { normalizeClosure } from './modules.mjs';
const declarationHash='sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e';
function logicalPath(p,root){check(p.startsWith('/')&&!/[\\:\0]/.test(p)&&p.slice(1).split('/').every(x=>x&&x!=='.'&&x!=='..'),'identity');if(root)check(p.startsWith(root+'/'),'identity');}
function reconstruct(request,packet,origin){
  budget({request,packet,origin});
  const raw=packet?.payload?.facts;
  for(const [array,max]of [[request?.input?.files,65],[raw?.functions,128],[raw?.modules,64],[raw?.symbols,4096]])if(Array.isArray(array))check(array.length<=max,'limit');
  for(const fn of Array.isArray(raw?.functions)?raw.functions:[])if(Array.isArray(fn?.parameters))check(fn.parameters.length<=32,'limit');
  validateShape(request,'request');validateShape(packet,'package');validateShape(origin,'origin');
  check(request.schemaHash===schemaHash&&packet.schemaHash===schemaHash,'identity');
  check(origin.requestSha256===sha256(canonical(request)+'\n')&&origin.responseSha256===sha256(canonical(packet)+'\n'),'identity');
  check(packet.requestId===sha256('tsfg.module-callable-facts.request.v2\0'+canonical(request)),'identity');
  const {packageId,...packageBody}=packet;
  check(packageId===sha256('tsfg.module-callable-facts.package.v2\0'+canonical(packageBody)),'identity');
  const input=request.input,payload=packet.payload;
  const inputIdentity=sha256('tsfg.module-callable-facts.input.v2\0'+canonical(input));
  check(payload.inputIdentity===inputIdentity,'identity');logicalPath(input.sourceRoot);
  let previous='';const files=[];
  for(const f of input.files){
    logicalPath(f.path,input.sourceRoot);check(compare(previous,f.path)<0&&f.sha256===sha256(f.content).slice(7),'identity');previous=f.path;
    files.push({path:f.path,digest:sha256(f.content),byteLength:Buffer.byteLength(f.content),length:f.content.length,positionUnit:'utf16'});
  }
  check(same(files,payload.files)&&same(payload.facts.inputs,files.map(f=>f.path)),'identity');
  const dts=input.files.filter(f=>f.path.endsWith('.d.ts')),ts=input.files.filter(f=>!f.path.endsWith('.d.ts'));
  check(dts.length===1&&dts[0].path===input.sourceRoot+'/minimal-integers-v3.d.ts'&&sha256(dts[0].content)===declarationHash&&same(input.declarations.paths,[dts[0].path]),'identity');
  check(ts.length>=1&&ts.length<=64&&ts.every(f=>f.path.endsWith('.ts'))&&ts.some(f=>f.path===input.rootFile),'identity');
  check(same(normalizeClosure(input.compilationClosure),input.compilationClosure),'identity');
  for(const r of [...input.compilationClosure.roots,...input.compilationClosure.requiredRoots])check(ts.some(f=>f.path===r.sourcePath),'identity');
  try{verifySource(input,payload.facts,payload.annotations,payload.exports);}
  catch(error){if(error.code?.startsWith('r03-module-callable-')||error.code==='r03-d-capability')throw error;failure('source');}
  const snapshot={format:format('tsfg.frontend-module-callable-candidate'),inputIdentity,sourceOrigin:origin,request,package:packet};
  budget(snapshot);return own(JSON.parse(canonical(snapshot)));
}
export function importModuleCallableFacts(requestBytes,packageBytes,origin){
  try{
    budget(origin);const request=readJson(requestBytes),packet=readJson(packageBytes);
    return own({status:'ok',snapshot:reconstruct(request.value,packet.value,origin)});
  }catch(error){
    const e=error.code?.startsWith('r03-module-callable-')||error.code==='r03-d-capability'?error:undefined;
    return own({status:'error',diagnostics:[{code:e?.code??'r03-module-callable-input',message:e?.message??'r03-module-callable-input: invalid module callable candidate',ruleId:e?.ruleId??'r01-input-boundary',phase:e?.phase??'hir',...(e?.primary?{primary:e.primary}:{})}]});
  }
}
export function verifyModuleCallableSnapshot(snapshot){
  budget(snapshot);validateShape(snapshot,'snapshot');check(same(snapshot.format,format('tsfg.frontend-module-callable-candidate')),'identity');
  const rebuilt=reconstruct(snapshot.request,snapshot.package,snapshot.sourceOrigin);
  check(same(snapshot,rebuilt),'identity');return rebuilt;
}
