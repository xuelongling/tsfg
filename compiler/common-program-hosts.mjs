// SPDX-License-Identifier: MIT
// Ambient Source declarations and build-owned semantics meet at this boundary.
// A Host import is never a Source function or an observed callable target.
import {verifyCounterHostContract} from '../eng/host-semantic-contract.mjs';
import {originId,signatureId as sourceSignatureId,sourceRange} from './typed-array-schema.mjs';
import {identifierName} from './module-facts.mjs';
import {signatureId} from './module-callable-common.mjs';
import {commonSourceGrammar} from './common-program-source.mjs';
import {commonIdentity} from './common-program-identities.mjs';
import {commonCheck as check,commonSame as same,commonRecord as record,commonBudget,canonical,own} from './common-program-common.mjs';

export function validateCommonHostDeclarations(payload,sources,types,spend) {
  check(payload.hostImports.length<=1,'host','only the reviewed Counter import is supported');
  const paths=new Set(payload.declarations.paths),ids=new Set();
  for(const host of payload.hostImports){
    spend();const source=sources.get(host.sourcePath);
    check(source&&host.sourcePath.endsWith('.d.ts')&&!paths.has(host.sourcePath)&&!ids.has(host.id),'host');
    paths.add(host.sourcePath);ids.add(host.id);
    check(host.capabilityId===31&&same(host.parameterTypes,['i32'])&&host.returnType==='i32'
      &&types.get('i32')?.kind==='scalar'&&types.get('i32').name==='i32','host','Counter requires the original nominal i32 signature');
    sourceRange(host.declarationRange,source.content);sourceRange(host.nameRange,source.content,host.declarationRange);
    const g=commonSourceGrammar(source,spend),at=g.indices(host.declarationRange),tokens=g.tokens.slice(at.first,at.end);
    spend(tokens.length);check(tokens.length===11&&identifierName(tokens[4].text),'host');
    g.name(host.nameRange,host.name);
    g.sequence(host.declarationRange,['declare','function',host.nameRange,'(',tokens[4].text,':','i32',')',':','i32',';']);
    g.complete([host.declarationRange]);
    check(host.id===originId(host.sourcePath,host.nameRange)&&same(host.signature,{id:sourceSignatureId(host.sourcePath,host.declarationRange),
      sourcePath:host.sourcePath,declarationRange:host.declarationRange,parameters:['i32'],returnType:'i32'}),'host','original ambient declaration/signature differs');
  }
  for(const path of sources.keys()){spend();check(!path.endsWith('.d.ts')||paths.has(path),'host','unrepresented ambient declaration file');}
}

export function commonOwnedHostImports(payload,type,spend) {
  return payload.hostImports.map(host=>{
    spend(host.parameterTypes.length+1);const parameters=host.parameterTypes.map(type),returnType=type(host.returnType);
    const structuralSignature=signatureId({parameters,returns:returnType});
    return {id:commonIdentity('host-import',{sourcePath:host.sourcePath,name:host.name,capabilityId:host.capabilityId,signatureHash:structuralSignature}),
      sourceBinding:host.id,sourcePath:host.sourcePath,name:host.name,capabilityId:host.capabilityId,parameterTypes:parameters,returnType,
      signatureHash:structuralSignature,sourceSignature:structuredClone(host.signature),range:{...host.declarationRange},nameRange:{...host.nameRange}};
  });
}

export function commonHostContext(input,imports,spend) {
  if(!imports.length){check(input===null,'host-context','a Host-free Program has no Host semantics context');return null;}
  commonBudget(input);record(input,['contract','identity']);record(input.identity,['buildIdentity','buildInputSet']);
  const entries=input.identity.buildInputSet.entries;check(Array.isArray(entries)&&entries.length<=4096,'host-context');
  // Charge the complete identity before the verifier scans/copies it.
  spend(entries.length+1);for(const entry of entries){spend(entry.repositoryRelativePath?.length??0);}
  const contractBytes=Buffer.from(canonical(input.contract)+'\n');spend(contractBytes.length);
  const contract=verifyCounterHostContract(contractBytes,input.identity);
  for(const host of imports){spend();check(host.capabilityId===contract.binding.id,'host-context');}
  return own({contract,identity:input.identity});
}

export function commonHostResources(context) {
  return context===null?[]:context.contract.semantics.effects.map(effect=>effect.resource).sort();
}
