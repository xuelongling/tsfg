// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { sourceInput } from '../../compiler/pipeline.mjs';
import { prepareFrontendInput,materializeFrontendResponse } from '../../compiler/frontend-response.mjs';
import { validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import {buildHir,lowerFormalHir,printHir,readHir} from '../../compiler/hir.mjs';
import {conversionDeclaration} from '../../compiler/conversions.mjs';

// These manually authored owned facts do not execute or qualify an official
// Source producer. Expected values here are product-author self-checks only.
export async function conversionFacts(from='f64',to='i8',mode='checked') {
  const name=`${mode}_${to}_from_${from}`;
  const source=`export function entry(x:${from}):${to} { return ${name}(x); }`;
  const input=await sourceInput(source,{declarationVersion:'minimal-conversions-v5'});
  const prepared=await prepareFrontendInput(input);
  const anchor=(start,end)=>({start,end});
  const entry=conversionDeclaration.entries.find(e=>e.name===name);
  const parameter=source.indexOf('x:'), operand=source.lastIndexOf('(x)')+1, call=source.indexOf(name);
  const range=anchor(call,operand+2);
  const origin={version:conversionDeclaration.version,entryId:entry.id,
    declarationPath:'/src/minimal-conversions-v5.d.ts',declarationSha256:conversionDeclaration.sha256,
    declarationRange:anchor(entry.start,entry.end),brandRefs:[['source',from],['target',to]].filter(([,n])=>n!=='f64').map(([role,nominal])=>({role,nominal,range:conversionDeclaration.brands[nominal]}))};
  const fn={name:'entry',symbol:'f',returnType:to,range:anchor(0,source.length),parameters:[{id:'p',name:'x',type:from,range:anchor(parameter,parameter+1)}],body:[{kind:'return',range:anchor(source.indexOf('return'),source.indexOf(';')+1),expression:{kind:'conversion',type:to,range,conversion:origin,operand:{kind:'reference',type:from,range:anchor(operand,operand+1),symbol:'p'}}}]};
  const facts={status:'ok',inputs:['/src/main.ts','/src/minimal-conversions-v5.d.ts'],functions:[fn],symbols:[{id:'f',name:'entry',kind:'function',type:to,range:anchor(16,21)},{id:'p',name:'x',kind:'parameter',type:from,range:anchor(parameter,parameter+1)}],diagnostics:[]};
  const result=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'independent-owned-fixture',binarySha256:'sha256:'+'0'.repeat(64)});
  assert.equal(result.status,'ok');
  return result.snapshot;
}

export async function ordinaryFacts() {
  const source='export function entry():i32 { let x:i32=1; return x += (x = 5); }';
  const input=await sourceInput(source,{declarationVersion:'minimal-conversions-v5'}), prepared=await prepareFrontendInput(input);
  const r=(start,end)=>({start,end}), x=source.indexOf('x:i32'), one=source.indexOf('=1')+1, lhs=source.indexOf('x +='), inner=source.indexOf('x = 5'), five=source.indexOf('5');
  const ref=(at)=>({kind:'reference',type:'i32',symbol:'x',range:r(at,at+1)});
  const integer=(token,at)=>({kind:'integer',type:'i32',literal:{decimal:token,token},range:r(at,at+1)});
  const local={id:'x',name:'x',kind:'local',type:'i32',writable:true,range:r(x,x+1)};
  const facts={status:'ok',inputs:['/src/main.ts','/src/minimal-conversions-v5.d.ts'],diagnostics:[],symbols:[{id:'f',name:'entry',kind:'function',type:'i32',range:r(16,21)},local],functions:[{name:'entry',symbol:'f',returnType:'i32',parameters:[],parameterInitializers:[],range:r(0,source.length),body:[{kind:'variable',range:r(x,one+1),symbol:local,initializer:integer('1',one)},{kind:'return',range:r(source.indexOf('return'),source.lastIndexOf(';')+1),expression:{kind:'write',operator:'+=',type:'i32',range:r(lhs,five+2),left:ref(lhs),right:{kind:'group',type:'i32',range:r(inner-1,five+2),operand:{kind:'write',operator:'=',type:'i32',range:r(inner,five+1),left:ref(inner),right:integer('5',five)}}}}]}]};
  const result=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'independent-owned-fixture',binarySha256:'sha256:'+'0'.repeat(64)});
  assert.equal(result.status,'ok');return result.snapshot;
}

