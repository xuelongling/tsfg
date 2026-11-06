// SPDX-License-Identifier: MIT
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseUniqueJson } from './contract-set.mjs';
import { readMlirSdkSourceAdmission } from './mlir-sdk-admission.mjs';
import { readMlirLegalRegistration } from './mlir-source-registration.mjs';

export class MlirSdkError extends TypeError {
  constructor(message, cause = undefined) { super(message, { cause }); this.issueCode = "mlir-source-integrity"; }
}
const fail = reason => { throw new MlirSdkError(`mlir-source-sdk: SDK origin ${reason}`); };
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function parseSdkJson(bytes, role, canonicalize) {
  try {
    const value=parseUniqueJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value || typeof value!=='object' || Array.isArray(value))fail(`invalid ${role} JSON object`);
    canonicalize(value);
    return value;
  } catch(error) {
    if(error instanceof MlirSdkError)throw error;
    throw new MlirSdkError(`mlir-source-sdk: SDK origin invalid ${role} JSON or UTF-8`,error);
  }
}
async function ordinary(file,directory=false) {
  if (typeof file !== 'string' || !/^E:[\\/]/i.test(file)) fail('requires absolute E storage');
  const state=await lstat(file).catch(()=>null);
  if (!state || state.isSymbolicLink() || !(directory?state.isDirectory():state.isFile()) ||
      path.relative(path.resolve(file),await realpath(file)) !== '') fail(`nonordinary input ${file}`);
}

const requiredSdkInputSet = {
  "admissionProfile": "debug",
  "admissionTarget": "windows-x86_64-msvc",
  "allowedSourceTarget": "mlir-core",
  "artifactRootEnvironment": "TSFG_MLIR_SDK_ARTIFACT_ROOT",
  "inventory": {
    "member": "files",
    "pathField": "path",
    "productFile": "eng/mlir-sdk.lock.json",
    "sha256Field": "sha256"
  },
  "maxFiles": 20000,
  "normalizedMode": "100644",
  "projectId": "llvm-sdk",
  "provenanceOnlyReads": [
    {
      "expectedHashField": "originManifestHash",
      "path": "artifact-manifest.json",
      "root": "artifactRoot"
    },
    {
      "expectedHashField": "originExecutableHash",
      "path": "tsfg-core-ir.exe",
      "root": "artifactRoot"
    },
    {
      "expectedHashSource": "authenticated origin manifest.outputs",
      "path": "source-notices.json",
      "root": "artifactRoot"
    }
  ],
  "rootEnvironment": "TSFG_MLIR_SDK_ROOT"
};

function checkedMlirInputDeclaration(declaration, canonicalize) {
  if (typeof canonicalize !== 'function') fail('requires the formal canonical serializer');
  if (!['2','3'].includes(declaration?.schemaVersion)) throw new MlirSdkError('mlir-source-sdk: SDK requires declaration grammar 2 or 3');
  const keys=Object.keys(declaration).sort();
  if (keys.join(',') !== (declaration.schemaVersion==='3'?'componentInputSets,entries,schemaVersion,supplementalInputSets':'entries,schemaVersion,supplementalInputSets') || !Array.isArray(declaration.entries) ||
      !Array.isArray(declaration.supplementalInputSets) || declaration.supplementalInputSets.length !== 1)
    throw new MlirSdkError('mlir-source-sdk: SDK input declaration shape');
  const set=declaration.supplementalInputSets[0];
  if (set?.projectId !== 'llvm-sdk') throw new MlirSdkError('mlir-source-sdk: SDK input declaration namespace');
  if (canonicalize(set) !== canonicalize(requiredSdkInputSet)) throw new MlirSdkError('mlir-source-sdk: SDK input declaration descriptor');
  let component=null;
  if(declaration.schemaVersion==='3') {
    if(!Array.isArray(declaration.componentInputSets)||declaration.componentInputSets.length!==1)
      fail('GPU component declaration requires its unique independent input set');
    component=readGpuFunctionComponentDescriptor(Buffer.from(canonicalize(declaration.componentInputSets[0])+'\n'),canonicalize);
    const roles=component.descriptor.files.map(file=>file.role);
    if(roles.length!==392||roles.filter(role=>role==='source-include').length!==274||
        roles.filter(role=>role==='generated-include').length!==72||roles.filter(role=>role==='generic-ir-link-archive').length!==42||
        roles.filter(role=>role==='spirv-emit-link-archive').length!==4||component.descriptor.archives.length!==46)
      fail('GPU component declaration differs from the adopted finite input scope');
  }
  const names=new Set();let previous=null;
  for (const entry of declaration.entries) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'path,projectId' || entry.projectId !== 'tsfg' ||
        typeof entry.path !== 'string' || !entry.path || path.posix.normalize(entry.path) !== entry.path ||
        path.win32.isAbsolute(entry.path) || entry.path.includes('\\') || entry.path.includes(':') ||
        entry.path.split('/').some(part=>!part || part==='.' || part==='..') || names.has(entry.path) ||
        (previous !== null && Buffer.from(previous).compare(Buffer.from(entry.path)) >= 0))
      throw new MlirSdkError('mlir-source-sdk: SDK input declaration entries');
    names.add(entry.path);previous=entry.path;
  }
  for(const required of ['eng/build-inputs.json',requiredSdkInputSet.inventory.productFile])
    if(!names.has(required))fail(`required product input is undeclared: ${required}`);
  return {inputSet:set,component};
}

export function validateMlirSdkInputDeclaration(declaration,canonicalize) {
  return checkedMlirInputDeclaration(declaration,canonicalize).inputSet;
}

