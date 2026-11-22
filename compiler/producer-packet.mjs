// SPDX-License-Identifier: MIT
import {sha256} from './identity.mjs';
import registry from '../contracts/registry.json' with {type:'json'};
import schema from '../contracts/bytecode.schema.json' with {type:'json'};

const versionText=schema.header.find(field=>field[0]==='version')?.[1];
if (!versionText || !/^u32:[0-9]+$/.test(versionText)) throw new TypeError('r04-producer-schema: missing exact wire version');
const version=Number(versionText.slice(4));
const maxBytes=Number(schema.limits.maxBytes);
const magic=Buffer.from('TSFGTBC0');
const capabilityText=schema.payload.find(field=>field[0]==='capabilities')?.[1];
if (!capabilityText || !/^u32:[0-9]+$/.test(capabilityText)) throw new TypeError('r04-producer-schema: missing exact payload capability');
const capability=Number(capabilityText.slice(4));

/** Read the module's own input digest from custom or generic Core text.
 * Structural Core validation remains with the compiler.
 * @param {string} core */
export function readCoreInputIdentity(core) {
  const tokens=/\/\/[^\r\n]*|"(?:[^"\\]|\\[\s\S])*"|[#!](?:[0-9]+|[A-Za-z_.$-][\w.$-]*)|[A-Za-z_][\w.$-]*|->|[@{}[\](),=<>]/gu;
  function next() {
    let token;
    do { token=tokens.exec(core)?.[0]; } while(token?.startsWith('//'));
    return token;
  }
  const literal=token=>token?.startsWith('"')?token.slice(1,-1).replace(/\\([0-9a-f]{2})/giu,
    (_escape,hex)=>String.fromCharCode(Number.parseInt(hex,16))):undefined;
  const isModule=token=>token==='module'||token==='builtin.module'||literal(token)==='builtin.module';
  const delta=token=>['{','[','(','<'].includes(token)?1:['}',']',')','>'].includes(token)?-1:0;
  const aliases=new Map();
  const digest=token=>{
    const value=literal(token)??aliases.get(token);
    return value&&/^sha256:[0-9a-f]{64}$/u.test(value)?value:undefined;
  };
  function aliasDefinition(token) {
    if(!token||!['#','!'].includes(token[0]))return false;
    const position=tokens.lastIndex;
    const definition=next()==='=';
    tokens.lastIndex=position;
    return definition;
  }
  let module=next();
  while(aliasDefinition(module)) {
    const alias=module;
    next(); // '='
    let token=next(),depth=0;
    if(alias.startsWith('#')) {
      const value=digest(token);
      if(value)aliases.set(alias,value);
    }
    // A file-level alias can contain a nested attribute or a location.
    for(;token!==undefined;token=module) {
      depth+=delta(token);
      if(depth<0)return undefined;
      module=next();
      if(!depth&&(isModule(module)||aliasDefinition(module)))break;
    }
    if(token===undefined)return undefined;
  }
  if(module==='module'||module==='builtin.module') {
    let head=next();
    if(head==='@'){next();head=next();}
    if(head!=='attributes'||next()!=='{')return undefined;
  }else if(isModule(module)) {
    if(next()!=='('||next()!==')')return undefined;
    let region=next();
    if(region==='<') {
      let depth=1;
      for(let token;depth&&(token=next())!==undefined;)depth+=delta(token);
      if(depth)return undefined;
      region=next();
    }
    if(region!=='('||next()!=='{')return undefined;
    let depth=1;
    for(let token;depth&&(token=next())!==undefined;){
      if(token==='{')depth++;
      else if(token==='}')depth--;
    }
    if(depth||next()!==')'||next()!=='{')return undefined;
  }else return undefined;

  let identity,depth=0,field=true;
  for(let token;(token=next())!==undefined;){
    if(!depth&&token==='}')return identity;
    if(!depth&&field&&(token==='tsfg_core.input_identity'||literal(token)==='tsfg_core.input_identity')){
      if(identity!==undefined||next()!=='=')return undefined;
      identity=digest(next());
      if(identity===undefined)return undefined;
    }
    depth+=delta(token);
    if(depth<0)return undefined;
    field=token===',';
  }
  return undefined;
}

/**
 * The registered scalar and private Common envelopes use the same target and
 * input-identity prefix. Run this after the respective envelope check.
 * @param {Buffer} bytecode
 * @param {{target: string, triple: string, llvmDataLayout: string}} target
 * @param {number} expectedCapability
 * @param {string} expectedInputIdentity
 */
