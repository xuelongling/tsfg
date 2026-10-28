// SPDX-License-Identifier: MIT
import {canonical,sha256} from './identity.mjs';
import {checkTypedArrayShape,originId} from './typed-array-schema.mjs';
import {commonSourceDescriptor} from './common-program-common.mjs';
import {queryExpressionDecoder} from './system-query-expressions.mjs';

// The original AST owns declarations and lexical scope. Locals join that
// directory once; reads thereafter carry a BindingId, never an initializer.
export function decodeQueryStatements(raw,bindings,{ast,grammar,body,owner,scope,component,fields,call,proof,spend,fail,returns=null}){
  if(!Array.isArray(raw)||!Array.isArray(bindings))fail('Query statements/bindings arrays required','source');
  const directory=new Map(),seen=new Set();
  const same=(a,b)=>canonical(a)===canonical(b);
  const ownerId=sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath:owner.sourcePath,declarationRange:owner.range}));
  const localBindings=bindings.map(binding=>{
    spend();checkTypedArrayShape(binding,'arrayFactsBinding',false,commonSourceDescriptor);
    if(binding.kind!=='local'||!['f32','f64'].includes(binding.declaredType)||binding.elementAnnotationRange!==null||binding.lexicalOwner!==ownerId||directory.has(binding.id)||scope.has(binding.id))fail('original floating-point local binding differs','source');
    const declaration=ast.nodes.find(node=>node.sourcePath===grammar.source.path&&node.kind==='KindVariableDeclaration'&&same(node.range,binding.declarationRange)&&same(node.nameRange,binding.nameRange)&&node.name===binding.name);
    if(!declaration||binding.id!==originId(grammar.source.path,binding.nameRange))fail('local original declaration/identity differs','source');
    directory.set(binding.id,{raw:binding,declaration});return {...binding};
  });
  const expression=queryExpressionDecoder({ast,grammar,bodyRange:body.range,scope,component,fields,call,proof,spend,fail});
  const originals=ast.children.get(body.id)??[],statements=[];let cursor=0;
  for(const original of originals){
    spend();
    if(original.kind==='KindVariableStatement'){
      const lists=ast.children.get(original.id)??[];
      if(lists.length!==1||lists[0].kind!=='KindVariableDeclarationList')fail('original local declaration list differs','source');
      const list=lists[0],declarations=ast.children.get(list.id)??[],pieces=[];
      let keyword;
      for(const [index,node]of declarations.entries()){
        spend();const statement=raw[cursor++];checkTypedArrayShape(statement,'arrayGenericStatement',false,commonSourceDescriptor);
        const selected=directory.get(statement.binding);
        if(!selected||selected.declaration.id!==node.id||bindings[seen.size]?.id!==statement.binding||seen.has(statement.binding)||!same(statement.range,node.range)||!['constDeclaration','letDeclaration'].includes(statement.kind))fail('original local statement binding/order differs','source');
        const binding=selected.raw,kind=statement.kind==='constDeclaration'?'const':'let';
        if(keyword&&keyword!==kind||binding.writable!==(kind==='let'))fail('local declaration writability differs','source');keyword=kind;
        if(!statement.initializer)fail('initialized Query local required','capability');
        const value=expression(statement.initializer,'read',0,binding.annotationRange?binding.declaredType:null);
        if(value.sourceType!==binding.declaredType)fail('local initializer width differs','type');
        if(binding.annotationRange)proof.verifyLogical(grammar.source.path,binding.annotationRange,binding.declaredType,component.types);
        const children=ast.children.get(node.id)??[],initializer=children.at(-1);
        if(!initializer||!same(initializer.range,statement.initializer.range))fail('original local initializer differs','source');
        grammar.sequence(node.range,[binding.nameRange,...(binding.annotationRange?[':',binding.annotationRange]:[]),'=',statement.initializer.range]);
        if(index)pieces.push(',');pieces.push(node.range);
        scope.set(binding.id,{declaration:{id:binding.id,sourcePath:grammar.source.path,kind:node.kind,name:binding.name,range:node.range,nameRange:binding.nameRange},sourceType:binding.declaredType,mode:null,writable:binding.writable,local:true});
        seen.add(binding.id);statements.push({kind:statement.kind,range:{...statement.range},binding:binding.id,initializer:value});
      }
      grammar.sequence(list.range,[keyword,...pieces]);grammar.sequence(original.range,[list.range],true);
    }else{
      const statement=raw[cursor++];checkTypedArrayShape(statement,'arrayGenericStatement',false,commonSourceDescriptor);
      if(!same(statement.range,original.range)||statement.kind!==(original.kind==='KindReturnStatement'?'return':'expression')||!['KindReturnStatement','KindExpressionStatement'].includes(original.kind)||!statement.value)fail('original Query statement differs','source');
      const value=expression(statement.value,'read',0,statement.kind==='return'?returns:null);
      if(statement.kind==='return'){
        if(!returns||original!==originals.at(-1)||value.sourceType!==returns)fail('helper must end in same-width floating-point return','capability');
        grammar.sequence(statement.range,['return',statement.value.range],true);
      }else{
        if(!['fieldAssignment','bindingAssignment','call'].includes(value.kind))fail('Query effect statement differs','capability');
        grammar.sequence(statement.range,[statement.value.range],true);
      }
      const values=ast.children.get(original.id)??[];
      if(values.length!==1||!same(values[0].range,statement.value.range))fail('original statement value differs','source');
      statements.push({kind:statement.kind,range:{...statement.range},value});
    }
  }
  if(cursor!==raw.length||seen.size!==directory.size||returns&&statements.at(-1)?.kind!=='return')fail('complete Query local/statement inventory differs','source');
  grammar.body(body.range,originals);return {statements,localBindings};
}
