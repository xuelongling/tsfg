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
import {validParameterPresence,annotationStates} from './presence.mjs';
import {commonSourceDescriptor as descriptor,commonSourceFormat as format,canonical,sha256,own,
  commonSourceDescriptorV3,commonSourceFormatV3,
  commonBudget,commonJson,commonCheck as check,commonSame as same,commonMeter} from './common-program-common.mjs';
export {commonSourceFormat} from './common-program-common.mjs';

function shape(value,name,spend,selectedDescriptor) {
  spend();if(name.startsWith('*')){if(value===null)return;return shape(value,name.slice(1),spend,selectedDescriptor);}
  if(name.startsWith('[]')){check(Array.isArray(value),'schema');spend(value.length);for(const child of value)shape(child,name.slice(2),spend,selectedDescriptor);return;}
  if(name==='string'){check(typeof value==='string'&&value.isWellFormed(),'schema');return;}
  if(name==='bool'){check(typeof value==='boolean','schema');return;}
  if(name==='int'||name==='int32'){check(Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0)&&(name!=='int32'||value<=2147483647),'schema');return;}
  const rule=selectedDescriptor.objects[name];check(rule&&value&&typeof value==='object'&&!Array.isArray(value),'schema');
  check(rule.required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>Object.hasOwn(rule.properties,key)),'schema');
  const group={arrayGenericExpression:'expressionKinds',arrayGenericTarget:'targetKinds',arrayGenericStatement:'statementKinds',arrayGenericType:'typeKinds'}[name];
  if(group){const selected=selectedDescriptor[group][value.kind];check(selected,'kind');
    const optional=name==='arrayGenericExpression'?['compatibilityRoots',...(value.kind==='numericLiteral'?['decimal','bits']:[]),...(value.kind==='call'?['receiver']:[]),...(value.kind==='stringConcat'?['operator']:[])]
      :name==='arrayGenericType'&&['value','reference'].includes(value.kind)?['markerOrigin','base','methods']
      :name==='arrayGenericStatement'?(value.kind==='return'?['value']:value.kind==='try'?['catchClause','finallyBlock']:value.kind==='varDeclaration'?['annotationRange','initializer']:[]):[];
    check(selected.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>rule.required.includes(key)||selected.includes(key)||optional.includes(key)),'schema');}
  for(const [key,child]of Object.entries(value))shape(child,rule.properties[key],spend,selectedDescriptor);
}

