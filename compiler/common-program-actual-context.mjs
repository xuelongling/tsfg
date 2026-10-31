// SPDX-License-Identifier: MIT
// Current actual-invocation snapshots, not Source/Runtime objects or fixed
// publication authority. All callbacks own and precharge their internal work
// with the same spend callback. This boundary owns its complete typed entry
// projection and compares it without materializing intermediate identity text.
// receiver.retained must return data bounds in stable FrameId codepoint order;
// otherwise an unordered argument's frame insertion order could erase the
// association between two same-payload frames and their different regions.
import {commonCheck as check} from './common-program-common.mjs';

/** @typedef {{roots:ReadonlySet<string>,opaque:boolean,empty:boolean,number:number|null}} ActualContextRegion */

/**
 * Exact owned invocation Value identity. Execution copies and joins may
 * normalize relations; this boundary must preserve the original key facts.
 * @template {{tags:Set<string>,refs:Set<string>,cells:Set<string>,pairs:Map<string,{functionId:string,environment:string|null}>,frames:Set<string>,cursors:Set<string>,truth:number,unknown:boolean,number:number|null,region:ActualContextRegion}} Value
 * @param {{copy:(value:Value)=>Value}} a
 * @param {{copy:(value:Value['region'])=>Value['region'],same:(left:Value['region'],right:Value['region'])=>boolean}} regions
 * @param {(units:number)=>void} spend
 */
export function commonActualContextValues(a,regions,spend){
  /** @param {Value[]} args */
  const captureArgs=args=>{spend(args.length);return args.map(value=>{
    const captured=a.copy(value);spend(captured.pairs.size*3);
    for(const [id,pair]of captured.pairs)captured.pairs.set(id,{functionId:pair.functionId,environment:pair.environment});
    return {...captured,region:regions.copy(value.region)};
  });};
  const text=value=>spend(Math.ceil(value.length/64)+1);
  /** @param {Value} left @param {Value} right */
  const samePayload=(left,right)=>{
    spend(9);
    if(left.truth!==right.truth||left.unknown!==right.unknown||left.number!==right.number
      ||left.tags.size!==right.tags.size||left.refs.size!==right.refs.size||left.cells.size!==right.cells.size
      ||left.frames.size!==right.frames.size||left.cursors.size!==right.cursors.size||left.pairs.size!==right.pairs.size)return false;
    // Rejected scalar/size cases do not visit either payload collection. Keep
    // the complete original traversal fee for every candidate that can match.
    spend(left.tags.size+left.refs.size+left.cells.size+left.frames.size+left.cursors.size+left.pairs.size
      +right.tags.size+right.refs.size+right.cells.size+right.frames.size+right.cursors.size+right.pairs.size);
    for(const name of ['tags','refs','cells','frames','cursors']){
      for(const id of left[name]){text(id);if(!right[name].has(id))return false;}
    }
    for(const [id,pair]of left.pairs){text(id);const other=right.pairs.get(id);if(!other)return false;
      text(pair.functionId);text(other.functionId);spend(1);
      if(pair.functionId!==other.functionId)return false;
      if(pair.environment!==null)text(pair.environment);if(other.environment!==null)text(other.environment);
      if(pair.environment!==other.environment)return false;}
    return true;
  };
  /** @param {Value} left @param {Value} right */
  const sameValue=(left,right)=>samePayload(left,right)&&regions.same(left.region,right.region);
  return {captureArgs,samePayload,sameValue};
}

/**
 * @template {{tags:Set<string>,refs:Set<string>,cells:Set<string>,pairs:Map<string,{functionId:string,environment:string|null}>,frames:Set<string>,cursors:Set<string>,truth:number,unknown:boolean,number:number|null,region:ActualContextRegion}} Value
 * @template Frames,RegionHeap
 * @param {{target:string,args:Value[],heap:Map<string,Value>,frameWorld:Frames,regionHeap:RegionHeap,activation:string,repeated:boolean,regionScope:string}} input
 * @param {{copy:(value:Value)=>Value,reachable:(values:Value[],heap:Map<string,Value>)=>Map<string,Value>}} a
 * @param {{snapshot:(world:Frames,values:Value[],heap:Map<string,Value>)=>{frames:Frames,retained:Value[]}}} receiver
 * @param {{copy:(value:Value['region'])=>Value['region'],same:(left:Value['region'],right:Value['region'])=>boolean,reachable:(values:Value['region'][],heap:RegionHeap)=>RegionHeap}} regions
 * @param {(units:number)=>void} spend
 */
export function commonActualContextSnapshot({target,args,heap,frameWorld,regionHeap,activation,repeated,regionScope},a,receiver,regions,spend) {
  // select/retained are owned frame/value snapshots, including selected parent
  // frames. A bound receiver can be hidden behind a frame-only argument.
  const {frames:entryFrames,retained}=receiver.snapshot(frameWorld,args,heap);
  spend(args.length+retained.length+1);const roots=[];
  for(const value of args)roots.push(value);for(const value of retained)roots.push(value);
  const entryHeap=a.reachable(roots,heap);
  spend(roots.length+entryHeap.size);for(const value of [...roots,...entryHeap.values()])check(value.tags.size<=256&&value.refs.size<=256&&value.cells.size<=256&&value.pairs.size<=256,'limit');
  spend(roots.length+entryHeap.size);const relations=roots.map(value=>value.region);
  for(const value of entryHeap.values())relations.push(value.region);
  const entryRegions=regions.reachable(relations,regionHeap);
  const identityArgs=commonActualContextValues(a,regions,spend).captureArgs(args);
  return {target,args:identityArgs,retained,activation,repeated,regionScope,entryHeap,entryFrames,entryRegions};
}


/**
 * Compare complete owned entry identities, not widened execution snapshots.
 * The caller keeps these entries immutable and forks execution state.
 * @param {ReturnType<typeof commonActualContextSnapshot>} left
 * @param {ReturnType<typeof commonActualContextSnapshot>} right
 * @param {ReturnType<typeof commonActualContextValues>} identity
 * @param {{same:(left:ReturnType<typeof commonActualContextSnapshot>['entryFrames'],right:ReturnType<typeof commonActualContextSnapshot>['entryFrames'],identity:ReturnType<typeof commonActualContextValues>)=>boolean}} receiver
 * @param {{heapSame:(left:ReturnType<typeof commonActualContextSnapshot>['entryRegions'],right:ReturnType<typeof commonActualContextSnapshot>['entryRegions'])=>boolean}} regions
 * @param {(units:number)=>void} spend
 */
export function commonActualContextSame(left,right,identity,receiver,regions,spend){
  spend(Math.ceil((left.target.length+right.target.length+left.activation.length+right.activation.length+left.regionScope.length+right.regionScope.length)/64)+4);
  if(left.target!==right.target||left.activation!==right.activation||left.repeated!==right.repeated||left.regionScope!==right.regionScope||left.args.length!==right.args.length||left.entryHeap.size!==right.entryHeap.size||left.retained.length!==right.retained.length)return false;
  for(let index=0;index<left.args.length;index++){spend(1);if(!identity.sameValue(left.args[index],right.args[index]))return false;}
  if(!receiver.same(left.entryFrames,right.entryFrames,identity)||!regions.heapSame(left.entryRegions,right.entryRegions))return false;
  for(let index=0;index<left.retained.length;index++){spend(1);if(!identity.sameValue(left.retained[index],right.retained[index]))return false;}
  for(const [id,value]of right.entryHeap){spend(Math.ceil(id.length/64)+1);const old=left.entryHeap.get(id);if(!old||!identity.sameValue(old,value))return false;}
  return true;
}
