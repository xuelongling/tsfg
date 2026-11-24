// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildHir,lowerFormalHir,printHir,readHir} from '../../compiler/hir.mjs';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {accepted,invokeCore} from './generic-core-package-capture.mjs';

const bytes=await readFile(new URL('./testdata/typed-array-string-presence-v11/package.json',import.meta.url));
const facts=readTypedArrayFacts(bytes,11);
const context={family:'tsfg.array-facts-context-candidate',version:5,factsBytes:bytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=readHir(Buffer.from(printHir(built.hir,context)),context);
const core=lowerFormalHir(hir,context);
const anchor=range=>`tsfg_source.start = ${range.start} : i64, tsfg_source.end = ${range.end} : i64`;
const instructions=fn=>core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0].split('\n');
const uses=(lines,op)=>lines.filter(line=>line.includes('"'+op+'"('));
const result=line=>line.trimStart().split(' ')[0];
const operands=line=>/\(([^)]*)\)/u.exec(line)[1].split(', ');
const operationKinds=new Set(['stringIndex','stringSlice','stringLength']);

function stringOperation(fn) {
  const pending=[fn.body];
  while(pending.length) {
    const value=pending.pop();
    if(operationKinds.has(value.kind))return value;
    for(const child of Object.values(value))if(child&&typeof child==='object')pending.push(child);
  }
  assert.fail('expected a real Source String operation in '+fn.name);
}

function compareForProof(lines,refine) {
  const encoded=/presence_proof = ("(?:\\.|[^"\\])*")/u.exec(refine)[1];
  const proof=JSON.parse(JSON.parse(encoded));
  const compare=uses(lines,'tsfg_core.domain.presence_equal').find(line=>line.includes(anchor(proof.range)));
  assert.ok(compare,'the proof refers to an original comparison');
  assert.ok(operands(compare).includes(operands(refine)[0]),'the proof must consume the value actually compared');
  return compare;
}

for(const [name,kind] of /** @type {const} */ ([
  ['both','stringIndex'],['early','stringSlice'],['mixed','stringIndex'],['size','stringLength'],
])) {
  test(`${name} passes its selected short-circuit String value to the real ${kind} operation`,()=>{
    const fn=hir.functions.find(fn=>fn.name===name);
    assert.ok(fn);
    const value=stringOperation(fn),lines=instructions(fn),refines=uses(lines,'tsfg_core.domain.refine');
    assert.equal(value.kind,kind);
    const receiver=refines.find(line=>line.includes(anchor(value.receiver.range))&&line.endsWith('-> !tsfg_string.string'));
    assert.ok(receiver,'the operation reads the narrowed String SSA at its original receiver span');
    const second=compareForProof(lines,receiver);
    const firstRefine=refines.find(line=>operands(second).includes(result(line)));
    assert.ok(firstRefine,'the second absence comparison reads the first narrowed value');
    assert.notEqual(compareForProof(lines,firstRefine),second);

    const [length]=uses(lines,'tsfg_string.length');
    assert.ok(length.includes(anchor(value.range)));
    assert.deepEqual(operands(length),[result(receiver)]);
    if(kind!=='stringLength') {
      const [slice]=uses(lines,'tsfg_string.slice');
      assert.ok(slice.includes(anchor(value.range)));
      assert.equal(operands(slice)[0],result(receiver));
    }
    if(name==='mixed') {
      const key=refines.find(line=>line.includes(anchor(value.index.range))&&line.endsWith('-> f64'));
      assert.ok(key,'the typed key uses its own original check');
      compareForProof(lines,key);
      const rangeCheck=uses(lines,'tsfg_core.ge').find(line=>line.includes(anchor(value.index.range)));
      assert.equal(operands(rangeCheck)[0],result(key));
    }
  });
}

test('complete Core admits String length intermediates without Source usize declarations',
  {skip:!process.env.TSFG_CORE_IR_EXE},async()=>{
    assert.ok(!facts.payload.types.some(type=>type.kind==='scalar'&&type.name==='usize'));
    const result=await invokeCore(core,'--canonicalize',AbortSignal.timeout(15_000));
    accepted(result);
    const canonical=result.stdout.toString('utf8');
    assert.match(canonical,/"tsfg_string\.length".*!tsfg_core\.integer<"usize">/u);
    assert.match(canonical,/"tsfg_string\.slice"/u);
  });
