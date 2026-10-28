// SPDX-License-Identifier: MIT
// An owning cold boundary for checked source data. No execution admission.
import descriptor from '../contracts/system-query-facts.schema.json' with {type:'json'};
import {canonical,sha256,own} from './identity.mjs';
import {copyGenericJsonBytes,readGenericJson} from './generic-json.mjs';
import {checkTypedArrayShape,sourceRange,originId,logicalPath,byteOrder} from './typed-array-schema.mjs';
import {validateTypedArrayTypes} from './typed-array-types.mjs';
import {commonSourceDescriptor} from './common-program-common.mjs';
import {querySourceProof} from './system-query-source-bindings.mjs';
import {decodeScalarHelpers} from './system-query-scalars.mjs';
import {decodeQueryStatements} from './system-query-statements.mjs';
import {commonSemanticIdentities,commonFieldId} from './common-program-identities.mjs';
import {commonSourceGrammar,commonTypeSyntax,commonSourceAccess} from './common-program-source.mjs';




export const systemQueryFactsFormat=own({family:descriptor.family,version:descriptor.version,schemaHash:sha256(canonical(descriptor)+'\n')});
const policy={...descriptor.limits,safeNonnegativeIntegers:true,allowNul:true,rejectPrototypeKeys:false};
const receipts=new WeakMap();

/** @typedef {Readonly<{start:number,end:number}>} SystemQueryRange */
/** @typedef {Readonly<{id:string,sourcePath:string,kind:string,name:string,range:SystemQueryRange,nameRange:SystemQueryRange}>} SystemQueryOrigin */
/** @typedef {Readonly<{useSourcePath:string,useRange:SystemQueryRange,declaration:SystemQueryOrigin,target:SystemQueryOrigin}>} SystemQueryAlias */
/** @typedef {Readonly<{index:number,mode:'read'|'write',range:SystemQueryRange,wrapper:SystemQueryOrigin,sourceComponentType:string,componentType:string,component:SystemQueryOrigin,componentSourcePath:string,componentRange:SystemQueryRange}>} SystemQueryAccess */
/** @typedef {Readonly<{declaration:SystemQueryOrigin,tupleSourcePath:string,tupleRange:SystemQueryRange,aliases:readonly SystemQueryAlias[],items:readonly SystemQueryAccess[]}>} SystemQuerySelection */
/** @typedef {Readonly<{index:number,binding:SystemQueryOrigin,annotationRange:SystemQueryRange,logicalType:string,type:string|null,query:SystemQuerySelection|null,view:Readonly<{aliases:readonly SystemQueryAlias[],access:SystemQueryAccess}>|null}>} SystemQueryParameter */
/** A checked view of the existing shared arrayGenericExpression/Target DTO.
 * @typedef {{kind:string,type:string,flowType?:string,token?:string,bits?:string,range:SystemQueryRange,binding?:string,property?:string,nameRange?:SystemQueryRange,receiver?:CheckedArrayExpression,left?:CheckedArrayExpression,right?:CheckedArrayExpression,target?:CheckedArrayExpression,value?:CheckedArrayExpression,expression?:CheckedArrayExpression,operator?:string,operatorRange?:SystemQueryRange,callee?:string,calleeRange?:SystemQueryRange,signature?:import('./system-query-scalars.mjs').SystemQueryScalarHelper['sourceSignature'],arguments?:CheckedArrayExpression[]}} CheckedArrayExpression
 */
/** @typedef {Readonly<{kind:'bindingReference'|'fieldAccess'|'fieldTarget'|'binary'|'fieldAssignment'|'bindingAssignment'|'bindingTarget'|'numericLiteral'|'call'|'parentheses',type:string,sourceType:string,range:SystemQueryRange,token?:string,bits?:string,binding?:string,property?:string,sourceField?:string,nameRange?:SystemQueryRange,receiver?:SystemQueryLoopExpression,left?:SystemQueryLoopExpression,right?:SystemQueryLoopExpression,target?:SystemQueryLoopExpression,value?:SystemQueryLoopExpression,expression?:SystemQueryLoopExpression,operator?:string,operatorRange?:SystemQueryRange,access?:'read'|'write'|'readwrite',callee?:string,sourceCallee?:string,calleeRange?:SystemQueryRange,signatureHash?:string,arguments?:readonly SystemQueryLoopExpression[]}>} SystemQueryLoopExpression */
/** @typedef {Readonly<{index:number,declaration:SystemQueryOrigin,sourceComponentType:string,componentType:string,mode:'read'|'write'}>} SystemQueryLoopBinding */
/** @typedef {Readonly<{kind:string,range:SystemQueryRange,binding?:string,initializer?:SystemQueryLoopExpression,value?:SystemQueryLoopExpression}>} SystemQueryStatement */
/** @typedef {Readonly<{range:SystemQueryRange,queryBinding:string,queryRange:SystemQueryRange,bindingRange:SystemQueryRange,bodyRange:SystemQueryRange,bindings:readonly SystemQueryLoopBinding[],localBindings:readonly Record<string,unknown>[],statements:readonly SystemQueryStatement[]}>} SystemQueryLoop */
/** @typedef {Readonly<{declaration:SystemQueryOrigin,declKey:Readonly<{sourcePath:string,path:readonly string[],kind:'function',name:string}>,markerRange:SystemQueryRange,marker:SystemQueryOrigin,signature:SystemQueryOrigin,parameters:readonly SystemQueryParameter[],sourceReturnType:string,returnType:string,bodyRange:SystemQueryRange,loops:readonly SystemQueryLoop[]}>} SystemQuerySystem */
/** @typedef {Readonly<{format:Readonly<{family:string,version:number,schemaHash:string}>,inputIdentity:string,packageId:string,program:ReturnType<typeof decodeProgram>['program'],nodes:ReturnType<typeof decodeNodes>['nodes'],builtins:readonly SystemQueryOrigin[],components:readonly Readonly<{typeId:string,sourceType:string,declaration:SystemQueryOrigin}>[],markerAliases:readonly SystemQueryAlias[],systems:readonly SystemQuerySystem[],scalarHelpers:readonly import('./system-query-scalars.mjs').SystemQueryScalarHelper[]}>} SystemQueryFacts */