export async function defaultFacts() {
 const source='export function entry(x:i32=7):i32 { return x; }';
  const input=await sourceInput(source,{declarationVersion:'minimal-conversions-v5'}),prepared=await prepareFrontendInput(input);
  const r=(start,end)=>({start,end}), x=source.indexOf('x:'),seven=source.indexOf('7'),read=source.lastIndexOf('x;');
  const presence={undefined:true,null:false,optional:true,default:true,range:r(x,seven+1),annotation:r(x+2,seven-1)};
  const parameter={id:'p',name:'x',kind:'parameter',writable:true,type:'i32',range:r(x,x+1),presence};
  const facts={status:'ok',diagnostics:[],inputs:['/src/main.ts','/src/minimal-conversions-v5.d.ts'],symbols:[{id:'f',name:'entry',kind:'function',type:'i32',range:r(16,21)},parameter],functions:[{symbol:'f',name:'entry',returnType:'i32',parameters:[parameter],parameterInitializers:[{kind:'integer',type:'i32',literal:{decimal:'7',token:'7'},range:r(seven,seven+1)}],range:r(0,source.length),body:[{kind:'return',range:r(source.indexOf('return'),read+2),expression:{kind:'reference',symbol:'p',type:'i32',range:r(read,read+1),presenceFlow:{undefined:false,null:false}}}]}]};
  const snapshot=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'independent-owned-fixture',binarySha256:'sha256:'+'0'.repeat(64)}).snapshot;
  return snapshot;
}

export async function optionalFacts() {
 const source='export function entry(x?:i32):i32 { x ??= 7; return x; }';
  const input=await sourceInput(source,{declarationVersion:'minimal-conversions-v5'}),prepared=await prepareFrontendInput(input);
  const r=(start,end)=>({start,end}), x=source.indexOf('x?'),target=source.indexOf('x ??='),seven=source.indexOf('7'),read=source.lastIndexOf('x;');
  const presence={undefined:true,null:false,optional:true,default:false,range:r(x,x+6),annotation:r(x+3,x+6)};
  const parameter={id:'p',name:'x',kind:'parameter',writable:true,type:'i32',range:r(x,x+1),presence};
  const ref=(at,undefined_)=>({kind:'reference',symbol:'p',type:'i32',range:r(at,at+1),presenceFlow:{undefined:undefined_,null:false}});
  const write={kind:'write',operator:'??=',type:'i32',range:r(target,seven+1),left:ref(target,true),right:{kind:'integer',type:'i32',literal:{decimal:'7',token:'7'},range:r(seven,seven+1)}};
  const facts={status:'ok',diagnostics:[],inputs:['/src/main.ts','/src/minimal-conversions-v5.d.ts'],symbols:[{id:'f',name:'entry',kind:'function',type:'i32',range:r(16,21)},parameter],functions:[{symbol:'f',name:'entry',returnType:'i32',parameters:[parameter],parameterInitializers:[null],range:r(0,source.length),body:[{kind:'expression',range:r(target,seven+2),expression:write},{kind:'return',range:r(source.indexOf('return'),read+2),expression:ref(read,false)}]}]};
  const snapshot=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'independent-owned-fixture',binarySha256:'sha256:'+'0'.repeat(64)}).snapshot;
  return snapshot;
}

