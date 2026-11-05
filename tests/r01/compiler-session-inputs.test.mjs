// SPDX-License-Identifier: MIT
// Input-guard units only: no Source execution, Core admission success or VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');

const productUrl=new URL('../../',import.meta.url);
const productRoot=fileURLToPath(productUrl);

test('session inputs close the real static module graph and frontend declaration data',async()=>{
  const pending=['compiler/pipeline.mjs'],required=new Set();
  let pipeline;
  while(pending.length) {
    const name=pending.pop();
    if(required.has(name))continue;
    required.add(name);
    const text=await readFile(new URL(name,productUrl),'utf8');
    if(!name.endsWith('.mjs'))continue;
    const parsed=ts.createSourceFile(name,text,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
    if(name==='compiler/pipeline.mjs')pipeline=parsed;
    for(const statement of parsed.statements) {
      if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement))continue;
      const specifier=statement.moduleSpecifier;
      if(!specifier)continue;
      assert.ok(ts.isStringLiteralLike(specifier),'module requests must be literal');
      if(!specifier.text.startsWith('.')) {
        assert.ok(specifier.text.startsWith('node:'),'unexpected external module '+specifier.text);
        continue;
      }
      const child=path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier.text));
      assert.ok(!child.startsWith('../')&&!path.posix.isAbsolute(child),'module escapes product');
      assert.match(child,/\.(mjs|json)$/,'unsupported static input '+child);
      pending.push(child);
    }
  }
  // prepareFrontendInput reads these files by a selected declaration profile;
  // they are data dependencies even though they are not ESM module requests.
  const sourceLock=JSON.parse(await readFile(new URL('eng/frontend-source.lock.json',productUrl),'utf8'));
  for(const {path:name} of sourceLock.declarations) {
    await readFile(new URL(name,productUrl));
    required.add(name);
  }
  assert.ok(pipeline);
  const declaration=pipeline.statements.filter(ts.isVariableStatement)
    .flatMap(statement=>[...statement.declarationList.declarations])
    .find(row=>ts.isIdentifier(row.name)&&row.name.text==='sessionInputs');
  assert.ok(declaration?.initializer&&ts.isArrayLiteralExpression(declaration.initializer),
    'production must retain one explicit input table');
  const declared=declaration.initializer.elements.map(value=>{
    assert.ok(ts.isStringLiteralLike(value),'session input names are explicit literals');return value.text;
  });
  assert.equal(new Set(declared).size,declared.length,'session input table has duplicate members');
  assert.deepEqual(declared.filter(name=>!required.has(name)).sort(),[],
    'session guard should not read unrelated build or SDK inventories');
  assert.deepEqual([...required].filter(name=>!declared.includes(name)).sort(),[],
    'session inputs omit actual transitive code or data');
});

test('real session fingerprint rejects changed code and data before Core admission',async t=>{
  const frontend=await import('../../compiler/frontend.mjs');
  const fs=await import('node:fs/promises');
  const childProcess=await import('node:child_process');
  const opaque=Object.freeze({unitBoundary:'opaque-upstream-token-not-Source-or-HIR'});
  let changed,mutatedReads=0,spawns=0;
  const frontendMock=t.mock.module(new URL('../../compiler/frontend.mjs',import.meta.url).href,{
    namedExports:{...frontend,analyzeFrontend:async()=>({status:'ok',snapshot:opaque})}
  });
  const fsMock=t.mock.module('node:fs/promises',{
    namedExports:{...Object.fromEntries(Object.entries(fs).filter(([name])=>name!=='default')),
      readFile:async(file,options)=>{
        const bytes=await fs.readFile(file,options);
        const name=file instanceof URL?fileURLToPath(file):typeof file==='string'?path.resolve(file):undefined;
        if(changed===undefined||name!==changed)return bytes;
        mutatedReads++;
        return typeof bytes==='string'?bytes+'\n ':Buffer.concat([bytes,Buffer.from('\n ')]);
      }}
  });
  const childMock=t.mock.module('node:child_process',{
    namedExports:{...Object.fromEntries(Object.entries(childProcess).filter(([name])=>name!=='default')),
      spawnSync:()=>{spawns++;throw new Error('input-guard unit must not spawn a producer or consumer');}}
  });
  t.after(()=>{frontendMock.restore();fsMock.restore();childMock.restore();assert.equal(spawns,0);});
  const {createCompilerSession}=await import('../../compiler/pipeline.mjs');
  for(const name of ['compiler/common-program-facts.mjs','compiler/common-program-entry.mjs',
    'contracts/module-callable-candidate.schema.json','compiler/minimal-bool-v1.d.ts']) {
    changed=undefined;mutatedReads=0;
    // The absent Core is the real admission failure. The opaque upstream token
    // must never reach buildHir, a real/fake Core consumer or a success result.
    const session=createCompilerSession({frontend:undefined,core:undefined});
    const baseline=await session.compile(null);
    assert.equal(baseline.status,'tool-error');assert.equal(baseline.code,'r03-d-consumer');
    assert.match(baseline.message,/r03-tool-core: formal executable is required/);
    changed=path.resolve(productRoot,name);
    const rejected=await session.compile(null);
    assert.equal(rejected.status,'tool-error');assert.equal(rejected.code,'r03-d-consumer');
    assert.match(rejected.message,/r03-compiler-input: compiler inputs changed during session/,name);
    assert.ok(mutatedReads>0,'production fingerprint must really read '+name);
    assert.deepEqual(session.statistics(),{analyses:2,lowerings:0,reuses:0});
  }
});
