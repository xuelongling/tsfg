// SPDX-License-Identifier: MIT
// Lexical declarations are checked independently from capture claims. A layout
// is derived only after original parent scopes and every binding owner agree.
import {originId} from './typed-array-schema.mjs';
import {commonTypeSyntax,commonCallableNameRange} from './common-program-source.mjs';
import {commonCheck as check,commonSame as same} from './common-program-common.mjs';
export function validateCommonLexical(payload,grammars,types,coverage,spend,visible) {
  spend(payload.functions.length+payload.types.length);const functions=new Map(payload.functions.map(fn=>[fn.id,fn]));
  for(const type of types.values())if(type.constructor)functions.set(type.constructor.id,type.constructor);
  for(const alias of payload.typeAliases){spend();const g=grammars.get(alias.sourcePath);check(g&&['function','reference'].includes(types.get(alias.type)?.kind),'type-alias');
    check(alias.id===originId(alias.sourcePath,alias.nameRange),'type-alias');g.name(alias.nameRange,alias.name);
    commonTypeSyntax(g,alias.annotationRange,alias.type,types,spend,payload.typeAliases,visible.get(alias.sourcePath));
    g.sequence(alias.declarationRange,['type',alias.nameRange,'=',alias.annotationRange],true);coverage.get(alias.sourcePath).push(alias.declarationRange);
  }
  const bodyRange=fn=>{const g=grammars.get(fn.sourcePath),at=g.indices(fn.declarationRange);let cursor=fn.returnAnnotationRange?g.indices(fn.returnAnnotationRange).end:g.indices(commonCallableNameRange(g,fn,types)).end;
    while(cursor<at.end&&g.tokens[cursor].text!=='{'){spend();cursor++;}check(cursor<at.end,'lexical');return {start:g.tokens[cursor].start,end:g.tokens[at.end-1].end};};
  for(const fn of functions.values()){
    spend();const g=grammars.get(fn.sourcePath),parent=fn.lexicalParent===null?null:functions.get(fn.lexicalParent);check(g&&(!fn.lexicalParent||parent),'lexical');
    if(parent){check(!fn.ownerType&&parent.sourcePath===fn.sourcePath&&same(fn.declarationScope,bodyRange(parent)),'lexical');
      check(parent.body.some(row=>{spend();return row.kind==='functionDeclaration'&&row.functionId===fn.id&&same(row.range,fn.declarationRange);}),'lexical','nested function must be a direct body declaration');}
    else check(same(fn.declarationScope,fn.ownerType?types.get(fn.ownerType).declarationRange:{start:0,end:g.text.length}),'lexical');
    const seen=new Set([fn.id]);let ancestor=parent;while(ancestor){spend();check(!seen.has(ancestor.id),'lexical');seen.add(ancestor.id);ancestor=ancestor.lexicalParent===null?null:functions.get(ancestor.lexicalParent);check(ancestor!==undefined,'lexical');}
    spend(fn.parameters.length+fn.bindings.length);for(const group of [fn.parameters,fn.bindings])for(const binding of group)check(binding.lexicalOwner===fn.id,'lexical');
    let previous=-1;const captured=new Set();for(const capture of fn.captures){spend();check(!captured.has(capture.binding)&&capture.occurrences.length>0&&capture.occurrences[0].range.start>previous,'capture');captured.add(capture.binding);previous=capture.occurrences[0].range.start;
      check(capture.read||capture.write,'capture');let last=-1;for(const occurrence of capture.occurrences){spend();check(occurrence.range.start>last&&(occurrence.read||occurrence.write),'capture');last=occurrence.range.start;}}
  }
  for(const global of payload.globals){spend();check(global.binding.lexicalOwner===null,'lexical');}
}
