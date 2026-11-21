// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildHir,lowerFormalHir,printHir,readHir} from '../../compiler/hir.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {readTypedArrayFacts,writeTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';

const bytes=await readFile(new URL('./testdata/typed-array-string-slice-v10/package.json',import.meta.url));
const facts=readTypedArrayFacts(bytes,10);
const context={family:'tsfg.array-facts-context-candidate',version:4,factsBytes:bytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=readHir(Buffer.from(printHir(built.hir,context)),context);
const core=lowerFormalHir(hir,context);
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const source=hir.sources.find(row=>row.path===hir.rootFile).content;
const functions=hir.functions.filter(fn=>fn.body.some(row=>row.value?.kind==='stringSlice'));
const body=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
const uses=(lines,op)=>lines.filter(line=>line.includes('"'+op+'"('));
const result=line=>line.trimStart().split(' ')[0];
const operands=line=>/\(([^)]*)\)/u.exec(line)[1].split(', ');

function control(lines) {
  const blocks=new Map();
  let current=[];
  for(const line of lines) {
    const label=/^\s*(\^bb\d+)(?:\((%\w+):[^)]*\))?:\s*$/u.exec(line);
    if(label){current=[];blocks.set(label[1],{value:label[2],lines:current});}
    else current.push(line);
  }
  function successors(test) {
    const condition='cf.cond_br '+result(test)+', ';
    return lines.filter(line=>line.includes(condition)).map(line=>
      /cf\.cond_br %\w+, (\^bb\d+), (\^bb\d+)/u.exec(line).slice(1).map(name=>blocks.get(name)));
  }
  function forwarded(block) {
    const jump=block.lines.map(line=>/cf\.br (\^bb\d+)\((%\w+) : /u.exec(line)).find(Boolean);
    assert.ok(jump);
    return {block:blocks.get(jump[1]),value:jump[2]};
  }
  function joined(yes,no,onTrue,onFalse) {
    const selected=forwarded(yes),other=forwarded(no);
    assert.equal(selected.value,onTrue);
    assert.equal(other.value,onFalse);
    assert.equal(selected.block,other.block);
    return selected.block;
  }
  return {successors,joined};
}

test('genuine Source10 slice is owned and uses the existing checked String operation',()=>{
  assert.deepEqual(writeTypedArrayFacts(facts,10),bytes);
  assert.deepEqual(hir.intrinsics.stringSlice,facts.payload.stringSlice);
  assert.deepEqual([...new Set(functions.map(fn=>fn.body.find(row=>row.value?.kind==='stringSlice').value.arguments.length))].sort(),[0,1,2]);
  for(const fn of functions) {
    const value=fn.body.find(row=>row.value?.kind==='stringSlice').value;
    assert.equal(value.property,facts.payload.stringSlice.id);
    assert.equal(source.slice(value.nameRange.start,value.nameRange.end),'slice');
    const lines=body(fn).split('\n'),[length]=uses(lines,'tsfg_string.length'),slices=uses(lines,'tsfg_string.slice');
    assert.equal(slices.length,1,fn.name);
    assert.ok(length.includes(anchor(value.range)),fn.name);
    assert.ok(slices[0].includes(anchor(value.range)),fn.name);
    assert.match(slices[0],/ : \(!tsfg_string\.string, !tsfg_core\.integer<"usize">, !tsfg_core\.integer<"usize">\) -> !tsfg_string\.string$/u);
    if(!value.arguments.length) {
      const [zero]=uses(lines,'tsfg_core.constant');
      assert.ok(zero.includes('value = "0"'));
      assert.ok(slices[0].includes(', '+result(zero)+', '+result(length)+')'));
      assert.deepEqual(uses(lines,'tsfg_core.convert_checked'),[]);
    }
  }
  assert.throws(()=>readTypedArrayFacts(bytes,9),{code:'r03-typed-array-schema'});
  const unicode=functions.find(fn=>fn.name==='unicode');
  assert.deepEqual(unicode.body[0].value.receiver.codeUnits,[0xd800,0xd83d,0xde00,0x5a]);
  const nominal=hir.functions.find(fn=>fn.name==='nominal');
  assert.equal(nominal.body[0].value.kind,'call');
  assert.deepEqual(uses(body(nominal).split('\n'),'tsfg_string.slice'),[]);
});