/** @returns {never} */
function fail(detail,kind='input'){
  const code='r10-system-query-'+kind;
  throw Object.assign(new TypeError(code+': '+detail),{code,ruleId:'r01-input-boundary',phase:'metadata'});
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value,required,optional=[]){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('object required','schema');
  if(required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))fail('exact record fields required','schema');
  return /** @type {Record<string,unknown>} */(value);
}
/** @param {unknown} value @returns {string} */
function text(value){if(typeof value!=='string')fail('string required','schema');return value;}
/** @param {unknown} value @returns {string} */
function hash(value){const result=text(value);if(!/^sha256:[0-9a-f]{64}$/.test(result))fail('digest required','identity');return result;}
/** @param {unknown} value @returns {number} */
function integer(value){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||Object.is(value,-0))fail('unsigned integer required','schema');return value;}
/** @param {unknown} value @returns {unknown[]} */
function array(value){if(!Array.isArray(value))fail('array required','schema');return value;}
/** @param {unknown} value */
function range(value){const row=record(value,['start','end']),start=integer(row.start),end=integer(row.end);if(start>end)fail('ordered source range required','source');return {start,end};}

function decodeOrigin(value,sources){
  const row=record(value,['id','sourcePath','kind','name','range','nameRange']);
  const result={id:hash(row.id),sourcePath:text(row.sourcePath),kind:text(row.kind),name:text(row.name),range:range(row.range),nameRange:range(row.nameRange)};
  const source=sources.get(result.sourcePath);if(!source)fail('original declaration source missing','source');
  sourceRange(result.range,source.content);sourceRange(result.nameRange,source.content,result.range);
  if(result.name===''?result.kind!=='KindTupleType'||canonical(result.range)!==canonical(result.nameRange):source.content.slice(result.nameRange.start,result.nameRange.end)!==result.name)fail('original declaration name differs','source');
  if(result.id!==originId(result.sourcePath,result.nameRange))fail('original declaration identity differs','identity');
  return result;
}

function decodeNodes(value,sources,spend){
  const directory=new Map(),roots=new Map(),children=new Map();
  const nodes=array(value).map(value=>{
    spend();const row=record(value,['id','parent','sourcePath','kind','range','name','nameRange']);
    const node={id:hash(row.id),parent:text(row.parent),sourcePath:text(row.sourcePath),kind:text(row.kind),range:range(row.range),name:text(row.name),nameRange:row.nameRange===null?null:range(row.nameRange)};
    const source=sources.get(node.sourcePath),parent=directory.get(node.parent);
    if(!source||directory.has(node.id)||node.range.end>source.content.length)fail('original AST directory differs','source');
    if(node.range.start===node.range.end){const at=node.range.start;
      if(at>0&&at<source.content.length&&/[\ud800-\udbff]/.test(source.content[at-1])&&/[\udc00-\udfff]/.test(source.content[at]))fail('AST point splits UTF16 pair','source');
    }else sourceRange(node.range,source.content);
    if(node.parent===''){
      if(node.kind!=='KindSourceFile'||roots.has(node.sourcePath))fail('one original SourceFile root required','source');roots.set(node.sourcePath,node.id);
    }else if(!parent||parent.sourcePath!==node.sourcePath||node.range.start<parent.range.start||node.range.end>parent.range.end)fail('original AST parent closure differs','source');
    if(node.nameRange){sourceRange(node.nameRange,source.content,node.range);if(source.content.slice(node.nameRange.start,node.nameRange.end)!==node.name)fail('AST declaration name differs','source');}
    else if(node.name!=='')fail('unnamed AST node has declaration name','source');
    if(node.id!==sha256('tsfg.system-query.node.v1\0'+canonical({sourcePath:node.sourcePath,kind:node.kind,range:node.range,parent:node.parent})))fail('original AST identity differs','identity');
    directory.set(node.id,node);const siblings=children.get(node.parent)??[];siblings.push(node);children.set(node.parent,siblings);return node;
  });
  if(roots.size!==sources.size||nodes.length>100000)fail('complete Program AST inventory differs','source');
  const declarations=new Map(nodes.filter(node=>node.nameRange).map(node=>[canonical({sourcePath:node.sourcePath,kind:node.kind,range:node.range,nameRange:node.nameRange,name:node.name}),node]));
  const match=result=>{
    if(result.name===''? !nodes.some(node=>node.sourcePath===result.sourcePath&&node.kind==='KindTupleType'&&canonical(node.range)===canonical(result.range)) : !declarations.has(canonical({sourcePath:result.sourcePath,kind:result.kind,range:result.range,nameRange:result.nameRange,name:result.name})))fail('declaration is outside original AST closure','source');
    return result;
  };
  const original=value=>match(decodeOrigin(value,sources));
  return {nodes,directory,roots,original,match,children};
}

