// SPDX-License-Identifier: MIT
import {commonConstructionPhysical} from './common-program-physical.mjs';
import {commonProgramPlan} from './common-program-plan.mjs';
import {requireCommonCoreConstructionPlans,commonPublicCoreRepresentation} from './common-program-construction-plans.mjs';
import {printCommonFunction} from './common-program-print.mjs';
import {verifyCommonKernelGroup} from './common-program-analysis.mjs';
import {commonCheck as check,commonBudget,commonMeter,sha256,own} from './common-program-common.mjs';
import {commonTextBudget} from './common-program-budget.mjs';
import {coreExchangeFormat} from './core-ssa-emitter.mjs';
import {commonCoreFormat,commonCoreSchema} from './common-program-plan.mjs';
/** @typedef {{[key:string]:WriterJson}} WriterJsonObject */
/** @typedef {Array<WriterJson>} WriterJsonArray */
/** @typedef {null|boolean|number|string|WriterJsonArray|WriterJsonObject} WriterJson */
/** @typedef {{json:string,quoted:string|null}} WriterToken */
/** @typedef {{kind:'raw',text:string}|{kind:'verified',json:WriterJson,digest:string}} WriterHir */
// Already admitted JSON only. Emit canonical tokens once into a flat list:
// no duplicate preflight walk or enclosing-container JSON string joins.
// Every traversal, comparison, escaped token and final join is prepaid.
/** @param {WriterJson} value @param {(amount:number)=>void} spend @param {Map<string,WriterToken>} encoded
 * @param {null|((value:string)=>string)} [quote] */
function canonicalWriterJson(value,spend,encoded,quote=null) {
  spend(1);const chunks=[];let length=0;
  const append=part=>{spend(1);chunks.push(part);length+=part.length;};
  const emitString=token=>{
    if(quote===null){append(token.json);return;}
    if(token.quoted===null){const quoted=quote(token.json);spend(quoted.length-1);token.quoted=quoted.slice(1,-1);}
    append(token.quoted);
  };
  const string=text=>{
    spend(text.length+1);const cached=encoded.get(text);
    if(cached!==undefined){emitString(cached);return;}
    spend(text.length+1);let size=2;
    for(let index=0;index<text.length;index++){
      const code=text.charCodeAt(index);
      if(code>=0xd800&&code<=0xdbff){
        const next=text.charCodeAt(index+1);
        if(!(next>=0xdc00&&next<=0xdfff))throw new TypeError('canonical input contains a lone surrogate');
        size+=2;index++;
      }else if(code>=0xdc00&&code<=0xdfff)throw new TypeError('canonical input contains a lone surrogate');
      else size+=code===34||code===92||code===8||code===9||code===10||code===12||code===13?2:code<32?6:1;
    }
    spend(size+2);const token={json:JSON.stringify(text),quoted:null};encoded.set(text,token);emitString(token);
  };
  /** @param {WriterJson} item */
  const visit=item=>{
    spend(1);
    if(typeof item==='string'){string(item);return;}
    if(item===null||typeof item==='boolean'){append(item===null?'null':item?'true':'false');return;}
    if(typeof item==='number'){spend(24);append(JSON.stringify(item));return;}
    if(Array.isArray(item)){
      append('[');spend(item.length);
      for(let index=0;index<item.length;index++){if(index)append(',');visit(item[index]);}append(']');
    }else{
      spend(1);const keys=[];
      for(const key in item){spend(1);keys.push(key);}
      spend(keys.length);keys.sort((a,b)=>{spend(a.length+b.length+1);return a<b?-1:a>b?1:0;});
      append('{');spend(keys.length);
      for(let index=0;index<keys.length;index++){if(index)append(',');const key=keys[index];string(key);append(':');visit(item[key]);}append('}');
    }
  };
  if(quote!==null)append('"');visit(value);if(quote!==null)append('"');
  spend(chunks.length+length);return chunks.join('');
}
// Typed marker serialization only: callers retain complete admission ownership.
// Private profile4 is a draft; the inherited outer exchange header does not
// authorize receiver operations in the existing formal wire.
/** @param {{append:(...parts:string[])=>void,quote:(value:string)=>string}} text
 * @param {{representation:string,publication:WriterJson,request:WriterJson,proof:WriterJson}} parts
 * @param {(amount:number)=>void} spend
 * @param {WriterHir} hir
 * @param {Map<string,WriterToken>} encoded */