export function hasProducedInputIdentity(bytecode, target, expectedCapability, expectedInputIdentity) {
  return producedInputEnd(bytecode,target,expectedCapability,expectedInputIdentity)!==null;
}

/**
 * @param {Buffer} bytecode
 * @param {{target: string, triple: string, llvmDataLayout: string}} target
 * @param {number} expectedCapability
 * @param {string} expectedInputIdentity
 */
function producedInputEnd(bytecode, target, expectedCapability, expectedInputIdentity) {
  let offset=80;
  for (const text of [target.target, target.triple, target.llvmDataLayout]) {
    const length=Buffer.byteLength(text);
    const start=offset+4, end=start+length;
    if (end>bytecode.length || bytecode.readUInt32LE(offset)!==length || bytecode.toString('utf8',start,end)!==text)
      return null;
    offset=end;
  }
  // Four u16 target geometry fields, the u32 capability, then the digest.
  const input=offset+12, end=input+32;
  return end<=bytecode.length && bytecode.readUInt16LE(offset)===4 && bytecode.readUInt16LE(offset+2)===4
    && bytecode.readUInt16LE(offset+4)===64 && bytecode.readUInt16LE(offset+6)===8
    && bytecode.readUInt32LE(offset+8)===expectedCapability
    && `sha256:${bytecode.subarray(input,end).toString('hex')}`===expectedInputIdentity ? end : null;
}

/** @param {Buffer} bytecode @param {number} inputEnd @param {string} expectedRoot */
function hasScalarDefaultRoot(bytecode, inputEnd, expectedRoot) {
  // The single-source scalar route has no module tables. Its first descriptor
  // begins with the function ID, after the Source row and function count.
  const sourcePathLength=inputEnd+32;
  if (sourcePathLength+4>bytecode.length) return false;
  const moduleMode=sourcePathLength+4+bytecode.readUInt32LE(sourcePathLength)+4;
  const first=moduleMode+3, end=first+32;
  if (end>bytecode.length || bytecode[moduleMode]!==0) return false;
  const count=bytecode.readUInt16LE(moduleMode+1);
  return count>=1 && count<=Number(schema.limits.maxFunctions)
    && `sha256:${bytecode.subarray(first,end).toString('hex')}`===expectedRoot;
}

// This validates the source-built producer's complete packet envelope. The
// formal C++ producer and Runtime reader retain full payload verification.
/** @param {Buffer} bytecode @param {string} [expectedInputIdentity] @param {string} [expectedDefaultRoot] */
export function verifyProducedPacket(bytecode, expectedInputIdentity, expectedDefaultRoot) {
  if (!Buffer.isBuffer(bytecode) || bytecode.length < 80 || bytecode.length > maxBytes || !bytecode.subarray(0,8).equals(magic)
      || bytecode.readUInt32LE(8) !== version || bytecode.readUInt32LE(44) !== bytecode.length
      || `sha256:${bytecode.subarray(12,44).toString('hex')}` !== registry['tsfg.bytecode'].schemaHash
      || `sha256:${bytecode.subarray(48,80).toString('hex')}` !== sha256(bytecode.subarray(80)))
    throw new TypeError('r04-producer-identity: C++ output differs from registered R04 packet');
  const end=expectedInputIdentity===undefined ? null : producedInputEnd(bytecode,schema.target,capability,expectedInputIdentity);
  if (expectedInputIdentity!==undefined && end===null)
    throw new TypeError('r04-producer-input-identity: packet target or input differs from the checked HIR');
  if (expectedDefaultRoot!==undefined && (end===null || !hasScalarDefaultRoot(bytecode,end,expectedDefaultRoot)))
    throw new TypeError('r04-producer-default-root: first scalar function differs from the checked default root');
}

/** @param {Buffer} bytecode @param {string} coreInputIdentity */
export function verifyAotProducedPacket(bytecode,coreInputIdentity) {
  verifyProducedPacket(bytecode);
  verifyAotPacketInput(bytecode, coreInputIdentity);
}

/** Check AOT target and Core identity after the packet envelope was verified.
 * @param {Buffer} bytecode @param {string} coreInputIdentity
 */
export function verifyAotPacketInput(bytecode, coreInputIdentity) {
  if(!hasProducedInputIdentity(bytecode,schema.target,capability,coreInputIdentity))
    throw new TypeError('r04-producer-input-identity: packet target or input differs from the checked Core');
}