function decodeProgram(value){
  const row=record(value,['sourceRoot','rootFile','positionUnit','config','declarations','target','files','diagnostics']);
  const sourceRoot=logicalPath(text(row.sourceRoot)),rootFile=logicalPath(text(row.rootFile));
  const config=record(row.config,['strict','noEmit','allowJs']);
  if(canonical(config)!==canonical({strict:true,noEmit:true,allowJs:false})||row.positionUnit!=='utf16')fail('owned Program options differ','identity');
  const declarations=record(row.declarations,['version','paths']);
  const declarationPaths=array(declarations.paths).map(value=>logicalPath(text(value)));
  if(declarations.version!=='minimal-arrays-v8')fail('declaration profile differs','identity');
  const target=record(row.target,['target','triple','llvmDataLayout','pointerBits']);
  const typedTarget={target:text(target.target),triple:text(target.triple),llvmDataLayout:text(target.llvmDataLayout),pointerBits:text(target.pointerBits)};
  const sources=new Map();let bytes=0;
  const files=array(row.files).map(value=>{
    const row=record(value,['path','content','sha256','byteLength','utf16Length']);
    const result={path:logicalPath(text(row.path)),content:text(row.content),sha256:text(row.sha256),byteLength:integer(row.byteLength),utf16Length:integer(row.utf16Length)};
    if(!result.path.startsWith(sourceRoot+'/')||!result.path.endsWith('.ts')||sources.has(result.path)||(sources.size&&byteOrder([...sources.keys()].at(-1),result.path)>=0))fail('complete ordered source inventory differs','source');
    bytes+=result.byteLength;
    if(result.byteLength!==Buffer.byteLength(result.content)||result.utf16Length!==result.content.length||result.sha256!==sha256(result.content).slice(7)||bytes>1048576)fail('original source content differs','identity');
    sources.set(result.path,result);return result;
  });
  if(files.length<3||files.length>64||!sources.has(rootFile)||rootFile.endsWith('.d.ts')||!rootFile.startsWith(sourceRoot+'/')||declarationPaths.some(path=>!sources.has(path)||!path.endsWith('.d.ts'))||array(row.diagnostics).length)fail('complete checked Program differs','source');
  return {sources,program:{sourceRoot,rootFile,positionUnit:'utf16',config:{strict:true,noEmit:true,allowJs:false},declarations:{version:'minimal-arrays-v8',paths:declarationPaths},target:typedTarget,files,diagnostics:[]}};
}

// These are the original, complete type DTOs. Query functions are not passed to
// the common HIR identity algorithm as though Query were already a HIR type.
function componentIdentities(payload,functions,sources,spend){
  for(const row of payload.types)checkTypedArrayShape(row,'arrayGenericType',false,commonSourceDescriptor);
  for(const row of functions)checkTypedArrayShape(row,'arrayGenericFunction',false,commonSourceDescriptor);
  const types=validateTypedArrayTypes(payload,sources);
  const semantic=commonSemanticIdentities({types:payload.types,functions,globals:[]},spend);
  const active=new Set(),heights=new Map();
  function fixed(id,depth=0){
    spend();const row=types.get(id);
    if(!row||depth>=32)fail('fixed component type path exceeds 32 nodes','capability');
    const cached=heights.get(id);if(cached!==undefined){if(depth+cached>32)fail('fixed component type path exceeds 32 nodes','capability');return cached;}
    if(active.has(id))fail('cyclic component content','capability');active.add(id);
    if(row.kind!=='scalar'&&row.kind!=='value'&&row.nominalKey?.category!=='component')fail('component contains GC or non-fixed content','capability');
    let height=1;
    for(const field of row.fields??[])height=Math.max(height,1+fixed(field.type,depth+1));
    if(row.base)height=Math.max(height,1+fixed(row.base,depth+1));
    active.delete(id);heights.set(id,height);return height;
  }
  const components=payload.types.filter(row=>row.nominalKey?.category==='component');
  for(const row of components)fixed(row.id);
  return {types,semantic,components};
}