export async function postfixFacts() {
 const source='export function entry():i32 { let x:i32=1; return x++ + x; }';
  const input=await sourceInput(source,{declarationVersion:'minimal-conversions-v5'}),prepared=await prepareFrontendInput(input);
  const r=(start,end)=>({start,end}),x=source.indexOf('x:i32'),one=source.indexOf('=1')+1,update=source.indexOf('x++'),read=source.lastIndexOf('x;');
  const ref=at=>({kind:'reference',symbol:'x',type:'i32',range:r(at,at+1)});
  const local={id:'x',name:'x',kind:'local',type:'i32',writable:true,range:r(x,x+1)};
  const facts={status:'ok',diagnostics:[],inputs:['/src/main.ts','/src/minimal-conversions-v5.d.ts'],symbols:[{id:'f',name:'entry',kind:'function',type:'i32',range:r(16,21)},local],functions:[{symbol:'f',name:'entry',returnType:'i32',parameters:[],range:r(0,source.length),body:[{kind:'variable',range:r(x,one+1),symbol:local,initializer:{kind:'integer',type:'i32',literal:{token:'1',decimal:'1'},range:r(one,one+1)}},{kind:'return',range:r(source.indexOf('return'),read+2),expression:{kind:'binary',operator:'+',type:'i32',range:r(update,read+1),left:{kind:'update',operator:'++',prefix:false,type:'i32',range:r(update,update+3),operand:ref(update)},right:ref(read)}}]}]};
  const snapshot=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'independent-owned-fixture',binarySha256:'sha256:'+'0'.repeat(64)}).snapshot;
  return snapshot;
}


async function loweredFixture(id,snapshot,arguments_,physicalArguments,selfExpected) {
  validateFrontendSnapshot(snapshot);
  const built=buildHir(snapshot);
  assert.equal(built.status,'ok',id+': '+JSON.stringify(built));
  const hir=readHir(Buffer.from(printHir(built.hir)));
  return {id,source:snapshot.source.content,snapshot,hir,core:lowerFormalHir(hir),
    arguments:arguments_,physicalArguments,expected:selfExpected,selfExpected,
    expectedAuthority:'product-author-self-check-only; independent acceptance oracle must be supplied separately'};
}
const slot=hex=>hex.padStart(16,'0');
const value=(type,value)=>({type,value});
const result=value=>({kind:'value',type:'i32',value});

export async function baseOrdinaryFixtures() {
  const [compound,postfix,default_,optional]=await Promise.all([ordinaryFacts(),postfixFacts(),defaultFacts(),optionalFacts()]);
  return Promise.all([
    loweredFixture('compound-rhs-self-write',compound,[],[],result('6')),
    loweredFixture('postfix-old-plus-new',postfix,[],[],result('3')),
    loweredFixture('default-supplied',default_,[value('i32','11')],[slot('b'),slot('0')],result('11')),
    loweredFixture('default-undefined',default_,[value('undefined',null)],[slot('0'),slot('1')],result('7')),
    loweredFixture('default-omitted',default_,[],[slot('0'),slot('1')],result('7')),
    loweredFixture('optional-supplied',optional,[value('i32','8')],[slot('8'),slot('0')],result('8')),
    loweredFixture('optional-undefined',optional,[value('undefined',null)],[slot('0'),slot('1')],result('7')),
    loweredFixture('optional-omitted',optional,[],[slot('0'),slot('1')],result('7')),
  ]);
}

