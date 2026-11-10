// SPDX-License-Identifier: MIT
// Reads actual fixed-tool PE metadata. It never loads or executes the consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// MLIRSupport's fixed TypeID declaration/definition use LLVM_ALWAYS_EXPORT.
const implicitTypeIdExport='?registerImplicitTypeID@FallbackTypeIDResolver@detail@mlir@@KA?AVTypeID@3@VStringRef@llvm@@@Z';

function coffBlocks(text,name){
  const pattern=new RegExp('(?:^|\\r?\\n)'+name+' \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\}','g');
  return [...text.matchAll(pattern)].map(match=>match[1]);
}

function verifyConsumerPe(text){
  assert.match(text,/^Format: COFF-x86-64\r?$/m);
  assert.match(text,/^Arch: x86_64\r?$/m);
  assert.match(text,/^AddressSize: 64bit\r?$/m);
  assert.match(text,/Machine: IMAGE_FILE_MACHINE_AMD64 \(0x8664\)/);
  assert.match(text,/Magic: 0x20B\b/);
  assert.match(text,/IMAGE_FILE_EXECUTABLE_IMAGE/);
  assert.doesNotMatch(text,/IMAGE_FILE_DLL\b/);
  assert.match(text,/Subsystem: IMAGE_SUBSYSTEM_WINDOWS_CUI/);
  assert.match(text,/IMAGE_DLL_CHARACTERISTICS_DYNAMIC_BASE/);
  assert.match(text,/IMAGE_DLL_CHARACTERISTICS_NX_COMPAT/);
  const entry=text.match(/AddressOfEntryPoint: (0x[0-9A-Fa-f]+)/);assert.ok(entry);
  assert.ok(Number.parseInt(entry[1],16)>0);
  const imports=coffBlocks(text,'Import').map(block=>{
    const name=block.match(/^\s*Name: (\S+)\r?$/m);assert.ok(name);
    const symbols=[...block.matchAll(/^\s*Symbol: (\S+) \([^\r\n]*\)\r?$/gm)].map(match=>match[1]);
    assert.ok(symbols.length>0);assert.equal(new Set(symbols).size,symbols.length);
    return {name:name[1],symbols};
  });
  assert.ok(imports.length>0);assert.equal(new Set(imports.map(row=>row.name.toLowerCase())).size,imports.length);
  const forbidden=/(?:vulkan|lavapipe|mesa|llvm|^(?:msvcrt|msvcr\d+d?|msvcp\d+d?|vcruntime\d+(?:_\d+)?d?|ucrtbased?)\.dll$|^api-ms-win-crt-)/i;
  imports.forEach(row=>{assert.doesNotMatch(row.name,forbidden,'no static Vulkan/backend or dynamic CRT dependency');
    row.symbols.forEach(symbol=>assert.doesNotMatch(symbol,/^(?:__imp_)?vk[A-Z]/,'Vulkan entry points stay behind the explicit Loader gate'));});
  const kernel=imports.filter(row=>row.name.toLowerCase()==='kernel32.dll');assert.equal(kernel.length,1);
  for(const symbol of ['LoadLibraryExW','GetProcAddress','FreeLibrary'])assert.ok(kernel[0].symbols.includes(symbol),symbol+' is linked from the fixed Windows import role');
  assert.equal(coffBlocks(text,'DelayImport').length,0);
  const exports=coffBlocks(text,'Export').map(block=>{
    const name=block.match(/^\s*Name: (\S+)\r?$/m),rva=block.match(/^\s*RVA: (0x[0-9A-Fa-f]+)\r?$/m);assert.ok(name&&rva);
    const address=Number.parseInt(rva[1],16);assert.ok(address>0);return {name:name[1],address};
  });
  assert.deepEqual(exports.map(row=>row.name).sort(),[implicitTypeIdExport,'tsfg_gpu_software_interface','tsfg_gpu_software_owned_link']);
  assert.equal(new Set(exports.map(row=>row.address)).size,3);
  return {imports,exports};
}

const capture=process.env.TSFG_GPU_SOFTWARE_VULKAN_READOBJ;
test('actual software Vulkan consumer PE links the owned interface without loading Vulkan',
  {skip:capture?false:'TSFG_GPU_SOFTWARE_VULKAN_READOBJ is not supplied'},async()=>{
    assert.ok(path.isAbsolute(capture));const text=await fs.readFile(capture,'utf8');
    const actual=verifyConsumerPe(text);assert.ok(actual.imports.length>0);
    const controls=[
      value=>value.replace('Machine: IMAGE_FILE_MACHINE_AMD64 (0x8664)','Machine: IMAGE_FILE_MACHINE_I386 (0x14C)'),
      value=>value.replace('Format: COFF-x86-64','Format: COFF-i386'),
      value=>value.replace(/Name: KERNEL32\.dll/i,'Name: vulkan-1.dll'),
      value=>value+'\nImport {\n  Name: VCRUNTIME140.dll\n  Symbol: _CxxThrowException (0)\n}\n',
      value=>value.replace(/^\s*Symbol: GetProcAddress \([^\r\n]*\)\r?\n/m,''),
      value=>value.replace('Name: tsfg_gpu_software_interface','Name: missing_owned_interface'),
      value=>value.replace(/RVA: 0x[0-9A-Fa-f]+(?=\r?\n\})/,'RVA: 0x0'),
      value=>value+'\nDelayImport {\n  Name: vulkan-1.dll\n}\n',
      value=>value.replace(implicitTypeIdExport,'unqualified_mlir_export'),
    ];
    controls.forEach(change=>{const changed=change(text);assert.notEqual(changed,text);assert.throws(()=>verifyConsumerPe(changed));});
  });