function verifyComponentSource(types,functions,grammars,semantic,spend){
  const callables=new Map([...functions,...[...types.values()].flatMap(type=>type.constructor?[type.constructor]:[])].map(row=>[row.id,row]));
  const fields=new Map();
  for(const type of types.values())if(type.nominalKey){
    const grammar=grammars.get(type.sourcePath),bounds=grammar.indices(type.declarationRange),name=grammar.indices(type.nameRange),header=grammar.tokens.slice(bounds.first,name.first).map(token=>token.text);
    grammar.name(type.nameRange,type.name);
    if(header.at(-1)!=='class'||!header.every(token=>['@','component','tsfgComponent','tsfgValue','export','default','class'].includes(token)))fail('original nominal declaration differs','source');
    for(const [index,field]of type.fields.entries()){
      spend();const fieldGrammar=grammars.get(field.origin.source),all=fieldGrammar.tokens,bounds=fieldGrammar.indices(field.origin);let cursor=bounds.first;
      const modifiers=[];while(['public','private','protected','readonly','declare'].includes(all[cursor]?.text))modifiers.push(all[cursor++].text);
      const nameRange={start:all[cursor].start,end:all[cursor].end};fieldGrammar.name(nameRange,field.name);commonSourceAccess(fieldGrammar,field.origin,nameRange,field.access);
      if(field.readonly!==modifiers.includes('readonly')||field.id!==sha256('tsfg.array-facts.field.v8\0'+canonical({sourcePath:field.origin.source,nameRange}))||index>0&&type.fields[index-1].origin.start>=field.origin.start)fail('original component field identity/order differs','source');
      if(all[++cursor]?.text!==':')fail('component field annotation missing','source');
      const end=field.initializer?fieldGrammar.indices(field.initializer.range).first-1:bounds.end-(all[bounds.end-1].text===';'?1:0);
      if(field.initializer&&all[end].text!=='=')fail('component field initializer anchor differs','source');
      commonTypeSyntax(fieldGrammar,{start:all[cursor+1].start,end:all[end-1].end},field.type,types,spend);
      fields.set(field.id,{sourceField:field.id,fieldId:commonFieldId(semantic.typeIds.get(type.id),field.name,index),ownerSourceType:type.id,ownerType:semantic.typeIds.get(type.id),sourceType:field.type,type:semantic.typeIds.get(field.type),name:field.name,readonly:field.readonly,access:field.access,sourcePath:field.origin.source,range:{start:field.origin.start,end:field.origin.end},nameRange});
    }
    const members=[...type.fields.filter(field=>!field.parameterBinding).map(field=>field.origin),...(type.methods??[]).map(id=>callables.get(id)?.declarationRange),...(type.constructor?[type.constructor.declarationRange]:[])];
    if(members.some(row=>!row))fail('complete component callable declarations differ','source');members.sort((a,b)=>a.start-b.start);
    const base=type.base?types.get(type.base):null;
    grammar.sequence(type.declarationRange,[...header,type.nameRange,...(base?['extends',base.name]:[]),'{',...members,'}']);
  }
  return fields;
}