export async function readMlirSdkInputDeclaration({productRoot,canonicalize}) {
  if (typeof canonicalize !== 'function') fail('requires the formal canonical serializer');
  const file=path.join(productRoot,'eng/build-inputs.json');await ordinary(file);
  const raw=await readFile(file);
  const declaration=parseSdkJson(raw,'input declaration',canonicalize);
  if (!raw.equals(Buffer.from(`${canonicalize(declaration)}\n`))) fail('noncanonical input declaration');
  const {inputSet,component}=checkedMlirInputDeclaration(declaration,canonicalize);
  return {declaration,inputSet,component,declarationHash:sha256(raw),executionAuthority:false};
}

function validateSdkInventory(files) {
  if (!Array.isArray(files) || files.length > 20000) fail('file inventory');
  const names=new Set();
  for (const file of files) {
    if (!file || Object.keys(file).sort().join(',') !== 'path,sha256' || typeof file.path !== 'string' ||
        !file.path || path.posix.normalize(file.path) !== file.path || path.win32.isAbsolute(file.path) ||
        file.path.includes('\\') || file.path.includes(':') || file.path.split('/').some(part=>!part || part==='.' || part==='..') ||
        file.path.includes('tsfg-core-ir') || !/^sha256:[0-9a-f]{64}$/.test(file.sha256) || names.has(file.path)) fail('file inventory');
    names.add(file.path);
  }
  return names;
}


function validateSdkProductInputs(inputSet,declaration,canonicalize) {
  // The caller owns the already checked declaration; this boundary owns only
  // the unknown producer input set and its join to those declared product paths.
  if (!inputSet || inputSet.schemaVersion !== '1' || !Array.isArray(inputSet.entries) ||
      Object.keys(inputSet).sort().join(',') !== 'digest,entries,schemaVersion' ||
      sha256(canonicalize({entries:inputSet.entries,schemaVersion:'1'})) !== inputSet.digest)
    fail('producer input payload');
  const declared=new Set(declaration.entries.map(entry=>entry.path));
  const actual=new Set();let previous=null;
  for(const entry of inputSet.entries) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'normalizedMode,projectId,repositoryRelativePath,sha256' ||
        !['tsfg','llvm-sdk'].includes(entry.projectId) || typeof entry.repositoryRelativePath !== 'string' ||
        !entry.repositoryRelativePath || path.posix.normalize(entry.repositoryRelativePath) !== entry.repositoryRelativePath ||
        path.win32.isAbsolute(entry.repositoryRelativePath) || entry.repositoryRelativePath.includes('\\') ||
        entry.repositoryRelativePath.includes(':') || entry.repositoryRelativePath.split('/').some(part=>!part || part==='.' || part==='..') ||
        !['100644','100755'].includes(entry.normalizedMode) || !/^sha256:[0-9a-f]{64}$/.test(entry.sha256)) fail('producer input entry');
    const key=entry.projectId+'\0'+entry.repositoryRelativePath;
    if(actual.has(key) || (previous!==null && Buffer.from(previous).compare(Buffer.from(key))>=0)) fail('producer input ordering');
    actual.add(key);previous=key;
    if(entry.projectId==='tsfg' && !declared.delete(entry.repositoryRelativePath)) fail('producer product membership');
  }
  if(declared.size!==0) fail('producer product membership');
}

/** Pure identity data projection; the caller must first qualify its SDK files. */
export function projectMlirSdkBuildIdentity(productIdentity,sdk,canonicalize) {
  if(typeof canonicalize!=='function') fail('requires the formal canonical serializer');
  validateSdkInventory(sdk?.files);
  const declaration=sdk?.declarationInput?.declaration;
  validateMlirSdkInputDeclaration(declaration,canonicalize);
  validateSdkProductInputs(productIdentity?.buildInputSet,declaration,canonicalize);
  if(productIdentity.buildInputSet.entries.some(entry=>entry.projectId!=='tsfg')) fail('producer base already has supplemental inputs');
  const declarationFile=productIdentity.buildInputSet.entries.find(entry=>entry.repositoryRelativePath==='eng/build-inputs.json');
  const lockFile=productIdentity.buildInputSet.entries.find(entry=>entry.repositoryRelativePath==='eng/mlir-sdk.lock.json');
  if(declarationFile?.sha256!==sdk.declarationInput.declarationHash||lockFile?.sha256!==sdk.lockFileHash) fail('producer declaration/lock binding');
  const original=productIdentity.buildIdentity;
  if(!original || Object.keys(original).sort().join(',')!=='buildInputSetDigest,digest,options,profile,source_date_epoch,target,toolchainClosureDigest' ||
      original.buildInputSetDigest!==productIdentity.buildInputSet.digest || original.profile!=='debug' ||
      original.target!=='windows-x86_64-msvc' || original.options?.sourceTarget!=='mlir-core') fail('producer build identity');
  const {digest:originalDigest,...originalPayload}=original;
  if(sha256(canonicalize(originalPayload))!==originalDigest) fail('producer build identity digest');
  const entries=[...productIdentity.buildInputSet.entries,...sdk.files.map(file=>({projectId:'llvm-sdk',
    repositoryRelativePath:file.path,normalizedMode:'100644',sha256:file.sha256}))]
    .sort((a,b)=>Buffer.from(a.projectId+'\0'+a.repositoryRelativePath).compare(Buffer.from(b.projectId+'\0'+b.repositoryRelativePath)));
  const payload={entries,schemaVersion:'1'};
  const buildInputSet={...payload,digest:sha256(canonicalize(payload))};
  const identityPayload={...originalPayload,buildInputSetDigest:buildInputSet.digest};
  return {...productIdentity,buildInputSet,buildIdentity:{...identityPayload,digest:sha256(canonicalize(identityPayload))}};
}