// Bridge only parameter facts, after the legacy snapshot's ordinary function
// and the Common function's bindings/expressions have been projected by their
// owners. Retain their original anchors; this is not another frontend parser
// or an admission path for a partial Common package.
export function bridgeCommonProgramOrdinaryParameters(original,fn,source,initializers,types,spend) {
  spend(Math.ceil((source.path.length+fn.sourcePath.length+original.name.length+fn.name.length)/8)+1);
  spend();check(!fn.ownerType&&fn.lexicalParent===null&&!original.ownerType&&!original.lexicalParent
    &&source.path===fn.sourcePath&&original.name===fn.name
    &&same(original.range,fn.declarationRange)&&original.parameters.length===fn.parameters.length
    &&fn.parameters.length<=64&&original.parameterInitializers.length===fn.parameters.length
    &&initializers.length===fn.parameters.length,'parameter-initialization');
  sourceRange(fn.declarationRange,source.content);
  let minimum=0;
  spend(fn.parameters.length);
  const steps=fn.parameters.map((parameter,index)=>{
    spend();const input=original.parameters[index],initializer=original.parameterInitializers[index],converted=initializers[index],presence=input.presence;
    // Presence guards slice/strip the parameter pieces and parse the annotation
    // twice. Reserve those text passes before either guard touches the source.
    spend(Math.ceil((6*(presence.range.end-presence.range.start)+12*(presence.annotation.end-presence.annotation.start))/8)+1);
    // originId serializes an escaped path (at most six units per input unit)
    // and hashes that preimage; the fixed span/key material is bounded here.
    spend(Math.ceil((12*fn.sourcePath.length+512)/8)+1);
    check(validParameterPresence(presence,input,initializer,source.content,original.range)
      &&parameter.kind==='parameter'&&parameter.lexicalOwner===fn.id&&parameter.writable===input.writable
      &&parameter.name===input.name&&same(parameter.nameRange,input.range)
      &&same(parameter.declarationRange,presence.range)&&same(parameter.annotationRange,presence.annotation)
      &&parameter.id===originId(fn.sourcePath,input.range)&&Boolean(initializer)===Boolean(converted),'parameter-initialization');
    const states=annotationStates(presence,source.content);
    const memberCount=1+Number(Boolean(states&2||presence.optional&&!presence.default))+Number(Boolean(states&4));
    spend(memberCount+Math.ceil((input.type.length+28)/8)+1);
    const members=[input.type,...(states&2||presence.optional&&!presence.default?['undefined']:[]),...(states&4?['null']:[])];
    members.sort((a,b)=>{spend(Math.ceil((a.length+b.length)/8)+1);return a<b?-1:a>b?1:0;});
    const declared=members.length===1?members[0]:'union<'+members.join(',')+'>';
    check(types.has(declared)&&parameter.declaredType===declared,'parameter-initialization');
    // Pay spreads, Set insertion, the result array and joined type text before
    // native collection operations; comparisons pay their actual string widths.
    spend(3*(members.length+Number(presence.default))+Math.ceil((input.type.length+37)/8)+1);
    const argument=[...new Set([...members,...(presence.default?['undefined']:[])])];
    argument.sort((a,b)=>{spend(Math.ceil((a.length+b.length)/8)+1);return a<b?-1:a>b?1:0;});
    const argumentType=argument.length===1?argument[0]:'union<'+argument.join(',')+'>';
    check(types.has(argumentType),'parameter-initialization');
    if(!presence.optional)minimum=index+1;
    if(converted){
      // The existing JSON walker prepays nodes, keys and text before shape's
      // string scans. It also bounds the complete initializer tree.
      commonBudget(converted,units=>spend(2*units));
      shape(converted,'arrayGenericExpression',spend,commonSourceDescriptorV3);
      check(same(converted.range,initializer.range),'parameter-initialization');}
    spend(3+Math.ceil(parameter.id.length/8)+1);
    return {binding:parameter.id,range:{...parameter.declarationRange},argumentType,...(converted?{initializer:converted}:{})};
  });
  // Required-only functions keep their established Source2/3 representation.
  spend(original.parameters.length);
  if(!original.parameters.some(parameter=>parameter.presence.optional))return undefined;
  spend(steps.length);
  const result={minimumArgumentCount:minimum,hasParameterExpressions:steps.some(step=>step.initializer),steps};
  // Charge the complete record for this walk, structuredClone and freeze before
  // own() starts either copying or recursively visiting the returned tree.
  commonBudget(result,units=>spend(3*units));
  return own(result);
}

