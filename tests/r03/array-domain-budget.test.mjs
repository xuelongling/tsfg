// SPDX-License-Identifier: MIT
// Independent bounded source templates; only JCS/SHA and frozen type origins are reused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readArrayFactsCandidate, writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { fixtures, fresh, jcs, sha, wire, failure } from './array-test-fixtures.mjs';

/** @param {number} start @param {number} end */
const range=(start,end)=>({start,end});
/** @param {string} domain @param {any} value */
const id=(domain,value)=>'sha256:'+sha(domain+'\0'+jcs(value));
/** @param {number} n @param {number} value */
const repeats=(n,value)=>Array.from({length:n},()=>[value]);
const plans=[
  {name:'functions16',lengths:repeats(16,1),accept:true},
  {name:'functions17',lengths:repeats(17,1),accept:false},
  {name:'consts17',lengths:[Array(17).fill(1)],accept:true},
  {name:'consts18',lengths:[Array(18).fill(1)],accept:false},
  {name:'literal256',lengths:[[256]],accept:true},
  {name:'literal257',lengths:[[257]],accept:false},
  {name:'package4096',lengths:repeats(16,256),accept:true},
  {name:'package4097',lengths:[[256,1],...repeats(15,256)],accept:false},
];

// Literal source is authored together with spans; no parser, producer or floatBits.
// An independent Go version exercises the official compiler before its public handler.
/** @param {any} base @param {number[][]} lengths @returns {any} */
function expectedPacket(base,lengths){
  const packet=fresh(base),p=packet.payload,path=p.rootFile;
  let source='';const functions=[];
  /** @param {{start:number,end:number}} where */
  const bindingID=where=>id('tsfg.array-facts.binding.v1',{sourcePath:path,nameRange:where});
  for(let f=0;f<lengths.length;f++){
    const start=source.length,name='fn'+String(f).padStart(2,'0');
    source+='export function ';const nameRange=range(source.length,source.length+name.length);source+=name+'(): ';
    const returnAnnotationRange=range(source.length,source.length+3);source+='f64 {\n';
    const bindings=[],body=[];let lastBinding='',lastName='';
    for(let c=0;c<lengths[f].length;c++){
      const name='a'+String(c).padStart(2,'0'),statementStart=source.length+2;source+='  const ';
      const nameRange=range(source.length,source.length+name.length),declarationStart=source.length;source+=name+': ';
      const elementAnnotationRange=range(source.length,source.length+3),annotationRange=range(source.length,source.length+5);source+='f64[] = ';
      const literalStart=source.length;source+='[';const elements=[];
      for(let e=0;e<lengths[f][c];e++){
        if(e)source+=',';const at=source.length;source+='0';
        elements.push({kind:'numericLiteral',type:'f64',range:range(at,at+1),token:'0',bits:'0000000000000000'});
      }
      source+=']';const literalRange=range(literalStart,source.length),declarationRange=range(declarationStart,source.length),binding=bindingID(nameRange);
      source+=';';body.push({kind:'variable',range:range(statementStart,source.length),binding,
        initializer:{kind:'arrayLiteral',type:'array.f64',range:literalRange,
          allocationSite:id('tsfg.array-facts.allocation-site.v1',{sourcePath:path,range:literalRange}),elements}});source+='\n';
      bindings.push({id:binding,name,kind:'const',declaredType:'array.f64',writable:false,declarationRange,nameRange,annotationRange,elementAnnotationRange});
      lastBinding=binding;lastName=name;
    }
    const returnStart=source.length+2;source+='  return ';const readStart=source.length,referenceRange=range(source.length,source.length+lastName.length);source+=lastName+'[';
    const indexRange=range(source.length,source.length+1);source+='0]';const readEnd=source.length;source+=';';
    body.push({kind:'return',range:range(returnStart,source.length),value:{kind:'checkedElementAccess',type:'f64',range:range(readStart,readEnd),
      array:{kind:'reference',binding:lastBinding,flowType:'array.f64',range:referenceRange},
      index:{kind:'indexLiteral',type:'u32',range:indexRange,token:'0',decimal:'0'}}});source+='\n}';
    functions.push({id:bindingID(nameRange),name,sourcePath:path,declarationRange:range(start,source.length),nameRange,
      returnType:'f64',returnAnnotationRange,parameters:[],bindings,body});source+='\n';
  }
  const file=p.files.find(f=>f.path===path);file.content=source;file.sha256=sha(source);file.byteLength=Buffer.byteLength(source);file.utf16Length=source.length;
  p.functions=functions;p.exports=functions.map(f=>({name:f.name,functionId:f.id}));
  const request={family:'tsfg.array-facts-request-candidate',version:5,input:{sourceRoot:p.sourceRoot,rootFile:path,
    files:p.files.map(f=>({path:f.path,content:f.content,sha256:f.sha256})),declarations:p.declarations,config:p.config}};
  packet.requestId='sha256:'+sha('tsfg.array-facts.request.v5\0'+jcs(request)+'\n');
  packet.packageId='sha256:'+sha('tsfg.array-facts.package.v5\0'+packet.schemaHash+'\0'+jcs(p));
  return packet;
}

test('25b exact Array domain boundaries use complete independently specified packets',async t=>{
  const base=(await fixtures())[3].facts.package;
  for(const plan of plans)await t.test(plan.name,()=>{
    const expected=expectedPacket(base,plan.lengths),bytes=wire(expected);
    assert.ok(bytes.length<2097152);assert.ok(expected.payload.files[0].byteLength<65536);
    assert.equal(expected.payload.functions.length,plan.lengths.length);
    let constants=0,elements=0;for(const fn of expected.payload.functions){constants+=fn.bindings.length;for(const stmt of fn.body.slice(0,-1))elements+=stmt.initializer.elements.length;}
    assert.equal(constants,plan.lengths.reduce((n,row)=>n+row.length,0));assert.equal(elements,plan.lengths.flat().reduce((a,b)=>a+b,0));
    if(plan.accept){
      const got=readArrayFactsCandidate(bytes);assert.deepEqual(got,expected);
      assert.deepEqual(writeArrayFactsCandidate(got),bytes);
      assert.deepEqual(writeArrayFactsCandidate(fresh(expected)),bytes);
    }else for(const action of [()=>readArrayFactsCandidate(bytes),()=>writeArrayFactsCandidate(expected)]){
      const err=failure(action);assert.equal(err.code,'r03-array-facts-limit');assert.equal(err.ruleId,'r01-input-boundary');
      assert.equal(err.phase,'input');assert.equal(err.primary,undefined);
    }
  });
});
