// SPDX-License-Identifier: MIT
import {staticBindingName} from './module-facts.mjs';
import {scalarName,scalarTypeIds,boolTypeId} from './identity.mjs';
import {sourceTokens,identifierToken,range} from './scalar-hir-state.mjs';
import {scalarOperator,cloneLocals} from './scalar-hir-state.mjs';
import {expressionLeaf} from './scalar-source.mjs';
import {integerNames} from './identity.mjs';

const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',')===[...keys].sort().join(',');

/** Original binding visibility and write authority are independent of storage. */
export function verifyGlobal(value,parent,source,fail,budget,visible,write=false) {
  const context=budget.modules,global=context?.globals.get(value?.global);
  if(!exact(value,['kind','type','global','name','range']) || value.kind!=='global'
      || !global || global.type!==value.type || !range(value.range,parent)
      || context.views.get(budget.sourcePath)?.get(value.name)!==value.global
      || staticBindingName(source.slice(value.range.start,value.range.end))!==staticBindingName(value.name)
      || visible.has(value.name) || visible.has(staticBindingName(value.name).split('.')[0])) fail();
  if(write) {
    const owner=context.modules.get(global.sourcePath),current=context.modules.get(budget.sourcePath);
    if(!global.writable || global.bindingKind!=='source' || staticBindingName(value.name)!==global.name
        || global.sourcePath!==budget.sourcePath && (owner.external || current.external)) fail();
  }
  return global;
}

/** Global writes use the same evaluation traversal, with storage-owned state. */
export function verifyGlobalMutation(value,source,fail,budget,locals,visible,verify) {
  const update=value.kind==='update',operand=update?value.operand:value.left,target=expressionLeaf(operand);
  if(target?.kind!=='global')return false;
  verifyGlobal(target,value.range,source,fail,budget,visible,true);
  const floating=['f32','f64'].includes(scalarName(value.type)),integer=integerNames.includes(scalarName(value.type));
  if(update) {
    if(!exact(value,['kind','type','range','operator','prefix','operand']) || !['++','--'].includes(value.operator)
        || typeof value.prefix!=='boolean' || value.type!==operand.type || !integer&&!floating
        || (value.prefix?!scalarOperator(source,value.range.start,operand.range.start,value.operator)
          :sourceTokens(source,value.range.start,operand.range.start)!=='')
        || (value.prefix?sourceTokens(source,operand.range.end,value.range.end)!==''
          :!scalarOperator(source,operand.range.end,value.range.end,value.operator)
            || /[\r\n\u2028\u2029]/.test(source.slice(operand.range.end,value.range.end))))fail();
    verify(operand,value.range,source,fail,budget,locals,visible);
    return true;
  }
  const logical=['&&=','||='].includes(value.operator),conditional=logical||value.operator==='??=';
  if(!exact(value,['kind','type','range','operator','left','right',...(logical?['presenceFlow']:[])])
      || !['=','+=','-=','*=','/=','%=','<<=','>>=','>>>=','&=','|=','^=','&&=','||=','??='].includes(value.operator)
      || value.type!==target.type || value.right?.type!==(['<<=','>>=','>>>='].includes(value.operator)?scalarTypeIds.i32:target.type)
      || !range(operand.range,value.range) || operand.range.end>value.right.range.start
      || sourceTokens(source,value.range.start,operand.range.start)!==''
      || !scalarOperator(source,operand.range.end,value.right.range.start,value.operator)
      || sourceTokens(source,value.right.range.end,value.range.end)!==''
      || logical && (value.type!==boolTypeId || !exact(value.presenceFlow,['undefined','null'])
        || value.presenceFlow.undefined!==false || value.presenceFlow.null!==false)
      || !['=','??='].includes(value.operator) && !logical && !integer
        && !(floating&&['+=','-=','*=','/=','%='].includes(value.operator)))fail();
  verify(operand,value.range,source,fail,budget,locals,visible);
  const right=conditional?cloneLocals(locals):locals;
  verify(value.right,value.range,source,fail,budget,right,visible);
  if(logical)for(const [id,local] of locals) {
    local.initialized&&=right.get(id).initialized;
    local.states|=right.get(id).states;
  }
  return true;
}

export function verifyInitialization(statement,source,fail,budget,initialized,before,declarationKind) {
  const global=budget.modules?.globals.get(statement.global),value=statement.value;
  if(!exact(statement,['kind','global','range','value']) || !global
      || global.sourcePath!==budget.sourcePath || value?.type!==global.type || initialized.has(global.id)) fail();
  if(global.bindingKind==='default-export-expression') {
    declarationKind=undefined;
    if(global.writable || sourceTokens(source,statement.range.start,value.range.start)!=='exportdefault'
        || global.range.start<value.range.start || global.range.end!==value.range.end) fail();
  } else {
    const keyword=before.match(/(?:^|[^\p{ID_Continue}])(?:export)?(const|let)$/u)?.[1];
    if(keyword)declarationKind=keyword;
    else if(before!==',' || !declarationKind)fail();
    const annotation=sourceTokens(source,global.range.end,value.range.start);
    const annotations=global.type===boolTypeId?[':bool',':boolean']
      :global.type===scalarTypeIds.f64?[':f64',':number']:[`:${scalarName(global.type)}`];
    if(global.writable!==(declarationKind==='let') || !range(global.range,statement.range)
        || identifierToken(source,global.range)!==global.name || sourceTokens(source,statement.range.start,global.range.start)!==''
        || !['=',...annotations.map(a=>a+'=')].includes(annotation))fail();
  }
  initialized.add(global.id);
  return declarationKind;
}
