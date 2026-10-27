// SPDX-License-Identifier: MIT
import descriptor from '../contracts/system-query-facts.schema.json' with {type:'json'};
import {canonical,sha256,scalarTypeIds} from './identity.mjs';
import {functionId,signatureId} from './module-callable-common.mjs';
import {querySourceProof} from './system-query-source-bindings.mjs';
import {queryExpressionDecoder,queryViewBinding} from './system-query-expressions.mjs';
import {checkTypedArrayShape} from './typed-array-schema.mjs';
import {commonSourceDescriptor} from './common-program-common.mjs';

/** @typedef {Readonly<{id:string,sourceId:string,declaration:import('./system-query-facts.mjs').SystemQueryOrigin,signatureHash:string,sourceSignature:Readonly<{id:string,sourcePath:string,declarationRange:import('./system-query-facts.mjs').SystemQueryRange,parameters:readonly string[],returnType:string}>,parameters:readonly import('./system-query-facts.mjs').SystemQueryParameter[],returnType:string,sourceReturnType:'f32',returnAnnotationRange:import('./system-query-facts.mjs').SystemQueryRange,bodyRange:import('./system-query-facts.mjs').SystemQueryRange,returnRange:import('./system-query-facts.mjs').SystemQueryRange,value:import('./system-query-facts.mjs').SystemQueryLoopExpression}>} SystemQueryScalarHelper */

