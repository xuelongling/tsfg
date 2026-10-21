// SPDX-License-Identifier: MIT
// Independent typed Core and complete R04 gold for all String operations,
// calls, CFG arguments and the original 64-parameter/512-function capacities.
import {createHash} from 'node:crypto';
import schema from '../../contracts/bytecode.schema.json' with {type:'json'};
import registry from '../../contracts/registry.json' with {type:'json'};
const hash=s=>createHash('sha256').update(s).digest('hex');
const names=['none','i32','bool','i8','i16','i64','u8','u16','u32','u64','isize','usize','f32','f64','string'];
const types=names.map((n,i)=>i===1?'i32':i===2?'i1':i===14?'!tsfg_string.string':'!tsfg_core.integer<"'+n+'">');
const path='/formal/string-program.ts',sourceHash=hash('x'.repeat(1000)),input=hash('independent all String operations Core fixture');
const anchor='tsfg_source.start = 1 : i64, tsfg_source.end = 99 : i64';
const instruction=(op,type,reg,payload=0,tail=[])=>({op,type,reg,payload,tail});
class Wire {
  parts=[];
  n(value,count) {const b=Buffer.alloc(count);if(count===8)b.writeBigUInt64LE(BigInt(value));else b.writeUIntLE(value,0,count);this.parts.push(b);}
  text(value) {const b=Buffer.from(value);this.n(b.length,4);this.parts.push(b);}
  digest(value) {this.parts.push(Buffer.from(value.replace(/^sha256:/,''),'hex'));}
  bytes() {return Buffer.concat(this.parts);}
}
function identity(name,params,result=14) {
  const signature=hash('tsfg.signature\0('+params.map(p=>names[p]).join(',')+')->'+names[result]);
  return {name,params,result,signature,id:hash('tsfg.function\0'+path+'\0'+name+'\0'+signature),type:hash('tsfg.type\0'+names[result])};
}
export function generalStringProgram(functionCount=3) {
  if(functionCount<3||functionCount>513)throw Error('fixture capacity');
  const worker=identity('worker',[14,11,11]);
  const entry=identity('entry',[]);
  const wide=identity('wide',Array(64).fill(14));
  const fuel=instruction(26,0,0,1);
  worker.registers=13;
  worker.blocks=[
    {args:[[0,14],[1,11],[2,11]],ops:[fuel,instruction(34,14,3,0),instruction(35,14,4,3<<16),
      instruction(36,11,5,0),instruction(37,7,6,1<<16),instruction(38,14,7,1<<16,[2]),
      instruction(39,1,8,0),instruction(3,2,9,1),instruction(25,2,9,1|(2<<16),[1,7,1,4])]},
    {args:[[10,14]],ops:[instruction(24,0,0,3,[1,10])]},
    {args:[[11,14]],ops:[instruction(24,0,0,3,[1,11])]},
    {args:[[12,14]],ops:[instruction(2,14,12)]},
  ];
  entry.registers=4;entry.blocks=[{args:[],ops:[fuel,instruction(34,14,0,5,[65,0,0xd83d,0xde00,0xd800]),
    instruction(28,11,1,0,[0]),instruction(28,11,2,0,[5]),instruction(27,14,3,0,[3,0,1,2]),instruction(2,14,3)]}];
  const wideShape=fn=>{fn.registers=64;fn.blocks=[{args:fn.params.map((t,r)=>[r,t]),ops:[fuel,instruction(2,14,63)]}];return fn;};
  const functions=[worker,entry,wideShape(wide)];
  for(let i=3;i<functionCount;i++)functions.push(wideShape(identity('wide'+i,Array(64).fill(14))));
  const metadata=fn=>'tsfg_core.function_id = "sha256:'+fn.id+'", tsfg_core.signature_hash = "sha256:'+fn.signature
    +'", tsfg_core.type_id = "sha256:'+fn.type+'", tsfg_core.function_start = 1 : i64, tsfg_core.function_end = 99 : i64';
  const op=(name,args,operandTypes,type,extra='')=>'    '+(type?'%v'+args.shift()+' = ':'')+'"'+name+'"('
    +args.map(r=>'%v'+r).join(', ')+') {'+(extra?extra+', ':'')+anchor+'} : ('+operandTypes.map(t=>types[t]).join(', ')+') -> '+(type?types[type]:'()');
  const body=[
    '  func.func @"worker"(%v0: '+types[14]+', %v1: '+types[11]+', %v2: '+types[11]+') -> '+types[14]+' attributes {'+metadata(worker)+'} {',
    op('tsfg_core.fuel',[],[],0,'event = 1 : i32'),op('tsfg_string.constant',[3],[],14,'code_units = array<i32>'),
    op('tsfg_string.concat',[4,0,3],[14,14],14),op('tsfg_string.length',[5,0],[14],11),
    op('tsfg_string.codeunit',[6,0,1],[14,11],7),op('tsfg_string.slice',[7,0,1,2],[14,11,11],14),
    op('tsfg_string.compare',[8,0,0],[14,14],1),op('tsfg_core.constant',[9],[],2,'value = true'),
    '    cf.cond_br %v9, ^bb1(%v7 : '+types[14]+'), ^bb2(%v4 : '+types[14]+') {'+anchor+'}',
    '  ^bb1(%v10: '+types[14]+'):', '    cf.br ^bb3(%v10 : '+types[14]+') {'+anchor+'}',
    '  ^bb2(%v11: '+types[14]+'):', '    cf.br ^bb3(%v11 : '+types[14]+') {'+anchor+'}',
    '  ^bb3(%v12: '+types[14]+'):',op('func.return',[12],[14],0),'  }',
    '  func.func @"entry"() -> '+types[14]+' attributes {'+metadata(entry)+'} {',
    op('tsfg_core.fuel',[],[],0,'event = 1 : i32'),op('tsfg_string.constant',[0],[],14,'code_units = array<i32: 65, 0, 55357, 56832, 55296>'),
    op('tsfg_core.constant',[1],[],11,'value = "0"'),op('tsfg_core.constant',[2],[],11,'value = "5"'),
    op('func.call',[3,0,1,2],[14,11,11],14,'callee = @"worker", tsfg_core.function_id = "sha256:'+worker.id+'", tsfg_core.signature_hash = "sha256:'+worker.signature+'"'),
    op('func.return',[3],[14],0),'  }',
  ];
  for(const fn of functions.slice(2))body.push('  func.func @"'+fn.name+'"('+fn.params.map((t,r)=>'%v'+r+': '+types[t]).join(', ')+') -> '+types[14]+' attributes {'+metadata(fn)+'} {',
    op('tsfg_core.fuel',[],[],0,'event = 1 : i32'),op('func.return',[63],[14],0),'  }');
  const attrs={version:'0.11.0',input_identity:'sha256:'+input,source_hash:'sha256:'+sourceHash,source_path:path,
    target:schema.target.target,triple:schema.target.triple,data_layout:schema.target.llvmDataLayout,bytecode_schema:registry['tsfg.bytecode'].schemaHash};
  const core='module attributes {'+Object.entries(attrs).map(([k,v])=>'tsfg_core.'+k+' = '+JSON.stringify(v)).join(', ')+', tsfg_core.source_length = 1000 : i64} {\n'+body.join('\n')+'\n}\n';
  const p=new Wire();p.text(schema.target.target);p.text(schema.target.triple);p.text(schema.target.llvmDataLayout);
  for(const n of [4,4,64,8])p.n(n,2);p.n(119,4);p.digest(input);p.digest(sourceHash);p.text(path);p.n(1000,4);p.n(0,1);p.n(functions.length,2);
  for(const fn of functions) {
    for(const h of [fn.id,fn.signature,fn.type])p.digest(h);p.text(fn.name);p.n(1,4);p.n(99,4);p.n(fn.result,1);p.n(fn.params.length,1);
    for(const t of fn.params)p.n(t,1);p.n(fn.params.length,1);for(const t of fn.params)p.n(0,1);p.n(fn.registers,2);p.n(fn.blocks.length,2);p.n(fn.blocks.reduce((n,b)=>n+b.ops.length,0),2);
    for(const b of fn.blocks) {p.n(b.args.length,2);for(const [r,t]of b.args){p.n(r,2);p.n(t,1);p.n(0,1);}p.n(b.ops.length,2);}
    for(const b of fn.blocks)for(const i of b.ops) {
      p.n(i.op,1);p.n(i.type,1);p.n(i.reg,2);p.n(i.payload,4);p.n(1,4);p.n(99,4);
      for(const n of i.tail)p.n(n,i.op===28?8:2);
    }
  }
  const payload=p.bytes(),header=new Wire();header.parts.push(Buffer.from('TSFGTBC0'));header.n(11,4);header.digest(registry['tsfg.bytecode'].schemaHash);
  header.n(80+payload.length,4);header.digest(hash(payload));header.parts.push(payload);
  return {core,packet:header.bytes(),functions};
}

