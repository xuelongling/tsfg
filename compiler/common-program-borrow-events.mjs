// SPDX-License-Identifier: MIT
// A projection of verified physical provenance families, never alias authority.
import {canonical,commonCheck as check} from './common-program-common.mjs';

/** @typedef {Readonly<{path:string,start:number,end:number}>} BorrowSource */
/** @typedef {Readonly<{functionId:string,block:number,index:number,name:string,source:BorrowSource}>} BorrowSite */
/** @typedef {Readonly<{root:string,recursive:boolean,steps:readonly Readonly<{functionId:string,block:number,index:number,target:string}>[]}>} BorrowActivation */
/** @typedef {Readonly<{functionId:string,block:number|null,index:number|null,name:string,source:BorrowSource,kind:'entry'|'operation'|'fixed',completion:'normal'|'language'|null,activation:BorrowActivation}>} BorrowPoint */
/** @typedef {Readonly<{kind:'parameter'|'global'|'allocation',functionId:string|null,binding:string|null,index:number|null,path:readonly string[],site:BorrowSite|null,activation:BorrowActivation|null}>} BorrowOrigin */
/** @typedef {Readonly<{type:string,weak:boolean,origins:readonly BorrowOrigin[]}>} BorrowReference */
/** @typedef {Readonly<{definitions:readonly Readonly<{at:BorrowPoint,descriptor:BorrowReference,owners:readonly BorrowReference[],pending:boolean}>[],uses:readonly Readonly<{at:BorrowPoint,descriptors:readonly BorrowReference[]}>[],effects:readonly Readonly<{at:BorrowPoint,owners:readonly BorrowReference[],pending:boolean,eligible:readonly BorrowReference[]|null}>[],calls:readonly Readonly<{at:BorrowPoint,target:string,completion:'normal'|'language',exit:BorrowPoint,successor:BorrowPoint}>[],flows:readonly Readonly<{from:BorrowPoint,to:BorrowPoint}>[]}>} CommonBorrowEvents */

