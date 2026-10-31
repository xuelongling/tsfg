// SPDX-License-Identifier: MIT
// Region/receiver metadata only. No Source admission, solver, Span, Frontend,
// Runtime Program/State, bytecode, VM or native object is constructed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonRegions,emptyRegionValue} from '../../compiler/common-program-regions.mjs';
import {commonReceiverActual} from '../../compiler/common-program-receiver-actual.mjs';
import {commonMeter,canonical,sha256} from '../../compiler/common-program-common.mjs';

function fixture() {
  const spend=commonMeter(1000000),regions=commonRegions(spend),types=new Map([['B',{kind:'reference'}]]),objects=new Map();
  const empty=()=>({tags:new Set(),refs:new Set(),cells:new Set(),frames:new Set(),cursors:new Set(),pairs:new Map(),unknown:false,
    truth:0,number:null,region:emptyRegionValue()});
  const copy=value=>{
    spend(value.tags.size+value.refs.size+value.cells.size+value.frames.size+value.cursors.size+value.pairs.size+1);
    for(const group of [value.tags,value.refs,value.cells,value.frames,value.cursors])for(const id of group)spend(id.length+1);
    return {...value,tags:new Set(value.tags),refs:new Set(value.refs),cells:new Set(value.cells),frames:new Set(value.frames),cursors:new Set(value.cursors),
      pairs:new Map(value.pairs),region:regions.copy(value.region)};
  };
  const merge=(into,from)=>{
    let changed=false;
    for(const name of ['tags','refs','cells','frames','cursors']){spend(from[name].size);
      for(const id of from[name]){spend(id.length+1);if(!into[name].has(id)){into[name].add(id);changed=true;}}}
    spend(from.pairs.size);for(const [id,pair]of from.pairs){spend(id.length+1);if(!into.pairs.has(id)){into.pairs.set(id,pair);changed=true;}}
    if(from.unknown&&!into.unknown){into.unknown=true;changed=true;}
    return regions.merge(into.region,from.region)||changed;
  };
  const key=value=>{
    spend(128);const rows=[];
    for(const name of ['tags','refs','cells','frames','cursors']){spend(value[name].size);const ids=[];
      for(const id of value[name]){spend(id.length*8+32);ids.push(id);}
      ids.sort((a,b)=>{spend(a.length+b.length+1);return a<b?-1:a>b?1:0;});rows.push([name,ids]);}
    // This fixture has no callable payloads; its key is not used by feedback.
    assert.equal(value.pairs.size,0);return canonical(rows);
  };
  const id=parts=>{spend(parts.length+128);for(const part of parts)if(typeof part==='string')spend(part.length*8+32);return sha256(canonical(parts));};
  const a={empty,copy,merge,key,id},receiver=commonReceiverActual({spend,types,objects},a);
  const context={id:'context',plan:{owner:{id:'source:D'}}},scope=regions.scope(context.id+'/header','base-call'),
    outside=regions.scope('different-context/header','other-call'),state={values:new Map(),heap:new Map(),regions:new Map(),frames:receiver.store()};
  const bind=(site,selectedScope)=>{
    const frame=receiver.create(state.frames,{activation:'activation',site,owner:'B',construction:'B/ctor',newTarget:'B',derived:false,fields:['F']}),
      value=empty(),reference='object:'+site;
    value.tags.add('B');value.refs.add(reference);objects.set(reference,{type:'B'});
    value.region=regions.allocate(selectedScope,'activation',reference,'B',state.regions);
    const bound=receiver.bind(state.frames,new Set([frame]),value);assert.ok(bound.normal);receiver.overlay(state.frames,bound.normal.frames);
    return frame;
  };
  return {a,regions,receiver,context,scope,outside,state,bind};
}

// A canonical natural-loop CFG is sufficient for regions.prepare's existing
// demand/cut equations. The two variants demand only a frame or only a final
// cursor. Typed lineage/SSA are preconditions, not proved by this fixture.
function plan(control) {
  const op=(name,operands=[],successors=[],properties={})=>({name,operands,successors,properties}),
    block=(name,instructions,parameters=[])=>({name,instructions,parameters:parameters.map(name=>({name,type:'literal'}))});
  return {owner:{id:'source:D'},entry:{name:'entry'},graph:{blocks:[
    block('entry',[op('cf.br',[],['header'])],['condition','control','selected']),
    block('header',[op('cf.cond_br',['condition'],['body','exit'])]),
    block('body',[op('cf.br',[],['header'])]),
    ...(control==='frame'?[block('exit',[op('tsfg_program.receiver_get',['control'],['normal','language'],{owner:'B'})]),
      block('normal',[op('func.return',['result'])],['result']),block('language',[op('tsfg_program.return_throw',['thrown'])],['thrown'])]
      :[block('exit',[op('tsfg_program.initialize_end',['control','selected'],[],{owner:'B'}),op('func.return',['selected'])])])
  ]}};
}

test('natural-loop exit ages actual frame bindings and escapes frame/cursor live payloads',()=>{
  for(const control of ['frame','cursor']){
    const {a,regions,receiver,context,scope,outside,state,bind}=fixture(),frame=bind('selected',scope),
      nonLive=bind('non-live',scope),unrelated=bind('other-scope',outside),controlValue=a.empty(),selected=a.empty(),
      started=receiver.begin(state.frames,new Set([frame])),final=receiver.advance(state.frames,started,'F');
    if(control==='frame')controlValue.frames.add(frame);else controlValue.cursors=final;
    selected.tags.add('B');selected.refs.add('object:selected'); // Raw alias with no current relation witness.
    state.values.set('control',controlValue);state.values.set('selected',selected);state.values.set('condition',a.empty());
    regions.prepare([plan(control)]);
    const before=receiver.get(state.frames,new Set([frame]));assert.ok(before.normal);
    const roots=[...before.normal.value.region.roots],binding=state.frames.get(frame),prefix={unbound:binding.unbound,weak:binding.weak,
      initializing:binding.initializing,aborted:binding.aborted,prefixMin:binding.prefixMin,prefixMax:binding.prefixMax};
    assert.equal(before.normal.value.region.opaque,false);assert.equal(regions.scopes.get(scope).blocked,false);
    // Old feedback ignores the extra receiver argument and reaches these same
    // assertions with an incorrectly unaged GetThis; no new API is called here.
    regions.feedback(context,'header','exit',state,true,receiver);
    const after=receiver.get(state.frames,new Set([frame]));assert.ok(after.normal);
    assert.equal(after.normal.value.region.opaque,true,control+' demand must age the owned binding');
    assert.deepEqual([...after.normal.value.region.roots],roots,'JS aging retains historical roots');
    assert.deepEqual([...after.normal.value.tags],['B']);assert.deepEqual([...after.normal.value.refs],['object:selected']);
    assert.deepEqual({unbound:binding.unbound,weak:binding.weak,initializing:binding.initializing,aborted:binding.aborted,
      prefixMin:binding.prefixMin,prefixMax:binding.prefixMax},prefix,'binding and initialized prefix are unchanged');
    const aged=receiver.get(state.frames,new Set([nonLive]));assert.ok(aged.normal);assert.equal(aged.normal.value.region.opaque,true);
    const other=receiver.get(state.frames,new Set([unrelated]));assert.ok(other.normal);assert.equal(other.normal.value.region.opaque,false);
    assert.equal(regions.scopes.get(scope).blocked,true,'live bound payload is a cut escape');
    assert.equal(regions.scopes.get(scope).hardBlocked,false);assert.equal(regions.scopes.get(scope).transportBlocked,true);
    assert.equal(regions.scopes.get(outside).blocked,false);
  }
});
