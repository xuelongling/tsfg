// SPDX-License-Identifier: MIT
// Independent literal grammar over complete frozen semantic input; no Product imports.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const jcs=x=>Array.isArray(x)?'['+x.map(jcs).join(',')+']':x&&typeof x==='object'
  ?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+jcs(x[k])).join(',')+'}':JSON.stringify(x);
export const hash=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
export const domain=(name,value)=>hash(name+'\0'+jcs(value));
export const scalarIds=Object.fromEntries(['f64','u32'].map(n=>[n,hash('tsfg.type\0'+n)]));
export const arrayId=hash('tsfg.type\0Array<f64>'),viewId=hash('tsfg.type\0ReadSpan<f64>');
export const typeName=id=>id===arrayId?'array.f64':id===viewId?'readspan.f64'
  :id===scalarIds.f64?'f64':id===scalarIds.u32?'u32':assert.fail('unsupported nominal type');
export const sourceId=(sourcePath,nameRange)=>domain('tsfg.array-facts.binding.v1',{nameRange,sourcePath});
export const allocationId=(sourcePath,range)=>domain('tsfg.array-facts.allocation-site.v1',{range,sourcePath});
export function functionIds(sourcePath,name,parameters,result) {
  const signature=hash('tsfg.signature\0('+parameters.join(',')+')->'+result);
  return {id:hash('tsfg.function\0'+sourcePath+'\0'+name+'\0'+signature.slice(7)),signature};
}
const floatingBits=value=>{const bits=value.startsWith('0x')?value.slice(2):value;
  assert.match(bits,/^[0-9a-f]{16}$/);return bits;};
const quote=JSON.stringify,dict=fields=>'{'+fields.join(', ')+'}',arr=items=>'['+items.join(', ')+']';
const str=(key,value)=>key+' = '+quote(value),integer=(key,value,bits=64)=>key+' = '+value+' : i'+bits;
const span=value=>'array<i64'+(value?': '+value.start+', '+value.end:'')+'>';
const at=range=>integer('tsfg_source.start',range.start)+', '+integer('tsfg_source.end',range.end);
const native=id=>id===arrayId?'!tsfg_array.array_f64':id===viewId?'!tsfg_array.readspan_f64'
  :id===scalarIds.f64?'f64':id===scalarIds.u32?'!tsfg_core.integer<"u32">':assert.fail('native type');
const originFields=(value,fields)=>fields.map(([out,key])=>out+' = '+span(value[key]));
const use=value=>dict([str('kind',value.kind),str('binding',value.kind==='reference'?value.binding:''),
  str('type_id',value.type),'range = '+span(value.range)]);
