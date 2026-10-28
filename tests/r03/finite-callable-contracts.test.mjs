// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import expected from './testdata/typed-array-entry/universal-definition-abi-expected.json' with {type:'json'};

// These boundary variants are input data, not new official Source results.
async function rootPacket() {
  const input=expected.caseInputs.find(row=>row.case==='undefined');
  const bytes=await readFile(new URL('../../'+input.packetPath,import.meta.url));
  assert.equal(sha256(bytes).slice(7),input.packetSHA256);
  return JSON.parse(bytes.toString('utf8'));
}
function seal(packet) {
  const p=packet.payload,request={family:'tsfg.array-facts-request-candidate',version:8,input:{
    sourceRoot:p.sourceRoot,rootFile:p.rootFile,files:p.files.map(({path,content,sha256})=>({path,content,sha256})),
    declarations:p.declarations,config:p.config}};
  packet.requestId=sha256('tsfg.array-facts.request.v8\0'+canonical(request)+'\n');
  packet.packageId=sha256('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+canonical(p));
  return Buffer.from(canonical(packet)+'\n');
}
function lowerPacket(packet) {
  const bytes=seal(packet),facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok');return {text:lowerFormalHir(built.hir,context),hir:built.hir};
}
function selectRoot(packet,path='/src/z:🚀.ts') {
  packet.payload.rootFile=path;
  packet.payload.files.push({path,content:'// 😀\n',sha256:'320df10e5e3617d42a9ccf315037ec895aa6b28b3187ac6265fd1df984e817ab',
    utf16Length:6,byteLength:8});
  packet.payload.files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));return packet;
}

test('ordinary finite Core binds its real root Source identity and retains the complete closure',async()=>{
  const input=expected.caseInputs.find(row=>row.case==='undefined');
  const bytes=await readFile(new URL('../../'+input.packetPath,import.meta.url));
  assert.equal(sha256(bytes).slice(7),input.packetSHA256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok');
  const text=lowerFormalHir(built.hir,context);
  assert.match(text,/tsfg_core\.source_path = "\/src\/main\.ts"/);
  assert.match(text,/tsfg_core\.source_hash = "sha256:c4cd2bcc06fe4844f95fce28a0ba398afb1a8139f5c7bb594cc7a8474a223cb4"/);
  assert.match(text,/tsfg_core\.source_length = 127 : i64/);
  const closure=/tsfg_core\.source_closure = ("(?:[^"\\]|\\.)*")/.exec(text);
  assert.ok(closure);
  assert.deepEqual(JSON.parse(JSON.parse(closure[1])),built.hir.sources);
});

test('formal finite root follows dependencies and preserves colon, astral path and UTF16 length',async()=>{
  const packet=selectRoot(await rootPacket()),{text,hir}=lowerPacket(packet);
  assert.equal(hir.sources.length,3);assert.equal(hir.sources[0].path,'/src/main.ts');
  assert.match(text,/tsfg_core\.source_path = "\/src\/z:🚀\.ts"/);
  assert.match(text,/tsfg_core\.source_hash = "sha256:320df10e5e3617d42a9ccf315037ec895aa6b28b3187ac6265fd1df984e817ab"/);
  assert.match(text,/tsfg_core\.source_length = 6 : i64/);
  const closure=/tsfg_core\.source_closure = ("(?:[^"\\]|\\.)*")/.exec(text);
  assert.ok(closure);assert.deepEqual(JSON.parse(JSON.parse(closure[1])),hir.sources);
});

