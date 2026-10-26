// SPDX-License-Identifier: MIT
// One graph is printed as real MLIR values, block arguments and successors.
// Carrier adapters change capacity only; they never convert an actual payload.
import {i32TypeId,boolTypeId} from './identity.mjs';
import {finiteNumericUse} from './finite-numeric-use.mjs';
import {commonCheck as check,canonical} from './common-program-common.mjs';
import {commonTextBudget} from './common-program-budget.mjs';
export function printCommonFunction(plan,model,carriers,publication=null) {
  const {owner,graph,entry}=plan,{spend}=model,selected=carriers.registers.get(owner.id),abi=carriers.functions.get(owner.id),coreType=carriers.coreType;
  spend(graph.blocks.length);const text=publication??commonTextBudget(spend,model.limits.bytes),physical=new Map(),blocks=new Map(graph.blocks.map(b=>[b.name,b])),blockTypes=new Map(),incomingRanges=new Map();let serial=0,extraBlocks=0;
  const quote=text.quote,join=(parts,separator=', ')=>text.combine(parts,separator),anchor=r=>'tsfg_source.start = '+r.start+' : i64, tsfg_source.end = '+r.end+' : i64';
  const line=(...parts)=>text.line(...parts);
  const variable=()=>{check(graph.registers.size+ ++serial<=model.limits.registersPerFunction,'limit');return '%a'+serial;};
  const resolve=name=>{const value=physical.get(name);check(value,'ssa','physical SSA use before definition');return value;};
  const emit=(name,args,type,properties,view,range,result=null,successors=[])=>{
    spend(args.length+successors.length+1);const output=type===null?null:result??variable();
    line('    ',output?output+' = ':'',quote(name),'(',join(args.map(v=>v.name)),')',
      successors.length?' ['+join(successors.map(n=>'^'+n))+']':'',' {',
      name.startsWith('tsfg_program.')?'properties = '+quote(canonical(properties))+', view_type = '+quote(view)+', ':'',anchor(range),
      '} : (',join(args.map(v=>coreType(v.type))),') -> ',type===null?'()':coreType(type));
    return output?{name:output,type}:null;
  };
  const adapt=(value,type,range,view)=>value.type===type?value:emit('tsfg_program.carrier_cast',[value],type,{carrier:type},view,range);
  for(const block of graph.blocks){spend(block.parameters.length);blockTypes.set(block.name,block.parameters.map(p=>selected.get(p.name)));}
  for(const block of graph.blocks)for(const op of block.instructions)if(['tsfg_program.invoke','tsfg_program.invoke_method','tsfg_program.invoke_indirect'].includes(op.name)){
    const called=op.name!=='tsfg_program.invoke'?carriers.methods.get(op):carriers.functions.get(op.properties.function_id),target=blocks.get(op.successors[0]);check(called,'identity');
    blockTypes.set(target.name,called.result==='void'?[]:[called.result]);incomingRanges.set(target.name,op.range);
  }
  blockTypes.set(entry.name,abi.parameters);
  const elementCarrier=operand=>{
    const t=model.types.get(graph.registers.get(operand).view);check(['array','readSpan'].includes(t?.kind),'type');
    const array=t.kind==='array'?t:carriers.arrayType(t.elementType);
    check(array,'type');const carrier=carriers.bindings.get('element:'+array.id);check(carrier,'type');return carrier;
  };
  const branch=(op,args,custom=false)=>{
    const target=blocks.get(op.successors[0]),types=blockTypes.get(target.name);check(types.length===args.length,'ssa');
    spend(args.length);const passed=args.map((v,i)=>adapt(v,types[i],op.range,target.parameters[i].type));
    if(custom)emit(op.name,passed,null,op.properties,'void',op.range,null,op.successors);
    else line('    cf.br ^',target.name,passed.length?'('+join(passed.map(v=>v.name))+' : '+join(types.map(coreType))+')':'',' {',anchor(op.range),'}');
  };
  function scalar(op,args) {
    const views=op.operands.map(name=>graph.registers.get(name).view),shape=op.name==='tsfg_program.unary'
      ?{kind:'unary',operator:op.properties.operator,operand:{type:views[0]}}
      :{kind:'binary',operator:op.properties.operator,left:{type:views[0]},right:{type:views[1]}};
    if(finiteNumericUse(shape))for(const [index,value]of args.entries()){
      // Both original operand expressions already dominate this instruction.
      check(++extraBlocks+graph.blocks.length<=model.limits.blocksPerFunction,'limit');const label='numeric'+extraBlocks,normal={name:variable(),type:i32TypeId};
      emit('tsfg_program.numeric_use',[value],null,{operator:op.properties.operator,index,operand_view:views[index]},i32TypeId,op.range,null,[label]);
      line('  ^'+label+'('+normal.name+': i32):');args[index]=normal;
    }
    return emit(op.name,args,op.view,op.properties,op.view,op.range,op.result);
  }
  spend(entry.parameters.length);const attrs=['tsfg_program.function_id = '+quote(owner.id),'tsfg_program.signature_hash = '+quote(owner.signatureHash),
    'tsfg_program.source_path = '+quote(owner.sourcePath),'tsfg_program.role = '+quote(owner.kind),anchor(owner.range)];
  const parameters=entry.parameters.map((p,i)=>p.name+': '+coreType(abi.parameters[i]));
  line('  func.func @',quote('program_'+owner.id.slice(7)),'(',join(parameters),')',abi.result==='void'?'':' -> '+coreType(abi.result),' attributes {',join(attrs),'} {');
  for(const [index,block]of graph.blocks.entries()) {
    spend();const types=blockTypes.get(block.name);
    if(index){spend(block.parameters.length);line('  ^',block.name,block.parameters.length?'('+join(block.parameters.map((p,i)=>p.name+': '+coreType(types[i])))+')':'',':');}
    for(const [i,p]of block.parameters.entries())physical.set(p.name,{name:p.name,type:types[i]});
    for(const [i,p]of block.parameters.entries())if(types[i]!==selected.get(p.name))physical.set(p.name,adapt(resolve(p.name),selected.get(p.name),incomingRanges.get(block.name)??owner.range,p.type));
    for(const op of block.instructions) {
      spend(op.operands.length+1);const args=op.operands.map(resolve),p=op.properties,type=op.result?selected.get(op.result):null,name=op.name;let result;
      const view=op.view?.startsWith('cell:')?model.bindings.get(p.binding).type:op.view===model.payload?p.type:op.view??'void';
      if(name==='cf.br'){branch(op,args);continue;}
      if(name==='cf.cond_br'){check(args[0].type===boolTypeId,'capability','condition is not a native boolean carrier');
        line('    cf.cond_br '+args[0].name+', ^'+op.successors[0]+', ^'+op.successors[1]+' {'+anchor(op.range)+'}');continue;}
      if(name==='tsfg_program.route'){branch(op,args,true);continue;}
      if(name==='func.return'){if(args.length)args[0]=adapt(args[0],abi.result,op.range,plan.returnType);emit(name,args,null,{},'void',op.range);continue;}
      if(['tsfg_program.invoke','tsfg_program.invoke_method','tsfg_program.invoke_indirect'].includes(name)) {
        const called=name!=='tsfg_program.invoke'?carriers.methods.get(op):carriers.functions.get(p.function_id);check(called&&called.parameters.length===args.length,'ssa');
        for(const [i,carrier]of called.parameters.entries())args[i]=adapt(args[i],carrier,op.range,graph.registers.get(op.operands[i]).view);
        emit(name,args,null,p,'void',op.range,null,op.successors);continue;
      }
      if(name==='tsfg_program.binary'||name==='tsfg_program.unary')result=scalar(op,args);
      else if(['tsfg_program.load','tsfg_program.env_load','tsfg_program.global_load','tsfg_program.field_load'].includes(name)) {
        const carrier=carriers.bindings.get(name.endsWith('field_load')?model.fields.get(p.field).sourceBinding:name.endsWith('global_load')?model.globals.get(p.global).sourceBinding:p.binding);
        result=emit(name,args,carrier,p,view,op.range,type===carrier?op.result:null);result=adapt(result,type,op.range,view);
      }else if(['tsfg_program.store','tsfg_program.env_init','tsfg_program.env_store','tsfg_program.global_store','tsfg_program.field_store','tsfg_program.array_store'].includes(name)) {
        const index=name.endsWith('global_store')?0:name.endsWith('array_store')?2:1;
        const carrier=name.endsWith('array_store')?elementCarrier(op.operands[0]):carriers.bindings.get(name.endsWith('field_store')?model.fields.get(p.field).sourceBinding
          :name.endsWith('global_store')?model.globals.get(p.global).sourceBinding:p.binding);
        args[index]=adapt(args[index],carrier,op.range,graph.registers.get(op.operands[index]).view);emit(name,args,null,p,'void',op.range);continue;
      }else if(name==='tsfg_program.array_create') {
        const carrier=carriers.bindings.get('element:'+op.view);for(let i=0;i<args.length;i++)args[i]=adapt(args[i],carrier,op.range,graph.registers.get(op.operands[i]).view);
        result=emit(name,args,type,p,view,op.range,op.result);
      }else result=emit(name,args,type,p,view,op.range,op.result,op.successors);
      if(op.result){check(result,'ssa');physical.set(op.result,result);}
    }
  }
  text.append('  }');return publication?undefined:text.finish();
}
