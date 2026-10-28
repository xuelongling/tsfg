// SPDX-License-Identifier: MIT
// Materialize only the independent frozen literals; no Product analysis imports.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {jcs,hash,wholeCore} from './array-owner-proof/literal-core.mjs';
import {envelope,deriveLiteral,measure} from './array-owner-proof/proof-arithmetic.mjs';
import * as structural from './array-owner-proof/structural-models.mjs';
const bundle=JSON.parse(await readFile(new URL('./array-owner-proof/literals.json',import.meta.url),'utf8'));
export const index=bundle.index;
const pins=new Map(index.files.map(row=>[row.path,row]));
export function file(path){
  assert.ok(Object.hasOwn(bundle.files,path),path);
  const bytes=Buffer.from(bundle.files[path]),pin=pins.get(path);assert.ok(pin,path);
  assert.equal(bytes.length,pin.bytes,path);assert.equal(hash(bytes),pin.sha256,path);
  return bytes;
}
export const json=path=>JSON.parse(file(path).toString('utf8'));
for(const name of ['literal-core.mjs','proof-arithmetic.mjs','structural-models.mjs']){
  const bytes=await readFile(new URL('./array-owner-proof/'+name,import.meta.url)),pin=pins.get(name);
  assert.equal(bytes.length,pin.bytes,name);assert.equal(hash(bytes),pin.sha256,name);
}
const original=JSON.parse(await readFile(new URL('./array-parallel-oracle.json',import.meta.url),'utf8'));
const template=original.cases[0].hir;
export function stderrBytes(expected){
  const bytes=typeof expected==='string'?Buffer.from(expected):file(expected.path);
  // Only these unchanged legacy text diagnostics use Windows CRT CRLF. The
  // new JSON diagnostics and all actual streams retain exact raw comparison.
  const old=['[core-ir-array-publication] actual Derived/Effective effects exceed complete fixed upper\n',
    '[core-ir-array-metadata] module fields differ\n','[core-ir-array-budget] root path exceeds byte limit\n'];
  return process.platform==='win32'&&old.includes(bytes.toString('utf8'))?
    Buffer.from(bytes.toString('utf8').replaceAll('\n','\r\n')):bytes;
}
export const streams=expected=>({
  stdout:expected.relation==='exact same stdout bytes'?file(expected.stdout):
    typeof expected.stdout==='string'?Buffer.from(expected.stdout):file(expected.stdout.path),
  stderr:stderrBytes(expected.stderr),
});
export {jcs,hash,measure};
export function pointer(object,path,value){
  const keys=path.split('/').slice(1).map(key=>key.replaceAll('~1','/').replaceAll('~0','~'));
  assert.ok(keys.length);let parent=object;
  for(const key of keys.slice(0,-1))parent=parent[key];
  parent[keys.at(-1)]=value;
}
export function semantic(row){
  const request=json(row.base),caseName=row.base.split('/')[0];
  for(const operation of row.operations){
    if(operation.op==='set')pointer(request,operation.pointer,structuredClone(operation.value));
    else if(operation.op==='copy-expected-proof')request.proof=json(caseName+'/expected.stdout.json');
    else if(operation.op==='prefix-core-text')request.coreText=operation.prefix+request.coreText;
    else if(operation.op==='core-literal-replace'){
      assert.ok(request.coreText.includes(operation.before));
      request.coreText=request.coreText.replace(operation.before,operation.after);
    }else assert.fail(operation.op);
  }
  return Buffer.from(jcs(request)+'\n');
}
export function transport(row){
  const request=json(row.base);
  if(row.mode)request.mode=row.mode;
  if(row.initialProof)request.proof=json(row.initialProof);
  const r=row.recipe,marker='@FROZEN-RAW-JSON-VALUE@';
  const replace=raw=>{
    pointer(request,r.pointer,marker);
    const input=jcs(request)+'\n',quoted=JSON.stringify(marker),at=input.indexOf(quoted);
    assert.ok(at>=0);assert.equal(input.indexOf(quoted,at+quoted.length),-1);
    return Buffer.concat([Buffer.from(input.slice(0,at)),Buffer.from(raw),Buffer.from(input.slice(at+quoted.length))]);
  };
  if(r.op==='set-raw-json-value')return replace(r.raw);
  if(r.op==='set-raw-string-bytes')return replace(Buffer.concat([Buffer.from('"'),Buffer.from(r.hex,'hex'),Buffer.from('"')]));
  if(r.op==='set-repeat-string')pointer(request,r.pointer,r.character.repeat(r.length));
  else if(r.op==='set-nested-arrays'){let value=r.leaf;for(let i=0;i<r.containers;i++)value=[value];pointer(request,r.pointer,value);}
  else if(r.op==='set-numbered-null-members')pointer(request,r.pointer,Object.fromEntries(
    Array.from({length:r.count},(_,i)=>[r.prefix+String(i).padStart(r.digits,'0'),null])));
  else if(r.op==='set-repeat-array')pointer(request,r.pointer,Array(r.count).fill(r.value));
  else if(r.op==='prefix-core-comment')request.coreText='//'+r.character.repeat(r.repeatCount)+'\n'+request.coreText;
  let raw=jcs(request)+'\n';
  if(r.op==='duplicate-raw-member')raw='{'+JSON.stringify(r.key)+':'+r.raw+','+raw.slice(1);
  else if(r.op==='append-terminal-LF')raw+='\n';
  else if(r.op==='remove-terminal-LF')raw=raw.slice(0,-1);
  else if(r.op==='prefix-space')raw=' '+raw;
  else if(r.op==='prefix-UTF8-BOM')return Buffer.concat([Buffer.from([239,187,191]),Buffer.from(raw)]);
  return Buffer.from(raw);
}
export function generated(row){
  const g=row.generator;
  const data=g.export==='longPath'?structural.longPath(template,g.length):
    g.export==='mixedFreshOutput'?structural.mixedFreshOutput(template,g.controlCharacters,g.asciiCharacters):
      structural.longConflict(template,g.controlCharacters);
  const whole=wholeCore(data.model,data.context);
  if(g.export!=='longPath')whole.text=whole.text.replaceAll('\\u0001','\\01');
  const caller=whole.traces.find(fn=>fn.functionId===data.callerId);
  const sites=caller.calls.map(call=>({block:0,instruction:call.instruction}));
  const input=envelope(data.model,data.context,whole,data.callerId,sites),raw=Buffer.from(jcs(input)+'\n');
  assert.equal(hash(whole.text),row.completeInput.coreSHA256);
  assert.equal(Buffer.byteLength(whole.text),row.completeInput.coreBytes);
  assert.equal(hash(raw),row.completeInput.sha256);
  assert.equal(raw.length,row.completeInput.transportBytes??row.completeInput.bytes);
  // The overflow path is rejected by the unchanged old Core gate before this
  // new proof capability; independent arithmetic cannot grant old-domain credit.
  if(g.export==='longPath'&&row.expected.exit!==0)return{raw,stdout:Buffer.alloc(0)};
  const gold=deriveLiteral(data.model,data.context,whole,data.callerId,sites);
  if(gold.proof){
    const stdout=Buffer.from(jcs(gold.proof)+'\n');
    assert.equal(stdout.length,row.expected.stdout.bytes);assert.equal(hash(stdout),row.expected.stdout.sha256);
    return{raw,stdout};
  }
  assert.equal(jcs(gold.error)+'\n',row.expected.stderr);
  return{raw,stdout:Buffer.alloc(0)};
}
