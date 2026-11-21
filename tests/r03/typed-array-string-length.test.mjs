// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildHir,buildInitialArrayPublication,lowerFormalHir,printHir,readHir} from '../../compiler/hir.mjs';
import {canonical,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts,writeTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const bytes=await readFile(new URL('./testdata/typed-array-string-length-v9/package.json',import.meta.url));
const facts=readTypedArrayFacts(bytes,9);
const context={family:'tsfg.array-facts-context-candidate',version:3,factsBytes:bytes,expectedPackageId:facts.packageId};
function withPackageIdentity(value) {
  value.packageId=sha256('tsfg.array-facts.package.v9\0'+value.schemaHash+'\0'+canonical(value.payload));
  return Buffer.from(canonical(value)+'\n');
}

test('official String length facts reconstruct owned HIR and paired finite Core operations',()=>{
  assert.deepEqual(writeTypedArrayFacts(facts,9),bytes);
  const publication=buildInitialArrayPublication(context);
  const built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=readHir(Buffer.from(printHir(built.hir,context,publication),'utf8'),context,publication);
  assert.deepEqual(hir.intrinsics.stringLength,facts.payload.stringLength);
  const expressions=new Map(hir.functions.flatMap(fn=>fn.body.flatMap(row=>row.value?.kind==='stringLength'?[[fn.name,row.value]]:[])));
  assert.deepEqual([...expressions.keys()].sort(),['empty','once','parameter','units']);
  assert.equal(expressions.get('once').receiver.kind,'call');
  assert.deepEqual(expressions.get('empty').receiver.codeUnits,[]);
  assert.deepEqual(expressions.get('units').receiver.codeUnits,[0xd800,0xd83d,0xde00]);
  assert.equal(hir.functions.find(fn=>fn.name==='nominal').body[0].value.kind,'fieldAccess');
  const source=hir.sources.find(row=>row.path===hir.rootFile).content;
  const text=lowerFormalHir(hir,context,publication);
  const lengthLines=text.split('\n').filter(line=>line.includes('"tsfg_string.length"'));
  const convertLines=text.split('\n').filter(line=>line.includes('"tsfg_core.convert_checked"'));
  assert.equal(lengthLines.length,expressions.size);
  assert.equal(convertLines.length,expressions.size);
  assert.match(text,/code_units = array<i32: 55296, 55357, 56832>/u);
  for(const value of expressions.values()) {
    assert.equal(value.type,scalarTypeIds.f64);
    assert.equal(value.property,facts.payload.stringLength.id);
    assert.equal(source.slice(value.nameRange.start,value.nameRange.end),'length');
    const anchor=`start = ${value.range.start} : i64, tsfg_source.end = ${value.range.end} : i64`;
    const line=lengthLines.find(line=>line.includes(anchor));
    assert.match(line,/\(!tsfg_string\.string\) -> !tsfg_core\.integer<"usize">$/u);
    const result=line.trimStart().split(' ')[0];
    assert.ok(convertLines.some(line=>line.includes('('+result+')')&&line.includes(anchor)
      &&line.endsWith('(!tsfg_core.integer<"usize">) -> f64')),'conversion consumes the same length and source range');
    if(value.receiver.kind==='call') {
      const target='@"f'+value.receiver.target.slice(7)+'"';
      const calls=text.split('\n').filter(line=>line.includes(target)&&line.includes('callee ='));
      assert.equal(calls.length,1);
      assert.ok(line.includes('('+calls[0].trimStart().split(' ')[0]+')'),'length consumes the one receiver call');
    }
  }
});

test('the String length profile requires explicit selection and the builtin declaration identity',()=>{
  assert.throws(()=>readTypedArrayFacts(bytes),{code:'r03-typed-array-schema'});
  assert.equal(buildHir(facts,{...context,version:2}).status,'error');
  const wrong=structuredClone(facts);
  const expression=wrong.payload.functions.flatMap(fn=>fn.body.map(row=>row.value)).find(value=>value?.kind==='stringLength');
  expression.property=wrong.payload.arrayLength.id;
  assert.throws(()=>readTypedArrayFacts(withPackageIdentity(wrong),9),{code:'r03-typed-array-type'});
});

test('String length cannot claim a source range before the receiver',()=>{
  const wrong=structuredClone(facts);
  const expression=wrong.payload.functions.find(fn=>fn.name==='parameter').body[0].value;
  expression.range.start--;
  assert.throws(()=>readTypedArrayFacts(withPackageIdentity(wrong),9),{code:'r03-typed-array-source'});
});

test('a checked property fact requires a dot in the original Source',()=>{
  const wrong=structuredClone(facts);
  const {sourceRoot,rootFile,files,declarations,config,functions}=wrong.payload;
  const receiver=functions.find(fn=>fn.name==='parameter').body[0].value.receiver;
  const root=files.find(file=>file.path===rootFile),offset=receiver.range.end;
  assert.equal(root.content[offset],'.');
  root.content=root.content.slice(0,offset)+'+'+root.content.slice(offset+1);
  root.sha256=sha256(root.content).slice(7);
  for(const type of wrong.payload.types.filter(type=>type.nominalKey))
    type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({
      files:files.map(({path,sha256})=>({path,sha256})),nominalKey:type.nominalKey}));
  const request={family:'tsfg.array-facts-request-candidate',version:9,
    input:{sourceRoot,rootFile,files:files.map(({path,content,sha256})=>({path,content,sha256})),declarations,config}};
  wrong.requestId=sha256('tsfg.array-facts.request.v9\0'+canonical(request)+'\n');
  assert.throws(()=>readTypedArrayFacts(withPackageIdentity(wrong),9),{code:'r03-typed-array-source'});
});
