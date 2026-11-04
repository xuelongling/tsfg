// SPDX-License-Identifier: MIT
// Fresh literal metadata exercises typed inner seams only. No Source producer,
// verified package, publication, actual-storage engine, VM, or child process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonSourceGrammar,commonTypeSyntax} from '../../compiler/common-program-source.mjs';
import {validateCommonDeclarations} from '../../compiler/common-program-declarations.mjs';
import {validateCommonBodies} from '../../compiler/common-program-body.mjs';
import {planCommonFunction} from '../../compiler/common-program-control.mjs';
import {projectConstructorReturnOrigins} from '../../compiler/common-program-constructor-return-origins.mjs';
import {commonReturnOrigins} from '../../compiler/common-program-return-origins.mjs';
import {commonReturnOriginAvailability} from '../../compiler/common-program-return-origin-source.mjs';
import {commonSemanticIdentities} from '../../compiler/common-program-identities.mjs';
import {commonMeter,sha256,canonical} from '../../compiler/common-program-common.mjs';
import {i32TypeId,boolTypeId} from '../../compiler/identity.mjs';
import {originId,signatureId} from '../../compiler/typed-array-schema.mjs';

const undefinedId=sha256('tsfg.type\0undefined'),nullId=sha256('tsfg.type\0null'),incoming='literal:i32-or-undefined';
const at=(start,end=start+1)=>({start,end});
const literal=(token,range=at(40))=>({kind:'numericLiteral',type:i32TypeId,token,decimal:token,range});
const reference=(binding,type=i32TypeId,range=at(50))=>({kind:'bindingReference',binding,type,range});
const parameter=(id,type=i32TypeId)=>({id,name:id,type,kind:'parameter',lexicalOwner:'literal-owner',writable:true,range:at(10),nameRange:at(10)});
function planned(parameters,steps,body,extra=[]) {
  const owner={id:'literal-owner',name:'ordinary',kind:'source',sourcePath:'/literal/ordinary.ts',returnType:i32TypeId,
    lexicalEnvironment:null,activationEnvironment:null,captures:[],parameters,bindings:[],range:at(0,1000),nameRange:at(0,8),body,
    ...(steps?{parameterInitialization:{minimumArgumentCount:0,hasParameterExpressions:steps.some(step=>step.initializer),steps}}:{})};
  const types=new Map([[i32TypeId,{id:i32TypeId,kind:'scalar',name:'i32'}],[boolTypeId,{id:boolTypeId,kind:'scalar',name:'bool'}],
    [undefinedId,{id:undefinedId,kind:'undefined'}],[nullId,{id:nullId,kind:'null'}],[incoming,{id:incoming,kind:'union',members:[i32TypeId,undefinedId]}]]);
  const model={types,bindings:new Map(parameters.map(row=>[row.id,row])),functions:new Map([owner,...extra].map(row=>[row.id,row])),
    spend:commonMeter(),limits:{parameters:64},slots:new Map(),environments:new Map(),payload:'payload:literal',cell:id=>'cell:'+id};
  return {plan:planCommonFunction(model,owner),model};
}
const instructions=plan=>plan.graph.blocks.flatMap(block=>block.instructions);

