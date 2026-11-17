// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonical} from '../../compiler/common-program-common.mjs';

const header={
  family:'tsfg.gpu-host-preflight',version:1,status:'unfulfilled',
  scope:'reached-linear-prefix-before-first-visible-write',
};
const profile='single-source-call-v1';

export function verifyEmittedHostBoundary(module){
  assert.equal(module.scope,'host-preflight-required');
  assert.equal(module.hostPreflightFulfilled,false);
  const {family,version,status,scope}=module.hostPreflight;
  assert.deepEqual({family,version,status,scope},header);
}

function numericUses(plan,original,sourceText){
  const sourceId=plan.kernels[0].source.sourceId;
  const use=(range,operator,index,origin)=>({source:{sourceId,...range},operator,index,origin});
  const binding=kind=>{
    const found=plan.bindings.find(row=>row.kind===kind);
    assert.ok(found&&found.access!=='write');
    return {kind:'binding',binding:found};
  };
  const constant=decimal=>({kind:'constant-i32',decimal});
  if(original.assignmentValue){
    const operator=sourceText.slice(original.target.end,original.operand.start).trim();
    assert.equal(operator,'+=');
    return [use(original.assignmentValue,'+',0,binding('global')),
      use(original.assignmentValue,'+',1,binding('parameter'))];
  }
  const parameter=binding('parameter');
  if(original.inner){
    const innerOperator=sourceText.slice(original.parameterUse.end,original.literal.start).trim();
    assert.equal(innerOperator,'+');
    const factor=sourceText.slice(original.factor.start,original.factor.end);
    return [use(original.inner,innerOperator,0,parameter),
      use(original.inner,innerOperator,1,constant(original.literalToken)),
      use(original.expression,original.operator,0,null),
      use(original.expression,original.operator,1,constant(factor))];
  }
  const result=[use(original.expression,original.operator,0,parameter)];
  if(original.literal!==null)result.push(use(original.expression,original.operator,1,constant(original.literalToken)));
  return result;
}

// Source3 determines the number, order, range and origin of the numeric uses.
// Each retained Source operation ties one expected use to its Core obligation.
export function verifyGpuHostRecipe(module,plan,original,sourceText){
  verifyEmittedHostBoundary(module);
  assert.deepEqual([module.family,module.version,module.launchAuthorized,module.deviceExecution],
    ['tsfg.gpu-binding-module',1,false,false]);
  assert.equal(plan.kernels.length,1);
  const [{functionId,source}]=plan.kernels;
  const planDigest='sha256:'+createHash('sha256').update(canonical(plan)+'\n').digest('hex');
  assert.equal(module.inputIdentity,plan.inputIdentity);
  assert.equal(module.planDigest,planDigest);
  assert.equal(module.profile.name,profile);
  assert.deepEqual(module.bindings,plan.bindings);

  const uses=numericUses(plan,original,sourceText);
  const recorded=module.sourceOperations.filter(row=>row.name==='fuel'||row.name==='numeric_use');
  assert.deepEqual(recorded.map(row=>row.name),['fuel',...uses.map(()=>'numeric_use')]);
  assert.deepEqual(recorded[0],{functionId,name:'fuel',obligationId:0,
    point:{block:0,operation:0},source});
  assert.deepEqual(module.obligations[0],{id:0,kind:'fuel',condition:'gpu-fuel-and-depth-domain',
    functionId,point:{block:0,operation:0},source,status:'unfulfilled',event:1});
  /** @type {object[]} */
  const steps=[{kind:'entry-budget',obligationId:0,functionId,point:{block:0,operation:0},
    source,status:'unfulfilled',event:1,activeDepth:1,fuelCost:1,checkOrder:['depth','fuel']}];
  let previousId=0;
  for(const [offset,{source,operator,index,origin}] of uses.entries()){
    const {obligationId,point}=recorded[offset+1];
    assert.ok(Number.isSafeInteger(obligationId)&&obligationId>previousId&&obligationId<module.obligations.length);
    previousId=obligationId;
    assert.ok(Number.isSafeInteger(point.block)&&point.block>=0&&Number.isSafeInteger(point.operation)&&point.operation>=0);
    assert.deepEqual(recorded[offset+1],{functionId,name:'numeric_use',obligationId,point,source});
    const obligation=module.obligations[obligationId],{operand}=obligation;
    assert.ok(Number.isSafeInteger(operand)&&operand>=0);
    let dependsOn=[];
    if(origin===null){
      // The composed profile consumes the original inner add's result. Its
      // first (binding) numeric check and the add itself establish the tag.
      const inner={sourceId:source.sourceId,...original.inner};
      const producers=module.sourceOperations.filter(row=>row.name==='binary'&&canonical(row.source)===canonical(inner));
      assert.equal(producers.length,1);
      const [producer]=producers,inputId=recorded[1].obligationId,producerId=producer.obligationId;
      assert.equal(producer.functionId,functionId);
      assert.ok(Number.isSafeInteger(producerId)&&producerId>recorded[2].obligationId&&producerId<obligationId);
      assert.deepEqual(module.obligations[producerId],{id:producerId,kind:'i32-add',condition:'gpu-i32-numeric-relation',
        functionId,point:producer.point,source:inner,operator:'+',semantics:'source-i32-modulo-2^32',dependsOn:[inputId],status:'unfulfilled'});
      dependsOn=[inputId,producerId];
    }
    assert.deepEqual(obligation,{id:obligationId,kind:'numeric-use',condition:'actual-initialized-i32',
      functionId,point,source,operator,index,operand,dependsOn,
      status:origin===null?'conditional-i32':origin.kind==='binding'?'unfulfilled':'proven-i32'});
    if(origin===null){
      const discharged=module.discharges.filter(row=>row.obligationId===obligationId);
      assert.deepEqual(discharged,[{obligationId,functionId,point,source,status:'discharged',
        basis:'Source actual i32 result',operation:'numeric-use',relation:'computed-i32-is-numeric',
        requires:dependsOn}]);
      continue;
    }
    steps.push({kind:'numeric-use',obligationId,functionId,point,source,status:'unfulfilled',
      operator,index,operand,origin,requiresInitialized:true,requiresActualTag:'i32',
      undefinedOutcome:'request-trap-at-this-operation',
      otherActualTags:'unimplemented-capability-not-a-Source-trap'});
  }
  assert.deepEqual(module.hostPreflight,{...header,functionId,planDigest,profile,
    requirements:{arguments:'already-evaluated-Source-values',actualState:'same-binding-snapshot-as-payload',
      payloadPreparation:'after-ordered-preflight-success',resourceLifetime:'until-confirmed-completion',
      concurrency:'one-active-Source-call-on-bound-resources'},
    semanticFailure:{stage:'before-submit',channel:'request-trap',userCatch:false,userFinally:false,
      rollback:false,deviceFailureProtocol:false},steps});
}
