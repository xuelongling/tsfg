// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';
import registry from '../../contracts/registry.json' with {type:'json'};

export async function verifyModulePackages(inputPath,inputHash,manifestPath) {
  const bytes=readFileSync(inputPath);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),inputHash);
  const inputs=JSON.parse(bytes.toString('utf8')),manifest=[];
  for(const fixture of inputs.cases) {
    const built=buildHir(fixture.snapshot);
    assert.equal(built.status,'ok',JSON.stringify(built));
    const hir=readHir(Buffer.from(printHir(built.hir))),core=lowerFormalHir(hir);
    const canonical=await invokeCore(core);accepted(canonical);
    const repeated=await invokeCore(canonical.stdout);accepted(repeated);
    assert.deepEqual(repeated.stdout,canonical.stdout);
    const wire=await invokeCore(core,'--emit-bytecode');accepted(wire);
    assert.equal(wire.stdout.subarray(0,8).toString(),'TSFGTBC0');
    assert.equal(wire.stdout.readUInt32LE(8),12);
    assert.equal('sha256:'+wire.stdout.subarray(12,44).toString('hex'),registry['tsfg.bytecode'].schemaHash);
    assert.equal(wire.stdout.readUInt32LE(44),wire.stdout.length);
    assert.deepEqual(wire.stdout.subarray(48,80),createHash('sha256').update(wire.stdout.subarray(80)).digest());
    const llvm=await invokeCore(core,'--emit-native-llvm');accepted(llvm);
    assert.match(llvm.stdout.toString(),/@tsfg_aot_invoke_v4/);
    const object=await invokeCore(core,'--emit-native-object');accepted(object);
    assert.ok(object.stdout.length>100);
    manifest.push({id:fixture.id,coreSha256:createHash('sha256').update(core).digest('hex'),functions:hir.functions.map(fn=>({id:fn.id,name:fn.name,source:fn.sourcePath})),
      roots:hir.closure.roots,initialization:hir.closure.initialization});
  }
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
}