// Own the f32-result helper directory and reuse original type/value binding
// proof. No scalar value is interpreted and no claimed purity bit is accepted.
/** @returns {{helpers:readonly SystemQueryScalarHelper[],call:(value:import('./system-query-facts.mjs').CheckedArrayExpression,path:string,scope:ReadonlyMap<string,{declaration:import('./system-query-facts.mjs').SystemQueryOrigin,sourceType:string,mode:string|null}>,expression:(value:import('./system-query-facts.mjs').CheckedArrayExpression)=>import('./system-query-facts.mjs').SystemQueryLoopExpression)=>import('./system-query-facts.mjs').SystemQueryLoopExpression,complete:(systems:readonly import('./system-query-facts.mjs').SystemQuerySystem[])=>void}} */
export function decodeScalarHelpers(input,{ast,grammars,sources,component,fields,builtins,spend,fail}){
  const record=(value,keys)=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail('exact scalar helper fields required','source');return value;
  };
  const array=value=>{if(!Array.isArray(value))fail('scalar helper array required','source');return value;};
  const span=value=>{record(value,['start','end']);if(!Number.isSafeInteger(value.start)||!Number.isSafeInteger(value.end)||value.start<0||value.end<=value.start)fail('scalar helper range differs','source');return {start:value.start,end:value.end};};
  const same=(a,b)=>{if(canonical(a)!==canonical(b))fail('original scalar helper identity or syntax differs','source');};
  const proof=querySourceProof(ast,grammars,sources,[],spend,fail),raw=array(input),directory=new Map();let previous='';
  if(raw.length>descriptor.limits.scalarHelpers)fail('scalar helper inventory exceeds64','capability');
  for(const value of raw){
    spend();const row=record(value,descriptor.objects.scalarHelper),declaration=ast.original(row.declaration),grammar=grammars.get(declaration.sourcePath);
    const node=ast.nodes.find(node=>node.sourcePath===declaration.sourcePath&&node.kind===declaration.kind&&canonical(node.range)===canonical(declaration.range));
    if(declaration.kind!=='KindFunctionDeclaration'||declaration.sourcePath.endsWith('.d.ts')||!node||node.parent!==ast.roots.get(declaration.sourcePath))fail('scalar helper must be an original top-level named function','capability');
    const sourceKey={sourcePath:declaration.sourcePath,declarationRange:declaration.range},sourceId=sha256('tsfg.array-facts.function.v8\0'+canonical(sourceKey));
    if(row.id!==sourceId||sourceId<=previous)fail('scalar helper source identity/order differs','identity');previous=sourceId;
    const children=ast.children.get(node.id)??[],originalParameters=children.filter(node=>node.kind==='KindParameter'),body=children.find(node=>node.kind==='KindBlock');
    const parameters=array(row.parameters).map((value,index)=>{
      const parameter=record(value,descriptor.objects.parameter),binding=ast.original(parameter.binding),annotationRange=span(parameter.annotationRange);
      if(parameter.index!==index||parameter.query!==null||binding.kind!=='KindParameter'||!originalParameters[index]||canonical(binding.range)!==canonical(originalParameters[index].range))fail('helper parameter/order differs','capability');
      grammar.sequence(binding.range,[binding.nameRange,':',annotationRange]);
      if(parameter.view===null){
        if(parameter.logicalType!=='f32')fail('ordinary helper parameter must be f32','capability');
        proof.verifyLogical(declaration.sourcePath,annotationRange,'f32',component.types);
        return {index,binding,annotationRange,logicalType:'f32',type:scalarTypeIds.f32,query:null,view:null};
      }
      const view=record(parameter.view,descriptor.objects.view),aliases=array(view.aliases).map(value=>{
        const row=record(value,descriptor.objects.alias);return {useSourcePath:row.useSourcePath,useRange:span(row.useRange),declaration:ast.original(row.declaration),target:ast.original(row.target)};
      });
      const access=record(view.access,descriptor.objects.access),sourceType=parameter.logicalType,type=component.types.get(sourceType),mode=access.mode;
      if(access.index!==0||!['read','write'].includes(mode)||access.componentType!==sourceType||type?.nominalKey?.category!=='component')fail('helper view component/mode differs','type');
      const wrapper=ast.original(access.wrapper),selected=ast.original(access.component),componentRange=span(access.componentRange),itemRange=span(access.range);
      same(wrapper,builtins.get(mode==='read'?'Read':'Write'));
      same([selected.sourcePath,selected.range,selected.nameRange,selected.name],[type.sourcePath,type.declarationRange,type.nameRange,type.name]);
      same(itemRange,annotationRange);
      const viewProof=querySourceProof(ast,grammars,sources,aliases,spend,fail),syntax=viewProof.resolve(viewProof.at(declaration.sourcePath,annotationRange));
      if(syntax.node.kind!=='KindTypeReference'||viewProof.argumentsOf(syntax.node).length!==1)fail('helper view requires original Read/Write wrapper','source');
      same(viewProof.target(syntax.node),wrapper);
      const content=viewProof.resolve(viewProof.argumentsOf(syntax.node)[0],syntax.env);
      if(content.node.kind!=='KindTypeReference')fail('helper view component reference required','source');
      same([viewProof.target(content.node),content.node.sourcePath,content.node.range],[selected,access.componentSourcePath,componentRange]);viewProof.complete();
      return {index,binding,annotationRange,logicalType:sourceType,type:component.semantic.typeIds.get(sourceType),query:null,
        view:{aliases,access:{index:0,mode,range:itemRange,wrapper,sourceComponentType:sourceType,componentType:component.semantic.typeIds.get(sourceType),component:selected,componentSourcePath:access.componentSourcePath,componentRange}}};
    });
    if(parameters.length!==originalParameters.length||parameters.length>descriptor.limits.scalarArguments||row.returnType!=='f32'||!body)fail('scalar helper signature/body is outside selected f32 syntax','capability');
    const signature=record(row.signature,descriptor.objects.scalarSignature);
    same(signature,{id:sha256('tsfg.array-facts.signature.v8\0'+canonical(sourceKey)),...sourceKey,parameters:parameters.map(p=>p.logicalType),returnType:'f32'});
    const returnAnnotationRange=span(row.returnAnnotationRange),bodyRange=span(row.bodyRange),returnRange=span(row.returnRange),statements=ast.children.get(body.id)??[];
    same(bodyRange,body.range);
    if(statements.length!==1||statements[0].kind!=='KindReturnStatement'||canonical(statements[0].range)!==canonical(returnRange))fail('scalar helper requires one original return statement','capability');
    proof.verifyLogical(declaration.sourcePath,returnAnnotationRange,'f32',component.types);
    const bounds=grammar.indices(declaration.range),name=grammar.indices(declaration.nameRange),prefix=grammar.tokens.slice(bounds.first,name.first).map(token=>token.text);
    if(!['function','export function'].includes(prefix.join(' ')))fail('scalar helper declaration modifiers are outside selected syntax','capability');
    grammar.sequence(declaration.range,[...prefix,declaration.nameRange,'(',...parameters.flatMap((p,index)=>index?[',',p.binding.range]:[p.binding.range]),')',':',returnAnnotationRange,bodyRange]);
    grammar.sequence(bodyRange,['{',returnRange,'}']);
    const signatureType={parameters:parameters.map(p=>p.view?sha256('tsfg.query.view.v1\0'+canonical({componentType:p.type,mode:p.view.access.mode})):p.type),returns:scalarTypeIds.f32},id=functionId(declaration.sourcePath,canonical({path:[],kind:'function',name:declaration.name}),signatureType);
    directory.set(sourceId,{raw:row,grammar,returned:statements[0],helper:{id,sourceId,declaration,signatureHash:signatureId(signatureType),sourceSignature:signature,parameters,returnType:scalarTypeIds.f32,sourceReturnType:/** @type {'f32'} */('f32'),returnAnnotationRange,bodyRange,returnRange,value:null}});
  }
  /** @param {import('./system-query-facts.mjs').CheckedArrayExpression} value */
  function call(value,path,scope,expression){
    spend();const grammar=grammars.get(path),callee=directory.get(value.callee);
    if(!callee||value.type!=='f32'||value.flowType!=='f32'||value.receiver)fail('direct scalar f32 helper call required','capability');
    const callNode=ast.nodes.find(node=>node.sourcePath===path&&node.kind==='KindCallExpression'&&canonical(node.range)===canonical(value.range));
    const identifier=callNode&&(ast.children.get(callNode.id)??[]).find(node=>node.kind==='KindIdentifier'&&canonical(node.range)===canonical(value.calleeRange));
    if(!identifier)fail('scalar call must use an original direct identifier','capability');
    const name=grammar.slice(value.calleeRange);
    for(const binding of scope.values())if(binding.declaration.name===name)fail('scalar call is shadowed by an original local binding','source');
    same(proof.valueBinding(identifier),callee.helper.declaration);same(value.signature,callee.helper.sourceSignature);
    const args=array(value.arguments);if(args.length!==callee.helper.parameters.length||args.length>descriptor.limits.scalarArguments)fail('scalar helper call argument count differs','type');
    const arguments_=args.map(value=>expression(value));
    arguments_.forEach((value,index)=>{
      const formal=callee.helper.parameters[index];if(value.sourceType!==formal.logicalType)fail('helper call argument component/type differs','type');
      if(formal.view){const actual=scope.get(queryViewBinding(value));if(!actual?.mode||formal.view.access.mode==='write'&&actual.mode!=='write')fail('helper view actual cannot widen Read to Write','permission');}
      else if(value.sourceType!=='f32')fail('ordinary helper argument must be f32','type');
    });
    grammar.sequence(value.range,[value.calleeRange,'(',...args.flatMap((value,index)=>index?[',',value.range]:[value.range]),')']);
    return {kind:/** @type {'call'} */('call'),type:scalarTypeIds.f32,sourceType:'f32',range:{...value.range},callee:callee.helper.id,sourceCallee:callee.helper.sourceId,signatureHash:callee.helper.signatureHash,calleeRange:{...value.calleeRange},arguments:arguments_};
  }
  for(const {raw,helper,grammar,returned}of directory.values()){
    checkTypedArrayShape(raw.value,'arrayGenericExpression',false,commonSourceDescriptor);
    const scope=new Map(helper.parameters.map(parameter=>[parameter.binding.id,{declaration:parameter.binding,sourceType:parameter.logicalType,mode:parameter.view?.access.mode??null}]));
    const expression=queryExpressionDecoder({ast,grammar,bodyRange:helper.bodyRange,scope,component,fields,call:(value,scope,expression)=>call(value,helper.declaration.sourcePath,scope,expression),spend,fail});
    helper.value=expression(raw.value);if(helper.value.sourceType!=='f32')fail('helper view cannot escape through a return','capability');const originalValue=ast.children.get(returned.id)??[];if(originalValue.length!==1||canonical(originalValue[0].range)!==canonical(raw.value.range))fail('scalar helper return value original AST differs','source');
    grammar.sequence(helper.returnRange,['return',raw.value.range],true);
  }
  const helpers=/** @type {SystemQueryScalarHelper[]} */([...directory.values()].map(row=>row.helper));
  function complete(systems){
    const active=new Set(),reached=new Set(),heights=new Map(),edges=new Map();
    function collect(value,targets){
      spend();if(value.kind==='call'){targets.add(value.sourceCallee);for(const argument of value.arguments)collect(argument,targets);}
      else for(const child of [value.left,value.right,value.target,value.value,value.expression])if(child)collect(child,targets);
    }
    for(const helper of helpers){const targets=new Set();collect(helper.value,targets);edges.set(helper.sourceId,targets);}
    function visit(id){
      spend();if(heights.has(id))return heights.get(id);
      if(active.has(id))fail('recursive scalar helper graph is outside selected syntax','capability');
      active.add(id);const height=1+Math.max(0,...[...edges.get(id)].map(visit));active.delete(id);
      if(height>descriptor.limits.scalarCallDepth)fail('scalar helper call graph exceeds32','capability');heights.set(id,height);reached.add(id);return height;
    }
    const roots=new Set();for(const system of systems)for(const loop of system.loops)for(const statement of loop.statements)collect(statement.value,roots);
    for(const root of roots)visit(root);
    if(reached.size!==helpers.length)fail('scalar helper directory must contain exactly the reachable functions','source');
  }
  return {helpers,call,complete};
}
