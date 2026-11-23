// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {canonical,hash} from './formal-exception-source-oracle.mjs';

async function groupedCondition(directory,index,count){
  const root=new URL('../fixtures/r03/'+directory+'/',import.meta.url);
  const [requestBytes,responseBytes,originBytes]=await Promise.all(
    ['request.json','response.json','origin.json'].map(name=>readFile(new URL(name,root))));
  const origin=JSON.parse(originBytes.toString('utf8'));
  assert.equal(origin.requestSha256,hash(requestBytes));
  assert.equal(origin.responseSha256,hash(responseBytes));
  const retained=await importCapturedFrontendResponse(requestBytes,responseBytes,origin);
  assert.equal(retained.status,'ok',JSON.stringify(retained));
  const request=JSON.parse(requestBytes.toString('utf8')),response=JSON.parse(responseBytes.toString('utf8'));
  const {payload}=response,file=request.input.files.find(row=>row.path==='/src/main.ts');
  const statement=payload.facts.functions[0].body[index],condition=structuredClone(statement.condition);
  const {start,end}=condition.range;
  const original=file.content.slice(start,end);
  assert.ok(['true','false','pending'].includes(original));
  file.content=file.content.slice(0,start)+'('.repeat(count)+original+')'.repeat(count)+file.content.slice(end);
  // Derive a grouped expression and translate existing UTF-16 spans. The
  // original captures and all original symbol IDs remain untouched.
  /** @param {unknown} value */
  function shift(value){
    if(!value||typeof value!=='object')return;
    if('start' in value&&'end' in value&&typeof value.start==='number'&&typeof value.end==='number'){
      if(value.start>=end)value.start+=2*count;
      if(value.end>end)value.end+=2*count;
      return;
    }
    for(const child of Object.values(value))shift(child);
  }
  for(const rows of [payload.facts.functions,payload.facts.symbols,payload.facts.modules??[],
    payload.facts.aggregateFacts?.sourceCoverage??[],payload.exports])
    for(const row of rows)if(row.sourcePath===undefined||row.sourcePath===file.path)shift(row);
  condition.range={start:start+count,end:end+count};
  let grouped=condition;
  for(let depth=count-1;depth>=0;depth--)
    grouped={kind:'group',type:condition.type,range:{start:start+depth,end:end+2*count-depth},operand:grouped};
  statement.condition=grouped;

  const files=request.input.files.map(({path,content})=>({path,content})).sort((a,b)=>a.path<b.path?-1:1);
  payload.inputIdentity=hash(canonical({...request.input,files}));
  payload.files=files.map(({path,content})=>({path,digest:hash(content),byteLength:Buffer.byteLength(content),
    length:content.length,positionUnit:'utf16'}));
  const requestText=canonical(request);
  response.requestId=hash('tsfg.exception-facts.request.v1\0'+requestText);
  response.packageId=hash('tsfg.exception-facts.package.v1\0'+response.schemaHash+'\0'+canonical(payload));
  const responseText=canonical(response);
  return importCapturedFrontendResponse(Buffer.from(requestText),Buffer.from(responseText),
    {...origin,requestSha256:hash(requestText),responseSha256:hash(responseText)});
}

test('grouped true exception while keeps the non-void false edge unreachable',async()=>{
  const imported=await groupedCondition('m21-exception/controls/literal-true-while',0,2);
  assert.equal(imported.status,'ok',JSON.stringify(imported));
  const built=buildHir(imported.snapshot);
  assert.equal(built.status,'ok',JSON.stringify(built));
  const condition=built.hir.functions[0].body.body[0].condition;
  assert.equal(condition.kind,'group');
  assert.equal(condition.operand.kind,'group');
  assert.equal(condition.operand.operand.value,true);
  const core=lowerFormalHir(built.hir);
  const branch=/cf\.cond_br [^,]+, \^\w+, \^(\w+)/u.exec(core);
  assert.ok(branch);
  assert.ok(core.includes('\n  ^'+branch[1]+':\n    "tsfg_eh.unreachable"('));
});

test('grouped false exception if retains both Source arms and lowers only the live throw',async()=>{
  const imported=await groupedCondition('exception-region-presence/false-with-present-else',0,1);
  assert.equal(imported.status,'ok',JSON.stringify(imported));
  const built=buildHir(imported.snapshot);
  assert.equal(built.status,'ok',JSON.stringify(built));
  const statement=built.hir.functions[0].body.body[0];
  assert.equal(statement.condition.operand.value,false);
  assert.equal(statement.thenRegion.body[0].kind,'throw');
  assert.equal(statement.elseRegion.body[0].kind,'throw');
  const core=lowerFormalHir(built.hir);
  assert.equal((core.match(/"tsfg_eh\.raise"\(/gu)??[]).length,1);
  const branch=/cf\.cond_br [^,]+, \^(\w+), \^\w+/u.exec(core);
  assert.ok(branch);
  assert.ok(core.includes('\n  ^'+branch[1]+':\n    "tsfg_eh.unreachable"('));
});

test('grouped dynamic exception while keeps both continuations',async()=>{
  const imported=await groupedCondition('m21-exception/controls/while-finally',1,1);
  assert.equal(imported.status,'ok',JSON.stringify(imported));
  const built=buildHir(imported.snapshot);
  assert.equal(built.status,'ok',JSON.stringify(built));
  const core=lowerFormalHir(built.hir);
  assert.match(core,/cf\.cond_br /u);
  assert.doesNotMatch(core,/"tsfg_eh\.unreachable"\(/u);
});