/** @returns {SystemQueryLoop[]} */
function decodeLoops(value,body,sourcePath,parameters,ast,grammar,component,fields,scalars,spend,proof){
  const originalLoops=ast.children.get(body.id)??[];
  const loops=array(value).map((value,index)=>{
    spend();const row=record(value,descriptor.objects.loop),loopRange=range(row.range),queryRange=range(row.queryRange),bindingRange=range(row.bindingRange),bodyRange=range(row.bodyRange),queryBinding=hash(row.queryBinding);
    const original=originalLoops[index],query=parameters.find(row=>row.binding.id===queryBinding);
    if(!original||original.kind!=='KindForOfStatement'||canonical(original.range)!==canonical(loopRange)||!query?.query)fail('original loop/query parameter differs','source');
    sourceRange(loopRange,grammar.text,body.range);sourceRange(queryRange,grammar.text,loopRange);sourceRange(bindingRange,grammar.text,loopRange);sourceRange(bodyRange,grammar.text,loopRange);
    const loopChildren=ast.children.get(original.id)??[],originalBody=loopChildren.find(node=>node.kind==='KindBlock'),initializer=loopChildren.find(node=>node.kind==='KindVariableDeclarationList');
    const pattern=ast.nodes.find(node=>node.sourcePath===sourcePath&&node.kind==='KindArrayBindingPattern'&&canonical(node.range)===canonical(bindingRange));
    if(!originalBody||canonical(originalBody.range)!==canonical(bodyRange)||!initializer||!pattern||!loopChildren.some(node=>node.kind==='KindIdentifier'&&canonical(node.range)===canonical(queryRange)))fail('original loop header/body differs','source');
    const declaration=ast.directory.get(pattern.parent);
    if(declaration?.kind!=='KindVariableDeclaration'||declaration.parent!==initializer.id||canonical(declaration.range)!==canonical(bindingRange))fail('original inferred tuple declaration differs','source');
    grammar.name(queryRange,query.binding.name);
    const originalBindings=ast.children.get(pattern.id)??[],scope=new Map(parameters.filter(row=>!row.query).map(row=>[row.binding.id,{declaration:row.binding,sourceType:row.logicalType,mode:null}]));
    const bindings=array(row.bindings).map((value,index)=>{
      const row=record(value,descriptor.objects.loopBinding),declaration=ast.original(row.declaration),sourceComponentType=text(row.componentType),mode=text(row.mode),selected=query.query.items[index];
      if(integer(row.index)!==index||!selected||sourceComponentType!==selected.sourceComponentType||mode!==selected.mode||declaration.kind!=='KindBindingElement'||declaration.sourcePath!==sourcePath||!originalBindings[index]||canonical(originalBindings[index].range)!==canonical(declaration.range)||scope.has(declaration.id))fail('original loop tuple binding/order/access differs','source');
      if(mode!=='read'&&mode!=='write')fail('owned loop access mode required','type');
      grammar.sequence(declaration.range,[declaration.nameRange]);scope.set(declaration.id,{declaration,sourceType:sourceComponentType,mode});
      /** @type {SystemQueryLoopBinding} */
      const result={index,declaration,sourceComponentType,componentType:selected.componentType,mode};return result;
    });
    if(bindings.length!==query.query.items.length||bindings.length!==originalBindings.length)fail('complete loop tuple binding inventory differs','source');
    grammar.sequence(bindingRange,['[',...bindings.flatMap((row,index)=>index?[',',row.declaration.range]:[row.declaration.range]),']']);
    grammar.sequence(initializer.range,['const',bindingRange]);grammar.sequence(loopRange,['for','(',initializer.range,'of',queryRange,')',bodyRange]);
    const {statements,localBindings}=decodeQueryStatements(row.statements,row.localBindings,{ast,grammar,body:originalBody,owner:ast.original({id:originId(sourcePath,ast.directory.get(body.parent).nameRange),sourcePath,kind:'KindFunctionDeclaration',name:ast.directory.get(body.parent).name,range:ast.directory.get(body.parent).range,nameRange:ast.directory.get(body.parent).nameRange}),scope,component,fields,call:(value,scope,expression)=>scalars.call(value,sourcePath,scope,expression),proof,spend,fail});
    return {range:loopRange,queryBinding,queryRange,bindingRange,bodyRange,bindings,localBindings,statements};
  });
  if(loops.length!==originalLoops.length)fail('complete original system body differs','source');grammar.body(body.range,loops);
  return loops;
}

