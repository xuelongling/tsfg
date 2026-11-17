// SPDX-License-Identifier: MIT
// Exact qualified common Source captures, retaining their original package bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readCommonProgramFacts,verifyCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir,verifyCommonProgramHir,printCommonProgramHir,readCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {byteOrder,originId} from '../../compiler/typed-array-schema.mjs';
const names=['positive','reachable-managed','reference-value','mixed'];
const bytes=new Map(await Promise.all(names.map(async name=>/** @type {[string,Buffer]} */([name,await fs.readFile(new URL('./common-program-'+name+'.json',import.meta.url))]))));
assert.equal(sha256(bytes.get('mixed')),'sha256:520a692f14cbcb7632a13cc338d78ae46f7abdbdb62d1290fe40a81c645447f0');
const facts=new Map([...bytes].map(([name,raw])=>[name,readCommonProgramFacts(raw)]));
const context=name=>({family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes.get(name),expectedPackageId:facts.get(name).packageId});
const hirs=new Map([...facts].map(([name,value])=>[name,buildCommonProgramHir(value,context(name))]));

for(const name of names)test('complete real common Source to cold owned HIR: '+name,()=>{
  const hir=hirs.get(name);assert.deepEqual(hir.functions.map(fn=>fn.name).sort(),name==='mixed'?['add','bump','left','ordinary','right','run','view']:['add','left','ordinary','right']);
  assert.equal(hir.globals.length,2);assert.equal(hir.modules.length,name==='mixed'?4:1);assert.equal(hir.modules.reduce((n,row)=>n+row.initialization.length,0),2);
  assert.deepEqual(hir.closure.roots.filter(root=>root.kind==='kernel').map(root=>root.name),['left','right']);
  assert.equal(hir.functions.find(fn=>fn.name==='ordinary').body[1].kind,'try');
  assert.equal(hir.types.filter(type=>['value','reference'].includes(type.kind)).length,2);
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
});
test('one mixed Program preserves namespace, re-export, ReadSpan and finally joins',()=>{
  const hir=hirs.get('mixed'),path=id=>hir.modules.find(row=>row.initializer===id).sourcePath;
  assert.deepEqual(hir.closure.initialization.map(path),['/src/data.ts','/src/state.ts','/src/barrel.ts','/src/main.ts']);
  assert.equal(hir.functions.find(fn=>fn.name==='ordinary').body[1].finallyBlock.body[0].value.callee,hir.functions.find(fn=>fn.name==='bump').id);
  assert.equal(hir.functions.find(fn=>fn.name==='view').body[0].value.callee,hir.functions.find(fn=>fn.name==='run').id);
  assert.ok(hir.types.some(type=>type.kind==='array'));assert.ok(hir.types.some(type=>type.kind==='readSpan'));
  assert.equal(hir.functions.find(fn=>fn.name==='run').body[1].initializer.callee,'intrinsic:readSpan');
  assert.equal(sha256(printCommonProgramHir(hir)),'sha256:a50a8050c89e1eeb1b58f2f304f69a10642baf561932dfd86ebb000576fa2e90');
});

test('body edits preserve stable declarations, signatures, GlobalIds and semantic shape',()=>{
  const a=hirs.get('positive'),b=hirs.get('reachable-managed');assert.notEqual(a.inputIdentity,b.inputIdentity);
  for(const fn of a.functions){const other=b.functions.find(row=>row.name===fn.name);assert.equal(fn.id,other.id);assert.equal(fn.signatureHash,other.signatureHash);}
  assert.deepEqual(a.globals.map(row=>row.id),b.globals.map(row=>row.id));
  assert.deepEqual(a.types.map(row=>row.id),b.types.map(row=>row.id));
  assert.notEqual(a.functions.find(fn=>fn.name==='ordinary').sourceBinding,b.functions.find(fn=>fn.name==='ordinary').sourceBinding);
});
test('adding a managed reference to inline value changes stable semantic signature',()=>{
  const a=hirs.get('positive'),b=hirs.get('reference-value');
  for(const name of ['add','left'])assert.notEqual(a.functions.find(fn=>fn.name===name).signatureHash,b.functions.find(fn=>fn.name===name).signatureHash);
  assert.equal(a.functions.find(fn=>fn.name==='right').id,b.functions.find(fn=>fn.name==='right').id);
});
test('selected complete package context cannot be replaced by a different real package',()=>{
  assert.throws(()=>buildCommonProgramHir(facts.get('positive'),context('reachable-managed')),/** @param {any} error */ error=>error.code==='r03-common-program-context');
});
test('semantic HIR is reconstructed independently of retained raw snapshot',()=>{
  const changed=structuredClone(hirs.get('positive'));changed.functions=changed.functions.filter(fn=>fn.name!=='ordinary');
  assert.throws(()=>verifyCommonProgramHir(changed),/** @param {any} error */ error=>error.code==='r03-common-program-reconstruct');
});

