// SPDX-License-Identifier: MIT
// Test data utilities only. No producer, float conversion or HIR projector is imported.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// This small standard recipe stays independent of the immutable FIRST body so
// later boundary checks do not rewrite its preserved failure input identity.
/** @param {any} value @returns {string} */
export function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + jcs(value[k])).join(',') + '}';
}
/** @param {string | Uint8Array} value */
export const sha = value => createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {any} */
export const fresh = value => JSON.parse(jcs(value));
/** @param {any} value */
export const wire = value => Buffer.from(jcs(value) + "\n");
/** @param {string} file @param {number} length @param {string} digest @returns {Promise<any>} */
export async function pinned(file, length, digest) {
  const bytes = await readFile(new URL(file, import.meta.url));
  assert.equal(bytes.length, length); assert.equal(sha(bytes), digest);
  assert.equal(jcs(JSON.parse(bytes.toString())) + "\n", bytes.toString());
  return JSON.parse(bytes.toString());
}
/** Pretty independent evidence containers retain their original bytes. Embedded wire frames
 * are still checked by the protocol tests. @param {string} file @param {number} length
 * @param {string} digest @returns {Promise<any>} */
export async function pinnedContainer(file,length,digest) {
  const bytes=await readFile(new URL(file,import.meta.url));
  assert.equal(bytes.length,length);assert.equal(sha(bytes),digest);return JSON.parse(bytes.toString('utf8'));
}
/** Frozen values remain data: adapters project their prior test interface only. */
/** @type {Promise<any> | undefined} */
let old18Promise;
/** @returns {Promise<any>} */
export function old18Oracle() {
  return old18Promise ??= pinnedContainer('./legacy-v7-old18-oracle.json',6089299,
    '9a36b9ae1f4c1498b711d4dfff1c6dc52654518eef3deef902591b0e3fd0ef2a').then(value=>{
    assert.equal(value.family,'tsfg.r03.legacy-v5-old18-oracle');assert.equal(value.version,5);
    assert.equal(value.crosspin.interface.sha256,'000e7af23a8ad45c5bb0407eeb0697e3ef5eb6c9b250bc2fdba77a15f3a158fa');
    assert.equal(value.cases.length,18);
    assert.equal(new Set(value.cases.map(c=>c.name)).size,18);
    for(const row of value.cases){
      assert.equal(row.inheritedProvenance.productionConverterImported,false);
      assert.equal(row.inheritedProvenance.productionV4Observed,false);
      assert.equal(row.migration.invariants.payloadExact,true);
      assert.deepEqual(row.official.diagnostics,{syntax:0,semantic:0,program:0,global:0});
      for(const key of ['requestText','packageText'])assert.equal(jcs(JSON.parse(row[key]))+'\n',row[key]);
      assert.equal(JSON.parse(row.requestText).version,7);
      const packet=JSON.parse(row.packageText);assert.equal(packet.version,7);
      assert.equal(packet.payload.declarations.version,'minimal-arrays-v3');
      const dts=packet.payload.files.find(f=>f.path.endsWith('/minimal-arrays-v3.d.ts'));assert.ok(dts);
      assert.equal(dts.byteLength,484);assert.equal(dts.utf16Length,484);
      assert.equal(dts.sha256,'282b335a6e0e0493fa74a3c1dd56f234f8c679079acdaf0600cefb8306c26415');
      assert.equal(row.hir.format.version,8);assert.equal(row.hir.types.length,4);
      assert.equal(row.hir.types[3].name,'ReadSpan');assert.equal(row.hir.types[3].readonly,true);
      assert.ok(!Object.hasOwn(row.hir,'readSpanPlan'),'passive metadata is not an actual view');
    }
    return value;
  });
}
/** @returns {Promise<any>} */
export async function callOracle() {
  const value=await old18Oracle(),cases=value.cases.filter(c=>c.group==='owner10');
  assert.equal(cases.length,10);return {...value,cases};
}
/** @returns {Promise<any>} */
export async function hirOracle() {
  const legacy=await pinned('./array-hir-oracle-v3.json',202173,'fb963bb30f4e4f818afa43cecf649e25c42159434d501145c79d8f3266ff62ff');
  const rows=(await old18Oracle()).cases.filter(c=>c.group==='old8');assert.equal(rows.length,8);
  return {typePreimages:[...legacy.typePreimages,{name:'readspan',
    id:'sha256:6130247c334f8a7ba10e89f40381e26b0877d57f96860df21befbe668bb6545e',
    preimageUtf8Hex:Buffer.from('tsfg.type\0ReadSpan<f64>').toString('hex')}],
    cases:rows.map((row,i)=>{
      assert.equal(row.name,legacy.cases[i].name);
      const hirText=jcs(row.hir)+'\n';
      return {name:row.name,expectedHir:row.hir,context:row.factsContext,hirText,
        hirBytes:Buffer.byteLength(hirText),hirSHA256:sha(hirText),
        functionPreimages:legacy.cases[i].functionPreimages,
        rangeWitnesses:legacy.cases[i].rangeWitnesses.map(w=>({...w,sourcePath:w.sourcePath.replace('/minimal-arrays-v2.d.ts','/minimal-arrays-v3.d.ts')}))};
    })};
}
/** @returns {Promise<any[]>} */
export async function fixtures() {
  const all=(await old18Oracle()).cases.filter(c=>c.group==='old8'),h=await hirOracle();
  assert.equal(all.length,8);
  return all.map((c,i)=>{
    assert.equal(c.name,h.cases[i].name);
    const packet=JSON.parse(c.packageText),request=JSON.parse(c.requestText);
    const facts={...c,package:packet,request,rangeAudit:rangeAudit(packet.payload),
      packageBytes:Buffer.byteLength(c.packageText),packageSHA256:sha(c.packageText),
      requestBytes:Buffer.byteLength(c.requestText),requestSHA256:sha(c.requestText)};
    return {facts,hir:h.cases[i]};
  });
}
/** @returns {Promise<any>} */
export async function coreOracle() {
  const value=await pinnedContainer('./legacy-v7-old8-core-oracle.json',806522,
    'ae78ba65233ba7b2f4166914622271408f3cf5f62d19c3ca356b779beb5ea075');
  const legacy=await pinned('./array-core-oracle-v3.json',122335,'44c460f568aebd9dba7b25dab00857a47fe431a3f7cc4679a6d1d09a427552d5');
  const h=await hirOracle();assert.equal(value.cases.length,8);assert.equal(value.format.version,8);
  return {...value,quoteVectors:legacy.quoteVectors,jcsPreimageVectors:legacy.jcsPreimageVectors,
    additionalIndependentPreimages:legacy.additionalIndependentPreimages,cases:value.cases.map((c,i)=>{
      assert.equal(c.name,h.cases[i].name);
      return {...c,hirBytes:h.cases[i].hirBytes,hirSHA256:h.cases[i].hirSHA256};
    })};
}
/** Ranges come only from pre-production expected facts, never a producer result.
 * @param {any} payload @returns {any[]} */
