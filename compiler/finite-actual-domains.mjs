// SPDX-License-Identifier: MIT
// Monotone Source-flow closure. This module computes representation bounds;
// it never evaluates source expressions or invents runtime values.
import {verifyHir} from './module-hir.mjs';
import {buildTypedLayouts} from './typed-layouts.mjs';
import {buildTypedReferenceViews} from './typed-reference-views.mjs';
import {buildFiniteFieldReaching} from './finite-field-reaching.mjs';
import {buildFiniteArrayReaching} from './finite-array-reaching.mjs';
import {finiteCallables} from './finite-callables.mjs';
import {canonical,own,sha256} from './identity.mjs';
import {isFiniteAbsence} from './finite-presence.mjs';
import {actualFieldResolver} from './member-presence.mjs';

function fail(message) {throw Object.assign(new TypeError('r03-finite-domain: '+message),
  {code:'r03-finite-domain',ruleId:'r01-input-boundary',phase:'lowering'});}

/** @param {any} input @param {any} context
 * @param {{work?:number,cancelled?:()=>boolean,publicationContext?:any}} [options] */
export function buildFiniteActualDomains(input,context,options={}) {
  return buildPlans(input,context,options,false).reached;
}

// Definition slots are universally quantified representation bounds. They
// never publish an allocation, invocation or reached-instance observation.
export function buildFiniteCoreDomains(input,context,options={}) {
  return buildPlans(input,context,options,true);
}

function buildPlans(input,context,options,definitions) {
  let remaining=options.work??100000;
  if(!Number.isInteger(remaining)||remaining<1||remaining>100000)fail('invalid work limit');
  const charge=()=>{if(options.cancelled?.())fail('cancelled');if(remaining--<=0)fail('work limit');};
  function build(mode) {
    const solve=(field=null,array=null)=>solveFiniteActualDomains(input,context,charge,field,mode,array,options.publicationContext);
    const initial=solve();
    // Field short-circuit control also must not consume capacity-based Array
    // reads. This is the same conservative solver role as the ordered start.
    const controlInitial=solve(null,{reads:[]});
    const fieldReaching=buildFiniteFieldReaching(verifyHir(input,context,options.publicationContext),controlInitial,charge);
    const result=fieldReaching.reads.some(row=>row.reaching.length)
      ?solve(fieldReaching):initial;
    const hir=verifyHir(input,context,options.publicationContext);
    // The first control query must not inherit Array read alternatives from
    // the carrier/capacity solution. A non-null empty reaching directory makes
    // every unproved read pending in this same solver, before any edge is cut.
    let arrayReaching,ordered=solve(fieldReaching,{reads:[]}),previous;
    // Memory-dependent presence may remove an incoming call edge only after
    // its actual read sources are proved. Iterate the same solver, sharing the
    // original budget; representation maxima never become memory witnesses.
    for(;;) {
      arrayReaching=buildFiniteArrayReaching(hir,{...ordered,carrierNodes:result.nodes,fieldReaching},charge);
      if(!arrayReaching.reads.length)break;
      const rows=[];for(const read of arrayReaching.reads){charge();const versions=[];
        for(const id of read.versions){charge();versions.push(id);}rows.push([read.node,read.status,versions]);}
      const current=canonical(rows);if(current===previous)break;previous=current;
      ordered=arrayReaching.reads.length?solve(fieldReaching,arrayReaching):result;
    }
    // Refined payloads do not silently republish a narrower ABI. Representation
    // maxima retain their original finite role, separately from ordered data.
    const domains=new Map([...result.domains,...ordered.domains].map(row=>[row.id,row]));
    const calls=ordered.calls.map(call=>({...call,targets:call.targets.map(target=>({...target,
      abi:result.abi.find(row=>row.functionId===target.functionId).id}))}));
    return {...result,nodes:ordered.nodes,carrierNodes:result.nodes,calls,fields:ordered.fields,
      carrierCalls:result.calls,carrierFields:result.fields,
      domains:[...domains.values()].sort((a,b)=>a.id<b.id?-1:1),fieldReaching,arrayReaching};
  }
  const reached=build('reached'),definition=definitions?build('definition'):null;
  return own({reached:{...reached,work:(options.work??100000)-remaining},
    ...(definition?{definition:{...definition,work:(options.work??100000)-remaining}}:{})});
}

