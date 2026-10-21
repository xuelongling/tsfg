// SPDX-License-Identifier: MIT
// Exact integral spelling, including decimal exponent forms used as indices.
import {numericTokenSyntax} from './float.mjs';
import {check} from './typed-array-schema.mjs';
export function typedArrayInteger(token) {
  check(token.length<=65536,'limit');
  const syntax=numericTokenSyntax(token),sign=syntax.negative?-1n:1n;
  if(syntax.radix)return sign*BigInt(syntax.text.replaceAll('_',''));
  const match=syntax.decimal,fraction=(match[2]??match[3]??'').replaceAll('_','');
  let coefficient=((match[1]??'').replaceAll('_','')+fraction).replace(/^0+/,'');
  if(!coefficient)return 0n;
  let exponent=(match[4]??'0').replaceAll('_',''),negative=exponent.startsWith('-');
  exponent=exponent.replace(/^[+-]/,'').replace(/^0+/,'')||'0';
  check(exponent.length<=6,'literal');
  const trimmed=coefficient.replace(/0+$/,'');
  const scale=(negative?-Number(exponent):Number(exponent))-fraction.length+coefficient.length-trimmed.length;
  check(scale>=0&&trimmed.length+scale<=20,'literal');
  coefficient=trimmed+'0'.repeat(scale);
  return sign*BigInt(coefficient);
}
