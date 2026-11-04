// SPDX-License-Identifier: MIT
// Independent literal parameter facts. These are not captured Source packages,
// frontend output, executable input, or evidence for call/FDI execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeCommonProgramOrdinaryParameters,validateCommonParameterInitialization} from '../../compiler/common-program-facts.mjs';
import {originId} from '../../compiler/typed-array-schema.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

const spend=()=>{};
const types=new Map([
  ['i32',{id:'i32',kind:'scalar',name:'i32'}],
  ['undefined',{id:'undefined',kind:'undefined'}],
  ['null',{id:'null',kind:'null'}],
  ['union<i32,undefined>',{id:'union<i32,undefined>',kind:'union',members:['i32','undefined']}],
  ['union<i32,null>',{id:'union<i32,null>',kind:'union',members:['i32','null']}],
  ['union<i32,null,undefined>',{id:'union<i32,null,undefined>',kind:'union',members:['i32','null','undefined']}],
]);
const code='r03-common-program-parameter-initialization';
const rejects=body=>assert.throws(body,error=>error instanceof Error&&'code' in error&&error.code===code);

// Offsets are literal UTF16 source coordinates. Common binding identities are
// the existing source-origin recipe; no full-package identity is manufactured.
function optional(){
  const source={path:'/src/f.ts',content:'function f(x?: i32): i32 { return 0; }'};
  const parameter={id:originId(source.path,{start:11,end:12}),kind:'parameter',lexicalOwner:'function:f',name:'x',writable:true,
    nameRange:{start:11,end:12},declarationRange:{start:11,end:18},annotationRange:{start:15,end:18},elementAnnotationRange:null,declaredType:'union<i32,undefined>'};
  const input={id:'s2',name:'x',kind:'parameter',type:'i32',writable:true,range:{start:11,end:12},
    presence:{undefined:true,null:false,optional:true,default:false,range:{start:11,end:18},annotation:{start:15,end:18}}};
  const original={name:'f',range:{start:0,end:38},parameters:[input],parameterInitializers:[null]};
  const fn={id:'function:f',name:'f',sourcePath:source.path,lexicalParent:null,ownerType:undefined,parameterInitialization:undefined,declarationRange:{start:0,end:38},parameters:[parameter]};
  return {source,original,fn,initializers:[null]};
}

function defaulted(){
  const source={path:'/src/f.ts',content:'function f(x: i32 = 7): i32 { return x; }'};
  const parameter={id:originId(source.path,{start:11,end:12}),kind:'parameter',lexicalOwner:'function:f',name:'x',writable:true,
    nameRange:{start:11,end:12},declarationRange:{start:11,end:21},annotationRange:{start:14,end:17},elementAnnotationRange:null,declaredType:'i32'};
  const input={id:'s2',name:'x',kind:'parameter',type:'i32',writable:true,range:{start:11,end:12},
    presence:{undefined:true,null:false,optional:true,default:true,range:{start:11,end:21},annotation:{start:14,end:17}}};
  /** @type {{kind:string,type:string,range:{start:number,end:number},literal?:{decimal:string,token:string},absence?:string,operand?:object}} */
  const initializer={kind:'integer',type:'i32',range:{start:20,end:21},literal:{decimal:'7',token:'7'}};
  const original={name:'f',range:{start:0,end:41},parameters:[input],parameterInitializers:[initializer]};
  const fn={id:'function:f',name:'f',sourcePath:source.path,lexicalParent:null,ownerType:undefined,parameterInitialization:undefined,declarationRange:{start:0,end:41},parameters:[parameter]};
  /** @type {{kind:string,type:string,flowType:string,range:{start:number,end:number},decimal?:string,token?:string,expression?:object}} */
  const converted={kind:'numericLiteral',type:'i32',flowType:'i32',range:{start:20,end:21},decimal:'7',token:'7'};
  return {source,original,fn,initializers:[converted]};
}

const bridge=value=>bridgeCommonProgramOrdinaryParameters(value.original,value.fn,value.source,value.initializers,types,spend);
const verify=(value,version=3)=>validateCommonParameterInitialization({functions:[value.fn],types:[]},new Map([[value.source.path,value.source]]),types,version,spend);

test('legacy optional facts bridge to the existing Source3 owned parameter protocol',()=>{
  const value=optional(),initialization=bridge(value);
  assert.deepEqual(initialization,{minimumArgumentCount:0,hasParameterExpressions:false,steps:[{
    binding:value.fn.parameters[0].id,range:{start:11,end:18},argumentType:'union<i32,undefined>'}]});
  assert.ok(Object.isFrozen(initialization)&&Object.isFrozen(initialization.steps[0].range));
  value.fn.parameterInitialization=initialization;verify(value);
  value.fn.parameters[0].declarationRange.end=17;
  assert.equal(initialization.steps[0].range.end,18);
});

