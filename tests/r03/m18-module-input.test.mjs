// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceInput} from '../../compiler/pipeline.mjs';
import {prepareFrontendInput} from '../../compiler/frontend-response.mjs';
import {admittedInputScope, admittedConversionScope, sourceIsExternal} from '../../compiler/conversions.mjs';
import {canonical, sha256} from '../../compiler/identity.mjs';

async function moduleInput() {
  const input = await sourceInput('import {leaf} from "./leaf"; export function entry(x:f64):i8 { return checked_i8_from_f64(leaf(x)); }',
    {declarationVersion:'minimal-conversions-v5'});
  input.files.push({path:'/src/leaf.ts', content:'export function leaf(x:f64):f64 { return x; }'},
    {path:'/src/host.d.ts', content:'declare function tick(x:i32):i32; declare function tally(x:i32):i32;'});
  input.declarations.paths.push('/src/host.d.ts');
  const compilationClosure = {roots:[
    {kind:'hot-function', sourcePath:'/src/leaf.ts', name:'leaf'},
    {kind:'application', sourcePath:'/src/main.ts', name:'entry'},
  ], requiredRoots:[]};
  const hostImports = ['tick','tally'].map(name=>({sourcePath:'/src/host.d.ts', name,
    capabilityId:31, parameterTypes:['i32'], returnType:'i32'}));
  return {...input,compilationClosure,hostImports};
}

test('M18 conversion scope admits independently checked normalized multi-source closure and Host input', async()=>{
  const input = await moduleInput(), prepared = await prepareFrontendInput(input);
  assert.equal(prepared.status, 'ready');
  const scope = prepared.identityInput;
  assert.deepEqual(scope.files.map(file=>file.path), ['/src/host.d.ts','/src/leaf.ts','/src/main.ts','/src/minimal-conversions-v5.d.ts']);
  assert.deepEqual(scope.compilationClosure.roots.map(root=>root.kind), ['application','hot-function']);
  assert.deepEqual(scope.hostImports.map(host=>host.name), ['tally','tick']);
  assert.equal(admittedInputScope(scope, prepared.inputIdentity), true);
  assert.equal(admittedConversionScope(scope, prepared.inputIdentity), true);
  const withoutHosts = structuredClone(scope); delete withoutHosts.hostImports;
  assert.equal(admittedConversionScope(withoutHosts, sha256(canonical(withoutHosts))), true);
});

test('M18 rehashed module input still rejects malformed identity, normalization and source/declaration associations', async()=>{
  const prepared = await prepareFrontendInput(await moduleInput());
  const mutations = [
    scope=>scope.files.reverse(),
    scope=>scope.files.push({...scope.files[0]}),
    scope=>{scope.files[0].path='/outside/host.d.ts';},
    scope=>{scope.files[0].sha256='sha256:'+'0'.repeat(64);},
    scope=>{scope.files[0].path='/src/../host.d.ts';},
    scope=>{scope.files.find(file=>file.path==='/src/leaf.ts').path='/src/leaf.tsx';},
    scope=>{scope.rootFile='/src/missing.ts';},
    scope=>{scope.declarations.paths.push('/src/leaf.ts');},
    scope=>{scope.declarations.paths.push('/src/missing.d.ts');},
    scope=>{scope.declarations.paths.reverse();},
    scope=>{scope.target.pointerBits='32';},
    scope=>{scope.config.strict=false;},
    scope=>{scope.extra=true;},
    scope=>scope.compilationClosure.roots.reverse(),
    scope=>scope.compilationClosure.roots.push({...scope.compilationClosure.roots[0]}),
    scope=>{scope.compilationClosure.roots[0].sourcePath='/src/missing.ts';},
    scope=>{scope.compilationClosure.roots[0].sourcePath='/src/host.d.ts';},
    scope=>{scope.compilationClosure.roots[0].name='';},
    scope=>{scope.compilationClosure.roots[0].kind='arbitrary';},
    scope=>{scope.compilationClosure.extra=true;},
    scope=>scope.hostImports.reverse(),
    scope=>scope.hostImports.push({...scope.hostImports[0]}),
    scope=>{scope.hostImports[0].sourcePath='/src/missing.d.ts';},
    scope=>{scope.hostImports[0].sourcePath='/src/main.ts';},
    scope=>{scope.hostImports[0].capabilityId=32;},
    scope=>{scope.hostImports[0].parameterTypes=['f64'];},
    scope=>{scope.hostImports[0].returnType='f64';},
    scope=>{scope.hostImports[0].name='';},
    scope=>{scope.hostImports[0].extra=true;},
    scope=>{scope.hostImports={};},
  ];
  for(const [index,mutate] of mutations.entries()) {
    const forged=structuredClone(prepared.identityInput); mutate(forged);
    assert.equal(admittedInputScope(forged,sha256(canonical(forged))),false,`mutation ${index}`);
  }
  assert.equal(admittedInputScope(prepared.identityInput,'sha256:'+'0'.repeat(64)),false);
  const forged=structuredClone(prepared.identityInput);
  forged.files.find(file=>file.path.endsWith('minimal-conversions-v5.d.ts')).content+='\ndeclare const forged:i32;';
  assert.equal(admittedConversionScope(forged,sha256(canonical(forged))),false);
});

