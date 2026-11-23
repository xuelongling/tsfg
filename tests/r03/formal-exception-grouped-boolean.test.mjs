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

function whileFromCatchGuard(directory,grouped=false){
  return derivedException(directory,(payload,file)=>{
    const guard=payload.facts.functions[0].body[0].exception.catchClause.block.body[0];
    const {start}=guard.range,rawStart=file.content.slice(0,start).trimEnd().length;
    assert.equal(file.content.slice(start,start+2),'if');
    file.content=file.content.slice(0,start)+'while'+file.content.slice(start+2);
    shiftSourceSpans(payload,file.path,start+2,3);
    const condition=guard.condition,body=guard.thenBody;
    guard.kind='while';guard.range.start=rawStart;guard.body=body;delete guard.thenBody;
    if(grouped){
      const {start,end}=condition.range;
      file.content=file.content.slice(0,start)+'('+file.content.slice(start,end)+')'+file.content.slice(end);
      shiftSourceSpans(payload,file.path,end,2);
      guard.condition={kind:'group',type:'bool',range:{start,end:end+2},operand:condition};
      for(const range of [condition.range,condition.operand.range,condition.typeTest.typeofRange,condition.typeTest.tagRange]){
        range.start++;range.end++;
      }
      const [block]=body,{start:writeStart,end:writeEnd}=block.body[0].range;
      const replacement=' caught = true;';
      assert.equal(file.content.slice(writeStart,writeEnd),' throw value;');
      file.content=file.content.slice(0,writeStart)+replacement+file.content.slice(writeEnd);
      shiftSourceSpans(payload,file.path,writeEnd,replacement.length-(writeEnd-writeStart));
      block.body[0]={kind:'assignment',range:{start:writeStart,end:writeStart+replacement.length},
        target:{...condition.operand,range:{start:writeStart,end:writeStart+7}},
        value:{kind:'boolean',type:'bool',boolean:true,range:{start:writeStart+9,end:writeStart+14}}};
    }
  });
}

test('exception typeof while narrows only the boolean body edge',async()=>{
  const imported=await whileFromCatchGuard('m21-exception/corpus/01');
  assert.equal(imported.status,'ok',JSON.stringify(imported));
  const built=buildHir(imported.snapshot);
  assert.equal(built.status,'ok',JSON.stringify(built));
  const [loop,after]=built.hir.functions[0].body.body[0].catchClause.region.body;
  assert.equal(loop.kind,'while');
  assert.equal(loop.condition.operand.type,after.value.type);
  assert.equal(loop.bodyRegion.body[0].value.right.type,hash('tsfg.type\0bool'));
  assert.match(lowerFormalHir(built.hir),/"tsfg_eh\.type_test"[\s\S]*cf\.cond_br/u);
});

test('grouped exception typeof while narrows the boolean exit edge',async()=>{
  const imported=await whileFromCatchGuard('m21-exception/phase-a-controls/05',true);
  assert.equal(imported.status,'ok',JSON.stringify(imported));
  const built=buildHir(imported.snapshot);
  assert.equal(built.status,'ok',JSON.stringify(built));
  const [loop,,after]=built.hir.functions[0].body.body[0].catchClause.region.body;
  assert.equal(loop.condition.operand.operator,'!==');
  assert.equal(loop.bodyRegion.body[0].kind,'assign');
  assert.equal(after.value.type,hash('tsfg.type\0bool'));
  assert.match(lowerFormalHir(built.hir),/"tsfg_eh\.type_test"[\s\S]*cf\.cond_br/u);
});