// This directory is checked before callers select any incoming argument type.
// '?' is evidence for omission; undefined union membership alone never is.
export function validateCommonParameterInitialization(payload,sources,types,version,spend) {
  spend(payload.functions.length+payload.types.length);const grammars=new Map();
  for(const fn of payload.functions){
    const initialization=fn.parameterInitialization;
    check(initialization===undefined||version===3&&!fn.ownerType&&fn.lexicalParent===null,'parameter-initialization');
    if(initialization===undefined)continue;
    check(initialization,'parameter-initialization');
    const steps=initialization.steps,source=sources.get(fn.sourcePath);check(source,'parameter-initialization');
    if(!grammars.has(fn.sourcePath))grammars.set(fn.sourcePath,commonSourceGrammar(source,spend));
    const g=grammars.get(fn.sourcePath);
    spend(steps.length+fn.parameters.length);
    check(steps.length===fn.parameters.length&&initialization.hasParameterExpressions===steps.some(step=>step.initializer),'parameter-initialization');
    let minimum=0,hasOptionalOrDefault=false;
    for(const [index,step]of steps.entries()){
      spend();const parameter=fn.parameters[index];
      check(step.binding===parameter.id&&same(step.range,parameter.declarationRange)&&parameter.annotationRange,'parameter-initialization');
      const name=g.indices(parameter.nameRange),annotation=g.indices(parameter.annotationRange);
      const optional=g.tokens[name.end]?.text==='?';
      check(annotation.first===name.end+(optional?2:1)&&g.tokens[annotation.first-1].text===':', 'parameter-initialization');
      check(!optional||!step.initializer,'parameter-initialization');
      if(step.initializer){const initializer=g.indices(step.initializer.range);
        check(g.tokens[annotation.end]?.text==='='&&initializer.first===annotation.end+1,'parameter-initialization');}
      hasOptionalOrDefault||=optional||Boolean(step.initializer);
      const declared=types.get(parameter.declaredType);check(declared,'parameter-initialization');
      const members=declared.kind==='union'?declared.members:[declared.id];spend(members.length*3+1);
      check(!optional||members.includes('undefined'),'parameter-initialization');
      const argument=step.initializer?[...new Set([...members,'undefined'])].sort((a,b)=>{spend(Math.ceil((a.length+b.length)/8)+1);return a<b?-1:a>b?1:0;}):members;
      check(types.has(step.argumentType)&&step.argumentType===(argument.length===1?argument[0]:'union<'+argument.join(',')+'>'),'parameter-initialization');
      if(!optional&&!step.initializer)minimum=index+1;
    }
    check(initialization.minimumArgumentCount===minimum&&hasOptionalOrDefault,'parameter-initialization');
  }
  for(const type of payload.types){
    if(type.construction)check(version===3?type.construction.signature.minimumArgumentCount!==undefined:type.construction.signature.minimumArgumentCount===undefined,'parameter-initialization');
    const fn=type.constructor;if(!fn)continue;
    check(version===3?Boolean(fn.parameterInitialization):fn.parameterInitialization===undefined,'parameter-initialization');
    if(!fn.parameterInitialization)continue;
    const initialization=fn.parameterInitialization,steps=initialization.steps;
    check(fn.ownerType===type.id&&fn.name==='constructor','parameter-initialization');
    spend(steps.length+fn.parameters.length);
    check(steps.length===fn.parameters.length&&initialization.hasParameterExpressions===steps.some(step=>step.initializer),'parameter-initialization');
    let minimum=0;
    for(const [index,step]of steps.entries()){
      spend();const parameter=fn.parameters[index];
      check(step.binding===parameter.id&&same(step.range,parameter.declarationRange),'parameter-initialization');
      const declared=types.get(parameter.declaredType);check(declared,'parameter-initialization');
      const members=declared.kind==='union'?declared.members:[declared.id];spend(members.length*3+1);
      const argument=step.initializer?[...new Set([...members,'undefined'])].sort((a,b)=>{spend(Math.ceil((a.length+b.length)/8)+1);return a<b?-1:a>b?1:0;}):members;
      check(types.has(step.argumentType)&&step.argumentType===(argument.length===1?argument[0]:'union<'+argument.join(',')+'>'),'parameter-initialization');
      if(!step.initializer)minimum=index+1;
    }
    check(initialization.minimumArgumentCount===minimum&&type.construction.signature.minimumArgumentCount===minimum,'parameter-initialization');
  }
}

export function verifyCommonProgramFacts(value) {
  commonBudget(value);const spend=commonMeter(),selected=value?.version===3?commonSourceFormatV3:format;
  shape(value,'commonProgramPackage',spend,value?.version===3?commonSourceDescriptorV3:descriptor);
  check(value.family===selected.family&&value.version===selected.version&&value.schemaHash===selected.schemaHash,'identity');
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
  const types=validateTypedArrayTypes(p,sources);
  // Own the complete constructor directory before any caller can select an
  // ordinal raw argument type. Expression checks below consume these rows.
  validateCommonParameterInitialization(p,sources,types,selected.version,spend);
  validateTypedArrayDeclarations(p,sources);validateCommonHostDeclarations(p,sources,types,spend);
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
      if(field.initializer)check(all[end].text==='=','source');const annotationRange=field.parameterBinding?row.constructor.parameters.find(parameter=>parameter.id===field.parameterBinding).annotationRange:{start:all[colon+1].start,end:all[end-1].end};
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
  const request={family:'tsfg.program-facts-request-candidate',version:selected.version,schemaHash:selected.schemaHash,input:{sourceRoot:p.sourceRoot,rootFile:p.rootFile,
    files:p.files.map(({path,content,sha256})=>({path,content,sha256})),declarations:p.declarations,config:p.config,target:p.target,compilationClosure:closure,hostImports:p.hostImports.map(({sourcePath,name,capabilityId,parameterTypes,returnType})=>({sourcePath,name,capabilityId,parameterTypes,returnType}))}};
  check(value.requestId===sha256('tsfg.program-facts.request.v'+selected.version+'\0'+canonical(request)+'\n')
    &&value.packageId===sha256('tsfg.program-facts.package.v'+selected.version+'\0'+selected.schemaHash+'\0'+canonical(p)),'identity');
  const semantic=commonSemanticIdentities(p,spend);check(new Set(semantic.typeIds.values()).size===p.types.length,'identity','duplicate owned semantic TypeId');
  return own(value);
}
export function readCommonProgramFacts(bytes){return verifyCommonProgramFacts(commonJson(bytes));}
export function writeCommonProgramFacts(value){return Buffer.from(canonical(verifyCommonProgramFacts(value))+'\n');}