/** @returns {SystemQuerySystem[]} */
function decodeSystems(value,program,sources,ast,builtins,component,fields,grammars,scalars,spend){
  const seen=new Set(),sourceTypes=querySourceProof(ast,grammars,sources,[],spend,fail);
  return array(value).map(value=>{
    spend();const row=record(value,descriptor.objects.system);
    const declaration=ast.original(row.declaration),marker=ast.original(row.marker),signature=ast.original(row.signature),markerRange=range(row.markerRange),returnType=text(row.returnType);
    if(declaration.kind!=='KindFunctionDeclaration'||declaration.sourcePath.endsWith('.d.ts')||seen.has(declaration.id)||canonical(signature)!==canonical(declaration)||canonical(marker)!==canonical(builtins.get('system')))fail('original system declaration/signature differs','source');
    seen.add(declaration.id);const grammar=grammars.get(declaration.sourcePath);sourceRange(markerRange,grammar.text,declaration.range);grammar.sequence(markerRange,['@','system']);
    const functionNode=ast.nodes.find(node=>node.kind===declaration.kind&&node.sourcePath===declaration.sourcePath&&canonical(node.range)===canonical(declaration.range));
    const originalParameters=ast.nodes.filter(node=>node.parent===functionNode.id&&node.kind==='KindParameter');
    const parameters=array(row.parameters).map((value,index)=>{
      spend();const row=record(value,descriptor.objects.parameter),binding=ast.original(row.binding),annotationRange=range(row.annotationRange),logicalType=text(row.logicalType);
      if(row.view!==null||integer(row.index)!==index||binding.kind!=='KindParameter'||binding.sourcePath!==declaration.sourcePath||!originalParameters[index]||canonical(binding.range)!==canonical(originalParameters[index].range))fail('original system parameter order differs','source');
      sourceRange(binding.range,grammar.text,declaration.range);sourceRange(annotationRange,grammar.text,binding.range);
      grammar.sequence(binding.range,[binding.nameRange,':',annotationRange]);
      if(row.query===null){if(logicalType==='Query'||!component.types.has(logicalType))fail('ordinary parameter logical type differs','type');sourceTypes.verifyLogical(declaration.sourcePath,annotationRange,logicalType,component.types);return {index,binding,annotationRange,logicalType,type:text(component.semantic.typeIds.get(logicalType)),query:null,view:null};}
      if(logicalType!=='Query')fail('Query parameter logical type differs','type');
      const queryRow=record(row.query,['declaration','tupleSourcePath','tupleRange','aliases','items']),queryDeclaration=ast.original(queryRow.declaration),tupleSourcePath=text(queryRow.tupleSourcePath),tupleRange=range(queryRow.tupleRange),tupleGrammar=grammars.get(tupleSourcePath);
      if(canonical(queryDeclaration)!==canonical(builtins.get('Query'))||!tupleGrammar)fail('owned Query declaration/source differs','source');
      sourceRange(tupleRange,tupleGrammar.text);
      const aliases=array(queryRow.aliases).map(value=>{
        const row=record(value,['useSourcePath','useRange','declaration','target']),useSourcePath=text(row.useSourcePath),useRange=range(row.useRange),declaration=ast.original(row.declaration),target=ast.original(row.target),source=sources.get(useSourcePath);
        if(!source||!['KindTypeAliasDeclaration','KindTypeParameter'].includes(declaration.kind))fail('original Query alias declaration differs','source');sourceRange(useRange,source.content);
        if(!ast.nodes.some(node=>node.sourcePath===useSourcePath&&node.kind==='KindTypeReference'&&canonical(node.range)===canonical(useRange)))fail('original alias occurrence differs','source');
        return {useSourcePath,useRange,declaration,target};
      });
      const proof=querySourceProof(ast,grammars,sources,aliases,spend,fail),querySyntax=proof.resolve(proof.at(declaration.sourcePath,annotationRange));
      if(querySyntax.node.kind!=='KindTypeReference'||canonical(proof.target(querySyntax.node))!==canonical(queryDeclaration)||proof.argumentsOf(querySyntax.node).length!==1)fail('original Query annotation target differs','source');
      const tupleSyntax=proof.resolve(proof.argumentsOf(querySyntax.node)[0],querySyntax.env);
      if(tupleSyntax.node.kind!=='KindTupleType'||tupleSyntax.node.sourcePath!==tupleSourcePath||canonical(tupleSyntax.node.range)!==canonical(tupleRange))fail('original Query tuple definition differs','source');
      const originalItems=ast.children.get(tupleSyntax.node.id)??[];
      const items=array(queryRow.items).map((value,index)=>{
        spend();const row=record(value,['index','mode','range','wrapper','componentType','component','componentSourcePath','componentRange']);
        const mode=text(row.mode),itemRange=range(row.range),wrapper=ast.original(row.wrapper),componentType=text(row.componentType),componentDeclaration=ast.original(row.component),componentSourcePath=text(row.componentSourcePath),componentRange=range(row.componentRange),componentGrammar=grammars.get(componentSourcePath),type=component.types.get(componentType);
        if(mode!=='read'&&mode!=='write')fail('Read or Write access mode required','type');
        if(integer(row.index)!==index||canonical(wrapper)!==canonical(builtins.get(mode==='read'?'Read':'Write')))fail('owned access wrapper/mode/order differs','type');
        if(!type||type.nominalKey?.category!=='component'||type.sourcePath!==componentDeclaration.sourcePath||canonical(type.declarationRange)!==canonical(componentDeclaration.range)||canonical(type.nameRange)!==canonical(componentDeclaration.nameRange)||type.name!==componentDeclaration.name)fail('owned component declaration differs','type');
        sourceRange(itemRange,tupleGrammar.text,tupleRange);if(!componentGrammar)fail('component occurrence source missing','source');sourceRange(componentRange,componentGrammar.text);
        if(!originalItems[index]||canonical(originalItems[index].range)!==canonical(itemRange))fail('original tuple item order differs','source');
        const wrapperSyntax=proof.resolve(originalItems[index],tupleSyntax.env);
        if(wrapperSyntax.node.kind!=='KindTypeReference'||canonical(proof.target(wrapperSyntax.node))!==canonical(wrapper)||proof.argumentsOf(wrapperSyntax.node).length!==1)fail('original access wrapper definition differs','source');
        const componentSyntax=proof.resolve(proof.argumentsOf(wrapperSyntax.node)[0],wrapperSyntax.env);
        if(componentSyntax.node.kind!=='KindTypeReference'||canonical(proof.target(componentSyntax.node))!==canonical(componentDeclaration)||componentSyntax.node.sourcePath!==componentSourcePath||canonical(componentSyntax.node.range)!==canonical(componentRange))fail('original component definition/substitution differs','source');
        /** @type {SystemQueryAccess} */
        const result={index,mode,range:itemRange,wrapper,sourceComponentType:componentType,componentType:text(component.semantic.typeIds.get(componentType)),component:componentDeclaration,componentSourcePath,componentRange};
        return result;
      });
      if(!items.length||items.length>256||items.length!==originalItems.length)fail('closed nonempty Query tuple required','type');
      tupleGrammar.sequence(tupleRange,['[',...items.flatMap((item,index)=>index?[',',item.range]:[item.range]),']']);
      proof.complete();
      return {index,binding,annotationRange,logicalType,type:null,query:{declaration:queryDeclaration,tupleSourcePath,tupleRange,aliases,items},view:null};
    });
    if(parameters.length!==originalParameters.length||!parameters.some(row=>row.query)||!component.types.has(returnType))fail('system Query/return type missing','type');
    const functionChildren=ast.children.get(functionNode.id)??[],body=functionChildren.find(node=>node.kind==='KindBlock'),returnSyntax=functionChildren.filter(node=>node.kind!=='KindParameter'&&node.range.start>=(originalParameters.at(-1)?.range.end??declaration.nameRange.end)&&node.range.end<=(body?.range.start??0)).at(-1);
    if(!body||!returnSyntax)fail('original return annotation/body missing','source');
    const bodyRange=range(row.bodyRange);if(canonical(bodyRange)!==canonical(body.range))fail('original complete system body range differs','source');
    sourceTypes.verifyLogical(declaration.sourcePath,returnSyntax.range,returnType,component.types);
    const bounds=grammar.indices(declaration.range),name=grammar.indices(declaration.nameRange),prefix=grammar.tokens.slice(bounds.first,name.first).map(token=>token.text);
    grammar.sequence(declaration.range,[...prefix,declaration.nameRange,'(',...parameters.flatMap((row,index)=>index?[',',row.binding.range]:[row.binding.range]),')',':',returnSyntax.range,body.range]);
    const loops=decodeLoops(row.loops,body,declaration.sourcePath,parameters,ast,grammar,component,fields,scalars,spend,sourceTypes);
    return {declaration,declKey:{sourcePath:declaration.sourcePath,path:[],kind:/** @type {'function'} */('function'),name:declaration.name},markerRange,marker,signature,parameters,sourceReturnType:returnType,returnType:text(component.semantic.typeIds.get(returnType)),bodyRange,loops};
  });
}

