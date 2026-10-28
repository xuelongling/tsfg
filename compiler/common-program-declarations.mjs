// SPDX-License-Identifier: MIT
// Declaration/member coverage is independent of use sites. An unused field,
// parameter or ordinary function cannot disappear behind a retained class span.
import {canonical,sha256} from './identity.mjs';
import {commonCheck as check} from './common-program-common.mjs';
import {commonTypeSyntax,commonCallableNameRange} from './common-program-source.mjs';

export function validateCommonDeclarations(payload,grammars,types,spend,visible) {
  const functions=new Map([...payload.functions,...payload.types.flatMap(row=>row.constructor?[row.constructor]:[])].map(fn=>[fn.id,fn]));
  for(const fn of functions.values()) {
    spend();const g=grammars.get(fn.sourcePath),all=g.tokens,bounds=g.indices(fn.declarationRange),nameRange=commonCallableNameRange(g,fn,types),name=g.indices(nameRange);
    const prefix=all.slice(bounds.first,name.first).map(token=>token.text);
    if(fn.ownerType)check(prefix.every(t=>['public','private','protected','override'].includes(t)),'capability');
    else check(prefix.join(' ')==='function'||prefix.join(' ')==='export function'||prefix.join(' ')==='export default function','capability');
    const parameters=[];
    for(const [i,p]of fn.parameters.entries()) {
      spend();if(i)parameters.push(',');parameters.push(p.declarationRange);
      const pb=g.indices(p.declarationRange),pn=g.indices(p.nameRange);
      const modifiers=all.slice(pb.first,pn.first).map(token=>token.text);
      check(modifiers.every(token=>['public','private','protected','readonly'].includes(token)),'capability');
      check(p.annotationRange,'capability','complete concrete parameter annotation required');
      g.sequence(p.declarationRange,[...modifiers,p.nameRange,':',p.annotationRange]);
      commonTypeSyntax(g,p.annotationRange,p.declaredType,types,spend,payload.typeAliases,visible.get(fn.sourcePath));
    }
    if(fn.returnAnnotationRange)commonTypeSyntax(g,fn.returnAnnotationRange,fn.returnType,types,spend,payload.typeAliases,visible.get(fn.sourcePath));
    else check(fn.name==='constructor'||fn.returnType==='void','source');
    let start=fn.returnAnnotationRange?g.indices(fn.returnAnnotationRange).end:name.end;
    while(start<bounds.end&&all[start].text!=='{'){spend();start++;}
    check(start<bounds.end&&all[bounds.end-1].text==='}','source');const body={start:all[start].start,end:all[bounds.end-1].end};
    g.sequence(fn.declarationRange,[...prefix,nameRange,'(',...parameters,')',...(fn.returnAnnotationRange?[':',fn.returnAnnotationRange]:[]),body]);
  }
  for(const type of types.values())if(['value','reference'].includes(type.kind)) {
    spend();const g=grammars.get(type.sourcePath),bounds=g.indices(type.declarationRange),name=g.indices(type.nameRange),all=g.tokens;
    const header=all.slice(bounds.first,name.first).map(token=>token.text);
    const marker=type.markerOrigin;
    if(marker) {
      const expected=type.kind==='value'?'tsfgValue':'tsfgComponent';
      check(type.nominalKey.category===(type.kind==='value'?'value':'component'),'type');
      check(marker.declarationPath===payload.sourceRoot+'/minimal-arrays-v8.d.ts'&&marker.declarationSha256==='sha256:0d30a2f626bb7455decf36f5a7a8d3308d4254100d2cb10e7c0d2353d28b141e'
        &&marker.version==='minimal-arrays-v8'&&marker.contextName==='ClassDecoratorContext'&&marker.contextArity===1&&marker.mode==='standard','declaration');
      check(marker.entryId===sha256('tsfg.array-facts.marker.v8\0'+canonical({sourcePath:marker.declarationPath,declarationRange:marker.declarationRange})),'identity');
      g.sequence(marker.range,['@',expected]);
      check(header.includes('@')&&header.includes(expected),'source');
    }else check(type.kind==='reference'&&type.nominalKey.category==='reference','type');
    check(header.every(token=>['@','tsfgValue','tsfgComponent','export','default','class'].includes(token))&&header.at(-1)==='class','capability');
    const members=[...(type.fields??[]).filter(field=>!field.parameterBinding).map(field=>field.origin),
      ...(type.methods??[]).map(id=>functions.get(id)?.declarationRange),...(type.constructor?[type.constructor.declarationRange]:[])];
    check(members.every(Boolean),'function');members.sort((a,b)=>a.start-b.start);
    const base=type.base?types.get(type.base):null;
    g.sequence(type.declarationRange,[...header,type.nameRange,...(base?['extends',base.name]:[]),'{',...members,'}']);
  }
}
