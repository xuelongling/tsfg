// SPDX-License-Identifier: MIT
// Ordinary Core producer: verified HIR -> finite representation closure -> the
// existing SSA/CFG emitter. No source evaluator or executable private profile.
import descriptor from '../contracts/finite-core-development.json' with {type:'json'};
import {verifyHir} from './module-hir.mjs';
import {buildFiniteCoreDomains} from './finite-actual-domains.mjs';
import {buildFiniteFieldPhases} from './finite-field-phases.mjs';
import {finiteCallables,finiteCallableContracts} from './finite-callables.mjs';
import {isFiniteAbsence} from './finite-presence.mjs';
import {buildTypedLayouts} from './typed-layouts.mjs';
import {buildTypedReferenceViews} from './typed-reference-views.mjs';
import {coreExchangeFormat,coreQuote as quote,emitCoreSsaFunction} from './core-ssa-emitter.mjs';
import {canonical,sha256,scalarName,i32TypeId,boolTypeId} from './identity.mjs';
import {scalarOperations} from './scalar-operators.mjs';

function pending(message,range) {throw Object.assign(new TypeError('r03-finite-core-capability: '+message),
  {code:'r03-finite-core-capability',ruleId:'r01-ts-baseline',phase:'lowering',...(range?{primary:range}:{})});}

// Source DTO order used Source identities. This Core boundary orders already
// owned identities explicitly; rehashing an ID never preserves its old order.
function memberWitnessContracts(hir) {
  const order=(a,b)=>a<b?-1:a>b?1:0;
  return hir.compatibilityWitnesses.map(record=>({compatibility:{...record.compatibility,
    members:[...record.compatibility.members].sort((a,b)=>order(a.target,b.target))},
    dependencies:[...record.dependencies].sort((a,b)=>order(a.sourceType,b.sourceType)||order(a.targetType,b.targetType))}))
    .sort((a,b)=>{const x=a.compatibility,y=b.compatibility;
      return Buffer.compare(Buffer.from(x.origin.source),Buffer.from(y.origin.source))||x.origin.start-y.origin.start||x.origin.end-y.origin.end
        ||order(x.sourceType,y.sourceType)||order(x.targetType,y.targetType);});
}