/** Verify the complete declared membership retained by the planned/final producer. */
export function verifyMlirSdkBuildInputSet(inputSet,sdk,canonicalize) {
  validateSdkInventory(sdk?.files);
  validateMlirSdkInputDeclaration(sdk?.declarationInput?.declaration,canonicalize);
  validateSdkProductInputs(inputSet,sdk?.declarationInput?.declaration,canonicalize);
  const expected=sdk.files.map(file=>({projectId:'llvm-sdk',repositoryRelativePath:file.path,normalizedMode:'100644',sha256:file.sha256}))
    .sort((a,b)=>Buffer.from(a.repositoryRelativePath).compare(Buffer.from(b.repositoryRelativePath)));
  if(canonicalize(inputSet.entries.filter(entry=>entry.projectId==='llvm-sdk'))!==canonicalize(expected)) fail('producer SDK membership');
}

/** Every observed source and license stays inside the declared SDK inventory. */
export function verifyMlirSdkSourceInputs(sdk,sourceInputs) {
  validateSdkInventory(sdk?.files);
  const members=new Map(sdk.files.map(file=>[file.path,file.sha256]));
  for(const entry of sourceInputs) {
    const name=entry?.repositoryRelativePath;
    if(entry?.projectId!=='llvm-project.git' || typeof name!=='string' || !name || path.posix.normalize(name)!==name ||
        path.win32.isAbsolute(name) || name.includes('\\') || name.includes(':') || name.split('/').some(part=>!part || part==='.' || part==='..') ||
        members.get('source/'+name)!==entry.sha256) fail('consumed source/license inventory join');
  }
}


const authenticatedSdkProvenance=new WeakMap();
const freezeData=(value,seen=new WeakSet())=>{
  if(value&&typeof value==='object'&&!seen.has(value)){
    seen.add(value);
    for(const item of Object.values(value))freezeData(item,seen);
    Object.freeze(value);
  }
  return value;
};

/** Only the same live SDK intake can supply authenticated provenance records. */
export function inspectMlirSdkProvenance(sdk,productRoot) {
  const proof=authenticatedSdkProvenance.get(sdk);
  if(!proof || typeof productRoot!=='string' || path.resolve(productRoot)!==proof.productRoot)fail('authenticated live provenance is missing or belongs to another product');
  return proof;
}

/** Reconcile membership before each observed SDK dependency body, including EVAL origins. */
export async function readMlirSdkDependency(sdk,file,productRoot) {
  const proof=inspectMlirSdkProvenance(sdk,productRoot);
  const relative=path.relative(proof.root,path.resolve(file)).replaceAll('\\','/');
  const member=proof.files.find(member=>member.path===relative);
  if(!member)fail(`undeclared observed dependency ${relative}`);
  await ordinary(file);
  const raw=await readFile(file);
  if(sha256(raw)!==member.sha256)fail(`changed observed dependency ${relative}`);
  return raw;
}

/** Pure legal-data comparison; it grants no SDK or source execution authority. */
export function verifyMlirSdkLicenseMaterial(file,material,canonicalize) {
  if(typeof canonicalize!=='function'||!file||!material||canonicalize(file)!==canonicalize(material)||typeof file.path!=='string'||file.path!==material.path||file.blob!==material.blob||
      file.sha256!==material.sha256||typeof file.completeOriginalNotice!=='string'||
      file.completeOriginalNotice!==material.completeOriginalNotice||sha256(Buffer.from(material.completeOriginalNotice))!==file.sha256)
    fail('authenticated complete license material');
}

/** Pure notice-data comparison against the current fixed approval mapping. */
export function verifyMlirSdkNoticeRecord(lock,notice,identity,canonicalize,approvalLockSha256) {
  if(typeof canonicalize!=='function'||lock?.schemaVersion!=='1'||notice?.schemaVersion!=='1'||
      lock.baseCommit!==identity?.baseCommit||lock.sourceCommit!==identity?.sourceCommit||
      notice.baseCommit!==identity.baseCommit||notice.sourceCommit!==identity.sourceCommit||
      notice.role!=='compiler-side-M01'||notice.purpose!==lock.purpose||notice.approvalLockSha256!==approvalLockSha256||
      !Array.isArray(lock.files)||!Array.isArray(notice.files)||canonicalize(lock.files)!==canonicalize(notice.files))
    fail('authenticated original notice mapping');
}


/** Original authenticated dependency identity, never a fresh Git/clean claim. */
export function describeMlirSdkSourceIdentity(sdk,productRoot) {
  const proof=inspectMlirSdkProvenance(sdk,productRoot);
  return Object.freeze({sourceRoot:proof.source,sourceCommit:proof.identity.sourceCommit,sourceTree:proof.identity.sourceTree,
    baseCommit:proof.sourceNotices.baseCommit,sourceIdentityBasis:'authenticated-sdk-snapshot',freshGitObserved:false});
}

/** Qualify a read-only source-built SDK. Its own original epoch and identity
 * remain separate from each newly compiled product producer's identity. */
