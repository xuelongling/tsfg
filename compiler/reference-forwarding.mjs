// SPDX-License-Identifier: MIT
import { record, check, same, array } from './reference-common.mjs';
import { verifyReferenceWitness } from './reference-relations.mjs';
/** Logical inherited parameters keep their real Base declaration anchors. They
 * are distinct owned symbols, never a rebinding or a synthetic Source AST.
 */
export function verifyReferenceForwarding(state) {
  for (const owner of state.classes.values()) {
    const constructor = owner.constructor, forward = constructor.implicitForward;
    if (constructor.kind !== 'implicit-derived') { check(forward === null, 'initialization'); continue; }
    record(forward, ['target','baseSignature','parameters','origin']);
    const base = state.classes.get(owner.base); check(base, 'inheritance');
    const inherited = base.constructor.signature.parameters, own = constructor.signature.parameters;
    check(forward.target === base.constructor.id && same(forward.baseSignature, base.constructor.signature)
      && same(forward.origin, constructor.origin) && same(constructor.origin, owner.origin)
      && own.length === inherited.length, 'forwarding');
    array(forward.parameters); check(forward.parameters.length === own.length, 'forwarding');
    for (const [index, parameter] of own.entries()) {
      const target = inherited[index], mapping = forward.parameters[index];
      record(mapping, ['source','target','compatibility']);
      const symbol = state.symbols.get(parameter.symbol), targetSymbol = state.symbols.get(target.symbol);
      check(parameter.inheritedFrom === target.symbol && same(parameter.origin, target.origin)
        && symbol.kind === 'implicit-parameter' && symbol.name === targetSymbol.name
        && same(symbol.declaration, targetSymbol.declaration)
        && mapping.source === parameter.symbol && mapping.target === target.symbol, 'forwarding');
      verifyReferenceWitness(state, mapping.compatibility, parameter.type, target.type, forward.origin);
    }
  }
}
