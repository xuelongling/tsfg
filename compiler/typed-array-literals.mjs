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

// Lossless decoding of one bounded original string token, never source parsing
// or evaluation. Presence keys use the same code-unit vocabulary as literals.
export function typedArrayStringUnits(token) {
  check(token.length<=1048576,'limit');
  const quote=token[0];check(['"',"'"].includes(quote)&&token.at(-1)===quote,'literal');
  const result=[];
  for(let index=1;index<token.length-1;index++) {
    let character=token[index];
    check(character!==quote&&!/[\r\n]/.test(character),'literal');
    if(character!=='\\'){result.push(token.charCodeAt(index));continue;}
    character=token[++index];check(index<token.length-1,'literal');
    if(/[\r\n\u2028\u2029]/.test(character)) {
      if(character==='\r'&&token[index+1]==='\n')index++;
      continue;
    }
    if(character==='u'||character==='x') {
      const braced=character==='u'&&token[index+1]==='{',start=index+(braced?2:1);
      const end=braced?token.indexOf('}',start):start+(character==='u'?4:2),digits=token.slice(start,end);
      check(end>start&&(braced?end<token.length-1:end<=token.length-1)&&/^[0-9a-fA-F]+$/.test(digits)
        &&(braced?digits.length<=6:digits.length===(character==='u'?4:2)),'literal');
      const point=Number.parseInt(digits,16);check(point<=0x10ffff,'literal');
      const decoded=String.fromCodePoint(point);for(let n=0;n<decoded.length;n++)result.push(decoded.charCodeAt(n));
      index=braced?end:end-1;
    }else {
      check(!/[1-9]/.test(character)&&(character!=='0'||!/[0-9]/.test(token[index+1])),'literal');
      result.push((({b:'\b',f:'\f',n:'\n',r:'\r',t:'\t',v:'\v',0:'\0'})[character]??character).charCodeAt(0));
    }
  }
  return result;
}