// Span helpers locate explicitly authored nodes in the fixed source below;
// they do not parse programs, synthesize a type checker or evaluate expected values.
const range=(start,end)=>({start,end});
const at=(source,text,start=0)=>{const found=source.indexOf(text,start);assert.ok(found>=0,text);return found;};
const reference=(name,type,start,flow)=>({kind:'reference',symbol:name,type,range:range(start,start+name.length),...(flow?{presenceFlow:flow}:{})});
const integer=(token,start,type='i32')=>({kind:'integer',type,literal:{token,decimal:token},range:range(start,start+token.length)});
const absent=(name,type,start)=>({kind:'absence',absence:name,type,range:range(start,start+name.length)});
const binary=(type,operator,left,right)=>({kind:'binary',type,operator,left,right,range:range(left.range.start,right.range.end)});
const write=(type,operator,left,right)=>({kind:'write',type,operator,left,right,range:range(left.range.start,right.range.end)});
const group=(operand)=>({kind:'group',type:operand.type,operand,range:range(operand.range.start-1,operand.range.end+1)});
const flow=(undefined_,null_=false)=>({undefined:undefined_,null:null_});
const returning=(source,expression)=>({kind:'return',range:range(source.lastIndexOf('return',expression.range.start),expression.range.end+1),expression});
const evaluate=expression=>({kind:'expression',range:range(expression.range.start,expression.range.end+1),expression});
function parameter(source,name,type,text,annotation,{optional=false,default_=false,undefined_=false,null_=false}={}) {
  const start=at(source,text),annotationStart=at(source,annotation,start);
  return {id:name,name,kind:'parameter',writable:true,type,range:range(start,start+name.length),presence:{undefined:undefined_,null:null_,optional,default:default_,range:range(start,start+text.length),annotation:range(annotationStart,annotationStart+annotation.length)}};
}
async function authoredSnapshot(source,parameters,parameterInitializers,body,locals=[],returnType='i32') {
  const input=await sourceInput(source,{declarationVersion:'minimal-conversions-v5'}),prepared=await prepareFrontendInput(input);
  const nameStart=at(source,'entry(');
  const facts={status:'ok',diagnostics:[],inputs:['/src/main.ts','/src/minimal-conversions-v5.d.ts'],
    symbols:[{id:'f',name:'entry',kind:'function',type:returnType,range:range(nameStart,nameStart+5)},...parameters,...locals],
    functions:[{symbol:'f',name:'entry',returnType,parameters,parameterInitializers,range:range(0,source.length),body}]};
  const result=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'product-author-owned-facts-only',binarySha256:'sha256:'+'0'.repeat(64)});
  assert.equal(result.status,'ok',JSON.stringify(result));return result.snapshot;
}
function conversion(type,from,mode,operand,start,end) {
  const entry=conversionDeclaration.entries.find(e=>e.mode===mode&&e.from===from&&e.to===type);
  assert.ok(entry);
  return {kind:'conversion',type,range:range(start,end),operand,conversion:{version:conversionDeclaration.version,entryId:entry.id,
    declarationPath:'/src/minimal-conversions-v5.d.ts',declarationSha256:conversionDeclaration.sha256,declarationRange:range(entry.start,entry.end),
    brandRefs:[['source',from],['target',type]].filter(([,name])=>name!=='f64').map(([role,nominal])=>({role,nominal,range:conversionDeclaration.brands[nominal]}))}};
}

export async function defaultNullFacts() {
  const source='export function entry(a:i32,x:i32|null=(a=7)):i32 { if(x===null) return a+10; return a; }';
  const a=parameter(source,'a','i32','a:i32','i32'),x=parameter(source,'x','i32','x:i32|null=(a=7)','i32|null',{optional:true,default_:true,undefined_:true,null_:true});
  const initializerAt=at(source,'a=7'),initializer=group(write('i32','=',reference('a','i32',initializerAt),integer('7',initializerAt+2)));
  const conditionAt=at(source,'x===null'),left=reference('x','i32',conditionAt,flow(false,true)),right=absent('null','i32',conditionAt+4);
  const condition={kind:'presenceTest',type:'bool',operator:'===',left,right,range:range(left.range.start,right.range.end)};
  const thenAt=at(source,'a+10'),thenReturn=returning(source,binary('i32','+',reference('a','i32',thenAt),integer('10',thenAt+2)));
  const statement={kind:'if',range:range(at(source,'if('),thenReturn.range.end),condition,thenBody:[thenReturn],elseBody:[]};
  const finalReturn=returning(source,reference('a','i32',source.lastIndexOf('a;')));
  return authoredSnapshot(source,[a,x],[null,initializer],[statement,finalReturn]);
}