export async function readMlirSourceSdk({root,artifactRoot,productRoot,canonicalize}) {
  if (typeof canonicalize !== 'function') fail('requires the formal canonical serializer');
  const declarationInput=await readMlirSdkInputDeclaration({productRoot,canonicalize});
  const lockPath=path.join(productRoot,'eng/mlir-sdk.lock.json');await ordinary(lockPath);
  const lockRaw=await readFile(lockPath);
  const lock=parseSdkJson(lockRaw,'inventory lock',canonicalize);
  if (!lockRaw.equals(Buffer.from(`${canonicalize(lock)}\n`)) || lock.schemaVersion !== '1' ||
      lock.profile !== 'debug' || lock.target !== 'windows-x86_64-msvc' || lock.options?.sourceTarget !== 'mlir-core' ||
      !/^sha256:[0-9a-f]{64}$/.test(lock.originManifestHash) || !Array.isArray(lock.files) || lock.files.length > 20000)
    fail('lock shape/identity');
  const names=validateSdkInventory(lock.files);
  await readMlirSdkSourceAdmission(lock);
  await ordinary(root,true);await ordinary(artifactRoot,true);
  for (const required of ['source-snapshot.json','input-trace.json','epoch-proof.json','actual-consumption-legal.json',
    'configure.log.command.json','configure.log.exit.json','build.log.command.json','build.log.exit.json',
    'build/lib/LLVMMC.lib','build/lib/cmake/llvm/LLVMConfig.cmake','build/lib/cmake/mlir/MLIRConfig.cmake'])
    if (!names.has(required)) fail(`missing provenance ${required}`);
  const manifestPath=path.join(artifactRoot,'artifact-manifest.json');await ordinary(manifestPath);
  const manifestRaw=await readFile(manifestPath);
  if (sha256(manifestRaw) !== lock.originManifestHash) fail('manifest raw identity');
  const manifest=parseSdkJson(manifestRaw,'original manifest',canonicalize);
  const identity=manifest.buildIdentity;
  if (identity?.digest !== lock.originBuildIdentity || identity.source_date_epoch !== lock.source_date_epoch ||
      identity.profile !== lock.profile || identity.target !== lock.target ||
      identity.toolchainClosureDigest !== lock.toolchainClosureDigest || canonicalize(identity.options) !== canonicalize(lock.options) ||
      manifest.outputs?.find(output=>output.path==='tsfg-core-ir.exe')?.sha256 !== lock.originExecutableHash)
    fail('original independent build identity');
  // Authenticate the actual original publication; never import its executable
  // or product objects as a new producer's compilation input.
  const executable=path.join(artifactRoot,'tsfg-core-ir.exe');await ordinary(executable);
  if (sha256(await readFile(executable)) !== lock.originExecutableHash) fail('original publication');
  const notices=path.join(artifactRoot,'source-notices.json');await ordinary(notices);
  const noticeRaw=await readFile(notices);
  if (sha256(noticeRaw) !== manifest.outputs?.find(output=>output.path==='source-notices.json')?.sha256)
    fail('original retained source notices');
  const sourceNotices=parseSdkJson(noticeRaw,'original source notices',canonicalize);
  let consumptionLegal,epoch,snapshot;
  const terminals=new Map();
  for (const file of lock.files) {
    const absolute=path.join(root,file.path);await ordinary(absolute);
    const raw=await readFile(absolute);
    if (sha256(raw) !== file.sha256) fail(`changed dependency ${file.path}`);
    if(file.path==='actual-consumption-legal.json')consumptionLegal=parseSdkJson(raw,'source legal provenance',canonicalize);
    if(file.path==='epoch-proof.json')epoch=parseSdkJson(raw,'epoch proof',canonicalize);
    if(file.path==='source-snapshot.json')snapshot=parseSdkJson(raw,'source snapshot',canonicalize);
    if(['configure.log.exit.json','build.log.exit.json'].includes(file.path))terminals.set(file.path,parseSdkJson(raw,'subprocess terminal',canonicalize));
  }
  for (const name of ['configure','build']) {
    const terminal=terminals.get(`${name}.log.exit.json`);
    if (terminal.code !== 0 || terminal.signal !== null) fail('original subprocess terminal');
  }
  if (snapshot.sourceCommit !== lock.sourceCommit || snapshot.sourceTree !== lock.sourceTree ||
      epoch?.method !== 'product-maximum-dominates-all-source-ancestor-times' ||
      epoch.sourceCommit !== lock.sourceCommit || !Number.isSafeInteger(epoch.sourceHistoryMaximum) || epoch.sourceHistoryMaximum < 0 ||
      !Number.isSafeInteger(epoch.productEpoch) || epoch.productEpoch < 0 || String(epoch.productEpoch) !== lock.source_date_epoch ||
      epoch.sourceHistoryMaximum > epoch.productEpoch) fail('source/own epoch provenance');
  const sourceEntries=snapshot.entries;
  if(!Array.isArray(sourceEntries))fail('source snapshot inventory');
  const identityResult=Object.freeze({schemaVersion:'1',lockHash:sha256(canonicalize(lock)),originManifestHash:lock.originManifestHash,
    originBuildIdentity:lock.originBuildIdentity,sourceCommit:lock.sourceCommit,sourceTree:lock.sourceTree,
    source_date_epoch:lock.source_date_epoch,profile:lock.profile,target:lock.target,toolchainClosureDigest:lock.toolchainClosureDigest});
  if(canonicalize(sourceNotices?.actualConsumption)!==canonicalize(consumptionLegal)||sourceNotices?.sourceCommit!==lock.sourceCommit||consumptionLegal?.sourceCommit!==lock.sourceCommit||
      sourceNotices.baseCommit!==consumptionLegal.baseCommit||sourceNotices.schemaVersion!=='1'||sourceNotices.role!=='compiler-side-M01'||
      consumptionLegal.schemaVersion!=='1'||consumptionLegal.role!=='compiler-side-M01'||consumptionLegal.status!=='selected-build-legal-inputs-verified'||
      consumptionLegal.intakeComplete!==false||consumptionLegal.sourceBuild!=='not-run'||
      !Array.isArray(consumptionLegal.files)||!Array.isArray(consumptionLegal.licenseMaterials))fail('authenticated legal provenance identity');
  const sdk=freezeData({root:path.resolve(root),source:path.join(root,'source'),build:path.join(root,'build'),
    identity:identityResult,files:lock.files,declarationInput,lockFileHash:sha256(lockRaw),sourceEntries,unmaterialized:snapshot.unmaterialized,
    checkoutDifferences:snapshot.checkoutDifferences,executionAuthority:false});
  authenticatedSdkProvenance.set(sdk,freezeData({productRoot:path.resolve(productRoot),declarationHash:declarationInput.declarationHash,lockFileHash:sha256(lockRaw),root:sdk.root,source:sdk.source,identity:identityResult,files:lock.files,sourceEntries,
    sourceNotices,consumptionLegal,epochProof:epoch,sourceNoticesHash:sha256(noticeRaw)}));
  return sdk;
}

const gpuFunctionComponents=new WeakMap();

