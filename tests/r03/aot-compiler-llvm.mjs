// SPDX-License-Identifier: MIT
// Structural LLVM graph checks, never an IR evaluator or a machine decoder.
import assert from 'node:assert/strict';
export function readCompilerLLVM(text) {
  const functions=[];let fn=null,block=null;
  for(const source of text.split('\n')) {
    const line=source.trim();
    const header=/^define (i1|i32) @([A-Za-z0-9_]+)\((.*)\) \{$/.exec(line);
    if(header) {
      const args=[...header[3].matchAll(/(ptr|i1|i32) (%[-a-zA-Z0-9_.$]+)/g)].map(m=>({type:m[1],value:m[2]}));
      const entry=String(Math.max(-1,...args.map(arg=>Number(arg.value.slice(1))))+1);
      block={name:entry,instructions:[],successors:[],condition:null};
      fn={name:header[2],result:header[1],args,entry,predecessors:new Map(),dominators:new Map(),blocks:new Map([[entry,block]]),defs:new Map(),events:[],calls:[],markers:[]};
      functions.push(fn);continue;
    }
    if(!fn)continue;if(line==='}') {fn=null;block=null;continue;}
    const label=/^([-a-zA-Z0-9_.$]+):/.exec(line);
    if(label) {block={name:label[1],instructions:[],successors:[],condition:null};fn.blocks.set(block.name,block);continue;}
    if(!line||line.startsWith(';'))continue;
    const instruction={text:line,block:block.name,index:block.instructions.length,result:null,rhs:line};
    const assigned=/^(%[-a-zA-Z0-9_.$]+) = (.*)$/.exec(line);
    if(assigned) {instruction.result=assigned[1];instruction.rhs=assigned[2];fn.defs.set(instruction.result,instruction);}
    block.instructions.push(instruction);
    const branch=/^br i1 ([^,]+), label %([^,]+), label %(.+)$/.exec(line);
    const jump=/^br label %(.+)$/.exec(line);
    if(branch) {block.condition=branch[1];block.successors=[branch[2],branch[3]];}
    else if(jump)block.successors=[jump[1]];
    const event=/call i32 (%[-a-zA-Z0-9_.$]+)\(ptr (%[-a-zA-Z0-9_.$]+), i32 (-?\d+), i32 (-?\d+), i32 (-?\d+), i32 (-?\d+), i64 (-?\d+)\)/.exec(instruction.rhs);
    if(event)fn.events.push({...instruction,target:event[1],state:event[2],kind:Number(event[3]),logical:Number(event[4]),start:Number(event[5]),end:Number(event[6]),id:BigInt(event[7])});
    const direct=/^call (i1|i32) @native_(\d+)\((.*)\)$/.exec(instruction.rhs);
    if(direct)fn.calls.push({...instruction,type:direct[1],callee:Number(direct[2]),args:direct[3]});
    const marker=/@llvm.experimental.stackmap\(i64 (-?\d+), i32 0\)/.exec(line);
    if(marker)fn.markers.push({...instruction,id:BigInt.asUintN(64,BigInt(marker[1]))});
  }
  for(const fn of functions) {
    fn.entry=fn.blocks.keys().next().value;fn.predecessors=new Map([...fn.blocks.keys()].map(name=>[name,[]]));
    for(const block of fn.blocks.values())for(const next of block.successors) {assert.ok(fn.blocks.has(next));fn.predecessors.get(next).push(block.name);}
    const reachable=new Set();const pending=[fn.entry];
    while(pending.length){const name=pending.pop();if(reachable.has(name))continue;reachable.add(name);pending.push(...fn.blocks.get(name).successors);}
    fn.dominators=new Map([...reachable].map(name=>[name,new Set(name===fn.entry?[name]:reachable)]));
    let changed=true;
    while(changed) {changed=false;for(const name of reachable) {if(name===fn.entry)continue;
      const predecessors=fn.predecessors.get(name).filter(p=>reachable.has(p));
      const common=new Set(fn.dominators.get(predecessors[0])??[]);
      for(const previous of predecessors.slice(1))for(const item of common)if(!fn.dominators.get(previous).has(item))common.delete(item);
      common.add(name);const prior=fn.dominators.get(name);
      if(common.size!==prior.size||[...common].some(item=>!prior.has(item))){fn.dominators.set(name,common);changed=true;}
    }}
  }
  return functions;
}
export function reaches(fn,from,to) {
  const seen=new Set(),pending=[from];
  while(pending.length){const name=pending.pop();if(name===to)return true;if(seen.has(name))continue;seen.add(name);pending.push(...fn.blocks.get(name).successors);}
  return false;
}
export function dominates(fn,before,after) {
  return before.block===after.block?before.index<after.index:fn.dominators.get(after.block)?.has(before.block);
}
export function instructions(fn) {return [...fn.blocks.values()].flatMap(block=>block.instructions);}
export function successGate(fn,value,target) {
  const compare=instructions(fn).find(op=>op.rhs==='icmp ne i32 '+value+', 0');assert.ok(compare,'callback success comparison');
  const block=fn.blocks.get(compare.block);assert.equal(block.condition,compare.result);assert.equal(block.successors.length,2);
  assert.ok(fn.dominators.get(target.block).has(block.successors[0]),'success edge dominates semantic continuation');
  return block;
}
export function checkCompilerGraph(text,expected) {
  assert.match(text,/target triple = "x86_64-pc-windows-msvc"/);
  assert.match(text,/target datalayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"/);
  assert.ok(!text.includes('tsfg_native_descriptor'));
  const functions=readCompilerLLVM(text),native=functions.filter(fn=>fn.name.startsWith('native_'));
  assert.deepEqual(native.map(fn=>fn.name),Array.from({length:expected.nativeFunctions},(_,i)=>'native_'+i));
  const wrapper=functions.find(fn=>fn.name==='tsfg_native_invoke');assert.ok(wrapper);
  const markers=functions.flatMap(fn=>fn.markers);assert.equal(new Set(markers.map(m=>String(m.id))).size,markers.length);
  const events=functions.flatMap(fn=>fn.events);if(expected.allowElidedEvents)for(let i=0;i<events.length;i++)assert.ok(events[i].id>0n&&(i===0||events[i].id>events[i-1].id));
  else assert.deepEqual(events.map(e=>e.id),events.map((_,i)=>BigInt(i+1)));
  for(const fn of functions)for(const event of fn.events) {
    assert.equal(event.target,fn.args[1].value);assert.equal(event.state,fn.args[0].value);
    const marker=fn.markers.find(m=>m.block===event.block&&m.index===event.index-1);assert.ok(marker);
    assert.equal(marker.id,(1n<<63n)|event.id);
  }
  for(const [index,fn]of native.entries()) {
    assert.equal(fn.markers[0].id,BigInt(index));assert.ok(fn.events.every(e=>e.kind!==8));
    const first=fn.events[0];assert.equal(first.kind,1);assert.equal(first.logical,index);
    for(const event of fn.events.filter(e=>e.kind===1||e.kind===2)) {
      const compare=instructions(fn).find(op=>op.rhs==='icmp ne i32 '+event.result+', 0');assert.ok(compare);
      const block=fn.blocks.get(compare.block);assert.equal(block.condition,compare.result);
      assert.ok(fn.events.some(e=>e.kind===3&&reaches(fn,block.successors[1],e.block)));
      assert.ok(!fn.events.some(e=>e.kind===4&&reaches(fn,block.successors[1],e.block)),'checkpoint failure never normal-returns');
    }
    for(const returned of fn.events.filter(e=>e.kind===4)) {
      const block=fn.blocks.get(returned.block),leave=fn.events.find(e=>e.kind===3&&e.block===returned.block&&e.index>returned.index);
      assert.ok(leave&&leave.start===returned.start&&leave.end===returned.end);
      const ret=block.instructions.find(op=>op.rhs.startsWith('ret '));assert.ok(ret&&ret.index>leave.index);
      const checkpoint=fn.events.filter(e=>e.kind===2&&e.start===returned.start&&e.end===returned.end&&dominates(fn,e,returned)).at(-1);
      assert.ok(checkpoint);successGate(fn,checkpoint.result,returned);
    }
    for(const call of fn.calls) {
      const enter=fn.events.find(e=>e.kind===0&&e.logical===call.callee&&dominates(fn,e,call));assert.ok(enter);successGate(fn,enter.result,call);
      const post=fn.events.find(e=>e.kind===2&&e.block===call.block&&e.index>call.index);assert.ok(post);
      const pre=fn.events.filter(e=>e.kind===2&&e.start===post.start&&e.end===post.end&&dominates(fn,e,enter)).at(-1);assert.ok(pre);successGate(fn,pre.result,enter);
    }
  }
  assert.equal(wrapper.markers[0].id,0xffffffffn);
  assert.deepEqual(wrapper.calls.map(c=>c.callee),native.map((_,i)=>i));
  for(const store of instructions(wrapper).filter(op=>op.rhs.startsWith('store '))) {
    const sentinel=wrapper.events.find(e=>e.kind===8&&dominates(wrapper,e,store));assert.ok(sentinel);
    const gate=successGate(wrapper,sentinel.result,store);assert.ok(!reaches(wrapper,gate.successors[1],store.block));
  }
  if(expected.staticExpandedStackmapRecords!==undefined)assert.equal(markers.length,expected.staticExpandedStackmapRecords);
  const graph={functions,native,wrapper};checkScalarSlots(graph);return graph;
}

function checkScalarSlots(graph) {
  const {wrapper,native}=graph,all=instructions(wrapper),input=wrapper.args[3].value,output=wrapper.args[4].value;
  function atAddress(value,base,offset) {
    return offset===0&&value===base||wrapper.defs.get(value)?.rhs==='getelementptr i8, ptr '+base+', i32 '+offset;
  }
  for(const call of wrapper.calls) {
    const fn=native[call.callee];
    function load(offset) {
      const found=all.find(op=>{const match=/^load i32, ptr ([^,]+), align 4$/.exec(op.rhs);return match&&atAddress(match[1],input,offset)&&dominates(wrapper,op,call);});
      assert.ok(found,'argument half loaded at '+offset);return found;
    }
    for(const [index,arg]of fn.args.slice(2).entries()) {
      const lower=load(index*8),upper=load(index*8+4);
      let condition;
      if(arg.type==='i1') {
        const zero=all.find(op=>op.rhs==='icmp eq i32 '+lower.result+', 0'&&dominates(wrapper,op,call));
        const canonical=all.find(op=>op.rhs==='icmp ule i32 '+upper.result+', 1'&&dominates(wrapper,op,call));
        assert.ok(zero&&canonical);
        condition=all.find(op=>{const pair=/^and i1 ([^,]+), (.+)$/.exec(op.rhs);return pair&&new Set(pair.slice(1)).size===2&&pair.slice(1).includes(zero.result)&&pair.slice(1).includes(canonical.result)&&dominates(wrapper,op,call);});
        assert.ok(all.some(op=>op.rhs==='trunc i32 '+upper.result+' to i1'&&dominates(wrapper,op,call)));
      } else condition=all.find(op=>op.rhs==='icmp eq i32 '+upper.result+', 0'&&dominates(wrapper,op,call));
      assert.ok(condition);const block=wrapper.blocks.get(condition.block);assert.equal(block.condition,condition.result);
      assert.ok(wrapper.dominators.get(call.block).has(block.successors[0]));
      assert.ok(!reaches(wrapper,block.successors[1],call.block),'invalid slot cannot call the function');
    }
    const sentinel=wrapper.events.find(event=>event.kind===8&&event.logical===call.callee);assert.ok(sentinel);
    const stores=all.filter(op=>op.rhs.startsWith('store ')&&dominates(wrapper,sentinel,op));
    const zeros=stores.filter(op=>op.rhs.startsWith('store i32 0, ptr '));
    const lowerZero=zeros.find(op=>{const match=/^store i32 0, ptr ([^,]+), align 4$/.exec(op.rhs);return match&&atAddress(match[1],output,0);});
    const upperZero=zeros.find(op=>{const match=/^store i32 0, ptr ([^,]+), align 4$/.exec(op.rhs);return match&&atAddress(match[1],output,4);});assert.ok(lowerZero&&upperZero);
    let value=call.result;
    if(fn.result==='i1'){const widened=all.find(op=>op.rhs==='zext i1 '+call.result+' to i8');assert.ok(widened);value=widened.result;}
    const store=stores.find(op=>{const match=/^store (i32|i8) ([^,]+), ptr ([^,]+), align [14]$/.exec(op.rhs);return match&&match[1]===(fn.result==='i1'?'i8':'i32')&&match[2]===value&&atAddress(match[3],output,fn.result==='i1'?4:0);});
    assert.ok(store&&dominates(wrapper,lowerZero,store)&&dominates(wrapper,upperZero,store),'both slot halves cleared before typed result store');
  }
}
