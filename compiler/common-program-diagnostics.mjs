// SPDX-License-Identifier: MIT
// Diagnostic provenance follows the same fixed effects and real call sites.
import {commonEffects} from './common-program-effects.mjs';
import {canonical,own} from './common-program-common.mjs';

/** @typedef {Readonly<{sourceId:string,start:number,end:number}>} DiagnosticSource */
/** @typedef {Readonly<{kind:'facet',facet:string}>|Readonly<{kind:'host-resource',resource:string,access:'read'|'write'}>|Readonly<{kind:'capture',slot:string,access:'read'|'write'|'structural'}>} KernelDiagnosticReason */
/** @typedef {Readonly<{kind:'operation'|'function'|'fixed-upper'|'unknown',functionId:string,source:DiagnosticSource,operation?:string,contractDigest?:string}>} KernelDiagnosticOrigin */
/** @typedef {Readonly<{caller:string,callee:string,kind:string,source:DiagnosticSource}>} KernelDiagnosticEdge */
/** @typedef {Readonly<{version:1,root:Readonly<{functionId:string,source:DiagnosticSource}>,reason:KernelDiagnosticReason,edges:readonly KernelDiagnosticEdge[],origin:KernelDiagnosticOrigin}>} KernelCallChain */

/** @param {KernelDiagnosticReason} reason @returns {KernelCallChain} */
export function commonKernelCallChain(prepared,analysis,root,reason){
  const {hir,records,physical}=prepared,functions=new Map(hir.functions.map(fn=>[fn.id,fn])),current=new Map(analysis.functions.map(fn=>[fn.functionId,fn]));
  const source=id=>({sourceId:functions.get(id).sourcePath,...functions.get(id).range});
  const contains=upper=>reason.kind==='facet'?upper.facets[reason.facet]:reason.kind==='host-resource'?upper.hostResources[reason.access==='read'?'reads':'writes'].includes(reason.resource):
    upper.captures.some(row=>row.slot===reason.slot&&row[reason.access]);
  const pending=[root],parents=new Map([[root,null]]);let selected=root;
  /** @type {KernelDiagnosticOrigin} */
  let origin={kind:'unknown',functionId:root,source:source(root)};
  // Cancellation belongs to this optional diagnostic, never the reject rule.
  const exhausted=new RangeError('bounded kernel diagnostic search exhausted');let remaining=100000;
  const spend=(amount=1)=>{if(amount>remaining)throw exhausted;remaining-=amount;};
  try{
    const effects=commonEffects(hir,spend,physical),uppers=new Map([...records].map(([id,row])=>[id,row.upper]));
    for(let index=0;index<pending.length;index++){
      spend();selected=pending[index];origin={kind:'unknown',functionId:selected,source:source(selected)};
      if(!contains(current.get(selected).effective)){
        origin={kind:'fixed-upper',functionId:selected,source:source(selected),contractDigest:records.get(selected).digest};break;
      }
      const derived=effects.derive(functions.get(selected),uppers,true),local=derived.local.get(canonical(reason));
      if(local){origin=local;break;}
      if(reason.kind==='facet'&&!contains(derived.upper)&&['managedReference','escape'].includes(reason.facet)){
        origin={kind:'function',functionId:selected,source:source(selected),operation:reason.facet==='escape'?'derivedEscape':'derivedManagedReference'};break;
      }
      const edges=derived.calls.map(row=>({caller:row.functionId,callee:row.target,kind:row.kind,source:{sourceId:row.sourcePath,...row.range}}));
      edges.sort((a,b)=>{spend();const left=[a.source.sourceId,a.source.start,a.source.end,a.callee,a.kind],right=[b.source.sourceId,b.source.start,b.source.end,b.callee,b.kind];
        for(let i=0;i<left.length;i++)if(left[i]!==right[i])return left[i]<right[i]?-1:1;return 0;});
      for(const edge of edges){spend();if(!contains(records.get(edge.callee).upper)||parents.has(edge.callee))continue;parents.set(edge.callee,{parent:selected,edge});pending.push(edge.callee);}
    }
  }catch(error){if(error!==exhausted)throw error;}
  const edges=[];for(let id=selected;parents.get(id)!==null;){const row=parents.get(id);edges.push(row.edge);id=row.parent;}
  edges.reverse();return own({version:1,root:{functionId:root,source:source(root)},reason,edges,origin});
}
