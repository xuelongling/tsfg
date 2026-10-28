// SPDX-License-Identifier: MIT
// One selected, complete Source package. No reheadering or partial-family join.
import bytecode from '../contracts/bytecode.schema.json' with {type:'json'};
import {validateTypedArrayTypes,validateTypedArrayDeclarations} from './typed-array-types.mjs';
import {logicalPath,byteOrder,sourceRange,originId} from './typed-array-schema.mjs';
import {normalizeClosure} from './modules.mjs';
import {commonSourceGrammar,commonSourceAccess,commonTypeSyntax} from './common-program-source.mjs';
import {validateCommonBodies} from './common-program-body.mjs';
import {validateCommonDeclarations} from './common-program-declarations.mjs';
import {validateCommonLexical} from './common-program-lexical.mjs';
import {validateCommonHostDeclarations} from './common-program-hosts.mjs';
import {commonSemanticIdentities} from './common-program-identities.mjs';
import {commonSourceDescriptor as descriptor,commonSourceFormat as format,canonical,sha256,own,
  commonBudget,commonJson,commonCheck as check,commonSame as same,commonMeter} from './common-program-common.mjs';
export {commonSourceFormat} from './common-program-common.mjs';

function shape(value,name,spend) {
  spend();if(name.startsWith('*')){if(value===null)return;return shape(value,name.slice(1),spend);}
  if(name.startsWith('[]')){check(Array.isArray(value),'schema');spend(value.length);for(const child of value)shape(child,name.slice(2),spend);return;}
  if(name==='string'){check(typeof value==='string'&&value.isWellFormed(),'schema');return;}
  if(name==='bool'){check(typeof value==='boolean','schema');return;}
  if(name==='int'||name==='int32'){check(Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0)&&(name!=='int32'||value<=2147483647),'schema');return;}
  const rule=descriptor.objects[name];check(rule&&value&&typeof value==='object'&&!Array.isArray(value),'schema');
  check(rule.required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>Object.hasOwn(rule.properties,key)),'schema');
  const group={arrayGenericExpression:'expressionKinds',arrayGenericTarget:'targetKinds',arrayGenericStatement:'statementKinds',arrayGenericType:'typeKinds'}[name];
  if(group){const selected=descriptor[group][value.kind];check(selected,'kind');
    const optional=name==='arrayGenericExpression'?['compatibilityRoots',...(value.kind==='numericLiteral'?['decimal','bits']:[]),...(value.kind==='call'?['receiver']:[]),...(value.kind==='stringConcat'?['operator']:[])]
      :name==='arrayGenericType'&&['value','reference'].includes(value.kind)?['markerOrigin','base','methods']
      :name==='arrayGenericStatement'?(value.kind==='return'?['value']:value.kind==='try'?['catchClause','finallyBlock']:[]):[];
    check(selected.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>rule.required.includes(key)||selected.includes(key)||optional.includes(key)),'schema');}
  for(const [key,child]of Object.entries(value))shape(child,rule.properties[key],spend);
}