export function globalStringProgram() {
  const moduleId=hash('tsfg.module\0'+path),globalId=hash('tsfg.global\0'+path+'\0text\0string');
  const initializer=identity('$moduleInit',[],1),entry=identity('entry',[]),setter=identity('set',[14]);
  initializer.id=hash('tsfg.module-initializer.v1\0'+path+'\0sha256:'+sourceHash+'\0sha256:'+moduleId+'\0sha256:'+initializer.signature);
  initializer.initializer=true;initializer.registers=2;initializer.blocks=[{args:[],ops:[
    instruction(34,14,0,3,[65,0,0xd800]),instruction(30,14,0,65536),instruction(1,1,1),instruction(2,1,1)]}];
  entry.registers=1;entry.blocks=[{args:[],ops:[instruction(26,0,0,1),instruction(29,14,0),instruction(2,14,0)]}];
  setter.registers=2;setter.blocks=[{args:[[0,14]],ops:[instruction(26,0,0,1),instruction(30,14,0),instruction(29,14,1),instruction(2,14,1)]}];
  const functions=[initializer,entry,setter],q=JSON.stringify;
  const attrs={version:'0.11.0',input_identity:'sha256:'+input,source_hash:'sha256:'+sourceHash,source_path:path,
    target:schema.target.target,triple:schema.target.triple,data_layout:schema.target.llvmDataLayout,bytecode_schema:registry['tsfg.bytecode'].schemaHash};
  const tables=[
    'tsfg_core.sources = [{path = '+q(path)+', hash = "sha256:'+sourceHash+'", length = 1000 : i64}]',
    'tsfg_core.modules = [{id = "sha256:'+moduleId+'", source = 0 : i64, initializer = 0 : i64, dependencies = []}]',
    'tsfg_core.globals = [{id = "sha256:'+globalId+'", source = 0 : i64, name = "text", binding_kind = "source", type = "sha256:'+entry.type+'", writable = true, start = 1 : i64, end = 99 : i64}]',
    'tsfg_core.hosts = []','tsfg_core.roots = [{kind = "application", source = 0 : i64, name = "entry", function = 1 : i64}]',
    'tsfg_core.initialization = [0 : i64]',
  ];
  const operation=(name,args,operandTypes,result,extra='')=>'    '+(result?'%v'+args.shift()+' = ':'')+'"'+name+'"('+args.map(r=>'%v'+r).join(', ')
    +') {'+(extra?extra+', ':'')+anchor+'} : ('+operandTypes.map(t=>types[t]).join(', ')+') -> '+(result?types[result]:'()');
  const bodies=[
    [operation('tsfg_string.constant',[0],[],14,'code_units = array<i32: 65, 0, 55296>'),operation('tsfg_core.global_store',[0],[14],0,'global = 0 : i64, initialize = true'),operation('tsfg_core.constant',[1],[],1,'value = 0 : i32'),operation('func.return',[1],[1],0)],
    [operation('tsfg_core.fuel',[],[],0,'event = 1 : i32'),operation('tsfg_core.global_load',[0],[],14,'global = 0 : i64'),operation('func.return',[0],[14],0)],
    [operation('tsfg_core.fuel',[],[],0,'event = 1 : i32'),operation('tsfg_core.global_store',[0],[14],0,'global = 0 : i64, initialize = false'),operation('tsfg_core.global_load',[1],[],14,'global = 0 : i64'),operation('func.return',[1],[14],0)],
  ];
  const core='module attributes {'+Object.entries(attrs).map(([k,v])=>'tsfg_core.'+k+' = '+q(v)).join(', ')+', tsfg_core.source_length = 1000 : i64, '+tables.join(', ')+'} {\n'
    +functions.map((fn,index)=>'  func.func @"f'+fn.id+'"('+fn.params.map((t,r)=>'%v'+r+': '+types[t]).join(', ')+') -> '+types[fn.result]+' attributes {'
      +'tsfg_core.function_id = "sha256:'+fn.id+'", tsfg_core.signature_hash = "sha256:'+fn.signature+'", tsfg_core.type_id = "sha256:'+fn.type+'", tsfg_core.function_start = '+(fn.initializer?0:1)+' : i64, tsfg_core.function_end = '+(fn.initializer?1000:99)+' : i64, tsfg_core.logical_name = '+q(fn.name)+', tsfg_core.source_index = 0 : i64, tsfg_core.initializer = '+!!fn.initializer+'} {\n'+bodies[index].join('\n')+'\n  }').join('\n')+'\n}\n';
  const p=new Wire();p.text(schema.target.target);p.text(schema.target.triple);p.text(schema.target.llvmDataLayout);
  for(const n of [4,4,64,8])p.n(n,2);p.n(119,4);p.digest(input);p.digest(sourceHash);p.text(path);p.n(1000,4);p.n(1,1);
  p.n(1,2);p.digest(sourceHash);p.text(path);p.n(1000,4);
  p.n(1,2);p.digest(moduleId);p.n(0,2);p.n(0,2);p.n(0,2);
  p.n(1,2);p.digest(globalId);p.n(0,2);p.text('text');p.n(14,1);p.n(1,1);p.n(1,4);p.n(99,4);
  p.n(0,2);p.n(1,2);p.n(0,1);p.n(0,2);p.text('entry');p.n(1,2);p.n(1,2);p.n(0,2);
  p.n(functions.length,2);
  for(const fn of functions) {
    p.n(0,2);p.n(fn.initializer?1:0,1);p.n(0,1);
    for(const h of [fn.id,fn.signature,fn.type])p.digest(h);p.text(fn.name);p.n(fn.initializer?0:1,4);p.n(fn.initializer?1000:99,4);p.n(fn.result,1);p.n(fn.params.length,1);
    for(const t of fn.params)p.n(t,1);p.n(fn.params.length,1);for(const t of fn.params)p.n(0,1);p.n(fn.registers,2);p.n(1,2);p.n(fn.blocks[0].ops.length,2);
    const b=fn.blocks[0];p.n(b.args.length,2);for(const[r,t]of b.args){p.n(r,2);p.n(t,1);p.n(0,1);}p.n(b.ops.length,2);
    for(const i of b.ops){p.n(i.op,1);p.n(i.type,1);p.n(i.reg,2);p.n(i.payload,4);p.n(1,4);p.n(99,4);for(const n of i.tail)p.n(n,2);}
  }
  const payload=p.bytes(),header=new Wire();header.parts.push(Buffer.from('TSFGTBC0'));header.n(11,4);header.digest(registry['tsfg.bytecode'].schemaHash);
  header.n(80+payload.length,4);header.digest(hash(payload));header.parts.push(payload);
  return {core,packet:header.bytes(),functions};
}