/** Explicit data reader, not component authentication or SDK qualification.
 * Physical roots and qualification records are never descriptor data. */
export function readGpuFunctionComponentDescriptor(bytes,canonicalize) {
  if(typeof canonicalize!=='function')fail('GPU component requires the formal canonical serializer');
  if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>8388608)fail('GPU component descriptor byte bound');
  const raw=Buffer.from(bytes),descriptor=parseSdkJson(raw,'GPU component descriptor',canonicalize);
  if(!raw.equals(Buffer.from(canonicalize(descriptor)+'\n')))fail('GPU component descriptor is noncanonical');
  const record=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
  const relative=value=>typeof value==='string'&&value.length>0&&path.posix.normalize(value)===value&&
    !path.win32.isAbsolute(value)&&!/[\\:\0]/.test(value)&&
    value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part));
  if(!record(descriptor,'archives,buildRole,files,includeDirectories,normalizedMode,profile,projectId,roots,target')||
      descriptor.projectId!=='llvm-gpu-function-ir'||descriptor.buildRole!=='gpu-function-resource-ir'||
      descriptor.target!=='windows-x86_64-msvc'||descriptor.profile!=='debug'||descriptor.normalizedMode!=='100644')
    fail('GPU component descriptor role');
  const roots=[{rootId:'sdk-current',rootEnvironment:'TSFG_GPU_FUNCTION_IR_SDK_ROOT'},
    {rootId:'spirv-emit',rootEnvironment:'TSFG_GPU_FUNCTION_IR_SPIRV_ROOT'}];
  const includeDirectories=['source/llvm/include','build/include','source/mlir/include','build/tools/mlir/include']
    .map(name=>({rootId:'sdk-current',path:name}));
  if(canonicalize(descriptor.roots)!==canonicalize(roots)||canonicalize(descriptor.includeDirectories)!==canonicalize(includeDirectories))
    fail('GPU component logical roots or includes');
  if(!Array.isArray(descriptor.files)||descriptor.files.length===0||descriptor.files.length>20000||
      !Array.isArray(descriptor.archives)||descriptor.archives.length===0||descriptor.archives.length>descriptor.files.length)
    fail('GPU component inventory bound');
  const members=new Map(),aliases=new Set(),archiveMembers=new Set();let previous=null;
  for(const file of descriptor.files) {
    if(!record(file,'path,role,rootId,sha256')||typeof file.rootId!=='string'||typeof file.role!=='string'||
        !relative(file.path)||typeof file.sha256!=='string'||!/^sha256:[0-9a-f]{64}$/.test(file.sha256))
      fail('GPU component member shape');
    const name=file.rootId+'/'+file.path;
    if(aliases.has(name.toLowerCase())||(previous!==null&&Buffer.from(previous).compare(Buffer.from(name))>=0))
      fail('GPU component duplicate, aliased or unordered member');
    const include=/\.(h|inc|def)$/.test(file.path),archive=/^build\/lib\/[^/]+\.lib$/.test(file.path);
    const allowed=file.rootId==='sdk-current'&&(
      file.role==='source-include'&&include&&/^source\/(llvm|mlir)\/include\//.test(file.path)||
      file.role==='generated-include'&&include&&/^build\/(include|tools\/mlir\/include)\//.test(file.path)||
      file.role==='generic-ir-link-archive'&&archive)||
      file.rootId==='spirv-emit'&&file.role==='spirv-emit-link-archive'&&
        /^build\/lib\/MLIRSPIRV(Dialect|BinaryUtils|ImageInterfaces|Serialization)\.lib$/.test(file.path);
    if(!allowed)fail('GPU component member root, path or role');
    members.set(name,file);aliases.add(name.toLowerCase());previous=name;
    if(archive)archiveMembers.add(name);
  }
  const selected=new Set();
  for(const archive of descriptor.archives) {
    if(!record(archive,'path,rootId')||!roots.some(root=>root.rootId===archive.rootId)||!relative(archive.path))
      fail('GPU component ordered archive shape');
    const name=archive.rootId+'/'+archive.path;
    if(!archiveMembers.has(name)||selected.has(name))fail('GPU component ordered archive membership');
    selected.add(name);
  }
  if(selected.size!==archiveMembers.size)fail('GPU component ordered archive coverage');
  const component=Object.freeze({descriptor:freezeData(descriptor),descriptorHash:sha256(raw)});
  gpuFunctionComponents.set(component,{members,roots});
  return component;
}

/** Read exactly one declared data member. The caller supplies physical roots;
 * this handle grants neither llvm-sdk provenance nor build/execution authority. */
export async function readGpuFunctionComponentMember(component,rootLocations,rootId,memberPath) {
  const proof=gpuFunctionComponents.get(component);
  if(!proof)fail('GPU component live handle is missing');
  const member=proof.roots.some(root=>root.rootId===rootId)&&typeof memberPath==='string'?proof.members.get(rootId+'/'+memberPath):undefined;
  if(!member)fail('GPU component undeclared member');
  if(!rootLocations||typeof rootLocations!=='object'||Array.isArray(rootLocations)||
      Object.keys(rootLocations).sort().join(',')!==proof.roots.map(root=>root.rootId).sort().join(','))
    fail('GPU component requires exactly its explicit physical roots');
  // Copy caller locations before the first asynchronous filesystem operation.
  const locations=new Map(),aliases=new Set();
  for(const root of proof.roots) {
    const value=rootLocations[root.rootId];
    if(typeof value!=='string'||!/^E:[\\/]/i.test(value))fail('GPU component requires absolute E roots');
    const absolute=path.resolve(value),alias=absolute.toLowerCase();
    if(aliases.has(alias))fail('GPU component physical root alias');
    locations.set(root.rootId,absolute);aliases.add(alias);
  }
  for(const root of locations.values())await ordinary(root,true);
  const file=path.join(locations.get(member.rootId),member.path);
  await ordinary(file);
  const raw=await readFile(file);
  if(sha256(raw)!==member.sha256)fail('GPU component changed declared member');
  return raw;
}

