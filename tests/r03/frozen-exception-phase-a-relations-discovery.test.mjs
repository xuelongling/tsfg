// SPDX-License-Identifier: MIT
// Independent relation discovery after the fresh official oracle was reviewed.
// These forged relation controls never claim new producer authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';

const literals = [
  {
    "name": "unicodeActualAstralControl",
    "source": "// 😀\r\nexport function entry(𝐀: i32): i32 {\r\n  try {\r\n    throw 𝐀;\r\n  } catch (caught) {\r\n    throw caught;\r\n  } finally {\r\n    const copied: i32 = 𝐀;\r\n  }\r\n}"
  },
  {
    "name": "unicodeBracedEscapeControl",
    "source": "// 😀\r\nexport function entry(\\u{1D400}: i32): i32 {\r\n  try {\r\n    throw \\u{1D400};\r\n  } catch (caught) {\r\n    throw caught;\r\n  } finally {\r\n    const copied: i32 = \\u{1D400};\r\n  }\r\n}"
  },
  {
    "name": "unicodeSurrogateEscapeCandidate",
    "source": "// 😀\r\nexport function entry(\\uD835\\uDC00: i32): i32 {\r\n  try {\r\n    throw \\uD835\\uDC00;\r\n  } catch (caught) {\r\n    throw caught;\r\n  } finally {\r\n    const copied: i32 = \\uD835\\uDC00;\r\n  }\r\n}"
  },
  {
    "name": "guardOriginalActualControl",
    "source": "// 😀\r\nexport function entry(value: i32): i32 {\r\n  try { throw value; } catch (caught) {\r\n    if (typeof caught === \"boolean\") { throw caught; }\r\n    throw caught;\r\n  }\r\n}"
  },
  {
    "name": "guardContradictionCandidate",
    "source": "// 😀\r\nexport function entry(value: i32): i32 {\r\n  try { throw value; } catch (caught) {\r\n    if (typeof caught === \"boolean\") {\r\n      if (typeof caught !== \"boolean\") { throw caught; }\r\n      throw caught;\r\n    }\r\n    throw caught;\r\n  }\r\n}"
  },
  {
    "name": "finallyGuardBeforeControl",
    "source": "// 😀\r\nexport function entry(value: i32): i32 {\r\n  try { throw value; } catch (caught) {\r\n    if (typeof caught !== \"boolean\") { throw value; }\r\n    try { } finally { }\r\n    throw caught;\r\n  }\r\n}"
  },
  {
    "name": "finallyGuardInsideCandidate",
    "source": "// 😀\r\nexport function entry(value: i32): i32 {\r\n  try { throw value; } catch (caught) {\r\n    try {\r\n      if (typeof caught !== \"boolean\") { throw value; }\r\n    } finally { }\r\n    throw caught;\r\n  }\r\n}"
  },
  {
    "name": "intrinsicUndefinedScriptDiscovery",
    "source": "// 😀\r\nfunction undefined(value: i32): i32 {\r\n  try {\r\n    throw value;\r\n  } catch (caught) {\r\n    throw caught;\r\n  } finally {\r\n    const copied: i32 = value;\r\n  }\r\n}"
  },
  {
    "name": "intrinsicUndefinedModuleControl",
    "source": "// 😀\r\nexport function undefined(value: i32): i32 {\r\n  try {\r\n    throw value;\r\n  } catch (caught) {\r\n    throw caught;\r\n  } finally {\r\n    const copied: i32 = value;\r\n  }\r\n}"
  },
  {
    "name": "intrinsicGlobalThisScriptDiscovery",
    "source": "// 😀\r\nfunction globalThis(value: i32): i32 {\r\n  try {\r\n    throw value;\r\n  } catch (caught) {\r\n    throw caught;\r\n  } finally {\r\n    const copied: i32 = value;\r\n  }\r\n}"
  },
  {
    "name": "intrinsicGlobalThisModuleControl",
    "source": "// 😀\r\nexport function globalThis(value: i32): i32 {\r\n  try {\r\n    throw value;\r\n  } catch (caught) {\r\n    throw caught;\r\n  } finally {\r\n    const copied: i32 = value;\r\n  }\r\n}"
  }
];

