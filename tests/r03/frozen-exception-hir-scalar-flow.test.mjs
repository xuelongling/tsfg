// SPDX-License-Identifier: MIT
// Independent manual scalar-flow HIR oracle from seven existing actual Source packets.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const bridgeSchema = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const hirSchema = 'sha256:af8317d8403ea2817e1eba2c47e1d4ef38090f7127897204b05e369ec545ddfd';
const sourcePath = '/src/main.ts', root = new URL('../fixtures/r03/m21-exception/corpus/', import.meta.url);
const target = {target:'windows-x86_64-msvc',triple:'x86_64-pc-windows-msvc',pointerBits:'64',
  llvmDataLayout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128'};
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const span = (start, end) => ({start,end});
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key)+':'+jcs(value[key])).join(',') + '}';
  if (typeof value === 'string') assert.ok(value.isWellFormed());
  if (typeof value === 'number') assert.ok(Number.isSafeInteger(value) && value >= 0 && !Object.is(value,-0));
  return JSON.stringify(value) ?? assert.fail('not JSON');
}
const entity = (kind, record) => hash('tsfg.exception-hir-candidate.'+kind+'.v1\0'+hirSchema+'\0'+jcs(record));
const scalar = name => hash('tsfg.type\0'+name);
const i32 = scalar('i32'), bool = scalar('bool'), unknown = entity('type',{kind:'unknown'});
const step = (statement, slot) => ({statement,slot});
const catchPath = [step(0,'catch')], tryPath = [step(0,'try')];
const assignmentSource = nested => [
  '// 😀', 'export function entry(value: i32, flag: bool, stop: bool): i32 {',
  '  try { throw value; } catch (caught) {', '    const before = caught;',
  '    if (stop) { throw before; }',
  ...(nested ? ['    const after = (caught = flag);'] : ['    caught = flag;', '    const after = caught;']),
  '    throw after;', '  }', '}',
].join('\r\n');
const guardSource = ['// 😀','export function entry(value: i32): i32 {',
  '  try { throw value; } catch (caught) {',
  '    if (typeof caught === "boolean") { throw caught; }','    throw caught;','  }','}'].join('\r\n');
/** @type {any[]} */
const specs = [
  {id:'03',mode:'statement',source:assignmentSource(false),ordinary:false,end:246},
  {id:'04',mode:'statement',source:assignmentSource(false),ordinary:true,end:246},
  {id:'05',mode:'nested',source:assignmentSource(true),ordinary:false,end:235},
  {id:'06',mode:'nested',source:assignmentSource(true),ordinary:true,end:235},
  {id:'07',mode:'guard',source:guardSource,ordinary:false,end:171},
  {id:'10',mode:'return',source:'// 😀\r\nexport function entry(payload: i16): i16 { return payload; }',scalar:'i16',end:67},
  {id:'12',mode:'return',source:'// 😀\r\nexport function entry(payload: f32): f32 { return payload; }',scalar:'f32',end:67},
];
/** @param {any} presenceRange @param {any} annotation */
const presence = (presenceRange, annotation) => ({undefined:false,null:false,optional:false,default:false,
  range:presenceRange,annotation});
/** @param {any} value @param {Set<object>} [seen] */
function frozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  assert.ok(!seen.has(value)); seen.add(value);
  assert.ok(Object.isFrozen(value));
  assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
  for (const child of Object.values(value)) frozen(child,seen);
  seen.delete(value);
}
/** @param {any} value @param {Set<object>} [seen] @returns {Set<object>} */
function objects(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return seen;
  seen.add(value); for (const child of Object.values(value)) objects(child,seen); return seen;
}
/** @param {any} result @param {any} caller */
function noAliases(result, caller) {
  const owned = objects(caller); for (const object of objects(result)) assert.ok(!owned.has(object));
}

