// SPDX-License-Identifier: MIT
// Private stored-value graph: shared reference planes, value copies and
// transactional snapshots. Source traversal and call selection remain outside.
/** @typedef {{kind:'unknown'}|{kind:'owner',owner:any,span:boolean,sources:any[],type?:string}|StoredPlane|
 * {kind:'choice',values:StoredValue[]}|{kind:'inputField',index:number,properties:(string|number)[]}|
 * {kind:'loaded',value:StoredValue,tokens:any[]}} StoredValue */
/** @typedef {{kind:'aggregate',id:number,type:string,slot:number|null,fallback:number|null,
 * invalidated:boolean,extent:number|null,extentChanged:boolean,extentTokens:any[],fields:Map<string,StoredValue>,owner?:any}} StoredPlane */
export function createSpanPlanes(type,charge,authority){
  const unknown=Object.freeze({kind:'unknown'});
  let serial=0;
  const choice=rows=>{
    const values=new Set(),work=[];for(const row of rows){charge();work.push(row??unknown);}
    while(work.length){charge();const row=work.pop();if(row.kind==='choice')for(const child of row.values){charge();work.push(child);}else values.add(row);}
    return values.size===1?[...values][0]:{kind:'choice',values:[...values]};
  };
  const leaves=value=>{const result=[],work=[value??unknown];while(work.length){charge();const row=work.pop();
    if(row.kind==='loaded')work.push(row.value);
    else if(row.kind==='choice')for(const child of row.values){charge();work.push(child);}else result.push(row);}return result;};
  const transform=(value,map)=>{
    charge();if(value?.kind==='loaded')return {kind:'loaded',value:transform(value.value,map),tokens:value.tokens};
    return value?.kind==='choice'?choice(value.values.map(row=>transform(row,map))):map(value??unknown);
  };
  const inherit=(value,from)=>{
    const tokens=[],work=[from];while(work.length){charge();const row=work.pop();
      if(row?.kind==='loaded'){for(const token of row.tokens){charge();tokens.push(token);}work.push(row.value);}
      else if(row?.kind==='choice')for(const child of row.values){charge();work.push(child);}}
    return tokens.length?{kind:'loaded',value,tokens}:value;
  };
  /** @returns {StoredPlane} */
  const aggregate=(actual,slot=null,owner=undefined)=>({kind:'aggregate',id:++serial,type:actual,slot,
    fallback:slot===null?null:slot,invalidated:false,extent:null,extentChanged:false,extentTokens:[],fields:new Map(),owner});
  const copy=value=>{
    const copied=new Map(),work=[];
    const one=row=>{
      charge();if(row?.kind==='loaded')return {kind:'loaded',value:one(row.value),tokens:row.tokens};
      if(row?.kind==='choice')return choice(row.values.map(one));
      if(row?.kind!=='aggregate'||type.types.get(row.type)?.kind!=='value')return row??unknown;
      if(copied.has(row))return copied.get(row);const target=aggregate(row.type);target.fallback=row.fallback;
      target.invalidated=row.invalidated;target.extent=row.extent;target.extentChanged=row.extentChanged;
      for(const token of row.extentTokens){charge();target.extentTokens.push(token);}copied.set(row,target);work.push([row,target]);return target;
    };
    const result=one(value);
    while(work.length){charge();const [from,to]=work.pop();for(const [field,payload]of from.fields){charge();to.fields.set(field,one(payload));}}
    return result;
  };
  const field=(object,property)=>{
    if(type.isArray(object.type))return typeof property==='number'?'slot/'+property:property?.startsWith('slot/')?property:null;
    let current=type.types.get(object.type);
    while(current){charge();for(const item of current.fields??[]){charge();if(item.id===property)return item.id;}current=type.types.get(current.base);}
    for(const view of authority().views.values())if(view.actualType===object.type)
      for(const pair of view.fields){charge();if(pair.target===property)return pair.source;}
    return null;
  };
  const inputField=(index,property,before=[])=>{
    const properties=[];for(const member of before){charge();properties.push(member);}charge();properties.push(property);
    return {kind:'inputField',index,properties};
  };
  const read=(receiver,property)=>transform(receiver,object=>{
    if(object.kind==='inputField')return property===null?unknown:inputField(object.index,property,object.properties);
    charge();if(object.kind!=='aggregate'||property===null)return unknown;const member=field(object,property);if(!member)return unknown;
    if(object.fields.has(member))return object.fields.get(member);
    return object.fallback===null||object.invalidated?unknown:inputField(object.fallback,member);
  });
  const write=(receiver,property,payload,changed)=>{
    const objects=leaves(receiver);
    for(const object of objects){charge();if(object.kind!=='aggregate')continue;const member=field(object,property);if(!member)continue;
      const previous=object.fields.get(member)??(object.fallback!==null&&!object.invalidated
        ?inputField(object.fallback,member):unknown);
      changed(object,member);object.fields.set(member,objects.length!==1?choice([previous,payload]):payload);
      if(type.isArray(object.type)){
        const slot=Number(member.slice(5));
        if(object.extent===null)object.extentChanged=true;
        else if(slot>=object.extent){changed(object,'extent');object.extentChanged=true;
          object.extent=slot===object.extent&&objects.length===1?slot+1:null;}
      }
    }
  };
    /** @param {Iterable<StoredValue>} roots @param {Iterable<StoredValue>} extra */
    const snapshot=(roots,extra=[])=>{
      const state=new Map(),work=[];for(const rows of [roots,extra])for(const root of rows){charge();work.push(root);}
      while(work.length){charge();const row=work.pop();
        if(row?.kind==='loaded'){work.push(row.value);continue;}
        if(row?.kind==='choice'){for(const value of row.values){charge();work.push(value);}continue;}
        if(row?.kind!=='aggregate'||state.has(row))continue;
        const fields=new Map();for(const [member,value]of row.fields){charge();fields.set(member,value);work.push(value);}
        const extentTokens=[];for(const token of row.extentTokens){charge();extentTokens.push(token);}
        state.set(row,{fields,invalidated:row.invalidated,extent:row.extent,extentChanged:row.extentChanged,extentTokens});
      }
      return state;
    };
    const cloneSnapshot=state=>{
      const clones=new Map();
      for(const [object,item]of state){charge();const clone=aggregate(object.type,object.slot,object.owner);clone.fallback=object.fallback;
        clone.invalidated=item.invalidated;clone.extent=item.extent;clone.extentChanged=item.extentChanged;
        for(const token of item.extentTokens){charge();clone.extentTokens.push(token);}clones.set(object,clone);}
      const remap=row=>{charge();if(row?.kind==='loaded')return {kind:'loaded',value:remap(row.value),tokens:row.tokens};
        return row?.kind==='choice'?choice(row.values.map(remap)):clones.get(row)??row;};
      for(const [object,clone]of clones)for(const [member,payload]of state.get(object).fields){charge();clone.fields.set(member,remap(payload));}
      return {clones,remap};
    };
    const restore=state=>{for(const [object,stored]of state){charge();for(const member of object.fields.keys()){charge();object.fields.delete(member);}
      for(const [member,value]of stored.fields){charge();object.fields.set(member,value);}object.invalidated=stored.invalidated;
      object.extent=stored.extent;object.extentChanged=stored.extentChanged;object.extentTokens=[];
      for(const token of stored.extentTokens){charge();object.extentTokens.push(token);}}};
  const index=value=>{
    while(value&&['group','assertType','nonNull'].includes(value.kind)){charge();value=value.operand;}
    charge();const index=value?.kind==='constant'?Number(value.decimal):NaN;
    return Number.isInteger(index)&&index>=0&&index<=4294967295?index:null;
  };
  const array=(actual,owner,count,element)=>{
    const result=aggregate(actual,null,owner);result.extent=count;result.extentChanged=true;for(let i=0;i<count;++i){
      charge();result.fields.set('slot/'+i,copy(element(i)));}return result;
  };
  const applyWrites=(rows,changed)=>{
    const grouped=new Map();let complete=true;
    for(const row of rows){charge();const candidates=leaves(row.receiver);
      for(const plane of candidates){charge();const member=plane.kind==='aggregate'?field(plane,row.property):null;
        if(member===null){complete=false;continue;}
        if(!grouped.has(plane))grouped.set(plane,new Map());const members=grouped.get(plane);
        if(!members.has(member))members.set(member,[]);const payloads=members.get(member);payloads.push(row.value);
        if(candidates.length!==1)payloads.push(read(plane,row.property));
      }
    }
    for(const [plane,members]of grouped)for(const [member,payloads]of members){charge();write(plane,member,choice(payloads),changed);}
    return complete;
  };
  const extent=(receiver,limit,changed,invalidate)=>{
    const candidates=leaves(receiver),unique=candidates.length===1;
    for(const plane of candidates)if(plane.kind==='aggregate'){
      // A possible receiver may instead be skipped. Preserve that state's
      // slots and extent rather than truncating every alias alternative.
      if(!unique){
        for(const [member,value]of plane.fields){
          charge();if(limit===null||Number(member.slice(5))>=limit){
            changed(plane,member);plane.fields.set(member,choice([value,unknown]));}}
        if(plane.extent!==limit){changed(plane,'extent');plane.extent=null;}
        plane.extentChanged=true;if(limit===null)plane.invalidated=true;
      }else if(limit===null)invalidate(plane);
      else{if(plane.extent!==limit)changed(plane,'extent');plane.extent=limit;plane.extentChanged=true;for(const member of plane.fields.keys()){
        charge();if(Number(member.slice(5))>=limit){changed(plane,member);plane.fields.delete(member);}}
        // Unknown incoming slots cannot survive a structural boundary.
        if(plane.fallback!==null){changed(plane,null);plane.invalidated=true;}}
    }
  };
  const truncate=(receiver,length,changed,invalidate)=>extent(receiver,index(length),changed,invalidate);
  const elements=plane=>{
    charge();if(plane.extent===null)return null;const values=[];
    for(let i=0;i<plane.extent;++i){charge();const member='slot/'+i;
      if(!plane.fields.has(member))return null;values.push(plane.fields.get(member));}return values;
  };
  return {unknown,choice,leaves,inherit,aggregate,copy,inputField,read,write,snapshot,cloneSnapshot,restore,index,array,truncate,elements,extent,substitute:transform,applyWrites};
}
