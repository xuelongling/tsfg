// SPDX-License-Identifier: MIT
// Stable declarations and the fixed graph's interpretation archive are distinct.
// First publication may archive verified HIR definitions. Consumption never
// fills a missing definition from a new implementation's body inventory.
import {canonical,sha256,own,commonMeter,commonCheck as check} from './common-program-common.mjs';
import {scalarTypeIds} from './identity.mjs';
import {commonReturnOriginScopeDirectories} from './common-program-return-origin-scope.mjs';
import {commonValidateFixedStorage} from './common-program-fixed-storage.mjs';

const bill=(value,spend)=>{const pending=[value];while(pending.length){spend();const row=pending.pop();
  if(typeof row==='string')spend(Math.ceil(row.length/8)+1);
  else if(Array.isArray(row)){spend(row.length);for(const child of row)pending.push(child);}
  else if(row!==null&&typeof row==='object')for(const name in row){spend(Math.ceil(name.length/8)+1);pending.push(row[name]);}
}};
const encoded=(value,spend)=>{bill(value,spend);return canonical(value);};
const same=(a,b,spend)=>encoded(a,spend)===encoded(b,spend);
const ids=(values,spend)=>{spend(values.size+1);const result=Array.from(values);result.sort((a,b)=>{spend(Math.ceil((a.length+b.length)/8)+1);return a<b?-1:a>b?1:0;});return result;};
const exact=(value,names,spend)=>{
  spend(names.length+1);check(value!==null&&typeof value==='object'&&!Array.isArray(value),'publication-scope');let count=0;
  for(const name in value){spend(Math.ceil(name.length/8)+names.length+1);check(Object.hasOwn(value,name)&&names.includes(name),'publication-scope');count++;}
  check(count===names.length,'publication-scope');for(const name of names){spend();check(Object.hasOwn(value,name),'publication-scope');}
};
const closure=(types,roots,spend)=>{
  spend(roots.size+1);const pending=Array.from(roots),seen=new Set();
  while(pending.length){spend();const id=pending.pop();if(seen.has(id))continue;seen.add(id);const type=types.get(id);check(type,'publication-scope-type','fixed interpretation type is absent');
    if(type.base)pending.push(type.base);if(type.elementType)pending.push(type.elementType);
    for(const id of type.members??[]){spend();pending.push(id);}for(const field of type.fields??[]){spend();pending.push(field.type);}
    if(type.kind==='function'){spend(type.parameters.length+1);for(const id of type.parameters)pending.push(id);pending.push(type.returnType);}
    for(const id of type.construction?.signature.parameters??[]){spend();pending.push(id);}
  }return seen;
};
const rows=(types,selected,spend)=>{const result=[];for(const id of ids(selected,spend)){spend();const type=types.get(id);result.push({id,label:type.semanticLabel,shape:type.semanticShape});}return result;};

