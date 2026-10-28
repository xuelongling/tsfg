// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importCapturedFrontendResponse,validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {sha256,canonical} from '../../compiler/identity.mjs';
import {coreQuote} from '../../compiler/core-ssa-emitter.mjs';
import {readClosureSourceCase} from './closure-core-consumer-cases.mjs';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';

async function completeReturned() {
  const root=new URL('../fixtures/r03/m19-function-values/',import.meta.url);
  /** @type {[string,number,string][]} */
  const pins=[['request.json',2073,'1a8fdc95a48caaf4ceef02f291b7f18cffae12743e234072934b952f364efe33'],
    ['response.json',5678,'f329aca7fdbcefea2eeca81317d00f04bb18447b03d243cf1a5593b631eb5b41'],
    ['original.json',1713,'1748bb2bebfe1cac05a5a5b1ac2c6e28e457e56f3c57e9a0c426a75adf9b02a0'],
    ['provenance.json',17306,'53875a3dd1b5171e7b50ac5650cc496d43332389f1cb9e7fef162a408b7facc9']];
  const bytes=await Promise.all(pins.map(([name])=>readFile(new URL(name,root))));
  for(let i=0;i<pins.length;i++){assert.equal(bytes[i].length,pins[i][1]);assert.equal(sha256(bytes[i]),'sha256:'+pins[i][2]);}
  const [request,response,original,provenance]=bytes;
  assert.deepEqual(JSON.parse(request.toString()).files,JSON.parse(original.toString()).files);
  const imported=await importCapturedFrontendResponse(request,response,JSON.parse(provenance.toString()).origin);
  assert.equal(imported.status,'ok');validateFrontendSnapshot(imported.snapshot);
  const built=buildHir(imported.snapshot);assert.equal(built.status,'ok');
  const hir=readHir(Buffer.from(printHir(verifyHir(built.hir))));
  assert.deepEqual(hir.functions.map(fn=>fn.name),['entry','make','read','invoke']);
  return hir;
}

test('complete official returned closure enters ordinary formal Core without a private candidate marker',async()=>{
  const hir=await completeReturned(),before=printHir(hir);
  const core=lowerFormalHir(hir);
  assert.equal(typeof core,'string');assert.equal([...core.matchAll(/^  func\.func /gm)].length,4);
  assert.match(core,/tsfg_core\.closure_program = /);
  assert.doesNotMatch(core,/tsfg_core\.closure = |tsfg\.core-closure-candidate/);
  assert.equal(printHir(hir),before);
});

const available=Boolean(process.env.TSFG_CORE_IR_EXE);
const sourceCases=['returned','shared-mutable','parent','callee','recursiveFreshLocal'];
test('ordinary closure admission independently joins complete Source and actual environment/call CFG',{skip:!available},async t=>{
  for(const name of sourceCases)await t.test(name,async()=>{
    const {hir}=await readClosureSourceCase(name),core=lowerFormalHir(hir);
    assert.equal([...core.matchAll(/^  func\.func /gm)].length,hir.functions.length);
    const first=await invokeCore(core);accepted(first);
    const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
  });
});
function attribute(text,key,change) {
  const pattern=new RegExp('('+key+' = )("(?:[^"\\\\]|\\\\.)*")');
  const match=pattern.exec(text);assert.ok(match,'one actual '+key+' attribute');
  return text.replace(pattern,(_,prefix,value)=>prefix+coreQuote(change(JSON.parse(value))));
}
test('ordinary closure admission rejects forged code/capture/target and private/mixed identities',{skip:!available},async t=>{
  const core=lowerFormalHir(await completeReturned());
  const cases=[
    ['FunctionId',core.replace(/function_id = "sha256:[a-f0-9]+"/,'function_id = "sha256:'+'0'.repeat(64)+'"')],
    ['slot binding',core.replace(/binding = "sha256:[a-f0-9]+"/,'binding = "sha256:'+'0'.repeat(64)+'"')],
    ['missing formal identity',core.replace('tsfg_core.closure_program =','tsfg_core.closure =')],
    ['private base',core.replace('tsfg_core.version = "0.12.0"','tsfg_core.version = "0.9.0"')],
    ['invented target',attribute(core,'targets',raw=>{const report=JSON.parse(raw);report.calls.find(c=>c.kind==='indirectCall').targets.functions=[];return canonical(report)+'\n';})],
  ];
  for(const [name,bad]of cases)await t.test(name,async()=>{assert.notEqual(bad,core);rejected(await invokeCore(bad));});
  let forged=attribute(core,'hir',raw=>{const hir=JSON.parse(raw);hir.functions.find(fn=>fn.name==='read').captures=[];return canonical(hir)+'\n';});
  const match=/hir = ("(?:[^"\\]|\\.)*")/.exec(forged);assert.ok(match);const changedHash=sha256(JSON.parse(match[1]));
  forged=attribute(forged,'hir_hash',()=>changedHash);
  forged=attribute(forged,'targets',raw=>{const report=JSON.parse(raw);report.hirHash=changedHash;return canonical(report)+'\n';});
  const noCapture=await invokeCore(forged);rejected(noCapture);assert.match(noCapture.stderr.toString(),/Source captures/);
  await t.test('wire12 remains unsupported',async()=>{const result=await invokeCore(core,'--emit-bytecode');assert.equal(result.close.code,3);assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/r04-core-closure-unsupported/);});
});

test('ordinary captured callable writes preserve conservative Source may bounds',{skip:!available},async t=>{
  const {hir}=await readClosureSourceCase('sharedCallableWrites'),core=lowerFormalHir(hir);
  const first=await invokeCore(core);accepted(first);
  const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
  const unrelated=hir.functions.find(fn=>fn.name==='read').id;
  for(const kind of ['missing','extra'])await t.test(kind+' captured-call target',async()=>{
    const bad=attribute(core,'targets',raw=>{const report=JSON.parse(raw),site=report.calls.find(call=>call.kind==='indirectCall');
      assert.equal(site.targets.functions.length,2);assert.ok(!site.targets.functions.includes(unrelated));
      if(kind==='missing')site.targets.functions.pop();else site.targets.functions.push(unrelated);
      return canonical(report)+'\n';});
    const result=await invokeCore(bad);rejected(result);assert.match(result.stderr.toString(),/actual indirect targets differ/);
  });
});
