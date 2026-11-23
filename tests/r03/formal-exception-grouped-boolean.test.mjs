// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {canonical,hash} from './formal-exception-source-oracle.mjs';

async function derivedException(directory,change){
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
  change(payload,file);

  const files=request.input.files.map(({path,content})=>({path,content})).sort((a,b)=>a.path<b.path?-1:1);
  payload.inputIdentity=hash(canonical({...request.input,files}));
  payload.files=files.map(({path,content})=>({path,digest:hash(content),byteLength:Buffer.byteLength(content),
    length:content.length,positionUnit:'utf16'}));
  const requestText=canonical(request);
  response.requestId=hash('tsfg.exception-facts.request.v1\0'+requestText);
  response.packageId=hash('tsfg.exception-facts.package.v1\0'+response.schemaHash+'\0'+canonical(payload));
  const responseText=canonical(response);
  const exactOrigin={...origin,requestSha256:hash(requestText),responseSha256:hash(responseText)};
  return importCapturedFrontendResponse(Buffer.from(requestText),Buffer.from(responseText),exactOrigin);
}

function shiftSourceSpans(payload,path,from,count){
  /** @param {unknown} value */
  function shift(value){
    if(!value||typeof value!=='object')return;
    if('start' in value&&'end' in value&&typeof value.start==='number'&&typeof value.end==='number'){
      if(value.start>=from)value.start+=count;
      if(value.end>from)value.end+=count;
      return;
    }
    for(const child of Object.values(value))shift(child);
  }
  for(const rows of [payload.facts.functions,payload.facts.symbols,payload.facts.modules??[],
    payload.facts.aggregateFacts?.sourceCoverage??[],payload.exports])
    for(const row of rows)if(row.sourcePath===undefined||row.sourcePath===path)shift(row);
}

function groupedCondition(directory,index,count){
  return derivedException(directory,(payload,file)=>{
    const statement=payload.facts.functions[0].body[index],condition=structuredClone(statement.condition);
    const {start,end}=condition.range;
    const original=file.content.slice(start,end);
    assert.ok(['true','false','pending'].includes(original));
    file.content=file.content.slice(0,start)+'('.repeat(count)+original+')'.repeat(count)+file.content.slice(end);
    shiftSourceSpans(payload,file.path,end,2*count);
    condition.range={start:start+count,end:end+count};
    let grouped=condition;
    for(let depth=count-1;depth>=0;depth--)
      grouped={kind:'group',type:condition.type,range:{start:start+depth,end:end+2*count-depth},operand:grouped};
    statement.condition=grouped;
  });
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

test('exception while condition forgets the binding written on a repeated evaluation',async()=>{
  const source=' while ((typeof caught === "boolean") === (box.flag === (caught = box.flag))) { } return box.flag;';
  const derive=claimed=>derivedException('m21-exception/corpus/01',(payload,file)=>{
    const guard=payload.facts.functions[0].body[0].exception.catchClause.block.body[0],body=guard.thenBody[0].body;
    const [returned]=body,saved=structuredClone(returned.expression.left),test=structuredClone(guard.condition);
    const {start,end}=returned.range;
    assert.equal(file.content.slice(start,end),' return box.flag === caught;');
    file.content=file.content.slice(0,start)+source+file.content.slice(end);
    shiftSourceSpans(payload,file.path,end,source.length-(end-start));
    const range=(a,b)=>({start:start+a,end:start+b});
    const group=(a,b,operand)=>({kind:'group',type:'bool',range:range(a,b),operand});
    const binary=(a,b,left,right)=>({kind:'binary',type:'bool',operator:'===',range:range(a,b),left,right});
    const field=from=>({...saved,range:range(from,from+8),receiver:{...saved.receiver,range:range(from,from+3)}});
    const typeofStart=source.indexOf('typeof'),typeofEnd=source.indexOf(' ==='),tag=source.indexOf('"boolean"');
    const guardEnd=tag+'"boolean"'.length,compare=source.indexOf('box.flag'),writeStart=source.indexOf('caught = box.flag');
    const writeRhs=source.indexOf('box.flag',compare+1),writeEnd=writeRhs+8,returnField=source.lastIndexOf('box.flag');
    test.range=range(typeofStart,guardEnd);
    test.operand={...test.operand,type:claimed,range:range(typeofStart+'typeof'.length,typeofEnd)};
    test.typeTest={...test.typeTest,typeofRange:range(typeofStart,typeofEnd),tagRange:range(tag-1,guardEnd)};
    const write={kind:'write',type:'bool',operator:'=',range:range(writeStart,writeEnd),
      left:{...test.operand,type:'unknown',range:range(writeStart,writeStart+'caught'.length)},right:field(writeRhs)};
    const right=binary(compare,writeEnd+1,field(compare),group(writeStart-1,writeEnd+1,write));
    const condition=binary(typeofStart-1,writeEnd+2,group(typeofStart-1,guardEnd+1,test),group(compare-1,writeEnd+2,right));
    const loopEnd=source.indexOf('}')+1,loopBody=source.indexOf('{')-1;
    body.splice(0,1,{kind:'while',condition,range:range(0,loopEnd),body:[{kind:'block',range:range(loopBody,loopEnd)}]},
      {kind:'return',expression:field(returnField),range:range(loopEnd,source.length)});
  });
  const imported=await derive('unknown');
  assert.equal(imported.status,'ok',JSON.stringify(imported));
  const built=buildHir(imported.snapshot);
  assert.equal(built.status,'ok',JSON.stringify(built));
  const loop=built.hir.functions[0].body.body[0].catchClause.region.body[0].thenRegion.body[0];
  const unknown=built.hir.types.find(type=>type.kind==='unknown');
  assert.ok(unknown);
  assert.equal(loop.condition.left.operand.operand.type,unknown.id);
  const core=lowerFormalHir(built.hir),inside=core.slice(core.indexOf('^bb',core.indexOf('"tsfg_eh.type_test"')));
  assert.match(inside,/"tsfg_eh\.type_test"[\s\S]*"tsfg_eh\.store"[\s\S]*cf\.cond_br/u);
  const forged=await derive('bool');
  assert.equal(forged.status,'error');
  assert.match(forged.diagnostics[0].message,/same-symbol path proof/u);
});
