// SPDX-License-Identifier: MIT
// Private resource boundaries charge before snapshots, native sorting or text
// expansion. They do not admit Source facts or change a semantic permission.
import {coreQuote} from './mlir-strings.mjs';
import {commonCheck as check} from './common-program-common.mjs';
const order=(a,b)=>a<b?-1:a>b?1:0;
export function commonCollections(spend) {
  const size=source=>Array.isArray(source)?source.length:source.size;
  const map=(source,select=(value,key)=>value)=>{spend(source.size);const result=new Map();for(const [key,value]of source)result.set(key,select(value,key));return result;};
  const set=source=>{spend(size(source));return /** @type {Set<any>} */(new Set(source));};
  const array=source=>{spend(size(source));return /** @type {any[]} */(Array.from(source));};
  const sorted=(source,compare=order)=>{const result=/** @type {any[]} */(array(source));result.sort((a,b)=>{spend();return compare(a,b);});return result;};
  return {map,set,array,sorted};
}
export function commonSortedSubset(wanted,allowed,spend) {
  let index=0;
  for(const id of wanted){spend();while(index<allowed.length){spend();if(allowed[index]>=id)break;index++;}
    spend();if(index===allowed.length||allowed[index]!==id)return false;index++;}
  return true;
}
export function commonTextBudget(spend,byteLimit=8388608,lineLimit=1048576) {
  check(Number.isSafeInteger(byteLimit)&&byteLimit>=0&&byteLimit<=8388608,'limit');
  const chunks=[],quotes=new Map();let bytes=0,failed=false,finished=false;
  const guard=action=>{check(!failed&&!finished,'limit');try{return action();}catch(error){failed=true;throw error;}};
  const width=parts=>{spend(parts.length);let total=0;for(const part of parts){check(typeof part==='string','input');total+=Buffer.byteLength(part);}return total;};
  const reserve=count=>{check(Number.isSafeInteger(count)&&count>=0&&count<=byteLimit-bytes,'limit','Core text byte budget exceeded');bytes+=count;};
  const combine=(parts,separator='')=>guard(()=>{const count=width(parts)+Math.max(0,parts.length-1)*Buffer.byteLength(separator);
    check(count<=byteLimit-bytes&&count<=lineLimit,'limit');return parts.join(separator);});
  const write=(parts,newline)=>guard(()=>{const count=width(parts)+(newline?1:0);if(newline)check(count<=lineLimit,'limit');reserve(count);
    for(const part of parts)chunks.push(part);if(newline)chunks.push('\n');});
  const quote=text=>guard(()=>{
    check(typeof text==='string','input');spend(text.length+1);
    const cached=quotes.get(text);if(cached){check(cached.bytes<=byteLimit-bytes,'limit','Core escaped text byte budget exceeded');return cached.text;}
    let count=2;
    for(const character of text){const code=character.codePointAt(0);count+=character==='"'||character==='\\'||character==='\n'||character==='\t'?2:code<32?3:Buffer.byteLength(character);}
    check(count<=byteLimit-bytes,'limit','Core escaped text byte budget exceeded');spend(count);
    const escaped=coreQuote(text);quotes.set(text,{text:escaped,bytes:count});return escaped;
  });
  return {append:(...parts)=>write(parts,false),line:(...parts)=>write(parts,true),quote,combine,
    finish:()=>guard(()=>{spend(chunks.length);finished=true;quotes.clear();return chunks.join('');})};
}