test('M18 conversion exclusivity checks every actual script and global augmentation without rejecting other modules locals', async()=>{
  const input=await moduleInput();
  /** @type {[string,string,boolean][]} */
  const cases=[
    ['/src/unused.ts','declare function checked_i8_from_f64(x:f64):i8;',false],
    ['/src/unused.ts','const ordinary = 1 < 2, __tsfg_i8 = 0;',false],
    ['/src/unused.ts','export {}; declare global { function checked_i8_from_f64(x:f64):i8; }',false],
    ['/src/unloaded.d.ts','declare const __tsfg_i8:unique symbol;',false],
    ['/src/unloaded.d.ts','export {}; declare global { interface f64 {} }',false],
    ['/src/unloaded.d.ts','export {}; declare global { const { safe: __tsfg_i8 }: { safe: unique symbol }; }',false],
    ['/src/unloaded.d.ts','declare const __tsfg_\\u00698:unique symbol;',false],
    ['/src/unused.ts','\\u{110000}',false],
    ['/src/unused.ts','export function checked_i8_from_f64(x:f64):i8 { return 1; }',true],
    ['/src/unloaded.d.ts','export function checked_i8_from_f64(x:f64):i8;',true],
    ['/src/unused.ts','import {leaf as checked_i8_from_f64} from "./leaf"; export {};',true],
    ['/src/unused.ts','export {}; namespace local { export const checked_i8_from_f64:i32=1; }',true],
    ['/src/unused.ts','const text="declare function checked_i8_from_f64()"; /* type f64=never; */',true],
  ];
  for(const [path,content,expected] of cases) {
    const candidate=structuredClone(input);candidate.files.push({path,content});
    const prepared=await prepareFrontendInput(candidate);
    assert.equal(prepared.status,'ready');
    assert.equal(admittedConversionScope(prepared.identityInput,prepared.inputIdentity),expected,content);
  }
});

test('M18 single-source admission retains its closed file and top-level input key restrictions',async()=>{
  const input=await sourceInput('export function entry(x:f64):i8 { return checked_i8_from_f64(x); }',
    {declarationVersion:'minimal-conversions-v5'});
  const prepared=await prepareFrontendInput(input);
  assert.equal(admittedConversionScope(prepared.identityInput,prepared.inputIdentity),true);
  for(const mutate of [scope=>scope.files.push({path:'/src/extra.ts',content:'export {};'}),
    scope=>{scope.hostImports=[];},scope=>scope.files.reverse()]) {
    const forged=structuredClone(prepared.identityInput);mutate(forged);
    assert.equal(admittedInputScope(forged,sha256(canonical(forged))),false);
  }
});

test('M18 ordinary source module classification uses owned lexical import and export indicators',()=>{
  for(const source of ['export {};','import "./leaf";','import {leaf} from "./leaf";',
    'export function checked_i8_from_f64(x:f64):i8 { return 1; }'])
    assert.equal(sourceIsExternal(source),true,source);
  for(const source of ['function entry():i32 { return 1; }','import("./leaf");',
    '// export {};\nconst text="import leaf";','function entry() { import("./leaf"); }'])
    assert.equal(sourceIsExternal(source),false,source);
  for(const source of ['/* unfinished','"unfinished',null,'\ud800','\\u{110000}'])
    assert.equal(sourceIsExternal(source),null);
});