test('exception typeof while rejects either claimed type in a contradictory body',async()=>{
  const derive=claimed=>derivedException('m21-exception/corpus/01',(payload,file)=>{
    const guard=payload.facts.functions[0].body[0].exception.catchClause.block.body[0];
    const body=guard.thenBody[0].body,{start}=body[0].range,condition=structuredClone(guard.condition);
    const prefix=' while (typeof caught !== "boolean") {',read=' throw caught;';
    const source=prefix+(claimed?read:'')+' }';
    file.content=file.content.slice(0,start)+source+file.content.slice(start);
    shiftSourceSpans(payload,file.path,start,source.length);
    const offset=start+prefix.indexOf('typeof')-condition.range.start;
    for(const range of [condition.range,condition.operand.range,condition.typeTest.typeofRange,condition.typeTest.tagRange]){
      range.start+=offset;range.end+=offset;
    }
    condition.operator='!==';condition.operand.type='bool';
    const at=relative=>start+relative;
    const block={kind:'block',range:{start:at(prefix.indexOf(' {')),end:at(source.length)}};
    if(claimed){
      const operandStart=at(prefix.length+read.indexOf(' caught'));
      block.body=[{kind:'throw',range:{start:at(prefix.length),end:at(prefix.length+read.length)},
        expression:{...condition.operand,type:claimed,range:{start:operandStart,end:operandStart+7}}}];
    }
    body.unshift({kind:'while',condition,range:{start,end:at(source.length)},body:[block]});
  });
  const empty=await derive(null);
  assert.equal(empty.status,'ok',JSON.stringify(empty));
  for(const type of ['unknown','bool']){
    const rejected=await derive(type);
    assert.equal(rejected.status,'error');
    assert.match(rejected.diagnostics[0].message,/never occurrence has no private consumer tracer/u);
  }
});

test('exception closure in a narrowed while reads the captured declaration type',async()=>{
  const imported=await derivedException('m21-exception/corpus/08',(payload,file)=>{
    const [entry,inner]=payload.facts.functions,catchClause=entry.body[0].exception.catchClause;
    const body=catchClause.block.body,start=body[0].range.start,end=body[1].range.end;
    const prefix=' while (typeof caught === "boolean") {',suffix=' } throw caught;';
    const beforeSuffix=end+prefix.length,loopEnd=beforeSuffix+2;
    file.content=file.content.slice(0,start)+prefix+file.content.slice(start,end)+suffix+file.content.slice(end);
    shiftSourceSpans(payload,file.path,start,prefix.length);
    shiftSourceSpans(payload,file.path,beforeSuffix,suffix.length);
    const captured=inner.body[0].exception.tryBlock.body[0].expression;
    const typeofStart=start+prefix.indexOf('typeof'),operandStart=start+prefix.indexOf(' caught');
    const operandEnd=operandStart+' caught'.length,tagStart=start+prefix.indexOf(' "boolean"');
    const tagEnd=tagStart+' "boolean"'.length,throwOperand=beforeSuffix+suffix.indexOf(' caught');
    const condition={kind:'type-test',type:'bool',operator:'===',range:{start:typeofStart,end:tagEnd},
      operand:{...captured,range:{start:operandStart,end:operandEnd}},
      typeTest:{tag:'boolean',typeofRange:{start:typeofStart,end:operandEnd},tagRange:{start:tagStart,end:tagEnd}}};
    catchClause.block.body=[{kind:'while',condition,range:{start,end:loopEnd},
      body:[{kind:'block',range:{start:start+prefix.indexOf(' {'),end:loopEnd},body}]},
    {kind:'throw',range:{start:loopEnd,end:beforeSuffix+suffix.length},
      expression:{...captured,range:{start:throwOperand,end:throwOperand+' caught'.length}}}];
  });
  assert.equal(imported.status,'ok',JSON.stringify(imported));
  const built=buildHir(imported.snapshot);
  assert.equal(built.status,'ok',JSON.stringify(built));
  const [entry,inner]=built.hir.functions,loop=entry.body.body[0].catchClause.region.body[0];
  const captured=inner.body.body[0].tryRegion.body[0].value;
  assert.equal(loop.bodyRegion.body[0].target,inner.id);
  assert.equal(captured.binding,loop.condition.operand.binding);
  assert.equal(captured.type,loop.condition.operand.type);
  assert.ok(inner.captures.some(row=>row.binding===captured.binding&&row.read));
  assert.match(lowerFormalHir(built.hir),/"tsfg_eh\.type_test"[\s\S]*cf\.cond_br/u);
});

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
