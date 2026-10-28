// SPDX-License-Identifier: MIT
// Root-authored nominal/slot expectations precede this structural Core authoring.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const oracle=JSON.parse(await readFile(new URL('./full-integer-abi-oracle.json',import.meta.url),'utf8'));
import baseline from './aot-compiler-fixtures.mjs';
export {oracle};
const sha=s=>createHash('sha256').update(s).digest('hex');
export const type=name=>name==='i32'?'i32':name==='bool'?'i1':'!tsfg_core.integer<"'+name+'">';
const span='tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64';
const fuel='"tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 100 : i64} : () -> ()';
const ret=(value,t)=>'"func.return"('+value+') {tsfg_source.start = 80 : i64, tsfg_source.end = 90 : i64} : ('+type(t)+') -> ()';
const call=(name,args,params,result)=>{
 const signature=sha('tsfg.signature\0('+params.join(',')+')->'+result),id=sha('tsfg.function\0/src/main.ts\0'+name+'\0'+signature);
 return 'func.call @'+name+'('+args.join(', ')+') {tsfg_core.function_id = "sha256:'+id+'", tsfg_core.signature_hash = "sha256:'+signature+'", '+span+'} : ('+params.map(type).join(', ')+') -> '+type(result);
};
function fn(name,parameters,result,body,/** @type {any} */expected={}){
 const signature=sha('tsfg.signature\0('+parameters.join(',')+')->'+result),id=sha('tsfg.function\0/src/main.ts\0'+name+'\0'+signature);
 const attrs='tsfg_core.function_id = "sha256:'+id+'", tsfg_core.signature_hash = "sha256:'+signature+'", tsfg_core.type_id = "sha256:'+sha('tsfg.type\0'+result)+'", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 100 : i64';
 return {name,parameters,result,expected,text:'func.func @'+name+'('+parameters.map((p,i)=>'%a'+i+': '+type(p)).join(', ')+') -> '+type(result)+' attributes {'+attrs+'} {\n'+fuel+'\n'+body+'\n}'};
}
export function moduleOf(functions){
 const header=baseline.minimal.slice(0,baseline.minimal.indexOf('\nfunc.func')).replace('source_length = 42','source_length = 100');
 return {input:header+'\n'+functions.map(f=>f.text).join('\n')+'\n}\n',functions,signatures:functions.map(f=>({parameters:f.parameters.map(p=>oracle.kinds.find(k=>k.name===p).code),result:oracle.kinds.find(k=>k.name===f.result).code}))};
}
const functions=[];
for(const row of oracle.validSlots){
 const t=type(row.type),value=row.typeCode<=2?row.mathematicalValue+' : '+t:JSON.stringify(row.mathematicalValue);
 functions.push(fn('constant_'+functions.length,[],row.type,'%v = "tsfg_core.constant"() {value = '+value+', '+span+'} : () -> '+t+'\n'+ret('%v',row.type),{kind:'constant',...row}));
}
for(const k of oracle.kinds)functions.push(fn('identity_'+k.name,[k.name],k.name,ret('%a0',k.name),{kind:'identity'}));
for(const k of oracle.kinds){
 const t=type(k.name),name='recursive_'+k.name;
 const body='cf.cond_br %a1, ^again, ^join(%a0 : '+t+') {'+span+'}\n^again:\n%false = "tsfg_core.constant"() {value = 0 : i1, '+span+'} : () -> i1\n%r = '+call(name,['%a0','%false'],[k.name,'bool'],k.name)+'\ncf.br ^join(%r : '+t+') {'+span+'}\n^join(%joined: '+t+'):\n'+ret('%joined',k.name);
 functions.push(fn(name,[k.name,'bool'],k.name,body,{kind:'recursive'}));
}
for(const k of oracle.kinds)functions.push(fn('relay_'+k.name,[k.name],k.name,'%r = '+call('identity_'+k.name,['%a0'],[k.name],k.name)+'\n'+ret('%r',k.name),{kind:'relay'}));
const mixed=Array.from({length:64},(_,i)=>oracle.kinds[i%oracle.kinds.length].name);
functions.push(fn('mixed64',mixed,mixed[63],ret('%a63',mixed[63]),{kind:'mixed64'}));
export const whole=moduleOf(functions);
export const tables=Object.fromEntries([128,129,512,513].map(n=>[n,moduleOf(Array.from({length:n},(_,i)=>fn('table_'+i,['u64'],'u64',ret('%a0','u64'))))]));