function writeCommonProgramMarker(text,parts,spend,hir,encoded) {
  text.append(', ',commonCoreFormat.marker,' = {family = ',text.quote(commonCoreFormat.family),', version = ',String(commonCoreFormat.version),' : i32');
  const hashWithLF=value=>{
    // Prepay the UTF-8 length scan, then the actual LF concatenation, byte
    // encoding and hash input. ASCII metadata needs no worst-case expansion.
    spend(value.length+1);const bytes=Buffer.byteLength(value);
    spend(value.length+1+2*(bytes+1));return sha256(value+'\n');
  };
  // Only commonProgramCore supplies this digest: verifyCommonKernelGroup
  // already hashed the same independently reconstructed, immutable HIR+LF.
  // The public raw-string formatter always computes its own LF digest.
  if(hir.kind==='verified')spend(hir.digest.length+1);
  const hirHash=hir.kind==='verified'?hir.digest:hashWithLF(hir.text),representationHash=hashWithLF(parts.representation);
  text.append(', schema = ',text.quote(commonCoreSchema),', hir = ');
  // Verified HIR already has its digest. Emit its canonical tokens directly
  // inside one MLIR string, avoiding a raw HIR join and whole-string re-escape.
  text.append(hir.kind==='verified'?canonicalWriterJson(hir.json,spend,encoded,text.quote):text.quote(hir.text));
  const marker={hir_hash:hirHash,representation:parts.representation,representation_hash:representationHash};
  for(const [key,value]of Object.entries(marker)){text.append(', ',key,' = ');text.append(text.quote(value));}
  for(const [key,value]of Object.entries({publication:parts.publication,request:parts.request,proof:parts.proof})){text.append(', ',key,' = ');text.append(text.quote(canonicalWriterJson(value,spend,encoded)));}
  text.append('}');
}
/** @param {{append:(...parts:string[])=>void,quote:(value:string)=>string}} text
 * @param {{hir:string,representation:string,publication:WriterJson,request:WriterJson,proof:WriterJson}} parts
 * @param {(amount:number)=>void} spend */
export function appendCommonProgramMarker(text,parts,spend){spend(2);writeCommonProgramMarker(text,parts,spend,{kind:'raw',text:parts.hir},new Map());}
// The complete owned artifact and actual SSA graph use the current registered
// exchange header; profile4 is unadopted and no formal-wire authority follows.
export function commonProgramCore(input,publication,request,options={borrowProof:false}) {
  const proof=verifyCommonKernelGroup(input,publication,request),records=new Map(publication.contracts.map(row=>[row.functionId,row])),
    planned=commonProgramPlan(input,records),plans=requireCommonCoreConstructionPlans(planned),program=commonConstructionPhysical(planned,records,options),{model,carriers}=program;
  check(!options.borrowProof||plans.length===planned.corePlans.length,'construction-borrow-open','internal helper provenance is not represented by the public borrow proof');
  const representationRecord=commonPublicCoreRepresentation(program,carriers);commonBudget(representationRecord);
  // One writer budget covers the complete module. Analysis keeps its original
  // meter; neither phase refills the other or resets at a function boundary.
  const writerMeter=commonMeter(model.limits.work);writerMeter(1);
  const encoded=new Map(),text=commonTextBudget(writerMeter,model.limits.bytes);
  const representation=canonicalWriterJson(representationRecord,writerMeter,encoded);
  const source=model.hir.sources.find(row=>row.path===model.hir.rootFile);check(source,'source');
  const ordinary={'tsfg_core.version':coreExchangeFormat.version,'tsfg_core.input_identity':model.hir.inputIdentity,
    'tsfg_core.source_hash':source.hash,'tsfg_core.source_path':source.path,'tsfg_core.source_length':source.content.length,
    'tsfg_core.target':model.hir.target.target,'tsfg_core.triple':model.hir.target.triple,'tsfg_core.data_layout':model.hir.target.llvmDataLayout,
    'tsfg_core.bytecode_schema':coreExchangeFormat.bytecodeSchema};
  text.append('module attributes {');let first=true;
  for(const [key,value]of Object.entries(ordinary)){text.append(first?'':', ',key,' = ');first=false;text.append(typeof value==='number'?value+' : i64':text.quote(value));}
  writerMeter(1);writeCommonProgramMarker(text,{representation,publication,request,proof},writerMeter,
    {kind:'verified',json:model.hir,digest:proof.hirDigest},encoded);
  text.append('} {\n');
  const projection=options.borrowProof?program.values.actual.borrows.projection:null;
  for(const [index,plan]of plans.entries()){if(index)text.append('\n');printCommonFunction(plan,model,carriers,text,projection);}
  /** @type {import('./common-program-borrow-proof.mjs').CommonBorrowProof|null} */
  let borrowProof=null;
  if(options.borrowProof){const hir=model.hir,functions=planned.corePlans.map(({owner})=>({functionId:owner.id,sourceBinding:owner.sourceBinding??null,signatureHash:owner.signatureHash,source:{path:owner.sourcePath,...owner.range}})).sort((a,b)=>a.functionId<b.functionId?-1:a.functionId>b.functionId?1:0);
    const result={family:/** @type {'tsfg.common-borrow-proof-candidate'} */('tsfg.common-borrow-proof-candidate'),version:/** @type {1} */(1),inputIdentity:hir.inputIdentity,hirDigest:proof.hirDigest,scopeDigest:publication.scopeDigest,publishedDigest:publication.expectedDigest,
      request:{targets:[...request.targets]},target:hir.target,sources:hir.sources.map(({path,hash})=>({path,hash})),functions,events:projection.finish()};
    commonBudget(result);borrowProof=own(result);
  }
  text.append('\n}\n');return {text:text.finish(),proof,representation:representationRecord,hir:model.hir,borrowProof};
}
export const emitCommonProgramCore=(hir,publication,request)=>commonProgramCore(hir,publication,request).text;