/** Read one complete actual Source packet bound to its original request.
 * @param {unknown} bytes
 * @param {unknown} context
 * @returns {SystemQueryFacts}
 */
export function readSystemQueryFacts(bytes,context){
  const expected=record(context,['family','version','requestBytes','expectedPackageId']);
  if(expected.family!=='tsfg.system-query-context-candidate'||expected.version!==descriptor.version)fail('source context family differs','identity');
  const expectedPackageId=hash(expected.expectedPackageId),transport=readGenericJson(copyGenericJsonBytes(bytes,policy),policy),packet=record(transport.value,descriptor.objects.package);
  if(transport.text!==canonical(packet)+'\n'||packet.family!==systemQueryFactsFormat.family||packet.version!==systemQueryFactsFormat.version||packet.schemaHash!==systemQueryFactsFormat.schemaHash)fail('candidate identity/canonical bytes differ','identity');
  const payload=record(packet.payload,descriptor.objects.payload);
  if(hash(packet.packageId)!==expectedPackageId||packet.packageId!==sha256('tsfg.system-query.package.v6\0'+systemQueryFactsFormat.schemaHash+'\0'+canonical(payload)))fail('whole Source package identity differs','identity');
  const {sources,program}=decodeProgram(payload.program);
  if(descriptor.sourceTypeSchemaHash!==sha256(canonical(commonSourceDescriptor)+'\n'))fail('shared Source type schema differs','identity');
  if(canonical(program.target)!==canonical(descriptor.target)||payload.profilePath!==descriptor.profile.path||payload.profileSHA256!==descriptor.profile.sha256
    ||sources.get(descriptor.profile.path)?.sha256!==descriptor.profile.sha256||sources.get(descriptor.profile.standardPath)?.sha256!==descriptor.profile.standardSha256
    ||canonical(program.declarations.paths)!==canonical([descriptor.profile.standardPath,descriptor.profile.path]))fail('owned declaration/target context differs','identity');
  const request={family:descriptor.requestFamily,version:descriptor.version,schemaHash:systemQueryFactsFormat.schemaHash,input:{sourceRoot:program.sourceRoot,rootFile:program.rootFile,files:program.files.map(({path,content,sha256})=>({path,content,sha256})),declarations:program.declarations,config:program.config,target:program.target}};
  const requestTransport=readGenericJson(copyGenericJsonBytes(expected.requestBytes,policy),policy),requestText=canonical(request)+'\n';
  if(requestTransport.text!==requestText||canonical(requestTransport.value)+'\n'!==requestText||hash(packet.requestId)!==sha256('tsfg.system-query.request.v6\0'+requestText))fail('complete original request differs','identity');
  let work=0;const spend=(amount=1)=>{work+=amount;if(work>descriptor.limits.work)fail('source work exceeded','limit');};
  const ast=decodeNodes(payload.nodes,sources,spend),builtins=new Map();
  const builtinRows=array(payload.builtins).map((value,index)=>{const row=ast.original(value);
    if(row.name!==descriptor.builtins[index]||row.sourcePath!==descriptor.profile.path||row.kind!==(row.name==='component'?'KindVariableDeclaration':row.name==='system'?'KindFunctionDeclaration':['Read','Write'].includes(row.name)?'KindTypeAliasDeclaration':'KindInterfaceDeclaration'))fail('exact owned builtin directory differs','source');
    builtins.set(row.name,row);return row;});
  if(builtinRows.length!==descriptor.builtins.length)fail('complete owned builtin directory differs','source');
  const grammars=new Map([...sources].map(([path,source])=>[path,commonSourceGrammar(source,spend)]));
  const types=array(payload.types),functions=array(payload.functions);
  if(types.length>4096||functions.length>4096)fail('source type/function directory exceeded','limit');
  const component=componentIdentities({...program,types},functions,sources,spend);
  const fields=verifyComponentSource(component.types,functions,grammars,component.semantic,spend);
  const markerAliases=array(payload.markerAliases).map(value=>{
    const row=record(value,descriptor.objects.markerAlias),useSourcePath=text(row.useSourcePath),useRange=range(row.useRange),declaration=ast.original(row.declaration),target=ast.original(row.target),grammar=grammars.get(useSourcePath);
    if(!grammar||canonical(declaration)!==canonical(builtins.get('component'))||target.sourcePath!==descriptor.profile.standardPath||target.name!=='tsfgComponent'||target.kind!=='KindFunctionDeclaration')fail('owned component marker alias differs','source');
    sourceRange(useRange,grammar.text);grammar.sequence(useRange,['@','component']);return {useSourcePath,useRange,declaration,target};
  });
  const usedAliases=new Set();
  const components=component.components.map(type=>{
    const declaration=ast.match({id:originId(type.sourcePath,type.nameRange),sourcePath:type.sourcePath,kind:'KindClassDeclaration',name:type.name,range:type.declarationRange,nameRange:type.nameRange}),marker=type.markerOrigin,grammar=grammars.get(type.sourcePath);
    if(!marker||marker.declarationPath!==descriptor.profile.standardPath||marker.declarationSha256!=='sha256:'+descriptor.profile.standardSha256||marker.version!=='minimal-arrays-v8'||marker.mode!=='standard'||marker.contextName!=='ClassDecoratorContext'||marker.contextArity!==1||marker.entryId!==sha256('tsfg.array-facts.marker.v8\0'+canonical({sourcePath:marker.declarationPath,declarationRange:marker.declarationRange})))fail('standard component marker target differs','source');
    const aliases=markerAliases.filter(alias=>alias.useSourcePath===type.sourcePath&&canonical(alias.useRange)===canonical(marker.range));
    if(aliases.length===1){const alias=aliases[0];if(canonical(alias.target.range)!==canonical(marker.declarationRange))fail('component alias signature target differs','source');usedAliases.add(alias);}
    else if(aliases.length===0)grammar.sequence(marker.range,['@','tsfgComponent']);
    else fail('ambiguous component marker alias','source');
    return {typeId:text(component.semantic.typeIds.get(type.id)),sourceType:text(type.id),declaration};
  });
  if(usedAliases.size!==markerAliases.length)fail('unbound component marker alias','source');
  const scalars=decodeScalarHelpers(payload.scalarHelpers,{ast,grammars,sources,component,fields,builtins,spend,fail});
  const systems=decodeSystems(payload.systems,program,sources,ast,builtins,component,fields,grammars,scalars,spend);scalars.complete(systems);
  if(!systems.length||systems.length>4096)fail('complete system directory required','source');
  const result=own({format:systemQueryFactsFormat,inputIdentity:text(packet.requestId),packageId:expectedPackageId,program,nodes:ast.nodes,builtins:builtinRows,components,markerAliases,systems,scalarHelpers:scalars.helpers});
  receipts.set(result,{bytes:Buffer.from(transport.text),requestText,packageId:expectedPackageId});return result;
}

/** Only the immutable result owned by this reader can roundtrip its packet.
 * @param {SystemQueryFacts} facts
 * @param {unknown} context
 */
export function printSystemQueryFacts(facts,context){
  const receipt=receipts.get(facts),expected=record(context,['family','version','requestBytes','expectedPackageId']);
  if(!receipt||expected.family!=='tsfg.system-query-context-candidate'||expected.version!==descriptor.version||expected.expectedPackageId!==receipt.packageId)fail('owned Source receipt differs','identity');
  const request=readGenericJson(copyGenericJsonBytes(expected.requestBytes,policy),policy);
  if(request.text!==receipt.requestText||canonical(request.value)+'\n'!==receipt.requestText)fail('owned Source request differs','identity');
  return Buffer.from(receipt.bytes);
}
