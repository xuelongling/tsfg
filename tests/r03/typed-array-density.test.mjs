// SPDX-License-Identifier: MIT
// Hostile-derived packets preserve full text/range/hash consistency, not Source provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']'
  :'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
const sha=text=>createHash('sha256').update(text).digest('hex');
function resign(packet) {
  const p=packet.payload;
  const request={family:'tsfg.array-facts-request-candidate',version:8,input:{sourceRoot:p.sourceRoot,rootFile:p.rootFile,
    files:p.files.map(({path,content,sha256})=>({path,content,sha256})),declarations:p.declarations,config:p.config}};
  packet.requestId='sha256:'+sha('tsfg.array-facts.request.v8\0'+stable(request)+'\n');
  packet.packageId='sha256:'+sha('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+stable(p));
  return Buffer.from(stable(packet)+'\n');
}
const cases=[{name:'serial-overwrite',code:'dense-gap',select:p=>p.functions[0].body.find(row=>row.value?.kind==='elementAssignment').value.target.index},
  {name:'empty-append-rhs-shrink',code:'dense-growth',select:p=>p.functions[0].body.find(row=>row.value?.kind==='lengthAssignment').value.value}];
for(const {name,code,select}of cases)test('cold generic Array facts reject statically known '+code,async()=>{
  const actual=await readFile(new URL('./testdata/typed-array-consumer-v8/'+name+'-package.json',import.meta.url));
  readTypedArrayFacts(actual);
  const packet=JSON.parse(actual.toString('utf8')),literal=select(packet.payload);
  assert.equal(literal.token.length,1);const file=packet.payload.files.find(row=>row.path===packet.payload.rootFile);
  file.content=file.content.slice(0,literal.range.start)+'9'+file.content.slice(literal.range.end);file.sha256=sha(file.content);
  literal.token='9';literal.decimal='9';
  assert.throws(()=>readTypedArrayFacts(resign(packet)),{code:'r03-typed-array-'+code});
});
