// SPDX-License-Identifier: MIT
// Pure metadata/value-callback fixtures. No AST, actual solver, Program/State,
// physical object, bytecode or Runtime execution is involved in these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonReceiverActual} from '../../compiler/common-program-receiver-actual.mjs';
import {canonical,sha256,commonMeter} from '../../compiler/common-program-common.mjs';

function fixture(limit=100000){
  const spend=commonMeter(limit),types=new Map([['B',{kind:'reference'}],['D',{kind:'reference'}],['U',{kind:'reference'}],
    ['i32',{kind:'scalar'}],['String',{kind:'string'}],['Undefined',{kind:'undefined'}],['Span',{kind:'readSpan'}]]),objects=new Map();
  const empty=()=>({tags:new Set(),refs:new Set(),cells:new Set(),pairs:new Map(),frames:new Set(),cursors:new Set(),unknown:false,
    truth:0,number:null,region:{roots:new Set(),opaque:false,empty:false}});
  const copy=value=>{spend(value.tags.size+value.refs.size+value.cells.size+value.pairs.size+value.frames.size+value.cursors.size+value.region.roots.size+1);
    return {...value,tags:new Set(value.tags),refs:new Set(value.refs),cells:new Set(value.cells),pairs:new Map(value.pairs),frames:new Set(value.frames),cursors:new Set(value.cursors),
      region:{...value.region,roots:new Set(value.region.roots)}};};
  const merge=(into,from)=>{let changed=false;for(const name of ['tags','refs','cells','frames','cursors']){
      spend(from[name].size);for(const id of from[name])if(!into[name].has(id)){into[name].add(id);changed=true;}}
    spend(from.pairs.size+from.region.roots.size+1);for(const [id,pair]of from.pairs)if(!into.pairs.has(id)){into.pairs.set(id,pair);changed=true;}
    for(const id of from.region.roots)if(!into.region.roots.has(id)){into.region.roots.add(id);changed=true;}
    if(from.unknown&&!into.unknown){into.unknown=true;changed=true;}return changed;};
  const key=value=>{
    // ValueOps own this work. Reject insufficient budget before spreading,
    // sorting or canonicalizing any variable-size payload collection/string.
    spend(128);
    for(const name of ['tags','refs','cells','frames','cursors']){
      spend(value[name].size);for(const id of value[name])spend(id.length*8+32);
    }
    spend(value.pairs.size);for(const [id,pair]of value.pairs){
      spend(id.length*8+pair.functionId.length*8+(pair.environment?.length??0)*8+128);
    }
    const order=(left,right)=>{spend(left.length+right.length+1);return left<right?-1:left>right?1:0;};
    return canonical({tags:[...value.tags].sort(order),refs:[...value.refs].sort(order),cells:[...value.cells].sort(order),
      pairs:[...value.pairs].sort(([left],[right])=>order(left,right)),frames:[...value.frames].sort(order),cursors:[...value.cursors].sort(order),unknown:value.unknown});
  };
  const a={empty,copy,merge,key,id:value=>sha256(canonical(value))},r=commonReceiverActual({spend,types,objects},a);
  const object=(tag,ref)=>{const value=empty();value.tags.add(tag);value.refs.add(ref);value.region.roots.add(ref);objects.set(ref,{type:tag});return value;};
  const literal=tag=>{const value=empty();value.tags.add(tag);return value;};
  const definition=(derived=false,repeated=false)=>({activation:'activation',site:'new-site',owner:derived?'D':'B',construction:derived?'ctor:D':'ctor:B',
    newTarget:derived?'D':'B',derived,fields:['first','second'],repeated});
  return {a,r,object,literal,definition};
}
const only=id=>new Set([id]);
const requireNormal=out=>{assert.ok(out.normal);return out.normal;};

test('receiver metadata: child allocation uses dynamic newTarget and controls have no object tags',()=>{
  const {a,r,object,definition}=fixture(),world=r.store(),parent=r.create(world,definition(true)),parentValue=a.empty();parentValue.frames.add(parent);
  assert.equal(parentValue.tags.size,0);assert.equal(parentValue.refs.size,0);
  const children=r.child(world,only(parent),{...definition(),site:'base-site'}),child=[...children][0];
  assert.equal(r.frame(child).newTarget,'D');assert.equal(r.frame(child).parent,parent);
  const allocated=r.allocate(world,children,(newTarget,id,weak)=>{assert.equal(newTarget,'D');assert.equal(weak,false);return object(newTarget,'allocated:'+id);});
  assert.deepEqual([...allocated.tags],['D']);
  const childBound=requireNormal(r.bind(world,children,allocated)),constructed=requireNormal(r.result(childBound.frames,children)),
    parentBound=requireNormal(r.bind(constructed.frames,only(parent),constructed.value));
  assert.deepEqual([...requireNormal(r.get(parentBound.frames,only(parent))).value.tags],['D']);
  assert.throws(()=>r.frame(child).fields.push('fake'),TypeError);
});

