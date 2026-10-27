// SPDX-License-Identifier: MIT
import {commonProgramPhysical} from './common-program-physical.mjs';
import {printCommonFunction} from './common-program-print.mjs';
import {verifyCommonKernelGroup} from './common-program-analysis.mjs';
import {commonCheck as check,commonBudget,canonical,sha256,own} from './common-program-common.mjs';
import {commonTextBudget} from './common-program-budget.mjs';
// This existing private v3 profile keeps its exact Root base header. It does not
// adopt that header as the dev formal bytecode contract.
const coreExchangeFormat=Object.freeze({version:"0.12.0",
  bytecodeSchema:"sha256:fec456a47f509480d96f65e5c03d465c7c204d60f09630e71b19c714d4aaafa7"});
// The static development module carries the complete owned artifact and one
// actual SSA graph. It has no bytecode, Runtime or wire execution qualification.
export function commonProgramCore(input,publication,request,options={borrowProof:false}) {
  const proof=verifyCommonKernelGroup(input,publication,request),program=commonProgramPhysical(input,new Map(publication.contracts.map(row=>[row.functionId,row])),options),{model,plans,carriers}=program;
  const representationRecord=carriers.record();commonBudget(representationRecord);
  const hir=canonical(model.hir),representation=canonical(representationRecord),text=commonTextBudget(model.spend,model.limits.bytes);
  const source=model.hir.sources.find(row=>row.path===model.hir.rootFile);check(source,'source');
  const ordinary={'tsfg_core.version':coreExchangeFormat.version,'tsfg_core.input_identity':model.hir.inputIdentity,
    'tsfg_core.source_hash':source.hash,'tsfg_core.source_path':source.path,'tsfg_core.source_length':source.content.length,
    'tsfg_core.target':model.hir.target.target,'tsfg_core.triple':model.hir.target.triple,'tsfg_core.data_layout':model.hir.target.llvmDataLayout,
    'tsfg_core.bytecode_schema':coreExchangeFormat.bytecodeSchema};
  text.append('module attributes {');let first=true;
  for(const [key,value]of Object.entries(ordinary)){text.append(first?'':', ',key,' = ');first=false;text.append(typeof value==='number'?value+' : i64':text.quote(value));}
  text.append(', tsfg_program.program = {family = ',text.quote('tsfg.core-program-development'),', version = 3 : i32');
  const marker={schema:model.schema,hir,hir_hash:sha256(hir+'\n'),representation,representation_hash:sha256(representation+'\n')};
  for(const [key,value]of Object.entries(marker)){text.append(', ',key,' = ');text.append(text.quote(value));}
  for(const [key,value]of Object.entries({publication,request,proof})){text.append(', ',key,' = ');text.append(text.quote(canonical(value)));}
  text.append('}} {\n');
  const projection=options.borrowProof?program.values.actual.borrows.projection:null;
  for(const [index,plan]of plans.entries()){if(index)text.append('\n');printCommonFunction(plan,model,carriers,text,projection);}
  /** @type {import('./common-program-borrow-proof.mjs').CommonBorrowProof|null} */
  let borrowProof=null;
  if(options.borrowProof){const hir=model.hir,functions=plans.map(({owner})=>({functionId:owner.id,sourceBinding:owner.sourceBinding??null,signatureHash:owner.signatureHash,source:{path:owner.sourcePath,...owner.range}})).sort((a,b)=>a.functionId<b.functionId?-1:a.functionId>b.functionId?1:0);
    const result={family:/** @type {'tsfg.common-borrow-proof-candidate'} */('tsfg.common-borrow-proof-candidate'),version:/** @type {1} */(1),inputIdentity:hir.inputIdentity,hirDigest:proof.hirDigest,scopeDigest:publication.scopeDigest,publishedDigest:publication.expectedDigest,
      request:{targets:[...request.targets]},target:hir.target,sources:hir.sources.map(({path,hash})=>({path,hash})),functions,events:projection.finish()};
    commonBudget(result);borrowProof=own(result);
  }
  text.append('\n}\n');return {text:text.finish(),proof,representation:representationRecord,hir:model.hir,borrowProof};
}
export const emitCommonProgramCore=(hir,publication,request)=>commonProgramCore(hir,publication,request).text;