const schema = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') { assert.ok(value.isWellFormed()); return JSON.stringify(value); }
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
/** @param {any} value @param {number} start @param {number} end @param {number} length */
function shift(value, start, end, length) {
  const point = n => { if (n <= start) return n; assert.ok(n >= end, 'retained endpoint inside edit'); return n + length - (end-start); };
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (!Array.isArray(item) && Object.keys(item).length === 2 && Number.isInteger(item.start) && Number.isInteger(item.end)) {
      item.start = point(item.start); item.end = point(item.end); return;
    }
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
}
/** @param {any} value @param {string} before @param {string} after */
function rename(value, before, after) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value) && value.name === before) value.name = after;
  for (const child of Object.values(value)) rename(child,before,after);
}
/** @param {any} q @param {any} p @param {any} origin @param {string} source */
function seal(q,p,origin,source) {
  const root = q.input.files.find(file=>file.path===q.input.rootFile); root.content=source;
  if (Object.hasOwn(root,'sha256')) root.sha256=hash(source);
  const files=q.input.files.map(file=>({path:file.path,content:file.content})).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  p.payload.inputIdentity=hash(jcs({...q.input,files}));
  p.payload.files=files.map(file=>({path:file.path,digest:hash(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'}));
  const requestBytes=Buffer.from(jcs(q));
  p.requestId=hash('tsfg.exception-facts.request.v1\0'+requestBytes);
  p.packageId=hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload));
  const responseBytes=Buffer.from(jcs(p));
  return {requestBytes,responseBytes,origin:{...origin,requestSha256:hash(requestBytes),responseSha256:hash(responseBytes)}};
}
/** @param {string} directory */
async function base(directory) {
  const root=new URL('../fixtures/r03/m21-exception/'+directory+'/',import.meta.url);
  const buffers=await Promise.all(['request.json','response.json','origin.json'].map(name=>readFile(new URL(name,root))));
  const [q,p,o]=buffers.map(bytes=>JSON.parse(bytes.toString('utf8')));
  assert.equal(o.requestSha256,hash(buffers[0]));assert.equal(o.responseSha256,hash(buffers[1]));
  assert.equal(p.requestId,hash('tsfg.exception-facts.request.v1\0'+buffers[0]));
  assert.equal(p.packageId,hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload)));
  const result=await importCapturedFrontendResponse(buffers[0],buffers[1],o);
  assert.equal(result.status,'ok','unchanged actual captured control '+directory);validateFrontendSnapshot(result.snapshot);
  return {q,p,o,buffers,pins:buffers.map(hash)};
}
/** @param {any} seed @param {any} literal */
function unicode(seed,literal) {
  const q=clone(seed.q),p=clone(seed.p);
  let source=q.input.files.find(file=>file.path===q.input.rootFile).content;
  const replacement=literal.source.slice(literal.source.indexOf('entry(')+6,literal.source.indexOf(': i32'));
  const positions=[...source.matchAll(/value/g)].map(match=>match.index);assert.equal(positions.length,3);
  for (const at of positions.reverse()) {
    source=source.slice(0,at)+replacement+source.slice(at+5);shift(p.payload,at,at+5,replacement.length);
  }
  rename(p.payload,'value','𝐀');assert.equal(source,literal.source);
  return seal(q,p,seed.o,source);
}
/** @param {any} seed @param {any} literal */
function intrinsic(seed,literal) {
  const q=clone(seed.q),p=clone(seed.p);
  let source=q.input.files.find(file=>file.path===q.input.rootFile).content;
  const script=!literal.name.includes('Module');
  if (script) {
    const start=source.indexOf('export '),end=start+7;
    source=source.slice(0,start)+source.slice(end);p.payload.exports[0]={sourcePath:q.input.rootFile,external:false,bindings:[]};shift(p.payload,start,end,0);
  }
  const name=literal.name.includes('Undefined')?'undefined':'globalThis',start=source.indexOf('entry');
  source=source.slice(0,start)+name+source.slice(start+5);rename(p.payload,'entry',name);shift(p.payload,start,start+5,name.length);
  assert.equal(source,literal.source);return seal(q,p,seed.o,source);
}
/** @param {string} source @param {number} at @param {number} rawStart @param {string} name @param {string} id @param {string} type */
function thrown(source,at,rawStart,name,id,type) {
  const nameAt=source.indexOf(name,at+5),end=nameAt+name.length;
  assert.equal(source.slice(at,at+5),'throw');assert.equal(source[end],';');
  return {kind:'throw',range:{start:rawStart,end:end+1},expression:{kind:'reference',type,symbol:id,range:{start:at+5,end}}};
}
/** @param {string} source @param {number} at @param {number} close @param {string} operandType @param {string} operator @param {any[]} body */
function branch(source,at,close,operandType,operator,body) {
  const openParen=source.indexOf('(',at),typeofAt=source.indexOf('typeof',openParen),operandAt=source.indexOf('caught',typeofAt);
  const operatorAt=source.indexOf(operator,operandAt),tagAt=source.indexOf('"boolean"',operatorAt),tagEnd=tagAt+9;
  const closeParen=source.indexOf(')',tagEnd);
  assert.equal(source.slice(at,at+2),'if');assert.equal(source[close],'}');
  const block={kind:'block',range:{start:closeParen+1,end:close+1},...(body.length?{body}:{})};
  return {kind:'if',range:{start:at,end:close+1},condition:{kind:'type-test',type:'bool',operator,
    range:{start:openParen+1,end:tagEnd},operand:{kind:'reference',type:operandType,symbol:'s3',range:{start:typeofAt+6,end:operandAt+6}},
    typeTest:{tag:'boolean',typeofRange:{start:openParen+1,end:operandAt+6},tagRange:{start:operatorAt+3,end:tagEnd}}},thenBody:[block]};
}
/** @param {any} seed @param {any} literal @param {string} tailType */
function flow(seed,literal,tailType) {
  const q=clone(seed.q),p=clone(seed.p),source=literal.source;
  const fn=p.payload.facts.functions[0],oldTry=fn.body[0].exception.tryBlock;
  const catchClose=source.lastIndexOf('\r\n  }')+4,catchOpen=source.indexOf('{',source.indexOf('catch (caught)'));
  assert.equal(source[catchClose],'}');assert.equal(catchOpen,87);
  let body;
  if (literal.name==='guardContradictionCandidate') {
    const outer=source.indexOf('if (typeof caught ==='),inner=source.indexOf('if (typeof caught !==');
    const innerOpen=source.indexOf('{',inner),innerClose=source.indexOf('}',innerOpen);
    const innerThrow=thrown(source,source.indexOf('throw caught;',innerOpen),innerOpen+1,'caught','s3','unknown');
    const innerIf=branch(source,inner,innerClose,'bool','!==',[innerThrow]);
    const outerClose=source.indexOf('\r\n    }',innerClose)+6;
    const outerThrow=thrown(source,source.indexOf('throw caught;',innerClose),innerClose+1,'caught','s3','bool');
    const outerIf=branch(source,outer,outerClose,'unknown','===',[innerIf,outerThrow]);
    const last=thrown(source,source.lastIndexOf('throw caught;'),outerClose+1,'caught','s3','unknown');
    body=[outerIf,last];
  } else {
    const at=source.indexOf('if (typeof caught !=='),guardOpen=source.indexOf('{',at),guardClose=source.indexOf('}',guardOpen);
    const guardThrow=thrown(source,source.indexOf('throw value;',guardOpen),guardOpen+1,'value','s2','i32');
    const guard=branch(source,at,guardClose,'unknown','!==',[guardThrow]);
    const attempted=source.indexOf('try',source.indexOf('catch (caught)')),finallyAt=source.indexOf('finally',attempted);
    const tryClose=source.lastIndexOf('}',finallyAt),finalOpen=source.indexOf('{',finallyAt),finalClose=source.indexOf('}',finalOpen);
    const inside=literal.name==='finallyGuardInsideCandidate';
    const region={kind:'try',range:{start:inside?catchOpen+1:guardClose+1,end:finalClose+1},exception:{
      tryBlock:{range:{start:attempted+3,end:tryClose+1},body:inside?[guard]:[]},
      finallyBlock:{range:{start:finallyAt+7,end:finalClose+1},body:[]}}};
    const last=thrown(source,source.lastIndexOf('throw caught;'),finalClose+1,'caught','s3',tailType);
    body=inside?[region,last]:[guard,region,last];
  }
  fn.range={start:0,end:source.length};
  fn.body=[{kind:'try',range:{start:47,end:catchClose+1},exception:{tryBlock:oldTry,catchClause:{
    binding:clone(p.payload.facts.symbols[2]),declarationRange:{start:79,end:85},range:{start:71,end:catchClose+1},
    block:{range:{start:86,end:catchClose+1},body}}}}];
  p.payload.exports[0].bindings[0].range=clone(fn.range);
  return seal(q,p,seed.o,source);
}