test('formal finite root rejects absent, duplicate and inconsistent original Source data',async t=>{
  for(const {name,mutate} of [
    {name:'absent',mutate:p=>{p.rootFile='/src/missing.ts';}},
    {name:'duplicate',mutate:p=>{p.files.splice(1,0,structuredClone(p.files[0]));}},
    {name:'declaration-root',mutate:p=>{p.rootFile='/src/minimal-arrays-v8.d.ts';}},
    {name:'hash',mutate:p=>{p.files[0].sha256='0'.repeat(64);}},
    {name:'UTF16',mutate:p=>{p.files[0].utf16Length++;}},
    {name:'noncanonical-path',mutate:p=>{p.rootFile='/src/../main.ts';}}
  ])await t.test(name,async()=>{
    const packet=await rootPacket();mutate(packet.payload);
    assert.throws(()=>lowerPacket(packet),error=>error instanceof TypeError&&'code' in error
      &&['r03-typed-array-source','r03-typed-array-identity','r03-typed-array-declaration'].includes(String(error.code)));
  });
});

test('formal finite root retains the exact 64-source closure and refuses the 65th source',async()=>{
  const packet=selectRoot(await rootPacket());
  for(let index=0;index<61;index++)packet.payload.files.push({path:'/src/a'+String(index).padStart(2,'0')+'.ts',content:'',
    sha256:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',utf16Length:0,byteLength:0});
  packet.payload.files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
  const {text,hir}=lowerPacket(packet);assert.equal(hir.sources.length,64);
  const closure=/tsfg_core\.source_closure = ("(?:[^"\\]|\\.)*")/.exec(text);
  assert.ok(closure);assert.deepEqual(JSON.parse(JSON.parse(closure[1])),hir.sources);
  packet.payload.files.push({path:'/src/zz.ts',content:'',
    sha256:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',utf16Length:0,byteLength:0});
  assert.throws(()=>lowerPacket(packet),{code:'r03-typed-array-limit'});
});

test('formal finite root enforces the existing 4096-byte logical path bound',async()=>{
  const path='/src/'+'a'.repeat(4088)+'.ts';assert.equal(Buffer.byteLength(path),4096);
  assert.ok(lowerPacket(selectRoot(await rootPacket(),path)).text.includes('tsfg_core.source_path = "'+path+'"'));
  const tooLong=selectRoot(await rootPacket(),path.slice(0,-3)+'a.ts');
  assert.equal(Buffer.byteLength(tooLong.payload.rootFile),4097);
  assert.throws(()=>lowerPacket(tooLong),{code:'r03-finite-core-capability'});
});

test('ordinary Core carries every independent Source callable and its ordered binding/type contract',async t=>{
  let count=0,parameters=0;
  for(const input of expected.caseInputs)await t.test(input.case,async()=>{
    const bytes=await readFile(new URL('../../'+input.packetPath,import.meta.url));
    assert.equal(sha256(bytes).slice(7),input.packetSHA256);
    const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
      factsBytes:bytes,expectedPackageId:facts.packageId},built=buildHir(facts,context);
    assert.equal(built.status,'ok');
    const text=lowerFormalHir(built.hir,context),attribute=/tsfg_core\.callable_contracts = ("(?:[^"\\]|\\.)*")/.exec(text);
    assert.ok(attribute,'real Core module header, not detached metadata');
    const raw=JSON.parse(attribute[1]),rows=JSON.parse(raw),gold=expected.rows.filter(row=>row.case===input.case);
    assert.equal(raw,canonical(rows));assert.deepEqual(rows.map(row=>row.id),gold.map(row=>row.functionId).sort());
    for(const row of rows) {
      const oracle=gold.find(value=>value.functionId===row.id);
      assert.equal(row.signatureHash,oracle.sourceSignature.signatureHash);
      assert.deepEqual(row.parameters.map(({id,type})=>({id,type})),oracle.parameters.map(value=>({id:value.binding,type:value.declaredOwnedType})));
      assert.ok(text.includes('tsfg_core.function_id = "'+row.id+'"'));
      assert.ok(built.hir.sources.some(source=>source.path===row.sourcePath&&row.range.start>=0&&row.range.end<=source.content.length));
      if(row.role==='construction-body') {
        assert.equal(row.construction,oracle.constructionId);assert.equal(oracle.abi.result,null);
        assert.equal(row.parameters[0].type,row.ownerType);
      }
      parameters+=row.parameters.length;count++;
    }
  });
  assert.deepEqual({count,parameters},{count:22,parameters:29});
});