export function verifyCommonProgramFacts(value) {
  commonBudget(value);const spend=commonMeter();shape(value,'commonProgramPackage',spend);
  check(value.family===format.family&&value.version===format.version&&value.schemaHash===format.schemaHash,'identity');
  const p=value.payload;logicalPath(p.sourceRoot);logicalPath(p.rootFile);
  check(p.rootFile.startsWith(p.sourceRoot+'/')&&p.rootFile.endsWith('.ts')&&!p.rootFile.endsWith('.d.ts')&&p.positionUnit==='utf16','source');
  check(same(p.config,{strict:true,noEmit:true,allowJs:false})&&p.diagnostics.length===0,'config');
  const sources=new Map();let bytes=0;
  check(p.files.length>=2&&p.files.length<=64&&p.types.length<=4096&&p.functions.length<=4096&&p.globals.length<=4096,'limit');
  for(const row of p.files){spend();logicalPath(row.path);check(row.path.startsWith(p.sourceRoot+'/')&&row.path.endsWith('.ts')&&!sources.has(row.path)
    &&(!sources.size||byteOrder([...sources.keys()].at(-1),row.path)<0),'source');
    bytes+=row.byteLength;check(bytes<=1048576&&row.byteLength===Buffer.byteLength(row.content)&&row.utf16Length===row.content.length&&row.sha256===sha256(row.content).slice(7),'identity');sources.set(row.path,row);}
  const declaration=p.sourceRoot+'/minimal-arrays-v8.d.ts';
  check(sources.has(p.rootFile)&&same(p.declarations,{version:'minimal-arrays-v8',paths:[declaration]})&&sources.get(declaration)?.sha256==='0d30a2f626bb7455decf36f5a7a8d3308d4254100d2cb10e7c0d2353d28b141e','declaration');
  check(p.target.target===bytecode.target.target&&p.target.triple===bytecode.target.triple&&p.target.pointerBits==='64'
    &&p.target.llvmDataLayout===bytecode.target.llvmDataLayout,'target');
  for(const type of p.types)if(type.kind==='unknown'){spend();check(type.id==='unknown'&&type.constructor===null,'unknown-type');}
  spend(p.types.length);const sourceTypeIds=new Set(p.types.map(type=>type.id));
  for(const type of p.types)if(type.kind==='function'){spend(type.parameters.length+1);check(type.parameters.length<=64&&type.constructor===null&&type.parameters.every(id=>sourceTypeIds.has(id))&&sourceTypeIds.has(type.returnType),'function-type');
    check(type.id===sha256('tsfg.program.function-type.v2\0'+canonical({parameters:type.parameters,returnType:type.returnType})),'function-type');}
  const types=validateTypedArrayTypes(p,sources);validateTypedArrayDeclarations(p,sources);validateCommonHostDeclarations(p,sources,types,spend);
  const grammars=new Map([...sources].filter(([path])=>!path.endsWith('.d.ts')).map(([path,row])=>[path,commonSourceGrammar(row,spend)]));
  const functions=new Map(p.functions.map(fn=>[fn.id,fn])),globals=new Map(p.globals.map(row=>[row.binding.id,row]));
  check(functions.size===p.functions.length&&globals.size===p.globals.length,'identity');
  const modules=new Map(),visible=new Map(),coverage=new Map([...grammars.keys()].map(path=>[path,[]]));
  check(p.modules.length===grammars.size&&p.modules.length<=64,'module');
  for(const row of p.modules){spend();check(grammars.has(row.sourcePath)&&!modules.has(row.sourcePath)&&row.external===true,'module');modules.set(row.sourcePath,row);
    const scope=new Map();for(const fn of p.functions.filter(fn=>fn.sourcePath===row.sourcePath&&!fn.ownerType&&fn.lexicalParent===null)){check(!scope.has(fn.name),'scope');scope.set(fn.name,fn.id);}
    for(const global of p.globals.filter(global=>global.sourcePath===row.sourcePath)){check(!scope.has(global.binding.name),'scope');scope.set(global.binding.name,global.binding.id);}
    visible.set(row.sourcePath,scope);}
  const target=id=>functions.get(id)??globals.get(id)??types.get(id)??modules.get(id);
  const targetPath=row=>row.sourcePath;
  for(const module of p.modules){const g=grammars.get(module.sourcePath),scope=visible.get(module.sourcePath);
    check(same(module.globals,p.globals.filter(row=>row.sourcePath===module.sourcePath).map(row=>row.binding.id)),'global');
    const initialized=module.initialization.filter(row=>row.kind==='initialize');check(same(initialized.map(row=>row.binding),module.globals),'global');
    for(const global of p.globals.filter(row=>row.sourcePath===module.sourcePath)){const row=global.binding;
      check(['let','const','default-export'].includes(global.bindingKind)&&row.kind==='global'&&row.writable===(global.bindingKind==='let'),'global');}
    for(const edge of module.imports){spend();check(modules.has(edge.sourcePath)&&['import','export','export-star'].includes(edge.kind),'module');sourceRange(edge.range,g.text);coverage.get(module.sourcePath).push(edge.range);
      check(edge.specifier.startsWith('./')||edge.specifier.startsWith('../'),'module');
      const resolved=module.sourcePath.split('/').slice(0,-1);
      for(const part of edge.specifier.split('/')){spend();if(!part||part==='.')continue;if(part==='..'){check(resolved.length>1,'module');resolved.pop();}else resolved.push(part);}
      const path=resolved.join('/');check((path.endsWith('.ts')?path:path+'.ts')===edge.sourcePath,'module','module edge does not resolve to actual retained module');
      const bounds=g.indices(edge.range),keyword=edge.kind==='import'?'import':'export';let from=bounds.end;
      if(g.tokens[from-1].text===';')from--;
      check(from>=bounds.first+3&&g.tokens[bounds.first].text===keyword,'module','original module edge keyword differs');
      const quoted=g.tokens[from-1].text;
      check(g.tokens[from-2].text==='from'&&(quoted==='"'+edge.specifier+'"'||quoted==="'"+edge.specifier+"'"),'module','original module specifier differs');
      const star=g.tokens[bounds.first+1].text==='*',parts=[keyword,...(star?(edge.kind==='import'?['*','as']:['*']):['{'])];let index=0;
      for(const alias of edge.bindings){spend();const definition=target(alias.target);check(definition&&targetPath(definition)===alias.targetSourcePath
        &&(alias.kind==='namespace'?modules.has(alias.target):alias.kind==='function'?functions.has(alias.target):alias.kind==='global'?globals.has(alias.target):alias.kind==='type'&&types.has(alias.target)),'module');
        check(alias.kind==='namespace'?alias.imported==='*'&&alias.target===edge.sourcePath&&alias.targetSourcePath===edge.sourcePath
          :modules.get(edge.sourcePath).exports.some(e=>e.name===alias.imported&&e.target===alias.target&&e.targetSourcePath===alias.targetSourcePath),'module');
        sourceRange(alias.range,g.text,edge.range);
        if(index++&&!star)parts.push(',');
        if(star){if(edge.kind==='import')parts.push(alias.nameRange);}else{parts.push(alias.range);g.sequence(alias.range,[alias.imported,...(alias.name===alias.imported?[]:['as',alias.name])]);}
        if(alias.localBinding!==null){check(edge.kind==='import'&&alias.nameRange&&alias.localBinding===originId(module.sourcePath,alias.nameRange),'identity');sourceRange(alias.nameRange,g.text,edge.range);
          g.name(alias.nameRange,alias.name);
          check(!scope.has(alias.name),'scope');scope.set(alias.name,alias.target);
          if(alias.kind==='namespace')for(const exported of modules.get(edge.sourcePath).exports){spend();scope.set(alias.name+'.'+exported.name,exported.target);}}
        else check(edge.kind!=='import'&&alias.nameRange===null,'module');
      }
      if(!star)parts.push('}');parts.push('from',quoted);g.sequence(edge.range,parts,true);
    }
    for(const host of p.hostImports){spend();if(!scope.has(host.name))scope.set(host.name,host.id);}
    let previous;
    for(const e of module.exports){spend();const definition=target(e.target);check(definition&&targetPath(definition)===e.targetSourcePath
      &&(!previous||byteOrder(previous,e.name)<0),'export');previous=e.name;sourceRange(e.range,g.text);
      const defining=grammars.get(e.targetSourcePath);sourceRange(e.definitionRange,defining.text);
      check(same(e.definitionRange,definition.declarationRange??definition.binding.declarationRange),'export');
      const within=p.functions.some(fn=>fn.sourcePath===module.sourcePath&&e.range.start>=fn.declarationRange.start&&e.range.end<=fn.declarationRange.end)
        ||p.types.some(type=>type.sourcePath===module.sourcePath&&['value','reference'].includes(type.kind)&&e.range.start>=type.declarationRange.start&&e.range.end<=type.declarationRange.end)
        ||module.initialization.some(row=>e.range.start>=row.range.start&&e.range.end<=row.range.end)
        ||module.imports.some(edge=>e.range.start>=edge.range.start&&e.range.end<=edge.range.end);
      if(!within)coverage.get(module.sourcePath).push(e.range);
    }
    coverage.get(module.sourcePath).push(...module.initialization.map(row=>{
      if(row.kind!=='initialize')return row.range;const at=g.indices(row.range);let start=at.first-1;
      if(g.tokens[start-1]?.text==='export')start--;
      return {start:g.tokens[start].start,end:g.tokens[at.end]?.text===';'?g.tokens[at.end].end:row.range.end};
    }));
  }
  for(const fn of p.functions)if(!fn.ownerType&&fn.lexicalParent===null){check(coverage.has(fn.sourcePath),'source');coverage.get(fn.sourcePath).push(fn.declarationRange);}
  for(const row of types.values())if(['value','reference'].includes(row.kind)) {
    const g=grammars.get(row.sourcePath);check(g&&row.nominalKey.sourcePath===row.sourcePath&&row.nominalKey.declarationPath.length===1,'type');
    g.name(row.nameRange,row.nominalKey.declarationPath[0]);coverage.get(row.sourcePath).push(row.declarationRange);
    for(const [index,field]of row.fields.entries()) {
      spend();const tokens=g.spelling(field.origin),prefix=[];let next=0;
      while(['public','private','protected','readonly','declare'].includes(tokens[next]))prefix.push(tokens[next++]);
      const all=g.tokens,bounds=g.indices(field.origin),name=all[bounds.first+next];g.name({start:name.start,end:name.end},field.name);
      check(field.id===sha256('tsfg.array-facts.field.v8\0'+canonical({sourcePath:row.sourcePath,nameRange:{start:name.start,end:name.end}})),'identity');
      commonSourceAccess(g,field.origin,{start:name.start,end:name.end},field.access);
      check(field.readonly===prefix.includes('readonly'),'permission');
      const colon=bounds.first+next+1;check(all[colon]?.text===':','source');const end=field.initializer?g.indices(field.initializer.range).first-1:bounds.end-(all[bounds.end-1].text===';'?1:0);
      if(field.initializer)check(all[end].text==='=','source');const annotationRange={start:all[colon+1].start,end:all[end-1].end};
      commonTypeSyntax(g,annotationRange,field.type,types,spend,p.typeAliases,visible.get(row.sourcePath));
      check(index===0||row.fields[index-1].origin.start<field.origin.start,'source');
    }
  }
  validateCommonLexical(p,grammars,types,coverage,spend,visible);
  validateCommonDeclarations(p,grammars,types,spend,visible);validateCommonBodies(p,sources,types,grammars,visible,spend);
  for(const [path,segments]of coverage)grammars.get(path).complete(segments);
  const tuples=roots=>roots.map(({kind,sourcePath,name})=>({kind,sourcePath,name}));
  const closure=normalizeClosure({roots:tuples(p.closure.roots),requiredRoots:tuples(p.closure.requiredRoots)});
  check(same(closure,{roots:tuples(p.closure.roots),requiredRoots:tuples(p.closure.requiredRoots)}),'closure');
  for(const roots of [p.closure.roots,p.closure.requiredRoots])for(const root of roots){spend();const module=modules.get(root.sourcePath);check(module,'closure');
    if(root.kind==='module-initialization')check(root.name==='$moduleInit'&&root.target===root.sourcePath&&same(root.range,{start:0,end:sources.get(root.sourcePath).content.length}),'closure');
    else {const fn=functions.get(root.target);check(fn&&fn.sourcePath===root.sourcePath&&fn.name===root.name&&same(root.range,fn.declarationRange),'closure');}}
  check(p.closure.requiredRoots.every(root=>p.closure.roots.some(candidate=>same(candidate,root))),'closure');
  const request={family:'tsfg.program-facts-request-candidate',version:2,schemaHash:format.schemaHash,input:{sourceRoot:p.sourceRoot,rootFile:p.rootFile,
    files:p.files.map(({path,content,sha256})=>({path,content,sha256})),declarations:p.declarations,config:p.config,target:p.target,compilationClosure:closure,hostImports:p.hostImports.map(({sourcePath,name,capabilityId,parameterTypes,returnType})=>({sourcePath,name,capabilityId,parameterTypes,returnType}))}};
  check(value.requestId===sha256('tsfg.program-facts.request.v2\0'+canonical(request)+'\n')
    &&value.packageId===sha256('tsfg.program-facts.package.v2\0'+format.schemaHash+'\0'+canonical(p)),'identity');
  const semantic=commonSemanticIdentities(p,spend);check(new Set(semantic.typeIds.values()).size===p.types.length,'identity','duplicate owned semantic TypeId');
  return own(value);
}
export function readCommonProgramFacts(bytes){return verifyCommonProgramFacts(commonJson(bytes));}
export function writeCommonProgramFacts(value){return Buffer.from(canonical(verifyCommonProgramFacts(value))+'\n');}
