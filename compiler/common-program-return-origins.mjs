// SPDX-License-Identifier: MIT
// Fixed return/content equations. Data heaps, continuation control, Code/Env
// and Actual/Borrow authority remain separate. This module accepts no AST.
import {canonical,commonCheck as check} from './common-program-common.mjs';
import {solveReturnOriginContexts} from './common-program-return-origin-domain.mjs';
const format=Object.freeze({family:'tsfg.return-origin-graph-candidate',version:3});
const flags=['read','write','structural'];
const chargeValue=(value,spend)=>{const pending=[value];while(pending.length){spend();const selected=pending.pop();
  if(typeof selected==='string')spend(Math.ceil(selected.length/8)+1);
  else if(Array.isArray(selected)){spend(selected.length);for(const child of selected)pending.push(child);}
  else if(selected!==null&&typeof selected==='object')for(const name in selected){spend(Math.ceil(name.length/8)+1);pending.push(selected[name]);}}};
const graphCanonical=(value,spend)=>{chargeValue(value,spend);return canonical(value);};
const add=(target,source,spend)=>{for(const value of source){spend();target.add(value);}};

export function commonReturnOrigins(spend,{projectField=()=>null,mayAlias=()=>true,actualType=()=>null,contracts=new Map()}={}) {
  const nodes=[],heaps=[{kind:'entry'}],controls=[{kind:'entry'}],calls=[],accesses=new Map(),interned=new Map(),valuePhis=new Map(),heapPhis=new Map(),controlPhis=new Map();
  let state={heap:0,control:0},revision=0,solvedRevision=-1,solved;
  const key=value=>graphCanonical(value,spend);
  const ordered=values=>{spend((values.size??values.length)+1);const result=[...values];result.sort((a,b)=>{spend();return a-b;});return result;};
  const union=sets=>{const result=new Set();for(const values of sets)add(result,values,spend);return result;};
  const node=(value,identity=null)=>{spend();const encoded=identity??key(value),old=interned.get(encoded);if(old!==undefined)return old;
    check(nodes.length<65536,'limit');const id=nodes.length;nodes.push(value);interned.set(encoded,id);revision++;return id;};
  const append=(directory,value)=>{spend();chargeValue(value,spend);check(directory.length<65536,'limit');const id=directory.length;directory.push(value);revision++;return id;};
  const root=(kind,type,value=null,site=null)=>{
    check(['parameter','global','capture','local','nonowning','unknown'].includes(kind),'return-origins');
    const row=kind==='parameter'?{kind,type,index:value}:['global','capture'].includes(kind)?{kind,type,id:value}:{kind,type:kind==='unknown'?null:type};
    return new Set([node(row,site===null?null:key([row,site]))]);
  };
  const select=(bases,selector,type,view)=>{spend(bases.size+1);return new Set([node({kind:'projection',type,bases:ordered(bases),selector,view,...state})]);};
  const gate=(inputs,type=null)=>{spend(inputs.size+1);return new Set([node({kind:'gate',type,inputs:ordered(inputs),control:state.control})]);};
  const copy=(bases,type,site)=>{spend(bases.size+1);const id=node({kind:'copy',type,bases:ordered(bases),...state,site});
    state={heap:append(heaps,{kind:'copy',previous:state.heap,value:id}),control:state.control};return new Set([id]);};
  const access=(values,flag)=>{check(flags.includes(flag),'return-origins');spend(values.size+1);const row={values:ordered(values),flag,control:state.control};const encoded=key(row);
    if(!accesses.has(encoded)){accesses.set(encoded,row);revision++;}};
  /**
   * @param {Set<number>} bases
   * @param {string} selector
   * @param {Set<number>} values
   * @param {{view?:string, initialize?:boolean}} [options]
   */
  const write=(bases,selector,values,{view,initialize=false}={})=>{
    spend(bases.size+values.size+1);access(bases,'write');
    state={heap:append(heaps,{kind:'store',previous:state.heap,bases:ordered(bases),selector,view,values:ordered(values),initialize,control:state.control}),control:state.control};
  };
  const phi=(type,values,site)=>{
    spend(values.size+1);let id=valuePhis.get(site);if(id===undefined){id=node({kind:'join',type,inputs:[]},key(['phi',site]));valuePhis.set(site,id);}
    spend(nodes[id].inputs.length);const inputs=new Set(nodes[id].inputs);add(inputs,values,spend);inputs.delete(id);const next=ordered(inputs);
    if(next.length!==nodes[id].inputs.length){nodes[id].inputs=next;revision++;}return new Set([id]);
  };
  const joinDirectory=(directory,intern,parents,site)=>{
    spend(parents.size+1);if(parents.size===1&&site===null)return [...parents][0];let id=site===null?undefined:intern.get(site);
    if(id===undefined){id=append(directory,{kind:'join',inputs:[]});if(site!==null)intern.set(site,id);}
    spend(directory[id].inputs.length);const inputs=new Set(directory[id].inputs);add(inputs,parents,spend);inputs.delete(id);const next=ordered(inputs);
    if(next.length!==directory[id].inputs.length){directory[id].inputs=next;revision++;}return id;
  };
  const mergeStates=(parents,site=null)=>{
    spend(parents.length*2+1);return {heap:joinDirectory(heaps,heapPhis,new Set(parents.map(value=>value.heap)),site),control:joinDirectory(controls,controlPhis,new Set(parents.map(value=>value.control)),site)};
  };
  const checkpoint=()=>({...state});
  const restore=selected=>{spend();check(Number.isInteger(selected.heap)&&selected.heap>=0&&selected.heap<heaps.length&&Number.isInteger(selected.control)&&selected.control>=0&&selected.control<controls.length,'return-origins');state={...selected};};
  const call=(functionId,args,type,site)=>{
    spend(args.length+1);const arguments_=args.map(ordered),id=append(calls,{functionId,arguments:arguments_,...state,site});
    const normalControl=append(controls,{kind:'call',call:id,completion:'normal'}),languageControl=append(controls,{kind:'call',call:id,completion:'language'});
    const normalState={heap:append(heaps,{kind:'call',call:id,completion:'normal'}),control:normalControl},languageState={heap:append(heaps,{kind:'call',call:id,completion:'language'}),control:languageControl};
    const normal=new Set([node({kind:'call',type,call:id,completion:'normal'})]),language=new Set([node({kind:'call',type:null,call:id,completion:'language'})]);
    state=normalState;return {normal,language,normalState,languageState};
  };
  const solve=()=>{if(solvedRevision===revision)return solved;spend(accesses.size+1);const graph={nodes,heaps,controls,calls,accesses:[...accesses.values()],normal:[],language:[],exits:{normal:[state],language:[]}};
    solved=solveReturnOriginContexts(graph,contracts,{projectField,mayAlias,actualType},spend);solvedRevision=revision;return solved;};
  const owners=values=>solve().owners(values);
  const effects=()=>{const result=solve();return {accesses:result.effects,facets:result.facets,calls:result.calls};};
  const live=selected=>solve().live(selected.control);
  const snapshot=(normal,language,exits={normal:[state],language:language.size?[state]:[]})=>{
    spend(normal.size+language.size+exits.normal.length*2+exits.language.length*2+accesses.size+calls.length+1);
    const seen={nodes:new Set(),heaps:new Set(),controls:new Set(),calls:new Set()},pending=[];
    const push=(kind,ids)=>{spend(ids.length??ids.size);for(const id of ids)pending.push({kind,id});};
    push('nodes',normal);push('nodes',language);for(const completion of ['normal','language'])for(const selected of exits[completion]){spend();push('heaps',[selected.heap]);push('controls',[selected.control]);}
    for(const row of accesses.values()){spend();push('nodes',row.values);push('controls',[row.control]);}for(let id=0;id<calls.length;id++){spend();push('calls',[id]);}
    const directories={nodes,heaps,controls,calls};
    while(pending.length){spend();const {kind,id}=pending.pop();if(seen[kind].has(id))continue;seen[kind].add(id);const row=directories[kind][id];
      if(kind==='nodes'){
        if(row.kind==='join'||row.kind==='gate')push('nodes',row.inputs);
        if(row.kind==='gate'||row.kind==='projection'||row.kind==='copy')push('controls',[row.control]);
        if(row.kind==='projection'||row.kind==='copy'){push('nodes',row.bases);push('heaps',[row.heap]);}
        if(row.kind==='call')push('calls',[row.call]);
      }else if(kind==='heaps'){
        if(row.kind==='join')push('heaps',row.inputs);
        if(row.kind==='store'){push('heaps',[row.previous]);push('nodes',row.bases);push('nodes',row.values);push('controls',[row.control]);}
        if(row.kind==='copy'){push('heaps',[row.previous]);push('nodes',[row.value]);}
        if(row.kind==='call')push('calls',[row.call]);
      }else if(kind==='controls'){
        if(row.kind==='join')push('controls',row.inputs);if(row.kind==='call')push('calls',[row.call]);
      }else{push('heaps',[row.heap]);push('controls',[row.control]);for(const argument of row.arguments)push('nodes',argument);}
    }
    const ids={},maps={};for(const kind of ['nodes','heaps','controls','calls']){ids[kind]=ordered(seen[kind]);spend(ids[kind].length*2);maps[kind]=new Map(ids[kind].map((id,index)=>[id,index]));}
    const refs=(kind,values)=>{spend((values.size??values.length)*2+1);return ordered(new Set([...values].map(id=>maps[kind].get(id))));};
    const valueRows=ids.nodes.map(id=>{spend();const row=nodes[id];if(row.kind==='join')return {...row,inputs:refs('nodes',row.inputs)};
      if(row.kind==='gate')return {...row,inputs:refs('nodes',row.inputs),control:maps.controls.get(row.control)};
      if(row.kind==='projection'||row.kind==='copy')return {...row,bases:refs('nodes',row.bases),heap:maps.heaps.get(row.heap),control:maps.controls.get(row.control)};
      return row.kind==='call'?{...row,call:maps.calls.get(row.call)}:{...row};});
    const heapRows=ids.heaps.map(id=>{spend();const row=heaps[id];if(row.kind==='join')return {...row,inputs:refs('heaps',row.inputs)};
      if(row.kind==='store')return {...row,previous:maps.heaps.get(row.previous),bases:refs('nodes',row.bases),values:refs('nodes',row.values),control:maps.controls.get(row.control)};
      if(row.kind==='copy')return {...row,previous:maps.heaps.get(row.previous),value:maps.nodes.get(row.value)};return row.kind==='call'?{...row,call:maps.calls.get(row.call)}:{...row};});
    const controlRows=ids.controls.map(id=>{spend();const row=controls[id];return row.kind==='join'?{...row,inputs:refs('controls',row.inputs)}:row.kind==='call'?{...row,call:maps.calls.get(row.call)}:{...row};});
    const callRows=ids.calls.map(id=>{spend();const row=calls[id];spend(row.arguments.length);return {...row,arguments:row.arguments.map(argument=>refs('nodes',argument)),heap:maps.heaps.get(row.heap),control:maps.controls.get(row.control)};});
    spend(accesses.size*2);const terminals=[...accesses.values()].map(row=>({values:refs('nodes',row.values),flag:row.flag,control:maps.controls.get(row.control)}));
    const decorated=terminals.map(row=>({row,key:key(row)}));decorated.sort((a,b)=>{spend();return a.key<b.key?-1:a.key>b.key?1:0;});
    const exitRows=values=>{spend(values.length*2+1);const result=values.map(value=>({heap:maps.heaps.get(value.heap),control:maps.controls.get(value.control)}));result.sort((a,b)=>{spend();return a.heap-b.heap||a.control-b.control;});return result.filter((value,index)=>{spend();return index===0||value.heap!==result[index-1].heap||value.control!==result[index-1].control;});};
    return {format,nodes:valueRows,heaps:heapRows,controls:controlRows,calls:callRows,normal:refs('nodes',normal),language:refs('nodes',language),exits:{normal:exitRows(exits.normal),language:exitRows(exits.language)},accesses:decorated.map(item=>item.row)};
  };
  return {root,select,gate,copy,write,access,call,owners,effects,live,snapshot,union,phi,checkpoint,restore,mergeStates};
}
