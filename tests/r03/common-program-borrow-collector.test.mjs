// SPDX-License-Identifier: MIT
// Trusted inner abstract metadata only; no Source/Facts/Runtime admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonBorrowCollector,commonBorrowObservations} from '../../compiler/common-program-borrow-observations.mjs';

const domain=(limit=1000000)=>{
  const spend=commonMeter(limit),types=new Map([['Obj',{id:'Obj',kind:'reference'}],['Array',{id:'Array',kind:'array'}],
    ['Span',{id:'Span',kind:'readSpan'}],['Fn',{id:'Fn',kind:'function'}]]),objects=new Map(),a=commonAbstract({spend,types});
  const value=(refs=[],unknown=false)=>{const result=a.empty();result.refs=new Set(refs);result.unknown=unknown;
    for(const ref of refs)result.tags.add(objects.get(ref).type);return result;};
  const object=(ref,type)=>{objects.set(ref,{type,weak:false});return value([ref]);};
  return {spend,types,objects,a,value,object,collect:commonBorrowCollector({spend,types,objects})};
};

test('borrow collector preserves the mode matrix and heap insertion order',()=>{
  const {collect,value,object}=domain(),box=object('box','Obj'),array=object('array','Array'),closure=object('closure','env:L'),parent=object('parent','env:P');
  const element=object('span:element','Span'),field=object('span:field','Span'),slot=object('span:slot','Span'),
    inherited=object('span:parent','Span'),arrayElement=object('span:array','Span'),noise=object('span:noise','Span'),ignored=object('span:ignored','Span');
  const heap=new Map([['box-neighbor/field/noise',noise],['box/element/first',element],['box/field/capture',closure],
    ['box/other/ignored',ignored],['closure/slot/later',slot],['closure/parent',parent],['closure/field/plain',field],
    ['parent/slot/last',inherited],['array/element/0',arrayElement]]);
  for(const ref of ['span:element','span:field','span:slot','span:parent','span:array'])heap.set(ref+'/owner',array);
  const root=value(['box','array']),expected={
    spans:['span:element','span:array','span:field'],
    escape:['span:element','span:array','span:slot','span:field','span:parent'],
    structural:['array'],owning:['array'],
    hard:['box','array','span:element','closure','span:array','span:slot','parent','span:field','span:parent'],
  };
  for(const [mode,ids]of Object.entries(expected)){const actual=collect(root,heap,mode);assert.deepEqual([...actual.ids],ids,mode);assert.equal(actual.pending,false,mode);}
  assert.deepEqual([...box.refs],['box']); // Collection does not mutate the selected values.
});

test('hard collector follows CodeEnv and Cell contents while other modes leave them dead',()=>{
  const {collect,a,value,object}=domain(),environment=object('environment','env:L'),array=object('cell-array','Array'),
    captured=object('span:captured','Span'),cellSpan=object('span:cell','Span'),owner=object('captured-owner','Array');
  const root=a.literal('Fn');root.pairs.set('code',{functionId:'reader',environment:'environment'});
  root.cells.add('cell:known');root.cells.add('cell:missing');array.cells.add('cell:known');
  const heap=new Map([['cell:known',array],['environment/slot/capture',captured],['cell-array/element/0',cellSpan],
    ['span:captured/owner',owner],['span:cell/owner',array]]);
  for(const mode of ['spans','escape','structural','owning'])assert.deepEqual(collect(root,heap,mode),{ids:new Set(),pending:false});
  const hard=collect(root,heap,'hard');assert.deepEqual([...hard.ids],['environment','cell-array','span:captured','span:cell','captured-owner']);
  assert.equal(hard.pending,true);root.cells.delete('cell:missing');assert.equal(collect(root,heap,'hard').pending,false);
  assert.equal(collect(value([],true),heap,'escape').pending,true);
  assert.deepEqual([...environment.refs],['environment']);
});

