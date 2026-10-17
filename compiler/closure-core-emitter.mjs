// SPDX-License-Identifier: MIT
import { verifyClosureEnvironments, printClosureEnvironments } from './closure-environments.mjs';
import { sha256 } from './identity.mjs';
import { emitCoreSsaFunction, coreQuote as quote } from './core-ssa-emitter.mjs';
import { closureCoreModel } from './closure-core-model.mjs';

/** Complete Node-only producer for the private typed closure Core candidate.
 * This compiles verified operations to SSA text. It neither parses Core nor
 * executes Source/closures, computes a GC root map or grants wire/ABI authority.
 * @returns {string}
 */
export function emitClosureCore(program, hir) {
  const verified = verifyClosureEnvironments(program, hir);
  const model = closureCoreModel(verified, sha256(printClosureEnvironments(verified, hir)));
  const header = 'module attributes {' + model.moduleAttributes + '} {\n';
  model.reserveText(header);
  const functions = [];
  for (const fn of verified.functions) {
    const policy = model.functionPolicy(fn), core = emitCoreSsaFunction(policy.view, policy.context);
    const parameters = core.entryParameters.map(parameter => parameter.name + ': ' + model.coreType(parameter.type)).join(', ');
    const text = '  func.func @' + quote(model.symbol(fn)) + '(' + parameters + ') -> ' + core.resultType
      + ' attributes {' + model.functionAttributes(fn) + '} {\n' + core.blocksText + '\n  }';
    model.finishFunction(text, core.reservedBodyBytes);
    model.reserveText('\n');
    functions.push(text);
  }
  model.reserveText('}\n');
  return header + functions.join('\n') + '\n}\n';
}