function solveFiniteActualDomains(input,context,charge,fieldReaching,mode,arrayReaching=null,publicationContext=undefined) {
  const refinements=new Map((fieldReaching?.reads??[]).map(row=>[row.node,row.reaching]));
  const arrayReads=new Map((arrayReaching?.reads??[]).filter(row=>row.status==='proven').map(row=>[row.node,row.sources]));
  charge();const hir=verifyHir(input,context,publicationContext);
  const types=new Map(hir.types.map(type=>[type.id,type]));
  const options={publicationContext},layouts=buildTypedLayouts(hir,context,options),physical=new Map(layouts.entries.map(row=>[row.typeId,row.layout]));
  const undefinedId=sha256('tsfg.type\0undefined'),intrinsics=[];
  if(!types.has(undefinedId)&&hir.types.some(type=>type.construction)) {
    charge();if(types.size>=4096)fail('formal type limit including intrinsic undefined');
    const value={id:undefinedId,kind:'undefined',name:'undefined'};types.set(undefinedId,value);intrinsics.push(value);
    physical.set(undefinedId,{alignment:1,byteSize:0,referenceCount:0});
  }
  const nodes=new Map(),edges=new Map(),owners=new Map(),queue=[],queued=new Set(),expressions=[],gates=new Map(),coalesces=[];
  const reads=[],stores=[],fieldReads=[],fieldStores=[],presenceTests=[],entryOwners=[],methodCalls=[],allocations=[],definitionSeeds=[];
  const views=buildTypedReferenceViews(hir,context,options);
  const methodViews=new Map(),fieldViews=new Map(),fieldOwners=new Map();
  for(const type of hir.types)for(const field of type.fields??[]) {
    charge();fieldOwners.set(field.id,{owner:type.id,field});
  }
  for(const view of views.views) {
    for(const pair of view.methods) {
      charge();methodViews.set(view.actualType+'\0'+view.targetType+'\0'+pair.target,pair.source);
    }
    for(const pair of view.fields) {
      charge();fieldViews.set(view.actualType+'\0'+view.targetType+'\0'+pair.target,pair.missing?{missing:true,type:undefinedId}:pair.source);
    }
  }
  const callables=finiteCallables(hir),functions=new Map(callables.map(fn=>[fn.id,fn]));
  function node(id,viewType) {
    if(nodes.has(id))return nodes.get(id);charge();
    const result={id,viewType,actual:new Set(),owners:new Set(),pending:new Set()};
    nodes.set(id,result);edges.set(id,new Map());return result;
  }
  const enqueue=id=>{if(!queued.has(id)){charge();queued.add(id);queue.push(id);}};
  function insert(id,key,value) {
    const selected=nodes.get(id)[key];if(selected.has(value))return;charge();
    if(key==='actual'&&selected.size>=256)fail('variant limit');selected.add(value);enqueue(id);
  }
  function copy(from,to,predicate=null) {
    const targets=edges.get(from);if(targets.has(to))return;charge();
    if(predicate?.gate){charge();if(!gates.has(predicate.gate))gates.set(predicate.gate,[]);gates.get(predicate.gate).push({from,to,predicate});}
    targets.set(to,predicate);propagate(from,to,predicate);
  }
  const absent=id=>{charge();return isFiniteAbsence(types.get(id)?.kind);};
  function propagate(from,to,predicate) {
    if(predicate?.gate){const gate=nodes.get(predicate.gate);for(const reason of gate.pending){charge();insert(to,'pending',reason);}
      let enabled=false;for(const type of gate.actual){charge();if(absent(type))enabled=true;}if(!enabled)return;}
    for(const key of ['actual','owners','pending'])for(const value of nodes.get(from)[key]) {
      charge();if(predicate?.presentOnly&&key==='actual'&&absent(value))continue;
      if(predicate?.ownerOnly&&key!=='owners')continue;
      if(predicate&&key==='actual'&&(predicate.equal?value!==predicate.type:value===predicate.type))continue;
      if(predicate?.equal&&key==='owners')continue;
      insert(to,key,value);
    }
  }
  function leaves(id) {
    const result=[],seen=new Set(),stack=[id];
    while(stack.length){charge();const current=stack.pop();if(seen.has(current))continue;seen.add(current);
      const type=types.get(current);if(!type)fail('missing owned type');
      if(type.kind==='union')stack.push(...type.members);else result.push(current);}
    return result.sort();
  }
  const binding=(fn,id,type)=>node(fn.id+'/binding/'+id,type).id;
  const returned=fn=>node(fn.id+'/return',fn.returnType.id).id;
  function owner(id,elementType) {
    if(owners.has(id))return owners.get(id);charge();
    const result=node(id+'/elements',elementType).id;owners.set(id,result);return result;
  }
  function entry(id,typeId,authority) {
    const stack=[{id,typeId}];
    while(stack.length) {
      const current=stack.pop();charge();
      for(const actual of leaves(current.typeId)) {
      insert(current.id,'actual',actual);const type=types.get(actual);
      if(type.kind==='reference')for(const candidate of entryReferences(actual,authority))insert(current.id,'actual',candidate);
      if(['array','readSpan'].includes(type.kind)) {
        const allocation=current.id+'/entry-owner/'+actual,element=owner(allocation,type.elementType);
        entryOwners.push({owner:allocation,element,type:type.elementType});
        insert(current.id,'owners',allocation);stack.push({id:element,typeId:type.elementType});
      }
      }
    }
  }
  const exports=new Set(hir.exports.map(row=>row.functionId));
  // Published entry bounds are derived once from the complete selected Source
  // closure. A reference signature includes verified nominal descendants and
  // actual checker-proven structural sources, not every module type. Concrete
  // internal call edges can further enlarge the fixed contract before hashing.
  const referenceBounds=new Map();
  function entryReferences(target,authority=undefined) {
    if(!authority&&referenceBounds.has(target))return referenceBounds.get(target);
    const selected=new Set([target]);
    for(const candidate of hir.types)if(candidate.kind==='reference') {
      charge();let current=candidate;const seen=new Set();
      while(current) {
        charge();if(seen.has(current.id))fail('inheritance cycle');seen.add(current.id);
        if(current.id===target){selected.add(candidate.id);break;}
        current=current.base?types.get(current.base):null;
      }
    }
    for(const record of authority?[authority]:hir.entryCompatibilityRoots)for(const proof of record.roots) {
      charge();
      if(proof.targetType===target)selected.add(proof.sourceType);
    }
    const result=[...selected].sort();if(!authority)referenceBounds.set(target,result);return result;
  }
  for(const fn of callables) {
    returned(fn);
    for(const parameter of fn.parameters) {
      const id=binding(fn,parameter.id,parameter.type);
      if(exports.has(fn.id)) {
        const authority=hir.entryCompatibilityRoots.find(row=>row.functionId===fn.id&&row.parameterBinding===parameter.id);
        if(!authority)fail('missing verified entry authority');entry(id,parameter.type,authority);
      }else if(mode==='definition') {
        const receiver=fn.ownerType&&parameter===fn.parameters[0];
        definitionSeeds.push({functionId:fn.id,binding:parameter.id,viewType:parameter.type,
          authority:receiver?'owned-receiver-definition-bound':'owned-parameter-definition-bound'});
        if(receiver) {
          for(const candidate of hir.types)if(candidate.id===fn.ownerType||candidate.kind==='reference') {
            charge();let current=candidate;
            while(current) {
              charge();if(current.id===fn.ownerType){insert(id,'actual',candidate.id);break;}
              current=current.base?types.get(current.base):null;
            }
          }
        }else entry(id,parameter.type);
      }
    }
  }
  // Host-callable resources persist across calls and exports. Distinct entry
  // parameters have no noalias authority. Propagate writes through every
  // source-compatible possible shared owner, without merging unrelated native
  // representations merely because both also permit absence.
  const aliases=[],aliasMemo=new Map();
  function shareable(left,right,depth=0) {
    charge();if(depth>32)fail('published resource depth limit');
    const key=left+'\0'+right;if(aliasMemo.has(key))return aliasMemo.get(key);
    const a=leaves(left),b=leaves(right),present=ids=>ids.filter(id=>!['undefined','null'].includes(types.get(id).kind));
    const aPresent=present(a),bPresent=present(b);
    let yes=aPresent.some(id=>bPresent.includes(id));
    if(!yes&&(!aPresent.length||!bPresent.length))yes=a.some(id=>b.includes(id));
    for(const x of aPresent)for(const y of bPresent)if(!yes) {
      charge();const at=types.get(x),bt=types.get(y);
      if(at.kind==='reference'&&bt.kind==='reference')
        yes=entryReferences(x).some(id=>entryReferences(y).includes(id));
      else if(['array','readSpan'].includes(at.kind)&&['array','readSpan'].includes(bt.kind))
        yes=shareable(at.elementType,bt.elementType,depth+1);
    }
    aliasMemo.set(key,yes);aliasMemo.set(right+'\0'+left,yes);return yes;
  }
  for(let a=0;a<entryOwners.length;a++)for(let b=a+1;b<entryOwners.length;b++) {
    charge();const left=entryOwners[a],right=entryOwners[b];if(!shareable(left.type,right.type))continue;
    copy(left.element,right.element);copy(right.element,left.element);
    aliases.push({left:left.owner,right:right.owner,authority:'complete-published-resource-boundary',
      elementTypes:[left.type,right.type]});
  }
  const tasks=[];
  function expression(value,path,fn,guards=new Map()) {
    const result=node(path,value.type).id;expressions.push({id:result,kind:value.kind,range:{...value.range},functionId:fn.id,
      ...(value.kind==='reference'&&guards.has(value.binding)?{presenceProof:guards.get(value.binding)}:{})});
    tasks.push({value,path,fn,guards});return result;
  }
  function branchGuard(condition,truth,guards) {
    const next=new Map(guards);let a=condition.left,b=condition.right;
    if(condition.kind!=='binary'||!['===','!=='].includes(condition.operator))return next;
    while(a?.kind==='group')a=a.operand;while(b?.kind==='group')b=b.operand;
    const binding=a?.kind==='reference'?a:b,absence=binding===a?b:a;
    if(binding?.kind==='reference'&&['undefined','null'].includes(absence?.kind))
      next.set(binding.binding,{type:absence.type,equal:(condition.operator==='===')===truth,range:{...condition.range}});
    return next;
  }
  function stableGuards(guards,body) {
    const result=new Map(guards),stack=[body];
    while(stack.length) {
      charge();const value=stack.pop();if(!value||typeof value!=='object')continue;
      if(value.kind==='assignment')result.delete(value.target.binding);
      if(value.kind==='update')result.delete(value.operand?.binding??value.target?.binding);
      for(const child of Object.values(value))if(child&&typeof child==='object')stack.push(child);
    }return result;
  }
  function body(statements,path,fn) {
    const stack=statements.map((value,index)=>({value,path:path+'/'+index,guards:new Map()})).reverse();
    while(stack.length) {
      charge();const {value:s,path:p,guards}=stack.pop(),emit=(value,path)=>expression(value,path,fn,guards);
      if(s.kind==='local')copy(emit(s.initializer,p+'/initializer'),binding(fn,s.binding.id,s.binding.type));
      else if(s.kind==='return'||s.kind==='constructorReturn') {
        if(s.value)copy(emit(s.value,p+'/value'),returned(fn));
      }else if(s.kind==='expression')emit(s.expression,p+'/expression');
      else if(s.kind==='if'||s.kind==='while')emit(s.condition,p+'/condition');
      for(const key of ['body','then','else'])if(s[key])
        for(let i=s[key].length-1;i>=0;i--)stack.push({value:s[key][i],path:p+'/'+key+'/'+i,
          guards:stableGuards(s.kind==='if'?branchGuard(s.condition,key==='then',guards):new Map(guards),s[key])});
    }
  }
  for(const fn of hir.functions)body(fn.body,fn.id+'/body',fn);
  function constructionFrame(type) {
    return functions.get(type.constructor??type.construction.id);
  }
  for(const type of hir.types)if(type.construction) {
    const frame=constructionFrame(type),receiver=binding(frame,frame.parameters[0].id,type.id);
    frame.parameters.forEach(parameter=>binding(frame,parameter.id,parameter.type));
    for(const init of type.construction.initialization) {
      if(init.value)fieldStores.push({receiver,field:init.field,
        value:expression(init.value,'construction/'+type.construction.id+'/initialization/'+init.field,frame)});
      else if(init.binding)fieldStores.push({receiver,field:init.field,
        value:binding(frame,init.binding,type.fields.find(field=>field.id===init.field).type)});
    }
    if(type.construction.implicitForward) {
      const base=constructionFrame(types.get(type.base));copy(receiver,binding(base,base.parameters[0].id,base.parameters[0].type));
      type.construction.implicitForward.parameters.forEach(pair=>{
        const source=frame.parameters.find(parameter=>parameter.id===pair.source),target=base.parameters.find(parameter=>parameter.id===pair.target);
        copy(binding(frame,source.id,source.type),binding(base,target.id,target.type));
      });
    }
  }
  for(let cursor=0;cursor<tasks.length;cursor++) {
    charge();const {value:v,path:p,fn,guards}=tasks[cursor],id=p;
    const child=key=>expression(v[key],p+'/'+key,fn,guards);
    const children=key=>(v[key]??[]).map((value,index)=>expression(value,p+'/'+key+'/'+index,fn,guards));
    if(['constant','floating','boolean','undefined','null','stringLiteral'].includes(v.kind))insert(id,'actual',v.type);
    else if(v.kind==='reference')copy(binding(fn,v.binding,v.type),id,guards.get(v.binding));
    else if(['group','nonNull','assertType'].includes(v.kind))copy(child('operand'),id);
    else if(v.kind==='arrayCreate') {
      insert(id,'actual',v.type);insert(id,'owners',id);const element=owner(id,types.get(v.type).elementType);
      for(const elementValue of children('elements'))copy(elementValue,element);
    }else if(v.kind==='arrayReadChecked')reads.push({receiver:child('receiver'),index:child('index'),result:id});
    else if(v.kind==='arrayStoreDenseChecked') {
      const receiver=expression(v.target.receiver,p+'/target/receiver',fn,guards);
      expression(v.target.index,p+'/target/index',fn,guards);const value=child('value');
      stores.push({receiver,value});copy(value,id);
    }else if(v.kind==='assignment') {const value=child('value');copy(value,binding(fn,v.target.binding,v.target.type));copy(value,id);}
    else if(v.kind==='call') {
      const target=functions.get(v.target),arguments_=children('arguments');
      const receiver=v.receiver?child('receiver'):null;
      if(v.target===hir.intrinsics.readSpan.id) {
        insert(id,'actual',v.type);copy(arguments_[0],id,{ownerOnly:true});continue;
      }
      if(!target){insert(id,'pending','unresolved-call:'+id);continue;}
      if(receiver) {
        methodCalls.push({id,receiver,arguments:arguments_,member:v.target,
          viewType:types.get(v.receiver.type).kind==='reference'?v.receiver.type:target.ownerType,targets:new Map()});
        continue;
      }
      arguments_.forEach((argument,index)=>copy(argument,binding(target,target.parameters[index].id,target.parameters[index].type)));
      if(types.get(target.returnType.id).kind==='void')insert(id,'actual',target.returnType.id);else copy(returned(target),id);
    }else if(v.kind==='construct') {
      insert(id,'actual',v.type);const actual=types.get(v.type),target=constructionFrame(actual),arguments_=children('arguments');
      if(actual.kind==='reference')allocations.push({node:id,actualType:actual.id,state:'not-defined'});
      if(target) {
        copy(id,binding(target,target.parameters[0].id,target.parameters[0].type));
        arguments_.forEach((argument,index)=>copy(argument,binding(target,target.parameters[index+1].id,target.parameters[index+1].type)));
      }
    }else if(v.kind==='superConstruct') {
      const base=hir.types.find(type=>type.construction?.id===v.construction),target=constructionFrame(base);
      copy(binding(fn,v.receiverBinding,fn.ownerType),binding(target,target.parameters[0].id,target.parameters[0].type));
      children('arguments').forEach((argument,index)=>copy(argument,binding(target,target.parameters[index+1].id,target.parameters[index+1].type)));
      insert(id,'actual',v.type);
    }else if(v.kind==='propertyPresenceTest') {
      child('left');const receiver=child('right');insert(id,'actual',v.type);
      presenceTests.push({id,receiver,field:v.property,viewType:fieldOwners.get(v.property).owner,targets:new Map()});
    }else if(v.kind==='fieldAccess')fieldReads.push({id,receiver:child('receiver'),field:v.property,result:id,
      viewType:['reference','value'].includes(types.get(v.receiver.type).kind)?v.receiver.type:fieldOwners.get(v.property).owner,targets:new Map()});
    else if(v.kind==='fieldAssignment') {
      const receiver=expression(v.target.receiver,p+'/target/receiver',fn,guards),value=child('value');
      fieldStores.push({id,receiver,field:v.target.property,value,
        viewType:['reference','value'].includes(types.get(v.target.receiver.type).kind)?v.target.receiver.type:fieldOwners.get(v.target.property).owner,targets:new Map()});copy(value,id);
    }else if(['binary','shortCircuit'].includes(v.kind)&&v.operator==='??') {
      const left=child('left'),right=child('right');coalesces.push(left);
      copy(left,id,{presentOnly:true});copy(right,id,{gate:left});
    }else if(['binary','unary','shortCircuit','arrayLength','readSpanLength','arrayCompoundAssignment','arrayUpdate',
      'arrayResizeChecked','update','fieldUpdate','stringConcat'].includes(v.kind)) {
      // Results of approved operations are native/declared; dependent operand
      // domains are checked by the formal producer, never coerced here.
      for(const key of ['left','right','operand','receiver','index','value'])if(v[key])child(key);
      if(v.target)for(const key of ['receiver','index'])if(v.target[key])expression(v.target[key],p+'/target/'+key,fn,guards);
      children('arguments');for(const type of leaves(v.type))insert(id,'actual',type);
      if(v.kind==='arrayCompoundAssignment'||v.kind==='arrayUpdate') {
        const old=node(p+'/old-value',v.target.type).id;
        stores.push({receiver:p+'/target/receiver',value:id});reads.push({receiver:p+'/target/receiver',result:old});
      }
    }else insert(id,'pending','unsupported-expression:'+v.kind+':'+id);
  }
  // Actual fields are addressed by owned member identities. No name based
  // structural layout reconstruction is permitted at this seam.
  const fieldNode=(actual,field)=>node('field/'+actual+'/'+field.id,field.type).id;
  const actualField=actualFieldResolver(types,fieldViews,fieldOwners,charge);
  function actualMethod(actual,call) {
    const lineage=[];let type=types.get(actual);
    while(type){charge();if(lineage.includes(type.id))fail('inheritance cycle');lineage.unshift(type.id);type=types.get(type.base);}
    const effective=new Map();
    for(const owner of lineage)for(const id of types.get(owner).methods??[]) {
      charge();const fn=functions.get(id);if(fn.overrideTarget)effective.delete(fn.overrideTarget);effective.set(id,fn);
    }
    // Exact member/override identities can resolve inherited implementations;
    // unrelated structural views must use the selected M12 member mapping.
    let selected;
    for(const fn of effective.values()) {
      let current=fn;const seen=new Set();
      while(current){charge();if(seen.has(current.id))fail('override cycle');seen.add(current.id);
        if(current.id===call.member){if(selected)fail('ambiguous actual method');selected=fn;break;}
        current=functions.get(current.overrideTarget);}
    }
    return selected??functions.get(methodViews.get(actual+'\0'+call.viewType+'\0'+call.member));
  }
  // These are storage representation alternatives, not definedness events.
  // Only actual phase events publish defined-native-undefined. A quantified
  // definition frame is not an allocated or observed runtime instance.
  const storageTypes=new Set(allocations.map(row=>row.actualType));
  if(mode==='definition')for(const fn of callables)if(fn.role==='construction-body')
    for(const actual of nodes.get(binding(fn,fn.parameters[0].id,fn.parameters[0].type)).actual)storageTypes.add(actual);
  for(const actual of storageTypes) {
    let type=types.get(actual);
    while(type) {
      charge();for(const field of type.fields??[])insert(fieldNode(actual,field),'actual',undefinedId);
      type=type.base?types.get(type.base):null;
    }
  }
  for(const version of fieldReaching?.phaseWrites??[])for(const actual of version.actualTypes) {
    const field=fieldOwners.get(version.field).field,target=fieldNode(actual,field);
    if(version.state==='defined-native-undefined')insert(target,'actual',undefinedId);
    else if(version.node)copy(version.node,target);
  }
  let cursor=0;
  while(cursor<queue.length) {
    charge();const current=queue[cursor++];queued.delete(current);
    for(const [target,predicate] of edges.get(current))propagate(current,target,predicate);
    for(const edge of gates.get(current)??[]){charge();propagate(edge.from,edge.to,edge.predicate);}
    for(const call of methodCalls)if(call.receiver===current)for(const actual of nodes.get(current).actual) {
      charge();if(call.targets.has(actual))continue;const target=actualMethod(actual,call);
      if(!target){insert(call.id,'pending','unresolved-actual-method:'+actual+':'+call.member);continue;}
      call.targets.set(actual,target.id);
      // Each dispatch arm receives only its selected actual receiver. Copying
      // the entire static-view union into every arm would lose this authority.
      insert(binding(target,target.parameters[0].id,target.parameters[0].type),'actual',actual);
      // Source evaluates all arguments, including extras, before dispatch. Only
      // real selected-callee parameters receive slots; ignored extras retain
      // their expression/effect nodes and are never copied into invented binds.
      target.parameters.slice(1).forEach((parameter,index)=>{
        if(index<call.arguments.length)copy(call.arguments[index],binding(target,parameter.id,parameter.type));
        else insert(call.id,'pending','method-argument-default-domain:'+target.id+':'+index);
      });
      if(types.get(target.returnType.id).kind==='void')insert(call.id,'actual',target.returnType.id);
      else copy(returned(target),call.id);
    }
    for(const read of reads)if(read.receiver===current) {
      if(arrayReads.has(read.result))for(const source of arrayReads.get(read.result))copy(source,read.result);
      else if(arrayReaching)insert(read.result,'pending','unproved-ordered-array-read:'+read.result);
      else for(const allocation of nodes.get(current).owners)copy(owners.get(allocation),read.result);
    }
    for(const store of stores)if(store.receiver===current)for(const allocation of nodes.get(current).owners)
      copy(store.value,owners.get(allocation));
    for(const read of fieldReads)if(read.receiver===current)for(const actual of nodes.get(current).actual) {
      const field=actualField(actual,read.field,read.viewType);
      if(field?.missing){read.targets.set(actual,field);insert(read.result,'actual',undefinedId);}
      else if(field){read.targets.set(actual,field);
        const reaching=refinements.get(read.id)?.find(row=>row.actualType===actual&&row.field===field.id);
        if(reaching) {
          for(const source of reaching.sources)copy(source,read.result);
          if(reaching.intrinsics?.includes('undefined'))insert(read.result,'actual',undefinedId);
        }
        else copy(fieldNode(actual,field),read.result);}
      else insert(read.result,'pending','unresolved-actual-field:'+actual+':'+read.field);
    }
    for(const store of fieldStores)if(store.receiver===current)for(const actual of nodes.get(current).actual) {
      const field=actualField(actual,store.field,store.viewType);
      if(field&&!field.missing){store.targets?.set(actual,field);copy(store.value,fieldNode(actual,field));}
      else insert(store.value,'pending','unresolved-actual-field:'+actual+':'+store.field);
    }
    for(const test of presenceTests)if(test.receiver===current)for(const actual of nodes.get(current).actual) {
      const field=actualField(actual,test.field,test.viewType);
      if(field)test.targets.set(actual,field);else insert(test.id,'pending','unresolved-actual-field:'+actual+':'+test.field);
    }
  }
  const domains=new Map();
  function domain(actual) {
    const alternatives=[...actual].sort(),id=sha256('tsfg.actual-domain.v1\0'+canonical(alternatives));
    if(!domains.has(id)) {
      const selected=alternatives.map(id=>types.get(id)),native=selected.length===1&&selected[0].kind==='scalar';
      const reference=selected.length>0&&selected.every(type=>type.kind==='reference');
      const alignment=Math.max(1,...alternatives.map(id=>physical.get(id).alignment));
      const bytes=Math.max(0,...alternatives.map(id=>physical.get(id).byteSize));
      const union=alternatives.length>1&&!reference;
      domains.set(id,{id,actualTypes:alternatives,representation:alternatives.length===0?'bottom':native?'native':reference?'reference':selected.length===1
        ?['undefined','null','void'].includes(selected[0].kind)?'absence':'inline':'finite-union',
        nativeType:native?selected[0].name:null,alignment:union?Math.max(2,alignment):alignment,
        tagBytes:union?2:0,byteSize:union?Math.ceil((Math.ceil(2/alignment)*alignment+bytes)/Math.max(2,alignment))*Math.max(2,alignment):bytes,
        referenceCount:Math.max(0,...alternatives.map(id=>physical.get(id).referenceCount))});
    }return id;
  }
  const resultNodes=[...nodes.values()].map(row=>({id:row.id,viewType:row.viewType,domainId:domain(row.actual),
    arrayOwners:[...row.owners].sort(),pending:[...row.pending].sort()})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  // These canonical intermediate carriers serve compiler-derived presence
  // tests/refinements, not new actual seeds or fabricated Source literals.
  for(const left of coalesces){let remaining=[...nodes.get(left).actual].sort();
    for(const type of remaining.filter(absent)){charge();domain(new Set([type]));remaining=remaining.filter(id=>id!==type);domain(new Set(remaining));}}
  const byId=new Map(resultNodes.map(row=>[row.id,row]));
  const abi=callables.map(fn=>{
    const parameters=fn.parameters.map(parameter=>byId.get(binding(fn,parameter.id,parameter.type)).domainId);
    const result=fn.role==='construction-body'||types.get(fn.returnType.id).kind==='void'?null:byId.get(returned(fn)).domainId;
    return {functionId:fn.id,parameters,result,id:sha256('tsfg.finite-abi.v1\0'+canonical({parameters,result}))};
  });
  const published=hir.exports.map(row=>{
    const fn=functions.get(row.functionId),contract=abi.find(value=>value.functionId===fn.id);
    const value={functionId:fn.id,sourceSignature:fn.signatureHash,closureIdentity:hir.inputIdentity,
      parameterBounds:contract.parameters,resultBound:contract.result,abi:contract.id};
    return {...value,id:sha256('tsfg.published-call.v1\0'+canonical(value))};
  });
  const calls=methodCalls.map(call=>({id:call.id,member:call.member,viewType:call.viewType,
    targets:[...call.targets].sort(([a],[b])=>a<b?-1:1).map(([actualType,functionId])=>({actualType,functionId,
      signatureHash:functions.get(functionId).signatureHash,abi:abi.find(row=>row.functionId===functionId).id}))}));
  const fields=[...fieldReads.map(row=>({...row,kind:'read'})),...fieldStores.filter(row=>row.id).map(row=>({...row,kind:'store'})),
    ...presenceTests.map(row=>({...row,kind:'presence'}))]
    .map(row=>({id:row.id,kind:row.kind,member:row.field,viewType:row.viewType,
      targets:[...row.targets].sort(([a],[b])=>a<b?-1:1).map(([actualType,field])=>field.missing
        ?{actualType,missing:true,fieldType:undefinedId}:{actualType,fieldId:field.id,fieldType:field.type})}));
  return own({family:mode==='definition'?'tsfg.finite-definition-bounds-development':'tsfg.finite-actual-domains-development',version:1,
    inputIdentity:hir.inputIdentity,...(mode==='definition'?{definitionSeeds}:{}),published,aliases,calls,fields,allocations,intrinsics,
    domains:[...domains.values()].sort((a,b)=>a.id<b.id?-1:1),nodes:resultNodes,expressions,abi});
}