const authenticatedGpuFunctionComponents=new WeakMap();
const verifiedGpuMembers=new Map();
const gpuStateKeys=['dev','ino','mode','nlink','size','mtimeNs','ctimeNs','birthtimeNs'];
async function gpuFileState(file) {
  const state=await lstat(file,{bigint:true});
  return Object.fromEntries(gpuStateKeys.map(key=>[key,String(state[key])]));
}

/** Authenticate only the adopted component. Qualification is factory-supplied
 * provenance, separately pinned by the controlled execution configuration. It
 * never contributes physical locations or observation records to input identity. */
export async function readGpuFunctionComponent({productRoot,rootLocations,qualification,epochProof,canonicalize}) {
  if(!qualification||Object.keys(qualification).sort().join(',')!=='path,sha256'||
      typeof qualification.path!=='string'||!/^sha256:[0-9a-f]{64}$/.test(qualification.sha256))
    fail('GPU component requires pinned qualification provenance');
  const qualificationFile=qualification.path,qualificationHash=qualification.sha256;
  const declarationInput=await readMlirSdkInputDeclaration({productRoot,canonicalize});
  if(declarationInput.declaration.schemaVersion!=='3')fail('GPU component requires declaration grammar 3');
  const data=declarationInput.component;
  const descriptor=data.descriptor;
  if(!rootLocations||typeof rootLocations!=='object'||Array.isArray(rootLocations)||
      Object.keys(rootLocations).sort().join(',')!=='sdk-current,spirv-emit')fail('GPU component requires exactly its explicit physical roots');
  const locations={};
  for(const root of descriptor.roots) {
    const location=rootLocations[root.rootId];
    if(typeof location!=='string'||!/^E:[\\/]/i.test(location))fail('GPU component requires absolute E roots');
    locations[root.rootId]=path.resolve(location);
  }
  if(locations['sdk-current'].toLowerCase()===locations['spirv-emit'].toLowerCase())fail('GPU component physical root alias');
  await ordinary(qualificationFile);
  const qualificationRaw=await readFile(qualificationFile);
  if(qualificationRaw.length>16777216||sha256(qualificationRaw)!==qualificationHash)fail('GPU component qualification hash');
  const sidecar=parseSdkJson(qualificationRaw,'GPU component qualification',canonicalize),scope=sidecar.component;
  if(!scope||!Array.isArray(scope.files)||!Array.isArray(scope.roots)||!scope.qualificationRecords||
      !Array.isArray(sidecar.proposedBuildInputDeclaration?.componentInputSets)||
      canonicalize(sidecar.proposedBuildInputDeclaration?.componentInputSets)!==canonicalize([descriptor])||
      scope.projectId!==descriptor.projectId||scope.buildRole!==descriptor.buildRole||scope.admissionTarget!==descriptor.target||
      scope.admissionProfile!==descriptor.profile||scope.normalizedMode!==descriptor.normalizedMode||
      canonicalize(scope.includeDirectories)!==canonicalize(descriptor.includeDirectories)||
      canonicalize(scope.files.map(file=>file&&({rootId:file.rootId,path:file.path,role:file.role,sha256:file.sha256})))!==canonicalize(descriptor.files))
    fail('GPU component qualification has a foreign normative scope');
  const archiveRows=scope.files.filter(file=>file.role.endsWith('link-archive')).sort((a,b)=>a.linkOrder-b.linkOrder);
  if(canonicalize(archiveRows.map(({rootId,path:memberPath})=>({rootId,path:memberPath})))!==canonicalize(descriptor.archives)||
      archiveRows.some((file,index)=>file.linkOrder!==index||!file.current8||
        Object.keys(file.current8).sort().join(',')!==[...gpuStateKeys].sort().join(',')||
        gpuStateKeys.some(key=>typeof file.current8[key]!=='string'||!/^\d+$/.test(file.current8[key]))))
    fail('GPU component qualification archive observations');
  const records=scope.qualificationRecords;
  const readRecord=async name=>{
    const record=records[name];
    if(!record||typeof record.path!=='string')fail('GPU component missing qualification record '+name);
    await ordinary(record.path);const raw=await readFile(record.path);
    if(raw.length>33554432||(record.sha256!==undefined&&sha256(raw)!==record.sha256))fail('GPU component changed qualification record '+name);
    return parseSdkJson(raw,'GPU component '+name,canonicalize);
  };
  const buildLegal=await readMlirLegalRegistration('build'),fileLegal=await readMlirLegalRegistration('file');
  const sourceLock=parseSdkJson(await readFile(new URL('./mlir-source.lock.json',import.meta.url)),'registered source',canonicalize);
  if(scope.sourceCommit!==sourceLock.sourceCommit||scope.sourceTree!==sourceLock.sourceTree||
      [buildLegal.lock,fileLegal.lock].some(lock=>lock.sourceCommit!==scope.sourceCommit||lock.baseCommit!==sourceLock.baseCommit||lock.role!=='compiler-side-M01'))
    fail('GPU component qualified Source identity');
  // This retained fixed-Source proof contains no physical locations. Its trusted
  // digest cannot be replaced by a caller's self-signed, smaller history bound.
  if(!epochProof||Object.keys(epochProof).sort().join(',')!=='path,sha256'||typeof epochProof.path!=='string'||
      epochProof.sha256!=='sha256:ad7af29ce4c8bc1f8a47ed0550c3e67102e089cc1a34dfd3373253502b04e90b')
    fail('GPU component requires the qualified Source epoch proof');
  const epochPath=epochProof.path,epochHash=epochProof.sha256;
  await ordinary(epochPath);const epochRaw=await readFile(epochPath);
  if(sha256(epochRaw)!==epochHash)fail('GPU component Source epoch proof hash');
  const epoch=parseSdkJson(epochRaw,'GPU component Source epoch proof',canonicalize);
  if(Object.keys(epoch).sort().join(',')!=='method,productEpoch,sourceCommit,sourceHistoryMaximum'||
      epoch.method!=='product-maximum-dominates-all-source-ancestor-times'||epoch.sourceCommit!==scope.sourceCommit||
      !Number.isSafeInteger(epoch.productEpoch)||!Number.isSafeInteger(epoch.sourceHistoryMaximum)||
      epoch.sourceHistoryMaximum<=0||epoch.productEpoch<epoch.sourceHistoryMaximum)
    fail('GPU component Source history upper bound');
  const registered=new Map([...buildLegal.lock.files,...buildLegal.lock.licenseMaterials,...fileLegal.lock.files,...sourceLock.files]
    .map(file=>[file.path,file]));
  const sourceEntries=descriptor.files.filter(file=>file.role==='source-include').map(file=>{
    const registeredFile=registered.get(file.path.slice(7));
    if(!registeredFile||registeredFile.sha256!==file.sha256)fail('GPU component source/legal member is unregistered: '+file.path);
    return registeredFile;
  });
  const inputs=await readRecord('functionBuildInputs'),observed=await readRecord('functionBuild03Observation');
  if(observed.qualified!==true||observed.done!==true||observed.finished!==true||observed.completion!=='resolved'||
      observed.observerOK!==true||observed.exit?.code!==0||observed.exit.signal!==null||observed.close?.code!==0||
      observed.close.signal!==null||!Array.isArray(observed.first)||observed.first.length!==0||
      !Array.isArray(inputs.orderedArchives)||inputs.orderedArchives.length!==46)
    fail('GPU component producer is not a qualified natural completion');
  const guards=await readRecord('functionRawGuards03'),configuration=await readRecord('functionBuildConfig03');
  const trace=await readRecord('currentA32Trace'),four=await readRecord('fourLibraryProducer');
  if(!Array.isArray(guards.sourceGuards)||!Array.isArray(configuration.sourceGuards)||!Array.isArray(trace.generated)||
      four.sourceCommit!==scope.sourceCommit||four.sourceTree!==scope.sourceTree||four.build?.qualified!==true||
      four.build.exit?.code!==0||four.build.close?.code!==0||four.build.compileCount!==26||four.build.archiveCount!==4||
      !Array.isArray(four.build.first)||four.build.first.length!==0||!Array.isArray(four.outputs)||four.outputs.length!==4)
    fail('GPU component missing original source/producer qualification');
  const generated=new Map(trace.generated.map(file=>[file.path,file.sha256]));
  const originalRoots=new Map(scope.roots.map(root=>[root.rootId,root.currentAbsolutePath]));
  const guardMap=new Map(guards.sourceGuards.map(row=>[row.path,canonicalize(row.current8)]));
  const configMap=new Map(configuration.sourceGuards.map(row=>[row.path,canonicalize(row.current8)]));
  for(const file of descriptor.files.filter(file=>file.role==='generated-include'))
    if(generated.get(file.path.slice(6))!==file.sha256)fail('GPU component generated identity differs from its producer trace');
  for(const [index,file] of archiveRows.entries()) {
    const originalRoot=originalRoots.get(file.rootId);
    if(typeof originalRoot!=='string')fail('GPU component qualification root');
    const original=path.posix.join(originalRoot.replaceAll('\\','/'),file.path);
    if(inputs.orderedArchives[index]?.path!==original||inputs.orderedArchives[index]?.sha256!==file.sha256||
        guardMap.get(original)!==canonicalize(file.current8)||configMap.get(original)!==canonicalize(file.current8))
      fail('GPU component archive lacks its original qualified identity');
    if(file.role==='spirv-emit-link-archive'&&!four.outputs.some(output=>output.path===original&&'sha256:'+output.sha256===file.sha256))
      fail('GPU component emit archive lacks its actual producer');
    if(file.role==='generic-ir-link-archive'&&generated.get(file.path.slice(6))!==file.sha256)
      fail('GPU component generic archive differs from its producer trace');
  }
  for(const location of Object.values(locations))await ordinary(location,true);
  const members=new Map();
  for(const file of descriptor.files) {
    const absolute=path.join(locations[file.rootId],file.path);await ordinary(absolute);
    const state=canonicalize(await gpuFileState(absolute)),key=absolute+'\0'+file.sha256;
    // Only this process's prior actual hash can authorize unchanged-stat reuse.
    // A caller-pinned sidecar and its current8 are provenance, not a body cache.
    if(verifiedGpuMembers.get(key)!==state) {
      if(sha256(await readFile(absolute))!==file.sha256)fail('GPU component changed declared member: '+file.path);
      verifiedGpuMembers.set(key,state);
    }
    members.set(absolute,file);
  }
  const handle=Object.freeze({projectId:descriptor.projectId,buildRole:descriptor.buildRole,descriptorHash:data.descriptorHash,executionAuthority:false});
  const proof=freezeData({productRoot:path.resolve(productRoot),descriptor,descriptorHash:data.descriptorHash,
    declarationHash:declarationInput.declarationHash,declaration:declarationInput.declaration,rootLocations:locations,
    includeDirectories:descriptor.includeDirectories.map(include=>path.join(locations[include.rootId],include.path)),
    archives:descriptor.archives.map(archive=>({...archive,absolute:path.join(locations[archive.rootId],archive.path),
      sha256:members.get(path.join(locations[archive.rootId],archive.path)).sha256})),
    sourceIdentity:{sourceRoot:path.join(locations['sdk-current'],'source'),baseCommit:sourceLock.baseCommit,
      sourceCommit:scope.sourceCommit,sourceTree:scope.sourceTree,sourceIdentityBasis:'qualified-gpu-function-component',freshGitObserved:false},
    sourceEntries,licenseMaterials:buildLegal.lock.licenseMaterials,
    qualification:{path:qualificationFile,sha256:qualificationHash},epochProof:{...epoch,path:epochPath,sha256:epochHash},executionAuthority:false});
  authenticatedGpuFunctionComponents.set(handle,{proof,members});
  return handle;
}

