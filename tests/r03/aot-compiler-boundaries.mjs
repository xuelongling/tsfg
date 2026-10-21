// SPDX-License-Identifier: MIT
// Fresh structural Core0.9 data, using the independent public identity formulas.
// No Source qualification is claimed and no old capture is re-signed.
import {createHash} from 'node:crypto';
const sha=text=>createHash('sha256').update(text).digest('hex');
const type=name=>name==='bool'?'i1':name==='i32'?'i32':'!tsfg_core.integer<"'+name+'">';
export function scalarModule(count=1,parameters=['i32'],result=parameters[0]??'i32') {
 const source='/aot15a/structural.ts';
 const attrs={version:'0.10.0',input_identity:'sha256:'+sha('15a structural complete module'),
 source_hash:'sha256:'+sha('x'.repeat(100)),source_path:source,target:'windows-x86_64-msvc',
 triple:'x86_64-pc-windows-msvc',data_layout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128',
 bytecode_schema:'sha256:834206c45eaf6a1c47fa481970869e87c5badfa631af039576cb97e34fcac6ac'};
 const fields=Object.entries(attrs).map(([name,value])=>'tsfg_core.'+name+' = '+JSON.stringify(value));
 fields.push('tsfg_core.source_length = 100 : i64');const functions=[];
 for(let i=0;i<count;i++) {
  const name='structural_'+i,signature=sha('tsfg.signature\0('+parameters.join(',')+')->'+result);
  const id=sha('tsfg.function\0'+source+'\0'+name+'\0'+signature);
  const attributes=['tsfg_core.function_id = "sha256:'+id+'"','tsfg_core.signature_hash = "sha256:'+signature+'"',
   'tsfg_core.type_id = "sha256:'+sha('tsfg.type\0'+result)+'"','tsfg_core.function_start = 0 : i64','tsfg_core.function_end = 100 : i64'];
  const args=parameters.map((p,j)=>'%arg'+j+': '+type(p));
  const fuel='"tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 0 : i64, tsfg_source.end = 100 : i64} : () -> ()';
  const value=parameters.length?'%arg0':'%zero';
  const zero=parameters.length?'':'%zero = "tsfg_core.constant"() {value = 0 : '+type(result)+', tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : () -> '+type(result)+'\n';
  functions.push('func.func @'+name+'('+args.join(', ')+') -> '+type(result)+' attributes {'+attributes.join(', ')+'} {\n'+fuel+'\n'+zero
   +'"func.return"('+value+') {tsfg_source.start = 80 : i64, tsfg_source.end = 90 : i64} : ('+type(result)+') -> ()\n}');
 }
 return 'module attributes {'+fields.join(', ')+'} {\n'+functions.join('\n')+'\n}\n';
}