export async function branchPresenceFacts() {
  const source='export function entry(x?:i32):i32 { if(x===undefined) x=4; return x; }';
  const p=parameter(source,'x','i32','x?:i32','i32',{optional:true,undefined_:true});
  const conditionAt=at(source,'x===undefined'),left=reference('x','i32',conditionAt,flow(true)),right=absent('undefined','i32',conditionAt+4);
  const condition={kind:'presenceTest',type:'bool',operator:'===',left,right,range:range(left.range.start,right.range.end)};
  const assignAt=at(source,'x=4'),assignment=evaluate(write('i32','=',reference('x','i32',assignAt,flow(true)),integer('4',assignAt+2)));
  const statement={kind:'if',range:range(at(source,'if('),assignment.range.end),condition,thenBody:[assignment],elseBody:[]};
  return authoredSnapshot(source,[p],[null],[statement,returning(source,reference('x','i32',source.lastIndexOf('x;'),flow(false)))]);
}

export async function loopPresenceFacts() {
  const source='export function entry(x?:i32):i32 { while(x===undefined) { x=5; } return x; }';
  const p=parameter(source,'x','i32','x?:i32','i32',{optional:true,undefined_:true});
  const conditionAt=at(source,'x===undefined'),left=reference('x','i32',conditionAt,flow(true)),right=absent('undefined','i32',conditionAt+4);
  const condition={kind:'presenceTest',type:'bool',operator:'===',left,right,range:range(left.range.start,right.range.end)};
  const assignAt=at(source,'x=5'),assignment=evaluate(write('i32','=',reference('x','i32',assignAt,flow(true)),integer('5',assignAt+2)));
  const block={kind:'block',range:range(at(source,'{ x=5'),at(source,'} return')+1),body:[assignment]};
  const statement={kind:'while',range:range(at(source,'while('),block.range.end),condition,body:[block]};
  return authoredSnapshot(source,[p],[null],[statement,returning(source,reference('x','i32',source.lastIndexOf('x;'),flow(false)))]);
}

export async function conversionOnceFacts() {
  const source='export function entry():i32 { let x:i32=1; return checked_i32_from_i32(x++) + x; }';
  const localAt=at(source,'x:i32'),oneAt=at(source,'=1')+1,callAt=at(source,'checked_i32_from_i32'),updateAt=at(source,'x++');
  const local={id:'x',name:'x',kind:'local',type:'i32',writable:true,range:range(localAt,localAt+1)};
  const variable={kind:'variable',range:range(localAt,oneAt+1),symbol:local,initializer:integer('1',oneAt)};
  const operand={kind:'update',operator:'++',prefix:false,type:'i32',operand:reference('x','i32',updateAt),range:range(updateAt,updateAt+3)};
  const call=conversion('i32','i32','checked',operand,callAt,updateAt+4);
  return authoredSnapshot(source,[],[],[variable,returning(source,binary('i32','+',call,reference('x','i32',source.lastIndexOf('x;'))))],[local]);
}

export async function conversionFirstTrapFacts() {
  const source='/*😀*/ export function entry(x:f64):i8 { return checked_i8_from_f64(x) + checked_i8_from_f64(x / 0.0); }';
  const p=parameter(source,'x','f64','x:f64','f64');
  const firstAt=at(source,'checked_i8_from_f64'),firstX=at(source,'(x)',firstAt)+1;
  const first=conversion('i8','f64','checked',reference('x','f64',firstX),firstAt,firstX+2);
  const secondAt=at(source,'checked_i8_from_f64',first.range.end),secondX=at(source,'(x /',secondAt)+1,zeroAt=at(source,'0.0',secondX);
  const zero={kind:'floating',type:'f64',float:{token:'0.0',bits:'0000000000000000'},range:range(zeroAt,zeroAt+3)};
  const second=conversion('i8','f64','checked',binary('f64','/',reference('x','f64',secondX),zero),secondAt,zeroAt+4);
  return authoredSnapshot(source,[p],[null],[returning(source,binary('i8','+',first,second))],[],'i8');
}

