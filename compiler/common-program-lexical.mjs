// SPDX-License-Identifier: MIT
// Lexical declarations are checked independently from capture claims. A layout
// is derived only after original parent scopes and every binding owner agree.
import {originId} from './typed-array-schema.mjs';
import {commonTypeSyntax,commonCallableNameRange} from './common-program-source.mjs';
import {commonCheck as check,commonSame as same} from './common-program-common.mjs';
export function commonCaptureType(id,types,spend) {
  spend();const type=types.get(id);
  if(type?.kind!=='union')return ['scalar','string','readSpan','array','function','reference','value'].includes(type?.kind);
  spend(type.members.length);let scalars=true;const payload=type.members.filter(id=>{
    const kind=types.get(id)?.kind;if(kind==='null'||kind==='undefined')return false;scalars&&=kind==='scalar';return true;
  });
  return type.members.length>=2&&((payload.length>0&&scalars)||(type.members.length<=3&&payload.length===1
    &&['scalar','string','array','function','reference','value'].includes(types.get(payload[0])?.kind)));
}
// Private structural paths distinguish scopes without hashing source offsets.
// Each entry retains its original declaration and the visible ancestor layers.
export function commonLexicalScopes(fn,spend) {
  const declarations=new Map();
  function walk(rows,path=[],chain=[],repeated=false,eligible=true){
    spend(path.length+chain.length+1);const scope={rows,path,repeated,eligible};scope.chain=[...chain,scope];
    for(const [index,row]of rows.entries()){
      spend();if(['letDeclaration','constDeclaration','functionDeclaration'].includes(row.kind)){
        const id=row.kind==='functionDeclaration'?row.functionId:row.binding;
        check(!declarations.has(id),'lexical');declarations.set(id,{row,scope});
      }
      const descend=(children,label,again=repeated,allowed=eligible)=>walk(children,[...path,label+':'+index],scope.chain,again,allowed);
      if(row.kind==='block')descend(row.body,'block');
      if(row.kind==='if'){descend(row.then,'if:then');descend(row.else,'if:else');}
      if(row.kind==='while')descend(row.body,'while',true,false);
      if(row.kind==='try'){
        descend(row.tryBlock.body,'try',repeated,false);
        if(row.catchClause)descend(row.catchClause.block.body,'catch',repeated,false);
        if(row.finallyBlock)descend(row.finallyBlock.body,'finally',repeated,false);
      }
    }
  }
  walk(fn.body);return declarations;
}
export function validateCommonLexical(payload,grammars,types,coverage,spend,visible) {
  spend(payload.functions.length+payload.types.length);const functions=new Map(payload.functions.map(fn=>[fn.id,fn]));
  for(const type of types.values())if(type.constructor)functions.set(type.constructor.id,type.constructor);
  const scopes=new Map([...functions].map(([id,fn])=>[id,commonLexicalScopes(fn,spend)]));
  for(const alias of payload.typeAliases){spend();const g=grammars.get(alias.sourcePath);check(g&&['function','reference','value'].includes(types.get(alias.type)?.kind),'type-alias');
    check(alias.id===originId(alias.sourcePath,alias.nameRange),'type-alias');g.name(alias.nameRange,alias.name);
    commonTypeSyntax(g,alias.annotationRange,alias.type,types,spend,payload.typeAliases,visible.get(alias.sourcePath));
    g.sequence(alias.declarationRange,['type',alias.nameRange,'=',alias.annotationRange],true);coverage.get(alias.sourcePath).push(alias.declarationRange);
  }
  const bodyRange=fn=>{const g=grammars.get(fn.sourcePath),at=g.indices(fn.declarationRange);let cursor=fn.returnAnnotationRange?g.indices(fn.returnAnnotationRange).end:g.indices(commonCallableNameRange(g,fn,types)).end;
    while(cursor<at.end&&g.tokens[cursor].text!=='{'){spend();cursor++;}check(cursor<at.end,'lexical');return {start:g.tokens[cursor].start,end:g.tokens[at.end-1].end};};
  for(const fn of functions.values()){
    spend();const g=grammars.get(fn.sourcePath),parent=fn.lexicalParent===null?null:functions.get(fn.lexicalParent);check(g&&(!fn.lexicalParent||parent),'lexical');
    if(parent){const declaration=scopes.get(parent.id).get(fn.id),body=bodyRange(parent);
      check(!fn.ownerType&&parent.sourcePath===fn.sourcePath&&fn.declarationScope.start>=body.start&&fn.declarationScope.end<=body.end,'lexical');
      check(declaration&&declaration.row.kind==='functionDeclaration'&&same(declaration.row.range,fn.declarationRange),'lexical');
      check(declaration.scope.eligible&&!declaration.scope.repeated,'capability','nested declaration requires a single-entry block/if scope');}
    else check(same(fn.declarationScope,fn.ownerType?types.get(fn.ownerType).declarationRange:{start:0,end:g.text.length}),'lexical');
    const seen=new Set([fn.id]);let ancestor=parent;while(ancestor){spend();check(!seen.has(ancestor.id),'lexical');seen.add(ancestor.id);ancestor=ancestor.lexicalParent===null?null:functions.get(ancestor.lexicalParent);check(ancestor!==undefined,'lexical');}
    spend(fn.parameters.length+fn.bindings.length);for(const group of [fn.parameters,fn.bindings])for(const binding of group)check(binding.lexicalOwner===fn.id,'lexical');
    let previous=-1;const captured=new Set();for(const capture of fn.captures){spend();check(!captured.has(capture.binding)&&capture.occurrences.length>0&&capture.occurrences[0].range.start>previous,'capture');captured.add(capture.binding);previous=capture.occurrences[0].range.start;
      check(capture.read||capture.write,'capture');let last=-1;for(const occurrence of capture.occurrences){spend();check(occurrence.range.start>last&&(occurrence.read||occurrence.write),'capture');last=occurrence.range.start;}}
  }
  for(const global of payload.globals){spend();check(global.binding.lexicalOwner===null,'lexical');}
}
