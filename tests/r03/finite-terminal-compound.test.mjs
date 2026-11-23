// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,buildInitialArrayPublication,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {buildFiniteArrayReaching} from '../../compiler/finite-array-reaching.mjs';
import {canonical,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';

function deriveFactsBytes(packet,source) {
  const payload=packet.payload;
  source.sha256=sha256(source.content).slice(7);
  const {sourceRoot,rootFile,declarations,config}=payload;
  const files=payload.files.map(({path,sha256})=>({path,sha256}));
  for(const type of payload.types)if(type.nominalKey)type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({
    files,nominalKey:type.nominalKey}));
  const request={family:'tsfg.array-facts-request-candidate',version:8,input:{sourceRoot,rootFile,declarations,config,
    files:payload.files.map(({path,content,sha256})=>({path,content,sha256}))}};
  packet.requestId=sha256('tsfg.array-facts.request.v8\0'+canonical(request)+'\n');
  packet.packageId=sha256('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+canonical(payload));
  return Buffer.from(canonical(packet)+'\n');
}
function buildDerivedPacket(packet,source) {
  const factsBytes=deriveFactsBytes(packet,source),facts=readTypedArrayFacts(factsBytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
  const publication=buildInitialArrayPublication(context),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  return {hir:built.hir,context,publication};
}
function lowerDerivedPacket(packet,source) {
  const {hir,context,publication}=buildDerivedPacket(packet,source);
  return lowerFormalHir(hir,context,publication).split('\n');
}

async function retainedPacket(path,hash) {
  const bytes=await readFile(new URL('./testdata/'+path,import.meta.url));
  assert.equal(sha256(bytes),'sha256:'+hash);
  return structuredClone(readTypedArrayFacts(bytes));
}
const at=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const fieldTail='typed-array-terminal-compound/field-write-tail-old-value-present-package.json',
  fieldTailHash='22e3d52a15925f440446bd49b7ff7b9381d904c8c449b7e17f6c89069701f2c7';

test('finite numeric field compound reads the old field before computing its writeback',async()=>{
  const packet=await retainedPacket(fieldTail,fieldTailHash),payload=packet.payload;
  const fn=payload.functions.find(row=>row.name==='fieldPresent'),field=fn.body[4].value;
  const source=payload.files.find(row=>row.path===fn.sourcePath),{start,end}=field.operatorRange;
  // Derive a compound from the captured store without moving any source spans.
  assert.equal(source.content.slice(start,end+1),'= ');
  source.content=source.content.slice(0,start)+'+='+source.content.slice(end+1);
  field.operator='+=';
  field.operatorRange.end++;
  const lines=lowerDerivedPacket(packet,source);
  const read=lines.find(line=>line.includes('"tsfg_core.domain.field_read"')&&line.includes(at(field.target.range)));
  assert.ok(read,'compound must read the old field at its target span');
  const store=lines.find(line=>line.includes('"tsfg_core.domain.field_store"')&&line.includes(at(field.range)));
  const add=lines.find(line=>line.includes('"tsfg_core.add"')&&line.includes(at(field.range)));
  const rhs=lines.find(line=>line.includes('"tsfg_core.constant"')&&line.includes(at(field.value.range)));
  assert.ok(store&&add&&rhs);
  assert.ok(lines.indexOf(read)<lines.indexOf(rhs)&&lines.indexOf(rhs)<lines.indexOf(add)&&lines.indexOf(add)<lines.indexOf(store));
  const [,old,receiver]=read.match(/(%v\d+) = "tsfg_core\.domain\.field_read"\((%v\d+)\)/u)??[];
  const [,next]=add.match(/(%v\d+) = /u)??[],[,right]=rhs.match(/(%v\d+) = /u)??[];
  assert.ok(old&&receiver&&next&&right);
  assert.ok(add.includes(`(${old}, ${right})`));
  const writeView=lines.find(line=>line.includes(`"tsfg_core.domain.view"(${next})`));
  const [,stored]=writeView?.match(/(%v\d+) = /u)??[];
  assert.ok(stored&&store.includes(`(${receiver}, ${stored})`));
  assert.match(store,/input_node = "[^"]+\/writeback\/value"/u);
  const tail=lines.find(line=>line.includes('"tsfg_core.domain.field_read"')&&line.includes(at(fn.body.at(-1).value.range)));
  assert.ok(tail?.includes('/writeback/field-version/'));
});

test('finite numeric field prefix and postfix return the correct side of the writeback',async()=>{
  for(const prefix of [false,true])for(const [operator,arithmetic] of [['++','add'],['--','sub']]){
    const packet=await retainedPacket(fieldTail,fieldTailHash),payload=packet.payload;
    const fn=payload.functions.find(row=>row.name==='fieldPresent'),returned=fn.body.at(-1),read=returned.value;
    const source=payload.files.find(row=>row.path===fn.sourcePath),{start,end}=read.range;
    assert.equal(source.content.slice(start,end+2),'box.n;\n');
    // Closing brace supplies ASI, leaving every surrounding origin and signature intact.
    source.content=source.content.slice(0,start)+(prefix?operator+'box.n':'box.n'+operator)+source.content.slice(end+2);
    const shift=range=>({start:range.start+(prefix?2:0),end:range.end+(prefix?2:0)});
    const range={start,end:end+2},begin=prefix?start:end;
    returned.range.end=range.end;
    returned.value={kind:'fieldUpdate',type:read.type,flowType:read.flowType,range,operator,prefix,
      operatorRange:{start:begin,end:begin+2},target:{kind:'fieldTarget',type:read.type,property:read.property,
        range:shift(read.range),nameRange:shift(read.nameRange),receiver:{...read.receiver,range:shift(read.receiver.range)}}};

    const lines=lowerDerivedPacket(packet,source);
    const oldLine=lines.find(line=>line.includes('"tsfg_core.domain.field_read"')&&line.includes(at(returned.value.target.range)));
    const unit=lines.find(line=>line.includes('"tsfg_core.constant"')&&line.includes(at(range)));
    const calculate=lines.find(line=>line.includes(`"tsfg_core.${arithmetic}"`)&&line.includes(at(range)));
    const store=lines.find(line=>line.includes('"tsfg_core.domain.field_store"')&&line.includes(at(range)));
    assert.ok(oldLine&&unit&&calculate&&store);
    assert.match(unit,/value = "3ff0000000000000".* -> f64$/u);
    const [,old,receiver]=oldLine.match(/(%v\d+) = "tsfg_core\.domain\.field_read"\((%v\d+)\)/u)??[];
    const [,one]=unit.match(/(%v\d+) = /u)??[],[,next]=calculate.match(/(%v\d+) = /u)??[];
    assert.ok(old&&receiver&&one&&next);
    assert.ok(calculate.includes(`(${old}, ${one})`));
    const write=lines.find(line=>line.includes(`"tsfg_core.domain.view"(${next})`));
    const [,stored]=write?.match(/(%v\d+) = /u)??[];
    assert.ok(stored&&store.includes(`(${receiver}, ${stored})`));
    const result=lines.find(line=>line.includes(`"func.return"(${prefix?next:old})`)&&
      line.includes(at(returned.range))&&line.endsWith(': (f64) -> ()'));
    assert.ok(result);
    const operations=[oldLine,unit,calculate,write,store,result].map(line=>lines.indexOf(line));
    assert.ok(operations.every((position,index)=>index===0||position>operations[index-1]));
  }
});

test('finite integer field bitwise and shift compounds keep typed old-read and writeback operands',async()=>{
  for(const {operator,operation} of [{operator:'&=',operation:'and'},{operator:'<<=',operation:'shl'}]){
    const packet=await retainedPacket('typed-array-reference-domain/super-live-f32-package.json',
      'c2f9eb86e1b45b421c851ca8ad7ab9e39fbd190008c8bf5aec6c57821e7cb1df'),payload=packet.payload;
    const derived=payload.types.find(row=>row.name==='Derived'),ctor=derived.constructor;
    const field=ctor.body[0].else.at(-1).value,source=payload.files.find(row=>row.path===ctor.sourcePath);
    const start=field.target.range.end,end=field.value.range.start;
    assert.equal(source.content.slice(start,end),' = ');
    source.content=source.content.slice(0,start)+operator.padEnd(end-start)+source.content.slice(end);
    field.operator=operator;field.operatorRange={start,end:start+operator.length};

    const lines=lowerDerivedPacket(packet,source);
    const oldLine=lines.find(line=>line.includes('"tsfg_core.domain.field_read"')&&line.includes(at(field.target.range)));
    const operationLine=lines.find(line=>line.includes(`"tsfg_core.${operation}"`)&&line.includes(at(field.range)));
    const store=lines.find(line=>line.includes('"tsfg_core.domain.field_store"')&&line.includes(at(field.range)));
    assert.ok(oldLine&&operationLine&&store);
    const [,old,receiver]=oldLine.match(/(%v\d+) = "tsfg_core\.domain\.field_read"\((%v\d+)\)/u)??[];
    const [,next]=operationLine.match(/(%v\d+) = /u)??[];
    assert.ok(old&&receiver&&next);
    assert.ok(operationLine.includes(`(${old}, `));
    assert.match(operationLine,/\(i32, i32\) -> i32$/u);
    const write=lines.find(line=>line.includes(`"tsfg_core.domain.view"(${next})`));
    const [,stored]=write?.match(/(%v\d+) = /u)??[];
    assert.ok(stored&&store.includes(`(${receiver}, ${stored})`));
    assert.ok(lines.indexOf(oldLine)<lines.indexOf(operationLine)&&lines.indexOf(operationLine)<lines.indexOf(store));
  }
});

test('finite field update stops the following Array read when its receiver fails',async()=>{
  const packet=await retainedPacket(
    'typed-array-source514/a72e067ed8bbbeb893ed9c082a28a7f15b27cbca23bfb4640e60b66763806d95-package.json',
    '506b3a554cb9c67bb68f212506d4d3e336ace1a6149d66e9d406450d946d7c97');
  const factsBytes=Buffer.from(canonical(packet)+'\n'),facts=readTypedArrayFacts(factsBytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:facts.packageId};
  const publication=buildInitialArrayPublication(context),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built,fn=hir.functions.find(row=>row.name==='f'),returned=fn.body[0],captured=returned.value.receiver;
  assert.equal(captured.kind,'arrayReadChecked');
  const field=hir.types.find(row=>row.id===captured.type).fields.find(row=>row.name==='x');
  assert.equal(field.type,scalarTypeIds.i32);

  // Model a known-empty Array at the retained checked receiver and use its
  // declared writable i32 field. The inserted expressions exercise Array reaching.
  const receiver={...captured,receiver:{kind:'arrayCreate',type:captured.receiver.type,elements:[],range:captured.receiver.range},
    index:{kind:'constant',type:captured.index.type,decimal:'0',range:captured.index.range}};
  const update={kind:'fieldUpdate',type:field.type,operator:'++',prefix:false,range:receiver.range,
    target:{kind:'fieldTarget',type:field.type,property:field.id,receiver,range:receiver.range}};
  const stmt=expression=>({kind:'expression',expression,range:expression.range});
  const model={...hir,functions:hir.functions.map(row=>row===fn?{...row,body:[stmt(update),stmt(receiver),returned]}:row)};
  const {reaching}=buildFiniteArrayReaching(model,{nodes:[],domains:[],calls:[]},()=>{},()=>true);
  const at=path=>reaching.reads.find(row=>row.node===fn.id+path)?.status;
  assert.equal(at('/body/0/expression/target/receiver'),'missing');
  assert.equal(at('/body/1/expression'),'pending');
});

function replaceArrayCompoundOperator(source,compound,operator) {
  const start=compound.target.range.end,end=compound.value.range.start;
  assert.equal(source.content.slice(start,end),' += ');
  source.content=source.content.slice(0,start)+operator.padEnd(end-start)+source.content.slice(end);
  compound.operator=operator;compound.operatorRange={start,end:start+operator.length};
}

test('finite Array compounds reject unsupported scalar operators before publishing Core',async()=>{
  for(const operator of ['&=','<<=','&&=']){
    const packet=await retainedPacket(fieldTail,fieldTailHash),payload=packet.payload;
    const fn=payload.functions.find(row=>row.name==='fieldPresent'),compound=fn.body[3].value;
    const source=payload.files.find(row=>row.path===fn.sourcePath);
    replaceArrayCompoundOperator(source,compound,operator);
    assert.throws(()=>lowerDerivedPacket(packet,source),error=>{
      assert.ok(error instanceof Error&&'code' in error&&'primary' in error);
      assert.equal(error.code,'r03-finite-core-capability');
      assert.match(error.message,/operation-domain-check mapping/u);
      assert.deepEqual(error.primary,compound.range);
      return true;
    });
  }
});

test('finite i32 Array compounds evaluate receiver and index once before old read and RHS',async()=>{
  for(const [operator,operation] of [['&=','and'],['<<=','shl']]){
    const packet=await retainedPacket(
      'typed-array-actual-v8/f2c9d4e124c4cc6331012390387c1e803adf0c4707ef653d9de4303066d75954-package.json',
      '0176e257c9240e2f61d1d86728aad3bf248a31fc6d96ae2c4ac30063cb8cb6e3');
    const payload=packet.payload,fn=payload.functions.find(row=>row.name==='update'),compound=fn.body[0].value;
    const source=payload.files.find(row=>row.path===fn.sourcePath);
    replaceArrayCompoundOperator(source,compound,operator);
    const lines=lowerDerivedPacket(packet,source);
    const operationAt=(kind,range)=>{
      const matches=lines.filter(line=>line.includes('"'+kind+'"')&&line.includes(at(range)));
      assert.equal(matches.length,1);
      return matches[0];
    };
    const receiver=operationAt('func.call',compound.target.receiver.range);
    const index=operationAt('func.call',compound.target.index.range);
    const old=operationAt('tsfg_core.domain.array_read',compound.target.range);
    const rhs=operationAt('func.call',compound.value.range);
    const arithmetic=operationAt('tsfg_core.'+operation,compound.range);
    const store=operationAt('tsfg_core.domain.array_store',compound.range);
    const returned=operationAt('func.return',fn.body[0].range);
    const result=line=>line.trim().split(' = ')[0];
    assert.ok(old.includes(`(${result(receiver)}, ${result(index)})`));
    assert.ok(arithmetic.includes(`(${result(old)}, ${result(rhs)})`));
    assert.match(arithmetic,/\(i32, i32\) -> i32$/u);
    assert.ok(store.includes(`(${result(receiver)}, ${result(index)}, ${result(arithmetic)})`));
    assert.ok(returned.includes(`(${result(arithmetic)})`));
    const positions=[receiver,index,old,rhs,arithmetic,store,returned].map(line=>lines.indexOf(line));
    assert.ok(positions.every((position,i)=>i===0||position>positions[i-1]));
  }
});

const narrowArray='typed-array-entry/87d0326f6f0e3e1eb887a77b7eb207a938c3ca173f094f8cdb21f1820284a4ad-package.json',
  narrowArrayHash='042eee481c55e941ee47e8ebe284feff0d16621cf37f60c3615d3b247eb9d051';
function arrayCoalesceAt(file,assignment) {
  const start=assignment.operatorRange.start,end=assignment.range.end;
  file.content=file.content.slice(0,start)+'??=2'.padEnd(end-start)+file.content.slice(end);
  Object.assign(assignment,{kind:'elementCompoundAssignment',operator:'??=',operatorRange:{start,end:start+3},
    range:{start:assignment.range.start,end:start+4},
    value:{kind:'numericLiteral',type:'i32',flowType:'i32',token:'2',decimal:'2',range:{start:start+3,end:start+4}}});
}
test('finite Array nullish assignment updates only the existing undefined slot version',async()=>{
  for(const present of [false,true]){
    const packet=await retainedPacket(narrowArray,narrowArrayHash),fn=packet.payload.functions[0];
    const file=packet.payload.files.find(row=>row.path===fn.sourcePath);
    const previous=fn.body[2].value,coalesce=fn.body[4].value;
    assert.equal(file.content.slice(coalesce.operatorRange.start,coalesce.range.end),'=copied');
    if(present){
      const {start,end}=previous.value.range;
      assert.equal(file.content.slice(start,end),'undefined');
      file.content=file.content.slice(0,start)+'1'.padEnd(end-start)+file.content.slice(end);
      previous.flowType='i32';previous.range.end=start+1;
      previous.value={kind:'numericLiteral',type:'i32',flowType:'i32',token:'1',decimal:'1',range:{start,end:start+1}};
    }
    arrayCoalesceAt(file,coalesce);
    const {hir,context,publication}=buildDerivedPacket(packet,file),id=hir.functions[0].id;
    const plan=buildFiniteCoreDomains(hir,context,{publicationContext:publication}).reached;
    const memory=id+'/body/4/expression',prior=id+'/body/2/expression/value';
    const old=plan.arrayReaching.reads.find(row=>row.node===memory+'/old-value');
    const tail=plan.arrayReaching.reads.find(row=>row.node===id+'/body/5/value');
    assert.equal(old.status,'proven');
    assert.deepEqual(old.sources,[prior]);
    assert.deepEqual(tail.sources,[present?prior:memory+'/value']);
    const actual=node=>plan.domains.find(row=>row.id===plan.nodes.find(item=>item.id===node).domainId).actualTypes;
    assert.deepEqual(actual(old.node),[present?scalarTypeIds.i32:sha256('tsfg.type\0undefined')]);
    assert.deepEqual(actual(tail.node),[scalarTypeIds.i32]);
    const lines=lowerFormalHir(hir,context,publication).split('\n');
    const oldReads=lines.filter(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes(at(coalesce.target.range)));
    const stores=lines.filter(line=>line.includes('"tsfg_core.domain.array_store"')&&line.includes(at(coalesce.range)));
    const rhs=lines.filter(line=>line.includes('"tsfg_core.constant"')&&line.includes(at(coalesce.value.range)));
    assert.equal(oldReads.length,1);
    assert.equal(stores.length,present?0:1);
    assert.equal(rhs.length,present?0:1);
    if(!present){
      const [,slot]=oldReads[0].match(/"tsfg_core\.domain\.array_read"\(([^)]*)\)/u)??[];
      const stored=rhs[0].trim().split(' = ')[0];
      assert.ok(stores[0].includes(`(${slot}, ${stored})`));
      assert.ok(lines.indexOf(oldReads[0])<lines.indexOf(rhs[0])&&lines.indexOf(rhs[0])<lines.indexOf(stores[0]));
      assert.ok(stores[0].includes(memory+'/value'));
    }
  }
});

test('finite facts reject nullish assignment to a nonnumeric Array element role',async()=>{
  const packet=await retainedPacket(narrowArray,narrowArrayHash),fn=packet.payload.functions[0],assignment=fn.body[2].value;
  const file=packet.payload.files.find(row=>row.path===fn.sourcePath);
  arrayCoalesceAt(file,assignment);
  assignment.flowType=assignment.target.type;
  assert.throws(()=>readTypedArrayFacts(deriveFactsBytes(packet,file)),error=>{
    assert.ok(error instanceof Error&&'code' in error&&'primary' in error);
    assert.equal(error.code,'r03-typed-array-type');
    assert.deepEqual(error.primary,{sourceId:fn.sourcePath,...assignment.range});
    return true;
  });
});

test('a missing old Array slot stops nullish assignment before RHS',async()=>{
  const packet=await retainedPacket('typed-array-terminal-compound/old-value-terminal-package.json',
    '6a33970814041f757694f14cb3750e8553593de9cf4f77bef2aefa75c150aaca');
  const payload=packet.payload,fn=payload.functions.find(row=>row.name==='compound'),compound=fn.body[2].value;
  const file=payload.files.find(row=>row.path===fn.sourcePath);
  replaceArrayCompoundOperator(file,compound,'??=');
  const {hir,context,publication}=buildDerivedPacket(packet,file),owner=hir.functions.find(row=>row.name==='compound');
  const plan=buildFiniteCoreDomains(hir,context,{publicationContext:publication}).reached;
  const node=owner.id+'/body/2/expression';
  const old=plan.arrayReaching.reads.find(row=>row.node===node+'/old-value');
  assert.equal(old.status,'missing');
  const actual=path=>plan.domains.find(row=>row.id===plan.nodes.find(item=>item.id===path).domainId).actualTypes;
  assert.deepEqual(actual(node+'/value'),[]);
  assert.deepEqual(actual(node),[]);
  const lines=lowerFormalHir(hir,context,publication).split('\n');
  const read=lines.findIndex(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes(at(compound.target.range)));
  const rhs=lines.findIndex(line=>line.includes('"func.call"')&&line.includes(at(compound.value.range)));
  assert.ok(read>=0);
  assert.equal(rhs,-1);
});

test('finite Array postfix returns the checked old i32 and stores the increment',async()=>{
  const packet=await retainedPacket(
    'typed-array-actual-v8/1a80de3941d5c05dc0e4889e97267da169263bbfe70344e312cd0e74e964180d-package.json',
    '0e74c1456f6a7a922bf3d2d3525f2a69d834de08c8629d0bfb180ae01acad806');
  const payload=packet.payload,fn=payload.functions[0],update=fn.body[0].value;
  const lines=lowerDerivedPacket(packet,payload.files.find(row=>row.path===fn.sourcePath));
  const read=lines.find(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes(at(update.target.range)));
  const add=lines.find(line=>line.includes('"tsfg_core.add"')&&line.includes(at(update.range)));
  const store=lines.find(line=>line.includes('"tsfg_core.domain.array_store"')&&line.includes(at(update.range)));
  const returned=lines.find(line=>line.includes('"func.return"')&&line.includes(at(fn.body[0].range)));
  assert.ok(read&&add&&store&&returned);
  const [,old,slot]=read.match(/(%v\d+) = "tsfg_core\.domain\.array_read"\(([^)]*)\)/u)??[];
  const [,updated]=add.match(/(%v\d+) = /u)??[];
  assert.ok(old&&updated&&slot);
  assert.ok(add.includes(`(${old}, `));
  assert.ok(store.includes(`(${slot}, ${updated})`));
  assert.ok(returned.includes(`(${old})`));
});

