// SPDX-License-Identifier: MIT
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseUniqueJson } from './contract-set.mjs';
import { readMlirSdkSourceAdmission } from './mlir-sdk-admission.mjs';

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

export function validateMlirSdkInputDeclaration(declaration, canonicalize) {
  if (typeof canonicalize !== 'function') fail('requires the formal canonical serializer');
  if (declaration?.schemaVersion !== '2') throw new MlirSdkError('mlir-source-sdk: SDK requires declaration grammar 2');
  const keys=Object.keys(declaration).sort();
  if (keys.join(',') !== 'entries,schemaVersion,supplementalInputSets' || !Array.isArray(declaration.entries) ||
      !Array.isArray(declaration.supplementalInputSets) || declaration.supplementalInputSets.length !== 1)
    throw new MlirSdkError('mlir-source-sdk: SDK input declaration shape');
  const set=declaration.supplementalInputSets[0];
  if (set?.projectId !== 'llvm-sdk') throw new MlirSdkError('mlir-source-sdk: SDK input declaration namespace');
  if (canonicalize(set) !== canonicalize(requiredSdkInputSet)) throw new MlirSdkError('mlir-source-sdk: SDK input declaration descriptor');
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
  return set;
}

export async function readMlirSdkInputDeclaration({productRoot,canonicalize}) {
  if (typeof canonicalize !== 'function') fail('requires the formal canonical serializer');
  const file=path.join(productRoot,'eng/build-inputs.json');await ordinary(file);
  const raw=await readFile(file);
  const declaration=parseSdkJson(raw,'input declaration',canonicalize);
  if (!raw.equals(Buffer.from(`${canonicalize(declaration)}\n`))) fail('noncanonical input declaration');
  const inputSet=validateMlirSdkInputDeclaration(declaration,canonicalize);
  return {declaration,inputSet,declarationHash:sha256(raw),executionAuthority:false};
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
  validateMlirSdkInputDeclaration(declaration,canonicalize);
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
