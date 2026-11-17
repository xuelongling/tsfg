// SPDX-License-Identifier: MIT
import descriptor from '../contracts/system-query-facts.schema.json' with {type:'json'};
import {canonical,sha256} from './identity.mjs';
import {originId} from './typed-array-schema.mjs';
import {commonTypeSyntax} from './common-program-source.mjs';
import {sourceLexicalTokens} from './conversions.mjs';
import {relativeModuleSource} from './module-hir-source.mjs';
import {identifierName} from './module-facts.mjs';

function originalNode(ast,sourcePath,kind,range,parent){
  return ast.directory.get(sha256('tsfg.system-query.node.v1\0'+canonical({sourcePath,kind,range,parent})));
}
// Explicit construction access comes from the original direct class member.
export function verifyQueryConstructorSource(type,grammar,ast,fail){
  const ctor=type.constructor;
  const {sourcePath}=type;
  const declaration=originalNode(ast,sourcePath,'KindClassDeclaration',type.declarationRange,ast.roots.get(sourcePath));
  if(!declaration||declaration.name!==type.name||canonical(declaration.nameRange)!==canonical(type.nameRange)
    ||ctor.sourcePath!==sourcePath||ctor.lexicalParent!=null||!originalNode(ast,sourcePath,'KindConstructor',ctor.declarationRange,declaration.id))
    fail('component constructor is not an original direct class member','source');
  const {first,end}=grammar.indices(ctor.declarationRange),prefix=grammar.tokens[first].text;
  const modified=['public','protected','private'].includes(prefix),keyword=first+(modified?1:0);
  if(keyword>=end||grammar.tokens[keyword].text!=='constructor'||ctor.access!==(modified?prefix:'public'))
    fail('original component constructor access differs','source');
}
// Replay only the original type-reference/alias syntax and its recorded
// substitutions. The facts never supply a spelling-to-target shortcut.
export function querySourceProof(ast,grammars,sources,aliases,spend,fail){
  let cursor=0;
  const declarationKinds=['KindTypeParameter','KindTypeAliasDeclaration','KindClassDeclaration','KindInterfaceDeclaration'];
  const children=node=>ast.children.get(node.id)??[];
  const origin=node=>({id:originId(node.sourcePath,node.nameRange??node.range),sourcePath:node.sourcePath,kind:node.kind,name:node.name,range:node.range,nameRange:node.nameRange??node.range});
  const at=(path,span)=>{
    spend(ast.nodes.length);
    const node=ast.nodes.find(node=>node.sourcePath===path&&canonical(node.range)===canonical(span)&&['KindTypeReference','KindTupleType','KindParenthesizedType'].includes(node.kind));
    if(!node)fail('original type syntax node missing','source');return node;
  };
  const argumentsOf=node=>{const rows=children(node);spend(rows.length);return rows.filter(child=>!['KindIdentifier','KindQualifiedName'].includes(child.kind));};
  function exportedBinding(root,name,kinds,values){
    const grammar=grammars.get(root.sourcePath),statements=children(root);
    spend(statements.length);const declarations=statements.filter(row=>kinds.includes(row.kind)),found=[];
    if(values)for(const statement of statements)if(statement.kind==='KindVariableStatement')for(const list of children(statement))if(list.kind==='KindVariableDeclarationList')declarations.push(...children(list).filter(row=>kinds.includes(row.kind)));
    for(const declaration of declarations){
      spend();let statement=declaration;while(statement.parent!==root.id){spend();statement=ast.directory.get(statement.parent);}
      const tokens=grammar.spelling(statement.range);let index=0;while(tokens[index]==='@')index+=2;
      if(declaration.name===name&&tokens[index]==='export'&&tokens[index+1]!=='default')found.push(declaration);
    }
    for(const statement of statements){
      spend();if(['KindEndOfFile','KindEndOfFileToken'].includes(statement.kind))continue;
      const tokens=grammar.spelling(statement.range);if(tokens[0]!=='export')continue;let index=1,typeOnly=false;
      if(tokens[index]==='type'&&['{','*'].includes(tokens[index+1])){typeOnly=true;index++;}
      if(tokens[index]==='*'||tokens[index]==='=')fail('re-export or dynamic module export has no selected binding proof','capability');
      if(tokens[index]!=='{')continue;index++;const bindings=[];
      while(tokens[index]!=='}'){
        spend();let type=typeOnly;if(tokens[index]==='type'&&tokens[index+1]!=='as'&&tokens[index+1]!==','&&tokens[index+1]!=='}'){type=true;index++;}
        const local=identifierName(tokens[index++]);let exported=local;
        if(tokens[index]==='as'){index++;exported=identifierName(tokens[index++]);}bindings.push({local,exported,type});
        if(tokens[index]!==',')break;index++;
      }
      if(tokens[index++]!=='}')fail('original named export list differs','source');
      if(tokens[index]==='from')fail('module re-export has no selected binding proof','capability');
      if(tokens[index]===';')index++;if(index!==tokens.length)fail('original named export statement differs','source');
      for(const binding of bindings)if(binding.exported===name&&(!values||!binding.type)){
        spend(declarations.length);
        const selected=declarations.filter(row=>row.name===binding.local);
        if(selected.length!==1)fail('local named export must select one original module declaration','capability');found.push(selected[0]);
      }
    }
    if(found.length!==1)fail('original named import has no unique module export','source');return found[0];
  }
  function scopeDeclarations(scope,values){
    const nested=children(scope);spend(1+2*nested.length);const declarations=[...nested];
    if(values)for(const statement of nested)if(statement.kind==='KindVariableStatement')for(const list of children(statement))if(list.kind==='KindVariableDeclarationList')declarations.push(...children(list));
    if(values&&scope.kind==='KindForOfStatement')for(const list of nested.filter(node=>node.kind==='KindVariableDeclarationList'))for(const declaration of children(list))for(const pattern of children(declaration).filter(node=>node.kind==='KindArrayBindingPattern'))declarations.push(...children(pattern));
    spend(declarations.length-nested.length);
    return declarations;
  }
  function binding(node,values=false,scope=ast.directory.get(node.parent)){
    spend(1+(values?0:children(node).length));const nameNode=values?node:children(node).find(child=>child.kind==='KindIdentifier'||child.kind==='KindQualifiedName');
    if(!nameNode||nameNode.kind!=='KindIdentifier')fail('original named type reference required','source');
    const name=identifierName(grammars.get(node.sourcePath).slice(nameNode.range));
    const kinds=values?['KindFunctionDeclaration','KindClassDeclaration','KindVariableDeclaration','KindBindingElement','KindParameter']:declarationKinds;
    let parent=scope;
    while(parent){
      const local=scopeDeclarations(parent,values).filter(child=>kinds.includes(child.kind)&&child.name===name);
      if(local.length){if(local.length!==1)fail('ambiguous original type binding','source');return local[0];}
      parent=ast.directory.get(parent.parent);
    }
    const root=ast.directory.get(ast.roots.get(node.sourcePath));
    const imported=[];
    spend(children(root).length);
    for(const declaration of children(root).filter(row=>row.kind==='KindImportDeclaration')){
      spend(1+children(declaration).length+Math.ceil((declaration.range.end-declaration.range.start)/8));const literal=children(declaration).find(row=>row.kind==='KindStringLiteral');
      const tokens=sourceLexicalTokens(grammars.get(node.sourcePath).slice(declaration.range));
      const specifier=tokens?.find(token=>token.kind==='text')?.value;
      if(!literal||!specifier)fail('original import source required','source');
      const sourcePath=relativeModuleSource(node.sourcePath,specifier,sources);
      if(!sourcePath)fail('original import closure differs','source');
      spend(ast.nodes.length);
      const specifiers=ast.nodes.filter(row=>row.sourcePath===node.sourcePath&&row.kind==='KindImportSpecifier'&&row.range.start>=declaration.range.start&&row.range.end<=declaration.range.end);
      for(const specifier of specifiers){
        spend();
        const names=grammars.get(node.sourcePath).spelling(specifier.range).filter(value=>value!=='type');
        const local=identifierName(names.at(-1)),exported=identifierName(names[0]);
        if(local!==name)continue;
        if(!((names.length===1)||(names.length===3&&names[1]==='as'))||values&&(tokens[1]?.value==='type'||grammars.get(node.sourcePath).spelling(specifier.range)[0]==='type'))fail('direct named value import syntax differs','capability');
        const foreignRoot=ast.directory.get(ast.roots.get(sourcePath));
        imported.push(exportedBinding(foreignRoot,exported,kinds,values));
      }
    }
    if(imported.length){if(imported.length!==1)fail('ambiguous original import binding','source');return imported[0];}
    const globals=[descriptor.profile.path,descriptor.profile.standardPath].flatMap(path=>
      scopeDeclarations(ast.directory.get(ast.roots.get(path)),values).filter(row=>kinds.includes(row.kind)&&row.name===name));
    if(globals.length!==1)fail('original type declaration is outside owned scope','source');return globals[0];
  }
  const target=node=>node.kind==='KindTypeReference'?origin(binding(node)):origin(node);
  const decoratorBindings=new Map();
  function decorator(declaration,markerRange,spelling){
    spend();
    const {sourcePath,kind,range}=declaration,grammar=grammars.get(sourcePath),rootId=ast.roots.get(sourcePath);
    const root=ast.directory.get(rootId),owner=originalNode(ast,sourcePath,kind,range,rootId);
    const marker=owner&&originalNode(ast,sourcePath,'KindDecorator',markerRange,owner.id);
    const label=kind==='KindClassDeclaration'?'component':'system';
    grammar.sequence(markerRange,['@',spelling]);
    const {first,end}=grammar.indices(markerRange),token=grammar.tokens[first+1];
    const use=marker&&end===first+2&&originalNode(ast,sourcePath,'KindIdentifier',{start:token.start,end:token.end},marker.id);
    if(root?.kind!=='KindSourceFile'||!use)fail('original '+label+' decorator occurrence differs','source');
    const key=sourcePath+'\0'+spelling;
    if(!decoratorBindings.has(key))decoratorBindings.set(key,origin(binding(use,true,root)));
    return {owner,binding:decoratorBindings.get(key)};
  }
  function definition(declaration){
    const members=children(declaration);spend(members.length);
    const parameters=members.filter(row=>row.kind==='KindTypeParameter'),rhs=members.at(-1);
    if(!rhs)fail('original alias definition missing','source');
    const grammar=grammars.get(declaration.sourcePath),bounds=grammar.indices(declaration.range),name=grammar.indices(declaration.nameRange),prefix=grammar.tokens.slice(bounds.first,name.first).map(token=>token.text);
    if(!['type','export type'].includes(prefix.join(' ')))fail('original alias declaration prefix differs','source');
    grammar.sequence(declaration.range,[...prefix,declaration.nameRange,...(parameters.length?['<',...parameters.flatMap((row,index)=>index?[',',row.range]:[row.range]),'>']:[]),'=',rhs.range],true);
    return {parameters,rhs};
  }
  function verifyLogical(path,span,id,types,depth=0){
    spend();if(depth>64)fail('original annotation alias graph exceeded','limit');
    const reference=ast.typeReference(path,span);
    if(reference){
      const declaration=binding(reference),type=types.get(id);
      if(!type)fail('original annotation type is outside the catalogue','source');
      const sameDeclaration=declaration.sourcePath===type.sourcePath&&canonical(declaration.nameRange)===canonical(type.nameRange);
      const grammar=grammars.get(path);
      if(sameDeclaration&&(type.kind==='array'||type.kind==='readSpan'))return commonTypeSyntax(grammar,span,id,types,spend);
      spend(children(reference).length);
      const name=children(reference).find(child=>child.kind==='KindIdentifier');
      if(!name||argumentsOf(reference).length)fail('concrete original annotation has type arguments','source');
      grammar.sequence(span,[name.range]);
      if(sameDeclaration)return;
      if(declaration.kind==='KindTypeAliasDeclaration'){
        const {parameters,rhs}=definition(declaration);
        if(parameters.length)fail('ordinary annotation requires concrete original alias','source');
        return verifyLogical(rhs.sourcePath,rhs.range,id,types,depth+1);
      }
      fail('original annotation declaration target differs','source');
    }
    commonTypeSyntax(grammars.get(path),span,id,types,spend);
  }
  function resolve(node,env=new Map(),depth=0){
    spend();if(depth>64)fail('original alias graph exceeded','limit');
    if(node.kind==='KindParenthesizedType'){
      const nested=children(node);if(nested.length!==1)fail('parenthesized original type differs','source');return resolve(nested[0],env,depth+1);
    }
    if(node.kind!=='KindTypeReference')return {node,env};
    const declaration=binding(node),actual=origin(declaration),substitution=declaration.kind==='KindTypeParameter'?env.get(actual.id):null;
    if(!substitution&&(declaration.kind!=='KindTypeAliasDeclaration'||declaration.sourcePath===descriptor.profile.path&&['Read','Write'].includes(declaration.name))){
      const unexpected=aliases[cursor];
      if(unexpected?.useSourcePath===node.sourcePath&&canonical(unexpected.useRange)===canonical(node.range))fail('alias proof attached to an original builtin/component reference','source');
      return {node,env};
    }
    const trace=aliases[cursor++];
    if(!trace||trace.useSourcePath!==node.sourcePath||canonical(trace.useRange)!==canonical(node.range)||canonical(trace.declaration)!==canonical(actual))fail('original alias occurrence/declaration order differs','source');
    let result;
    if(substitution)result=resolve(substitution,env,depth+1);
    else {
      const {parameters,rhs}=definition(declaration),arguments_=argumentsOf(node),next=new Map(env);
      if(parameters.length!==arguments_.length||!rhs||!['KindTypeReference','KindTupleType','KindParenthesizedType'].includes(rhs.kind))fail('original alias definition/arguments differ','source');
      parameters.forEach((parameter,index)=>next.set(origin(parameter).id,arguments_[index]));
      result=resolve(rhs,next,depth+1);
    }
    if(canonical(trace.target)!==canonical(target(result.node)))fail('original alias definition/substitution target differs','source');
    return result;
  }
  return {at,resolve,target,argumentsOf,verifyLogical,decorator,valueBinding:(node,scope=undefined)=>origin(binding(node,true,scope)),complete:()=>{if(cursor!==aliases.length)fail('unconsumed alias proof differs','source');}};
}
