// SPDX-License-Identifier: MIT
import {canonical,sha256} from './identity.mjs';
import {formalExceptionModel} from './formal-exception-model.mjs';
import {formalExceptionFunction} from './formal-exception-control.mjs';
// This ordinary representation owns the complete typed program. The embedded
// HIR retains cold Source evidence; it never authorizes SSA or handler edges.
export function emitFormalExceptionCore(input){
  const model=formalExceptionModel(input),{hir,publication}=model,source=hir.sources[0];
  const hirText=canonical(hir)+'\n';
  const moduleAttributes={
    'tsfg_core.version':model.exchange.version,'tsfg_core.input_identity':hir.inputIdentity,
    'tsfg_core.source_hash':source.hash,'tsfg_core.source_path':source.path,'tsfg_core.source_length':source.length,
    'tsfg_core.target':hir.target.target,'tsfg_core.triple':hir.target.triple,'tsfg_core.data_layout':hir.target.llvmDataLayout,
    'tsfg_core.bytecode_schema':model.exchange.bytecodeSchema,
    'tsfg_core.exception_program':{schema:model.schema,version:1,hir:hirText,hir_hash:sha256(hirText)},
  };
  const header=publication.append('module attributes ')+publication.attribute(moduleAttributes)+publication.append(' {\n');
  const functions=hir.functions.map(fn=>formalExceptionFunction(model,fn));
  for(const module of hir.modules)if(module.initialization)functions.push(formalExceptionFunction(model,module));
  publication.reserve(Math.max(0,functions.length-1));
  const footer=publication.append('\n}\n'),text=header+functions.join('\n')+footer;
  if(Buffer.byteLength(text)>model.limits.coreTextBytes)throw new RangeError('r03-formal-exception-core: publication byte limit');
  return text;
}
