// SPDX-License-Identifier: MIT
// Independent literal/concat wire oracle. This writer never evaluates String,
// parses Core, calls production SSA helpers, or invokes any execution consumer.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import registry from '../../contracts/registry.json' with { type: 'json' };
import schema from '../../contracts/bytecode.schema.json' with { type: 'json' };
const digest = value => createHash('sha256').update(value).digest();
class Bytes {
  chunks = [];
  put(value) { this.chunks.push(Buffer.from(value)); }
  integer(value, count) { const bytes=Buffer.alloc(count);bytes.writeUIntLE(value,0,count);this.put(bytes); }
  hash(value) { this.put(Buffer.from(value.slice(7),'hex')); }
  string(value) { const bytes=Buffer.from(value);this.integer(bytes.length,4);this.put(bytes); }
  done() { return Buffer.concat(this.chunks); }
}
export function stringCases() {
  const oracle = JSON.parse(readFileSync(new URL('./string-core-oracle.json', import.meta.url), 'utf8'));
  return oracle.cases.map(c => ({ name:c.name,
    hir:JSON.parse(readFileSync(new URL('./'+c.hirFile,import.meta.url), 'utf8')),
    context:{factsBytes:new Uint8Array(readFileSync(new URL('./'+c.factsFile,import.meta.url))),
      expectedPackageId:c.expectedPackageId,...(c.factsVersion===2?{factsVersion:2}:{})} }));
}
export function expectedStringPacket(hir) {
  const p=new Bytes();
  p.string(hir.target.target);p.string(hir.target.triple);p.string(hir.target.llvmDataLayout);
  for(const n of [4,4,64,8])p.integer(n,2);
  p.integer(51,4);p.hash(hir.inputIdentity);p.hash(hir.source.hash);p.string(hir.source.path);
  p.integer(hir.source.content.length,4);p.integer(0,1);p.integer(hir.functions.length,2);
  for(const fn of hir.functions) {
    const returned=fn.body[0],value=returned.value,concat=value.kind==='stringConcat';
    p.hash(fn.id);p.hash(fn.signatureHash);p.hash(fn.returnType.id);p.string(fn.name);
    p.integer(fn.range.start,4);p.integer(fn.range.end,4);p.integer(14,1);p.integer(0,1);
    p.integer(concat?3:1,2);p.integer(1,2);p.integer(concat?5:3,2);
    p.integer(0,2);p.integer(concat?5:3,2);
    const op=(opcode,type,reg,payload,range)=>{
      p.integer(opcode,1);p.integer(type,1);p.integer(reg,2);p.integer(payload,4);
      p.integer(range.start,4);p.integer(range.end,4);
    };
    op(26,0,0,1,fn.range);
    const literal=(expression,reg)=>{
      op(34,14,reg,expression.codeUnits.length,expression.range);
      for(const unit of expression.codeUnits)p.integer(unit,2);
    };
    if(concat) {literal(value.left,0);literal(value.right,1);op(35,14,2,65536,value.range);}
    else literal(value,0);
    op(2,14,concat?2:0,0,returned.range);
  }
  const payload=p.done(),header=new Bytes();header.put(Buffer.from('TSFGTBC0'));
  header.integer(10,4);header.hash(registry['tsfg.bytecode'].schemaHash);
  header.integer(payload.length+80,4);header.put(digest(payload));header.put(payload);
  return header.done();
}
export function expectedStringCore(hir) {
  const q=JSON.stringify,attrs={version:'0.10.0',input_identity:hir.inputIdentity,
    source_hash:hir.source.hash,source_path:hir.source.path,target:schema.target.target,
    triple:schema.target.triple,data_layout:schema.target.llvmDataLayout,bytecode_schema:registry['tsfg.bytecode'].schemaHash};
  const range=r=>'tsfg_source.start = '+r.start+' : i64, tsfg_source.end = '+r.end+' : i64';
  const functions=hir.functions.map(fn=>{
    const returned=fn.body[0],value=returned.value,concat=value.kind==='stringConcat';
    const lines=['    "tsfg_core.fuel"() {event = 1 : i32, '+range(fn.range)+'} : () -> ()'];
    const literal=(e,n)=>lines.push('    %v'+n+' = "tsfg_string.constant"() {code_units = array<i32'
      +(e.codeUnits.length?': '+e.codeUnits.join(', '):'')+'>, '+range(e.range)+'} : () -> !tsfg_string.string');
    if(concat) {literal(value.left,0);literal(value.right,1);
      lines.push('    %v2 = "tsfg_string.concat"(%v0, %v1) {tsfg_source.operator_start = '+value.operatorRange.start
        +' : i64, tsfg_source.operator_end = '+value.operatorRange.end+' : i64, '+range(value.range)
        +'} : (!tsfg_string.string, !tsfg_string.string) -> !tsfg_string.string');}
    else literal(value,0);
    lines.push('    "func.return"(%v'+(concat?2:0)+') {'+range(returned.range)+'} : (!tsfg_string.string) -> ()');
    return '  func.func @'+q(fn.name)+'() -> !tsfg_string.string attributes {tsfg_core.function_id = '+q(fn.id)
      +', tsfg_core.signature_hash = '+q(fn.signatureHash)+', tsfg_core.type_id = '+q(fn.returnType.id)
      +', tsfg_core.function_start = '+fn.range.start+' : i64, tsfg_core.function_end = '+fn.range.end+' : i64} {\n'+lines.join('\n')+'\n  }';
  });
  return 'module attributes {'+Object.entries(attrs).map(([k,v])=>'tsfg_core.'+k+' = '+q(v)).join(', ')
    +', tsfg_core.source_length = '+hir.source.content.length+' : i64} {\n'+functions.join('\n')+'\n}\n';
}