function local(statement) {
  const b=statement.binding;
  return dict([str('id',b.id),str('name',b.name),'statement_range = '+span(statement.range),
    ...originFields(b,[['declaration_range','range'],['name_range','nameRange'],
      ['annotation_range','annotationRange'],['element_annotation_range','elementAnnotationRange']])]);
}
export function contextFor(hir,uppers) {
  const functions=[...hir.functions].sort((a,b)=>a.id.localeCompare(b.id));
  const scope={exports:hir.exports,functions:functions.map(f=>({functionId:f.id,name:f.name,
    parameterTypes:f.parameters.map(p=>typeName(p.type)),returnType:typeName(f.returnType.id),
    signatureHash:f.signatureHash,sourcePath:f.sourcePath})),
    profile:'array-readspan-array-origin-return-scc-owner-relative-fixed-v4',rootFile:hir.rootFile};
  const scopeDigest=domain('tsfg.array-call-scope.v4',scope);
  const contracts=functions.map(f=>{const body={functionId:f.id,signatureHash:f.signatureHash,upper:uppers.get(f.id)};
    assert.ok(body.upper);return{...body,digest:domain('tsfg.array-published-contract.v4',body)};});
  return {family:'tsfg.array-publication-context-candidate',version:4,mode:'fixed',scopeDigest,contracts,
    expectedDigest:domain('tsfg.array-publication.v4',{contracts,scopeDigest})};
}
function publication(context) {
  if(context===null)return'unit';
  const flag=v=>dict(['read = '+v.read,'write = '+v.write,'structural = '+v.structural]);
  return dict([str('family',context.family),integer('version',4,32),str('mode','fixed'),
    str('scope_digest',context.scopeDigest),str('expected_digest',context.expectedDigest),
    'contracts = '+arr(context.contracts.map(r=>dict([str('function_id',r.functionId),str('signature_hash',r.signatureHash),
      'upper = '+dict(['parameters = '+arr(r.upper.parameters.map(p=>dict([integer('index',p.index),
        'read = '+p.read,'write = '+p.write,'structural = '+p.structural]))),
        'local = '+flag(r.upper.local),'return_origin = '+(r.upper.returnOrigin===null?'unit'
          :dict([str('kind','parameter'),integer('index',r.upper.returnOrigin.index)]))]),str('digest',r.digest)])))]);
}
function moduleHeader(hir,context) {
  const source=hir.sources.find(s=>s.path===hir.rootFile);
  const property=(p,view)=>dict([str('id',p.id),str('kind',p.kind),str('name',p.name),str('owner_type',p.ownerType),
    str('official_type',p.officialType),str(view?'read_type':'write_type',view?p.readType:p.writeType),
    ...(view?['readonly = true']:[]),str('source_path',p.sourcePath),
    ...originFields(p,[['declaration_range','declarationRange'],['name_range','nameRange'],['type_range','typeRange']])]);
  const intrinsic=hir.readSpanIntrinsic;
  return 'module attributes {'+[
    str('tsfg_core.version','0.9.0'),str('tsfg_core.input_identity',hir.inputIdentity),
    str('tsfg_core.source_hash',source.hash),str('tsfg_core.source_path',source.path),
    str('tsfg_core.target',hir.target.target),str('tsfg_core.triple',hir.target.triple),
    str('tsfg_core.data_layout',hir.target.llvmDataLayout),
    str('tsfg_core.bytecode_schema','sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6'),
    integer('tsfg_core.source_length',source.content.length),
    'tsfg_core.array = '+dict([str('family','tsfg.core-array-candidate'),integer('version',13,32),
      str('schema','sha256:39a7877720fab4c3e7fc78d28f2232576865ab3c949e064ef7cc1e979548976b'),
      str('profile','dense-f64-array-readspan-returns-checked-v13'),integer('facts_version',7,32)]),
    'tsfg_array.function_ids = '+arr(hir.functions.map(f=>quote(f.id))),
    'tsfg_array.exports = '+arr(hir.exports.map(e=>dict([str('name',e.name),str('function_id',e.functionId)]))),
    'tsfg_array.sources = '+arr(hir.sources.map(s=>dict([str('path',s.path),str('hash',s.hash),integer('utf16_length',s.content.length)]))),
    'tsfg_array.types = '+arr(hir.types.map(t=>dict([str('id',t.id),str('kind',t.kind),str('name',t.name),
      str('source_path',t.sourcePath),...originFields(t,[['declaration_range','declarationRange'],['name_range','nameRange']]),
      ...([arrayId,viewId].includes(t.id)?[str('element_type',t.elementType),'index_signature_range = '+span(t.indexSignatureRange)]:[]),
      ...(t.id===viewId?['readonly = true']:[])]))),
    str('tsfg_array.request_id',hir.facts.requestId),'tsfg_array.length_property = '+property(hir.arrayLength,false),
    'tsfg_array.readspan_length_property = '+property(hir.readSpanLength,true),
    'tsfg_array.readspan_intrinsic = '+dict([str('id',intrinsic.id),str('kind',intrinsic.kind),str('name',intrinsic.name),
      str('source_path',intrinsic.sourcePath),...originFields(intrinsic,[['declaration_range','declarationRange'],
        ['name_range','nameRange'],['type_parameter_range','typeParameterRange']]),
      'parameters = '+arr(intrinsic.parameters.map(p=>dict([str('name',p.name),
        ...originFields(p,[['declaration_range','declarationRange'],['name_range','nameRange'],['type_range','typeRange']])]))),
      'return_type_range = '+span(intrinsic.returnTypeRange)]),'tsfg_array.publication = '+publication(context)
  ].join(', ')+'} {\n';
}
export function wholeCore(hir,context) {
  const contracts=new Map((context?.contracts??[]).map(r=>[r.functionId,r]));
  const traces=[],originByFunction=new Map();
  const texts=hir.functions.map(fn=>{
    const identities=functionIds(fn.sourcePath,fn.name,fn.parameters.map(p=>typeName(p.type)),typeName(fn.returnType.id));
    assert.equal(fn.id,identities.id);assert.equal(fn.signatureHash,identities.signature);
    assert.equal(fn.sourceBinding,sourceId(fn.sourcePath,fn.nameRange));
    const definitions=new Map(),ownerOf=new Map(),ops=[],calls=[];let register=0;
    fn.parameters.forEach((p,index)=>{const name='%v'+register++;definitions.set(p.id,name);
      assert.equal(p.id,sourceId(fn.sourcePath,p.nameRange));
      if([arrayId,viewId].includes(p.type))ownerOf.set(name,{kind:'parameter',functionId:fn.id,index});});
    function op(name,operands,types,resultType,attrs,range,path=null){
      const result=resultType===null?null:'%v'+register++;
      const text='    '+(result===null?'':result+' = ')+quote(name)+'('+operands.join(', ')+') {'
        +(attrs?attrs+', ':'')+at(range)+'} : ('+types.map(native).join(', ')+') -> '+(resultType===null?'()':native(resultType));
      const trace={instruction:ops.length,name,result,operands,range,path};ops.push({...trace,text});return result;
    }
    op('tsfg_core.fuel',[],[],null,integer('event',1,32),fn.range);
    function value(v,statement,path){
      if(v.kind==='reference'){assert.ok(definitions.has(v.binding));return definitions.get(v.binding);}
      if(v.kind==='floating'||v.kind==='constant')return op('tsfg_core.constant',[],[],v.type,
        str('value',v.kind==='floating'?floatingBits(v.bits):v.decimal),v.range,path);
      if(v.kind==='arrayCreate'){
        const operands=v.elements.map((e,i)=>value(e,null,path.concat('elements',i)));
        assert.equal(v.allocationSite,allocationId(fn.sourcePath,v.range));
        const result=op('tsfg_array.create',operands,v.elements.map(e=>e.type),v.type,
          str('allocation_site',v.allocationSite)+', local = '+local(statement),v.range,path);
        ownerOf.set(result,{kind:'allocation',functionId:fn.id,allocationSite:v.allocationSite});return result;
      }
      if(v.kind==='readSpanCreateChecked'){
        const receiver=value(v.receiver,null,path.concat('receiver'));
        const start=value(v.start,null,path.concat('start')),length=value(v.length,null,path.concat('length'));
        const result=op('tsfg_array.view_create_checked',[receiver,start,length],[v.receiver.type,v.start.type,v.length.type],v.type,
          [str('intrinsic',v.intrinsic),str('receiver_binding',v.receiver.binding),'receiver_range = '+span(v.receiver.range),
            'callee_range = '+span(v.calleeRange),'start = '+use(v.start),'length = '+use(v.length),'local = '+local(statement)].join(', '),v.range,path);
        ownerOf.set(result,ownerOf.get(receiver));return result;
      }
      if(v.kind==='arrayReadChecked'||v.kind==='readSpanReadChecked'){
        const receiver=value(v.receiver,null,path.concat('receiver')),index=value(v.index,null,path.concat('index'));
        return op(v.kind==='arrayReadChecked'?'tsfg_array.read_checked':'tsfg_array.view_read_checked',[receiver,index],
          [v.receiver.type,v.index.type],v.type,[str('receiver_binding',v.receiver.binding),'receiver_range = '+span(v.receiver.range),
            'index = '+use(v.index),...(statement?.kind==='expression'?['statement_range = '+span(statement.range)]:[])].join(', '),v.range,path);
      }
      if(v.kind==='arrayDirectCall'){
        const target=hir.functions.find(f=>f.id===v.target);assert.ok(target);
        const operands=v.arguments.map((a,i)=>value(a,null,path.concat('arguments',i)));
        const call={block:0,instruction:ops.length,target:v.target,range:v.range,path,
          actualOwners:operands.map(o=>ownerOf.get(o)??null),fullTypes:v.arguments.map(a=>a.type),
          consumedDigest:context?contracts.get(target.id).digest:null};calls.push(call);
        const result=op('func.call',operands,v.arguments.map(a=>a.type),v.type,
          ['callee = @'+quote(target.name),str('tsfg_core.function_id',target.id),str('tsfg_core.signature_hash',target.signatureHash),
            str('source_callee',v.sourceCallee),'consumed_digest = '+(context?quote(contracts.get(target.id).digest):'unit'),
            'callee_range = '+span(v.calleeRange),'arguments = '+arr(v.arguments.map(use)),
            'statement_range = '+span(statement.range),...(statement.kind==='local'?['local = '+local(statement)]:[])].join(', '),v.range,path);
        if(v.type===viewId){const actual=originByFunction.get(target.id);
          assert.equal(actual?.kind,'parameter');
          assert.equal(actual.index,contracts.get(target.id)?.upper.returnOrigin?.index);
          ownerOf.set(result,ownerOf.get(operands[actual.index]));}return result;
      }
      if(v.kind==='readSpanLength'){
        const receiver=value(v.receiver,null,path.concat('receiver'));
        return op('tsfg_array.view_length',[receiver],[v.receiver.type],v.type,
          [str('receiver_binding',v.receiver.binding),'receiver_range = '+span(v.receiver.range),str('property',v.property),
            'property_name_range = '+span(v.nameRange),'statement_range = '+span(statement.range)].join(', '),v.range,path);
      }
      assert.fail('independent grammar lacks real expression '+v.kind);
    }
    fn.body.forEach((statement,index)=>{
      const path=['body',index];
      if(statement.kind==='local'){
        assert.equal(statement.binding.id,sourceId(fn.sourcePath,statement.binding.nameRange));
        let result;
        if(statement.initializer.kind==='reference'){
          const input=value(statement.initializer,null,path.concat('initializer'));
          result=op(statement.binding.type===viewId?'tsfg_array.view_alias':'tsfg_array.alias',[input],[statement.binding.type],statement.binding.type,
            str('target_binding',statement.initializer.binding)+', local = '+local(statement),statement.initializer.range,path.concat('initializer'));
          ownerOf.set(result,ownerOf.get(input));
        }else result=value(statement.initializer,statement,path.concat('initializer'));
        definitions.set(statement.binding.id,result);return;
      }
      if(statement.kind==='expression'){value(statement.expression,statement,path.concat('expression'));return;}
      if(statement.kind==='return'){
        const result=value(statement.value,statement,path.concat('value'));
        op('func.return',[result],[fn.returnType.id],null,'tsfg_array.value = '+use(statement.value),statement.range,path);return;
      }
      if(statement.kind==='arrayResizeChecked'){
        const t=statement.target,receiver=value(t.receiver,null,path.concat('target','receiver'));
        const length=value(statement.value,null,path.concat('value'));
        op('tsfg_array.resize_checked',[receiver,length],[t.receiver.type,statement.value.type],null,
          [str('receiver_binding',t.receiver.binding),'receiver_range = '+span(t.receiver.range),str('property',t.property),
            'property_name_range = '+span(t.nameRange),'target_range = '+span(t.range),'new_length = '+use(statement.value),
            'expression_range = '+span(statement.expressionRange),'operator_range = '+span(statement.operatorRange)].join(', '),statement.range,path);return;
      }
      if(statement.kind==='arrayStoreDenseChecked'){
        const t=statement.target,receiver=value(t.receiver,null,path.concat('target','receiver'));
        const indexValue=value(t.index,null,path.concat('target','index')),stored=value(statement.value,null,path.concat('value'));
        const target=dict([str('receiver_binding',t.receiver.binding),'receiver_range = '+span(t.receiver.range),'index = '+use(t.index),'range = '+span(t.range)]);
        op('tsfg_array.store_dense_checked',[receiver,indexValue,stored],[t.receiver.type,t.index.type,statement.value.type],null,
          ['target = '+target,'value = '+use(statement.value),'expression_range = '+span(statement.expressionRange),
            'operator_range = '+span(statement.operatorRange)].join(', '),statement.range,path);return;
      }
      assert.fail('independent grammar lacks real statement '+statement.kind);
    });
    const metadata=[str('tsfg_core.function_id',fn.id),str('tsfg_core.signature_hash',fn.signatureHash),str('tsfg_core.type_id',fn.returnType.id),
      integer('tsfg_core.function_start',fn.range.start),integer('tsfg_core.function_end',fn.range.end),str('tsfg_array.source_binding',fn.sourceBinding),
      'tsfg_array.name_range = '+span(fn.nameRange),'tsfg_array.return_annotation_range = '+span(fn.returnAnnotationRange),
      ...(fn.returnType.id===viewId?['tsfg_array.return_element_annotation_range = '+span(fn.returnElementAnnotationRange)]:[]),
      'tsfg_array.parameters = '+arr(fn.parameters.map(p=>dict([str('id',p.id),str('name',p.name),str('type',p.type),'writable = '+p.writable,
        ...originFields(p,[['declaration_range','range'],['name_range','nameRange'],['annotation_range','annotationRange']]),
        ...([arrayId,viewId].includes(p.type)?['element_annotation_range = '+span(p.elementAnnotationRange)]:[])])))];
    const returnOwner=ownerOf.get(ops.at(-1).operands[0])??null;
    if(fn.returnType.id===viewId){assert.equal(returnOwner?.kind,'parameter');originByFunction.set(fn.id,returnOwner);}
    traces.push({functionId:fn.id,name:fn.name,parameters:fn.parameters.length,registers:register,returnOwner,
      operations:ops.map(({text,...row})=>row),calls});
    return '  func.func @'+quote(fn.name)+'('+fn.parameters.map((p,i)=>'%v'+i+': '+native(p.type)).join(', ')+') -> '+native(fn.returnType.id)
      +' attributes {'+metadata.join(', ')+'} {\n'+ops.map(o=>o.text).join('\n')+'\n  }';
  });
  return {text:moduleHeader(hir,context)+texts.join('\n')+'\n}\n',traces};
}