test('default facts retain the original initializer and widen only the incoming type',()=>{
  const value=defaulted(),initialization=bridge(value);
  assert.equal(initialization.minimumArgumentCount,0);
  assert.equal(initialization.hasParameterExpressions,true);
  assert.equal(initialization.steps[0].argumentType,'union<i32,undefined>');
  assert.deepEqual(initialization.steps[0].initializer,{kind:'numericLiteral',type:'i32',flowType:'i32',range:{start:20,end:21},decimal:'7',token:'7'});
  assert.equal(value.fn.parameters[0].declaredType,'i32');
  value.fn.parameterInitialization=initialization;verify(value);
});

test('required undefined-union facts preserve the existing required-only representation',()=>{
  const value=optional();
  value.source.content='function f(x: i32 | undefined): i32 { return 0; }';
  value.original.range.end=49;value.fn.declarationRange.end=49;
  const input=value.original.parameters[0];input.presence.optional=false;input.presence.range.end=29;input.presence.annotation={start:14,end:29};
  const parameter=value.fn.parameters[0];parameter.declarationRange.end=29;parameter.annotationRange={start:14,end:29};
  assert.equal(bridge(value),undefined);
  verify(value);
  value.fn.parameterInitialization={minimumArgumentCount:0,hasParameterExpressions:false,steps:[{binding:parameter.id,range:{start:11,end:29},argumentType:'union<i32,undefined>'}]};
  rejects(()=>verify(value));
  value.fn.parameterInitialization.minimumArgumentCount=1;rejects(()=>verify(value));
});

test('a required parameter after a default still determines the minimum actual count',()=>{
  const value=defaulted();value.source.content='function f(x: i32 = 7, y: i32): i32 { return y; }';
  value.original.range.end=49;value.fn.declarationRange.end=49;
  value.original.parameters.push({id:'s3',name:'y',kind:'parameter',type:'i32',writable:true,range:{start:23,end:24},
    presence:{undefined:false,null:false,optional:false,default:false,range:{start:23,end:29},annotation:{start:26,end:29}}});
  value.original.parameterInitializers.push(null);value.initializers.push(null);
  value.fn.parameters.push({id:originId(value.source.path,{start:23,end:24}),kind:'parameter',lexicalOwner:'function:f',name:'y',writable:true,
    nameRange:{start:23,end:24},declarationRange:{start:23,end:29},annotationRange:{start:26,end:29},elementAnnotationRange:null,declaredType:'i32'});
  value.fn.parameterInitialization=bridge(value);
  assert.equal(value.fn.parameterInitialization.minimumArgumentCount,2);
  assert.equal(value.fn.parameterInitialization.steps[1].argumentType,'i32');verify(value);
  value.fn.parameterInitialization=structuredClone(value.fn.parameterInitialization);
  value.fn.parameterInitialization.minimumArgumentCount=0;rejects(()=>verify(value));
});

test('nullable default facts preserve null as a declared member rather than default selection',()=>{
  const value=defaulted();value.source.content='function f(x: i32 | null = null): i32 { return 0; }';
  value.original.range.end=51;value.fn.declarationRange.end=51;
  const input=value.original.parameters[0];input.presence.null=true;input.presence.range.end=31;input.presence.annotation.end=24;
  const parameter=value.fn.parameters[0];parameter.declaredType='union<i32,null>';parameter.declarationRange.end=31;parameter.annotationRange.end=24;
  value.original.parameterInitializers[0]={kind:'absence',type:'i32',absence:'null',range:{start:27,end:31}};
  value.initializers[0]={kind:'nullLiteral',type:'null',flowType:'null',range:{start:27,end:31}};
  value.fn.parameterInitialization=bridge(value);
  assert.equal(value.fn.parameterInitialization.steps[0].argumentType,'union<i32,null,undefined>');
  assert.equal(value.fn.parameterInitialization.steps[0].initializer.kind,'nullLiteral');
  assert.equal(parameter.declaredType,'union<i32,null>');verify(value);
});

for(const [label,mutate]of /** @satisfies {[string,(value:ReturnType<typeof optional>)=>void][]} */ ([
  ['false official optional flag',value=>{value.original.parameters[0].presence.optional=false;}],
  ['foreign common binding',value=>{value.fn.parameters[0].id='foreign';}],
  ['foreign annotation anchor',value=>{value.fn.parameters[0].annotationRange.start=14;}],
  ['missing effective undefined member',value=>{value.fn.parameters[0].declaredType='i32';}],
  ['missing converted initializer',value=>{value.initializers[0]=null;}],
  ['foreign converted initializer anchor',value=>{value.initializers[0].range.start=19;}],
  ['foreign source path',value=>{value.source.path='/src/other.ts';}],
]))test('parameter bridge rejects '+label,()=>{
  const value=label.includes('initializer')?defaulted():optional();mutate(value);rejects(()=>bridge(value));
});