/** @type {{name:string,fixture:string,sha:string,fn:string,position:string,range?:[number,number],binary?:'left'|'right',productive?:boolean}[]} */
const cases=[
  {name:'a terminal compound old read blocks the RHS sink write and the target writeback',
    fixture:'old-value-terminal',sha:'6a33970814041f757694f14cb3750e8553593de9cf4f77bef2aefa75c150aaca',fn:'compound',position:'expression'},
  {name:'a terminal compound initializer blocks its RHS, local binding and later return',
    fixture:'initializer-old-value-terminal',sha:'a9318de78658057189a4900d6ba7ffc0930a21f13a0b1a06ccb48696e8b6cd4e',fn:'nestedCompound',position:'initializer',range:[184,189]},
  {name:'a terminal compound return blocks the RHS and publishes no normal result',
    fixture:'return-old-value-terminal',sha:'75c966c303c6574b3443fd5a0b69c7aa4244baa8f34c80063cd27308cdd1f0b6',fn:'returnCompound',position:'value',range:[171,176]},
  {name:'a terminal grouped left operand blocks the compound RHS and the later binary sibling',
    fixture:'binary-left-old-value-terminal',sha:'c377fabaeaf36d7da6689fea9291f8445e0e28e2365bf2cf79ce0f6d09a59cef',fn:'binaryMissing',
    position:'initializer',range:[252,257],binary:'left'},
  {name:'a proved old value preserves both strict binary operands and their effects',
    fixture:'binary-left-old-value-present',sha:'4d733c5e739b0256d52e79fa7736fda4abd8b0990e8cdf4ddb43089408861436',fn:'binaryPresent',
    position:'initializer',range:[255,260],binary:'left',productive:true},
  {name:'a prior sink write preserves the terminal old read on the strict right',
    fixture:'binary-right-old-value-terminal',sha:'ae66cf006956a606f38e85da9eb99bff20c2d95d3f6b9cc4dec98819fc95a496',fn:'rightMissing',
    position:'initializer',range:[268,273],binary:'right'},
  {name:'a prior sink write preserves the initial old-value source on the strict right',
    fixture:'binary-right-old-value-present',sha:'5ad521e5a988cbccb3cad4ff12f22425121dee8c67e3019e9836587f005c2c23',fn:'rightPresent',
    position:'initializer',range:[271,276],binary:'right',productive:true},
];
for(const row of cases)test(row.name,async t=>{
  const bytes=await readFile(new URL('./testdata/typed-array-terminal-compound/'+row.fixture+'-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:'+row.sha);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=buildInitialArrayPublication(context),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const earlier=row.binary==='right';
  const {hir}=built,compound=hir.functions.find(fn=>fn.name===row.fn),mark=hir.functions.find(fn=>fn.name===(earlier?'rhs':'mark'));
  assert.ok(compound&&mark);
  const sibling=row.binary?hir.functions.find(fn=>fn.name===(earlier?'earlier':'later')):undefined;
  if(row.binary)assert.ok(sibling);
  const top=compound.id+'/body/2/'+row.position,target=top+(row.binary?'/'+row.binary+'/operand':''),old=target+'/old-value';
  const siblingNode=top+(earlier?'/left':'/right');
  const array=compound.id+'/body/0/initializer',elements=array+'/elements';
  const sink=mark.id+'/binding/'+mark.parameters[0].id,initial=array+'/initial/0/array-version';
  const bottom=sha256('tsfg.actual-domain.v1\0[]'),scalar=sha256('tsfg.actual-domain.v1\0'+canonical([compound.returnType.id]));
  const normalDomain=row.productive?scalar:bottom;
  const source=facts.payload.files.find(row=>row.path===compound.sourcePath).content;
  const proofs=buildFiniteCoreDomains(hir,context,{publicationContext:publication});
  for(const plan of [proofs.reached,proofs.definition]){
    assert.equal(plan.arrayReaching.reads.length,1);
    const [read]=plan.arrayReaching.reads;
    assert.deepEqual([read.node,read.owner,read.index,read.status,read.versions,read.sources],
      [old,array,'c:0',row.productive?'proven':'missing',row.productive?[initial]:[],row.productive?[elements+'/0']:[]]);
    assert.equal(source.slice(read.origin.start,read.origin.end),'a[at]');
    if(row.range)assert.deepEqual(read.origin,{source:'/src/main.ts',start:row.range[0],end:row.range[1]});
    const normal=[old,target,target+'/value',elements,compound.id+'/return'];
    if(row.binary)normal.push(top,top+'/'+row.binary);
    if(sibling&&!earlier)normal.push(siblingNode);
    if(row.position==='initializer'){
      const local=compound.body[2];
      assert.ok(local.kind==='local'&&local.binding.name==='result');
      normal.push(compound.id+'/binding/'+local.binding.id,compound.id+'/body/3/value');
    }
    if(earlier){
      const value=plan.nodes.find(node=>node.id===siblingNode);assert.ok(value);
      assert.deepEqual([value.domainId,value.arrayOwners,value.pending],[scalar,[],[]],siblingNode);
    }
    if((row.productive||earlier)&&plan===proofs.reached){
      const parameter=compound.parameters[0],binding=compound.id+'/binding/'+parameter.id;
      const owner=binding+'/entry-owner/'+parameter.type;
      const arguments_=[binding,siblingNode+'/arguments/0'];
      if(row.productive)arguments_.push(target+'/value/arguments/0');
      if(earlier&&sibling)arguments_.push(sibling.id+'/binding/'+sibling.parameters[0].id);
      for(const id of arguments_){
        const value=plan.nodes.find(node=>node.id===id);assert.ok(value);
        assert.deepEqual(value.arrayOwners,[owner],id);
      }
    }
    if(!row.productive&&plan===proofs.reached){
      normal.push(sink);
      if(sibling&&!earlier)normal.push(sibling.id+'/binding/'+sibling.parameters[0].id);
    }
    for(const id of normal){
      const value=plan.nodes.find(node=>node.id===id);assert.ok(value);
      assert.deepEqual([value.domainId,value.arrayOwners,value.pending],[normalDomain,[],[]],id);
    }
    assert.equal(plan.carrierNodes.find(row=>row.id===old).domainId,scalar);
    assert.equal(plan.carrierNodes.find(row=>row.id===elements).domainId,normalDomain);
    const writes=plan.arrayReaching.writes,versions=[mark.id+'/body/0/expression/array-version',target+'/array-version'];
    if(row.productive)versions.push(initial);
    if(sibling)versions.push(sibling.id+'/body/0/expression/array-version');
    assert.deepEqual(writes.map(row=>row.id).sort(),versions.sort());
    const rhsWrite=writes.find(row=>row.id.startsWith(mark.id));
    assert.equal(source.slice(rhsWrite.origin.start,rhsWrite.origin.end),earlier?'sink[1] = 9.0':'sink[0] = 7.0');
    if(sibling){
      const siblingWrite=writes.find(row=>row.id.startsWith(sibling.id));
      assert.equal(source.slice(siblingWrite.origin.start,siblingWrite.origin.end),earlier?'sink[0] = 7.0':'sink[1] = 9.0');
    }
  }

  if(row.binary==='left') {
    const local=compound.body[2],original=local.initializer,returned=compound.body[3];
    assert.equal(original.left.operand.kind,'arrayCompoundAssignment');
    const {receiver,index,type,range}=original.left.operand.target;
    // Component exercise using the same checked array operand and source range.
    const tail={kind:'arrayReadChecked',receiver,index,type,range};
    await t.test('a strict unary operand must complete before its following Array read',()=>{
      const initializer={kind:'unary',operator:'+',operand:original.left,type,range:original.left.range};
      const fn={...compound,body:[...compound.body.slice(0,2),{...local,initializer},{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const site=compound.id+'/body/2/initializer/operand/operand',old=site+'/old-value';
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
      const read=reaching.reads.find(read=>read.node===old);
      assert.equal(read?.status,row.productive?'proven':'missing');
      assert.equal(source.slice(read.origin.start,read.origin.end),'a[at]');
      const after=reaching.reads.find(read=>read.node===compound.id+'/body/3/value');
      assert.equal(after?.status,row.productive?'proven':'pending');
      assert.deepEqual(after?.versions,row.productive?[site+'/array-version']:[]);
      assert.ok(reaching.writes.some(write=>write.id===site+'/array-version'));
    });
    const compare={...original,operator:'===',type:scalarTypeIds.bool};
    const flag={kind:'boolean',value:true,type:scalarTypeIds.bool,range:original.range};
    for(const operator of ['&&','||','??']){
      const numeric=operator==='??',base=compound.id+'/body/2/expression';
      const expression={...original,kind:'shortCircuit',operator,left:numeric?original.left:compare,
        right:numeric?original.right:flag,type:numeric?type:scalarTypeIds.bool};
      const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const site=base+(numeric?'/left/operand':'/left/left/operand'),terminal=site+'/old-value';
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[terminal],operator);
      assert.equal(reaching.reads.find(read=>read.node===terminal)?.status,row.productive?'proven':'missing',operator);
      assert.equal(reaching.reads.find(read=>read.node===compound.id+'/body/3/value')?.status,row.productive?'proven':'pending',operator);
      assert.ok(reaching.writes.some(write=>write.id===site+'/array-version'),operator);
    }
    const sinkArgument=original.left.operand.value.arguments[0];
    const unknown={...compare,left:{kind:'arrayLength',receiver:sinkArgument,type:index.type,range:index.range},right:index};
    const base=compound.id+'/body/2/expression',site=base+'/right/left/operand',old=site+'/old-value';
    for(const operator of ['&&','||'])for(const route of ['required','skipped','possible'])
      await t.test(operator+' RHS '+route,()=>{
        const left=route==='possible'?unknown:{...flag,value:(operator==='&&')===(route==='required')};
        const expression={...original,kind:'shortCircuit',type:scalarTypeIds.bool,operator,left,right:compare};
        const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
        const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
        const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
        assert.deepEqual([...terminalReads??[]],route==='required'&&!row.productive?[old]:[]);
        const oldRead=reaching.reads.find(read=>read.node===old),after=reaching.reads.find(read=>read.node===compound.id+'/body/3/value');
        assert.equal(oldRead?.status,route==='skipped'?'pending':row.productive?'proven':'missing');
        assert.equal(after?.status,row.productive?'proven':route==='required'?'pending':'missing');
        if(row.productive)assert.deepEqual(after?.versions,
          (route==='required'?[site+'/array-version']:route==='skipped'?[initial]:[initial,site+'/array-version']).sort());
        for(const version of [site+'/array-version',mark.id+'/body/0/expression/array-version',sibling.id+'/body/0/expression/array-version'])
          assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
      });
    await t.test('a required if condition controls both arms and the suffix',()=>{
      const arm=[{kind:'expression',expression:tail,range:tail.range}];
      const branch={kind:'if',condition:compare,then:arm,else:arm,range:local.range};
      const fn={...compound,body:[...compound.body.slice(0,2),branch,{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',target=root+'/2/condition/left/operand',failed=target+'/old-value';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[failed]);
      const oldRead=reaching.reads.find(read=>read.node===failed);
      assert.equal(oldRead?.status,row.productive?'proven':'missing');
      assert.equal(source.slice(oldRead.origin.start,oldRead.origin.end),'a[at]');
      for(const path of ['/2/then/0/expression','/2/else/0/expression','/3/value']) {
        const read=reaching.reads.find(read=>read.node===root+path);
        assert.equal(read?.status,row.productive?'proven':'pending',path);
        assert.deepEqual(read?.versions,row.productive?[target+'/array-version']:[],path);
      }
      for(const version of [target+'/array-version',mark.id+'/body/0/expression/array-version',sibling.id+'/body/0/expression/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
    await t.test('a terminal Array element prevents later elements and the resulting Array',()=>{
      const created=compound.body[0].initializer;
      assert.ok(created.kind==='arrayCreate'&&receiver.kind==='reference');
      const later={...original,left:original.right,right:tail};
      const literal={...created,elements:[original.left,later],range:original.range};
      const stored={...local,binding:{...local.binding,type:literal.type},initializer:literal};
      const resultRead={...tail,receiver:{...receiver,binding:stored.binding.id,type:literal.type}};
      const fn={...compound,body:[...compound.body.slice(0,2),stored,{...returned,value:resultRead}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',literalPath=root+'/2/initializer';
      const old=literalPath+'/elements/0/operand/old-value';
      const initialized=[0,1].map(index=>literalPath+'/initial/'+index+'/array-version');
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
      assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
      const laterRead=reaching.reads.find(read=>read.node===literalPath+'/elements/1/right');
      assert.equal(laterRead?.status,row.productive?'proven':'pending');
      const after=reaching.reads.find(read=>read.node===root+'/3/value');
      assert.equal(after?.status,row.productive?'proven':'pending');
      assert.deepEqual(after?.versions,row.productive?[initialized[0]]:[]);
      for(const version of [...initialized,mark.id+'/body/0/expression/array-version',sibling.id+'/body/0/expression/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
    await t.test('local assignment publishes its new Array only after the RHS completes',()=>{
      const created=compound.body[0].initializer;
      assert.ok(created.kind==='arrayCreate'&&receiver.kind==='reference');
      const declared={...local,binding:{...local.binding,type:created.type,writable:true},initializer:receiver};
      const target={...receiver,binding:declared.binding.id};
      const value={...created,elements:[original.left,tail],range:original.range};
      const assignment={kind:'expression',expression:{kind:'assignment',target,value,type:created.type,range:original.range},range:local.range};
      const fn={...compound,body:[...compound.body.slice(0,2),declared,assignment,{...returned,value:{...tail,receiver:target}}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',rhs=root+'/3/expression/value',old=rhs+'/elements/0/operand/old-value';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
      assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
      assert.equal(reaching.reads.find(read=>read.node===rhs+'/elements/1')?.status,row.productive?'proven':'pending');
      const after=reaching.reads.find(read=>read.node===root+'/4/value');
      assert.equal(after?.status,row.productive?'proven':'pending');
      assert.deepEqual(after?.versions,row.productive?[rhs+'/initial/0/array-version']:[]);
      for(const version of [rhs+'/elements/0/operand/array-version',rhs+'/initial/0/array-version',rhs+'/initial/1/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
    await t.test('a dense Array store publishes its slot only after the RHS completes',()=>{
      const dense={kind:'arrayStoreDenseChecked',target:original.left.operand.target,
        value:original.left,type,range:original.range};
      const assignment={kind:'expression',expression:dense,range:local.range};
      const fn={...compound,body:[...compound.body.slice(0,2),assignment,{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',outer=root+'/2/expression',inner=outer+'/value/operand',old=inner+'/old-value';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
      assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
      const after=reaching.reads.find(read=>read.node===root+'/3/value');
      assert.equal(after?.status,row.productive?'proven':'pending');
      assert.deepEqual(after?.versions,row.productive?[outer+'/array-version']:[]);
      for(const version of [inner+'/array-version',outer+'/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
    for(const wrapper of ['plain','group','assertType','nonNull'])await t.test(`a definite checked Array read failure under ${wrapper} blocks a later dense store`,()=>{
      const value=mark.body[1].value;
      assert.ok(value.kind==='floating');
      const dense={kind:'arrayStoreDenseChecked',target:original.left.operand.target,value,type,range:original.range};
      const expression=wrapper==='plain'?tail:{kind:wrapper,type:tail.type,range:tail.range,operand:tail};
      const first={kind:'expression',expression,range:tail.range};
      const store={kind:'expression',expression:dense,range:local.range};
      const fn={...compound,body:[...compound.body.slice(0,2),first,store,{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',written=root+'/3/expression/array-version';
      const readPath=root+'/2/expression'+(wrapper==='plain'?'':'/operand');
      const before=reaching.reads.find(read=>read.node===readPath);
      const after=reaching.reads.find(read=>read.node===root+'/4/value');
      assert.ok(before&&after);
      assert.deepEqual([before.status,before.versions],row.productive?['proven',[initial]]:['missing',[]]);
      assert.deepEqual([after.status,after.versions],row.productive?['proven',[written]]:['pending',[]]);
      assert.ok(reaching.writes.some(write=>write.id===written),'lexical write remains recorded');
      assert.equal(terminalReads,null,'ordinary reads do not add a compound old-value record');
    });
    for(const kind of ['read','store','compound','update'])for(const failed of ['receiver','index'])
      await t.test(`an Array ${kind} stops after its ${failed} fails`,()=>{
        const created=compound.body[0].initializer,constant=mark.body[1].value;
        assert.ok(created.kind==='arrayCreate'&&constant.kind==='floating');
        const literal=elements=>({...created,elements,range:original.range});
        const operandReceiver=literal(failed==='receiver'?[original.left,tail]:[constant,constant]);
        const operandIndex={kind:'arrayLength',receiver:literal(failed==='receiver'?[tail]:[original.left]),
          type:index.type,range:index.range};
        const targetOperand={...original.left.operand.target,receiver:operandReceiver,index:operandIndex};
        const expression={
          read:{...tail,receiver:operandReceiver,index:operandIndex},
          store:{kind:'arrayStoreDenseChecked',target:targetOperand,value:tail,type,range:original.range},
          compound:{...original.left.operand,target:targetOperand,value:tail},
          update:{kind:'arrayUpdate',target:targetOperand,operator:'++',prefix:true,type,range:original.range},
        }[kind];
        const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
        const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
        const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
        const root=compound.id+'/body',outer=root+'/2/expression',target=outer+(kind==='read'?'':'/target'),
          left=target+'/receiver',right=target+'/index/receiver',inner=(failed==='receiver'?left:right)+'/elements/0/operand',
          old=inner+'/old-value';
        assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
        assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
        const afterOperands={read:[outer],store:[outer+'/value'],compound:[outer+'/old-value',outer+'/value'],
          update:[outer+'/old-value']}[kind];
        for(const path of [...afterOperands,root+'/3/value',
          ...(failed==='receiver'?[left+'/elements/1',right+'/elements/0']:[])]) {
          assert.equal(reaching.reads.find(read=>read.node===path)?.status,row.productive?'proven':'pending',path);
        }
        const versions=[inner+'/array-version',left+'/initial/0/array-version',left+'/initial/1/array-version',right+'/initial/0/array-version'];
        if(kind!=='read')versions.push(outer+'/array-version');
        for(const version of versions)assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
      });
    for(const outerHasValue of [false,true])await t.test(
      outerHasValue?'a compound RHS failure prevents the outer write':'a compound old read failure precedes its RHS',()=>{
        const created=compound.body[0].initializer,constant=mark.body[1].value;
        assert.ok(created.kind==='arrayCreate'&&constant.kind==='floating'&&receiver.kind==='reference');
        const initialized={...created,elements:outerHasValue?[constant]:[]};
        const stored={...local,binding:{...local.binding,type:created.type},initializer:initialized};
        const targetReceiver={...receiver,binding:stored.binding.id,type:created.type};
        const operation=original.left.operand,target={...operation.target,receiver:targetReceiver};
        const expression={...operation,target,value:original.left};
        const assignment={kind:'expression',expression,range:local.range};
        const fn={...compound,body:[...compound.body.slice(0,2),stored,assignment,{...returned,value:{...tail,receiver:targetReceiver}}]};
        const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
        const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
        const root=compound.id+'/body',outer=root+'/3/expression',inner=outer+'/value/operand';
        const outerOld=outer+'/old-value',innerOld=inner+'/old-value';
        const expectedTerminal=outerHasValue?(row.productive?[]:[innerOld]):[outerOld];
        assert.deepEqual([...terminalReads??[]],expectedTerminal);
        assert.equal(reaching.reads.find(read=>read.node===outerOld)?.status,outerHasValue?'proven':'missing');
        assert.equal(reaching.reads.find(read=>read.node===innerOld)?.status,
          outerHasValue?(row.productive?'proven':'missing'):'pending');
        const suffix=reaching.reads.find(read=>read.node===root+'/4/value');
        assert.equal(suffix?.status,expectedTerminal.length?'pending':'proven');
        assert.deepEqual(suffix?.versions,expectedTerminal.length?[]:[outer+'/array-version']);
        for(const version of [outer+'/array-version',inner+'/array-version'])
          assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
      });
    for(const side of ['receiver','value'])await t.test(`Array resize preserves the first failure in its ${side}`,()=>{
      const created=compound.body[0].initializer,constant=mark.body[1].value;
      assert.ok(created.kind==='arrayCreate'&&constant.kind==='floating');
      const literal=elements=>({...created,elements,range:original.range});
      const marker={...tail,receiver:literal([constant])};
      const first=literal(side==='receiver'?[original.left,constant]:[original.right,marker]);
      const second=literal(side==='value'?[original.left]:[original.right,marker]);
      const value={kind:'arrayLength',receiver:second,type:index.type,range:index.range};
      const expression={kind:'arrayResizeChecked',target:{receiver:first,type:index.type,range:local.range},
        value,type:index.type,range:original.range};
      const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',outer=root+'/2/expression',target=outer+'/target/receiver',rhs=outer+'/value/receiver';
      const inner=(side==='receiver'?target:rhs)+'/elements/0/operand',markerPath=(side==='receiver'?rhs:target)+'/elements/1';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[inner+'/old-value']);
      assert.equal(reaching.reads.find(read=>read.node===markerPath)?.status,row.productive||side==='value'?'proven':'pending');
      assert.equal(reaching.reads.find(read=>read.node===root+'/3/value')?.status,row.productive?'proven':'pending');
      assert.ok(reaching.writes.some(write=>write.id===inner+'/array-version'));
    });
    await t.test('a failed call input prevents later input reads and the caller continuation',()=>{
      const call=original.right;
      assert.equal(call.kind,'call');
      const parameters=[...sibling.parameters,...['first','second'].map(name=>({...local.binding,id:local.binding.id+'/'+name,name}))];
      const callee={...sibling,parameters};
      const expression={...call,arguments:[...call.arguments,original.left,tail]};
      const fn={...compound,body:[...compound.body.slice(0,2),{kind:'expression',expression,range:local.range},{...returned,value:tail}]};
      const model={...hir,functions:hir.functions.map(item=>item===compound?fn:item===sibling?callee:item)};
      const {reaching,terminalReads}=buildFiniteArrayReaching(model,proofs.definition,()=>{},()=>true);
      const root=compound.id+'/body',callPath=root+'/2/expression';
      const site=callPath+'/arguments/'+call.arguments.length+'/operand',old=site+'/old-value';
      assert.deepEqual([...terminalReads??[]],row.productive?[]:[old]);
      assert.equal(reaching.reads.find(read=>read.node===old)?.status,row.productive?'proven':'missing');
      for(const path of [callPath+'/arguments/'+(call.arguments.length+1),root+'/3/value']) {
        const read=reaching.reads.find(item=>item.node===path);
        assert.equal(read?.status,row.productive?'proven':'pending',path);
        assert.deepEqual(read?.versions,row.productive?[site+'/array-version']:[],path);
      }
      for(const version of [site+'/array-version',sibling.id+'/body/0/expression/array-version'])
        assert.ok(reaching.writes.some(write=>write.id===version),'lexical write '+version);
    });
  }

  /** @param {string} text */
  const checkBody=text=>{
    const symbol='f'+compound.id.slice(7),lines=text.split(/\r?\n/);
    const start=lines.findIndex(line=>line.includes('func.func @'+symbol+'(')||line.includes('func.func @"'+symbol+'"(')
      ||line.startsWith('  "func.func"()')&&line.includes('sym_name = "'+symbol+'"'));
    assert.ok(start>=0);
    const end=lines.findIndex((line,index)=>index>start&&/^  }(?:\)|$)/.test(line));
    assert.ok(end>start);
    const body=lines.slice(start,end);
    /** @param {(line:string)=>boolean} matches */
    const occurrence=matches=>{
      const found=body.filter(matches);
      assert.equal(found.length,1);
      return found[0];
    };
    const created=occurrence(line=>line.includes('"tsfg_core.domain.array_create"'));
    assert.ok(created.includes('element_domain = "'+normalDomain+'"'));
    assert.equal(created.includes('"tsfg_core.domain.array_create"()'),!row.productive);
    assert.equal(created.includes('array_versions = "[]"'),!row.productive);
    const read=occurrence(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes('array_node = "'+old+'"'));
    assert.match(read,/ -> f64$/);
    const rhs=occurrence(line=>line.includes('func.call')&&line.includes('tsfg_core.function_id = "'+mark.id+'"'));
    const adds=body.filter(line=>line.includes('"tsfg_core.add"'));
    assert.equal(adds.length,sibling?2:1);
    const write=occurrence(line=>line.includes('"tsfg_core.domain.array_store"')&&line.includes('array_node = "'+target+'"'));
    const operations=[created,read,rhs,adds[0],write];
    if(sibling){
      const call=occurrence(line=>line.includes('func.call')&&line.includes('tsfg_core.function_id = "'+sibling.id+'"'));
      if(earlier)operations.splice(1,0,call);
      else operations.push(call);
      operations.push(adds[1]);
    }
    const order=operations.map(line=>body.indexOf(line));
    assert.ok(order.every((position,index)=>index===0||order[index-1]<position));
  };
  const core=lowerFormalHir(hir,context,publication);
  checkBody(core);
  if(process.env.TSFG_CORE_IR_EXE)await t.test('both static modes retain the original checked occurrence and lexical effect order',async()=>{
    const canonicalized=await invokeCore(core);
    accepted(canonicalized);
    checkBody(canonicalized.stdout.toString('utf8'));
    const optimized=await invokeCore(core,'--optimize');
    accepted(optimized);
    assert.deepEqual(optimized.stdout,canonicalized.stdout);
  });
});

for(const row of [
  {fn:'fieldMissing',fixture:'field-tail-old-value-terminal',sha:'72338395d763abcaed19e6886b03f90849096e8a7a24fe137e82cfa62e7761ce',present:false,delta:0},
  {fn:'fieldPresent',fixture:'field-tail-old-value-present',sha:'2fb8044049a7022e1d54520e70308202841a1240aee352a73e8f2cbdde930376',present:true,delta:3},
  {fn:'fieldMissing',fixture:'field-write-tail-old-value-terminal',sha:'0ef476873a1b30b76238fdcb39de9a0d46c5fe2589b32c030f67b89f89a2769c',present:false,delta:0,write:true},
  {fn:'fieldPresent',fixture:'field-write-tail-old-value-present',sha:'22e3d52a15925f440446bd49b7ff7b9381d904c8c449b7e17f6c89069701f2c7',present:true,delta:3,write:true},
])test('a mixed compound old read preserves only normal field flow: '+row.fixture,async t=>{
  const bytes=await readFile(new URL('./testdata/typed-array-terminal-compound/'+row.fixture+'-package.json',import.meta.url));
  assert.equal(sha256(bytes),'sha256:'+row.sha);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const publication=buildInitialArrayPublication(context),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const {hir}=built,fn=hir.functions.find(fn=>fn.name===row.fn),rhs=hir.functions.find(fn=>fn.name==='rhs');
  const box=hir.types.find(type=>type.kind==='reference'&&type.nominalKey?.declarationPath[0]==='Box');
  assert.ok(fn&&rhs&&box?.kind==='reference');
  const field=box.fields.find(field=>field.name==='n'),constructor=hir.functions.find(fn=>fn.construction===box.construction.id);
  assert.ok(field&&constructor);
  const body=fn.id+'/body',target=body+'/3/expression',old=target+'/old-value',array=body+'/1/initializer';
  const tail=body+(row.write?'/5/value':'/4/value');
  const write=body+'/4/expression',writeValue=write+'/value',writeVersion=write+'/field-version/'+box.id+'/'+field.id;
  const tailOffset=(row.write?282:267)+row.delta;
  const f64=sha256('tsfg.actual-domain.v1\0'+canonical([fn.returnType.id])),bottom=sha256('tsfg.actual-domain.v1\0[]');
  const normal=row.present?f64:bottom,proofs=buildFiniteCoreDomains(hir,context,{publicationContext:publication});
  for(const plan of [proofs.reached,proofs.definition]){
    const read=plan.arrayReaching.reads.find(read=>read.node===old);
    assert.deepEqual([read.owner,read.index,read.status,read.versions,read.sources,read.origin],
      [array,'c:0',row.present?'proven':'missing',row.present?[array+'/initial/0/array-version']:[],
        row.present?[array+'/elements/0']:[],{source:'/src/main.ts',start:238+row.delta,end:243+row.delta}]);
    const phase=plan.fieldReaching.phaseWrites.find(write=>write.field===field.id&&write.state==='initialized');
    assert.ok(phase);
    const parameter=constructor.id+'/binding/'+constructor.parameters[1].id;
    assert.deepEqual([phase.node,phase.actualTypes],[parameter,[box.id]]);
    if(row.write)assert.deepEqual(plan.fieldReaching.writes,[{id:writeVersion,node:writeValue,actualType:box.id,field:field.id,
      origin:{source:'/src/main.ts',start:260+row.delta,end:271+row.delta}}]);
    const successful=plan.fieldReaching.reads.find(read=>read.node===tail);
    if(row.present)assert.deepEqual(successful.reaching,[{actualType:box.id,field:field.id,
      versions:[row.write?writeVersion:phase.id],sources:[row.write?writeValue:parameter]}]);
    else assert.equal(successful,undefined);
    assert.deepEqual(plan.carrierFields.find(value=>value.id===tail).targets.map(value=>value.fieldId),[field.id]);
    const actual=[array+'/elements',old,target+'/value',tail,fn.id+'/return'];
    if(row.write)actual.push(writeValue);
    if(!row.present&&plan===proofs.reached)actual.push(rhs.id+'/binding/'+rhs.parameters[0].id);
    for(const id of actual){
      const value=plan.nodes.find(node=>node.id===id);
      assert.deepEqual([value.domainId,value.pending,value.arrayOwners],[normal,[],[]],id);
    }
    assert.deepEqual(plan.arrayReaching.writes.filter(write=>write.kind==='store').map(write=>write.id).sort(),
      [rhs.id+'/body/0/expression/array-version',target+'/array-version'].sort());
  }
  // The terminal path keeps its lexical field dispatch and checked operation.
  /** @param {string} text */
  function check(text){
    const lines=text.split(/\r?\n/);
    /** @param {(line:string)=>boolean} matches */
    const occurrence=matches=>{const found=lines.filter(matches);assert.equal(found.length,1);return found[0];};
    const receiver=occurrence(line=>line.includes('"tsfg_core.domain.construct"'));
    const oldRead=occurrence(line=>line.includes('"tsfg_core.domain.array_read"')&&line.includes('array_node = "'+old+'"'));
    const call=occurrence(line=>line.includes('func.call')&&line.includes('tsfg_core.function_id = "'+rhs.id+'"'));
    const store=occurrence(line=>line.includes('"tsfg_core.domain.array_store"')&&line.includes('array_node = "'+target+'"'));
    const readField=occurrence(line=>line.includes('"tsfg_core.domain.field_read"'));
    assert.ok(readField.includes('field_dispatch')&&readField.includes(field.id));
    assert.ok(readField.includes('tsfg_source.start = '+tailOffset+' : i64')&&readField.includes('tsfg_source.end = '+(tailOffset+5)+' : i64'));
    assert.equal(readField.includes('field_reaching'),row.present);
    const operations=[receiver,oldRead,call,store];
    if(row.write){
      const fieldStore=occurrence(line=>line.includes('"tsfg_core.domain.field_store"'));
      assert.ok(fieldStore.includes('field_versions')&&fieldStore.includes(writeVersion));
      operations.push(fieldStore);
    }
    operations.push(readField);
    const order=operations.map(line=>lines.indexOf(line));
    assert.ok(order.every((index,position)=>position===0||index>order[position-1]));
  }
  const core=lowerFormalHir(hir,context,publication);check(core);
  if(process.env.TSFG_CORE_IR_EXE)await t.test('static Core verifies original lexical order and field authority',async()=>{
    const base=await invokeCore(core);accepted(base);check(base.stdout.toString('utf8'));
    const optimized=await invokeCore(core,'--optimize');accepted(optimized);assert.deepEqual(optimized.stdout,base.stdout);
  });
});
