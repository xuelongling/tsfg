// SPDX-License-Identifier: MIT
// Ordinary whole-program closure representation. The private adapter remains
// independently versioned; its module identity is never published here.
import descriptor from '../contracts/formal-closure-core-development.json' with {type:'json'};
import {verifyClosureHir} from './closure-hir.mjs';
import {lowerClosureEnvironments,printClosureEnvironments} from './closure-environments.mjs';
import {analyzeClosureTargets} from './closure-targets.mjs';
import {closureCoreModel} from './closure-core-model.mjs';
import {emitClosureProgram} from './closure-core-emitter.mjs';
import {coreExchangeFormat,coreQuote as quote} from './core-ssa-emitter.mjs';
import {canonical,sha256} from './identity.mjs';

export function emitFormalClosureCore(input) {
  const hir=verifyClosureHir(input),program=lowerClosureEnvironments(hir);
  // All lexical roots remain possible external callers. This is conservative
  // compilation membership, not a choice of runtime entry or trusted targets.
  const roots=hir.functions.filter(fn=>fn.lexicalParent===null).map(fn=>fn.id);
  const targets=analyzeClosureTargets(hir,roots);
  if(!targets.complete)throw Object.assign(new TypeError('r03-d-capability: formal closure call targets remain unknown'),
    {code:'r03-d-capability',ruleId:'r01-call-contract',phase:'lowering'});
  const model=closureCoreModel(program,sha256(printClosureEnvironments(program,hir)));
  const manifest={schema:sha256(canonical(descriptor)),version:descriptor.version,
    hir:canonical(hir)+'\n',hir_hash:sha256(canonical(hir)+'\n'),targets:canonical(targets)+'\n'};
  const attributes={
    'tsfg_core.version':coreExchangeFormat.version,'tsfg_core.input_identity':hir.inputIdentity,
    'tsfg_core.source_hash':hir.source.hash,'tsfg_core.source_path':hir.source.path,
    'tsfg_core.target':hir.target.target,'tsfg_core.triple':hir.target.triple,
    'tsfg_core.data_layout':hir.target.llvmDataLayout,'tsfg_core.bytecode_schema':coreExchangeFormat.bytecodeSchema,
  };
  model.moduleAttributes=Object.entries(attributes).map(([key,value])=>key+' = '+quote(value)).join(', ')
    +', tsfg_core.source_length = '+hir.source.content.length+' : i64'
    +', tsfg_core.closure_program = '+model.attribute(manifest)
    +', tsfg_core.closure_tables = '+model.attribute(model.tables);
  return emitClosureProgram(program,model);
}