export function emitFiniteCore(input,context,publicationContext=undefined) {
  const options={publicationContext},hir=verifyHir(input,context,publicationContext),proofs=buildFiniteCoreDomains(hir,context,options),plan=proofs.definition;
  const fieldPhases=buildFiniteFieldPhases(hir,context,options);
  const domains=new Map(plan.domains.map(row=>[row.id,row])),nodes=new Map(plan.carrierNodes.map(row=>[row.id,row]));
  const occurrences=new Map(plan.expressions.map(row=>[row.id,row]));
  const arrayWrites=new Map(plan.arrayReaching.writes.map(row=>[row.id,row]));
  const types=new Map([...hir.types,...plan.intrinsics].map(type=>[type.id,type]));
  const selected=id=>{const row=nodes.get(id);if(!row)pending('missing domain '+id);
    if(row.pending.length)pending(row.pending.join(', '));
    if(!domains.get(row.domainId).actualTypes.length)pending('unreached domain '+id);return row;};
  const coreType=id=>{
    const scalar=scalarName(id),domain=domains.get(id);
    const native=scalar??domain?.nativeType;
    if(native)return native==='bool'?'i1':['i32','f32','f64'].includes(native)?native:`!tsfg_core.integer<${quote(native)}>`;
    if(domain?.actualTypes.length===1&&types.get(domain.actualTypes[0]).kind==='string')return '!tsfg_string.string';
    if(!domain)pending('unknown Core domain '+id);return '!tsfg_core.domain<'+quote(id)+'>';
  };
  function adapt(value,path,fn) {
    const result={...value,type:selected(path).domainId,semanticType:value.type,domainNode:path};
    if(value.kind==='binary'&&['&&','||'].includes(value.operator))result.kind='shortCircuit';
    for(const key of ['operand','receiver','index','value','left','right','target'])if(value[key]&&typeof value[key]==='object') {
      // Targets describe locations, not produced SSA values.
      if(key==='target')result.target={...value.target,...Object.fromEntries(['receiver','index'].filter(key=>value.target[key])
        .map(key=>[key,adapt(value.target[key],path+'/target/'+key,fn)]))};
      else result[key]=adapt(value[key],path+'/'+key,fn);
    }
    for(const key of ['arguments','elements'])if(value[key])result[key]=value[key].map((child,index)=>adapt(child,path+'/'+key+'/'+index,fn));
    return result;
  }
  const wrap=(value,type)=>value.type===type?value:{kind:'finiteAdapt',operand:value,type,semanticType:value.semanticType,range:value.range};
  function body(values,path,fn) {
    return values.map((value,index)=>{
      const p=path+'/'+index,result={...value};
      if(value.kind==='local') {
        result.binding={...value.binding,type:selected(fn.id+'/binding/'+value.binding.id).domainId};
        result.initializer=wrap(adapt(value.initializer,p+'/initializer',fn),result.binding.type);
      }else if(value.kind==='return'||value.kind==='constructorReturn') {
        if(value.value) {
          const expression=adapt(value.value,p+'/value',fn);
          result.value=fn.role!=='construction-body'&&types.get(fn.returnType.id).kind==='void'
            ?expression:wrap(expression,selected(fn.id+'/return').domainId);
        }
      }else if(value.kind==='expression')result.value=adapt(value.expression,p+'/expression',fn);
      if(value.condition)result.condition=adapt(value.condition,p+'/condition',fn);
      if(value.then)result.thenBody=body(value.then,p+'/then',fn);
      if(value.else)result.elseBody=body(value.else,p+'/else',fn);
      if(value.body)result.body=body(value.body,p+'/body',fn);
      return result;
    });
  }
  const symbol=fn=>'f'+fn.id.slice(7);
  let work=100000,bytes=0;
  const budget={step(){if(--work<0)pending('work limit');},register(count){if(count>4096)pending('register limit');},
    block(count){if(count>4096)pending('block limit');},parameters(count){if(count>256)pending('parameter limit');},
    line(line){bytes+=Buffer.byteLength(line)+1;if(bytes>8388608)pending('Core byte limit');}};
  // Every definition consumes its quantified ABI upper bound. The reached
  // ledger remains separate; no definition seed is a runtime instance claim.
  const functions=finiteCallables(hir).map(original=>{
    const voidResult=original.role==='construction-body'||types.get(original.returnType.id).kind==='void';
    const fn={...original,parameters:original.parameters.map(parameter=>({...parameter,
      type:selected(original.id+'/binding/'+parameter.id).domainId})),
      returnType:{...original.returnType,id:voidResult?original.returnType.id:selected(original.id+'/return').domainId},
      body:body(original.body,original.id+'/body',original)};
    const abi=plan.abi.find(row=>row.functionId===fn.id);
    const opAttrs=value=>`view_type = ${quote(value.semanticType)}, domain = ${quote(value.type)}`;
    const op=(api,name,values,result,attrs,range)=>api.operation('tsfg_core.domain.'+name,values.map(value=>value.name),
      values.map(value=>value.type),result,attrs,range);
    function fieldDispatch(value) {
      const selection=plan.carrierFields.find(row=>row.id===value.domainNode);
      if(!selection?.targets.length)pending('missing actual field targets',value.range);
      const reaching=plan.fieldReaching.reads.find(row=>row.node===value.domainNode);
      const versions=selection.kind==='store'?plan.fieldReaching.writes.filter(row=>row.node===value.domainNode+'/value'):[];
      return `member = ${quote(selection.member)}, receiver_view = ${quote(selection.viewType)}, field_dispatch = ${quote(canonical(selection.targets))}`
        +(reaching?.reaching.length?`, field_reaching = ${quote(canonical(reaching))}`:'')
        +(selection.kind==='store'?`, memory_node = ${quote(value.domainNode)}, input_node = ${quote(value.domainNode+'/value')}, field_versions = ${quote(canonical(versions))}`:'');
    }
    function initializeFields(statement,api) {
      const parameter=fn.parameters[0],receiver={name:api.lookup(parameter.id),type:parameter.type};
      const owner=types.get(statement.ownerType),phase=fieldPhases.find(row=>row.constructionId===statement.construction);
      // The marker binds the independently verified sequence; the initializer
      // trees below are ordinary SSA code, never a Runtime AST evaluator.
      op(api,'initialize_fields',[receiver],null,`construction = ${quote(statement.construction)}, owner_type = ${quote(statement.ownerType)}, field_plan = ${quote(canonical(phase))}`,statement.origin);
      for(const event of phase.events) {
        const output=event.output,attrs=`construction = ${quote(statement.construction)}, owner_type = ${quote(statement.ownerType)}, member = ${quote(output.field)}, ordinal = ${event.ordinal} : i64, field_version = ${quote(output.id)}`;
        if(event.kind==='nativeDefine') {
          op(api,'field_define',[receiver],null,attrs,output.origin);continue;
        }
        let value;
        if(event.kind==='initializerWrite') {
          const init=owner.construction.initialization.find(row=>row.field===output.field&&row.value);
          const expression=adapt(init.value,output.valueNode,original);
          value={name:api.emit(expression),type:expression.type};
        }else {
          const source=fn.parameters.find(row=>row.id===output.parameterBinding);
          if(!source)pending('missing construction parameter binding',output.origin);
          value={name:api.lookup(source.id),type:source.type};
        }
        op(api,'field_initialize',[receiver,value],null,attrs+`, input_domain = ${quote(value.type)}`,output.origin);
      }
    }
    const emission=emitCoreSsaFunction(fn,{verified:hir,coreType,functionSymbol:symbol,budget,
      ...(voidResult?{resultType:'()',emitFallthrough:api=>api.returnValue(null,null,fn.range)}:{}),
      emitStatementLeaf(statement,api) {
        if(statement.kind==='forwardBaseConstruction') {
          const target=hir.types.find(type=>type.construction?.id===statement.construction),
            callee=target.constructor??target.construction.id,targetAbi=plan.abi.find(row=>row.functionId===callee),
            receiver={name:api.lookup(statement.receiverBinding),type:fn.parameters[0].type},args=[];
          for(const [index,argument] of statement.arguments.entries()) {
            const parameter=fn.parameters.find(row=>row.id===argument.binding),type=targetAbi.parameters[index+1];
            let name=api.lookup(argument.binding);
            if(parameter.type!==type)name=op(api,'view',[{name,type:parameter.type}],type,
              `view_type = ${quote(argument.type)}, domain = ${quote(type)}`,statement.origin);
            args.push({name,type});
          }
          op(api,'super',[receiver,...args],null,`view_type = ${quote(target.id)}, construction = ${quote(statement.construction)}, implicit_forward = ${quote(canonical(types.get(original.ownerType).construction.implicitForward))}`,statement.origin);
          return true;
        }
        if(statement.kind==='initializeOwnFields') {
          initializeFields(statement,api);return true;
        }
        if(statement.kind==='return'||statement.kind==='constructorReturn') {
          if(voidResult) {
            if(statement.value) {
              if(original.role==='construction-body')pending('explicit constructor object completion requires receiver replacement',statement.range);
              api.emit(statement.value);
            }
            api.returnValue(null,null,statement.range);return true;
          }
          api.returnValue(statement.value?api.emit(statement.value):null,fn.returnType.id,statement.range);return true;
        }
        return false;
      },
      emitValueLeaf(value,api) {
        const evaluated=child=>({name:api.emit(child),type:child.type});
        const view=(operand,attrs='')=>op(api,'view',[evaluated(operand)],value.type,
          (attrs?attrs+', ':'')+opAttrs(value),value.range);
        if(value.kind==='reference') {
          const parameter=fn.parameters.find(row=>row.id===value.binding),bound=nodes.get(fn.id+'/binding/'+value.binding);
          const type=parameter?.type??bound?.domainId;
          if(type===value.type)return api.lookup(value.binding);
          const proof=occurrences.get(value.domainNode)?.presenceProof;
          return op(api,proof?'refine':'view',[{name:api.lookup(value.binding),type}],value.type,opAttrs(value)
            +(proof?', presence_proof = '+quote(canonical(proof)):''),value.range);
        }
        if(['finiteAdapt','group','nonNull','assertType'].includes(value.kind))return view(value.operand,
          value.compatibilityRoots?'compatibility_roots = '+quote(canonical(value.compatibilityRoots)):'');
        if(['constant','floating','boolean'].includes(value.kind)) {
          const domain=domains.get(value.type);if(domain.representation!=='native')pending('literal domain',value.range);
          const attribute=value.kind==='floating'?quote(value.bits):value.kind==='boolean'?`${Number(value.value)} : i1`
            :domain.nativeType==='i32'?`${value.decimal} : i32`:quote(value.decimal);
          return api.operation('tsfg_core.constant',[],[],value.type,'value = '+attribute,value.range);
        }
        if(value.kind==='stringLiteral')return api.operation('tsfg_string.constant',[],[],value.type,
          'code_units = array<i32'+(value.codeUnits.length?': '+value.codeUnits.join(', '):'')+'>',value.range);
        if(value.kind==='stringConcat') {
          if([value.left,value.right].some(operand=>domains.get(operand.type).actualTypes.some(id=>types.get(id).kind!=='string')))
            pending('String operation-domain-check mapping',value.range);
          return api.operation('tsfg_string.concat',[api.emit(value.left),api.emit(value.right)],[value.left.type,value.right.type],value.type,
            `tsfg_source.operator_start = ${value.operatorRange.start} : i64, tsfg_source.operator_end = ${value.operatorRange.end} : i64`,value.range);
        }
        if(['undefined','null'].includes(value.kind))return op(api,'literal',[],value.type,opAttrs(value),value.range);
        if(value.kind==='arrayCreate')return op(api,'array_create',value.elements.map(evaluated),value.type,
            opAttrs(value)+', owner = '+quote(value.domainNode)+', element_domain = '+quote(selected(value.domainNode+'/elements').domainId)
              +', array_versions = '+quote(canonical(value.elements.map((_,index)=>arrayWrites.get(value.domainNode+'/initial/'+index+'/array-version')))),value.range);
          if(value.kind==='arrayReadChecked')return op(api,'array_read',[evaluated(value.receiver),evaluated(value.index)],value.type,opAttrs(value)+', array_node = '+quote(value.domainNode),value.range);
        if(value.kind==='arrayLength'||value.kind==='readSpanLength')return op(api,'array_length',[evaluated(value.receiver)],value.type,opAttrs(value),value.range);
        if(value.kind==='arrayResizeChecked') {
          const receiver=evaluated(value.target.receiver),rhs=evaluated(value.value);
          op(api,'array_resize',[receiver,rhs],null,`view_type = ${quote(value.target.receiver.semanticType)}`,value.range);return rhs.name;
        }
        if(value.kind==='arrayStoreDenseChecked') {
          const receiver=evaluated(value.target.receiver),index=evaluated(value.target.index),rhs=evaluated(value.value);
            op(api,'array_store',[receiver,index,rhs],null,`view_type = ${quote(value.target.receiver.semanticType)}, array_node = ${quote(value.domainNode)}, array_versions = ${quote(canonical([arrayWrites.get(value.domainNode+'/array-version')]))}`,value.range);
          return rhs.name;
        }
        if(value.kind==='arrayCompoundAssignment'||value.kind==='arrayUpdate') {
          const receiver=evaluated(value.target.receiver),index=evaluated(value.target.index);
          const oldType=selected(value.domainNode+'/old-value').domainId;
            const old=op(api,'array_read',[receiver,index],oldType,`view_type = ${quote(value.semanticType)}, array_node = ${quote(value.domainNode+'/old-value')}`,value.target.range);
          const domain=domains.get(oldType);if(domain.representation!=='native')pending('operation-domain-check mapping',value.range);
          const rhs=value.kind==='arrayUpdate'?{name:api.operation('tsfg_core.constant',[],[],oldType,
            domain.nativeType==='i32'?'value = 1 : i32':domain.nativeType==='f32'?'value = "3f800000"'
              :domain.nativeType==='f64'?'value = "3ff0000000000000"':'value = "1"',value.range),type:oldType}:evaluated(value.value);
          const operator=value.kind==='arrayUpdate'?(value.operator==='++'?'+':'-'):value.operator.slice(0,-1);
          const next=api.operation('tsfg_core.'+scalarOperations[operator],[old,rhs.name],[oldType,rhs.type],value.type,'',value.range);
            op(api,'array_store',[receiver,index,{name:next,type:value.type}],null,`view_type = ${quote(value.target.receiver.semanticType)}, array_node = ${quote(value.domainNode)}, array_versions = ${quote(canonical([arrayWrites.get(value.domainNode+'/array-version')]))}`,value.range);
          return value.kind==='arrayUpdate'&&!value.prefix?old:next;
        }
        if(value.kind==='assignment') {
          const target=selected(fn.id+'/binding/'+value.target.binding).domainId;
          const rhs=api.emit(wrap(value.value,target));api.assign(value.target.binding,rhs);return rhs;
        }
        if(['binary','shortCircuit'].includes(value.kind)&&value.operator==='??') {
          let left=evaluated(value.left),alternatives=domains.get(left.type).actualTypes,
            previous=null;
          const anchor=value.operatorRange??value.range,
            absent=alternatives.filter(id=>{budget.step();return isFiniteAbsence(types.get(id).kind);}),
            present=alternatives.filter(id=>{budget.step();return !absent.includes(id);}),
            domainFor=ids=>{const id=sha256('tsfg.actual-domain.v1\0'+canonical([...ids].sort()));
              if(!domains.has(id))pending('missing nullish intermediate carrier',anchor);return id;},
            widen=payload=>payload.type===value.type?payload.name:api.operation('tsfg_core.domain.view',
              [payload.name],[payload.type],value.type,opAttrs(value),value.range),
            filter=()=>{if(previous===null)return;alternatives=alternatives.filter(id=>{budget.step();return id!==previous;});
              const target=domainFor(alternatives),proof={type:previous,equal:false,range:anchor};
              left={name:api.operation('tsfg_core.domain.refine',[left.name],[left.type],target,
                `view_type = ${quote(value.semanticType)}, domain = ${quote(target)}, presence_proof = ${quote(canonical(proof))}`,anchor),type:target};
              previous=null;};
          if(!absent.length)return widen(left);
          if(!present.length)return widen(evaluated(value.right));
          const predicates=absent.map(type=>()=>{
            filter();previous=type;const literalType=domainFor([type]),
              literal=api.operation('tsfg_core.domain.literal',[],[],literalType,
                `view_type = ${quote(type)}, domain = ${quote(literalType)}`,anchor);
            return api.operation('tsfg_core.domain.presence_equal',[left.name,literal],[left.type,literalType],boolTypeId,
              'operator = "!=="',anchor);
          });
          return api.branchValue(predicates,value.type,value.range,
            ()=>{filter();return widen(left);},()=>widen(evaluated(value.right)));
        }
        if(value.kind==='binary'||value.kind==='unary') {
          const operands=value.kind==='binary'?[value.left,value.right]:[value.operand];
          if(value.kind==='unary'&&value.operator==='+'&&domains.get(value.operand.type).representation==='native'
            &&!['f32','f64'].includes(domains.get(value.operand.type).nativeType))return api.emit(value.operand);
          if(value.kind==='binary'&&['===','!=='].includes(value.operator)&&operands.some(operand=>domains.get(operand.type).actualTypes
            .every(id=>['null','undefined'].includes(types.get(id).kind))))
            return op(api,'presence_equal',operands.map(evaluated),value.type,'operator = '+quote(value.operator),value.range);
          if(value.kind==='binary'&&['===','!=='].includes(value.operator)&&operands.every(operand=>domains.get(operand.type).actualTypes
            .every(id=>types.get(id).kind==='string'))) {
            const compared=api.operation('tsfg_string.compare',operands.map(operand=>api.emit(operand)),operands.map(operand=>operand.type),i32TypeId,'',value.range);
            const zero=api.operation('tsfg_core.constant',[],[],i32TypeId,'value = 0 : i32',value.range);
            return api.operation('tsfg_core.'+(value.operator==='==='?'eq':'ne'),[compared,zero],[i32TypeId,i32TypeId],value.type,'',value.range);
          }
          if(value.kind==='binary'&&['===','!=='].includes(value.operator)&&operands.every(operand=>domains.get(operand.type).actualTypes
            .every(id=>['reference','array','null','undefined'].includes(types.get(id).kind))))
            return op(api,'identity_equal',operands.map(evaluated),value.type,'operator = '+quote(value.operator),value.range);
          if(operands.some(operand=>domains.get(operand.type).representation!=='native'))pending('operation-domain-check mapping',value.range);
          const values=operands.map(evaluated),name=value.kind==='binary'?scalarOperations[value.operator]
            :({'+':'pos','-':'neg','~':'not','!':'bool_not'})[value.operator];
          if(!name)pending('unmodeled native operator '+value.operator,value.range);
          return api.operation('tsfg_core.'+name,values.map(row=>row.name),values.map(row=>row.type),value.type,'',value.range);
        }
        if(value.kind==='call') {
          if(value.target===hir.intrinsics.readSpan.id)return op(api,'read_span',value.arguments.map(evaluated),value.type,opAttrs(value),value.range);
          if(value.receiver) {
            const dispatch=plan.carrierCalls.find(row=>row.id===value.domainNode);
            if(!dispatch?.targets.length)pending('missing actual method targets',value.range);
            const values=[evaluated(value.receiver),...value.arguments.map(evaluated)];
            const zero=dispatch.targets.every(row=>plan.abi.find(abi=>abi.functionId===row.functionId).result===null);
            return op(api,'method_call',values,zero?null:value.type,opAttrs(value)
              +`, member = ${quote(dispatch.member)}, receiver_view = ${quote(dispatch.viewType)}, dispatch = ${quote(canonical(dispatch.targets))}`,value.range);
          }
          const target=hir.functions.find(fn=>fn.id===value.target),targetAbi=plan.abi.find(row=>row.functionId===value.target);
          const args=value.arguments.map((argument,index)=>evaluated(wrap(argument,targetAbi.parameters[index])));
          return api.operation('func.call',args.map(row=>row.name),args.map(row=>row.type),targetAbi.result===null?null:value.type,
            `callee = @${quote(symbol(target))}, tsfg_core.function_id = ${quote(target.id)}, tsfg_core.signature_hash = ${quote(target.signatureHash)}, tsfg_core.finite_abi = ${quote(targetAbi.id)}`,value.range);
        }
        if(value.kind==='construct')return op(api,'construct',value.arguments.map(evaluated),value.type,
          opAttrs(value)+', construction = '+quote(value.construction),value.range);
        if(value.kind==='superConstruct') {
          const receiver={name:api.lookup(value.receiverBinding),type:fn.parameters[0].type};
          op(api,'super',[receiver,...value.arguments.map(evaluated)],null,
            `view_type = ${quote(value.semanticType)}, construction = ${quote(value.construction)}`,value.range);
          const after=value.afterSuccess;
          initializeFields(after,api);
          return null;
        }
        if(value.kind==='fieldAccess')return op(api,'field_read',[evaluated(value.receiver)],value.type,
          opAttrs(value)+', '+fieldDispatch(value),value.range);
        if(value.kind==='fieldAssignment') {
          const receiver=evaluated(value.target.receiver),rhs=evaluated(value.value);
          op(api,'field_store',[receiver,rhs],null,`view_type = ${quote(value.target.receiver.semanticType)}, `+fieldDispatch(value),value.range);return rhs.name;
        }
        if(value.kind==='shortCircuit')return undefined; // shared SSA control.
        pending('operation '+value.kind,value.range);
      }});
    const attrs=`tsfg_core.function_id = ${quote(fn.id)}, tsfg_core.signature_hash = ${quote(fn.signatureHash)}, tsfg_core.finite_abi = ${quote(abi.id)}, tsfg_source.path = ${quote(fn.sourcePath)}`
      +(original.role==='construction-body'?`, tsfg_core.construction = ${quote(original.construction)}, tsfg_core.owner_type = ${quote(original.ownerType)}, tsfg_core.receiver_binding = ${quote(original.parameters[0].id)}`:'');
    return `  func.func @${quote(symbol(fn))}(${emission.entryParameters.map(row=>row.name+': '+coreType(row.type)).join(', ')}) -> ${emission.resultType} attributes {${attrs}} {\n${emission.blocksText}\n  }`;
  });
  const attrs={version:coreExchangeFormat.version,bytecode_schema:coreExchangeFormat.bytecodeSchema,input_identity:hir.inputIdentity,
    finite_contract:sha256(canonical(descriptor)+'\n'),finite_domains:canonical(plan),semantic_types:canonical(hir.types),
    reached_domains:canonical(proofs.reached),
    language_intrinsics:canonical(plan.intrinsics),
    source_closure:canonical(hir.sources),canonical_layouts:canonical(buildTypedLayouts(hir,context,options)),
    callable_contracts:canonical(finiteCallableContracts(hir)),
    source_exports:canonical(hir.exports),
    entry_compatibility_roots:canonical(hir.entryCompatibilityRoots.map(row=>({...row,roots:[...row.roots]
      .sort((a,b)=>a.sourceType<b.sourceType?-1:a.sourceType>b.sourceType?1:a.targetType<b.targetType?-1:a.targetType>b.targetType?1:0)}))
      .sort((a,b)=>a.functionId<b.functionId?-1:a.functionId>b.functionId?1:a.parameterBinding<b.parameterBinding?-1:a.parameterBinding>b.parameterBinding?1:0)),
    compatibility_witnesses:canonical(memberWitnessContracts(hir)),
    field_phases:canonical(fieldPhases),
    array_reaching:canonical(plan.arrayReaching),
    member_views:canonical(buildTypedReferenceViews(hir,context,options)),target:hir.target.target,triple:hir.target.triple,data_layout:hir.target.llvmDataLayout};
  const result='module attributes {'+Object.entries(attrs).map(([key,value])=>'tsfg_core.'+key+' = '+quote(value)).join(', ')+'} {\n'+functions.join('\n')+'\n}\n';
  if(Buffer.byteLength(result)>8388608)pending('Core byte limit');return result;
}
