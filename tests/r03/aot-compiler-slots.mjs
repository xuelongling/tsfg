// SPDX-License-Identifier: MIT
// Public LLVM graph assertions for the ordinary ABI, never code execution.
import assert from 'node:assert/strict';
import {instructions,dominates,reaches} from './aot-compiler-llvm.mjs';
export function checkCompilerSlots(graph,signatures) {
 const {wrapper,native}=graph,all=instructions(wrapper),input=wrapper.args[6].value,output=wrapper.args[7].value,types=wrapper.args[4].value;
 assert.deepEqual(wrapper.args.map(a=>a.type),['ptr','ptr','i32','i32','ptr','i8','ptr','ptr']);
 const at=(value,base,offset)=>offset===0&&value===base||wrapper.defs.get(value)?.rhs==='getelementptr i8, ptr '+base+', i32 '+offset;
 const before=(call,rhs)=>{const op=all.find(op=>op.rhs===rhs&&dominates(wrapper,op,call));assert.ok(op,rhs);return op;};
 function gate(call,op){const block=wrapper.blocks.get(op.block);assert.equal(block.condition,op.result);assert.ok(wrapper.dominators.get(call.block).has(block.successors[0]));assert.ok(!reaches(wrapper,block.successors[1],call.block),'rejection cannot invoke guest');}
 function load(call,offset,base=input,type='i32'){
  const found=all.find(op=>{const match=new RegExp('^load '+type+', ptr ([^,]+), align '+(type==='i8'?1:4)+'$').exec(op.rhs);return match&&at(match[1],base,offset)&&dominates(wrapper,op,call);});assert.ok(found,'argument loaded at '+offset);return found;
 }
 for(const call of wrapper.calls){
  const fn=native[call.callee],signature=signatures?.[call.callee]??{parameters:fn.args.slice(2).map(a=>a.type==='i1'?2:1),result:fn.result==='i1'?2:1};
  const count=before(call,'icmp eq i32 '+wrapper.args[3].value+', '+signature.parameters.length);gate(call,count);
  const returned=before(call,'icmp eq i8 '+wrapper.args[5].value+', '+signature.result);gate(call,returned);
  const typeLoads=signature.parameters.map((code,index)=>{const loaded=load(call,index,types,'i8');gate(call,before(call,'icmp eq i8 '+loaded.result+', '+code));assert.ok(dominates(wrapper,count,loaded));return loaded;});
  for(const [index,arg]of fn.args.slice(2).entries()){
   const low=load(call,index*8),high=load(call,index*8+4);
   for(const check of typeLoads)assert.ok(dominates(wrapper,check,low),'complete type table checked before slots');
   const bits=arg.type==='float'?32:arg.type==='double'?64:Number(arg.type.slice(1));
   if(bits===64){
    const lo=before(call,'zext i32 '+low.result+' to i64'),hi=before(call,'zext i32 '+high.result+' to i64');
    const shifted=before(call,'shl i64 '+hi.result+', 32'),value=before(call,'or i64 '+lo.result+', '+shifted.result);
    if(arg.type==='double')before(call,'bitcast i64 '+value.result+' to double');
   }else if(bits===1){
    gate(call,before(call,'icmp eq i32 '+low.result+', 0'));gate(call,before(call,'icmp ule i32 '+high.result+', 1'));before(call,'trunc i32 '+high.result+' to i1');
   }else{
    gate(call,before(call,'icmp eq i32 '+high.result+', 0'));
    if(arg.type==='float')before(call,'bitcast i32 '+low.result+' to float');
    if(bits<32){gate(call,before(call,'icmp ule i32 '+low.result+', '+(bits===8?255:65535)));before(call,'trunc i32 '+low.result+' to '+arg.type);}
   }
  }
  const sentinel=wrapper.events.find(e=>e.kind===8&&e.logical===call.callee);assert.ok(sentinel);
  const stores=all.filter(op=>op.rhs.startsWith('store ')&&dominates(wrapper,sentinel,op));
  const zeros=stores.filter(op=>op.rhs.startsWith('store i32 0, ptr '));
  const zeroAt=offset=>zeros.find(op=>{const m=/^store i32 0, ptr ([^,]+), align 4$/.exec(op.rhs);return m&&at(m[1],output,offset);});
  const lowerZero=zeroAt(0),upperZero=zeroAt(4);assert.ok(lowerZero&&upperZero);
  let value=call.result,type=fn.result;
  const conversion=(rhs)=>{const op=all.find(op=>op.rhs===rhs&&dominates(wrapper,sentinel,op));assert.ok(op,rhs);return op.result;};
  if(type==='float'||type==='double'){const integer=type==='float'?'i32':'i64';value=conversion('bitcast '+type+' '+value+' to '+integer);type=integer;}
  if(type==='i1'){value=conversion('zext i1 '+value+' to i8');type='i8';}
  else if(type==='i8'||type==='i16'){value=conversion('zext '+type+' '+value+' to i32');type='i32';}
  const storeAt=(wanted,width,offset)=>stores.find(op=>{const m=/^store (i8|i32) ([^,]+), ptr ([^,]+), align [14]$/.exec(op.rhs);return m&&m[1]===width&&m[2]===wanted&&at(m[3],output,offset);});
  if(type==='i64'){
   const low=conversion('trunc i64 '+value+' to i32'),shifted=conversion('lshr i64 '+value+', 32'),high=conversion('trunc i64 '+shifted+' to i32');
   for(const [v,offset]of [[low,0],[high,4]]){const stored=storeAt(v,'i32',offset);assert.ok(stored&&dominates(wrapper,lowerZero,stored)&&dominates(wrapper,upperZero,stored));}
  }else{const stored=storeAt(value,type,fn.result==='i1'?4:0);assert.ok(stored&&dominates(wrapper,lowerZero,stored)&&dominates(wrapper,upperZero,stored));}
 }
 assert.ok(!all.some(op=>/^(load i64|store i64) /.test(op.rhs)),'no4-aligned64-bit memory operation');
}