export async function extendedOrdinaryFixtures() {
  const [nullable,branch,loop,once,traps,callOmitted,callUndefined,callNull]=await Promise.all([defaultNullFacts(),branchPresenceFacts(),loopPresenceFacts(),conversionOnceFacts(),conversionFirstTrapFacts(),sourceCallDefaultFacts("omitted"),sourceCallDefaultFacts("undefined"),sourceCallDefaultFacts("null")]);
  const first=traps.functions[0].body[0].expression.left.range,second=traps.functions[0].body[0].expression.right.range;
  return Promise.all([
    loweredFixture('source-call-default-omitted',callOmitted,[],[],result('7')),
    loweredFixture('source-call-default-undefined',callUndefined,[],[],result('7')),
    loweredFixture('source-call-default-null',callNull,[],[],result('9')),
    loweredFixture('nullable-default-supplied-no-side-effect',nullable,[value('i32','3'),value('i32','11')],[slot('3'),slot('b'),slot('0')],result('3')),
    loweredFixture('nullable-default-null-preserved',nullable,[value('i32','3'),value('null',null)],[slot('3'),slot('0'),slot('2')],result('13')),
    loweredFixture('nullable-default-undefined-side-effect',nullable,[value('i32','3'),value('undefined',null)],[slot('3'),slot('0'),slot('1')],result('7')),
    loweredFixture('nullable-default-omitted-side-effect',nullable,[value('i32','3')],[slot('3'),slot('0'),slot('1')],result('7')),
    loweredFixture('branch-presence-omitted',branch,[],[slot('0'),slot('1')],result('4')),
    loweredFixture('branch-presence-supplied',branch,[value('i32','8')],[slot('8'),slot('0')],result('8')),
    loweredFixture('loop-presence-omitted',loop,[],[slot('0'),slot('1')],result('5')),
    loweredFixture('loop-presence-supplied',loop,[value('i32','12')],[slot('c'),slot('0')],result('12')),
    loweredFixture('conversion-update-operand-once',once,[],[],result('3')),
    loweredFixture('conversion-first-range-before-nonfinite',traps,[value('f64','4072c00000000000')],['4072c00000000000'],{kind:'trap',code:'r01-t-conversion-range',ruleId:'r01-conversions',source:first}),
    loweredFixture('conversion-second-nonfinite-after-first-success',traps,[value('f64','3ff0000000000000')],['3ff0000000000000'],{kind:'trap',code:'r01-t-conversion-nonfinite',ruleId:'r01-conversions',source:second}),
  ]);
}

export async function ordinaryFixtures() {
  const [base,extended]=await Promise.all([baseOrdinaryFixtures(),extendedOrdinaryFixtures()]);
  return [...base,...extended];
}