function mutated(change,name='positive') {
  const value=structuredClone(facts.get(name));change(value.payload);
  const p=value.payload,tuples=rows=>rows.map(({kind,sourcePath,name})=>({kind,sourcePath,name}));
  const request={family:'tsfg.program-facts-request-candidate',version:2,schemaHash:value.schemaHash,input:{sourceRoot:p.sourceRoot,rootFile:p.rootFile,
    files:p.files.map(({path,content,sha256})=>({path,content,sha256})),declarations:p.declarations,config:p.config,target:p.target,
    compilationClosure:{roots:tuples(p.closure.roots),requiredRoots:tuples(p.closure.requiredRoots)},
    hostImports:p.hostImports.map(({sourcePath,name,capabilityId,parameterTypes,returnType})=>({sourcePath,name,capabilityId,parameterTypes,returnType}))}};
  value.requestId=sha256('tsfg.program-facts.request.v2\0'+canonical(request)+'\n');
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(p));return value;
}
test('cold verifier rejects ordinary function omission even after matching package hashes',()=>{
  const value=mutated(p=>{const removed=p.functions.find(fn=>fn.name==='ordinary');p.functions=p.functions.filter(fn=>fn!==removed);
    p.exports=p.exports.filter(row=>row.functionId!==removed.id);p.modules[0].exports=p.modules[0].exports.filter(row=>row.target!==removed.id);
    p.closure.roots=p.closure.roots.filter(row=>row.target!==removed.id);p.entryCompatibilityRoots=p.entryCompatibilityRoots.filter(row=>row.functionId!==removed.id);});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-source');
});
test('cold verifier checks actual class permissions rather than trusting changed metadata',()=>{
  const value=mutated(p=>{p.types.find(type=>type.kind==='value').fields[0].access='private';});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-permission');
});
test('catch binding cannot be read before its lexical catch activation',()=>{
  const value=mutated(p=>{const fn=p.functions.find(fn=>fn.name==='ordinary');fn.body[1].tryBlock.body[0].value.binding=fn.bindings.find(b=>b.kind==='catch').id;});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-binding');
});
test('source global reference must join original resolved binding, not a matching scalar type',()=>{
  const value=mutated(p=>{const fn=p.functions.find(fn=>fn.name==='add');fn.body[1].value.binding=p.globals[1].binding.id;});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-binding');
});
test('unknown raw fields and malformed canonical bytes fail before derived publication',()=>{
  const value=structuredClone(facts.get('positive'));value.payload.authority=true;
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-schema');
  assert.throws(()=>readCommonProgramFacts(Buffer.concat([bytes.get('positive'),Buffer.from(' ')])),/** @param {any} error */ error=>error.code==='r03-common-program-canonical');
});
test('behavioral and over-budget objects are rejected before any getter or clone',()=>{
  let read=0;const value={};Object.defineProperty(value,'payload',{enumerable:true,get(){read++;throw Error('getter');}});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-input');assert.equal(read,0);
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>verifyCommonProgramFacts(cyclic));
  assert.throws(()=>verifyCommonProgramFacts({payload:'a'.repeat(2097153)}),/** @param {any} error */ error=>error.code==='r03-common-program-limit');
});
const checkedExportMutations=[
  ['retargeted named re-export',p=>{
    const barrel=p.modules.find(module=>module.sourcePath==='/src/barrel.ts');
    const original=barrel.exports.find(row=>row.name==='add');
    const other=barrel.exports.find(row=>row.name==='bump');
    Object.assign(original,{target:other.target,definitionRange:other.definitionRange});
  }],
  ['additional name at a named re-export',p=>{
    const barrel=p.modules.find(module=>module.sourcePath==='/src/barrel.ts');
    const run=barrel.exports.find(row=>row.name==='run');
    barrel.exports.splice(barrel.exports.length-1,0,{...run,name:'root'});
  }],
  ['misclassified nominal export',p=>{
    p.modules.find(module=>module.sourcePath==='/src/data.ts').exports.find(row=>row.name==='Box').kind='function';
  }],
  ['missing named re-export',p=>{
    const barrel=p.modules.find(module=>module.sourcePath==='/src/barrel.ts');
    barrel.exports=barrel.exports.filter(row=>row.name!=='bump');
  }],
];
for (const [title,change] of checkedExportMutations) test('retained mixed module rejects '+title,()=>{
  const packet=mutated(change,'mixed');
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(packet)+'\n')),{code:'r03-common-program-export'});
});
const directExportMutations=[
  ['wrong direct function export name',p=>{
    const main=p.modules.find(module=>module.sourcePath==='/src/main.ts');
    main.exports.find(row=>row.name==='ordinary').name='other';
    p.exports.find(row=>row.name==='ordinary').name='other';
  }],
  ['wrong direct function export target',p=>{
    const main=p.modules.find(module=>module.sourcePath==='/src/main.ts');
    const other=main.exports.find(row=>row.name==='view');
    Object.assign(main.exports.find(row=>row.name==='ordinary'),{target:other.target,definitionRange:other.definitionRange});
    const entry=p.exports.find(row=>row.name==='ordinary');
    p.entryCompatibilityRoots=p.entryCompatibilityRoots.filter(row=>row.functionId!==entry.functionId);
    entry.functionId=other.target;
  }],
  ['wrong direct class export anchor',p=>{
    const data=p.modules.find(module=>module.sourcePath==='/src/data.ts');
    data.exports.find(row=>row.name==='Box').range=data.exports.find(row=>row.name==='Delta').range;
  }],
  ['wrong direct global export anchor',p=>{
    const state=p.modules.find(module=>module.sourcePath==='/src/state.ts');
    state.exports.find(row=>row.name==='leftTotal').range=state.exports.find(row=>row.name==='rightTotal').range;
  }],
  ['missing direct export',p=>{
    const main=p.modules.find(module=>module.sourcePath==='/src/main.ts');
    main.exports=main.exports.filter(row=>row.name!=='ordinary');
    const entry=p.exports.find(row=>row.name==='ordinary');
    p.entryCompatibilityRoots=p.entryCompatibilityRoots.filter(row=>row.functionId!==entry.functionId);
    p.exports=p.exports.filter(row=>row!==entry);
  }],
];
for (const [title,change] of directExportMutations) test('retained mixed module rejects '+title,()=>{
  const packet=mutated(change,'mixed');
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(packet)+'\n')),{code:'r03-common-program-export'});
});