// A partial literal payload for the body validator's own interface, with real
// token ranges and Source origin IDs. This is never packaged or certified.
function checkedBody(parameters,arguments_,minimum=undefined,signatureMinimum=minimum,asValue=false) {
  const sourcePath='/literal/call-body.ts',header=parameters.map(row=>row.header).join(', '),
    content=`function f(${header}): i32 { return 0; }\nfunction g(): i32 { ${asValue?'f; return 0;':`return f(${arguments_.join(', ')});`} }`,
    firstEnd=content.indexOf('\n'),secondStart=firstEnd+1,spend=commonMeter(),source={path:sourcePath,content},grammar=commonSourceGrammar(source,spend),
    id=range=>sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath,declarationRange:range})),fRange=at(0,firstEnd),gRange=at(secondStart,content.length),fId=id(fRange),gId=id(gRange);
  let cursor='function f('.length;
  const bindings=parameters.map(row=>{
    const start=cursor,nameRange=at(start),annotationStart=start+row.header.indexOf(row.annotation),annotationRange=at(annotationStart,annotationStart+row.annotation.length);
    cursor+=row.header.length+2;
    return {id:originId(sourcePath,nameRange),name:row.header[0],kind:'parameter',declaredType:row.type,writable:true,lexicalOwner:fId,
      declarationRange:at(start,start+row.header.length),nameRange,annotationRange,elementAnnotationRange:null};
  });
  const value=(spelling,range)=>spelling==='undefined'?{kind:'undefinedLiteral',type:'undefined',flowType:'undefined',range}
    :{kind:'numericLiteral',type:'i32',flowType:'i32',token:spelling,decimal:spelling,range};
  const descriptor=(name,range,parameters,body)=>{
    const annotationStart=content.indexOf('): i32',range.start)+3;
    return {id:id(range),name,access:'public',sourcePath,lexicalParent:null,captures:[],declarationScope:at(0,content.length),
      declarationRange:range,nameRange:at(range.start+'function '.length),returnAnnotationRange:at(annotationStart,annotationStart+3),returnType:'i32',parameters,bindings:[],body};
  };
  const zero=content.indexOf('0;'),firstReturn=content.indexOf('return '),f=descriptor('f',fRange,bindings,[{kind:'return',range:at(firstReturn,zero+2),value:value('0',at(zero))}]);
  if(minimum!==undefined)f.parameterInitialization={minimumArgumentCount:minimum,hasParameterExpressions:parameters.some(row=>row.initializer!==undefined),
    steps:bindings.map((binding,index)=>({binding:binding.id,range:binding.declarationRange,argumentType:parameters[index].argumentType??binding.declaredType,
      ...(parameters[index].initializer===undefined?{}:{initializer:value(parameters[index].initializer,
        at(binding.declarationRange.end-parameters[index].initializer.length,binding.declarationRange.end))})}))};
  const functionType=sha256('tsfg.program.function-type.v2\0'+canonical({parameters:bindings.map(row=>row.declaredType),returnType:'i32'}));
  let g;
  if(asValue){const selected=content.lastIndexOf('f;'),zero=content.lastIndexOf('0;');
    g=descriptor('g',gRange,[],[{kind:'expression',range:at(selected,selected+2),value:{kind:'functionReference',functionId:fId,type:functionType,flowType:functionType,range:at(selected)}},
      {kind:'return',range:at(content.lastIndexOf('return '),zero+2),value:value('0',at(zero))}]);
  }else{const calleeStart=content.lastIndexOf('f('),callEnd=content.lastIndexOf(')')+1;let argumentStart=calleeStart+2;
    const args=arguments_.map(spelling=>{const result=value(spelling,at(argumentStart,argumentStart+spelling.length));argumentStart+=spelling.length+2;return result;});
    const call={kind:'call',type:'i32',flowType:'i32',range:at(calleeStart,callEnd),calleeRange:at(calleeStart),callee:fId,arguments:args,
      signature:{id:signatureId(sourcePath,fRange),sourcePath,declarationRange:fRange,parameters:bindings.map(row=>row.declaredType),returnType:'i32',
        ...(signatureMinimum===undefined?{}:{minimumArgumentCount:signatureMinimum})}};
    g=descriptor('g',gRange,[],[{kind:'return',range:at(content.lastIndexOf('return '),callEnd+1),value:call}]);
  }
  const types=new Map([['i32',{id:'i32',kind:'scalar',name:'i32',constructor:null}],['undefined',{id:'undefined',kind:'undefined',constructor:null}],
    ['union<i32,undefined>',{id:'union<i32,undefined>',kind:'union',members:['i32','undefined'],constructor:null}],
    [functionType,{id:functionType,kind:'function',parameters:bindings.map(row=>row.declaredType),returnType:'i32',constructor:null}]]),
    payload={rootFile:sourcePath,functions:[f,g],types:[],hostImports:[],globals:[],typeAliases:[],compatibilityWitnesses:[],
      readSpanIntrinsic:{id:'unused:read-span'},modules:[{sourcePath,exports:[],initialization:[]}],exports:[],entryCompatibilityRoots:[]};
  return validateCommonBodies(payload,new Map([[sourcePath,source]]),types,new Map([[sourcePath,grammar]]),
    new Map([[sourcePath,new Map([['f',fId],['g',gId]])]]),spend);
}