// hir is already admitted by the HIR reader. This is a declaration projection,
// not another HIR validator and not a body/physical-capacity inference pass.
export function commonProgramPublicationScope(hir,spend=commonMeter()) {
  spend(hir.types.length+hir.globals.length+hir.functions.length+hir.environments.length+1);
  const types=new Map(),roots=new Set(),captureKeys=new Map();
  for(const type of hir.types){spend();types.set(type.id,type);if(type.kind==='value'||type.kind==='reference')roots.add(type.id);}
  for(const global of hir.globals){spend();roots.add(global.type);}
  for(const fn of hir.functions){spend(fn.parameters.length+2);roots.add(fn.returnType);if(fn.ownerType)roots.add(fn.ownerType);for(const parameter of fn.parameters)roots.add(parameter.type);
    for(const step of fn.parameterInitialization?.steps??[]){spend();roots.add(step.argumentType);}}
  for(const env of hir.environments)for(const slot of env.slots){spend();roots.add(slot.type);captureKeys.set(slot.binding,slot.key);}
  const selected=closure(types,roots,spend),declarationTypes=ids(selected,spend);
  const binding=alias=>({kind:alias.kind,name:alias.name,imported:alias.imported,target:alias.target,targetSourcePath:alias.targetSourcePath});
  const root=({kind,sourcePath,name,target})=>({kind,sourcePath,name,target});
  spend(hir.hostImports.length+hir.functions.length+hir.environments.length+hir.globals.length+hir.modules.length+hir.closure.roots.length+hir.closure.requiredRoots.length+1);
  return {profile:'common-program-fixed-v3',rootFile:hir.rootFile,declarationTypes,types:rows(types,selected,spend),
    hostImports:hir.hostImports.map(({id,sourcePath,name,capabilityId,signatureHash,parameterTypes,returnType})=>{spend(parameterTypes.length+1);return {id,sourcePath,name,capabilityId,signatureHash,parameterTypes,returnType};}),
    hostContext:hir.hostContext?{contractDigest:hir.hostContext.contract.digest,buildIdentityDigest:hir.hostContext.identity.buildIdentity.digest}:null,
    functions:hir.functions.map(fn=>{spend(fn.parameters.length+fn.captures.length+2);const parameterTypes=fn.ownerType?[fn.ownerType]:[];for(const p of fn.parameters)parameterTypes.push(p.type);
      const captures=fn.captures.map(row=>captureKeys.get(row.binding));captures.sort((a,b)=>{spend(Math.ceil((a.length+b.length)/8)+1);return a<b?-1:a>b?1:0;});
      return {captures,lexicalParent:fn.lexicalParent,lexicalEnvironment:fn.lexicalEnvironment,activationEnvironment:fn.activationEnvironment,functionId:fn.id,declKey:fn.declKey,kind:fn.kind,access:fn.access,signatureHash:fn.signatureHash,parameterTypes,returnType:fn.returnType};}),
    environments:hir.environments.map(env=>{spend(env.slots.length+1);return {id:env.id,owner:env.owner,parent:env.parent,slots:env.slots.map(({key,type,writable,kind})=>({key,type,writable,kind}))};}),
    globals:hir.globals.map(row=>({globalId:row.id,declKey:row.declKey,type:row.type,writable:row.writable})),
    modules:hir.modules.map(row=>{spend(row.imports.length+row.exports.length+1);return {id:row.id,sourcePath:row.sourcePath,external:row.external,dependencies:row.dependencies,initializer:row.initializer,
      imports:row.imports.map(edge=>{spend(edge.bindings.length+1);return {kind:edge.kind,specifier:edge.specifier,sourcePath:edge.sourcePath,bindings:edge.bindings.map(binding)};}),
      exports:row.exports.map(({name,kind,target,targetSourcePath})=>({name,kind,target,targetSourcePath})),globals:row.globals};}),
    roots:{roots:hir.closure.roots.map(root),requiredRoots:hir.closure.requiredRoots.map(root)}};
}

// Explicit first publication only. storage is a supplied, checked fixed table;
// this does not invent actual-tag bounds from Source views or current samples.
export function commonFixedPublicationScope(hir,fixedUppers,storage,spend) {
  const declaration=commonProgramPublicationScope(hir,spend);spend(hir.types.length+declaration.declarationTypes.length+1);
  const types=new Map(hir.types.map(type=>[type.id,type])),roots=new Set(declaration.declarationTypes);
  spend(hir.environments.length);const environments=new Set(hir.environments.map(env=>'env:'+env.id));
  for(const upper of fixedUppers.values()){
    if(upper.returnOrigins===null)continue;
    for(const node of upper.returnOrigins.nodes){spend();if(node.type!==null)roots.add(node.type);if(node.view!==undefined)roots.add(node.view);}
    for(const heap of upper.returnOrigins.heaps){spend();if(heap.kind==='store'){
      if(heap.view.startsWith('env:'))check(heap.selector.startsWith('capture:')&&environments.has(heap.view),'publication-scope-environment','capture storage needs its admitted environment layout');
      else roots.add(heap.view);
    }}
  }
  for(const field of storage.fields)for(const type of field.actualTypes){spend();roots.add(type);}
  for(const result of storage.results){spend();roots.add(result.newTarget);for(const type of result.actualTypes){spend();roots.add(type);}}
  const scope={...declaration,types:rows(types,closure(types,roots,spend),spend),storage};bill(scope,spend);return own(scope);
}

