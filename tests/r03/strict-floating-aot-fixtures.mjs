// SPDX-License-Identifier: MIT
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import baseline from './aot-compiler-fixtures.mjs';
export const oracle=JSON.parse(readFileSync(new URL('./strict-floating-aot-oracle.json',import.meta.url),'utf8'));
const sha=s=>createHash('sha256').update(s).digest('hex');
export const type=t=>t==='bool'?'i1':t==='string'?'!tsfg_string.string':t==='i32'||t==='f32'||t==='f64'?t:'!tsfg_core.integer<"'+t+'">';
const span='tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64';
export const ret=(v,t)=>'"func.return"('+v+') {'+span+'} : ('+type(t)+') -> ()';
export const constant=(v,t,bits)=>v+' = "tsfg_core.constant"() {value = "'+bits+'", '+span+'} : () -> '+t;
export const operation=(v,name,args,t,result=t)=>v+' = "tsfg_core.'+name+'"('+args.join(', ')+') {'+span+'} : ('+args.map(()=>type(t)).join(', ')+') -> '+type(result);
export function call(v,name,args,params,result){const sig=sha('tsfg.signature\0('+params.join(',')+')->'+result),id=sha('tsfg.function\0/src/main.ts\0'+name+'\0'+sig);return v+' = func.call @'+name+'('+args.join(', ')+') {tsfg_core.function_id = "sha256:'+id+'", tsfg_core.signature_hash = "sha256:'+sig+'", '+span+'} : ('+params.map(type).join(', ')+') -> '+type(result);}
export function fn(name,parameters,result,body){
 const sig=sha('tsfg.signature\0('+parameters.join(',')+')->'+result),id=sha('tsfg.function\0/src/main.ts\0'+name+'\0'+sig);
 const attrs='tsfg_core.function_id = "sha256:'+id+'", tsfg_core.signature_hash = "sha256:'+sig+'", tsfg_core.type_id = "sha256:'+sha('tsfg.type\0'+result)+'", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 100 : i64';
 return {name,parameters,result,text:'func.func @'+name+'('+parameters.map((p,i)=>'%a'+i+': '+type(p)).join(', ')+') -> '+type(result)+' attributes {'+attrs+'} {\n"tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 100 : i64} : () -> ()\n'+body+'\n}'};
}
export function moduleOf(functions){const header=baseline.minimal.slice(0,baseline.minimal.indexOf('\nfunc.func')).replace('source_length = 42','source_length = 100');return {input:header+'\n'+functions.map(f=>f.text).join('\n')+'\n}\n',functions};}
const functions=[];
for(const t of ['f32','f64'])functions.push(fn('identity_'+t,[t],t,ret('%a0',t)));
for(const row of oracle.arithmeticCases){const name=({positive:'pos',negative:'neg',fmod:'rem'})[row.operation]??row.operation;const args=name==='neg'||name==='pos'?['%a0']:['%a0','%a1'];functions.push(fn(row.id.replaceAll('-','_'),args.map(()=>row.type),row.type,operation('%r',name,args,row.type)+'\n'+ret('%r',row.type)));}
export const whole=moduleOf(functions);
const extra=[];
for(const row of oracle.comparisonCases)for(const name of Object.keys(row.expected))extra.push(fn(row.id.replaceAll('-','_')+'_'+name,[row.type,row.type],'bool',operation('%r',name,['%a0','%a1'],row.type,'bool')+'\n'+ret('%r','bool')));
for(const row of oracle.rawTransportCases)extra.push(fn(row.id.replaceAll('-','_'),[],row.type,constant('%raw',row.type,row.inputBits)+'\n'+call('%r','identity_'+row.type,['%raw'],[row.type],row.type)+'\n'+ret('%r',row.type)));
for(const t of ['f32','f64']){
 const params=[t,t,t];
 extra.push(fn('separate_'+t,params,t,operation('%product','mul',['%a0','%a1'],t)+'\n'+operation('%sum','add',['%product','%a2'],t)+'\n'+ret('%sum',t)));
 const addName='add_step_'+t;
 extra.push(fn(addName,[t,t],t,operation('%sum','add',['%a0','%a1'],t)+'\n'+ret('%sum',t)));
 extra.push(fn('round_each_'+t,[t,t],t,call('%first',addName,['%a0','%a1'],[t,t],t)+'\n'+call('%second',addName,['%first','%a1'],[t,t],t)+'\n'+ret('%second',t)));
 extra.push(fn('parallel_phi_'+t,[t,t,'bool'],t,'cf.cond_br %a2, ^one(%a1, %a0 : '+t+', '+t+'), ^two(%a0, %a1 : '+t+', '+t+') {'+span+'}\n^one(%x: '+t+', %y: '+t+'):\ncf.br ^join(%y, %x : '+t+', '+t+') {'+span+'}\n^two(%p: '+t+', %q: '+t+'):\ncf.br ^join(%p, %q : '+t+', '+t+') {'+span+'}\n^join(%first: '+t+', %second: '+t+'):\n'+ret('%first',t)));
 extra.push(fn('compare_branch_'+t,[t,t],t,operation('%test','ne',['%a0','%a1'],t,'bool')+'\ncf.cond_br %test, ^yes, ^no {'+span+'}\n^yes:\n'+call('%r','identity_'+t,['%a0'],[t],t)+'\n'+ret('%r',t)+'\n^no:\n'+ret('%a1',t)));
 const recursive='recursive_'+t;
 extra.push(fn(recursive,[t,'bool'],t,'cf.cond_br %a1, ^again, ^join(%a0 : '+t+') {'+span+'}\n^again:\n%false = "tsfg_core.constant"() {value = 0 : i1, '+span+'} : () -> i1\n'+operation('%neg','neg',['%a0'],t)+'\n'+call('%r',recursive,['%neg','%false'],[t,'bool'],t)+'\ncf.br ^join(%r : '+t+') {'+span+'}\n^join(%joined: '+t+'):\n'+ret('%joined',t)));
}
const mixed=oracle.abi.mixed64.orderedTypes;
for(const row of oracle.abi.mixed64.calls){const t=row.expectedResult.type,target='mixed64_'+t;extra.push(fn(target,mixed,t,ret('%a'+row.argumentIndex,t)));extra.push(fn('relay64_'+t,mixed,t,call('%r',target,mixed.map((_,i)=>'%a'+i),mixed,t)+'\n'+ret('%r',t)));}
export const complete=moduleOf([...functions,...extra]);
export const table=n=>moduleOf(Array.from({length:n},(_,i)=>{const t=i%2?'f32':'f64';return fn('table_'+i,[t],t,ret('%a0',t));}));
export const unsupported=moduleOf([...functions,fn('unsupported',['string'],'string',ret('%a0','string'))]);
