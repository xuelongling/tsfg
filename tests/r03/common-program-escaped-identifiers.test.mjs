// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonSourceGrammar} from '../../compiler/common-program-source.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

const fixtures=[{name:'fixed-four',cooked:'x',declaration:'\\u0078',use:'\\u0078',units:[120],pins:[
  'cb2bf7b4b7ac8c69f56005dfdda258e7612c7b3b3034ecbfe59d3f17175ac5a7',
  '227764fefe6beb96ac6b72c42a62f0e5b1a23861cfd6f73fbae85739eea42418',
  'df6f80ad0a14509c1f6b2b98a1750634cdc5734d017bcf89f3b4c2f6115a92f3'
]},{name:'nominal-alias',cooked:'x',declaration:'x',use:'x',units:[120],pins:[
  'b2621be62138e5e6ee247958f7585591947be33d05710306cb6a809ebd56ec81',
  '0f01eff946d451fb022484c866f718225c1f0e9401c4d7091047ec4a7ad42903',
  '5cfa06372389fedef41f7162819bce13145986c16e9443134360ad882697212a'
]},{name:'escaped-field',cooked:'x',declaration:'x',use:'x',units:[120],pins:[
  'b7e98842d7cf266ae15086c1053eb0284d3e7ab86f181e7b0c6bea6de88d01a9',
  'ca8603911fb8bcb494753167fb31de7ff6b648e6402fae2dd39e0bd02d3915c8',
  'cd5f9b8d6c731978a0d49435029035d02b085346916f541fa727dfc8fc4381b7'
]},{name:'escaped-array',cooked:'x',declaration:'x',use:null,units:[120],pins:[
  '683169080ecdbeb120d34c3b13f27c8f167d8b3b1c9dfeab83d3dceaab177d27',
  '73db21a2920bdc26d96b7876ba1254200a0c285181e2e2cfc6a3675e6334d7a6',
  '4428797a9474738be4b3927142ace408d3fe0ca6ff617579e3595f5efde60ba7'
]},{name:'braced-bmp',cooked:'x',declaration:'\\u{78}',use:'\\u{78}',units:[120],pins:[
  '5f77dd1a50b5e900ec0da466bea134b87b5ba87a7a49d42c55296046df3b5095',
  'e48228d741442807a587c41be34e317eea1a3effd6eb08f66363bcc4ae9eaa3e',
  '63f9f869deabafc05b2a746e1181335a299230ecac044d5726bfaecdd392bc91'
]},{name:'braced-leading-zero',cooked:'x',declaration:'\\u{0000078}',use:'\\u{0000078}',units:[120],pins:[
  'f1e7463b7b8757d45aa9bdda037d629a4c600936c846650c307e8f405f8bdaf7',
  '7feaad81b65bf7a89b919604cce9caafaf1bb2f040833ceb8c0ecb9d21d01cac',
  'ce33d7823f0eb2deefa68077ba0420824feee35922937da0f5bb45f125427449'
]},{name:'fixed-continue',cooked:'x0',declaration:'x\\u0030',use:'x\\u0030',units:[120,48],pins:[
  'd0b8fdce1b3a3cab99da965d7ab1a677aa18110b2d013e826987a209559fe550',
  '21265c8d9b2a61743c0f240339d813822f9655cf43e70fe6dd2139b0a3368374',
  'ebb8de0a8d71bea75343dc69612e494af2a59ba0b37a6a7dcea5f4c636331c24'
]},{name:'braced-astral',cooked:'𐐀',declaration:'\\u{10400}',use:'\\u{10400}',units:[55297,56320],pins:[
  'bd675ee818b9231783b1a10a039e643dced404f9c1ac8970f1a1d6d32bc946f5',
  '105c9c7719cb3f0407b58057d4eb68002d9c1743f7000dc02509108800774e56',
  '56b043743d48db3fca0ab4a3c7bb364f76c7f52cdc5f10acfa5fd93c2095d0df'
]},{name:'mixed-astral',cooked:'𐐀x',declaration:'𐐀\\u0078',use:'𐐀\\u0078',units:[55297,56320,120],pins:[
  '9fd850ed32d63dc32b3355a7f9c61372d4062b0353e1869e095653969787d84b',
  'd1c1f89b1624a4059c8a5dfcfad92654fd055d847c7082f077e707ab22e23949',
  '95ecdece95f577c8cc979fdddd5c86d65c873e09f87170c5b9a690ba014040e1'
]},{name:'dollar-underscore',cooked:'$_',declaration:'\\u0024\\u005F',use:'\\u0024\\u005F',units:[36,95],pins:[
  '91350776817ad132ab96e4f740e247cbf15d3a6523d9650c7712c644b768dd39',
  'e9f0d63475e97ad12773b99e3480bba0d9e093dde4e6e285966992052feda014',
  'd4fc99d3c6fc93038a6e6dbe7e2345d6c2a08bd8bb88a574760151357b4a134f'
]},{name:'joiner-continue',cooked:'x\u200d',declaration:'x\\u200D',use:'x\\u200D',units:[120,8205],pins:[
  '6ef3ddcbeffec31121c4fdf33b5ae4b8c086961b2030f56ffaf8e6db6d16ac8f',
  '3535a2cc612553df1f37203f045e1ac393d3b59294ae9c6be29c5d4df1dc6f18',
  '392b13c7599a501ef4a49548742c95674863223b1de1485cfe02470f2afd11a7'
]},{name:'function-label',cooked:'f',declaration:'f',use:null,units:[102],pins:[
  'c17a9560a49bc7164cdb005bbde4d935728c6d8277deceeb97e19ff5b3efc50a',
  '428e6d23df7a6d155d747fa49254386f7a20a2d08820690fa4b201f1b5100aea',
  'd6dc4b5a340a58a0b7ebf124b2de05b7b3a7b650b89ec61f50364d993914edd5'
]},{name:'host-label',cooked:'x',declaration:'x',use:'x',units:[120],pins:[
  'b557594b99f6d231f07ee2e15ba1cb72bf885b966afffb8f96c4b8e5b635e8a4',
  '1b9b991543311d73fb6e267e873410ade64cf38f7bf3e2b8c6629f5bededcb84',
  '113fed2daf4fba9e7d8a6797756ff4d5d75e707d49e36c51f0c297308a6e8d71'
]}];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const coreRoot=process.env.TSFG_ESCAPED_IDENTIFIER_CORE;
const reportRoot=process.env.TSFG_ESCAPED_IDENTIFIER_REPORTS;
const reports=reportRoot?JSON.parse(await fs.readFile(path.join(reportRoot,'index.json'),'utf8')):null;
for(const fixture of fixtures){
  /** @type {{core:string,inputIdentity:string,functions:string[]}|undefined} */
  let generated;
  test('complete official '+fixture.name+' keeps raw Source tokens and cooked binding identity',async()=>{
    const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(new URL('./testdata/common-program-escaped-identifiers-v3/'+fixture.name+'/'+name,import.meta.url))));
    raw.forEach((bytes,index)=>assert.equal(sha(bytes),fixture.pins[index],'qualified original Source input'));
    const oracle=JSON.parse(raw[1].toString('utf8')),source=raw[2].toString('utf8');
    assert.equal(oracle.sourceSha256,sha(raw[2]));assert.deepEqual(oracle.sourceRange,{start:0,end:source.length});
    assert.deepEqual(oracle.expectedCookedCodeUnits,fixture.units);
    const original=oracle.functions.find(row=>row.name==='escapedValue');assert.ok(original);
    assert.equal(original.cookedName,fixture.cooked);assert.equal(original.rawDeclaration,fixture.declaration);assert.equal(original.rawUse,fixture.use);
    assert.equal(source.slice(original.parameterNameRange.start,original.parameterNameRange.end),fixture.declaration);
    if(fixture.use===null)assert.equal(original.parameterUse,null);
    else assert.equal(source.slice(original.parameterUse.start,original.parameterUse.end),fixture.use);
    assert.ok(source.slice(0,original.range.start).includes('😀'));
    const facts=readCommonProgramFacts(raw[0]),owned=facts.payload.files.find(row=>row.path==='/src/main.ts');assert.ok(owned);
    for(const alias of oracle.aliases??[]){
      assert.deepEqual(facts.payload.typeAliases.find(row=>row.id===alias.declaration.id),alias.declaration);
      assert.equal(source.slice(alias.declaration.nameRange.start,alias.declaration.nameRange.end),alias.rawName);
    }
    for(const annotation of oracle.annotations??[])assert.equal(source.slice(annotation.range.start,annotation.range.end),annotation.raw);
    const grammar=commonSourceGrammar(owned,commonMeter());
    const spellings=[[original.parameterNameRange,fixture.declaration]];
    if(fixture.use!==null)spellings.push([original.parameterUse,fixture.use]);
    for(const [range,spelling] of spellings){
      const token=grammar.tokens.filter(row=>row.start>=range.start&&row.end<=range.end);
      assert.deepEqual(token,[{text:spelling,start:range.start,end:range.end}]);
    }
    const hostContext=fixture.name==='host-label'?JSON.parse(await fs.readFile(new URL('./testdata/common-counter-host/host-context.json',import.meta.url),'utf8')):null;
    const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:facts.version,factsBytes:raw[0],expectedPackageId:facts.packageId},hostContext);assert.equal(hir.functions.length,3);assert.equal(hir.sources.length,fixture.name==='host-label'?3:2);
    assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,source);
    if(fixture.name==='host-label'){
      const ambient=await fs.readFile(new URL('./testdata/common-program-escaped-identifiers-v3/host-label/host.d.ts',import.meta.url));assert.equal(sha(ambient),'d28f596a73c3af294a5253d5b088815e00684bf674d6eea0d3f85b83a687d61a');
      const parameter=oracle.hostParameter;assert.deepEqual(facts.payload.hostImports,[oracle.hostDeclaration]);assert.equal(parameter.calls,0);assert.equal(parameter.rawName,'\\u0078');assert.equal(parameter.cookedName,'x');assert.deepEqual(parameter.codeUnits,[120]);
      const hostSource=facts.payload.files.find(row=>row.path===parameter.sourcePath);assert.ok(hostSource);assert.equal(hostSource.content,ambient.toString('utf8'));assert.equal(sha(ambient),parameter.sourceSha256);
      assert.equal(hostSource.content.slice(parameter.nameRange.start,parameter.nameRange.end),'\\u0078');assert.deepEqual(parameter.sourceRange,{start:0,end:hostSource.content.length});
      assert.ok(hir.functions.every(fn=>fn.body.every(row=>row.kind==='return')),'ambient declaration adds no host call');
    }
    if(fixture.name==='escaped-array'){
      assert.equal(oracle.unusedParameter,true);assert.equal(oracle.expectedParameterType,'array<i32>');
      const annotation=oracle.annotations[0];assert.equal(annotation.rawName,'\\u0041rray');assert.equal(annotation.cookedName,'Array');assert.equal(annotation.builtinSource,'/src/minimal-arrays-v8.d.ts');
      const fn=hir.functions.find(fn=>fn.sourceBinding===original.id),array=hir.types.find(type=>type.id===fn.parameters[0].type);assert.ok(array);assert.equal(array.kind,'array');
      assert.equal(hir.types.find(type=>type.id===array.elementType).name,'i32');assert.equal(source.slice(original.literal.start,original.literal.end),'7');
    }
    if(fixture.name==='function-label'){
      const annotation=oracle.annotations[0];assert.equal(oracle.unusedParameter,true);assert.equal(annotation.labelRawName,'\\u0078');assert.equal(annotation.labelCookedName,'x');assert.deepEqual(annotation.labelCodeUnits,[120]);
      assert.equal(source.slice(annotation.labelNameRange.start,annotation.labelNameRange.end),'\\u0078');assert.equal(source.slice(annotation.labelTypeRange.start,annotation.labelTypeRange.end),'i32');
      const originalFunction=facts.payload.functions.find(fn=>fn.id===original.id);assert.equal(originalFunction.parameters[0].declaredType,annotation.functionTypeId);
      const fn=hir.functions.find(fn=>fn.sourceBinding===original.id),type=hir.types.find(type=>type.id===fn.parameters[0].type);assert.equal(type.kind,'function');assert.equal(type.parameters.length,1);
      assert.equal(hir.types.find(row=>row.id===type.parameters[0]).name,'i32');assert.equal(hir.types.find(row=>row.id===type.returnType).name,'i32');
    }
    for(const row of oracle.classes??[]){
      const type=hir.types.find(type=>type.name===row.name);assert.ok(type);assert.equal(type.kind,row.kind);assert.deepEqual(type.origin.range,row.range);
      assert.equal(type.fields.length,row.fields.length);
      for(const originalField of row.fields){
        const field=type.fields.find(field=>field.sourceBinding===originalField.id);assert.ok(field);assert.equal(field.name,'n');assert.equal(hir.types.find(type=>type.id===field.type).name,'i32');
        assert.deepEqual({start:field.origin.start,end:field.origin.end},originalField.range);
        assert.equal(originalField.rawName,fixture.name==='escaped-field'?'\\u006e':'n');assert.equal(source.slice(originalField.nameRange.start,originalField.nameRange.end),originalField.rawName);
      }
    }
    for(const read of oracle.fieldReads??[]){
      assert.equal(read.cookedName,'n');assert.equal(read.rawName,fixture.name==='escaped-field'?'\\u006e':'n');assert.equal(source.slice(read.nameRange.start,read.nameRange.end),read.rawName);
      const fn=hir.functions.find(fn=>fn.sourceBinding===original.id),returned=fn.body.find(row=>row.kind==='return'),access=returned.value.left;
      const owner=hir.types.find(type=>type.fields?.some(field=>field.sourceBinding===read.fieldId));assert.ok(owner);
      assert.equal(access.kind,'fieldAccess');assert.equal(access.property,owner.fields.find(field=>field.sourceBinding===read.fieldId).id);assert.deepEqual(access.range,read.range);assert.deepEqual(access.nameRange,read.nameRange);
    }
    for(const row of oracle.functions){
      const fn=hir.functions.find(fn=>fn.sourceBinding===row.id);assert.ok(fn);assert.deepEqual(fn.range,row.range);
      assert.equal(fn.parameters.length,1);assert.equal(fn.parameters[0].sourceBinding,row.parameterId);
      assert.deepEqual(fn.parameters[0].range,row.parameterRange);assert.deepEqual(fn.parameters[0].nameRange,row.parameterNameRange);
      assert.equal(fn.parameters[0].name,row.cookedName);
      const returned=fn.body.find(row=>row.kind==='return');assert.ok(returned);assert.deepEqual(returned.range,row.return);assert.deepEqual(returned.value.range,row.expression);
    }
    const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
    assert.equal(publication.contracts.length,3);assert.equal(request.targets.length,2);
    const core=commonProgramCore(hir,publication,request,{borrowProof:true});assert.ok(core.borrowProof);
    generated={core:core.text,inputIdentity:hir.inputIdentity,functions:hir.functions.map(fn=>fn.id)};
    if(coreRoot){assert.ok(path.isAbsolute(coreRoot));await fs.mkdir(coreRoot,{recursive:true});await fs.writeFile(path.join(coreRoot,fixture.name+'.mlir'),core.text,{flag:'wx'});}
  });
  test('actual complete C++ reader verifies '+fixture.name+' cooked names with raw Source intact',
    {skip:reportRoot?false:'TSFG_ESCAPED_IDENTIFIER_REPORTS is not supplied'},async()=>{
      assert.ok(generated);assert.ok(path.isAbsolute(reportRoot));const directory=reports[fixture.name];assert.ok(path.isAbsolute(directory));
      const observed=JSON.parse(await fs.readFile(path.join(directory,'observed.json'),'utf8'));
      const child=JSON.parse(await fs.readFile(path.join(directory,'child.json'),'utf8'));
      const job=JSON.parse(await fs.readFile(path.join(directory,'job.json'),'utf8'));
      assert.equal(observed.qualified,true);assert.deepEqual(observed.first,[]);assert.equal(observed.exit.code,0);assert.equal(observed.close.code,0);
      assert.equal(child.qualified,true);assert.deepEqual(child.first,[]);assert.equal(child.exit.code,0);assert.equal(child.close.code,0);
      assert.ok(Number.isSafeInteger(child.pid)&&child.pid>0);assert.equal(child.program,job.program);assert.deepEqual(child.args,['--common-program','--canonicalize']);
      assert.deepEqual(child.inputBefore,child.inputAfter);assert.equal(sha(await fs.readFile(child.input)),sha(generated.core));
      const stdout=await fs.readFile(path.join(directory,'raw/stdout.bin'),'utf8'),stderr=await fs.readFile(path.join(directory,'raw/stderr.bin'),'utf8');
      assert.equal(stderr,'');assert.ok(stdout.includes(generated.inputIdentity));
      for(const id of generated.functions)assert.ok(stdout.includes('program_'+id.slice(7)),'every original function remains in canonical Core');
    });
}
test('public identifier guard rejects malformed escapes, invalid Unicode classes and cooked-name mismatches',()=>{
  for(const spelling of ['\\u078','\\u00GG','\\u{}','\\u{110000}','\\uD800','\\u0030','x\\u0020']){
    const grammar=commonSourceGrammar({content:spelling},commonMeter());
    assert.throws(()=>grammar.name({start:0,end:spelling.length},'x'),spelling);
  }
  const spelling='\\u0078',grammar=commonSourceGrammar({content:spelling},commonMeter());
  assert.throws(()=>grammar.name({start:0,end:spelling.length},'y'));
  assert.throws(()=>grammar.name({start:0,end:spelling.length-1},'x'));
});
test('public raw keyword sequence keeps escaped spelling distinct from the required Source keyword',()=>{
  const spelling='\\u0072eturn',grammar=commonSourceGrammar({content:spelling},commonMeter());
  grammar.name({start:0,end:spelling.length},'return');
  assert.throws(()=>grammar.sequence({start:0,end:spelling.length},['return']));
});
test('officially rejected surrogate escapes remain invalid at the public Source name guard',()=>{
  const spelling='\\uD801\\uDC00',grammar=commonSourceGrammar({content:spelling},commonMeter());
  assert.throws(()=>grammar.name({start:0,end:spelling.length},'𐐀'));
});