// All projected nodes below are hand specified from the frozen Source literal
// evidence. Neither actual/public HIR nor snapshot.facts is walked to fill them.
/** @param {any} spec @param {any} snapshot */
function manualHir(spec, snapshot) {
  const returned = spec.mode === 'return', guarded = spec.mode === 'guard', nested = spec.mode === 'nested';
  const resultType = returned ? scalar(spec.scalar) : i32;
  const parameterTypes = returned ? [resultType] : guarded ? [i32] : [i32,bool,bool];
  const callableRecord = {kind:'callable',parameters:parameterTypes,returnType:resultType};
  const callable = entity('type',callableRecord), signatureHash = entity('signature',
    {parameters:parameterTypes,returnType:resultType});
  const moduleId = entity('module',{source:{path:sourcePath,digest:hash(spec.source)},external:true});
  const moduleScope = entity('scope',{ownerKind:'module',owner:moduleId,path:[]});
  const functionId = entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'entry',
    signatureHash,range:span(0,spec.end)});
  const scopeId = path => entity('scope',{ownerKind:'function',owner:functionId,path});
  const bindingId = (path, role, index) => entity('binding',{ownerKind:'function',owner:functionId,scopePath:path,role,index});
  /** @param {any[]} path @param {string} role @param {number} index @param {string} name @param {string} type
   * @param {boolean} writable @param {any} range @param {any} [metadata] */
  const binding = (path,role,index,name,type,writable,range,metadata=null) =>
    ({id:bindingId(path,role,index),name,role,type,writable,range,presence:metadata});
  /** @param {string} type @param {string} id @param {number} start @param {number} end */
  const read = (type,id,start,end) => ({kind:'bindingRead',type,binding:id,range:span(start,end),presenceFlow:null});
  /** @param {any[]} path @param {string} role @param {any[]|null} parent @param {any} range
   * @param {any[]} bindings @param {any[]} body */
  const region = (path,role,parent,range,bindings,body) => ({kind:'region',role,scope:scopeId(path),
    parentScope:parent === null ? null : scopeId(parent),path,range,bindings,body});
  const first = binding([],'parameter',0,returned?'payload':'value',resultType,true,
    returned?span(29,36):span(29,34),presence(returned?span(29,41):span(29,39),returned?span(38,41):span(36,39)));
  const parameters = [first], rootBody = [];
  if (!returned && !guarded) parameters.push(
    binding([],'parameter',1,'flag',bool,true,span(40,45),presence(span(40,51),span(47,51))),
    binding([],'parameter',2,'stop',bool,true,span(52,57),presence(span(52,63),span(59,63))));
  if (returned) {
    rootBody.push({kind:'return',range:span(49,65),value:read(resultType,first.id,56,64)});
  } else {
    const catchEnd = guarded?168:nested?232:243;
    const caught = binding(catchPath,'catch',0,'caught',unknown,true,guarded?span(79,85):span(103,109));
    const catchBindings = [caught], catchBody = [];
    if (guarded) {
      const thenPath = [...catchPath,step(0,'then')];
      catchBody.push({kind:'if',range:span(94,144),condition:{kind:'typeTest',type:bool,range:span(98,125),
        operator:'===',operand:read(unknown,caught.id,104,111),tag:'boolean',typeofRange:span(98,111),
        tagRange:span(115,125),order:'typeof-first'},
        thenRegion:region(thenPath,'then',catchPath,span(126,144),[],[
          {kind:'throw',range:span(128,142),value:read(bool,caught.id,134,141)}]),elseRegion:null});
      catchBody.push({kind:'throw',range:span(144,163),value:read(unknown,caught.id,155,162)});
    } else {
      const before = binding(catchPath,'local',0,'before',unknown,false,span(123,130));
      const after = binding(catchPath,'local',1,'after',nested?bool:unknown,false,nested?span(184,190):span(204,210));
      catchBindings.push(before,after);
      catchBody.push({kind:'local',range:span(123,139),binding:before.id,initializer:read(unknown,caught.id,132,139)});
      const thenPath = [...catchPath,step(1,'then')];
      catchBody.push({kind:'if',range:span(146,173),condition:read(bool,parameters[2].id,150,154),
        thenRegion:region(thenPath,'then',catchPath,span(155,173),[],[
          {kind:'throw',range:span(157,171),value:read(unknown,before.id,163,170)}]),elseRegion:null});
      if (nested) {
        catchBody.push({kind:'local',range:span(184,208),binding:after.id,initializer:{kind:'group',type:bool,
          range:span(193,208),operand:{kind:'bindingWrite',type:bool,range:span(194,207),operator:'=',
            target:{kind:'bindingTarget',type:unknown,range:span(194,200),binding:caught.id},
            value:read(bool,parameters[1].id,203,207)}}});
        catchBody.push({kind:'throw',range:span(209,227),value:read(bool,after.id,220,226)});
      } else {
        catchBody.push({kind:'assign',range:span(173,193),
          target:{kind:'bindingTarget',type:unknown,range:span(173,185),binding:caught.id},
          value:read(bool,parameters[1].id,187,192)});
        catchBody.push({kind:'local',range:span(204,219),binding:after.id,initializer:read(unknown,caught.id,212,219)});
        catchBody.push({kind:'throw',range:span(220,238),value:read(unknown,after.id,231,237)});
      }
    }
    rootBody.push({kind:'try',range:span(guarded?47:71,catchEnd),
      tryRegion:region(tryPath,'try',[],guarded?span(54,71):span(78,95),[],[
        {kind:'throw',range:guarded?span(56,69):span(80,93),value:read(i32,first.id,guarded?62:86,guarded?68:92)}]),
      catchClause:{range:span(guarded?71:95,catchEnd),binding:caught.id,
        declarationRange:guarded?span(79,85):span(103,109),annotationRange:null,
        region:region(catchPath,'catch',[],span(guarded?86:110,catchEnd),catchBindings,catchBody)},finallyRegion:null});
  }
  const function_ = {id:functionId,module:moduleId,sourcePath,name:'entry',nameRange:span(22,28),range:span(0,spec.end),
    type:callable,signatureHash,lexicalParent:null,declaringScope:moduleScope,parameters:parameters.map(p=>p.id),
    parameterInitializers:parameters.map(()=>null),captures:null,returnPresence:null,
    body:region([],'function',null,span(0,spec.end),parameters,rootBody)};
  /** @type {any[]} */
  const types = [{kind:'scalar',name:returned?spec.scalar:'i32',id:resultType},
    {id:callable,...callableRecord}];
  if (!returned) types.push({kind:'scalar',name:'bool',id:bool},{kind:'unknown',id:unknown});
  types.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {format:{family:'tsfg.exception-hir-candidate',version:1,schemaHash:hirSchema},snapshot:copy(snapshot),
    inputIdentity:snapshot.inputIdentity,sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],
    target:spec.ordinary?null:copy(target),types,functions:[function_],
    modules:[{id:moduleId,sourcePath,external:true,functions:[functionId],aggregateTypes:[],imports:[],globals:[],
      initialization:null,closure:null,coverage:null}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'entry',target:functionId,sourcePath,
      range:span(0,spec.end),definition:span(22,28)}]}]};
}

