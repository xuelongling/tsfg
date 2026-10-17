// SPDX-License-Identifier: MIT
// Independent D relation controls. Only unchanged frames are actual positives;
// every changed packet below is a forged negative with fully repaired identities.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
const schema='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const pins=[
  {
    "directory": "01",
    "request": "2f5063c5198335f321cfd6bafd94f4cf61ad429159f3f2ff9523387eb39933c9",
    "response": "c86d8865f1c85f9d5d4cdc3befc0ba4688888fd6ec629a2be105a5fb83bdc4e1",
    "origin": "9009777fa1420e354f6063ef5b00ed14072f51f81ae7ffb3e6cd31a2aa04f704",
    "expected": "c86d8865f1c85f9d5d4cdc3befc0ba4688888fd6ec629a2be105a5fb83bdc4e1",
    "source": "// 😀\r\n@tsfgComponent class Box { flag: bool = true; }\r\nexport function f(box: Box): bool { try { throw true; } catch (caught) { if (typeof caught === \"boolean\") { return box.flag === caught; } throw caught; } }"
  },
  {
    "directory": "02",
    "request": "7101e4e71a9322eb61612cb88a97f3aeabc6592f128db24a97c46cfdacb811e0",
    "response": "0bf062e6e27e59f9e985dc68918919fe88abee53238ddbf7f3e30061ff1a0656",
    "origin": "4b6d057758a943b6c50d0d27b6350f0f5198d4dd578805ea8a96bd59363943ee",
    "expected": "0bf062e6e27e59f9e985dc68918919fe88abee53238ddbf7f3e30061ff1a0656",
    "source": "// 😀\r\n@tsfgComponent class Box { flag: bool = true; }\r\nexport function f(box: Box): bool { try { throw true; } catch (caught) { if (typeof caught === \"boolean\") { return caught === box.flag; } throw caught; } }"
  },
  {
    "directory": "20",
    "request": "dc55d4297f1719bba90b4d64168e20dec1be9ceea66420025b581a95c2c125c0",
    "response": "e923b55a1aac18ef460081f57eebb8328f1196cbab37196610b9d85ad7f04778",
    "origin": "566b1ca12a570349498e1b1b94eaedde614f01e2ed9ef5f90f38b18103dbb9c7",
    "expected": "e923b55a1aac18ef460081f57eebb8328f1196cbab37196610b9d85ad7f04778",
    "source": "// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(value: i32): i32 { const payload: Pair = new Pair(); return value; }"
  },
  {
    "directory": "21",
    "request": "862e3336e1e4317fd079141f720304492e9007305f4f94e12133e5278423d37b",
    "response": "c95dfb5ebb8133be27e9ede943161a64d26415693f902501bcc2d0d9e088b944",
    "origin": "012f31f4460bab4a2f24450edb660c7c1f16cfc72317b1e38b63d2e66e03f434",
    "expected": "c95dfb5ebb8133be27e9ede943161a64d26415693f902501bcc2d0d9e088b944",
    "source": "// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(value: i32): i32 { const payload: Pair = new Pair(); throw payload; }"
  },
  {
    "directory": "22",
    "request": "e17ffaf98896f8148dabf47fea5ec75940654423b62620ee40c237574edce806",
    "response": "eabb2d2f4e483f20777d8c0db3316850105d9fdd07f883ecbcc1a3aadf00d14a",
    "origin": "e0017e70e38aedb9c9d9da56df3f284e316343f08ba3746cc4bebed829d1a116",
    "expected": "eabb2d2f4e483f20777d8c0db3316850105d9fdd07f883ecbcc1a3aadf00d14a",
    "source": "// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(): Pair { return new Pair(); }"
  },
  {
    "directory": "23",
    "request": "2680877217b17e48a1792755ae179cfd953d150e0fe589177ced363357b9036c",
    "response": "95ead78a4832c355262519dc108985e178a20be291998e97a2bc65399ad64f01",
    "origin": "7eb311663a98015f266aea926f6f1648ec9a14aa24f9817884ff13cfd4da7492",
    "expected": "95ead78a4832c355262519dc108985e178a20be291998e97a2bc65399ad64f01",
    "source": "// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(): Pair { throw new Pair(); }"
  },
  {
    "directory": "24",
    "request": "889f94b850e22b5ea724d55757b4711864b946b8e86059feefd1a1d6849bfdb2",
    "response": "c80590674eade568a2b2f3ca97854dad1277eeabeab70ceebe748e1e9d56a30f",
    "origin": "8152599f949c756231d7807793cb0574258d7a623faef9921f81cc578d1539ef",
    "expected": "c80590674eade568a2b2f3ca97854dad1277eeabeab70ceebe748e1e9d56a30f",
    "source": "// 😀\r\n@tsfgComponent class Box {}\r\nexport function entry(value: i32): i32 { const payload: Box = new Box(); return value; }"
  },
  {
    "directory": "25",
    "request": "9e7dc54ed845a1391ddf0795a2e85fa39d32604dd6ecdd5d804b1177292840bc",
    "response": "31d467a6242403aab30169e786b1c219daada5626c2be95684a06a2d64e1a202",
    "origin": "96ae51e04d978fbd54397db47041e188d74c58c3faba59d58df66bc11883e83b",
    "expected": "31d467a6242403aab30169e786b1c219daada5626c2be95684a06a2d64e1a202",
    "source": "// 😀\r\n@tsfgComponent class Box {}\r\nexport function entry(value: i32): i32 { const payload: Box = new Box(); throw payload; }"
  },
  {
    "directory": "26",
    "request": "30937f2cfb10865008e0b6180be5666945fb72a661300e877ab9d7fcfe2e3249",
    "response": "0412c6fc9ee515abe5fc3f970e9043d439e79f2acc755390ad7224411a3f5b30",
    "origin": "a7f6434e39bd8ea011c6529359dc85220c6fbe80bde7103a7480922952b52d64",
    "expected": "0412c6fc9ee515abe5fc3f970e9043d439e79f2acc755390ad7224411a3f5b30",
    "source": "// 😀\r\n@tsfgComponent class Box {}\r\nexport function entry(): Box { return new Box(); }"
  },
  {
    "directory": "27",
    "request": "d1cb3f2c5b9673421ab8ceb45dc911edbf5f548d3a58de8b10fe16910a056628",
    "response": "c80d48e22fed46ada39948872fc97c42a8e257026ce97699e6aff88bc26dccc2",
    "origin": "f0f1ef2ab98e8125cf7a9604d4a6a6568f25ef7c74ef908c361d4c8fb3e720e9",
    "expected": "c80d48e22fed46ada39948872fc97c42a8e257026ce97699e6aff88bc26dccc2",
    "source": "// 😀\r\n@tsfgComponent class Box {}\r\nexport function entry(): Box { throw new Box(); }"
  },
  {
    "directory": "28",
    "request": "dc55d4297f1719bba90b4d64168e20dec1be9ceea66420025b581a95c2c125c0",
    "response": "e923b55a1aac18ef460081f57eebb8328f1196cbab37196610b9d85ad7f04778",
    "origin": "566b1ca12a570349498e1b1b94eaedde614f01e2ed9ef5f90f38b18103dbb9c7",
    "expected": "e923b55a1aac18ef460081f57eebb8328f1196cbab37196610b9d85ad7f04778",
    "source": "// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(value: i32): i32 { const payload: Pair = new Pair(); return value; }"
  },
  {
    "directory": "29",
    "request": "0fb8396df00eaec7695c87f3134bc927ef4fd88d54145d0e78eb4c0b478acc10",
    "response": "ca5769ed8df7dbc9691126a08a1cf2f96b4f59381fab4331b26c7fbf402509ce",
    "origin": "a035a036e4c2b6aa09e032eeaca94dcffc3e05e9e8594a670e669cfb36427f60",
    "expected": "ca5769ed8df7dbc9691126a08a1cf2f96b4f59381fab4331b26c7fbf402509ce",
    "source": "// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(value: i32): i32 { try { throw value; } catch (caught) { throw (caught = new Pair()); } }"
  }
];
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function jcs(value) {
  if(value===null||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='string'){assert.ok(value.isWellFormed());return JSON.stringify(value);}
  if(typeof value==='number'){assert.ok(Number.isFinite(value));return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(jcs).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}';
}
/** @param {any} q @param {any} p @param {any} o */
function seal(q,p,o) {
  for(const file of q.input.files)if(Object.hasOwn(file,'sha256'))file.sha256=hash(file.content);
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  p.payload.inputIdentity=hash(jcs({...q.input,files}));
  p.payload.files=files.map(file=>({path:file.path,digest:hash(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'}));
  const requestBytes=Buffer.from(jcs(q));
  p.requestId=hash('tsfg.exception-facts.request.v1\0'+requestBytes);
  p.packageId=hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload));
  const responseBytes=Buffer.from(jcs(p));
  return {requestBytes,responseBytes,origin:{...clone(o),requestSha256:hash(requestBytes),responseSha256:hash(responseBytes)}};
}
/** @param {any} frames */
function identities(frames) {
  const q=JSON.parse(frames.requestBytes.toString('utf8')),p=JSON.parse(frames.responseBytes.toString('utf8'));
  assert.equal(jcs(q),frames.requestBytes.toString('utf8'));assert.equal(jcs(p),frames.responseBytes.toString('utf8'));
  assert.equal(q.schemaHash,schema);assert.equal(p.schemaHash,schema);
  assert.equal(frames.origin.requestSha256,hash(frames.requestBytes));assert.equal(frames.origin.responseSha256,hash(frames.responseBytes));
  assert.equal(p.requestId,hash('tsfg.exception-facts.request.v1\0'+frames.requestBytes));
  assert.equal(p.packageId,hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload)));
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  assert.equal(p.payload.inputIdentity,hash(jcs({...q.input,files})));
  assert.deepEqual(p.payload.files,files.map(file=>({path:file.path,digest:hash(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})));
  for(const file of q.input.files)if(Object.hasOwn(file,'sha256'))assert.equal(file.sha256,hash(file.content));
}
/** @param {any} value @param {(value:any)=>void} visit */
function walk(value,visit){if(!value||typeof value!=='object')return;visit(value);for(const child of Object.values(value))walk(child,visit);}
/** @param {any} value */
function frozen(value){if(!value||typeof value!=='object')return;assert.ok(Object.isFrozen(value));for(const child of Object.values(value))frozen(child);}
/** @param {any} q @param {any} p */
function context(q,p) {
  const facts=p.payload.facts,aggregate=facts.aggregateFacts,decl=aggregate.declarations[0],fn=facts.functions[0];
  const definitions=new Map(facts.symbols.map(symbol=>[symbol.id,symbol]));
  const expressions=[];walk(fn.body,value=>{if(value.kind&&typeof value.type==='string')expressions.push(value);});
  return {q,p,facts,aggregate,decl,fn,definitions,ctor:decl.constructors[0],classSymbol:definitions.get(decl.symbol),
    field:decl.fields[0],fieldUse:expressions.find(value=>value.kind==='field'),construct:expressions.find(value=>value.kind==='construct')};
}
/** @param {any} x @param {string} category */
function markerOrigin(x,category) {
  const profile=x.q.input.declarations.markerProfile,entry=profile.entries.find(entry=>entry.category===category);
  const file=x.q.input.files.find(file=>file.path===profile.path),digest=hash(file.content);
  const literal='declare function '+entry.name+'<C>(target: C, context: ClassDecoratorContext<C>): void;';
  const start=file.content.indexOf(literal);assert.ok(start>=0);assert.equal(file.content.indexOf(literal,start+1),-1);
  return {declarationPath:profile.path,declarationRange:{start,end:start+literal.length},declarationSha256:digest,
    entryId:hash('tsfg.marker\0'+profile.version+'\0'+category+'\0'+digest),version:profile.version,
    contextName:profile.contextName,contextArity:profile.contextArity,mode:profile.mode,range:clone(x.decl.markerOrigin.range)};
}
/** @typedef {{name:string,code:string,mutate:(value:any)=>void,sourceEdit?:boolean,inputEdit?:boolean}} Corruption */

// Default coverage uses two real nominal categories. Model identity errors below
// are intentional nominal/marker relation failures, after every outer domain is
// independently rechecked. They are not counted as bad envelope/hash rejection.
/** @type {Corruption[]} */
const registryMutations=[
 {name:'nominalSourceForeign',code:'identity',mutate:x=>{x.decl.nominalKey.sourcePath='/src/foreign.ts';}},
 {name:'nominalDeclarationPathForeign',code:'identity',mutate:x=>{x.decl.nominalKey.declarationPath=['Foreign'];}},
 {name:'coherentCategoryAndOriginMismatchSource',code:'identity',mutate:x=>{const category=x.decl.category==='value'?'component':'value';x.decl.category=category;x.decl.nominalKey.category=category;x.decl.markerOrigin=markerOrigin(x,category);}},
 {name:'coherentClassNameMismatchSource',code:'source',mutate:x=>{x.decl.name='Foreign';x.decl.nominalKey.declarationPath=['Foreign'];x.classSymbol.name='Foreign';x.aggregate.sourceCoverage.find(item=>item.kind==='class').name='Foreign';}},
 {name:'classSymbolWrongNominalType',code:'symbol',mutate:x=>{x.classSymbol.type='i32';}},
 {name:'instanceTypeForeign',code:'type',mutate:x=>{x.decl.instanceType='a2';}},
 {name:'constructorTypeForeign',code:'type',mutate:x=>{x.decl.constructorType='constructor:a2';}},
 {name:'markerDtsPathForeign',code:'identity',mutate:x=>{x.decl.markerOrigin.declarationPath='/src/foreign.d.ts';}},
 {name:'markerDtsDigestForeign',code:'identity',mutate:x=>{x.decl.markerOrigin.declarationSha256='sha256:'+'0'.repeat(64);}},
 {name:'markerDtsRangeShifted',code:'identity',mutate:x=>{x.decl.markerOrigin.declarationRange.start++;}},
 {name:'markerEntryForeign',code:'identity',mutate:x=>{x.decl.markerOrigin.entryId='sha256:'+'0'.repeat(64);}},
 {name:'markerSourceRangeShifted',code:'range',mutate:x=>{x.decl.markerOrigin.range.start++;}},
 {name:'markerHasUnknownKey',code:'schema',mutate:x=>{x.decl.markerOrigin.target='s1';}},
 {name:'implicitCtorClassForeign',code:'signature',mutate:x=>{x.ctor.classRef='a2';}},
 {name:'implicitCtorIdCoherentlyForeign',code:'signature',mutate:x=>{x.ctor.id='c2';x.construct.target='c2';}},
 {name:'implicitCtorArgumentsMetadataInvented',code:'signature',mutate:x=>{x.ctor.parameterInitializers=[null];}},
 {name:'implicitCtorBodyInvented',code:'signature',mutate:x=>{x.ctor.body=[{kind:'return',range:clone(x.decl.bodyRange)}];}},
 {name:'implicitCtorBodyRangeInvented',code:'signature',mutate:x=>{x.ctor.bodyRange=clone(x.decl.bodyRange);}},
 {name:'implicitCtorHasUnknownKey',code:'signature',mutate:x=>{x.ctor.target='s1';}},
 {name:'coverageClassOmitted',code:'source',mutate:x=>{x.aggregate.sourceCoverage=x.aggregate.sourceCoverage.filter(item=>item.kind!=='class');}},
 {name:'coverageFunctionOmitted',code:'source',mutate:x=>{x.aggregate.sourceCoverage=x.aggregate.sourceCoverage.filter(item=>item.kind!=='function');}},
 {name:'coverageOrderReversed',code:'source',mutate:x=>{x.aggregate.sourceCoverage.reverse();}},
 {name:'coverageForeignOwner',code:'source',mutate:x=>{x.aggregate.sourceCoverage[0].symbol=x.fn.symbol;}},
 {name:'coverageBodyAnchorShifted',code:'source',mutate:x=>{x.aggregate.sourceCoverage[1].bodyRange.start++;}},
 {name:'implicitConstructorPretendsSourceMember',code:'source',mutate:x=>{x.decl.memberCoverage=[{kind:'KindConstructor',name:'',range:clone(x.decl.bodyRange),bodyRange:null}];}},
 {name:'nominalDeclarationHasUnknownKey',code:'schema',mutate:x=>{x.decl.target='s1';}},
 {name:'coherentLocalWritabilityMismatchSource',code:'source',mutate:x=>{const id=x.fn.body[0].symbol.id;walk(x.facts,value=>{if(value.id===id)value.writable=true;});}},
];
/** @type {Corruption[]} */
const fieldMutations=[
 {name:'fieldPathForeign',code:'identity',mutate:x=>{x.fieldUse.fieldPath=['a1.f1'];}},
 {name:'fieldPathMissing',code:'limit',mutate:x=>{x.fieldUse.fieldPath=[];}},
 {name:'fieldReadPermissionFalse',code:'permission',mutate:x=>{x.fieldUse.permission.readable=false;}},
 {name:'fieldWritePermissionFalse',code:'permission',mutate:x=>{x.fieldUse.permission.writable=false;}},
 {name:'fieldConstructorSelfInvented',code:'permission',mutate:x=>{x.fieldUse.permission.constructorSelf=true;}},
 {name:'fieldPermissionForeignClass',code:'permission',mutate:x=>{x.fieldUse.permission.classRef='a2';}},
 {name:'fieldSymbolForeign',code:'symbol',mutate:x=>{x.fieldUse.symbol=x.fn.symbol;}},
 {name:'fieldReceiverForeignBinding',code:'scope',mutate:x=>{x.fieldUse.receiver.symbol=x.fn.symbol;}},
 {name:'fieldReceiverWrongType',code:'type',mutate:x=>{x.fieldUse.receiver.type='bool';}},
 {name:'coherentReadonlyMismatchSource',code:'permission',mutate:x=>{x.field.readonly=true;x.definitions.get(x.field.symbol).writable=false;x.fieldUse.permission.writable=false;}},
 {name:'coherentFieldTypeMismatchSource',code:'type',mutate:x=>{x.field.type='i32';x.definitions.get(x.field.symbol).type='i32';x.fieldUse.type='i32';x.field.initializer.type='i32';}},
 {name:'fieldOptionalSyntaxInvented',code:'schema',mutate:x=>{x.field.optionalSyntax=true;}},
 {name:'fieldMemberCoverageOmitted',code:'source',mutate:x=>{x.decl.memberCoverage=[];}},
 {name:'fieldMemberCoverageForeignSymbol',code:'source',mutate:x=>{x.decl.memberCoverage[0].symbol=x.fn.symbol;}},
 {name:'fieldMemberCoverageWrongKind',code:'source',mutate:x=>{x.decl.memberCoverage[0].kind='property';}},
 {name:'fieldMemberCoverageWrongRange',code:'source',mutate:x=>{x.decl.memberCoverage[0].range.start++;}},
 {name:'fieldVariantHasForeignKeys',code:'schema',mutate:x=>{x.fieldUse.operator='=';x.fieldUse.arguments=[];}},
];
/** @type {Corruption[]} */
const constructMutations=[
 {name:'constructTargetForeign',code:'signature',mutate:x=>{x.construct.target='c2';}},
 {name:'constructSignatureMissing',code:'schema',mutate:x=>{delete x.construct.signature;}},
 {name:'constructSignatureWrongNominalResult',code:'signature',mutate:x=>{x.construct.signature.returnType='a2';}},
 {name:'constructSignatureParametersInvented',code:'signature',mutate:x=>{x.construct.signature.parameters=['i32'];}},
 {name:'constructSignatureHasUnknownKey',code:'signature',mutate:x=>{x.construct.signature.target='c1';}},
 {name:'constructArgumentsMissing',code:'schema',mutate:x=>{delete x.construct.arguments;}},
 {name:'constructArgumentsInvented',code:'capability',mutate:x=>{x.construct.arguments=[{kind:'boolean',type:'bool',boolean:true,range:clone(x.construct.range)}];}},
 {name:'constructPretendsScalar',code:'signature',mutate:x=>{x.construct.type='i32';x.construct.signature.returnType='i32';}},
 {name:'constructRangeInventsTrivia',code:'range',mutate:x=>{x.construct.range.start--;}},
 {name:'constructVariantHasForeignKeys',code:'schema',mutate:x=>{x.construct.callee={kind:'reference',type:'unknown',symbol:x.fn.symbol,range:clone(x.construct.range)};}},
 {name:'constructSourceSpellingForeign',code:'scope',sourceEdit:true,mutate:x=>{const root=x.q.input.files.find(file=>file.path===x.q.input.rootFile),start=x.construct.range.start+4,name=x.decl.name;assert.equal(root.content.slice(x.construct.range.start,start),'new ');assert.equal(root.content.slice(start,start+name.length),name);x.expectedSource=root.content.slice(0,start)+'Q'.repeat(name.length)+root.content.slice(start+name.length);root.content=x.expectedSource;}},
];
/** @type {Corruption[]} */
const inputMutations=[
 {name:'markerProfileEntryCategoryForeign',code:'input',inputEdit:true,mutate:x=>{x.q.input.declarations.markerProfile.entries[0].category='component';}},
 {name:'markerProfileContextArityForeign',code:'input',inputEdit:true,mutate:x=>{x.q.input.declarations.markerProfile.contextArity=2;}},
 {name:'markerProfileHasUnknownKey',code:'schema',inputEdit:true,mutate:x=>{x.q.input.declarations.markerProfile.target='s1';}},
 {name:'markerDtsBytesChangedDespiteAllOuterHashes',code:'identity',inputEdit:true,mutate:x=>{x.q.input.files.find(file=>file.path===x.q.input.declarations.markerProfile.path).content+='\n';}},
];

/** @param {any} pin */
async function captured(pin) {
  const base=new URL('../fixtures/r03/m21-exception/corpus/'+pin.directory+'/',import.meta.url);
  const buffers=await Promise.all(['request.json','response.json','origin.json','expected-private.json'].map(name=>readFile(new URL(name,base))));
  assert.deepEqual(buffers.map(hash),['request','response','origin','expected'].map(key=>'sha256:'+pin[key]));
  assert.ok(buffers[1].equals(buffers[3]),'actual complete packet must equal the pre-existing independent golden');
  const [q,p,o,expectedPacket]=buffers.map(bytes=>JSON.parse(bytes.toString('utf8')));
  assert.equal(q.input.files.find(file=>file.path===q.input.rootFile).content,pin.source);
  const frames={requestBytes:buffers[0],responseBytes:buffers[1],origin:o};identities(frames);
  const x=context(q,p);assert.deepEqual(x.decl.markerOrigin,markerOrigin(x,x.decl.category));
  return {q,p,o,buffers,frames,expectedPacket};
}
/** @param {any} baseline */
function expectedSnapshot(baseline) {
  const {q,o,expectedPacket,buffers}=baseline,payload=expectedPacket.payload;
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  return {format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:schema},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+schema+'\0'+jcs({inputIdentity:payload.inputIdentity,sourceOrigin:o})),
    sourceOrigin:clone(o),inputIdentity:payload.inputIdentity,identityInput:{...clone(q.input),files},
    sources:files.filter(file=>!file.path.endsWith('.d.ts')).map(file=>({...file,hash:hash(file.content),length:file.content.length,positionUnit:'utf16'})),
    target:clone(q.input.target??null),facts:clone(payload.facts),exports:clone(payload.exports),
    capture:{request:buffers[0].toString('utf8'),response:buffers[1].toString('utf8')}};
}

