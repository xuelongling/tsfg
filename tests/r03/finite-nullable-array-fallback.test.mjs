// SPDX-License-Identifier: MIT
// One real checked Source input; independent expected frozen before this run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256} from '../../compiler/identity.mjs';
const expected=JSON.parse(await readFile('E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/nullable-array-fallback-expected.json','utf8'));
function checkPresenceControl(body) {
  const lines=body.split('\n'),predicates=lines.filter(line=>line.includes('"tsfg_core.domain.presence_equal"')),
    branches=lines.filter(line=>line.includes('cf.cond_br'));
  assert.equal(predicates.length,expected.control.nullishTests);assert.equal(branches.length,expected.control.nullishTests);
  const fallbackLabels=branches.map(line=>/cf\.cond_br\s+%\w+,\s*\^\w+,\s*(\^\w+)/.exec(line)?.[1]);
  assert.ok(fallbackLabels.every(Boolean));assert.equal(new Set(fallbackLabels).size,expected.control.rhsBlocks);
  const comparedAbsences=lines.filter(line=>line.includes('"tsfg_core.domain.literal"')).map(line=>/view_type = "(sha256:[0-9a-f]+)"/.exec(line)?.[1]);
  assert.deepEqual(comparedAbsences.sort(),expected.control.absences.map(kind=>sha256('tsfg.type\0'+kind)).sort());
  const literals=new Map(),comparisons=new Map();let block='entry';
  for(const line of lines) {
    const label=/^\s*(\^\w+)(?:\(|:)/.exec(line);if(label)block=label[1];
    const literal=/^\s*(%\w+) = "tsfg_core.domain.literal"\(\).*view_type = "(sha256:[0-9a-f]+)".* -> (.+)$/.exec(line);
    if(literal){assert.ok(!literals.has(literal[1]));literals.set(literal[1],{type:literal[2],carrier:literal[3]});}
    const comparison=/^\s*(%\w+) = "tsfg_core.domain.presence_equal"\((%\w+), (%\w+)\).*operator = "(!==|===)".* -> i1$/.exec(line);
    if(comparison){assert.ok(!comparisons.has(comparison[1]));comparisons.set(comparison[1],{operands:comparison.slice(2,4),operator:comparison[4],block,line});}
  }
  assert.equal(comparisons.size,expected.control.nullishTests);
  const usedTags=[];
  for(const comparison of comparisons.values()) {
    assert.equal(comparison.operator,'!==','present continuation excludes its tested absence');
    const literalOperands=comparison.operands.filter(operand=>literals.has(operand));
    assert.equal(literalOperands.length,1,'predicate literal must be an actual comparison operand');
    const literal=literals.get(literalOperands[0]);usedTags.push(literal.type);
    const operands=/ : \((.+)\) -> i1$/.exec(comparison.line);assert.ok(operands);
    assert.equal(operands[1].split(', ')[comparison.operands.indexOf(literalOperands[0])],literal.carrier,
      'predicate literal operand type must match its defining SSA result');
  }
  assert.deepEqual(usedTags.sort(),expected.control.absences.map(kind=>sha256('tsfg.type\0'+kind)).sort(),
    'predicate literal identities must test both distinct absence tags');
  const edges=branches.map(line=>{const edge=/cf\.cond_br\s+(%\w+),\s*(\^\w+),\s*(\^\w+)/.exec(line);assert.ok(edge);return {condition:edge[1],yes:edge[2],no:edge[3]};});
  assert.deepEqual(edges.map(edge=>edge.condition).sort(),[...comparisons.keys()].sort(),
    'condition comparison linkage must consume each corresponding comparison result once');
  for(const edge of edges)assert.notEqual(edge.yes,edge.no,'each distinct tag must actually split the control flow');
  assert.equal(edges[0].yes,comparisons.get(edges[1].condition).block,'the second tag test follows the first present edge');
  const resultCarrier='!tsfg_core.domain<"'+sha256('tsfg.actual-domain.v1\0'+JSON.stringify([expected.result.type]))+'">';
  assert.ok(lines.some(line=>/^\s*\^bb/.test(line)&&line.includes(resultCarrier)),'coalesce result phi uses the exact Array carrier');
  assert.equal(lines.filter(line=>line.includes('"tsfg_core.domain.refine"')).length,2);
  assert.doesNotMatch(body,/"tsfg_core.domain.array_create"|"tsfg_core.undefined"/);
  assert.match(body,/"tsfg_core.domain.array_read"/,'pending memory still lowers the real dynamic checked operation');
}
function controlledVariants(body) {
  const lines=body.split('\n'),literals=lines.filter(line=>line.includes('"tsfg_core.domain.literal"')),
    comparisons=lines.filter(line=>line.includes('"tsfg_core.domain.presence_equal"')),
    firstLiteral=/^\s*(%\w+) =.* -> (.+)$/.exec(literals[0]),
    firstComparison=/^\s*(%\w+) =/.exec(comparisons[0]),
    secondComparison=/^\s*(%\w+) =/.exec(comparisons[1]);
  assert.ok(firstLiteral);assert.ok(firstComparison);assert.ok(secondComparison);
  // Keep the other literal in place and preserve typed SSA: only the second
  // comparison's literal operand and its annotated operand type are changed.
  const wrongLiteral=comparisons[1].replace(/(presence_equal"\(%\w+, )%\w+/,(_,prefix)=>prefix+firstLiteral[1])
    .replace(/( : \([^,]+, )[^)]+(\) -> i1)$/,(_,prefix,suffix)=>prefix+firstLiteral[2]+suffix),
    wrongCondition=lines.find(line=>line.includes('cf.cond_br '+secondComparison[1]+','));
  assert.notEqual(wrongLiteral,comparisons[1]);assert.ok(wrongCondition);
  return [{name:'reused-absence-literal',body:body.replace(comparisons[1],wrongLiteral),rule:/predicate literal/},
    {name:'detached-second-condition',body:body.replace(wrongCondition,
      wrongCondition.replace('cf.cond_br '+secondComparison[1]+',','cf.cond_br '+firstComparison[1]+',')),rule:/condition comparison/}];
}
test('actual nullable Array fallback preserves both payload origins, two absence guards and a pending dynamic read',async()=>{
  const bytes=await readFile(expected.packet.path);assert.equal(bytes.length,expected.packet.bytes);
  assert.equal(sha256(bytes).slice(7),expected.packet.sha256);
  const source=await readFile(expected.source.path);assert.equal(source.toString(),expected.sourceText);
  assert.equal(sha256(source).slice(7),expected.source.sha256);
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:expected.packageId},built=buildHir(facts,context);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir,run=hir.functions.find(fn=>fn.name==='run'),selected=run.body.find(row=>row.kind==='local'&&row.binding.name==='selected'),
    plan=buildFiniteCoreDomains(hir,context).definition,node=plan.nodes.find(row=>row.id===run.id+'/binding/'+selected.binding.id),
    domain=plan.domains.find(row=>row.id===node.domainId),owners=expected.result.sourceParameters.map(name=>{
      const parameter=run.parameters.find(row=>row.name===name);assert.ok(parameter);
      return run.id+'/binding/'+parameter.id+'/entry-owner/'+expected.result.type;
    }).sort();
  assert.deepEqual(domain.actualTypes,[expected.result.type]);assert.deepEqual(node.arrayOwners,owners);
  assert.equal(plan.allocations.length,expected.result.freshAllocations,'?? only transports existing owner identities');
  assert.equal(plan.arrayReaching.reads.length,1);const read=plan.arrayReaching.reads[0];
  assert.equal(read.status,expected.read.status);assert.deepEqual(read.sources,expected.read.sources);assert.deepEqual(read.versions,expected.read.versions);
  assert.ok(plan.nodes.find(row=>row.id===read.node).pending.length,'unknown index/entry storage remains explicitly unproved');
  const core=lowerFormalHir(hir,context),body=core.split('  func.func @"f'+run.id.slice(7)+'"')[1].split('\n  }')[0];
  checkPresenceControl(body);const variants=controlledVariants(body),
    capture=JSON.stringify({actual:body,variants:variants.map(({name,body})=>({name,body}))},null,2)+'\n',
    file='E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/nullable-array-fallback-review-variants.json';
  try{await writeFile(file,capture,{flag:'wx'});}catch(error){
    if(!(error instanceof Error)||!('code' in error)||error.code!=='EEXIST')throw error;
    assert.equal(await readFile(file,'utf8'),capture,'review data is immutable; never overwrite an old failing specimen');
  }
  assert.deepEqual(variants.map(variant=>{try{checkPresenceControl(variant.body);return 'accepted '+variant.name;}
    catch(error){return error instanceof Error&&variant.rule.test(error.message)?'rejected':'wrong diagnostic';}}),['rejected','rejected'],
  'each controlled wrong operand/condition must be rejected independently');
});