test('receiver metadata: duplicate bind preserves the first receiver and already completed base effects',()=>{
  const {r,object,definition}=fixture(),world=r.store(),id=r.create(world,definition(true)),first=object('U','global:G'),
    bound=requireNormal(r.bind(world,only(id),first)),before=r.key(bound.frames),baseEffects=['second-base-construct-completed'];
  const duplicate=r.bind(bound.frames,only(id),object('D','second-base-result'));
  assert.equal(duplicate.normal,null);assert.ok(duplicate.language);assert.equal(duplicate.language.reasons.has('duplicate-bind'),true);
  assert.deepEqual([...requireNormal(r.get(duplicate.language.frames,only(id))).value.refs],['global:G']);
  assert.deepEqual(baseEffects,['second-base-construct-completed']);assert.equal(r.key(bound.frames),before);
  first.tags.clear();assert.deepEqual([...requireNormal(r.get(bound.frames,only(id))).value.tags],['U']);
});

test('receiver metadata: constructor results preserve explicit object tags and apply primitive/undefined rules',()=>{
  const {r,object,literal,definition}=fixture(),world=r.store(),base=r.create(world,definition()),
    bound=requireNormal(r.bind(world,only(base),object('B','base-this'))),replacement=object('U','replacement');
  assert.deepEqual([...requireNormal(r.result(bound.frames,only(base),replacement)).value.tags],['U']);
  assert.deepEqual([...requireNormal(r.get(bound.frames,only(base))).value.tags],['B']);
  assert.deepEqual([...requireNormal(r.result(bound.frames,only(base),literal('String'))).value.tags],['B']);
  const derived=r.create(bound.frames,{...definition(true),site:'derived-result'}),unbound=r.result(bound.frames,only(derived));
  assert.equal(unbound.normal,null);assert.ok(unbound.language);assert.equal(unbound.language.reasons.has('unbound-this'),true);
  assert.deepEqual([...requireNormal(r.result(bound.frames,only(derived),replacement)).value.refs],['replacement']);
  const selected=requireNormal(r.bind(bound.frames,only(derived),replacement));
  assert.deepEqual([...requireNormal(r.result(selected.frames,only(derived),literal('Undefined'))).value.tags],['U']);
  const invalid=r.result(selected.frames,only(derived),literal('i32'));
  assert.equal(invalid.normal,null);assert.ok(invalid.language);assert.equal(invalid.language.reasons.has('derived-primitive-return'),true);
});

test('receiver metadata: initializer language snapshot keeps binding, written prefix and escaped payload',()=>{
  const {r,object,definition}=fixture(),world=r.store(),id=r.create(world,definition()),selected=requireNormal(r.bind(world,only(id),object('U','escaped:U'))),
    heap=new Map(),start=r.begin(selected.frames,only(id));
  heap.set('escaped:U/first','written-before-throw');const next=r.advance(selected.frames,start,'first'),language=r.clone(selected.frames);
  r.abort(language,next);assert.equal(language.get(id).prefixMin,1);assert.equal(language.get(id).prefixMax,1);
  assert.equal(language.get(id).initializing,false);assert.equal(language.get(id).aborted,true);
  assert.equal(heap.get('escaped:U/first'),'written-before-throw');
  assert.deepEqual([...requireNormal(r.get(language,only(id))).value.refs],['escaped:U']);
  heap.set('escaped:U/second','normal-only');const last=r.advance(selected.frames,next,'second');r.end(selected.frames,last);
  assert.equal(selected.frames.get(id).prefixMin,2);assert.equal(selected.frames.get(id).initializing,false);
  assert.equal(language.get(id).prefixMax,1);
  const overlaid=r.clone(selected.frames);r.overlay(overlaid,language);assert.equal(overlaid.get(id).prefixMax,1);
  assert.equal(heap.get('escaped:U/second'),'normal-only','metadata overlay never rolls back external heap effects');
});

test('receiver metadata: repeated static frames retain old bindings without making bind an absolute duplicate',()=>{
  const {r,object,definition}=fixture(),world=r.store(),id=r.create(world,definition()),first=requireNormal(r.bind(world,only(id),object('U','old'))),
    start=r.begin(first.frames,only(id)),next=r.advance(first.frames,start,'first');
  assert.equal(r.create(first.frames,definition(false,true)),id);
  const again=r.bind(first.frames,only(id),object('D','new'));assert.ok(again.normal);assert.ok(again.language);
  assert.deepEqual([...again.normal.frames.get(id).bound.tags].sort(),['D','U']);
  assert.equal(again.normal.frames.get(id).unbound,true);assert.equal(again.normal.frames.get(id).prefixMax,1);
  assert.deepEqual([...again.language.frames.get(id).bound.tags],['U']);
  r.abort(again.normal.frames,next);assert.equal(again.normal.frames.get(id).initializing,true);assert.equal(again.normal.frames.get(id).aborted,true);
  const joined=r.clone(again.language.frames);assert.equal(r.join(joined,again.normal.frames),true);
  assert.deepEqual([...joined.get(id).bound.tags].sort(),['D','U']);
});