function rangeAudit(payload) {
  const sources = new Map(payload.files.map(f => [f.path, f.content])), result = [];
  /** @param {any} value @param {string} sourcePath */
  function walk(value, sourcePath) {
    if (!value || typeof value !== 'object') return;
    if (value.sourcePath) sourcePath = value.sourcePath;
    if (Object.keys(value).length === 2 && Number.isInteger(value.start) && Number.isInteger(value.end)) {
      result.push({range:value, sourcePath, text:sources.get(sourcePath).slice(value.start,value.end)}); return;
    }
    for (const child of Object.values(value)) walk(child, sourcePath);
  }
  walk(payload.types,payload.rootFile); walk(payload.arrayLength,payload.rootFile); walk(payload.readSpanLength,payload.rootFile); walk(payload.readSpanIntrinsic,payload.rootFile); walk(payload.functions,payload.rootFile);
  return result;
}
/** @param {any} row @param {Uint8Array} [bytes] @returns {any} */
export const context = (row, bytes = Buffer.from(row.facts.packageText)) => ({...row.hir.context, factsBytes:bytes});
/** @param {any} value @returns {void} */
export function deeplyFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) deeplyFrozen(child);
}
/** Capture the public own error DTO, excluding stack. @param {() => unknown} action @returns {any} */
export function failure(action) {
  let caught; try { action(); } catch (error) { caught = error; }
  assert.ok(caught instanceof TypeError);
  const e = /** @type {any} */ (caught);
  return {name:e.name, message:e.message, ...Object.fromEntries(Object.keys(e).map(k => [k,e[k]]))};
}
/** @param {string} kind @param {any} [primary] */
export const hirError = (kind, primary = undefined) => ({name:"TypeError",
  message:"r03-array-hir-" + kind + ": invalid selected Array HIR", code:"r03-array-hir-" + kind,
  ruleId:"r01-input-boundary", phase:"hir", ...(primary ? {primary} : {})});
