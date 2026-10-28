// SPDX-License-Identifier: MIT
// Complete common-body lexical ownership. The v8 type/constructor/witness
// algorithms remain shared; globals and EH have one common lexical environment.
import {canonical,sha256,integerNames,integerRange} from './identity.mjs';
import {identifierName,staticBindingName} from './module-facts.mjs';
import {floatBits} from './float.mjs';
import {typedArrayInteger,typedArrayStringUnits} from './typed-array-literals.mjs';
import {originId,signatureId,sourceRange} from './typed-array-schema.mjs';
import {typedArrayRelations} from './typed-array-relations.mjs';
import {validateTypedArrayConstruction} from './typed-array-construction.mjs';
import {commonTypeSyntax,commonSourceAccess,commonCallableNameRange} from './common-program-source.mjs';
import {commonCheck as check,commonSame as same} from './common-program-common.mjs';
import {commonCollections} from './common-program-budget.mjs';
import {validateCommonEntryRoots} from './common-program-entry.mjs';

export function validateCommonBodies(payload,sources,types,grammars,visibility,spend) {
  const collections=commonCollections(spend);
  const hosts=new Map(payload.hostImports.map(row=>[row.id,row]));
  const functions=new Map(),bindings=new Map(),globals=new Map(payload.globals.map(row=>[row.binding.id,row])),signatureOrigins=new Map();
  function registerOrigin(path,range,type) {
    spend();const key=signatureId(path,range),previous=signatureOrigins.get(key);
    check(previous===undefined||previous===type,'signature','original signature has inconsistent concrete type');signatureOrigins.set(key,type);
  }
  function typeAnnotation(path,range,type) {
    const g=grammars.get(path);check(g,'source');
    for(const origin of commonTypeSyntax(g,range,type,types,spend,payload.typeAliases,visibility.get(path)))registerOrigin(path,origin.range,origin.type);
  }
  for(const alias of payload.typeAliases){spend();typeAnnotation(alias.sourcePath,alias.annotationRange,alias.type);}
  for(const fn of [...payload.functions,...payload.types.flatMap(row=>row.constructor?[row.constructor]:[])]) {
    spend();check(!functions.has(fn.id)&&types.has(fn.returnType),'function');functions.set(fn.id,fn);
    const source=sources.get(fn.sourcePath),g=grammars.get(fn.sourcePath);check(source&&g,'source');
    const nameRange=commonCallableNameRange(g,fn,types);
    sourceRange(fn.declarationRange,source.content);g.name(nameRange,fn.name);
    check(fn.id===sha256('tsfg.array-facts.function.v8\0'+canonical({sourcePath:fn.sourcePath,declarationRange:fn.declarationRange})),'identity');
    commonSourceAccess(g,fn.declarationRange,nameRange,fn.access);
    if(!fn.ownerType)check(fn.access==='public','permission');
    if(fn.ownerType)check(['value','reference'].includes(types.get(fn.ownerType)?.kind),'function');
    if(fn.returnAnnotationRange)typeAnnotation(fn.sourcePath,fn.returnAnnotationRange,fn.returnType);
    if(!fn.ownerType){spend(fn.parameters.length);registerOrigin(fn.sourcePath,fn.declarationRange,
      sha256('tsfg.program.function-type.v2\0'+canonical({parameters:fn.parameters.map(p=>p.declaredType),returnType:fn.returnType})));}
    for(const row of [...fn.parameters,...fn.bindings])binding(row,fn.sourcePath,fn.declarationRange);
  }
  function binding(row,path,parent) {
    spend();const source=sources.get(path),g=grammars.get(path);check(source&&g&&types.has(row.declaredType),'binding');
    sourceRange(row.declarationRange,source.content,parent);sourceRange(row.nameRange,source.content,row.declarationRange);
    g.name(row.nameRange,row.name);check(row.id===originId(path,row.nameRange),'identity');
    check(!bindings.has(row.id),'binding');bindings.set(row.id,{row,path});
    if(row.annotationRange)typeAnnotation(path,row.annotationRange,row.declaredType);
    if(row.elementAnnotationRange)sourceRange(row.elementAnnotationRange,source.content,row.annotationRange??row.declarationRange);
  }
  for(const row of payload.globals)binding(row.binding,row.sourcePath,{start:0,end:sources.get(row.sourcePath)?.content.length});
  for(const owner of types.values()){spend();for(const field of owner.fields??[]){
    spend();const g=grammars.get(owner.sourcePath),at=g.indices(field.origin);let colon=at.first;
    while(['public','private','protected','readonly','declare'].includes(g.tokens[colon].text)){spend();colon++;}colon++;
    check(g.tokens[colon]?.text===':','source');const end=field.initializer?g.indices(field.initializer.range).first-1:at.end-(g.tokens[at.end-1].text===';'?1:0);
    typeAnnotation(owner.sourcePath,{start:g.tokens[colon+1].start,end:g.tokens[end-1].end},field.type);
  }}
  const relations=typedArrayRelations(types,functions,payload.compatibilityWitnesses);
  validateTypedArrayConstruction(payload,types,sources);
  const descendants=(actual,expected)=>{const seen=new Set();while(actual){spend();check(!seen.has(actual),'type');seen.add(actual);
    if(actual===expected)return true;actual=types.get(actual)?.base;}return false;};
  function field(id,receiver,fn,write) {
    let owner=types.get(receiver.flowType),found;const seen=new Set();
    while(owner){spend();check(!seen.has(owner.id),'type');seen.add(owner.id);found=owner.fields?.find(row=>row.id===id);if(found)break;owner=types.get(owner.base);}
    check(found&&['reference','value'].includes(owner.kind),'field');
    check(found.access==='public'||found.access==='private'&&fn.ownerType===owner.id
      ||found.access==='protected'&&descendants(fn.ownerType,owner.id),'permission');
    if(write)check(!found.readonly||fn.ownerType===owner.id&&types.get(owner.id).constructor?.id===fn.id&&receiver.kind==='thisReference','permission');
    return found;
  }
  function functionBody(fn,bodyRange,initial=[],initialScope=undefined) {
    const g=grammars.get(fn.sourcePath),inventory=new Map(),declared=new Set();spend(fn.parameters.length+fn.bindings.length);
    for(const group of [fn.parameters,fn.bindings])for(const row of group)inventory.set(row.id,row);
    spend(fn.parameters.length);for(const row of fn.parameters)declared.add(row.id);const seenDeclarations=collections.set(declared);
    const scope=collections.map(initialScope??visibility.get(fn.sourcePath)),captureObserved=new Map();
    let ancestor=functions.get(fn.lexicalParent);const ancestors=[];while(ancestor){spend();ancestors.push(ancestor);ancestor=functions.get(ancestor.lexicalParent);}
    for(let i=ancestors.length-1;i>=0;i--){const owner=ancestors[i];for(const b of owner.parameters){spend();scope.set(b.name,b.id);}
      for(const row of owner.body){spend();if(['constDeclaration','letDeclaration'].includes(row.kind)){const b=bindings.get(row.binding)?.row;check(b,'binding');scope.set(b.name,b.id);}else if(row.kind==='functionDeclaration'){const child=functions.get(row.functionId);check(child,'lexical');scope.set(child.name,child.id);}}}
    for(const candidate of functions.values()){spend();if(candidate.lexicalParent===fn.id)scope.set(candidate.name,candidate.id);}
    for(const p of fn.parameters){check(p.kind==='parameter'&&!scope.has(p.name)||p.kind==='parameter','binding');scope.set(p.name,p.id);}
    const text=range=>g.slice(range),type=id=>{check(types.has(id),'type');return types.get(id);};
    const annotation=(row,init=null)=>{
      const pieces=[row.nameRange,...(row.annotationRange?[':',row.annotationRange]:[]),...(init?['=',init.range]:[])];
      g.sequence(row.declarationRange,pieces);
    };
    function expr(value,parent=fn.declarationRange,target=false,expected=undefined,local=scope,readTarget=false) {
      spend();sourceRange(value.range,g.text,parent);type(value.type);if(!target)type(value.flowType);
      if(!target){
        // Common Source has an explicit unknown view. The assertion remains a
        // pure view; any surrounding slot relation still uses the old verifier.
        const unknownAssertion=value.kind==='as'&&(type(value.expression.flowType).kind==='unknown'||type(value.flowType).kind==='unknown');
        if(unknownAssertion){check(value.type===value.flowType,'flow');
          relations.expression({flowType:value.flowType,...(value.compatibilityRoots?{compatibilityRoots:value.compatibilityRoots}:{})},expected,{source:fn.sourcePath,...value.range});
        }else relations.expression(value,expected,{source:fn.sourcePath,...value.range});
      }
      const sequence=pieces=>g.sequence(value.range,pieces);
      const child=(v,write=false,wanted=undefined,read=false)=>expr(v,value.range,write,wanted,local,read);
      const scalar=type(value.type).kind==='scalar';
      if(!target&&['scalar','string','undefined','null','void'].includes(type(value.type).kind))check(value.flowType===value.type,'flow');
      if(['bindingReference','bindingTarget'].includes(value.kind)) {
        const entry=inventory.get(value.binding)??globals.get(value.binding)?.binding??bindings.get(value.binding)?.row;
        const spelling=staticBindingName(text(value.range));check(entry&&local.get(spelling)===value.binding&&entry.declaredType===value.type,'binding');
        if(!globals.has(value.binding)&&!inventory.has(value.binding)){
          const owner=functions.get(entry.lexicalOwner),kind=type(entry.declaredType).kind;
          check(ancestors.some(owner=>{spend();return owner.id===entry.lexicalOwner;}),'capture');
          const initialized=entry.kind==='local'&&['scalar','string','readSpan','array','function','reference'].includes(kind)&&owner.body.some(row=>{spend();return ['constDeclaration','letDeclaration'].includes(row.kind)&&row.binding===entry.id&&row.initializer;});
          const parameter=entry.kind==='parameter'&&['scalar','string','readSpan','array','function','reference'].includes(kind)&&owner.parameters.some(row=>{spend();return row.id===entry.id;});
          check(initialized||parameter,'capture');
          if(!captureObserved.has(entry.id))captureObserved.set(entry.id,[]);captureObserved.get(entry.id).push({range:{...value.range},read:!target||readTarget,write:target});
        }else if(!globals.has(value.binding))check(declared.has(value.binding),'binding');if(target)check(entry.writable,'permission');return;
      }
      if(value.kind==='functionReference'){const callee=functions.get(value.functionId),shape=type(value.type);
        check(callee&&!callee.ownerType&&shape.kind==='function'&&same(shape.parameters,callee.parameters.map(p=>p.declaredType))&&shape.returnType===callee.returnType&&value.flowType===value.type,'function-reference');
        check(local.get(staticBindingName(text(value.range)))===callee.id,'scope');return;}
      if(value.kind==='indirectCall'){const callee=type(value.expression.flowType),signature=value.signature;check(callee.kind==='function'&&same(value.calleeRange,value.expression.range),'indirect-call');
        check(signature&&signature.id===signatureId(signature.sourcePath,signature.declarationRange)&&same(signature.parameters,callee.parameters)&&signature.returnType===callee.returnType&&value.arguments.length===callee.parameters.length&&value.type===callee.returnType,'signature');
        child(value.expression);
        // Structural equality alone cannot supply a Source declaration. Only
        // exact token-checked type nodes and original named headers are origins.
        check(signatureOrigins.get(signature.id)===callee.id,'signature','indirect signature has no exact original declaration');
        for(const [i,arg]of value.arguments.entries())child(arg,false,callee.parameters[i]);sequence([value.calleeRange,'(',...value.arguments.flatMap((arg,i)=>[...(i?[',']:[]),arg.range]),')']);return;}
      if(value.kind==='thisReference'){check(fn.ownerType===value.type&&text(value.range)==='this','binding');return;}
      if(['numericLiteral','booleanLiteral','stringLiteral','undefinedLiteral','nullLiteral'].includes(value.kind)) {
        if(value.kind==='numericLiteral') {
          check(text(value.range)===value.token&&value.token.length<=65536,'literal');
          if(integerNames.includes(value.type)){const n=typedArrayInteger(value.token),[min,max]=integerRange(value.type);check(n.toString()===value.decimal&&n>=min&&n<=max,'literal');}
          else check(['f32','f64'].includes(value.type)&&floatBits(value.token,value.type)===value.bits,'literal');
        }else if(value.kind==='booleanLiteral')check(value.type==='bool'&&['true','false'].includes(value.token)&&text(value.range)===value.token,'literal');
        else if(value.kind==='stringLiteral')check(value.type==='string'&&same(typedArrayStringUnits(text(value.range)),value.codeUnits),'literal');
        else check(text(value.range)===(value.kind==='undefinedLiteral'?'undefined':'null')&&value.type===(value.kind==='undefinedLiteral'?'undefined':'null'),'literal');
        return;
      }
      if(['parentheses','as','nonNull','unary'].includes(value.kind)) {
        child(value.expression);if(value.kind==='parentheses')sequence(['(',value.expression.range,')']);
        if(value.kind==='as'){typeAnnotation(fn.sourcePath,value.annotationRange,value.type);g.sequence(value.operatorRange,['as']);sequence([value.expression.range,'as',value.annotationRange]);}
        if(value.kind==='nonNull'){g.sequence(value.operatorRange,['!']);sequence([value.expression.range,'!']);}
        if(value.kind==='unary'){g.sequence(value.operatorRange,[value.operator]);sequence([value.operator,value.expression.range]);check(['+','-','!','~'].includes(value.operator)&&scalar,'operator');}
        return;
      }
      if(value.operatorRange)g.sequence(value.operatorRange,[value.operator??'+']);
      if(value.allocationSite)check(value.allocationSite===sha256('tsfg.array-facts.allocation.v8\0'+canonical({sourcePath:fn.sourcePath,declarationRange:value.range})),'identity');
      if(value.kind==='binary'||value.kind==='stringConcat') {
        child(value.left);child(value.right);sequence([value.left.range,value.operator??'+',value.right.range]);
        check(value.kind==='stringConcat'?value.type==='string':['+','-','*','/','%','<<','>>','>>>','&','|','^','===','!==','<','<=','>','>=','&&','||','??'].includes(value.operator),'operator');return;
      }
      if(value.kind==='arrayLiteral') {
        check(type(value.type).kind==='array','type');value.elements.forEach(v=>child(v,false,type(value.type).elementType));
        sequence(['[',...value.elements.flatMap((v,i)=>[...(i?[',']:[]),v.range]),']']);return;
      }
      if(['checkedElementAccess','elementTarget'].includes(value.kind)) {
        child(value.receiver);child(value.index);const owner=type(value.receiver.flowType);
        check(['array','readSpan'].includes(owner.kind)&&owner.elementType===value.type&&value.index.flowType==='u32'&&(!target||owner.kind==='array'),'type');
        sequence([value.receiver.range,'[',value.index.range,']']);return;
      }
      if(['fieldAccess','fieldTarget','arrayLength','readSpanLength','lengthTarget'].includes(value.kind)) {
        child(value.receiver);const owner=type(value.receiver.flowType);
        if(value.kind.startsWith('field')){const f=field(value.property,value.receiver,fn,target);check(f.type===value.type,'field');g.name(value.nameRange,f.name);}
        else {check(['array','readSpan'].includes(owner.kind)&&value.type==='u32'&&(!target||owner.kind==='array'),'type');g.name(value.nameRange,'length');
          check(value.property===(owner.kind==='array'?payload.arrayLength.id:payload.readSpanLength.id),'field');}
        sequence([value.receiver.range,'.',value.nameRange]);return;
      }
      if(['bindingAssignment','elementAssignment','elementCompoundAssignment','lengthAssignment','fieldAssignment'].includes(value.kind)) {
        child(value.target,true,undefined,value.operator!=='=');child(value.value,false,value.target.type);check(value.type===value.target.type,'type');
        check(['=','+=','-=','*=','/=','%=','<<=','>>=','>>>=','&=','|=','^=','&&=','||=','??='].includes(value.operator),'operator');
        sequence([value.target.range,value.operator,value.value.range]);return;
      }
      if(['bindingUpdate','elementUpdate','fieldUpdate'].includes(value.kind)) {
        child(value.target,true,undefined,true);check(value.type===value.target.type&&['++','--'].includes(value.operator),'operator');
        sequence(value.prefix?[value.operator,value.target.range]:[value.target.range,value.operator]);return;
      }
      if(['call','hostCall','new','superConstruct'].includes(value.kind)) {
        const signature=value.signature;check(signature&&signature.id===signatureId(signature.sourcePath,signature.declarationRange),'signature');
        check(signature.parameters.length===value.arguments.length&&signature.parameters.every(id=>types.has(id))&&types.has(signature.returnType),'signature');
        if(value.receiver)child(value.receiver);
        value.arguments.forEach((arg,i)=>child(arg,false,signature.parameters[i]));
        if(value.kind==='new'||value.kind==='superConstruct') {
          const owner=types.get(value.kind==='new'?value.type:value.callee);check(owner&&same(signature,owner.construction.signature)&&value.callee===owner.id,'construction');
          if(value.kind==='new'){const name=identifierName(text(value.calleeRange));check(value.flowType===owner.id&&(name===owner.nominalKey.declarationPath.at(-1)||local.get(name)===owner.id),'construction');}
          else check(fn.ownerType&&types.get(fn.ownerType).base===owner.id&&text(value.calleeRange)==='super','construction');
        }else if(value.kind==='hostCall'){
          const host=hosts.get(value.callee);check(host&&same(signature,host.signature)&&value.type===host.returnType
            &&value.flowType===host.returnType&&!value.receiver&&local.get(staticBindingName(text(value.calleeRange)))===host.id,'host');
        }else if(value.callee===payload.readSpanIntrinsic.id)check(signature.parameters.length===3&&types.get(value.arguments[0].flowType)?.kind==='array'
          &&signature.parameters[1]==='u32'&&signature.parameters[2]==='u32'&&types.get(value.flowType)?.kind==='readSpan','signature');
        else {
          const callee=functions.get(value.callee);check(callee&&callee.sourcePath===signature.sourcePath&&same(callee.declarationRange,signature.declarationRange)
            &&callee.returnType===signature.returnType&&same(callee.parameters.map(p=>p.declaredType),signature.parameters),'signature');
          if(callee.ownerType){check(value.receiver&&descendants(value.receiver.flowType,callee.ownerType),'signature');}
          else check(local.get(staticBindingName(text(value.calleeRange)))===callee.id,'scope');
        }
        sequence([...(value.kind==='new'?['new']:[]),value.calleeRange,'(',...value.arguments.flatMap((arg,i)=>[...(i?[',']:[]),arg.range]),')']);return;
      }
      check(false,'capability','unrepresented common expression '+value.kind);
    }
    function rows(items,start,end,parent,local=scope) {
      const outer=collections.set(declared),inner=collections.map(local);let cursor=start;
      for(const row of items) {
        spend();const at=g.indices(row.range);sourceRange(row.range,g.text,parent);
        const declaration=['constDeclaration','letDeclaration'].includes(row.kind);
        if(declaration||row.kind==='initialize'){const keyword=row.kind==='initialize'?globals.get(row.binding)?.bindingKind:row.kind==='constDeclaration'?'const':'let';
          check(g.tokens[cursor]?.text===keyword||g.tokens[cursor]?.text===',','source');cursor++;}
        check(cursor===at.first&&at.end<=end,'source','missing or reordered statement');
        const expression=(v,wanted=undefined)=>expr(v,row.range,false,wanted,inner);
        if(declaration) {
          const b=inventory.get(row.binding);check(b&&b.kind==='local'&&!seenDeclarations.has(b.id)&&b.writable===(row.kind==='letDeclaration'),'binding');
          expression(row.initializer,b.declaredType);annotation(b,row.initializer);check(same(row.range,b.declarationRange),'source');
          inner.set(b.name,b.id);declared.add(b.id);seenDeclarations.add(b.id);
        }else if(row.kind==='functionDeclaration'){const child=functions.get(row.functionId);check(child&&child.lexicalParent===fn.id&&same(child.declarationRange,row.range)&&same(parent,bodyRange),'lexical');
        }else if(row.kind==='initialize') {
          const global=globals.get(row.binding);check(global&&global.sourcePath===fn.sourcePath&&initialScope!==undefined,'global');
          expression(row.initializer,global.binding.declaredType);annotation(global.binding,row.initializer);
          check(same(row.range,global.binding.declarationRange),'source');
        }else if(['return','throw','expression'].includes(row.kind)) {
          if(row.value)expression(row.value,row.kind==='return'?fn.returnType:undefined);
          else check(row.kind==='return'&&fn.returnType==='void','type');
          g.sequence(row.range,[...(row.kind==='expression'?[]:[row.kind]),...(row.value?[row.value.range]:[])],true);
        }else if(row.kind==='block') {
          check(g.tokens[at.first].text==='{'&&g.tokens[at.end-1].text==='}','source');rows(row.body,at.first+1,at.end-1,row.range,inner);
        }else if(row.kind==='if'||row.kind==='while') {
          expression(row.condition,'bool');let pos=at.first;check(g.tokens[pos++]?.text===row.kind&&g.tokens[pos++]?.text==='(','source');
          const condition=g.indices(row.condition.range);check(pos===condition.first,'source');pos=condition.end;check(g.tokens[pos++]?.text===')','source');
          pos=branch(row.kind==='if'?row.then:row.body,pos,at.end,row.range,inner);
          if(row.kind==='if'&&g.tokens[pos]?.text==='else'){pos++;pos=branch(row.else,pos,at.end,row.range,inner);}else if(row.kind==='if')check(row.else.length===0,'source');
          check(pos===at.end,'source');
        }else if(row.kind==='try') {
          const pieces=['try',row.tryBlock.range];const tb=g.indices(row.tryBlock.range);
          rows(row.tryBlock.body,tb.first+1,tb.end-1,row.tryBlock.range,inner);
          if(row.catchClause) {
            const c=row.catchClause,caught=collections.map(inner);pieces.push('catch');
            if(c.binding){check(c.declarationRange&&same(c.binding,inventory.get(c.binding.id))&&c.binding.kind==='catch'&&c.binding.declaredType==='unknown'&&!seenDeclarations.has(c.binding.id),'binding');
              pieces.push('(',c.declarationRange,')');annotation(c.binding);caught.set(c.binding.name,c.binding.id);declared.add(c.binding.id);seenDeclarations.add(c.binding.id);}
            else check(c.declarationRange===null,'schema');pieces.push(c.block.range);
            const cb=g.indices(c.block.range);rows(c.block.body,cb.first+1,cb.end-1,c.block.range,caught);
            if(c.binding)declared.delete(c.binding.id);
            g.sequence(c.range,['catch',...(c.binding?['(',c.declarationRange,')']:[]),c.block.range]);
          }
          if(row.finallyBlock){pieces.push('finally',row.finallyBlock.range);const fb=g.indices(row.finallyBlock.range);rows(row.finallyBlock.body,fb.first+1,fb.end-1,row.finallyBlock.range,inner);}
          check(row.catchClause||row.finallyBlock,'schema');g.sequence(row.range,pieces);
        }else check(false,'capability','unrepresented common statement '+row.kind);
        cursor=at.end;if(g.tokens[cursor]?.text===';')cursor++;
      }
      check(cursor===end,'source','unrepresented source statement');spend(declared.size);for(const id of declared)if(!outer.has(id))declared.delete(id);return cursor;
    }
    function branch(items,start,end,parent,local) {
      if(g.tokens[start]?.text==='{') {let depth=1,finish=start+1;while(finish<end&&depth){spend();if(g.tokens[finish].text==='{')depth++;if(g.tokens[finish].text==='}')depth--;finish++;}
        check(depth===0,'source');rows(items,start+1,finish-1,parent,local);return finish;}
      check(items.length===1,'source');const child=g.indices(items[0].range);rows(items,start,child.end,parent,local);return child.end;
    }
    for(const {value,type:expected} of initial)expr(value,fn.declarationRange,false,expected,scope);
    if(bodyRange){const bounds=g.indices(bodyRange);rows(fn.body,bounds.first+1,bounds.end-1,bodyRange,scope);}
    check(fn.bindings.every(row=>seenDeclarations.has(row.id)),'binding','unused or omitted binding declaration');
    if(functions.has(fn.id)){spend(captureObserved.size);const captures=[...captureObserved].sort(([,a],[,b])=>{spend();return a[0].range.start-b[0].range.start;}).map(([binding,occurrences])=>{spend(occurrences.length);occurrences.sort((a,b)=>{spend();return a.range.start-b.range.start;});return {binding,read:occurrences.some(row=>row.read),write:occurrences.some(row=>row.write),occurrences};});
      check(same(fn.captures,captures),'capture','capture occurrences differ from lexical body');}
    return {expression:expr,rows};
  }
  for(const fn of functions.values()) {
    const g=grammars.get(fn.sourcePath),bounds=g.indices(fn.declarationRange),last=g.tokens[bounds.end-1];check(last.text==='}','source');
    let first=fn.returnAnnotationRange?g.indices(fn.returnAnnotationRange).end:g.indices(commonCallableNameRange(g,fn,types)).end;
    while(first<bounds.end&&g.tokens[first].text!=='{'){spend();first++;}check(first<bounds.end,'source');
    const bodyRange={start:g.tokens[first].start,end:last.end};
    functionBody(fn,bodyRange);
  }
  for(const type of types.values())if(type.fields?.some(field=>field.initializer))functionBody({id:type.id,ownerType:type.id,sourcePath:type.sourcePath,
    declarationRange:type.declarationRange,parameters:[],bindings:[],body:[]},null,type.fields.flatMap(field=>field.initializer?[{value:field.initializer,type:field.type}]:[]));
  for(const module of payload.modules) {
    const g=grammars.get(module.sourcePath),scope=visibility.get(module.sourcePath);
    const owner={id:module.sourcePath,sourcePath:module.sourcePath,declarationRange:{start:0,end:g.text.length},returnType:'void',parameters:[],bindings:[],body:[]};
    const verifier=functionBody(owner,null,[],scope);
    for(const row of module.initialization){const at=g.indices(row.range);const declaration=row.kind==='initialize';
      verifier.rows([row],declaration?at.first-1:at.first,at.end+(g.tokens[at.end]?.text===';'?1:0),owner.declarationRange,scope);}
  }
  validateCommonEntryRoots(payload,functions,relations,spend);
  relations.finish();return {functions,bindings};
}