export async function sourceCallDefaultFacts(absence) {
  assert.ok(['omitted','undefined','null'].includes(absence));
  const argumentText=absence==='omitted'?'':absence;
  const source=`export function entry():i32 { return target(${argumentText}); } function target(x:i32|null=7):i32 { if(x===null) return 9; return x; }`;
  const targetStart=at(source,'function target'),entryEnd=at(source,'}')+1;
  const p=parameter(source,'x','i32','x:i32|null=7','i32|null',{optional:true,default_:true,undefined_:true,null_:true});
  const callAt=at(source,'target('),argumentAt=callAt+7;
  const call={kind:'call',type:'i32',target:'t',range:range(callAt,argumentAt+argumentText.length+1),arguments:absence==='omitted'?[]:[absent(absence,'i32',argumentAt)],signature:{returnType:'i32',parameters:['i32'],presence:[p.presence]}};
  const conditionAt=at(source,'x===null',targetStart),left=reference('x','i32',conditionAt,flow(false,true)),right=absent('null','i32',conditionAt+4);
  const condition={kind:'presenceTest',type:'bool',operator:'===',left,right,range:range(left.range.start,right.range.end)};
  const thenReturn=returning(source,integer('9',at(source,'9;',targetStart)));
  const statement={kind:'if',range:range(at(source,'if(',targetStart),thenReturn.range.end),condition,thenBody:[thenReturn],elseBody:[]};
  const targetName=at(source,'target(',targetStart);
  const facts={status:'ok',diagnostics:[],inputs:['/src/main.ts','/src/minimal-conversions-v5.d.ts'],symbols:[
    {id:'f',name:'entry',kind:'function',type:'i32',range:range(16,21)},
    {id:'t',name:'target',kind:'function',type:'i32',range:range(targetName,targetName+6)},p],functions:[
      {symbol:'f',name:'entry',returnType:'i32',parameters:[],parameterInitializers:[],range:range(0,entryEnd),body:[returning(source,call)]},
      {symbol:'t',name:'target',returnType:'i32',parameters:[p],parameterInitializers:[integer('7',at(source,'=7',targetStart)+1)],range:range(targetStart,source.length),body:[statement,returning(source,reference('x','i32',source.lastIndexOf('x;'),flow(false)))]},
    ]};
  const input=await sourceInput(source,{declarationVersion:'minimal-conversions-v5'}),prepared=await prepareFrontendInput(input);
  const result=materializeFrontendResponse(prepared,JSON.stringify(facts),{forkOid:'product-author-owned-facts-only',binarySha256:'sha256:'+'0'.repeat(64)});
  assert.equal(result.status,'ok',JSON.stringify(result));return result.snapshot;
}

export async function logicalAssignmentFacts(operator) {
  assert.ok(['&&=','||='].includes(operator));
  const source=`export function entry(flag:bool):i32 { let x:i32=1; flag ${operator} ((x=9)===9); return x; }`;
  const p=parameter(source,'flag','bool','flag:bool','bool');
  const localAt=at(source,'x:i32'),oneAt=at(source,'=1')+1;
  const local={id:'x',name:'x',kind:'local',type:'i32',writable:true,range:range(localAt,localAt+1)};
  const variable={kind:'variable',range:range(localAt,oneAt+1),symbol:local,initializer:integer('1',oneAt)};
  const rhsAt=at(source,'x=9'),writeSideEffect=group(write('i32','=',reference('x','i32',rhsAt),integer('9',rhsAt+2)));
  const condition=group(binary('bool','===',writeSideEffect,integer('9',at(source,'===9')+3)));
  const flagAt=at(source,`flag ${operator}`),assignment={...write('bool',operator,reference('flag','bool',flagAt),condition),presenceFlow:flow(false)};
  return authoredSnapshot(source,[p],[null],[variable,evaluate(assignment),returning(source,reference('x','i32',source.lastIndexOf('x;')))],[local]);
}

// Separate export preserves ordinaryFixtures()'s original22-case input set.
export async function logicalOrdinaryFixtures() {
  const [and_,or_]=await Promise.all([logicalAssignmentFacts('&&='),logicalAssignmentFacts('||=')]);
  return Promise.all([
    loweredFixture('logical-and-true-rhs-side-effect',and_,[value('bool',true)],[slot('1')],result('9')),
    loweredFixture('logical-and-false-skips-rhs',and_,[value('bool',false)],[slot('0')],result('1')),
    loweredFixture('logical-or-true-skips-rhs',or_,[value('bool',true)],[slot('1')],result('1')),
    loweredFixture('logical-or-false-rhs-side-effect',or_,[value('bool',false)],[slot('0')],result('9')),
  ]);
}