function refreshVariantSource(payload,file) {
  file.byteLength=Buffer.byteLength(file.content);file.utf16Length=file.content.length;file.sha256=sha256(file.content).slice(7);
  const files=payload.files.map(({path,sha256})=>({path,sha256}));
  for(const type of payload.types)if(type.nominalKey)
    type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files,nominalKey:type.nominalKey}));
  for(const fn of payload.functions)if(fn.sourcePath===file.path&&fn.lexicalParent===null)
    fn.declarationScope.end=file.utf16Length;
  for(const roots of [payload.closure.roots,payload.closure.requiredRoots])for(const row of roots)
    if(row.sourcePath===file.path&&row.kind==='module-initialization')row.range.end=file.utf16Length;
}

const byExportName=(left,right)=>byteOrder(left.name,right.name);
const entryKey=row=>row.functionId+'\0'+row.parameterBinding;
const byEntry=(left,right)=>byteOrder(entryKey(left),entryKey(right));

test('derived mixed Source default export retains the original declaration and call',()=>{
  // Insert the default modifier into the last declaration of the mixed root.
  // Rebase its original ranges and the identities that depend on those ranges.
  const packet=mutated(p=>{
    const sourcePath=p.rootFile,file=p.files.find(row=>row.path===sourcePath);
    const fn=p.functions.find(row=>row.sourcePath===sourcePath&&row.name==='view'),previousId=fn.id;
    const argument=fn.parameters[0],statement=fn.body[0],call=statement.value,reference=call.arguments[0];
    const modifier='default ',insertion=fn.declarationRange.start+'export '.length,units=modifier.length;
    file.content=file.content.slice(0,insertion)+modifier+file.content.slice(insertion);
    refreshVariantSource(p,file);
    const shift=range=>({start:range.start+units,end:range.end+units});
    fn.declarationRange.end+=units;
    fn.id=sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath,declarationRange:fn.declarationRange}));
    fn.nameRange=shift(fn.nameRange);fn.returnAnnotationRange=shift(fn.returnAnnotationRange);
    for(const key of ['nameRange','declarationRange','annotationRange'])argument[key]=shift(argument[key]);
    argument.id=originId(sourcePath,argument.nameRange);argument.lexicalOwner=fn.id;
    statement.range=shift(statement.range);call.range=shift(call.range);call.calleeRange=shift(call.calleeRange);
    reference.range=shift(reference.range);reference.binding=argument.id;
    const main=p.modules.find(row=>row.sourcePath===sourcePath);
    const definitionRange=fn.declarationRange;
    main.exports=main.exports.filter(row=>row.target!==previousId);
    main.exports.unshift({name:'default',kind:'function',target:fn.id,targetSourcePath:sourcePath,range:definitionRange,definitionRange});
    p.exports=p.exports.filter(row=>row.functionId!==previousId);
    p.exports.unshift({name:'default',functionId:fn.id});
    for(const entry of p.entryCompatibilityRoots)if(entry.functionId===previousId){
      entry.functionId=fn.id;entry.parameterBinding=argument.id;entry.origin={source:sourcePath,...argument.declarationRange};
    }
    p.entryCompatibilityRoots.sort(byEntry);
    for(const rows of [p.closure.roots,p.closure.requiredRoots])for(const row of rows)
      if(row.target===previousId){row.target=fn.id;row.range=definitionRange;}
  },'mixed');
  const factsBytes=Buffer.from(canonical(packet)+'\n'),facts=readCommonProgramFacts(factsBytes);
  const hir=buildCommonProgramHir(facts,{...context('mixed'),factsBytes,expectedPackageId:facts.packageId});
  const main=hir.modules.find(row=>row.sourcePath===hir.rootFile),view=hir.functions.find(row=>row.name==='view');
  const exported=main.exports.find(row=>row.name==='default'),source=hir.sources.find(row=>row.path===hir.rootFile);
  assert.equal(exported.target,view.id);
  assert.equal(view.id,hirs.get('mixed').functions.find(row=>row.name==='view').id);
  assert.equal(view.body[0].value.callee,hir.functions.find(row=>row.name==='run').id);
  assert.deepEqual(exported.range,view.range);
  assert.match(source.content.slice(view.range.start,view.range.end),/^export default function view\b/);
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
});