export function commonBorrowEvents({model,objects,cyclicFunctions}){
  const {spend}=model,contexts=new Map(),locations=new Map(),operations=new WeakMap(),blockSites=new Map(),origins=new Map(),definitions=[],uses=[],effects=[],calls=[],returns=new Map(),edges=new Map();
  const sorted=rows=>{const table=new Map();for(const row of rows){spend();table.set(canonical(row),row);}spend(table.size);return [...table].sort(([a],[b])=>{spend();return Buffer.compare(Buffer.from(a),Buffer.from(b));}).map(([,row])=>row);};
  const source=(c,range)=>({path:c.plan.owner.sourcePath,...range});
  const entry=c=>({functionId:c.plan.owner.id,block:null,index:null,name:'entry',source:source(c,c.plan.owner.range)});
  function site(c,op){
    if(!operations.has(op))for(const [block,row]of c.plan.graph.blocks.entries())for(const [index,value]of row.instructions.entries()){
      spend();operations.set(value,{functionId:c.plan.owner.id,block,index,name:value.name.replace('tsfg_program.',''),source:source(c,value.range)});
    }return operations.get(op);
  }
  function addOrigin(ref,origin){spend();check(objects.has(ref),'borrow-proof','proof reference lacks an actual object');const rows=origins.get(ref)??[];rows.push(origin);check(rows.length<=4096,'limit');origins.set(ref,rows);}
  function seed(value,heap,base){
    const pending=[{value,path:[]}],seen=new Set();
    for(let i=0;i<pending.length;i++){
      spend();const {value,path}=pending[i],roots=new Set(value.refs);for(const pair of value.pairs.values())if(pair.environment)roots.add(pair.environment);
      for(const ref of roots){spend();if(seen.has(ref))continue;seen.add(ref);addOrigin(ref,{...base,path});
        for(const [slot,child]of [...heap].sort(([a],[b])=>a<b?-1:a>b?1:0))if(slot.startsWith(ref+'/')){spend();pending.push({value:child,path:[...path,slot.slice(ref.length+1)]});}
      }
      for(const cell of value.cells){spend();if(seen.has(cell))continue;seen.add(cell);const child=heap.get(cell);if(child)pending.push({value:child,path:[...path,'cell']});}
      check(pending.length<=65536,'limit');
    }
  }
  function begin(c,heap){
    contexts.set(c.id,c);locations.set(c.id+'/entry',{context:c.id,site:entry(c),kind:'entry',completion:null});
    if(!c.root)return;
    c.args.forEach((value,index)=>seed(value,heap,{kind:'parameter',functionId:c.plan.owner.id,binding:c.plan.parameters[index].id,index,site:null,activation:null}));
    for(const [slot,value]of heap)if(slot.startsWith('global:'))seed(value,heap,{kind:'global',functionId:null,binding:slot.slice(7),index:null,site:null,activation:null});
  }
  const before=(c,op,at)=>locations.set(at,{context:c.id,site:site(c,op),kind:'operation',completion:null});
  function after(c,op,value,at){
    const name=op.name.replace('tsfg_program.','');
    if(name==='array_create'||name==='readspan')for(const ref of value.refs)addOrigin(ref,{kind:'allocation',functionId:c.plan.owner.id,binding:null,index:null,path:[],site:site(c,op),context:c.id});
    if(name==='func.return'||name==='return_throw'){const row=returns.get(c.id)??{normal:new Set(),language:new Set()};row[name==='func.return'?'normal':'language'].add(at);returns.set(c.id,row);}
  }
  function call(at,callee,caller,successors){calls.push({at,callee:callee.id,caller:caller.id,successors});}
  /** @returns {CommonBorrowEvents} */
  function finish(){
    const relevant=new Set([...contexts.keys()].map(id=>id+'/entry'));
    for(const row of definitions)relevant.add(row.at);
    for(const row of uses)relevant.add(row.at);
    for(const row of returns.values())for(const exits of Object.values(row))for(const at of exits)relevant.add(at);
    const paths=new Map();for(const c of contexts.values())if(c.root)paths.set(c.id,[{root:c.plan.owner.id,recursive:false,steps:[]}]);
    let changed=true;while(changed){changed=false;for(const row of calls){
      spend();const target=contexts.get(row.callee).plan.owner.id,at=locations.get(row.at).site;
      const incoming=cyclicFunctions.has(target)?[{root:target,recursive:true,steps:[]}]:
        (paths.get(row.caller)??[]).map(path=>({...path,steps:[...path.steps,{functionId:at.functionId,block:at.block,index:at.index,target}]}));
      const merged=sorted([...(paths.get(row.callee)??[]),...incoming]);check(merged.length<=4096&&merged.every(path=>path.steps.length<=4096),'limit');
      if(canonical(merged)!==canonical(paths.get(row.callee)??[])){paths.set(row.callee,merged);changed=true;}
    }}
    const reference=ref=>{
      spend();const object=objects.get(ref),rows=origins.get(ref);check(object&&rows?.length,'borrow-proof','proof reference has no observed entry/allocation provenance');
      const selected=rows.flatMap(row=>row.kind!=='allocation'?[row]:(paths.get(row.context)??[]).map(activation=>{
        const {context,...origin}=row;return {...origin,activation};}));check(selected.length>0,'borrow-proof','allocation has no actual invocation provenance');
      return {type:object.type,weak:object.weak,origins:sorted(selected)};
    };
    const refs=values=>sorted([...values].map(reference));
    const points=at=>{const row=locations.get(at);check(row,'borrow-proof','borrow point lacks an original operation');return (paths.get(row.context)??[]).map(activation=>({...row.site,kind:row.kind,completion:row.completion,activation}));};
    const definitionsOut=new Map();for(const row of definitions)for(const at of points(row.at)){
      const descriptor=reference(row.ref),key=canonical({at,descriptor}),before=definitionsOut.get(key)??{at,descriptor,owners:[],pending:false};
      before.owners=sorted([...before.owners,...refs(row.owners.ids)]);before.pending ||= row.owners.pending;definitionsOut.set(key,before);
    }
    const usesOut=new Map();for(const row of uses)for(const at of points(row.at)){const key=canonical(at),before=usesOut.get(key)??{at,descriptors:[]};before.descriptors=sorted([...before.descriptors,...refs(row.ids)]);usesOut.set(key,before);}
    const callsOut=[],fixed=new Set();
    for(const row of calls){const callee=contexts.get(row.callee),caller=contexts.get(row.caller),exits=returns.get(row.callee)??{normal:new Set(),language:new Set()};
      relevant.add(row.at);
      for(const [index,completion]of ['normal','language'].entries())for(const exit of exits[completion]){
        fixed.add(row.at+'/fixed-return/'+completion);const block=row.successors[index],physical=blockSites.get(caller.plan.owner.id+'\0'+block);
        check(physical,'borrow-proof','call completion lacks a printed Core operation');
        const successor={context:row.caller,site:physical,kind:'operation',completion:null,alias:true},key=row.caller+'/block/'+block;locations.set(key,successor);relevant.add(key);
        for(const at of points(row.at))for(const end of points(exit))for(const next of points(key))callsOut.push({at,target:callee.plan.owner.id,completion,exit:end,successor:next});
      }
    }
    const effectsOut=new Map();for(const row of effects){if(row.fixed&&!fixed.has(row.at))continue;relevant.add(row.at);
      for(const at of points(row.at)){const eligible=row.eligible===null?null:refs(row.eligible),key=canonical({at,eligible}),before=effectsOut.get(key)??{at,owners:[],pending:false,eligible};
        before.owners=sorted([...before.owners,...refs(row.owners.ids)]);before.pending ||= row.owners.pending;effectsOut.set(key,before);}
    }
    const flows=[];for(const from of relevant)if(edges.has(from)){
      const pending=[...edges.get(from)],seen=new Set();for(let i=0;i<pending.length;i++){
        spend();const to=pending[i];if(seen.has(to))continue;seen.add(to);
        if(relevant.has(to)){for(const start of points(from))for(const end of points(to)){
          if((locations.get(from).alias||locations.get(to).alias)&&canonical(start)===canonical(end))continue;
          flows.push({from:start,to:end});}}
        else for(const next of edges.get(to)??[])pending.push(next);check(pending.length<=65536,'limit');
      }
    }
    return {definitions:sorted(definitionsOut.values()),uses:sorted(usesOut.values()),effects:sorted(effectsOut.values()),calls:sorted(callsOut),flows:sorted(flows)};
  }
  return {begin,before,after,call,finish,
    operationSite(op,physical){const logical=operations.get(op);if(logical)Object.assign(logical,physical);},
    blockSite(functionId,block,physical){const key=functionId+'\0'+block;if(!blockSites.has(key))blockSites.set(key,physical);},
    edge(from,to){const targets=edges.get(from)??new Set();targets.add(to);edges.set(from,targets);},
    define(at,ref,owners,weak){if(weak){const c=contexts.get(locations.get(at).context);at=c.id+'/entry';}definitions.push({at,ref,owners});},
    use(at,ids){if(ids.size)uses.push({at,ids:new Set(ids)});},
    effect(at,owners,origin,eligible=null){const fixed=at.includes('/fixed-return/');if(fixed){const completion=at.endsWith('/normal')?'normal':'language',call=at.slice(0,at.lastIndexOf('/fixed-return/'));locations.set(at,{...locations.get(call),kind:'fixed',completion});}effects.push({at,owners,eligible,fixed});}
  };
}