/** Bind an ordinary AMD64 COFF object's immutable AOT metadata to the exact
 * packet and Core already selected for the build. No text or code is decoded.
 * @param {Buffer} object @param {Buffer} bytecode @param {string} coreInputIdentity
 */
export function verifyAotProducedObject(object, bytecode, coreInputIdentity) {
  const digestBytes = 32, programBytes = 160, inputOffset = 8 + digestBytes;
  const fixedPrefixBytes = inputOffset + digestBytes;
  const initializedReadOnly = 0x40000040;
  const unsupportedSectionFlags = 0xa10000a0;
  const malformed = () => { throw new TypeError('r03-aot-object: missing or invalid compiled program metadata'); };
  if (!Buffer.isBuffer(object) || object.length < 20 || object.length > 16 * 1024 * 1024 ||
      object.readUInt16LE(0) !== 0x8664 || object.readUInt16LE(16) !== 0) return malformed();

  // COFF uses 40-byte section headers and 18-byte symbol rows. The name
  // offsets in long symbol rows are relative to the following string table.
  const sections = object.readUInt16LE(2);
  const headersEnd = 20 + 40 * sections;
  const symbols = object.readUInt32LE(8);
  const count = object.readUInt32LE(12);
  const strings = symbols + 18 * count;
  if (!sections || symbols < headersEnd || !count || strings + 4 > object.length) return malformed();
  const stringsSize = object.readUInt32LE(strings);
  if (stringsSize < 4 || strings + stringsSize > object.length) return malformed();

  const idName = Buffer.from('tsfg_aot_compiled_table_id_v4\0');
  const programName = Buffer.from('tsfg_aot_program_v1\0');
  let id, program;
  for (let i = 0; i < count;) {
    const row = symbols + 18 * i;
    const aux = object[row + 17];
    if (i + aux >= count) return malformed();
    i += 1 + aux;
    // Both selected symbols require the long-name representation.
    if (object.readUInt32LE(row) !== 0) continue;
    const name = object.readUInt32LE(row + 4);
    if (name < 4 || name >= stringsSize) return malformed();
    const matches = candidate => name + candidate.length <= stringsSize &&
      object.subarray(strings + name, strings + name + candidate.length).equals(candidate);
    const isId = matches(idName);
    if (!isId && !matches(programName)) continue;
    const section = object.readInt16LE(row + 12);
    if (section < 1 || section > sections || object.readUInt16LE(row + 14) !== 0 ||
        object[row + 16] !== 2 || aux || (isId ? id : program)) return malformed();

    const header = 20 + 40 * (section - 1);
    const size = object.readUInt32LE(header + 16);
    const raw = object.readUInt32LE(header + 20);
    const flags = object.readUInt32LE(header + 36);
    const value = object.readUInt32LE(row + 8);
    const width = isId ? digestBytes : programBytes;
    // Reject code, writable/uninitialized data, and relocation-overflow
    // sections. The published records reside in initialized read-only data.
    if ((flags & initializedReadOnly) !== initializedReadOnly || (flags & unsupportedSectionFlags) ||
        raw < headersEnd || raw + size > symbols || value + width > size) return malformed();
    const relocations = object.readUInt16LE(header + 32);
    const reloc = object.readUInt32LE(header + 24);
    if (relocations && (reloc < headersEnd || reloc + 10 * relocations > symbols)) return malformed();
    // Program v1 puts its relocatable tables after the fixed prefix. A COFF
    // relocation must not touch either digest or the program version/size.
    const fixedEnd = value + (isId ? width : fixedPrefixBytes);
    // AMD64 relocations write at most eight bytes. Include nearby starts
    // before the protected range without interpreting relocation types.
    for (let r = 0; r < relocations; ++r) {
      const address = object.readUInt32LE(reloc + 10 * r);
      if (address < fixedEnd && address + 8 > value) return malformed();
    }
    const data = object.subarray(raw + value, raw + value + width);
    if (isId) id = data;
    else program = data;
  }
  if (!id || !program || program.readUInt32LE(0) !== 1 || program.readUInt32LE(4) !== program.length) return malformed();
  const compiledTableId = sha256(Buffer.concat([Buffer.from('tsfg.aot-compiled-module.v4\0'), bytecode]));
  if (`sha256:${id.toString('hex')}` !== compiledTableId || !program.subarray(8, inputOffset).equals(id) ||
      `sha256:${program.subarray(inputOffset, fixedPrefixBytes).toString('hex')}` !== coreInputIdentity)
    throw new TypeError('r03-aot-object: compiled program identity differs from the checked Core or R04 packet');
  return compiledTableId;
}
