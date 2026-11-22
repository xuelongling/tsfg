// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {sha256} from '../../compiler/identity.mjs';
import {readGenericHir} from '../../compiler/generic-hir.mjs';

test('Source compilation selects Core before awaiting the frontend',async t=>{
  const fs=await import('node:fs/promises');
  const children=await import('node:child_process');
  const frontend=await import('../../compiler/frontend.mjs');
  const generic=await import('../../compiler/generic-package-frontend.mjs');
  const snapshotBytes=await fs.readFile(new URL('./testdata/formal-cold-profile/owned-snapshot-hir.json',import.meta.url));
  assert.equal(sha256(snapshotBytes),'sha256:5f22b4e99e09737ef6d58c544fc44a107d8fc0b6dc9d0c00ea52a9f837af8ae7');
  const {snapshot}=JSON.parse(snapshotBytes.toString('utf8'));
  frontend.validateFrontendSnapshot(snapshot);
  const fixture=name=>fs.readFile(new URL('./fixtures/generic-recursive-conditional-'+name+'-v7.json',import.meta.url));
  const packageBytes=await fixture('package'),hir=readGenericHir(await fixture('hir'));
  const lateCore=path.join(import.meta.dirname,'late-core-transport','core.exe');
  const lateManifest=path.join(path.dirname(lateCore),'artifact-manifest.json');
  let childCalls=0;
  const noChild=()=>{childCalls++;assert.fail('compiler options unit must not spawn a producer or consumer');};
  let resume,observedFrontend;
  const waitForSource=executable=>{
    observedFrontend=executable;
    return new Promise(resolve=>{resume=resolve;});
  };
  const overrides=[
    t.mock.module(new URL('../../compiler/frontend.mjs',import.meta.url).href,{
      namedExports:{...frontend,analyzeFrontend:async (_input,{executable})=>{
        await waitForSource(executable);
        return {status:'ok',snapshot};
      }}
    }),
    t.mock.module(new URL('../../compiler/generic-package-frontend.mjs',import.meta.url).href,{
      namedExports:{...generic,compilePackageHir:async (actualPackage,roots,{frontend})=>{
        assert.equal(actualPackage,packageBytes);
        assert.deepEqual(roots,hir.closure.roots);
        await waitForSource(frontend);
        return {status:'ok',hir};
      }}
    }),
    t.mock.module('node:fs/promises',{
      namedExports:{...Object.fromEntries(Object.entries(fs).filter(([name])=>name!=='default')),
        readFile:(file,...args)=>{
          if(file===lateManifest)throw new Error('late Core selection reached the manifest');
          return Reflect.apply(fs.readFile,fs,[file,...args]);
        }}
    }),
    t.mock.module('node:child_process',{
      namedExports:{...Object.fromEntries(Object.entries(children).filter(([name])=>name!=='default')),
        spawn:noChild,spawnSync:noChild}
    }),
  ];
  t.after(()=>{
    for(const override of overrides.reverse())override.restore();
    assert.equal(childCalls,0);
  });
  const {compileProgram,compileSourceCore,compileStaticProgram,compilePackage}=await import('../../compiler/pipeline.mjs');
  for(const [name,start] of /** @type {const} */ ([
    ['bytecode',options=>compileProgram(snapshot.identityInput,options)],
    ['Core text',options=>compileSourceCore(snapshot.identityInput,options)],
    ['static program',options=>compileStaticProgram(snapshot.identityInput,options)],
    ['generic package',options=>compilePackage(packageBytes,hir.closure.roots,options)],
  ]))await t.test(name,async()=>{
    resume=undefined;
    const options={frontend:'original-frontend.exe',core:undefined};
    const pending=start(options);
    assert.equal(observedFrontend,'original-frontend.exe');
    assert.equal(typeof resume,'function');
    options.frontend='late-frontend.exe';
    options.core=lateCore;
    /** @type {()=>void} */ (resume)();
    const result=await pending;
    assert.equal(result.status,'tool-error');
    assert.equal(result.code,'r03-d-consumer');
    assert.equal(result.message,'r03-tool-core: formal executable is required');
  });
});
