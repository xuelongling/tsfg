// SPDX-License-Identifier: MIT
// Canonical fixed layouts are derived from owned semantic types, never imported
// offsets. The independent Runtime reader derives the same layouts from the DTO.
import {own} from './identity.mjs';
import {verifyHir} from './module-hir.mjs';
const codes={i32:1,bool:2,i8:3,i16:4,i64:5,u8:6,u16:7,u32:8,u64:9,isize:10,usize:11,f32:12,f64:13};
const sizes=[0,4,1,1,2,8,1,2,4,8,8,8,4,8];
const align=(value,width)=>Math.ceil(value/width)*width;
function require(value,message='invalid canonical layout') {if(!value)throw new TypeError('r03-typed-layout: '+message);}
/** @param {{depth?:number,work?:number}} [limits] */
function policy(limits={}) {
  const depth=limits.depth??32,work=limits.work??100000;
  require(Number.isInteger(depth)&&depth>=0&&depth<=32&&Number.isInteger(work)&&work>0&&work<=100000,'invalid layout limits');
  return {depth,work};
}
// Charge the expanded tree, not just unique DAG nodes: ownership/printing and
// Runtime clones revisit every occurrence. Memoized costs saturate at the limit
// without ever enumerating an exponential number of shared paths.
/** @param {any} catalogue @param {{depth?:number,work?:number}} [limits] */
export function checkTypedLayoutBudget(catalogue,limits={}) {
  const bound=policy(limits),memo=new Map(),active=new Set();
  function measure(layout,depth=0) {
    require(depth<=bound.depth,'layout depth limit');
    if(memo.has(layout)) {
      const prior=memo.get(layout);require(depth+prior.depth<=bound.depth,'layout depth limit');return prior;
    }
    require(!active.has(layout),'recursive physical layout');active.add(layout);
    const result={work:1,depth:0};
    for(const variant of layout.variants) {
      result.work+=1+variant.fields.length+variant.references.length+variant.children.length;
      require(result.work<=bound.work,'layout work limit');
      for(const child of variant.children) {
        const nested=measure(child.layout,depth+1);result.work+=nested.work;
        result.depth=Math.max(result.depth,nested.depth+1);require(result.work<=bound.work,'layout work limit');
      }
    }
    active.delete(layout);memo.set(layout,result);return result;
  }
  let work=0,depth=0;
  const byId=new Map(catalogue.entries.map(entry=>[entry.typeId,entry.layout]));
  const charge=layout=>{const value=measure(layout);work+=value.work;depth=Math.max(depth,value.depth);require(work<=bound.work,'layout work limit');};
  for(const entry of catalogue.entries) {
    charge(entry.layout);
    for(const field of entry.cell?.fields??[]){const layout=byId.get(field.typeId);require(layout);charge(layout);}
  }
  return {work,depth};
}
/** @param {any} hir @param {any} context @param {{depth?:number,work?:number,publicationContext?:any}} [limits] */
export function buildTypedLayouts(hir,context,limits={}) {
  const bound=policy(limits);let work=bound.work;
  const spend=(count=1)=>{require(count<=work,'layout work limit');work-=count;};
  const owned=verifyHir(hir,context,limits.publicationContext),types=new Map(owned.types.map(type=>[type.id,type]));
  require(owned.types.length<=4096,'catalogue budget');
  const layouts=new Map(),cells=new Map(),active=new Set();
  const blank=(type,byteSize=0,alignment=1,referenceCount=0)=>({typeId:type.id,byteSize,alignment,referenceCount,
    variants:[{tag:0,kind:'value',fields:[],references:[],children:[]}]});
  function allFields(type,seen=new Set(),depth=0) {
    require(depth<=bound.depth,'layout depth limit');spend(1+(type.fields?.length??0));
    require(!seen.has(type.id),'recursive inheritance');seen.add(type.id);
    const fields=[...(type.base?allFields(types.get(type.base),seen,depth+1):[]),...(type.fields??[])];
    require(fields.length<=256,'cell budget');return fields;
  }
  function layout(id,depth=0) {
    require(depth<=bound.depth,'layout depth limit');spend();
    if(layouts.has(id))return layouts.get(id);
    require(!active.has(id),'recursive by-value containment');active.add(id);
    const type=types.get(id);require(type);let result=blank(type);
    if(type.kind==='scalar') {
      const code=codes[type.name];require(code);
      result=blank(type,sizes[code],sizes[code]);result.variants[0].fields.push({offset:0,code});
    }else if(['null','undefined','void'].includes(type.kind))result.variants[0].kind=type.kind==='null'?'null':'undefined';
    else if(['reference','string','array','readSpan'].includes(type.kind)) {
      result=blank(type,type.kind==='readSpan'?8:0,type.kind==='readSpan'?4:1,1);
      result.variants[0].references.push({slot:0,kind:type.kind==='reference'?'cell':type.kind==='string'?'string':'array',
        ...(['array','readSpan'].includes(type.kind)?{typeId:type.elementType}:type.kind==='reference'?{typeId:type.id}:{})});
      if(type.kind==='readSpan')result.variants[0].fields.push({offset:0,code:8},{offset:4,code:8});
    }else if(type.kind==='value') {
      for(const field of allFields(type)) {
        const child=layout(field.type,depth+1),tagOffset=align(result.byteSize,2),offset=align(tagOffset+2,child.alignment);
        result.variants[0].children.push({tagOffset,offset,referenceOffset:result.referenceCount,layout:child});
        result.byteSize=offset+child.byteSize;result.alignment=Math.max(result.alignment,2,child.alignment);
        result.referenceCount+=child.referenceCount;
      }
      result.byteSize=align(result.byteSize,result.alignment);
    }else if(type.kind==='union') {
      result.variants=[];
      for(const [tag,member] of type.members.entries()) {
        const child=layout(member,depth+1),memberType=types.get(member),absent=['null','undefined'].includes(memberType.kind);
        const offset=align(2,child.alignment);result.alignment=Math.max(result.alignment,2,child.alignment);
        result.byteSize=Math.max(result.byteSize,absent?0:offset+child.byteSize);
        result.referenceCount=Math.max(result.referenceCount,child.referenceCount);
        result.variants.push({tag,kind:absent?memberType.kind:'value',fields:[],references:[],
          children:absent?[]:[{tagOffset:0,offset,referenceOffset:0,layout:child}]});
      }
      result.byteSize=align(result.byteSize,result.alignment);
    }else require(false,'unsupported type kind');
    require(result.byteSize<=65536&&result.referenceCount<=256&&result.variants.length<=256,'layout budget');
    active.delete(id);layouts.set(id,result);return result;
  }
  for(const type of owned.types)layout(type.id);
  for(const type of owned.types)if(['reference','value'].includes(type.kind)) {
    let byteSize=0,alignment=1,referenceCount=0;
    const fields=allFields(type).map(field=>{
      const value=layout(field.type),offset=align(byteSize,value.alignment),referenceOffset=referenceCount;
      byteSize=offset+value.byteSize;alignment=Math.max(alignment,value.alignment);referenceCount+=value.referenceCount;
      return {id:field.id,typeId:field.type,offset,referenceOffset,readonly:field.readonly};
    });
    require(fields.length<=256&&byteSize<=65536&&referenceCount<=256,'cell budget');
    cells.set(type.id,{typeId:type.id,runtimeKey:type.runtimeKey,kind:type.kind,
      byteSize:align(byteSize,alignment),alignment,referenceCount,fields});
  }
  const result={family:'tsfg.typed-layout-development',version:1,
    entries:owned.types.map(type=>({typeId:type.id,layout:layouts.get(type.id),...(cells.has(type.id)?{cell:cells.get(type.id)}:{})}))};
  checkTypedLayoutBudget(result,bound);return own(result);
}