export function commonVerifyPublicationScope(hir,scope,spend) {
  exact(scope,['profile','rootFile','declarationTypes','types','hostImports','hostContext','functions','environments','globals','modules','roots','storage'],spend);
  commonValidateFixedStorage(hir,scope.storage,spend);
  const declaration=commonProgramPublicationScope(hir,spend);spend(hir.types.length+1);const current=new Map(hir.types.map(type=>[type.id,type]));
  check(Array.isArray(scope.declarationTypes)&&Array.isArray(scope.types),'publication-scope');spend(scope.declarationTypes.length+scope.types.length+1);
  const declared=new Set(),byId=new Map(),byLabel=new Map(),declarationRows=[];let previousDeclaration=null;
  for(const id of scope.declarationTypes){spend();check(typeof id==='string','publication-scope');spend(Math.ceil(id.length/8)+1);
    check(previousDeclaration===null||previousDeclaration<id,'publication-scope');previousDeclaration=id;declared.add(id);}
  let previous=null;
  for(const row of scope.types){spend();exact(row,['id','label','shape'],spend);check(typeof row.id==='string'&&typeof row.label==='string','publication-scope');
    spend(Math.ceil((row.id.length+row.label.length)/8)+1);
    if(previous!==null){spend(Math.ceil((previous.length+row.id.length)/8)+1);check(previous<row.id,'publication-scope');}previous=row.id;
    check(!byLabel.has(row.label),'publication-scope');byId.set(row.id,row);byLabel.set(row.label,row);if(declared.has(row.id))declarationRows.push(row);
    const known=current.get(row.id);if(known)check(same(row.label,known.semanticLabel,spend)&&same(row.shape,known.semanticShape,spend),'publication-scope','type interpretation differs from admitted HIR');
  }
  // Compare declarations only. A removed private body type remains available
  // in the fixed archive and is deliberately absent from this projection.
  const projected={...scope,types:declarationRows};delete projected.storage;
  check(same(projected,declaration,spend),'publication-scope','stable declaration projection differs');
  const scalarLabels=new Map();for(const [name,id]of Object.entries(scalarTypeIds)){spend(name.length+3);scalarLabels.set(canonical({kind:'scalar',name}),id);}
  const children=shape=>{
    const result=[];if(shape.base)result.push(shape.base);if(shape.elementType)result.push(shape.elementType);
    for(const label of shape.members??[]){spend();result.push(label);}for(const field of shape.fields??[]){spend();result.push(field.type);}
    for(const method of shape.methods??[]){spend(method.parameters.length+1);for(const label of method.parameters)result.push(label);result.push(method.returnType);}
    for(const label of shape.construction?.parameters??[]){spend();result.push(label);}
    if(shape.kind==='function'){spend(shape.parameters.length+1);for(const label of shape.parameters)result.push(label);result.push(shape.returnType);}return result;
  };
  // Unknown archived shapes are validated once here, before the typed child
  // dependency walk. Known shapes already matched the admitted HIR exactly.
  for(const row of scope.types){spend();if(current.has(row.id))continue;
    check(row.shape!==null&&typeof row.shape==='object'&&!Array.isArray(row.shape),'publication-scope');const shape=row.shape;
    check(typeof shape.kind==='string'&&typeof shape.label==='string'&&same(shape.label,row.label,spend),'publication-scope');
    if(['scalar','string','unknown','undefined','null','void'].includes(shape.kind))exact(shape,['label','kind'],spend);
    else{
      check(['array','readSpan','function','union'].includes(shape.kind),'publication-scope','archive cannot introduce an undeclared nominal type');
      exact(shape,shape.kind==='function'?['label','kind','parameters','returnType']:shape.kind==='union'?['label','kind','members']:['label','kind','elementType'],spend);
      if(shape.kind==='function')check(Array.isArray(shape.parameters)&&typeof shape.returnType==='string','publication-scope');
      else if(shape.kind==='union')check(Array.isArray(shape.members),'publication-scope');
      else check(typeof shape.elementType==='string','publication-scope');
      for(const label of shape.kind==='function'?shape.parameters:shape.kind==='union'?shape.members:[]){spend();check(typeof label==='string','publication-scope');}
    }
  }
  // Even a type also present in the current body must be interpreted entirely
  // from this archive. Its dependencies cannot be borrowed from that body.
  for(const row of scope.types)for(const label of children(row.shape)){spend();check(typeof label==='string','publication-scope');spend(Math.ceil(label.length/8)+1);
    check(byLabel.has(label),'publication-scope','archive semantic dependency is absent');}
  // Storage row shape/ownership/coverage is the storage boundary's obligation.
  // Here each supplied finite tag must at least have a fixed interpretation.
  for(const row of scope.storage.fields)for(const id of row.actualTypes){spend();check(byId.has(id),'publication-scope','storage tag interpretation is absent');}
  for(const row of scope.storage.results){spend();check(byId.has(row.newTarget),'publication-scope');for(const id of row.actualTypes){spend();check(byId.has(id),'publication-scope','storage tag interpretation is absent');}}
  for(const row of scope.types){spend();if(current.has(row.id))continue;check(!declared.has(row.id),'publication-scope');
    const shape=row.shape;let expected;
    if(shape.kind==='scalar'){spend(Math.ceil(row.label.length/8)+1);expected=scalarLabels.get(row.label);}
    else if(['string','unknown','undefined','null','void'].includes(shape.kind)){
      check(same(row.label,encoded({kind:shape.kind,name:shape.kind},spend),spend),'publication-scope','archived primitive label differs');
      expected=sha256('tsfg.type\0'+shape.kind);}
    else{
      const label=shape.kind==='function'?{kind:shape.kind,parameters:shape.parameters,returnType:shape.returnType}:shape.kind==='union'?{kind:shape.kind,members:shape.members}:{kind:shape.kind,element:shape.elementType};
      check(same(row.label,encoded(label,spend),spend),'publication-scope');
      const seen=new Set(),pending=[row.label],graph=[];
      while(pending.length){spend();const label=pending.pop();check(typeof label==='string','publication-scope');spend(Math.ceil(label.length/8)+1);if(seen.has(label))continue;seen.add(label);const member=byLabel.get(label);check(member,'publication-scope','archive semantic dependency is absent');
        graph.push(member.shape);for(const child of children(member.shape))pending.push(child);}
      graph.sort((a,b)=>{spend(Math.ceil((a.label.length+b.label.length)/8)+1);return a.label<b.label?-1:a.label>b.label?1:0;});
      expected=sha256('tsfg.common-program.type.v1\0'+encoded({root:row.label,graph},spend));
    }
    check(expected===row.id,'publication-scope','archived type semantic identity differs');
  }
  const directory=commonReturnOriginScopeDirectories(scope,spend);spend(scope.types.length+1);const kinds=new Map();
  for(const row of scope.types){spend();kinds.set(row.id,row.shape.kind);}
  // Kind is semantic interpretation only. In particular a value kind does
  // NOT manufacture a complete physical field list or M12 storage authority.
  const typeKind=id=>{spend(Math.ceil(id.length/8)+1);return kinds.get(id)??null;};
  return {...directory,typeKind};
}