/** A data handle, copied object, another product or the old SDK has no authority. */
export function inspectGpuFunctionComponent(handle,productRoot) {
  const owned=authenticatedGpuFunctionComponents.get(handle);
  if(!owned||typeof productRoot!=='string'||path.resolve(productRoot)!==owned.proof.productRoot)
    fail('GPU component authenticated live provenance is missing or belongs to another product');
  return owned.proof;
}

export async function readGpuFunctionComponentDependency(handle,file,productRoot) {
  inspectGpuFunctionComponent(handle,productRoot);
  if(typeof file!=='string'||!path.isAbsolute(file))fail('GPU component dependency requires an absolute member');
  const owned=authenticatedGpuFunctionComponents.get(handle),absolute=path.resolve(file),member=owned.members.get(absolute);
  if(!member)fail('GPU component dependency is undeclared');
  await ordinary(absolute);const raw=await readFile(absolute);
  if(sha256(raw)!==member.sha256)fail('GPU component changed declared dependency');
  return raw;
}

/** Stable rootId/path identity only; physical provenance is not a BIS member. */
export function projectGpuFunctionComponentBuildIdentity(productIdentity,handle,canonicalize) {
  const owned=authenticatedGpuFunctionComponents.get(handle);
  if(!owned)fail('GPU component authenticated live provenance is missing');
  const proof=owned.proof;
  validateSdkProductInputs(productIdentity?.buildInputSet,proof.declaration,canonicalize);
  if(productIdentity.buildInputSet.entries.some(entry=>entry.projectId!=='tsfg')||
      productIdentity.buildInputSet.entries.find(entry=>entry.repositoryRelativePath==='eng/build-inputs.json')?.sha256!==proof.declarationHash)
    fail('GPU component producer declaration binding');
  const original=productIdentity.buildIdentity;
  if(!original||Object.keys(original).sort().join(',')!=='buildInputSetDigest,digest,options,profile,source_date_epoch,target,toolchainClosureDigest'||
      original.buildInputSetDigest!==productIdentity.buildInputSet.digest||original.profile!==proof.descriptor.profile||original.target!==proof.descriptor.target||
      original.options?.sourceTarget!=='mlir-core'||original.options?.coreCommandRole!==proof.descriptor.buildRole||
      (original.options.artifactKind!==undefined&&original.options.artifactKind!=='static-consumer-library'))
    fail('GPU component producer build role');
  const productEpoch=Number(original.source_date_epoch);
  if(typeof original.source_date_epoch!=='string'||!/^\d+$/.test(original.source_date_epoch)||
      !Number.isSafeInteger(productEpoch)||productEpoch<=0||proof.epochProof.sourceHistoryMaximum>productEpoch)
    fail('GPU component Source history exceeds the actual product epoch');
  const {digest:originalDigest,...originalPayload}=original;
  if(sha256(canonicalize(originalPayload))!==originalDigest)fail('GPU component producer identity digest');
  const entries=[...productIdentity.buildInputSet.entries,...proof.descriptor.files.map(file=>({projectId:proof.descriptor.projectId,
    repositoryRelativePath:file.rootId+'/'+file.path,normalizedMode:proof.descriptor.normalizedMode,sha256:file.sha256}))]
    .sort((a,b)=>Buffer.from(a.projectId+'\0'+a.repositoryRelativePath).compare(Buffer.from(b.projectId+'\0'+b.repositoryRelativePath)));
  const payload={entries,schemaVersion:'1'},buildInputSet={...payload,digest:sha256(canonicalize(payload))};
  const identityPayload={...originalPayload,options:{...originalPayload.options,artifactKind:'static-consumer-library'},buildInputSetDigest:buildInputSet.digest};
  return {...productIdentity,buildInputSet,buildIdentity:{...identityPayload,digest:sha256(canonicalize(identityPayload))}};
}