test('receiver metadata: cursor/frame roots retain actual bindings and ReadSpan classification stays pending',()=>{
  const {a,r,object,definition}=fixture(),world=r.store(),parent=r.create(world,definition(true)),
    parentBound=requireNormal(r.bind(world,only(parent),object('U','parent-root'))),children=r.child(parentBound.frames,only(parent),{...definition(),site:'child-root'}),
    child=[...children][0],childBound=requireNormal(r.bind(parentBound.frames,children,object('D','child-root'))),tokens=r.begin(childBound.frames,children),control=a.empty();
  control.cursors=tokens;const selected=r.select(childBound.frames,[control]);assert.equal(selected.size,2);
  const retained=r.retained(childBound.frames,[control]);assert.deepEqual(retained.flatMap(value=>[...value.refs]).sort(),['child-root','parent-root']);
  assert.equal(control.tags.size,0);assert.equal(control.refs.size,0);
  const pending=r.result(childBound.frames,only(child),object('Span','borrowed-owner'));
  assert.equal(pending.pending,true);assert.ok(pending.normal);assert.equal(pending.normal.value.tags.has('Span'),true);
  const spanFrame=r.create(world,{...definition(),site:'pending-bind'}),spanBound=r.bind(world,only(spanFrame),object('Span','span-binding'));
  assert.equal(spanBound.pending,true);assert.ok(spanBound.normal);assert.equal(r.get(spanBound.normal.frames,only(spanFrame)).pending,true);
  assert.throws(()=>r.result(childBound.frames,only(child),control),{code:'r03-common-program-receiver-actual'});
});


test('receiver metadata: ValueOps key rejects a long payload before key materialization under a small shared budget',()=>{
  const {a}=fixture(1024),payload=a.empty(),ref='r'.repeat(8192);payload.refs.add(ref);
  assert.throws(()=>a.key(payload),{code:'r03-common-program-limit'});
  assert.equal(payload.refs.has(ref),true,'budget rejection leaves the owned input unchanged');
});

test('receiver metadata: retained payload regions follow FrameId order independently of control insertion order',()=>{
  const {a,r,object,definition}=fixture(),world=r.store(),F=r.create(world,{...definition(),site:'same-payload:F'}),G=r.create(world,{...definition(),site:'same-payload:G'}),
    f=object('U','shared-payload'),g=object('U','shared-payload');
  f.region.opaque=true;f.region.empty=false;g.region.opaque=false;g.region.empty=true;
  const boundF=requireNormal(r.bind(world,only(F),f)),bound=requireNormal(r.bind(boundF.frames,only(G),g)).frames,
    forward=a.empty(),reverse=a.empty();forward.frames=new Set([F,G]);reverse.frames=new Set([G,F]);
  const region=value=>({roots:[...value.region.roots],opaque:value.region.opaque,empty:value.region.empty}),
    byFrame=new Map([[F,region(f)],[G,region(g)]]),ordered=F<G?[F,G]:[G,F],expected=ordered.map(id=>byFrame.get(id)),
    retainedForward=r.retained(bound,[forward]),retainedReverse=r.retained(bound,[reverse]);
  assert.deepEqual(retainedForward.map(region),expected);
  assert.deepEqual(retainedReverse.map(region),expected,'reversed control Set insertion must not reverse FrameId-to-region association');
  for(const value of [...retainedForward,...retainedReverse]){
    assert.deepEqual([...value.tags],['U']);assert.deepEqual([...value.refs],['shared-payload']);
    assert.equal(value.frames.size,0);assert.equal(value.cursors.size,0);
  }
  // Payload/control identity keys intentionally do not encode these region
  // relations. Swapping per-frame regions must still change their ordered
  // retained roots, even when the control insertion order is also reversed.
  const swapped=r.clone(bound),left=swapped.get(F).bound.region;swapped.get(F).bound.region=swapped.get(G).bound.region;swapped.get(G).bound.region=left;
  assert.equal(a.key(forward),a.key(reverse));assert.equal(r.key(bound),r.key(swapped));
  assert.notDeepEqual(r.retained(bound,[forward]).map(region),r.retained(swapped,[reverse]).map(region));
  assert.deepEqual(region(bound.get(F).bound),region(f));assert.deepEqual(region(bound.get(G).bound),region(g));
});