function appendStar(module,file,origin,kind='export',trivia='') {
  const text="export "+trivia+"* from '"+origin.specifier+"';",start=file.content.length;
  module.imports.push({kind,specifier:origin.specifier,sourcePath:origin.sourcePath,range:{start,end:start+text.length},bindings:[]});
  file.content+=text+'\n';
}

function appendShadowedStar(payload,module,file,sourcePath,residual=null) {
  const barrel=payload.modules.find(row=>row.sourcePath==='/src/barrel.ts');
  const origin=barrel.imports.find(row=>row.sourcePath===sourcePath);
  const selected=origin.bindings.filter(alias=>alias.name!==residual);
  const named="export { "+selected.map(alias=>alias.name).join(', ')+" } from '"+origin.specifier+"';";
  const start=file.content.length;
  const bindings=selected.map(alias=>{
    const offset=start+named.indexOf(alias.name);
    return {...alias,range:{start:offset,end:offset+alias.name.length}};
  });
  module.imports.push({...origin,range:{start,end:start+named.length},bindings});
  file.content+=named+'\n';
  appendStar(module,file,origin,residual?'export-star':'export');
  const upstream=payload.modules.find(row=>row.sourcePath===sourcePath);
  for(const alias of bindings)module.exports.push({...upstream.exports.find(row=>row.name===alias.name),range:alias.range});
  if(residual){
    const exportRow=upstream.exports.find(row=>row.name===residual);
    module.exports.push({...exportRow,range:exportRow.definitionRange});
  }
  module.exports.sort(byExportName);
  refreshVariantSource(payload,file);
}