test('phase A repaired relation discovery; freeze flow expectations only after official flags',async t=>{
  const first=await base('first'),guard=await base('corpus/07');
  for (const literal of literals.filter(item=>item.name!=='guardOriginalActualControl')) await t.test(literal.name,async()=>{
    let frames;
    if (literal.name.startsWith('unicode')) frames=unicode(first,literal);
    else if (literal.name.startsWith('intrinsic')) frames=intrinsic(first,literal);
    else frames=flow(guard,literal,'bool');
    const p=JSON.parse(frames.responseBytes.toString('utf8'));
    assert.equal(frames.origin.requestSha256,hash(frames.requestBytes));assert.equal(frames.origin.responseSha256,hash(frames.responseBytes));
    assert.equal(p.requestId,hash('tsfg.exception-facts.request.v1\0'+frames.requestBytes));
    assert.equal(p.packageId,hash('tsfg.exception-facts.package.v1\0'+schema+'\0'+jcs(p.payload)));
    const before=[hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)];
    const result=await importCapturedFrontendResponse(frames.requestBytes,frames.responseBytes,frames.origin);
    if (result.status==='error') assert.notEqual(result.diagnostics?.[0]?.code,'r03-exception-identity','repaired candidate must not fail identity');
    else validateFrontendSnapshot(result.snapshot);
    // Discovery only: no inferred never/bool expectation is asserted here.
    // Root must first freeze occurrence flags from the independent Go oracle.
    t.diagnostic(JSON.stringify({name:literal.name,status:result.status,diagnostics:result.diagnostics??[],
      requestBase64:frames.requestBytes.toString('base64'),responseBase64:frames.responseBytes.toString('base64'),origin:frames.origin}));
    assert.deepEqual([hash(frames.requestBytes),hash(frames.responseBytes),jcs(frames.origin)],before);
  });
  assert.deepEqual(first.buffers.map(hash),first.pins);assert.deepEqual(guard.buffers.map(hash),guard.pins);
});
