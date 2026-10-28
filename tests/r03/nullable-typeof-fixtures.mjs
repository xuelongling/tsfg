// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {importNullableCapturedResponse} from '../../compiler/nullable-frontend.mjs';
const dir=new URL('./testdata/nullable-typeof-v6/',import.meta.url);
export const raw=name=>readFileSync(new URL(name,dir));
export const data=name=>JSON.parse(raw(name).toString());
export const expected=data('expected.json');
export const fresh=value=>JSON.parse(JSON.stringify(value));
export const sha=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {string} */
export const jcs=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(jcs).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+jcs(value[k])).join(',')+'}';
export function rejects(action,category=undefined){assert.throws(action,caught=>{
 assert.ok(caught instanceof TypeError);
 const error=/** @type {TypeError & {code:string,ruleId:string}} */(caught);
 assert.equal(error.ruleId,'r01-input-boundary');assert.match(error.code,/^r03-nullable-/);
 if(category)assert.equal(error.code,'r03-nullable-'+category);return true;
});}
// Rehashed adversarial DTOs are synthetic test inputs, never Source captures.
export function packetAttack(change){
 const request=data('request.json'),packet=data('package.json');change(packet,request);
 const requestText=jcs(request),input={...request.input,files:request.input.files.map(({path,content})=>({path,content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)))};
 packet.payload.inputIdentity=sha(jcs(input));packet.payload.files=input.files.map(f=>({path:f.path,digest:sha(f.content),byteLength:Buffer.byteLength(f.content),length:f.content.length,positionUnit:'utf16'}));
 packet.requestId=sha('tsfg.nullable-facts.request.v6\0'+requestText);
 packet.packageId=sha('tsfg.nullable-facts.package.v6\0'+expected.context.sourceSchemaHash+'\0'+jcs(packet.payload));
 const responseText=jcs(packet),origin={...expected.context.expectedOrigin,requestSha256:sha(requestText),responseSha256:sha(responseText),testedInputSetHash:sha(jcs({rootFile:request.input.rootFile,files:request.input.files}))};
 return ()=>importNullableCapturedResponse(Buffer.from(requestText),Buffer.from(responseText),origin,{...expected.context,expectedPackageId:packet.packageId,expectedOrigin:origin});
}

// Splice a synthetic source token and retain the independently mapped UTF16
// ranges, so syntax attacks reach the grammar rather than failing stale offsets.
export function spliceSource(packet,request,start,end,text){
 const file=request.input.files.find(f=>f.path===request.input.rootFile),delta=text.length-(end-start);
 file.content=file.content.slice(0,start)+text+file.content.slice(end);
 const visit=value=>{if(!value||typeof value!=='object')return;
  if(Object.keys(value).length===2&&Number.isInteger(value.start)&&Number.isInteger(value.end)){
   if(value.start>=end)value.start+=delta;if(value.end>=end)value.end+=delta;return;
  }
  for(const child of Object.values(value))visit(child);
 };
 visit(packet.payload.facts);visit(packet.payload.exports);
}

export function groupedContinuationAttack(change=undefined){
 return packetAttack((p,r)=>{
  // Synthetic nested group plan, raw reference Node.Pos and UTF16 surrogate
  // comment anchors are specified independently of compiler product output.
  spliceSource(p,r,83,84,'(/*😀*/ (x))');
  const inner={kind:'group',type:'i32',operand:{kind:'reference',type:'i32',symbol:'s7',presenceFlow:{undefined:false,null:false},range:{start:92,end:93}},range:{start:91,end:94}};
  p.payload.facts.functions[0].body[1].expression={kind:'group',type:'i32',operand:inner,range:{start:83,end:95}};
  change?.(p,r);
 });
}