test('independent aggregate nominal, marker, permission, constructor and coverage relations',async t=>{
  assert.equal(registryMutations.length,27);assert.equal(fieldMutations.length,17);
  assert.equal(constructMutations.length,11);assert.equal(inputMutations.length,4);
  let controls=0,negatives=0;
  for(const pin of pins) {
    const baseline=await captured(pin);
    await t.test(pin.directory+' actual private complete positive and owned cold control',async()=>{
      const requestBytes=Buffer.from(baseline.frames.requestBytes),responseBytes=Buffer.from(baseline.frames.responseBytes),origin=clone(baseline.o);
      const before=[hash(requestBytes),hash(responseBytes),jcs(origin)],expected=expectedSnapshot(baseline);
      const result=await importCapturedFrontendResponse(requestBytes,responseBytes,origin);
      assert.equal(result.status,'ok');assert.deepEqual(result.snapshot,expected);frozen(result.snapshot);
      validateFrontendSnapshot(result.snapshot);validateFrontendSnapshot(JSON.parse(JSON.stringify(result.snapshot)));
      assert.deepEqual([hash(requestBytes),hash(responseBytes),jcs(origin)],before,'reader must not mutate caller inputs');
      requestBytes.fill(0);responseBytes.fill(0);origin.producerBaseOid='0'.repeat(40);
      assert.deepEqual(result.snapshot,expected,'owned snapshot must survive caller mutation');
      validateFrontendSnapshot(JSON.parse(JSON.stringify(result.snapshot)));controls++;
    });
    /** @type {Corruption[]} */
    const mutations=[];
    if(['20','24'].includes(pin.directory))mutations.push(...registryMutations);
    if(['01','02'].includes(pin.directory))mutations.push(...fieldMutations);
    if(['20','26','29'].includes(pin.directory))mutations.push(...constructMutations);
    if(pin.directory==='20')mutations.push(...inputMutations);
    for(const mutation of mutations)await t.test(pin.directory+' '+mutation.name,async()=>{
      const q=clone(baseline.q),p=clone(baseline.p),x=context(q,p);mutation.mutate(x);
      const frames=seal(q,p,baseline.o);identities(frames);
      assert.deepEqual(p.payload.exports,baseline.p.payload.exports,'exports remain complete and unchanged');
      const source=q.input.files.find(file=>file.path===q.input.rootFile).content;
      if(mutation.sourceEdit) {
        assert.equal(source,x.expectedSource);assert.equal(source.length,pin.source.length);
        assert.equal(Buffer.byteLength(source),Buffer.byteLength(pin.source));assert.deepEqual(p.payload.facts,baseline.p.payload.facts);
      } else assert.equal(source,pin.source,'metadata negatives retain actual source');
      if(!mutation.inputEdit&&!mutation.sourceEdit)assert.deepEqual(q,baseline.q,'all input bytes remain the valid control');
      const before=[hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)];
      const result=await importCapturedFrontendResponse(frames.requestBytes,frames.responseBytes,frames.origin);
      assert.equal(result.status,'error','corrupted '+pin.directory+' '+mutation.name+' must reject');
      const code=result.diagnostics?.[0]?.code;assert.equal(code,'r03-exception-'+mutation.code);
      assert.ok(!Object.hasOwn(result,'snapshot'));assert.deepEqual([hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)],before);
      t.diagnostic(JSON.stringify({directory:pin.directory,mutation:mutation.name,code,outerDomainsIndependentlyValid:true}));negatives++;
    });
    assert.deepEqual(baseline.buffers.map(hash),['request','response','origin','expected'].map(key=>'sha256:'+pin[key]));
  }
  assert.equal(controls,12);assert.equal(negatives,125);
});