test('body ownership validates default and optional direct-call incoming types and minimum',()=>{
  const defaulted={header:'x: i32 = 7',annotation:'i32',type:'i32',argumentType:'union<i32,undefined>',initializer:'7'},
    optional={header:'x?: i32',annotation:'i32',type:'union<i32,undefined>'};
  for(const p of [defaulted,optional])for(const args of [[],['undefined'],['5']])assert.doesNotThrow(()=>checkedBody([p],args,0));
  const required={header:'x: i32 | undefined',annotation:'i32 | undefined',type:'union<i32,undefined>'};
  assert.doesNotThrow(()=>checkedBody([required],['undefined']));
  assert.throws(()=>checkedBody([required],[]),/signature/);
  assert.throws(()=>checkedBody([defaulted],[],0,1),/signature/);
});

test('a required later parameter keeps the real minimum after an earlier default',()=>{
  const first={header:'a: i32 = 7',annotation:'i32',type:'i32',argumentType:'union<i32,undefined>',initializer:'7'},
    second={header:'b: i32',annotation:'i32',type:'i32'};
  assert.doesNotThrow(()=>checkedBody([first,second],['undefined','5'],2));
  assert.throws(()=>checkedBody([first,second],['5'],2),/signature/);
  assert.throws(()=>checkedBody([first,second],[],2),/signature/);
  assert.throws(()=>checkedBody([first,second],['undefined','5'],2,0),/signature/);
});

test('ordinary FDI signature owns incoming types and explicit minimum while required-only identity stays exact',()=>{
  const types=[{id:'i32',kind:'scalar',name:'i32',constructor:null},{id:'undefined',kind:'undefined',constructor:null},
    {id:'union<i32,undefined>',kind:'union',members:['i32','undefined'],constructor:null}],
    p={id:'x',name:'x',kind:'parameter',declaredType:'i32'},
    fn={id:'literal-source-function',name:'f',sourcePath:'/literal/identity.ts',lexicalParent:null,parameters:[p],bindings:[],body:[],returnType:'i32'};
  const identify=owner=>commonSemanticIdentities({types,functions:[owner],globals:[]},commonMeter());
  const required=identify(fn),present=identify({...fn,parameterInitialization:{minimumArgumentCount:0,hasParameterExpressions:true,
    steps:[{binding:'x',argumentType:'union<i32,undefined>',range:at(10,20),initializer:literal('7')}]}});
  assert.deepEqual(required.callableTypes.get(fn.id),{parameters:[i32TypeId],returns:i32TypeId});
  assert.deepEqual(present.callableTypes.get(fn.id),{parameters:[present.typeIds.get('union<i32,undefined>')],returns:i32TypeId,minimumArgumentCount:0});
  assert.notEqual(required.signatures.get(fn.id),present.signatures.get(fn.id));
  const explicitUndefined=identify({...fn,parameters:[{...p,declaredType:'union<i32,undefined>'}]});
  assert.equal(Object.hasOwn(explicitUndefined.callableTypes.get(fn.id),'minimumArgumentCount'),false);
});

test('Source function values reject real FDI at ownership while required-only callable views stay supported',()=>{
  const required={header:'x: i32',annotation:'i32',type:'i32'},
    defaulted={header:'x: i32 = 7',annotation:'i32',type:'i32',argumentType:'union<i32,undefined>',initializer:'7'},
    optional={header:'x?: i32',annotation:'i32',type:'union<i32,undefined>'};
  assert.doesNotThrow(()=>checkedBody([required],[],undefined,undefined,true));
  for(const parameter of [defaulted,optional])assert.throws(()=>checkedBody([parameter],[],0,0,true),
    error=>error instanceof Error&&'code' in error&&error.code==='r03-common-program-capability'&&error.message.includes('function values'));
});