for(const [label,mutate]of /** @satisfies {[string,(value:ReturnType<typeof optional>)=>void][]} */ ([
  ['false minimum',value=>{value.fn.parameterInitialization.minimumArgumentCount=1;}],
  ['false parameter-expression flag',value=>{value.fn.parameterInitialization.hasParameterExpressions=true;}],
  ['foreign binding step',value=>{value.fn.parameterInitialization.steps[0].binding='foreign';}],
  ['foreign declaration step',value=>{value.fn.parameterInitialization.steps[0].range.end=17;}],
  ['erased incoming undefined',value=>{value.fn.parameterInitialization.steps[0].argumentType='i32';}],
  ['method owner',value=>{value.fn.ownerType='nominal:owner';}],
  ['nested owner',value=>{value.fn.lexicalParent='function:parent';}],
]))test('Source3 parameter directory rejects '+label,()=>{
  const value=optional();value.fn.parameterInitialization=structuredClone(bridge(value));mutate(value);rejects(()=>verify(value));
});

test('Source2 still rejects ordinary FDI without changing required-only acceptance',()=>{
  const value=optional();verify(value,2);
  value.fn.parameterInitialization=bridge(value);rejects(()=>verify(value,2));
});

// The same cumulative production meter covers the new bridge's text work and
// owned result. Every long-input rejection has a small valid positive control.
const budgetBridge=(value,limit=2048)=>bridgeCommonProgramOrdinaryParameters(value.original,value.fn,value.source,value.initializers,types,commonMeter(limit));
const budgetRejects=body=>assert.throws(body,error=>error instanceof Error&&'code' in error&&error.code==='r03-common-program-limit');

test('bridge prepays a long parameter comment before presence text scans',()=>{
  assert.equal(budgetBridge(optional()).minimumArgumentCount,0);
  const value=optional(),comment='/*'+'a'.repeat(8192)+'*/';
  value.source.content=value.source.content.slice(0,15)+comment+value.source.content.slice(15);
  value.original.range.end+=comment.length;value.fn.declarationRange.end+=comment.length;
  const presence=value.original.parameters[0].presence,parameter=value.fn.parameters[0];
  presence.range.end+=comment.length;presence.annotation.start+=comment.length;presence.annotation.end+=comment.length;
  parameter.declarationRange.end+=comment.length;parameter.annotationRange.start+=comment.length;parameter.annotationRange.end+=comment.length;
  assert.equal(bridge(value).minimumArgumentCount,0);
  budgetRejects(()=>budgetBridge(value));
});

test('bridge prepays long source-path serialization and hashing',()=>{
  assert.equal(budgetBridge(optional()).minimumArgumentCount,0);
  const value=optional();value.source.path='/src/'+'a'.repeat(4096)+'.ts';value.fn.sourcePath=value.source.path;
  value.fn.parameters[0].id=originId(value.source.path,value.fn.parameters[0].nameRange);
  assert.equal(bridge(value).steps[0].argumentType,'union<i32,undefined>');
  budgetRejects(()=>budgetBridge(value));
});

test('bridge reserves the complete returned record before cloning and freezing it',()=>{
  assert.equal(budgetBridge(optional()).steps[0].argumentType,'union<i32,undefined>');
  // A small source and no initializer isolate the final owned-record reserve:
  // text, hash and collection preparation fit this limit; the owned tree does not.
  budgetRejects(()=>budgetBridge(optional(),256));
});

test('bridge prepays the full initializer tree before shape and owned copying',()=>{
  assert.equal(budgetBridge(defaulted()).steps[0].initializer.kind,'numericLiteral');
  const value=defaulted(),depth=40;
  value.source.content='function f(x: i32 = '+'('.repeat(depth)+'7'+')'.repeat(depth)+'): i32 { return x; }';
  value.original.range.end+=2*depth;value.fn.declarationRange.end+=2*depth;
  value.original.parameters[0].presence.range.end+=2*depth;value.fn.parameters[0].declarationRange.end+=2*depth;
  function initializer(level){
    const range={start:20+level,end:21+2*depth-level};
    if(level===depth)return {
      original:{kind:'integer',type:'i32',range,literal:{decimal:'7',token:'7'}},
      converted:{kind:'numericLiteral',type:'i32',flowType:'i32',range,decimal:'7',token:'7'}};
    const child=initializer(level+1);
    return {original:{kind:'group',type:'i32',range,operand:child.original},
      converted:{kind:'parentheses',type:'i32',flowType:'i32',range,expression:child.converted}};
  }
  const nested=initializer(0);value.original.parameterInitializers[0]=nested.original;value.initializers[0]=nested.converted;
  assert.equal(bridge(value).steps[0].initializer.kind,'parentheses');
  budgetRejects(()=>budgetBridge(value));
});

test('bridge prepays initializer string width even before semantic expression verification',()=>{
  assert.equal(budgetBridge(defaulted()).steps[0].initializer.token,'7');
  // Deliberately untrusted, schema-shaped converted metadata. The parameter
  // bridge does not authenticate a complete expression or Source package.
  const value=defaulted();value.initializers[0].token='7'.repeat(65536);
  budgetRejects(()=>budgetBridge(value));
});