function derivedStar(extraName,cycle=false,change=undefined) {
  return mutated(p=>{
    const root=p.rootFile,main=p.modules.find(row=>row.sourcePath===root),file=p.files.find(row=>row.path===root);
    const dataPath='/src/data.ts';
    appendShadowedStar(p,main,file,dataPath);
    const run=p.functions.find(row=>row.sourcePath===dataPath&&row.name==='run'),parameter=run.parameters[0];
    const view=main.exports.find(row=>row.name==='view');
    const entry=p.entryCompatibilityRoots.find(row=>row.functionId===view.target);
    p.exports.push({name:'run',functionId:run.id});
    p.entryCompatibilityRoots.push({...entry,functionId:run.id,parameterBinding:parameter.id,origin:{source:run.sourcePath,...parameter.declarationRange}});
    if(extraName){
      const unbacked={...view,name:extraName};
      main.exports.push(unbacked);
      p.exports.push({name:extraName,functionId:view.target});
      if(cycle){
        const data=p.modules.find(row=>row.sourcePath===dataPath),other=p.files.find(row=>row.path===dataPath);
        // Put the foreign defining offsets inside the opposing star's span.
        appendStar(data,other,{specifier:'./main',sourcePath:root},'export','/*'+' '.repeat(370)+'*/ ');
        data.exports.push(unbacked);data.exports.sort(byExportName);refreshVariantSource(p,other);
      }
    }
    change?.(main);
    main.exports.sort(byExportName);p.exports.sort(byExportName);p.entryCompatibilityRoots.sort(byEntry);
  },'mixed');
}

test('derived mixed Source accepts an explicit re-export shadowing a star',()=>{
  const {payload:p}=readCommonProgramFacts(Buffer.from(canonical(derivedStar(null))+'\n'));
  const main=p.modules.find(row=>row.sourcePath===p.rootFile),star=main.imports.at(-1);
  const source=p.files.find(row=>row.path===p.rootFile).content;
  assert.equal(source.slice(star.range.start,star.range.end),"export * from './data';");
  assert.deepEqual(main.exports.map(row=>row.name),['Box','Delta','left','ordinary','right','run','view']);
});

for(const cycle of [false,true])test('a derived '+(cycle?'cyclic':'one-hop')+' star cannot authorize an unrelated direct export',()=>{
  const packet=derivedStar('unbacked',cycle);
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(packet)+'\n')),{code:'r03-common-program-export'});
});

for(const edgeKind of ['import','star'])test('a derived star cannot use the '+edgeKind+' edge as an original export',()=>{
  const packet=derivedStar('unbacked',false,main=>{
    const edge=edgeKind==='import'?main.imports.find(row=>row.kind==='import'):main.imports.at(-1);
    main.exports.find(row=>row.name==='unbacked').range=edge.range;
  });
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(packet)+'\n')),{code:'r03-common-program-export'});
});

test('a derived residual star resolves to the original upstream declaration',()=>{
  const dataPath='/src/data.ts',statePath='/src/state.ts';
  const packet=mutated(p=>{
    const data=p.modules.find(row=>row.sourcePath===dataPath),file=p.files.find(row=>row.path===dataPath);
    appendShadowedStar(p,data,file,statePath,'add');
  },'mixed');
  const {payload:p}=readCommonProgramFacts(Buffer.from(canonical(packet)+'\n'));
  const data=p.modules.find(row=>row.sourcePath===dataPath),run=data.exports.find(row=>row.name==='run');
  const state=p.modules.find(row=>row.sourcePath===statePath),add=state.exports.find(row=>row.name==='add');
  const indirect=data.exports.find(row=>row.name==='add');
  assert.ok(indirect.range.start>=run.range.start&&indirect.range.end<=run.range.end);
  assert.deepEqual(indirect,add);
});