test('ordinary optional annotation owns the real question token and concrete scalar union',()=>{
  const code='function f(x?: i32): i32 { return 0; }',source={path:'/literal/question.ts',content:code},spend=commonMeter(),g=commonSourceGrammar(source,spend);
  const name=at(code.indexOf('x')),annotation=at(code.indexOf('i32'),code.indexOf('i32')+3),decl=at(name.start,annotation.end);
  const types=new Map([['i32',{id:'i32',kind:'scalar',name:'i32'}],['undefined',{id:'undefined',kind:'undefined'}],
    ['union<i32,undefined>',{id:'union<i32,undefined>',kind:'union',members:['i32','undefined']}]]);
  const p={id:'x',name:'x',nameRange:name,declarationRange:decl,annotationRange:annotation,declaredType:'union<i32,undefined>'};
  const fn={name:'f',sourcePath:source.path,nameRange:at(code.indexOf('f(')),declarationRange:at(0,code.length),
    returnType:'i32',returnAnnotationRange:at(code.lastIndexOf('i32'),code.lastIndexOf('i32')+3),parameters:[p],
    parameterInitialization:{minimumArgumentCount:0,hasParameterExpressions:false,steps:[{binding:'x',range:decl,argumentType:p.declaredType}]}};
  const payload={functions:[fn],types:[],typeAliases:[]},grammars=new Map([[source.path,g]]),visible=new Map([[source.path,new Map()]]);
  assert.doesNotThrow(()=>validateCommonDeclarations(payload,grammars,types,spend,visible));
  assert.throws(()=>commonTypeSyntax(g,annotation,p.declaredType,types,spend),/r03-common-program-source/);
  assert.doesNotThrow(()=>commonTypeSyntax(g,annotation,p.declaredType,types,spend,[],null,true));
  assert.throws(()=>validateCommonDeclarations({...payload,functions:[{...fn,parameterInitialization:undefined}]},grammars,types,spend,visible),/parameter-initialization/);
  assert.throws(()=>validateCommonDeclarations({...payload,functions:[{...fn,ownerType:'a-method-owner'}]},grammars,types,spend,visible));
});

test('optional annotation admits explicit undefined and nullable members without erasing them',()=>{
  const spend=commonMeter(),types=new Map([['i32',{id:'i32',kind:'scalar',name:'i32'}],['undefined',{id:'undefined',kind:'undefined'}],['null',{id:'null',kind:'null'}],
    ['presence',{id:'presence',kind:'union',members:['i32','null','undefined']}]]);
  for(const content of ['i32 | null | undefined','i32 | null']){
    const grammar=commonSourceGrammar({path:'/literal/annotation.ts',content},spend);
    assert.doesNotThrow(()=>commonTypeSyntax(grammar,at(0,content.length),'presence',types,spend,[],null,true));
  }
  const grammar=commonSourceGrammar({path:'/literal/annotation.ts',content:'i32'},spend);
  assert.throws(()=>commonTypeSyntax(grammar,at(0,3),'presence',types,spend,[],null,true),/r03-common-program-source/);
});

test('default normalization preserves incoming union, original binding, and initializer anchor',()=>{
  const p=parameter('x'),range=at(10,30),initializer=literal('7',at(24));
  const {plan}=planned([p],[{binding:p.id,argumentType:incoming,range,initializer}],[{kind:'return',value:reference(p.id),range:at(50,60)}]);
  assert.equal(plan.parameters[0].type,incoming);
  assert.equal(plan.entry.parameters[0].type,incoming);
  const ops=instructions(plan),testUndefined=ops.find(op=>op.name==='tsfg_program.strict_equal');
  assert.equal(testUndefined.operands[0],plan.entry.parameters[0].name);
  const fallback=ops.find(op=>op.name==='tsfg_program.constant');
  assert.deepEqual(fallback.range,initializer.range);
  assert.equal(fallback.properties.token,'7');
  assert.deepEqual(ops.filter(op=>op.name==='tsfg_program.cell').map(op=>op.properties.binding),['x']);
  assert.deepEqual(ops.filter(op=>op.name==='tsfg_program.store').map(op=>op.properties),[{binding:'x',initialize:true}]);
  assert.equal(ops.some(op=>op.name.startsWith('tsfg_program.receiver_')),false);
});

