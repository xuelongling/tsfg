// SPDX-License-Identifier: MIT
import { skipCallTrivia } from "./module-facts.mjs";
/** Peel explicit owned parentheses; assertions and other expressions stay intact. */
export function expressionLeaf(value) {
  for (let depth = 0; value?.kind === "group" && depth < 256; depth++) value = value.operand;
  return value;
}

export function localReferenceTarget(value) {
  value = expressionLeaf(value);
  return value?.kind === "reference" ? value : null;
}

export function hasOnlyToken(source, token) {
  const index = skipCallTrivia(source);
  return index >= 0 && source.startsWith(token, index)
    && skipCallTrivia(source.slice(index + token.length)) === source.length - index - token.length;
}
