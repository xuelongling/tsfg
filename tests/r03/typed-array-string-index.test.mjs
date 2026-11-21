// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildHir,lowerFormalHir,printHir,readHir} from '../../compiler/hir.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts,writeTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const bytes=await readFile(new URL('./testdata/typed-array-string-index-v11/package.json',import.meta.url));
const facts=readTypedArrayFacts(bytes,11);
const context={family:'tsfg.array-facts-context-candidate',version:5,factsBytes:bytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=readHir(Buffer.from(printHir(built.hir,context)),context);
const core=lowerFormalHir(hir,context);
const source=hir.sources.find(row=>row.path===hir.rootFile).content;
const indexed=fn=>fn.body.find(row=>row.value?.kind==='stringIndex')?.value;
const functions=hir.functions.filter(indexed);
const body=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0].split('\n');
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const uses=(lines,op)=>lines.filter(line=>line.includes('"'+op+'"('));
const result=line=>line.trimStart().split(' ')[0];
const operands=line=>/\(([^)]*)\)/u.exec(line)[1].split(', ');
const undefinedId=sha256('tsfg.type\0undefined'),stringId=sha256('tsfg.type\0string');

function blocks(lines) {
  const result=new Map();
  let current=[];
  for(const line of lines) {
    const label=/^\s*(\^bb\d+)(?:\([^)]*\))?:\s*$/u.exec(line);
    if(label){current=[];result.set(label[1],current);}
    else current.push(line);
  }
  return result;
}

test('the exact Source11 index fact produces an owned String-or-undefined result',()=>{
  assert.deepEqual(writeTypedArrayFacts(facts,11),bytes);
  assert.deepEqual(hir.intrinsics.stringIndex,facts.payload.stringIndex);
  assert.ok(functions.length>=4);
  for(const fn of functions) {
    const value=indexed(fn);
    assert.equal(value.property,facts.payload.stringIndex.id);
    assert.equal(source[value.range.end-1],']');
    assert.equal(value.receiver.range.start,value.range.start);
    assert.deepEqual([...hir.types.find(row=>row.id===value.type).members].sort(),[undefinedId,stringId].sort());
    const lines=body(fn),slices=uses(lines,'tsfg_string.slice');
    assert.equal(slices.length,1,fn.name);
    assert.ok(slices[0].includes(anchor(value.range)),fn.name);
    assert.match(slices[0],/: \(!tsfg_string\.string, !tsfg_core\.integer<"usize">, !tsfg_core\.integer<"usize">\) -> !tsfg_string\.string$/u);
    assert.equal(uses(lines,'tsfg_core.domain.literal').filter(line=>line.includes(undefinedId)).length,1);
  }
  const literal=functions.map(indexed).find(value=>value.receiver.codeUnits?.includes(0xd83d));
  assert.ok(literal?.receiver.codeUnits.includes(0xde00),'the supplementary character retains both original UTF-16 units');
  assert.throws(()=>readTypedArrayFacts(bytes,10),{code:'r03-typed-array-schema'});
});