test('optional incoming undefined is stored unchanged without a default branch',()=>{
  const p=parameter('x',incoming),{plan}=planned([p],[{binding:p.id,argumentType:incoming,range:at(10,30)}],[{kind:'return',value:literal('0'),range:at(50,60)}]);
  const ops=instructions(plan),stored=ops.find(op=>op.name==='tsfg_program.store');
  assert.equal(stored.operands[1],plan.entry.parameters[0].name);
  assert.equal(ops.some(op=>op.name==='tsfg_program.strict_equal'),false);
});

test('defaults see earlier original bindings and never later or self bindings',()=>{
  const a=parameter('a'),b=parameter('b'),steps=[{binding:'a',argumentType:incoming,range:at(10,20),initializer:literal('1',at(15))},
    {binding:'b',argumentType:incoming,range:at(21,30),initializer:reference('a',i32TypeId,at(26))}];
  const {plan}=planned([a,b],steps,[{kind:'return',value:reference('b'),range:at(50,60)}]);
  const ops=instructions(plan),originalCell=ops.find(op=>op.name==='tsfg_program.cell'&&op.properties.binding==='a');
  const read=ops.find(op=>op.name==='tsfg_program.load'&&op.range.start===26);
  assert.deepEqual(read.operands,[originalCell.result]);
  assert.deepEqual(read.range,at(26));
  assert.throws(()=>planned([a,b],[{...steps[0],initializer:reference('b')},steps[1]],[]),/r03-common-program-scope/);
  assert.throws(()=>planned([a],[{...steps[0],initializer:reference('a')}],[]),/r03-common-program-scope/);
});

test('later defaults can assign the earlier binding without resetting its incoming value',()=>{
  const a=parameter('a'),b=parameter('b'),assignment={kind:'bindingAssignment',type:i32TypeId,operator:'=',
    target:{kind:'bindingTarget',binding:'a',type:i32TypeId,range:at(26)},value:literal('3',at(28)),range:at(26,29)};
  const {plan}=planned([a,b],[{binding:'a',argumentType:incoming,range:at(10,20),initializer:literal('1',at(15))},
    {binding:'b',argumentType:incoming,range:at(21,30),initializer:assignment}],[{kind:'return',value:reference('a'),range:at(50,60)}]);
  assert.deepEqual(instructions(plan).filter(op=>op.name==='tsfg_program.store'&&op.properties.binding==='a').map(op=>op.properties.initialize),[true,false]);
});

test('calls pass real incoming undefined and pad omissions to the callee input type',()=>{
  const target={id:'default-target',kind:'source',parameters:[parameter('x')],returnType:i32TypeId,signatureHash:sha256('literal-default-target'),
    parameterInitialization:{minimumArgumentCount:0,hasParameterExpressions:true,steps:[{binding:'x',argumentType:incoming,range:at(10,20),initializer:literal('7')}]}};
  for(const arguments_ of [[],[{kind:'undefinedLiteral',type:undefinedId,range:at(32,41)}],[literal('5',at(32))]]){
    const call={kind:'call',callee:target.id,type:i32TypeId,range:at(30,45),signature:{parameters:[i32TypeId],returnType:i32TypeId,minimumArgumentCount:0},arguments:arguments_};
    const {plan}=planned([],null,[{kind:'return',value:call,range:at(30,50)}],[target]);
    const ops=instructions(plan),invoke=ops.find(op=>op.name==='tsfg_program.invoke'),passed=plan.graph.registers.get(invoke.operands[0]);
    assert.equal(invoke.operands.length,1);
    assert.equal(passed.view,incoming);
    assert.equal(passed.operation.name,'tsfg_program.value_copy');
    const input=plan.graph.registers.get(passed.operation.operands[0]);
    assert.equal(input.operation.name,arguments_.length&&arguments_[0].kind==='numericLiteral'?'tsfg_program.constant':'tsfg_program.undefined');
    assert.deepEqual(input.operation.range,arguments_.length?arguments_[0].range:call.range);
  }
});