test('Span discovery and owner traversal retain distinct pending rules',()=>{
  const {collect,value,object}=domain(),span=object('span','Span'),heap=new Map();
  for(const mode of ['spans','escape'])assert.deepEqual(collect(span,heap,mode),{ids:new Set(['span']),pending:false});
  assert.deepEqual(collect(span,heap,'structural'),{ids:new Set(),pending:true});
  assert.deepEqual(collect(span,heap,'hard'),{ids:new Set(['span']),pending:true});
  assert.deepEqual(collect(span,heap,'owning'),{ids:new Set(),pending:false});
  heap.set('span/owner',value([],true));assert.equal(collect(span,heap,'structural').pending,true);
  heap.set('span/owner',object('array','Array'));
  assert.deepEqual(collect(span,heap,'structural'),{ids:new Set(['array']),pending:false});
});

test('collector uses raw prefix membership and rebuilds after a heap mutation',()=>{
  const {collect,object}=domain(),root=object('root/field/infix','Obj'),a=object('span:A','Span'),b=object('span:B','Span'),c=object('span:C','Span'),noise=object('span:noise','Span');
  const heap=new Map([['root/field/infix/element/b',b],['root/field/infix-more/field/near',noise],
    ['root/field/infix/field/a',a],['root/field/infixish/field/near',noise],['root/field/infix/other/ignored',noise]]);
  assert.deepEqual([...collect(root,heap,'spans').ids],['span:B','span:A']);
  heap.delete('root/field/infix/element/b');heap.set('root/field/infix/element/c',c);
  assert.deepEqual([...collect(root,heap,'spans').ids],['span:A','span:C']);
});

test('empty and direct Span paths do not pay to index an unrelated heap',()=>{
  const {collect,a,object}=domain(100),span=object('span','Span'),empty=a.empty();
  const heap=new Map(Array.from({length:4096},(_,i)=>['noise:'+i+'/field/value',empty]));
  heap.set('span/owner',empty);
  assert.deepEqual(collect(empty,heap,'hard'),{ids:new Set(),pending:false});
  for(const mode of ['spans','escape'])assert.deepEqual(collect(span,heap,mode),{ids:new Set(['span']),pending:false});
  assert.deepEqual(collect(span,heap,'structural'),{ids:new Set(),pending:false});
  assert.deepEqual(collect(span,heap,'hard'),{ids:new Set(['span']),pending:false});
});

test('hard collector preserves the 4096 discovered identity boundary',()=>{
  const {collect,object,types,objects}=domain(),heap=new Map();
  const values=Array.from({length:4097},(_,i)=>object('node:'+i,'Obj'));
  values.slice(0,-1).forEach((value,i)=>heap.set('node:'+i+'/field/next',values[i+1]));
  assert.equal(collect(values[1],heap,'hard').ids.size,4096);
  const fresh=commonBorrowCollector({spend:commonMeter(1000000),types,objects});
  assert.throws(()=>fresh(values[0],heap,'hard'),{code:'r03-common-program-limit'});
});

test('collector sparse heap stays within the existing actual work limit',()=>{
  const {collect,value,object,a}=domain(),roots=Array.from({length:128},(_,i)=>'selected-root-'+String(i).padStart(3,'0'));
  roots.forEach(ref=>object(ref,'Obj'));const empty=a.empty();
  const heap=new Map(Array.from({length:8192},(_,i)=>['unrelated-root-'+String(i).padStart(4,'0')+'/field/noise',empty]));
  roots.forEach(ref=>heap.set(ref+'/field/leaf',empty));
  assert.deepEqual(collect(value(roots),heap,'hard'),{ids:new Set(roots),pending:false});
});

test('ordinary borrow observations consume the same hard collector',()=>{
  const {spend,types,objects,object}=domain(),root=object('box','Obj'),span=object('span','Span'),owner=object('array','Array');
  const heap=new Map([['box/field/span',span],['span/owner',owner]]);let observed=null;
  const observer=commonBorrowObservations({model:{spend,types,environments:new Map()},records:new Map(),objects,internalFunctions:new Set(),
    regions:{hardRaw:ids=>{observed=[...ids];}}});
  observer.hardEscape(root,heap);assert.deepEqual(observed,['box','span','array']);
});
