// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildHir,printHir,readHir,verifyHir} from '../../compiler/hir.mjs';

test('actual official generic Array facts retain T and initialized undefined in owned HIR',async()=>{
  const bytes=await readFile(new URL('./testdata/typed-array-source-v8-probe.json',import.meta.url));
  const packet=JSON.parse(bytes.toString('utf8'));
  // Producer identity/provenance lives in the main25 single summary. This test
  // reads captured bytes only, never starts Source/VM or invents checker facts.
  assert.equal(packet.packageId,'sha256:a1fe3565172dc81f1c18beb465f41085cf71be97f3f1238c9b45568764600741');
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:packet.packageId};
  const built=buildHir(packet,context);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir;
  assert.equal(hir.format.contractVersion,'0.16.0');
  const array=hir.types.find(type=>type.kind==='array');
  const union=hir.types.find(type=>type.kind==='union');
  assert.equal(array.elementType,union.id);
  assert.deepEqual(union.members.map(id=>hir.types.find(type=>type.id===id).kind).sort(),['scalar','undefined']);
  const statements=hir.functions[0].body;
  assert.equal(statements[0].initializer.elements[0].kind,'undefined');
  assert.equal(statements[1].expression.kind,'arrayStoreDenseChecked');
  assert.equal(statements[2].value.kind,'arrayReadChecked');
  assert.equal(statements[2].value.declaredType,union.id);
  assert.equal(statements[2].value.type,hir.types.find(type=>type.kind==='undefined').id);
  assert.deepEqual(verifyHir(hir,context),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);
  assert.ok(Object.isFrozen(hir)&&Object.isFrozen(hir.types)&&Object.isFrozen(statements));
});