test('the receiver and both original endpoint calls execute once in lexical order',()=>{
  const fn=functions.find(fn=>fn.name==='ordered');
  assert.ok(fn);
  const value=fn.body.find(row=>row.value?.kind==='stringSlice').value;
  const lines=body(fn).split('\n'),slice=uses(lines,'tsfg_string.slice')[0];
  assert.deepEqual([value.receiver,...value.arguments].map(arg=>arg.kind),['call','call','call']);
  const operands=[value.receiver,...value.arguments].map(arg=>{
    const target='callee = @"f'+arg.target.slice(7)+'"';
    const calls=uses(lines,'func.call').filter(line=>line.includes(target));
    assert.equal(calls.length,1);
    return calls[0];
  });
  const positions=[...operands,uses(lines,'tsfg_string.length')[0],slice].map(line=>lines.indexOf(line));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
  assert.ok(slice.includes('('+result(operands[0])+', '));
});

test('dynamic endpoints guard truncation, distinguish small negative fractions and preserve absent defaults',()=>{
  const fn=functions.find(fn=>fn.name==='dynamic');
  assert.ok(fn);
  const value=fn.body.find(row=>row.value?.kind==='stringSlice').value;
  assert.ok(value.arguments.every(arg=>arg.type===scalarTypeIds.f64));
  const lines=body(fn).split('\n'),constants=uses(lines,'tsfg_core.constant');
  const minusOne=result(constants.find(line=>line.includes('bff0000000000000')));
  const zero=result(constants.find(line=>line.includes('0000000000000000')&&!line.includes('bff')));
  const length=result(uses(lines,'tsfg_string.length')[0]);
  const limit=result(uses(lines,'tsfg_core.convert_checked').find(line=>line.includes('('+length+')')));
  const {successors,joined}=control(lines),endpoints=[];
  for(const argument of value.arguments) {
    const atArgument=op=>uses(lines,op).filter(line=>line.includes(anchor(argument.range)));
    const [negative]=atArgument('tsfg_core.le'),[positive]=atArgument('tsfg_core.gt'),[inBounds]=atArgument('tsfg_core.lt');
    const [number,threshold]=operands(negative);
    assert.equal(threshold,minusOne);
    const [[negate,keep],[subtract,unchanged]]=successors(negative);
    const [negation]=uses(negate.lines,'tsfg_core.neg');
    assert.deepEqual(operands(negation),[number]);
    const magnitude=joined(negate,keep,result(negation),number);
    assert.deepEqual(operands(positive),[magnitude.value,zero]);
    assert.deepEqual(operands(inBounds),[magnitude.value,limit]);
    const [[check,zeroArm]]=successors(positive),[[within,cap]]=successors(inBounds);
    assert.ok(check.lines.includes(inBounds));
    const clipped=joined(within,cap,magnitude.value,limit);
    const bounded=joined(clipped,zeroArm,clipped.value,zero);
    const [conversion]=atArgument('tsfg_core.convert_checked');
    assert.match(conversion,/ : \(f64\) -> !tsfg_core\.integer<"usize">$/u);
    assert.deepEqual(operands(conversion),[bounded.value]);
    const [relative]=uses(subtract.lines,'tsfg_core.sub');
    assert.deepEqual(operands(relative),[length,result(conversion)]);
    endpoints.push(joined(subtract,unchanged,result(relative),result(conversion)).value);
  }
  const [start,end]=endpoints;
  const reverse=uses(lines,'tsfg_core.lt').find(line=>line.includes(anchor(value.range))
    &&line.endsWith('(!tsfg_core.integer<"usize">, !tsfg_core.integer<"usize">) -> i1'));
  assert.deepEqual(operands(reverse),[end,start]);
  const [[empty,ordered]]=successors(reverse);
  const endValue=joined(empty,ordered,start,end).value;
  assert.deepEqual(operands(uses(lines,'tsfg_string.slice')[0]).slice(1),[start,endValue]);
  const optional=functions.find(row=>row.name==='optional');
  assert.ok(optional);
  const optionalLines=body(optional).split('\n');
  const predicates=uses(optionalLines,'tsfg_core.domain.presence_equal');
  const refined=uses(optionalLines,'tsfg_core.domain.refine');
  for(const argument of optional.body[0].value.arguments) {
    assert.equal(predicates.filter(line=>line.includes(anchor(argument.range))).length,1);
    assert.equal(refined.filter(line=>line.includes(anchor(argument.range))).length,1);
  }
  assert.ok(refined.every(line=>line.includes(sha256('tsfg.type\0undefined'))));
  const explicit=functions.find(fn=>fn.name==='explicitUndefined');
  assert.deepEqual(uses(body(explicit).split('\n'),'tsfg_core.convert_checked'),[]);
});