/** @param {any} row @param {any} error @param {string} kind */
export function trustedHirError(row, error, kind) {
  const {primary, ...dto} = error; assert.deepEqual(dto, hirError(kind));
  if (primary !== undefined) {
    assert.ok(row.facts.package.payload.files.some(f => f.path === primary.sourceId));
    const range = {start:primary.start, end:primary.end};
    assert.ok([...row.facts.rangeAudit, ...row.hir.rangeWitnesses].some(w => w.sourcePath === primary.sourceId
      && w.range.start === range.start && w.range.end === range.end), "anchor belongs to verified frozen facts");
    assert.deepEqual(Object.keys(primary).sort(), ["end","sourceId","start"]);
  }
}
// Reframe untrusted negative data only, so valid envelope hashes cannot mask a
// semantic rejection. This never creates an expected successful producer value.
/** @param {any} packet @returns {any} */
export function reframeFacts(packet) {
  const p = packet.payload;
  const request = {family:"tsfg.array-facts-request-candidate",version:7,input:{sourceRoot:p.sourceRoot,rootFile:p.rootFile,
    files:p.files.map(f => ({path:f.path,content:f.content,sha256:f.sha256})),declarations:p.declarations,config:p.config}};
  packet.requestId = "sha256:" + sha("tsfg.array-facts.request.v7\0" + jcs(request) + "\n");
  packet.packageId = "sha256:" + sha("tsfg.array-facts.package.v7\0" + packet.schemaHash + "\0" + jcs(p));
  return packet;
}

// Change only the last index in the single-function far fixture. All four
// affected enclosing ends are explicit; this is test-data offset arithmetic,
// not a Source parser or a successful producer oracle generator.
/** @param {any} row @param {string} token @param {string} decimal @returns {any} */
export function indexPacket(row, token, decimal) {
  const p = fresh(row.facts.package);
  assert.equal(p.payload.functions.length, 1);
  const fn = p.payload.functions[0], ret = fn.body.at(-1), read = ret.value, index = read.index;
  const file = p.payload.files.find(f => f.path === p.payload.rootFile); assert.ok(file);
  assert.equal(file.content.slice(index.range.start,index.range.end), index.token);
  const delta = token.length - index.token.length;
  file.content = file.content.slice(0,index.range.start) + token + file.content.slice(index.range.end);
  file.sha256 = sha(file.content); file.byteLength = Buffer.byteLength(file.content); file.utf16Length = file.content.length;
  fn.declarationRange.end += delta; ret.range.end += delta; read.range.end += delta; index.range.end += delta;
  index.token = token; index.decimal = decimal;
  return reframeFacts(p);
}

// Exact source-template edits for adversarial packets. Rebind only published
// source-range identities; no parser, checker, float conversion or product code.
/** @param {any} packet @param {number} start @param {number} end @param {string} replacement @returns {any} */
export function replaceSource(packet, start, end, replacement) {
  const p=packet.payload, file=p.files.find(f=>f.path===p.rootFile); assert.ok(file);
  const delta=replacement.length-(end-start);
  file.content=file.content.slice(0,start)+replacement+file.content.slice(end);
  file.sha256=sha(file.content);file.byteLength=Buffer.byteLength(file.content);file.utf16Length=file.content.length;
  /** @param {any} value */
  function shift(value) {
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach(shift);return;}
    if(Object.keys(value).length===2&&Number.isInteger(value.start)&&Number.isInteger(value.end)){
      if(value.start>=end && !(start===end&&value.end===start)){value.start+=delta;value.end+=delta;}
      else if(value.end>end || start!==end&&value.end===end)value.end+=delta;
      return;
    }
    Object.values(value).forEach(shift);
  }
  p.functions.forEach(shift);
  const ids=new Map();
  for(const fn of p.functions){
    const old=fn.id;fn.id='sha256:'+sha('tsfg.array-facts.binding.v1\0'+jcs({sourcePath:fn.sourcePath,nameRange:fn.nameRange}));ids.set(old,fn.id);
    for(const b of [...fn.parameters,...fn.bindings]){const old=b.id;b.id='sha256:'+sha('tsfg.array-facts.binding.v1\0'+jcs({sourcePath:fn.sourcePath,nameRange:b.nameRange}));ids.set(old,b.id);}
  }
  /** @param {any} value */
  function rebind(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.binding === 'string' && ids.has(value.binding)) value.binding=ids.get(value.binding);
    for (const child of Object.values(value)) rebind(child);
  }
  for(const fn of p.functions){
    rebind(fn.body);
    for(const stmt of fn.body)if(stmt.kind==='variable'&&stmt.initializer.kind==='arrayLiteral')
      stmt.initializer.allocationSite='sha256:'+sha('tsfg.array-facts.allocation-site.v1\0'+jcs({sourcePath:fn.sourcePath,range:stmt.initializer.range}));
  }
  for(const e of p.exports)e.functionId=ids.get(e.functionId);
  return reframeFacts(packet);
}