export function verifyGpuFunctionComponentBuildInputSet(inputSet,handle,canonicalize) {
  const owned=authenticatedGpuFunctionComponents.get(handle);
  if(!owned)fail('GPU component authenticated live provenance is missing');
  if(!inputSet||Object.keys(inputSet).sort().join(',')!=='digest,entries,schemaVersion'||inputSet.schemaVersion!=='1'||
      !Array.isArray(inputSet.entries)||sha256(canonicalize({entries:inputSet.entries,schemaVersion:'1'}))!==inputSet.digest)
    fail('GPU component producer input payload');
  if(inputSet.entries.some(entry=>!entry||typeof entry!=='object'||Array.isArray(entry)||
      Object.keys(entry).sort().join(',')!=='normalizedMode,projectId,repositoryRelativePath,sha256'))
    fail('GPU component producer input entry');
  const product=inputSet.entries.filter(entry=>entry.projectId==='tsfg');
  const productPayload={entries:product,schemaVersion:'1'};
  validateSdkProductInputs({...productPayload,digest:sha256(canonicalize(productPayload))},owned.proof.declaration,canonicalize);
  const expected=[...product,...owned.proof.descriptor.files.map(file=>({projectId:owned.proof.descriptor.projectId,
    repositoryRelativePath:file.rootId+'/'+file.path,normalizedMode:'100644',sha256:file.sha256}))]
    .sort((a,b)=>Buffer.from(a.projectId+'\0'+a.repositoryRelativePath).compare(Buffer.from(b.projectId+'\0'+b.repositoryRelativePath)));
  if(canonicalize(inputSet.entries)!==canonicalize(expected)||
      product.find(entry=>entry.repositoryRelativePath==='eng/build-inputs.json')?.sha256!==owned.proof.declarationHash)
    fail('GPU component producer member or identity domain');
}