// The existing expected-private fixture is the frozen independent Source facts
// oracle, not an HIR-author golden. All derived HIR fields above remain manual.
/** @param {any} spec @param {any} request @param {any} packet @param {any} origin
 * @param {string} requestText @param {string} responseText */
function manualSnapshot(spec, request, packet, origin, requestText, responseText) {
  const files = request.input.files.map(file=>({path:file.path,content:file.content}))
    .sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  const identityInput = {...copy(request.input),files}, inputIdentity = hash(jcs(identityInput));
  assert.equal(packet.payload.inputIdentity,inputIdentity);
  assert.equal(request.input.target === undefined,spec.ordinary===true);
  if (!spec.ordinary) assert.deepEqual(request.input.target,target);
  assert.deepEqual(files.filter(file=>!file.path.endsWith('.d.ts')),[{path:sourcePath,content:spec.source}]);
  return {format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridgeSchema},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridgeSchema+'\0'+jcs({inputIdentity,sourceOrigin:origin})),
    sourceOrigin:copy(origin),inputIdentity,identityInput,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],
    target:spec.ordinary?null:copy(target),facts:copy(packet.payload.facts),exports:copy(packet.payload.exports),
    capture:{request:requestText,response:responseText}};
}

// Source custody pins were independently fixed before installation.
const identityPins = {"10":{"module":"sha256:1b4845e00a0acdf98674b4d2ba8e33bb0b2ff7a54857cc071bf244fdefab2aca","function":"sha256:18af1187795b76157b28d5fafc435178e129288c94dc17756193485cedc3507f","signature":"sha256:7a0a3b4fb6da9a70d37cfd50b31e253048e9231a9410b0b8f4f7abadd3304cde","source":"sha256:d51faa7b3a1514b67a0027dce81f216cbb6307d2b7c07208c5a81c80a165aeac"},"12":{"module":"sha256:ffb9e57330d6731afbbd43818429f4037470cfbbed01e7da862c008197a5bed0","function":"sha256:81e01f49aa68dac83f632e0bd18d91a26a89a46e3262c7c02560b82477b69b0c","signature":"sha256:244437566dccd77607efa9b13f5fd4e2c03ebc7cb980b4e556ab08e3479ade8b","source":"sha256:83bc7248281b1aaa8e3977e2d5acaf7e9bb64c3060220c88c5f4d16b399fc504"},"03":{"module":"sha256:257f76ae312c85641b28049dbb833ed6e86e637d4a96e3860b8761ff6909da73","function":"sha256:bb5a348d75331d754ec702404f8ce22edabf013c79dcb1578b6813c42394a566","signature":"sha256:a04a40a8b4134c06bad073845ca576965d6fc787c2ad4783a2d9ba8ed7c52045","source":"sha256:5c60e72e5620b30b49858af09897cd4e7dceb1b1189ca563333943fa5beeb9bc"},"04":{"module":"sha256:257f76ae312c85641b28049dbb833ed6e86e637d4a96e3860b8761ff6909da73","function":"sha256:bb5a348d75331d754ec702404f8ce22edabf013c79dcb1578b6813c42394a566","signature":"sha256:a04a40a8b4134c06bad073845ca576965d6fc787c2ad4783a2d9ba8ed7c52045","source":"sha256:5c60e72e5620b30b49858af09897cd4e7dceb1b1189ca563333943fa5beeb9bc"},"05":{"module":"sha256:aa3075f6dae52c3997cecbfde2365d5296fe0d9241a82668221291d6e1b6d359","function":"sha256:21236c8356b5c0e2efe0f2e9d6221429fdb37011a56fec5865f3b304ddc567a8","signature":"sha256:a04a40a8b4134c06bad073845ca576965d6fc787c2ad4783a2d9ba8ed7c52045","source":"sha256:100829408729f16ccb7e42a1c3d21857ecd008ee2a8befef39e7c115a8247261"},"06":{"module":"sha256:aa3075f6dae52c3997cecbfde2365d5296fe0d9241a82668221291d6e1b6d359","function":"sha256:21236c8356b5c0e2efe0f2e9d6221429fdb37011a56fec5865f3b304ddc567a8","signature":"sha256:a04a40a8b4134c06bad073845ca576965d6fc787c2ad4783a2d9ba8ed7c52045","source":"sha256:100829408729f16ccb7e42a1c3d21857ecd008ee2a8befef39e7c115a8247261"},"07":{"module":"sha256:7ac17889b1a527151dfe4e3f5a34250c2269e33e90fad1941e9edf6256a98098","function":"sha256:f0c5424b975cdfd81a385c5f4c79af8b3defca66d4d000c873cadaec361883ee","signature":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110","source":"sha256:cff0ae6fe9c37b1bcc94dc17dc098b0da47f7227613de203229049c0dfbf0b86"}};
const pins = {"10":{"request.json":"sha256:6b5ae267bf53aae919315a8c6e670fac8598b32b627557d12f6d935501ee6b82","response.json":"sha256:8125cddc06cf3f6a0b73a1afccccb22f4eaf2676f43434a69882f9aa75b757c3","origin.json":"sha256:167322aca1684b4d88fe1c3144e3ee6c193df07edb8cd2aae324eb8c2917628d","expected-private.json":"sha256:8125cddc06cf3f6a0b73a1afccccb22f4eaf2676f43434a69882f9aa75b757c3"},"12":{"request.json":"sha256:633cb4e64515d2f301ac03bde13363ceededcfce5609a779be9800fed8c3d2dc","response.json":"sha256:118ca5fca6a564553cc9395786aa1057e63076700c2c212b47ae10a0b66e9ad3","origin.json":"sha256:3ca2efcdbb54c067021703e246764149de34e5ba654842f45fb2319e39934560","expected-private.json":"sha256:118ca5fca6a564553cc9395786aa1057e63076700c2c212b47ae10a0b66e9ad3"},"03":{"request.json":"sha256:8c61209eb777133a2a0f59f481f661443588775e9677cd86a93c08bfda3cfb3e","response.json":"sha256:d431c3a0b6e15b96a23c3b03094bb0dbe5a5a8d9c6b812fcd7d1c5e27625f598","origin.json":"sha256:958cfc9f46da8186bfd8f9ed786dbd71a74d5063d40686a54357fdfaa1772ccb","expected-private.json":"sha256:d431c3a0b6e15b96a23c3b03094bb0dbe5a5a8d9c6b812fcd7d1c5e27625f598"},"04":{"request.json":"sha256:a33540018447a89cfc6b7b0315d0200b9879b70e30f867b87e71752744b50318","response.json":"sha256:b84d95c19e1f46b2b31b94fa7709426c3fb024fa167983271512692dadd528f8","origin.json":"sha256:cca64f4ea66a1ec97fcfdb81d5f6e6ed8afbe20c4a3b3128ed71504b4895f2bd","expected-private.json":"sha256:b84d95c19e1f46b2b31b94fa7709426c3fb024fa167983271512692dadd528f8"},"05":{"request.json":"sha256:a32559deb4b728e772eca9e5736dd1b5c1f582804038cfbf691222c68dbdb6a6","response.json":"sha256:7a1b8d4bd3d666c7d9a898a6d7ac62c5f63e7ed4174111e17165e1ff34d0975b","origin.json":"sha256:bf29f77761359d0913cc47968b4f3bd907042e5832049f86c45754cf6a09562c","expected-private.json":"sha256:7a1b8d4bd3d666c7d9a898a6d7ac62c5f63e7ed4174111e17165e1ff34d0975b"},"06":{"request.json":"sha256:807ade9d7c7ff7ea00b52b0deca3dcb88501ac6faf69e4cdecbfcfb569640242","response.json":"sha256:14846a5ab9a8456c0c297029906718b927a25a4d1deaf931e1c4cbc7fda87e65","origin.json":"sha256:806ebebbcf7c87e0a4a50557e5456d35daee09fab200875d8f71fe9c8c745d99","expected-private.json":"sha256:14846a5ab9a8456c0c297029906718b927a25a4d1deaf931e1c4cbc7fda87e65"},"07":{"request.json":"sha256:ac0e47c50a9764bf92ddefa2b84192deb21b166522a50222fe2f604abe3bb380","response.json":"sha256:e61e19ec4766dd2bb277a3462742b35a1cfb8da85c678632d45d4c23922ace32","origin.json":"sha256:83fdb6ce5ad7b5ef88ca57bc914f5f565f71d857d34fd0fd607763b3725780a2","expected-private.json":"sha256:e61e19ec4766dd2bb277a3462742b35a1cfb8da85c678632d45d4c23922ace32"}};
test('seven actual scalar-flow packets map to complete independent exception HIR', async t => {
  const built = new Map();
  for (const spec of specs) await t.test('corpus'+spec.id+'/'+spec.mode, async t => {
    const names = ['request.json','response.json','origin.json','expected-private.json'];
    const buffers = await Promise.all(names.map(name=>readFile(new URL(spec.id+'/'+name,root))));
    const before = buffers.map(hash), [requestBytes,responseBytes,originBytes,expectedBytes] = buffers;
    let snapshot, expectedSnapshot, ready = false;
    await t.test('actualPacketAndCompleteColdControl', async () => {
      assert.deepEqual(before,names.map(name=>pins[spec.id][name]));
      assert.equal(spec.source.length,spec.end);
      const requestText = requestBytes.toString('utf8'), responseText = responseBytes.toString('utf8');
      const request = JSON.parse(requestText), packet = JSON.parse(responseText);
      const independentPacket = JSON.parse(expectedBytes.toString('utf8')), origin = JSON.parse(originBytes.toString('utf8'));
      assert.equal(requestText,jcs(request)); assert.equal(responseText,jcs(packet));
      assert.deepEqual(packet,independentPacket,'complete frozen independent Source packet expectation');
      assert.equal(packet.schemaHash,bridgeSchema);
      assert.equal(packet.requestId,hash('tsfg.exception-facts.request.v1\0'+requestText));
      assert.equal(packet.packageId,hash('tsfg.exception-facts.package.v1\0'+bridgeSchema+'\0'+jcs(packet.payload)));
      assert.deepEqual(packet.payload.files,request.input.files.map(file=>({path:file.path,digest:hash(file.content),
        byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'}))
        .sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path))));
      expectedSnapshot = manualSnapshot(spec,request,independentPacket,origin,requestText,responseText);
      const imported = await importCapturedFrontendResponse(requestBytes,responseBytes,origin);
      assert.equal(imported.status,'ok',JSON.stringify(imported)); snapshot = imported.snapshot;
      assert.deepEqual(snapshot,expectedSnapshot,'all10 snapshot fields before HIR API');
      assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));
      frozen(snapshot); assert.deepEqual(buffers.map(hash),before); ready = true;
    });
    if (!ready) return;
    await t.test('completeTypedMappingAndColdBoundaries', () => {
      const expected = manualHir(spec,expectedSnapshot), cold = copy(snapshot), inputBefore = jcs(cold);
      assert.deepEqual({module:expected.modules[0].id,function:expected.functions[0].id,
        signature:expected.functions[0].signatureHash,source:expected.sources[0].hash},identityPins[spec.id]);
      const result = buildHir(cold); assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'every manually mapped field, explicit null and identity');
      assert.equal(jcs(cold),inputBefore); frozen(result.hir); noAliases(result.hir,cold);
      const text = jcs(expected)+'\n', verified = verifyHir(copy(result.hir));
      assert.deepEqual(verified,expected); assert.equal(printHir(result.hir),text);
      const bytes = Buffer.from(text), decoded = readHir(bytes); assert.deepEqual(decoded,expected); frozen(decoded);
      bytes.fill(0); cold.sources[0].content = 'caller mutation';
      assert.deepEqual(decoded,expected); assert.deepEqual(result.hir,expected);
      assert.deepEqual(buildHir(copy(snapshot)).hir,expected);
      assert.equal(printHir(readHir(Buffer.from(text))),text);
      assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
      assert.deepEqual(buffers.map(hash),before); built.set(spec.id,copy(result.hir));
    });
  });
  if (built.size === specs.length) await t.test('sameLiteralAcrossProfilesPreservesSemanticIdsAndNullTarget', () => {
    for (const [integer,ordinary] of [['03','04'],['05','06']]) {
      assert.deepEqual(built.get(integer).functions,built.get(ordinary).functions);
      assert.notEqual(built.get(integer).inputIdentity,built.get(ordinary).inputIdentity);
      assert.deepEqual(built.get(integer).target,target); assert.equal(built.get(ordinary).target,null);
    }
  });
});
