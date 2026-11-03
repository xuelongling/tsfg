// SPDX-License-Identifier: MIT
// Independent Source proof: native language carriers, never actual tags or
// fixed permissions. The caller owns complete HIR/Source/M12 admission.
// object is a conditional Source view/eligible receiver, never an actual tag;
// native proves absence of managed payload, not a scalar spelling or cast.
import {commonMethods} from './common-program-methods.mjs';

export function commonNativeCatchBindings(hir,spend,nativePayload) {
  spend(hir.types.length*2+hir.functions.length+hir.globals.length+1);
  const proved=new Set(),types=new Map(hir.types.map(t=>[t.id,t])),functions=new Map(hir.functions.map(f=>[f.id,f])),
    fields=new Map(),owners=new Map(),sourceTypes=new Map(hir.types.map(t=>[t.sourceType,t.id])),sourceMembers=new Map(),rows=new Map(),writes=new Map(),initializers=new Map();
  const nativeKind=id=>id==='void'||['scalar','void','null','undefined'].includes(types.get(id)?.kind);
  const no={known:false,native:false,object:null,language:false},unknown={known:true,native:false,object:null,language:true},primitive={known:true,native:true,object:null,language:true};
  let closed=hir.hostImports.length===0,hasCandidate=false;
  for(const type of hir.types){spend();
    for(const field of type.fields??[]){spend();fields.set(field.id,field);owners.set(field.id,type.id);sourceMembers.set(field.sourceBinding,field.id);}
    if(['reference','value'].includes(type.kind)){
      const ctor=type.construction;closed &&= Boolean(ctor&&['implicit-base','implicit-derived'].includes(ctor.kind));
      if(ctor){closed &&= ctor.functionId===null&&(type.base?ctor.kind==='implicit-derived'&&ctor.implicitForward!==null:ctor.kind==='implicit-base'&&ctor.implicitForward===null);spend(ctor.initializationFields.length+(type.fields?.length??0));closed &&= ctor.initializationFields.length===type.fields.length&&ctor.initializationFields.every((id,i)=>id===type.fields[i].id);}
    }
  }
  const collect=initial=>{const result=[],pending=[initial];while(pending.length){spend();const row=pending.pop();if(row===null||typeof row!=='object')continue;
    if(Array.isArray(row)){spend(row.length);for(const child of row)pending.push(child);continue;}result.push(row);
    for(const key in row){spend();if(key!=='sourceSignature'&&row[key]!==null&&typeof row[key]==='object')pending.push(row[key]);}
  }return result;};
  for(const fn of hir.functions){spend();const body=collect([fn.body,...(fn.parameterInitialization?.steps??[])]),changed=new Set(),locals=new Map();rows.set(fn.id,body);writes.set(fn.id,changed);initializers.set(fn.id,locals);
    closed &&= !fn.lexicalEnvironment&&!fn.activationEnvironment&&(fn.captures?.length??0)===0;
    sourceMembers.set(fn.sourceBinding,fn.id);
    for(const row of body){spend();
      if(row.kind==='try'&&row.catchClause?.binding)hasCandidate=true;
      if(['bindingTarget','globalTarget'].includes(row.kind))changed.add(row.binding);
      if(['constDeclaration','letDeclaration','variableDeclaration'].includes(row.kind)&&row.initializer)locals.set(row.binding,row.initializer);
    }
  }
  if(!hasCandidate)return proved;
  for(const global of hir.globals){spend();closed &&= nativeKind(global.type);}
  const legacy=new Set();for(const fn of hir.functions)for(const row of rows.get(fn.id)){spend();if(row.kind!=='try'||!row.catchClause?.binding)continue;const id=row.catchClause.binding.id,region=row.tryBlock.body;
    if(!writes.get(fn.id).has(id)&&region.length===1&&region[0].kind==='throw'&&nativePayload(region[0].value,new Set()))legacy.add(id);}
  const parent=new Map(Array.from(fields.keys(),id=>[id,id])),find=id=>{spend();while(parent.get(id)!==id){spend();id=parent.get(id);}return id;};
  const union=(a,b)=>{spend();a=find(a);b=find(b);if(a!==b)parent.set(a,b);};
  const inherited=id=>{const result=[],seen=new Set(),names=new Set();let type=types.get(id);
    while(type){spend();if(seen.has(type.id)){closed=false;break;}seen.add(type.id);
      for(const field of type.fields??[]){spend();if(names.has(field.name))closed=false;names.add(field.name);result.push(field);}
      if(!type.base)break;type=types.get(type.base);if(!type)closed=false;
    }return result;};
  const allFields=new Map();for(const type of hir.types){spend();allFields.set(type.id,inherited(type.id));}
  const typePairs=new Set();for(const row of hir.snapshot.payload.compatibilityWitnesses){spend();const proof=row.compatibility,from=sourceTypes.get(proof.sourceType),to=sourceTypes.get(proof.targetType);
    if(from===undefined||to===undefined){closed=false;continue;}
    typePairs.add(proof.sourceType+'\0'+proof.targetType);for(const dependency of row.dependencies){spend();if(!sourceTypes.has(dependency.sourceType)||!sourceTypes.has(dependency.targetType))closed=false;}
    const source=allFields.get(from),target=allFields.get(to),pairs=new Map();
    for(const pair of proof.members){spend();const a=sourceMembers.get(pair.source),b=sourceMembers.get(pair.target);if(a===undefined||b===undefined){closed=false;continue;}
      if(fields.has(a)||fields.has(b)){if(!fields.has(a)||!fields.has(b)){closed=false;continue;}union(a,b);pairs.set(b,a);}
    }
    for(const field of target){spend(source.length+1);if(!source.some(candidate=>candidate.id===field.id)&&!pairs.has(field.id))closed=false;}
  }
  for(const entry of hir.snapshot.payload.entryCompatibilityRoots)for(const root of entry.roots){spend();if(root.sourceType!==root.targetType&&!typePairs.has(root.sourceType+'\0'+root.targetType))closed=false;}
  const rowOwners=new Map();for(const fn of hir.functions)for(const row of rows.get(fn.id)){spend();rowOwners.set(row,fn);}
  const allRows=[...rows.values()].flat();for(const type of hir.types){spend();for(const field of type.fields??[])if(field.initializer)allRows.push(...collect(field.initializer));if(type.construction)allRows.push(...collect(type.construction.parameters));}
  for(const module of hir.modules){spend();allRows.push(...collect(module.initialization));}
  for(const row of allRows){spend();
    if(['hostCall','indirectCall','functionReference'].includes(row.kind))closed=false;
    if(row.kind==='call'&&row.callee!=='intrinsic:readSpan'&&!functions.has(row.callee))closed=false;
    if(['as','nonNull','parentheses'].includes(row.kind)&&!nativeKind(row.type)){
      const from=types.get(row.expression.type);if(!from||['unknown','union'].includes(from.kind))closed=false;
    }
    if(['fieldAccess','fieldTarget'].includes(row.kind)&&(!fields.has(row.property)||!['value','reference'].includes(types.get(row.receiver.type)?.kind)))closed=false;
  }
  if(!closed)return proved;
  const groups=new Map(),fieldWrites=new Map();for(const [id,field]of fields){spend();const group=find(id);if(!groups.has(group))groups.set(group,[]);groups.get(group).push(field);fieldWrites.set(id,[]);}
  for(const row of allRows){spend();if(!['fieldAssignment','fieldUpdate'].includes(row.kind))continue;let target=row.target;
    while(target?.kind==='parentheses'){spend();target=target.expression;}if(target?.kind!=='fieldTarget'||!fields.has(target.property))return proved;
    fieldWrites.get(target.property).push({fn:rowOwners.get(row)??null,row,target});
  }
  const globals=new Map(hir.globals.map(g=>[g.id,g])),globalSeeds=new Map(),globalWrites=new Map();for(const global of hir.globals){spend();globalSeeds.set(global.id,[]);globalWrites.set(global.id,[]);}
  for(const row of allRows){spend();if(row.kind==='initialize'&&globals.has(row.global))globalSeeds.get(row.global).push(row.initializer);let target=row.target;while(target?.kind==='parentheses'){spend();target=target.expression;}
    if(['bindingAssignment','bindingUpdate'].includes(row.kind)&&target?.kind==='globalTarget'&&globals.has(target.global))globalWrites.get(target.global).push({fn:rowOwners.get(row)??null,row});}
  // Only the independently admitted required-kernel entry owns scalar tags.
  // A supplied call argument always overrides this root-only certificate.
  spend(hir.closure.roots.length*2+hir.closure.requiredRoots.length*2+hir.snapshot.payload.entryCompatibilityRoots.length);
  const kernels=new Set(hir.closure.roots.filter(row=>row.kind==='kernel').map(row=>row.target)),required=new Set(hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target)),nativeEntries=new Set();
  for(const row of hir.snapshot.payload.entryCompatibilityRoots){const id=sourceMembers.get(row.functionId);
    if(kernels.has(id)&&required.has(id)&&types.get(sourceTypes.get(row.viewType))?.kind==='scalar')nativeEntries.add(id+'\0'+row.parameterBinding);}
  let closedBoundary=true,methods=null;const activeFunctions=new Set(),activeFields=new Set(),activeGlobals=new Set();
  const context=(fn,args=null,receiver=null)=>{const bound=new Map();spend(fn.parameters.length);
    fn.parameters.forEach((p,i)=>bound.set(p.id,args?.[i]??(args===null&&nativeEntries.has(fn.id+'\0'+p.id)?primitive:['reference','value'].includes(types.get(p.type)?.kind)?{...unknown,object:p.type}:unknown)));
    if(fn.receiverBinding)bound.set(fn.receiverBinding,receiver?{...unknown,object:receiver}:{...unknown,object:fn.ownerType});
    return {fn,bound,actual:args!==null,resolving:new Set(),elements:new Map()};};
  const route=(actual,field)=>{spend();return actual!==null&&(allFields.get(actual)??[]).some(candidate=>find(candidate.id)===find(field));};
  // Initial materializers establish the invariant. Stores may assume only
  // their own already-initialized group; cross-group cycles remain unproved.
  function fieldNative(id,assumed){spend();const key=find(id);if(assumed.has(key))return true;if(activeFields.has(key))return false;activeFields.add(key);
    const group=groups.get(key);let ok=true;
    for(const field of group){spend();ok &&= nativeKind(field.type)&&Boolean(field.initializer)&&expression(field.initializer,null,new Set()).native;}
    if(ok){const local=new Set(assumed);local.add(key);
      for(const field of group)for(const writer of fieldWrites.get(field.id)){spend();const row=writer.row,ctx=writer.fn?context(writer.fn):null,receiver=expression(writer.target.receiver,ctx,local),rhs=row.value?expression(row.value,ctx,local):primitive;
        ok &&= receiver.known&&route(receiver.object,field.id)&&rhs.known&&rhs.native&&['=','+=','-=','*=','/=','%=','**=','&=','|=','^=','<<=','>>=','>>>=','++','--'].includes(row.operator);
      }
    }activeFields.delete(key);return ok;
  }
  function globalNative(id,assumed){spend();if(!globals.has(id))return false;const key='global:'+id;if(assumed.has(key))return true;if(activeGlobals.has(id))return false;activeGlobals.add(id);
    const seeds=globalSeeds.get(id);let ok=seeds.length>0;for(const seed of seeds){spend();ok &&= expression(seed,null,new Set()).native;}
    if(ok){const local=new Set(assumed);local.add(key);for(const writer of globalWrites.get(id)){spend();const result=expression(writer.row,writer.fn?context(writer.fn):null,local);ok &&= result.known&&result.native;}}activeGlobals.delete(id);return ok;
  }
  const elementKey=(value,ctx)=>{spend();if(!ctx||value.receiver.kind!=='bindingReference'||value.index?.kind!=='numericLiteral'||writes.get(ctx.fn.id).has(value.receiver.binding))return null;return value.receiver.binding+'\0'+value.index.decimal;};
  function expression(value,ctx,assumed){spend();if(!value)return primitive;
    if(['numericLiteral','booleanLiteral','nullLiteral','undefinedLiteral'].includes(value.kind))return primitive;
    if(value.kind==='stringLiteral')return unknown;
    if(['as','parentheses','nonNull'].includes(value.kind))return expression(value.expression,ctx,assumed);
    if(['bindingReference','thisReference'].includes(value.kind)){
      if(!ctx)return unknown;const id=value.kind==='thisReference'?ctx.fn.receiverBinding:value.binding;
      if(writes.get(ctx.fn.id).has(id))return unknown;
      if(ctx.bound.has(id))return ctx.bound.get(id);if(!ctx.actual&&legacy.has(id))return primitive;
      const initializer=initializers.get(ctx.fn.id).get(id);if(!initializer||ctx.resolving.has(id))return unknown;
      ctx.resolving.add(id);const result=expression(initializer,ctx,assumed);ctx.resolving.delete(id);return result;
    }
    if(['globalReference','globalTarget'].includes(value.kind))return {...unknown,native:globalNative(value.global,assumed)};if(value.kind==='bindingTarget')return unknown;
    if(value.kind==='fieldAccess'||value.kind==='fieldTarget'){
      const receiver=expression(value.receiver,ctx,assumed);return {...unknown,known:receiver.known&&route(receiver.object,value.property),native:receiver.known&&route(receiver.object,value.property)&&fieldNative(value.property,assumed),language:receiver.language};
    }
    if(value.kind==='binary'||value.kind==='unary'){
      const operands=value.kind==='binary'?[value.left,value.right]:[value.expression??value.operand],results=operands.map(row=>expression(row,ctx,assumed));spend(results.length);
      const allowed=['+','-','*','/','%','**','&','|','^','<<','>>','>>>','!','~','<','<=','>','>=','===','!==','==','!=','&&','||','??'];
      return {...unknown,known:allowed.includes(value.operator)&&results.every(r=>r.known),native:allowed.includes(value.operator)&&nativeKind(value.type)&&results.every(r=>r.known&&r.native),language:results.every(r=>r.language)};
    }
    if(value.kind==='call'){
      const receiver=value.receiver?expression(value.receiver,ctx,assumed):null,args=value.arguments.map(arg=>expression(arg,ctx,assumed));spend(args.length);ctx?.elements.clear();
      if(value.callee==='intrinsic:readSpan')return {...unknown,known:args.every(a=>a.known),language:args.every(a=>a.language)};
      const callee=functions.get(value.callee);if(!callee||args.some(a=>!a.known)||receiver&&!receiver.known)return no;
      const targets=callee.kind==='method'?(methods??=commonMethods(hir,spend)).dispatch(callee.id,value.receiver.type):[{target:callee.id,receiver_type:null}];
      spend(targets.length);if(callee.kind==='method'&&(receiver.object===null||!targets.some(row=>row.receiver_type===receiver.object)))return no;
      let result=null;for(const target of targets){spend();const fn=functions.get(target.target),next=summary(fn,args,target.receiver_type,assumed);
        result=result?join(result,next):next;
      }return {...result,known:result.known&&(!receiver||receiver.known),language:result.language&&args.every(a=>a.language)&&(!receiver||receiver.language)};
    }
    if(value.kind==='new'||value.kind==='superConstruct'){
      ctx?.elements.clear();const type=types.get(value.type);if(!type||!allFields.has(type.id))return no;
      const values=[...(value.arguments??[])];for(const field of allFields.get(type.id))values.push(field.initializer);
      const results=values.map(row=>expression(row,ctx,assumed));spend(results.length);
      return {...unknown,known:results.every(r=>r.known),object:type.id,language:results.every(r=>r.language)};
    }
    if(['checkedElementAccess','elementTarget','arrayLength','readSpanLength','lengthTarget'].includes(value.kind)){
      const receiver=expression(value.receiver,ctx,assumed),index=value.index?expression(value.index,ctx,assumed):primitive;
      const key=value.index?elementKey(value,ctx):null,fact=key===null?null:ctx.elements.get(key);return {...unknown,known:receiver.known&&index.known,native:fact?.native??false,language:receiver.language&&index.language};
    }
    if(value.kind==='arrayLiteral'){
      const children=value.elements.map(row=>expression(row,ctx,assumed));spend(children.length);return {...unknown,known:children.every(r=>r.known),language:children.every(r=>r.language)};
    }
    if(['bindingAssignment','bindingUpdate','elementAssignment','elementCompoundAssignment','elementUpdate','fieldAssignment','fieldUpdate','lengthAssignment'].includes(value.kind)){
      let selected=value.target;while(selected.kind==='parentheses'){spend();selected=selected.expression;}const target=expression(value.target,ctx,assumed),rhs=value.value?expression(value.value,ctx,assumed):primitive,
        numeric=['+=','-=','*=','/=','%=','**=','&=','|=','^=','<<=','>>=','>>>=','++','--'].includes(value.operator)&&types.get(selected.type)?.kind==='scalar',
        result={...unknown,known:target.known&&rhs.known,native:value.operator==='='?rhs.native:numeric&&nativeKind(value.type)&&target.native&&rhs.native,language:target.language&&rhs.language};
      if(['fieldTarget','elementTarget','globalTarget'].includes(selected.kind)&&(!result.known||!result.native))closedBoundary=false;
      ctx?.elements.clear();if(selected.kind==='elementTarget'){const key=elementKey(selected,ctx);if(key!==null&&result.known&&result.native)ctx.elements.set(key,primitive);}
      return result;
    }return no;
  }
  function join(a,b){spend();return {known:a.known&&b.known,native:a.native&&b.native,object:a.object===b.object?a.object:null,language:a.language&&b.language};}
  function body(statements,ctx,assumed,collect=false){let result=primitive,returned=null;
    for(const row of statements){spend();let next;
      if(row.kind==='return'){next=expression(row.value,ctx,assumed);ctx?.elements.clear();returned=returned?join(returned,next):next;}
      else if(row.kind==='throw'){const value=expression(row.value,ctx,assumed);ctx?.elements.clear();next={...unknown,known:value.known,language:value.language&&value.native};}
      else if(row.kind==='expression')next=expression(row.value,ctx,assumed);
      else if(row.kind==='initialize'){next=expression(row.initializer,ctx,assumed);if(!next.known||!next.native)closedBoundary=false;}
      else if(['constDeclaration','letDeclaration','variableDeclaration'].includes(row.kind))next=expression(row.initializer,ctx,assumed);
      else if(row.kind==='try'&&ctx&&row.finallyBlock===undefined){
        ctx.elements.clear();const region=body(row.tryBlock.body,ctx,assumed,collect);next=region;ctx.elements.clear();
        if(row.catchClause){const id=row.catchClause.binding?.id,good=id&&!writes.get(ctx.fn.id).has(id)&&(!ctx.actual&&legacy.has(id)||region.known&&region.language),caught={...ctx,bound:new Map(ctx.bound),resolving:new Set(),elements:new Map()};
          if(id)caught.bound.set(id,good?primitive:unknown);if(good&&collect)proved.add(id);
          const handled=body(row.catchClause.block.body,caught,assumed,collect);next={...join(region,handled),known:region.known&&handled.known,language:handled.language};
        }
        ctx.elements.clear();returned=returned?join(returned,next):next;
      }else {ctx?.elements.clear();next=no;}
      result={...result,known:result.known&&next.known,language:result.language&&next.language};
    }return {...(returned??primitive),known:result.known,language:result.language};
  }
  function summary(fn,args,receiver,assumed){spend();if(activeFunctions.has(fn.id)||fn.lexicalEnvironment||fn.activationEnvironment||(fn.captures?.length??0)>0||(fn.parameterInitialization?.steps.length??0)>0||args.length<fn.parameters.length)return no;
    activeFunctions.add(fn.id);const result=body(fn.body,context(fn,args,receiver),assumed);activeFunctions.delete(fn.id);return result;
  }
  const exposed=new Set(hir.closure.roots.map(root=>root.target));spend(hir.closure.roots.length);
  for(const fn of hir.functions){spend();if(fn.lexicalEnvironment||fn.activationEnvironment||(fn.captures?.length??0)>0)continue;
    activeFunctions.add(fn.id);const result=body(fn.body,context(fn),new Set(),true);activeFunctions.delete(fn.id);if(exposed.has(fn.id)&&(!result.known||!result.native||!result.language))closedBoundary=false;
  }for(const type of hir.types)for(const field of type.fields??[]){spend();const result=expression(field.initializer,null,new Set());if(!nativeKind(field.type)||!result.known||!result.native||!result.language)closedBoundary=false;}for(const module of hir.modules){spend();const result=body(module.initialization,null,new Set());if(!result.known||!result.language)closedBoundary=false;}return closedBoundary?proved:new Set();
}
