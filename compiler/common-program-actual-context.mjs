// SPDX-License-Identifier: MIT
// Current actual-invocation snapshots, not Source/Runtime objects or fixed
// publication authority. All callbacks own and precharge their internal work
// with the same spend callback. This boundary prepays its additional snapshots,
// comparisons and every subsequent escaped encoding/hash of returned keys.
// receiver.retained must return data bounds in stable FrameId codepoint order;
// otherwise an unordered argument's frame insertion order could erase the
// association between two same-payload frames and their different regions.
import {canonical,sha256} from './identity.mjs';

/** @typedef {{roots:ReadonlySet<string>,opaque:boolean,empty:boolean,number:number|null}} ActualContextRegion */

/**
 * @template {{region:ActualContextRegion}} Value
 * @template Frames,RegionHeap
 * @param {{target:string,args:Value[],heap:Map<string,Value>,frameWorld:Frames,regionHeap:RegionHeap,activation:string,repeated:boolean,regionScope:string}} input
 * @param {{reachable:(values:Value[],heap:Map<string,Value>)=>Map<string,Value>,key:(value:Value)=>string}} a
 * @param {{select:(world:Frames,values:Value[])=>Frames,retained:(world:Frames,values:Value[])=>Value[],key:(world:Frames)=>string}} receiver
 * @param {{key:(value:Value['region'])=>string,reachable:(values:Value['region'][],heap:RegionHeap)=>RegionHeap,heapKey:(heap:RegionHeap)=>string}} regions
 * @param {(units:number)=>void} spend
 */
export function commonActualContextSnapshot({target,args,heap,frameWorld,regionHeap,activation,repeated,regionScope},a,receiver,regions,spend) {
  /** @param {Value['region']} region */
  const regionKey=region=>{
    // Source commonRegions.key owns its copy/sort. Prepay the known region
    // string encoding here too: opaque/empty/number matter even with no roots.
    spend(region.roots.size+17);for(const id of region.roots)spend(Math.ceil((6*id.length+3)/8)+1);
    return regions.key(region);
  };
  // select/retained are owned frame/value snapshots, including selected parent
  // frames. A bound receiver can be hidden behind a frame-only argument.
  const entryFrames=receiver.select(frameWorld,args),retained=receiver.retained(entryFrames,args);
  spend(args.length+retained.length+1);const roots=[];
  for(const value of args)roots.push(value);for(const value of retained)roots.push(value);
  const entryHeap=a.reachable(roots,heap);
  spend(entryHeap.size*4+roots.length+2);
  /** @type {[string,string,string][]} */ const memory=[];
  /** @type {Value['region'][]} */ const regionValues=[];
  for(const [id,value]of entryHeap){memory.push([id,a.key(value),regionKey(value.region)]);regionValues.push(value.region);}
  spend(memory.length+1);memory.sort(([left],[right])=>{
    spend(Math.ceil((left.length+right.length)/8)+1);return left<right?-1:left>right?1:0;
  });
  spend(args.length+roots.length*2+3);
  /** @type {string[]} */ const argumentKeys=[];
  /** @type {string[]} */ const regionKeys=[];
  for(const value of args)argumentKeys.push(a.key(value));
  for(const value of roots){
    const region=value.region;regionKeys.push(regionKey(region));regionValues.push(region);
  }
  const entryRegions=regions.reachable(regionValues,regionHeap),regionHeapKey=regions.heapKey(entryRegions),frameKey=receiver.key(entryFrames);
  // Keys already serialized by callbacks are strings in this outer record.
  // Their new escaping and the outer hash are distinct work. Bound every UTF16
  // code unit by six UTF8 bytes (JSON escapes), plus syntax, before allocation.
  let width=384;
  /** @param {string} value */
  const textWidth=value=>{spend(1);width+=6*value.length+3;};
  textWidth(target);textWidth(activation);textWidth(regionScope);textWidth(regionHeapKey);textWidth(frameKey);
  for(const value of argumentKeys)textWidth(value);
  for(const [id,value,region]of memory){textWidth(id);textWidth(value);textWidth(region);}
  for(const value of regionKeys)textWidth(value);
  width+=argumentKeys.length+memory.length*5+regionKeys.length;
  spend(argumentKeys.length+memory.length*3+regionKeys.length+24);
  // The width fee is paid separately for serialization and SHA input work.
  spend(Math.ceil(width/8)*2+1);
  const encoded=canonical({target,args:argumentKeys,memory,activation,repeated,regionScope,regionKeys,regionHeapKey,frameKey});
  // Prepay the final target/digest concatenation as well; SHA256 is 71 bytes.
  spend(Math.ceil((6*target.length+72)/8)+5);
  const key=target+'/'+sha256(encoded);
  return {key,entryHeap,entryFrames,entryRegions};
}