test('a default call language completion bypasses handlers in the function body',()=>{
  const p=parameter('x'),target={id:'default-expression-target',kind:'source',parameters:[],returnType:i32TypeId,signatureHash:sha256('literal-default-expression-target')},
    call={kind:'call',callee:target.id,type:i32TypeId,range:at(15,20),arguments:[],signature:{parameters:[],returnType:i32TypeId}};
  const body=[{kind:'try',range:at(100,200),tryBlock:{range:at(104,140),body:[{kind:'return',value:reference('x'),range:at(110,120)}]},
    catchClause:{binding:null,block:{range:at(150,190),body:[{kind:'return',value:literal('0'),range:at(160,170)}]}}}];
  const {plan}=planned([p],[{binding:'x',argumentType:incoming,range:at(10,20),initializer:call}],body,[target]),ops=instructions(plan);
  const invoke=ops.find(op=>op.name==='tsfg_program.invoke'),exceptional=plan.graph.blocks.find(block=>block.name===invoke.successors[1]);
  assert.deepEqual(exceptional.instructions.map(op=>op.name),['tsfg_program.return_throw']);
  assert.deepEqual(exceptional.instructions[0].range,call.range);
  assert.equal(ops.filter(op=>op.name==='tsfg_program.enter_handler').length,1);
});

test('real normalized return graph owns incoming parameter type and default literal separately',()=>{
  const p=parameter('x'),{plan,model}=planned([p],[{binding:'x',argumentType:incoming,range:at(10,30),initializer:literal('7',at(24))}],
    [{kind:'return',value:reference('x'),range:at(50,60)}]);
  const catalogue={types:model.types,functions:new Map(),constructions:new Map(),slots:new Map(),environments:new Map()},
    graph=commonReturnOrigins(model.spend,{environments:new Map(),rootProtocol:{lexicalEnvironment:null,activationEnvironment:null,construction:null},
      actualType:id=>model.types.get(id)}),result=projectConstructorReturnOrigins({plan,model},catalogue,graph,model.spend);
  assert.deepEqual(result.graph.nodes.filter(node=>node.kind==='parameter').map(node=>({index:node.index,type:node.type})),[{index:0,type:incoming}]);
  assert.equal(result.graph.nodes.some(node=>node.kind==='literal'&&node.category==='other'&&node.type===i32TypeId),true);
  assert.equal(result.graph.exits.normal.length,1);
  assert.equal(result.graph.exits.language.length,0);
});

test('FDI return availability requires its owning CFG and retains unrelated unknown storage Open',()=>{
  const p=parameter('x'),{plan,model}=planned([p],[{binding:'x',argumentType:incoming,range:at(10,30),initializer:literal('7')}],
    [{kind:'return',value:reference('x'),range:at(50,60)}]),hir={types:[...model.types.values()],functions:[plan.owner],environments:[]};
  const absent=commonReturnOriginAvailability(hir,null,null,model.spend);
  assert.equal(absent.reasons.get(plan.owner.id),'parameter-initialization-cfg-open');
  const normalized=commonReturnOriginAvailability(hir,null,null,model.spend,null,{corePlans:[plan]});
  assert.equal(normalized.selected.has(plan.owner.id),true);
  assert.equal(normalized.scalarLocal.get(plan.owner.id),true);
  const unknown={id:'literal:unknown',kind:'unknown'},changed={...hir,types:[...hir.types,unknown],functions:[{...plan.owner,returnType:unknown.id}]};
  assert.equal(commonReturnOriginAvailability(changed,null,null,model.spend).reasons.get(plan.owner.id),'parameter-initialization-cfg-open');
  assert.equal(commonReturnOriginAvailability(changed,null,null,model.spend,null,{corePlans:[plan]}).reasons.get(plan.owner.id),'storage-projection-open');
});