function localExportVariant(change=undefined) {
  return mutated(p=>{
    const main=p.modules.find(row=>row.sourcePath===p.rootFile),file=p.files.find(row=>row.path===p.rootFile);
    const barrel=p.modules.find(row=>row.sourcePath==='/src/barrel.ts');
    const view=main.exports.find(row=>row.name==='view'),run=barrel.exports.find(row=>row.name==='run');
    const box=barrel.exports.find(row=>row.name==='Box');
    const clause='export { view as alias, readLocal as importedRun, Box };';
    const start=file.content.length;
    const local=[
      {specifier:'view as alias',name:'alias',original:view},
      {specifier:'readLocal as importedRun',name:'importedRun',original:run},
      {specifier:'Box',name:'Box',original:box},
    ];
    for(const {specifier,name,original} of local){
      const specifierStart=start+clause.indexOf(specifier);
      main.exports.push({...original,name,range:{start:specifierStart,end:specifierStart+specifier.length}});
    }
    p.exports.push({name:'alias',functionId:view.target},{name:'importedRun',functionId:run.target});
    const parameter=p.functions.find(row=>row.id===run.target).parameters[0];
    p.entryCompatibilityRoots.push({...p.entryCompatibilityRoots.find(row=>row.functionId===view.target),
      functionId:run.target,parameterBinding:parameter.id,origin:{source:run.targetSourcePath,...parameter.declarationRange}});
    file.content+=clause+'\n';
    change?.(p,main,file);
    main.exports.sort(byExportName);p.exports.sort(byExportName);p.entryCompatibilityRoots.sort(byEntry);
    refreshVariantSource(p,file);
  },'mixed');
}

test('derived local export rows cover each exact Go ExportSpecifier and resolve original bindings',()=>{
  const packet=localExportVariant(),factsBytes=Buffer.from(canonical(packet)+'\n');
  const verified=readCommonProgramFacts(factsBytes);
  const hir=buildCommonProgramHir(verified,{...context('mixed'),factsBytes,expectedPackageId:verified.packageId});
  const main=hir.modules.find(row=>row.sourcePath===hir.rootFile),source=hir.sources.find(row=>row.path===hir.rootFile).content;
  const alias=main.exports.find(row=>row.name==='alias'),imported=main.exports.find(row=>row.name==='importedRun');
  const nominal=main.exports.find(row=>row.name==='Box');
  assert.deepEqual([alias,imported,nominal].map(row=>source.slice(row.range.start,row.range.end)),
    ['view as alias','readLocal as importedRun','Box']);
  assert.equal(alias.target,hir.functions.find(row=>row.name==='view').id);
  assert.equal(imported.target,hir.functions.find(row=>row.name==='run').id);
  assert.equal(nominal.target,hir.types.find(row=>row.name==='Box').id);
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
});

const localExportMutations=[
  ['retargeting a local binding',(p,main)=>{
    const imported=main.exports.find(row=>row.name==='importedRun');
    const {target,targetSourcePath,definitionRange}=imported;
    Object.assign(main.exports.find(row=>row.name==='alias'),{target,targetSourcePath,definitionRange});
    p.exports.find(row=>row.name==='alias').functionId=target;
  }],
  ['omitting an original specifier',(p,main)=>{
    main.exports=main.exports.filter(row=>row.name!=='alias');p.exports=p.exports.filter(row=>row.name!=='alias');
  }],
  ['using an unowned public name',(p,main)=>{
    main.exports.find(row=>row.name==='alias').name='other';p.exports.find(row=>row.name==='alias').name='other';
  }],
  ['changing a clause token',(p,main,file)=>{file.content=file.content.replace('view as alias','view of alias');}],
  ['using the enclosing clause as the specifier span',(p,main,file)=>{
    main.exports.find(row=>row.name==='alias').range={start:file.content.lastIndexOf('export {'),end:file.content.length-1};
  }],
];
for(const [name,change] of localExportMutations)test('derived local export rejects '+name,()=>{
  const packet=localExportVariant(change);
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(packet)+'\n')),{code:'r03-common-program-export'});
});

for(const path of ['/src/barrel.ts','/src/main.ts'])test('cold verifier binds module edges to original order: '+path,()=>{
  const original=facts.get('mixed').payload.modules.find(module=>module.sourcePath===path);
  assert.equal(original.imports.length,2);
  assert.ok(original.imports[0].range.end<=original.imports[1].range.start);
  assert.notEqual(original.imports[0].sourcePath,original.imports[1].sourcePath);
  const value=mutated(p=>p.modules.find(module=>module.sourcePath===path).imports.reverse(),'mixed');
  assert.throws(()=>verifyCommonProgramFacts(value),{
    code:'r03-common-program-module',
    message:/original module edge order differs/
  });
});
