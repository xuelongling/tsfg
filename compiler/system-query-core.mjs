// SPDX-License-Identifier: MIT
// Lower immutable owned Query facts, never upstream AST or JS evaluation.
import {printSystemQueryFacts} from './system-query-facts.mjs';
import {commonTextBudget} from './common-program-budget.mjs';
import {functionId,signatureId} from './module-callable-common.mjs';
import {canonical,sha256,scalarTypeIds} from './identity.mjs';
/** @param {import('./system-query-facts.mjs').SystemQuerySelection} query */
export const systemQueryTypeId=query=>sha256('tsfg.query.type.v1\0'+canonical(query.items.map(item=>({componentType:item.componentType,mode:item.mode}))));

/** @param {import('./system-query-facts.mjs').SystemQueryFacts} facts @param {unknown} context */
export function emitSystemQueryCore(facts,context){
  const original=printSystemQueryFacts(facts,context),packet=JSON.parse(original.toString('utf8'));
  const request={family:'tsfg.system-query-facts-request-candidate',version:6,schemaHash:facts.format.schemaHash,
    input:{sourceRoot:facts.program.sourceRoot,rootFile:facts.program.rootFile,files:facts.program.files.map(({path,content,sha256})=>({path,content,sha256})),declarations:facts.program.declarations,config:facts.program.config,target:facts.program.target}};
  let remaining=1000000,serial=0;
  const spend=(n=1)=>{remaining-=n;if(remaining<0)throw new TypeError('r10-query-core-budget: lowering work exceeded');};
  const text=commonTextBudget(spend,8388608),quote=text.quote,line=text.line;
  const anchor=range=>'tsfg_source.start = '+range.start+' : i64, tsfg_source.end = '+range.end+' : i64';
  const fail=(owner,range,detail)=>{throw Object.assign(new TypeError('r10-query-core-capability: '+detail),{code:'r10-query-core-capability',phase:'lowering',sourcePath:owner.declaration.sourcePath,range});};
  const scalar=new Map(Object.entries(scalarTypeIds).map(([name,id])=>[id,name==='i32'?'i32':name==='bool'?'i1':['f32','f64'].includes(name)?name:'!tsfg_core.integer<'+quote(name)+'>']));
  const query=id=>'!tsfg.query<'+quote(id)+'>',chunk=id=>'!tsfg.chunk<'+quote(id)+'>',view=(id,mode)=>'!tsfg.view<'+quote(id+'#'+mode)+'>';
  const source=facts.program.files.find(row=>row.path===facts.program.rootFile);
  const attrs={'tsfg_core.version':'0.12.0','tsfg_core.bytecode_schema':'sha256:fec456a47f509480d96f65e5c03d465c7c204d60f09630e71b19c714d4aaafa7',
    'tsfg_core.input_identity':facts.inputIdentity,'tsfg_core.source_path':source.path,'tsfg_core.source_hash':'sha256:'+source.sha256,
    'tsfg_core.source_length':source.utf16Length,'tsfg_core.target':facts.program.target.target,'tsfg_core.triple':facts.program.target.triple,'tsfg_core.data_layout':facts.program.target.llvmDataLayout,
    'tsfg.query_version':3,'tsfg.query_stage':'logical','tsfg.query_facts':canonical(packet),'tsfg.query_request':canonical(request)};
  line('module attributes {',Object.entries(attrs).map(([key,value])=>key+' = '+(typeof value==='number'?value+(key==='tsfg.query_version'?' : i32':' : i64'):quote(value))).join(', '),'} {');
  /** @param {import('./system-query-facts.mjs').SystemQueryLoopExpression} value */
  function expression(value,bindings,owner,indent){
    spend();
    const emit=(op,args,type,properties,range)=>{
      const name=type?'%qv'+serial++:null;
      line(indent,name?name+' = ':'',quote(op),'(',args.map(row=>row.name).join(', '),') {',properties?properties+', ':'',anchor(range),'} : (',args.map(row=>row.type).join(', '),') -> ',type??'()');
      return name?{name,type,semantic:value.type,binding:''}:null;
    };
    if(value.kind==='bindingReference')return bindings.get(value.binding);
    if(value.kind==='numericLiteral')return emit('tsfg_core.constant',[],value.sourceType,'value = '+quote(value.bits),value.range);
    if(value.kind==='parentheses')return expression(value.expression,bindings,owner,indent);
    if(value.kind==='call'){
      const helper=facts.scalarHelpers.find(helper=>helper.id===value.callee);
      const args=value.arguments.map((value,index)=>{
        const actual=expression(value,bindings,owner,indent),formal=helper.parameters[index];
        if(formal.view&&actual.mode!==formal.view.access.mode){
          const borrowed=emit('tsfg.view_borrow',[actual],view(formal.type,formal.view.access.mode),'component_type = '+quote(formal.type)+', mode = '+quote(formal.view.access.mode),value.range);
          return {...borrowed,semantic:formal.type,mode:formal.view.access.mode};
        }
        return actual;
      });
      return emit('func.call',args,value.sourceType,'callee = @'+quote('query_helper_'+value.callee.slice(7))+', tsfg_core.function_id = '+quote(value.callee)+', tsfg_core.signature_hash = '+quote(value.signatureHash)+
        ', tsfg.query_source_callee = '+quote(value.sourceCallee)+', callee_start = '+value.calleeRange.start+' : i64, callee_end = '+value.calleeRange.end+' : i64',value.range);
    }
    const field=value=>{
      const receiver=bindings.get(value.receiver.binding);if(!receiver)fail(owner,value.range,'field receiver is not the actual tuple binding');
      return {receiver,properties:'component_type = '+quote(receiver.semantic)+', field = '+quote(value.property)+', source_field = '+quote(value.sourceField)};
    };
    if(value.kind==='fieldAccess'){const selected=field(value);return emit('tsfg.field_load',[selected.receiver],value.sourceType,selected.properties,value.range);}
    if(value.kind==='binary'){
      const left=expression(value.left,bindings,owner,indent),right=expression(value.right,bindings,owner,indent),op={'+':'add','-':'sub','*':'mul','/':'div'}[value.operator];
      if(!op)fail(owner,value.operatorRange,'unsupported floating-point operator');return emit('tsfg_core.'+op,[left,right],value.sourceType,'operator_start = '+value.operatorRange.start+' : i64, operator_end = '+value.operatorRange.end+' : i64',value.range);
    }
    if(value.kind==='bindingAssignment'){
      const op={'+=':'add','-=':'sub','*=':'mul','/=':'div'}[value.operator],previous=op?bindings.get(value.target.binding):null;
      const rhs=expression(value.value,bindings,owner,indent),result=previous?emit('tsfg_core.'+op,[previous,rhs],value.sourceType,'operator_start = '+value.operatorRange.start+' : i64, operator_end = '+value.operatorRange.end+' : i64',value.range):rhs;
      bindings.set(value.target.binding,result);return result;
    }
    if(value.kind==='fieldAssignment'){
      const selected=field(value.target),op={'+=':'add','-=':'sub','*=':'mul','/=':'div'}[value.operator];
      const previous=op?emit('tsfg.field_load',[selected.receiver],value.sourceType,selected.properties,value.target.range):null;
      const rhs=expression(value.value,bindings,owner,indent),result=previous?emit('tsfg_core.'+op,[previous,rhs],value.sourceType,'operator_start = '+value.operatorRange.start+' : i64, operator_end = '+value.operatorRange.end+' : i64',value.range):rhs;
      emit('tsfg.field_store',[selected.receiver,result],null,selected.properties,value.range);return result;
    }
    fail(owner,value.range,'unsupported owned Query expression');
  }
  function statement(value,bindings,owner,indent){
    if(value.kind==='constDeclaration'||value.kind==='letDeclaration'){
      const result=expression(value.initializer,bindings,owner,indent);bindings.set(value.binding,result);return result;
    }
    return expression(value.value,bindings,owner,indent);
  }
  for(const system of facts.systems){
    spend();if(system.sourceReturnType!=='void')fail(system,system.bodyRange,'system return must be void');
    const parameters=system.parameters.map(parameter=>{const semantic=parameter.query?systemQueryTypeId(parameter.query):parameter.type,type=parameter.query?query(semantic):scalar.get(semantic);
      if(!type)fail(system,parameter.binding.range,'ordinary system parameter has no selected scalar Core type');return {name:'%arg'+parameter.index,type,semantic,binding:parameter.binding.id,mode:null};});
    const signature={parameters:parameters.map(row=>row.semantic),returns:system.returnType},id=functionId(system.declaration.sourcePath,canonical({path:[],kind:'function',name:system.declaration.name}),signature);
    line('  func.func @',quote('query_'+id.slice(7)),'(',parameters.map(row=>row.name+': '+row.type).join(', '),') attributes {tsfg_core.function_id = ',quote(id),', tsfg_core.signature_hash = ',quote(signatureId(signature)),', tsfg.query_source_function = ',quote(system.declaration.id),', tsfg_source.path = ',quote(system.declaration.sourcePath),', ',anchor(system.declaration.range),'} {');
    for(const loop of system.loops){
      spend();const parameter=parameters.find(row=>row.binding===loop.queryBinding),selection=system.parameters.find(row=>row.binding.id===loop.queryBinding).query,selectionId=systemQueryTypeId(selection),queryName='%query'+serial,chunkName='%chunk'+serial,countName='%count'+serial,rowName='%row'+serial++;
      line('    ',queryName,' = "tsfg.query"(',parameter.name,') {source_binding = ',quote(loop.queryBinding),', ',anchor(loop.queryRange),'} : (',parameter.type,') -> ',query(selectionId));
      line('    "tsfg.chunk"(',queryName,') ({');line('    ^bb0(',chunkName,': ',chunk(selectionId),', ',countName,': index):');
      line('      "tsfg.parallel_for"(',chunkName,', ',countName,') ({');line('      ^bb0(',rowName,': index):');
      const bindings=new Map(parameters.map(row=>[row.binding,row]));
      for(const binding of loop.bindings){const name='%column'+serial++,type=view(binding.componentType,binding.mode);bindings.set(binding.declaration.id,{name,type,semantic:binding.componentType,binding:binding.declaration.id,mode:binding.mode});
        line('        ',name,' = "tsfg.column"(',chunkName,', ',rowName,') {component_type = ',quote(binding.componentType),', mode = ',quote(binding.mode),', source_binding = ',quote(binding.declaration.id),', tuple_index = ',String(binding.index),' : i64, ',anchor(binding.declaration.range),'} : (',chunk(selectionId),', index) -> ',type);}
      for(const value of loop.statements)statement(value,bindings,system,'        ');
      line('        "tsfg.yield"() : () -> ()');line('      }) {',anchor(loop.range),'} : (',chunk(selectionId),', index) -> ()');line('      "tsfg.yield"() : () -> ()');line('    }) {',anchor(loop.range),'} : (',query(selectionId),') -> ()');
    }
    line('    func.return');line('  }');
  }
  for(const helper of facts.scalarHelpers){
    const parameters=helper.parameters.map(parameter=>({name:'%harg'+parameter.index,type:parameter.view?view(parameter.type,parameter.view.access.mode):parameter.logicalType,semantic:parameter.type,binding:parameter.binding.id,mode:parameter.view?.access.mode??null}));
    line('  func.func @',quote('query_helper_'+helper.id.slice(7)),'(',parameters.map(row=>row.name+': '+row.type).join(', '),') -> ',helper.sourceReturnType,' attributes {tsfg_core.function_id = ',quote(helper.id),', tsfg_core.signature_hash = ',quote(helper.signatureHash),', tsfg.query_source_function = ',quote(helper.declaration.id),', tsfg.query_source_helper = ',quote(helper.sourceId),', tsfg_source.path = ',quote(helper.declaration.sourcePath),', ',anchor(helper.declaration.range),'} {');
    const bindings=new Map(parameters.map(row=>[row.binding,row]));
    for(const value of helper.statements){const result=statement(value,bindings,helper,'    ');
      if(value.kind==='return')line('    "func.return"(',result.name,') {',anchor(value.range),'} : (',helper.sourceReturnType,') -> ()');}
    line('  }');
  }
  line('}');return text.finish();
}
