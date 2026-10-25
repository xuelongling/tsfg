// SPDX-License-Identifier: MIT
// Normal-return field graphs are parameter-relative templates for the existing
// reaching-state transaction. They carry current versions and alias continuity,
// never payloads, allocation owners, bounds or a second memory solver.
import {canonical} from './identity.mjs';
export function createFieldReturnGraphs(charge){
  const summaries=new Map();
  function snapshot(root,state,parameters,fresh,payload){
    if(!root||!fresh.has(root))return null;
    const nodes=[],positions=new Map(),work=[];
    const reference=token=>{
      charge();if(!token)return null;
      let parameter=-1;for(const [index,value]of parameters.entries()){charge();if(value===token){parameter=index;break;}}
      if(parameter>=0)return {parameter};
      if(!fresh.has(token))return null;
      if(!positions.has(token)){positions.set(token,nodes.length);nodes.push({origin:token,fields:[]});work.push(token);}
      return {node:positions.get(token)};
    };
    const head=reference(root);
    for(let cursor=0;cursor<work.length;++cursor){
      charge();const token=work[cursor],node=nodes[positions.get(token)];
      for(const [location,values]of state){
        charge();const [receiver,actualType,field]=location.split('\0');if(receiver!==token)continue;
        const versions=[],children=[];
        for(const version of values){charge();versions.push(version);children.push(payload(token,version));}
        const child=children.length&&children.every(value=>{charge();return value&&value===children[0];})?reference(children[0]):null;
        node.fields.push({actualType,field,versions:versions.sort(),child});
      }
      node.fields.sort((a,b)=>{charge();return canonical(a)<canonical(b)?-1:1;});
    }
    return {root:head,nodes};
  }
  return {
    update(functionId,parameters,returns,fresh,payload,recursive=false){
      if(recursive){charge();summaries.set(functionId,null);return;}
      const results=[];for(const row of returns){charge();results.push(snapshot(row.token,row.state,parameters,fresh,payload));}
      const first=results[0],key=first?canonical(first):null;
      const complete=key&&results.every(value=>{charge();return value&&canonical(value)===key;});
      summaries.set(functionId,complete?first:null);
    },
    instantiate(functionId,occurrence,actuals){
      charge();const summary=summaries.get(functionId);if(!summary)return null;
      const tokens=[],fields=new Map(),children=[];
      for(const node of summary.nodes){charge();tokens.push('#return/'+canonical([occurrence,functionId,node.origin]));}
      const resolve=ref=>{charge();return !ref?null:ref.parameter!==undefined?actuals[ref.parameter]??null:tokens[ref.node];};
      for(const [index,node]of summary.nodes.entries())for(const field of node.fields){
        charge();const versions=new Set(),child=resolve(field.child);
        for(const version of field.versions){charge();versions.add(version);children.push({receiver:tokens[index],version,child});}
        fields.set(tokens[index]+'\0'+field.actualType+'\0'+field.field,versions);
      }
      return {root:resolve(summary.root),tokens,fields,children};
    },
    ledger(){
      const result=[];for(const [functionId,graph]of summaries){
        charge();if(graph)for(const node of graph.nodes){charge();for(const field of node.fields){
          charge();for(const version of field.versions)charge();if(field.child)charge();}}
        result.push([functionId,graph?canonical(graph):null]);}return result;
    },
  };
}