const kinds={scalar:1,undefined:2,null:3,void:4,union:5,array:6,readSpan:7,reference:8,value:9,string:10};
/** @param {any} hir @param {any} context @param {{depth?:number,work?:number,publicationContext?:any}} [limits] */
export function writeTypedLayoutModule(hir,context,limits={}) {
  const owned=verifyHir(hir,context,limits.publicationContext);buildTypedLayouts(hir,context,limits);
  require(owned.types.length<=4096,'catalogue budget');
  const chunks=[Buffer.from('TSGLAY01')];
  const u8=value=>{const b=Buffer.alloc(1);b.writeUInt8(value);chunks.push(b);};
  const u16=value=>{const b=Buffer.alloc(2);b.writeUInt16LE(value);chunks.push(b);};
  const id=value=>{require(/^sha256:[0-9a-f]{64}$/.test(value));chunks.push(Buffer.from(value.slice(7),'hex'));};
  u16(owned.types.length);
  for(const type of owned.types) {
    id(type.id);u8(kinds[type.kind]);
    if(type.kind==='scalar')u8(codes[type.name]);
    if(type.elementType)id(type.elementType);
    if(type.members){u16(type.members.length);type.members.forEach(id);}
    if(['value','reference'].includes(type.kind)) {
      id(type.runtimeKey);u8(type.base?1:0);if(type.base)id(type.base);
      u16(type.fields.length);
      for(const field of type.fields) {
        id(field.id);const name=Buffer.from(field.name);require(name.length<=4096);u16(name.length);chunks.push(name);
        id(field.type);u8(field.readonly?1:0);
      }
    }
  }
  const bytes=Buffer.concat(chunks);require(bytes.length<=2097152,'module budget');return bytes;
}