test('bounds and exact integer conversion dominate the one-unit slice and share the missing edge',()=>{
  const fn=functions.find(fn=>fn.name==='dynamic');
  assert.ok(fn);
  const value=indexed(fn);
  assert.equal(value.index.type,scalarTypeIds.f64);
  const lines=body(fn),work=blocks(lines),atIndex=name=>uses(lines,name).filter(line=>line.includes(anchor(value.index.range)));
  const [floor]=atIndex('tsfg_core.ge'),[ceiling]=atIndex('tsfg_core.lt'),[integral]=atIndex('tsfg_core.eq');
  const branches=[floor,ceiling,integral].map(check=>{
    const edge=lines.find(line=>line.includes('cf.cond_br '+result(check)+', '));
    return /cf\.cond_br %\w+, (\^bb\d+), (\^bb\d+)/u.exec(edge).slice(1);
  });
  const [number,zero]=operands(floor);
  assert.ok(uses(lines,'tsfg_core.constant').some(line=>result(line)===zero&&line.includes('0000000000000000')));
  const [length]=uses(lines,'tsfg_string.length');
  const conversions=atIndex('tsfg_core.convert_checked');
  const limit=conversions.find(line=>operands(line)[0]===result(length));
  assert.deepEqual(operands(ceiling),[number,result(limit)]);
  assert.ok(work.get(branches[0][0]).includes(ceiling));
  const inside=work.get(branches[1][0]);
  const narrowed=conversions.find(line=>operands(line)[0]===number);
  const roundtrip=conversions.find(line=>operands(line)[0]===result(narrowed));
  assert.ok(inside.includes(narrowed)&&inside.includes(roundtrip)&&inside.includes(integral));
  assert.deepEqual(operands(integral),[number,result(roundtrip)]);
  assert.ok(branches.every(([,absent])=>absent===branches[0][1]));
  const missing=work.get(branches[0][1]);
  const [absent]=uses(missing,'tsfg_core.domain.literal').filter(line=>line.includes(undefinedId));
  assert.ok(absent);
  assert.equal(uses(missing,'tsfg_string.slice').length,0);
  const present=work.get(branches[2][0]);
  const [end]=uses(present,'tsfg_core.add'),[start,one]=operands(end);
  assert.equal(start,result(narrowed));
  assert.ok(uses(present,'tsfg_core.constant').some(line=>result(line)===one&&line.includes('value = "1"')));
  const [slice]=uses(present,'tsfg_string.slice');
  assert.deepEqual(operands(slice),[operands(length)[0],start,result(end)]);
  const forwarded=(block,input)=>{
    const tag=uses(block,'tsfg_core.domain.view').find(line=>operands(line)[0]===result(input));
    assert.ok(tag);
    const edge=block.find(line=>line.trimStart().startsWith('cf.br ')&&line.includes('('+result(tag)+' : '));
    assert.ok(edge);
    return /cf\.br (\^bb\d+)/u.exec(edge)[1];
  };
  assert.equal(forwarded(present,slice),forwarded(missing,absent));
});

test('receiver and index calls each occur once before length and the checked read',()=>{
  const fn=functions.find(fn=>fn.name==='ordered');
  assert.ok(fn);
  const value=indexed(fn),lines=body(fn);
  assert.deepEqual([value.receiver.kind,value.index.kind],['call','call']);
  const calls=[value.receiver,value.index].map(arg=>{
    const own=uses(lines,'func.call').filter(line=>line.includes('callee = @"f'+arg.target.slice(7)+'"'));
    assert.equal(own.length,1);
    return own[0];
  });
  const [length]=uses(lines,'tsfg_string.length');
  assert.ok(lines.indexOf(calls[0])<lines.indexOf(calls[1])&&lines.indexOf(calls[1])<lines.indexOf(length));
  assert.deepEqual(operands(length),[result(calls[0])]);
  const alias=functions.find(fn=>indexed(fn).index.type===scalarTypeIds.u32||indexed(fn).index.type===scalarTypeIds.i64);
  assert.ok(alias,'an existing integer scalar retains its typed input');
  assert.ok(uses(body(alias),'tsfg_core.convert_checked').some(line=>line.includes(anchor(indexed(alias).index.range))
    &&/\(!tsfg_core\.integer<"(u32|i64)">\) -> f64$/u.test(line)));
});

test('a checked index composes with the existing undefined fallback',()=>{
  const fn=hir.functions.find(fn=>fn.name==='defaulted');
  assert.ok(fn);
  const expression=fn.body[0].value;
  assert.equal(expression.operator,'??');
  assert.equal(expression.left.kind,'stringIndex');
  const lines=body(fn);
  assert.equal(uses(lines,'tsfg_string.slice').length,1);
  const [comparison]=uses(lines,'tsfg_core.domain.presence_equal');
  const [refined]=uses(lines,'tsfg_core.domain.refine');
  assert.ok(comparison.includes(anchor(expression.operatorRange)));
  assert.equal(operands(refined)[0],operands(comparison)[0]);
  assert.match(refined,/ -> !tsfg_string\.string$/u);
});
