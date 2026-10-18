// SPDX-License-Identifier: MIT
// Source15 semantics were frozen as fb81e93a before any Product HIR call; no executable test imports.
import assert from 'node:assert/strict';
import { hash, copy, canonical, expectedTransport, expectedHir, hirSchemaHash } from './first-exception-core-source-oracle.mjs';
const bridge='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
/** @param {any} c @returns {any} */
function control(c) {
  if(c.name==='corpus30')return {...expectedTransport(c.origin),hir:expectedHir(c.origin)};
  const input=copy(c.input),identityInput=copy(input);
  identityInput.files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const inputIdentity=hash(canonical(identityInput));
  const payload={inputIdentity,files:identityInput.files.map(file=>({path:file.path,digest:hash(file.content),
    byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})),facts:copy(c.sourceFacts),exports:copy(c.sourceExports)};
  const request={family:'tsfg.exception-facts-request-candidate',version:1,schemaHash:bridge,input},requestText=canonical(request);
  const response={family:'tsfg.exception-facts-package-candidate',version:1,schemaHash:bridge,
    requestId:hash('tsfg.exception-facts.request.v1\0'+requestText),
    packageId:hash('tsfg.exception-facts.package.v1\0'+bridge+'\0'+canonical(payload)),payload},responseText=canonical(response);
  const sourceOrigin=copy(c.origin),snapshot={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+canonical({inputIdentity,sourceOrigin})),
    sourceOrigin,inputIdentity,identityInput,sources:[{path:'/src/main.ts',content:c.source.literal,hash:c.source.hash,
      length:c.source.length,positionUnit:'utf16'}],target:copy(input.target),facts:copy(c.sourceFacts),exports:copy(c.sourceExports),
    capture:{request:requestText,response:responseText}};
  return {requestText,responseText,snapshot,hir:{...copy(c.hirSemantics),snapshot:copy(snapshot),inputIdentity}};
}
/** @param {any} c @param {any} hir */
function originalIdentities(c,hir) {
  const entity=(kind,record)=>hash('tsfg.exception-hir-candidate.'+kind+'.v1\0'+hirSchemaHash+'\0'+canonical(record));
  const fn=hir.functions[0],root=fn.body,i32=hash('tsfg.type\0i32'),source={path:'/src/main.ts',digest:hir.sources[0].hash};
  const signature=entity('signature',{parameters:[i32],returnType:i32});
  assert.equal(signature,fn.signatureHash);assert.equal(entity('type',{kind:'callable',parameters:[i32],returnType:i32}),fn.type);
  const module=entity('module',{source,external:true});assert.equal(fn.module,module);assert.equal(hir.modules[0].id,module);
  assert.equal(entity('function',{module,parent:null,declaringScopePath:[],name:'entry',signatureHash:signature,range:fn.range}),fn.id);
  assert.equal(entity('scope',{ownerKind:'module',owner:module,path:[]}),fn.declaringScope);
  assert.equal(entity('binding',{ownerKind:'function',owner:fn.id,scopePath:[],role:'parameter',index:0}),fn.parameters[0]);
  const regions=[root];
  for(const statement of root.body) {
    if(statement.kind==='block')regions.push(statement.region);
    if(statement.kind==='try') {
      regions.push(statement.tryRegion);if(statement.catchClause)regions.push(statement.catchClause.region);
      if(statement.finallyRegion)regions.push(statement.finallyRegion);
    }
  }
  for(const region of regions)assert.equal(entity('scope',{ownerKind:'function',owner:fn.id,path:region.path}),region.scope);
  assert.equal(root.bindings[0].type,i32);assert.equal(fn.parameters[0],root.bindings[0].id);
  assert.equal(hir.exports[0].bindings[0].target,fn.id);assert.equal(hir.exports[0].module,module);
  if(c.name!=='corpus30')assert.ok(!hir.types.some(type=>type.kind==='unknown'),'logical Core carrier is needed even without HIR unknown');
}

// Oracle-only printer for the frozen literal graph; never parses or validates Product MLIR.
// UTF8 bytes, rather than JavaScript code units, determine the adopted private string syntax.
function quoted(value) {
  return '"' + Array.from(Buffer.from(value,'utf8'), byte => byte >= 32 && byte <= 126 && byte !== 34 && byte !== 92
    ? String.fromCharCode(byte) : '\\' + byte.toString(16).toUpperCase().padStart(2,'0')).join('') + '"';
}
/** @param {any} value @param {string} [key] @returns {string} */
function attribute(value, key = '') {
  if (typeof value === 'string') return quoted(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return value + ' : ' + (['version','event'].includes(key) ? 'i32' : 'i64');
  if (Array.isArray(value)) return '[' + value.map(child => attribute(child)).join(', ') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  return '{' + Object.entries(value).map(([name, child]) => name + ' = ' + attribute(child,name)).join(', ') + '}';
}
/** @param {any} cfg @returns {string} */
function printLiteralGraph(cfg) {
  const fn = cfg.module.functions[0], blocks = fn.blocks;
  const typed = values => values.map(value => value.name + ': ' + value.type).join(', ');
  const lines = ['module attributes ' + attribute(cfg.module.attributes) + ' {',
    '  func.func @' + quoted(fn.symbol) + '(' + typed(blocks[0].arguments) + ') -> ' + fn.resultType
      + ' attributes ' + attribute(fn.attributes) + ' {'];
  for (const block of blocks) {
    if (block.label !== null) lines.push('  ' + block.label + (block.arguments.length ? '(' + typed(block.arguments) + ')' : '') + ':');
    for (const op of block.operations) {
      if (op.opcode === 'cf.br') {
        assert.equal(op.successors.length,1);
        const successor = blocks.find(candidate => candidate.id === op.successors[0].block);
        assert.ok(successor && successor.label !== null);
        const args = op.operands.map(value => value.name + ' : ' + value.type).join(', ');
        lines.push('    cf.br ' + successor.label + (args ? '(' + args + ')' : '') + ' ' + attribute(op.attributes));
      } else {
        const result = op.results.length ? op.results.map(value => value.name).join(', ') + ' = ' : '';
        const outputType = op.results.length ? op.results[0].type : '()';
        lines.push('    ' + result + quoted(op.opcode) + '(' + op.operands.map(value => value.name).join(', ') + ') '
          + attribute(op.attributes) + ' : (' + op.operands.map(value => value.type).join(', ') + ') -> ' + outputType);
      }
    }
  }
  return lines.concat(['  }','}','']).join('\n');
}

export {control,originalIdentities,printLiteralGraph};
