// SPDX-License-Identifier: MIT
import {check,record,array,same} from './exception-common.mjs';
import {exceptionCallableSignature} from './exception-callable.mjs';
// This source boundary proves code declarations and actual callee syntax. It
// does not turn a structural callable type into a set of permissible targets.
export function exceptionFunctionValues(functions){
  const byId=new Map(functions.map(fn=>[fn.symbol,fn]));
  const signature=fn=>({parameters:fn.parameters.map(p=>p.type),returnType:fn.returnType});
  return {
    expression(value,parent,scope,context,index,depth,verify){
      const g=context.grammar;
      if(value.kind==='functionReference'){
        record(value,['kind','type','range','target','signature']);
        const fn=byId.get(value.target),definition=context.definitions.get(value.target);
        check(fn&&definition&&fn.lexicalParent===undefined&&definition.name===fn.name
          &&value.type==='function'&&(scope.bindings.get(fn.name)===undefined||scope.bindings.get(fn.name)===fn.symbol),
        'scope','function value must name its actual visible owned declaration');
        exceptionCallableSignature(value.signature);check(same(value.signature,signature(fn)),'signature');
        g.name(value.range,fn.name,parent,index);
        return {type:'function',signature:value.signature,next:index+1,mask:0};
      }
      if(value.kind!=='indirectCall')return null;
      record(value,['kind','type','range','callee','arguments','signature']);
      exceptionCallableSignature(value.signature);
      // The callee is a real expression and is evaluated before every argument.
      const callee=verify(value.callee,value.range,scope,context,index,depth+1);
      check(callee.type==='function'&&same(callee.signature,value.signature)&&value.type===value.signature.returnType,
        'signature','indirect callee has a different actual signature');
      let next=g.expect(callee.next,'(');const argumentsList=array(value.arguments);
      check(argumentsList.length===value.signature.parameters.length,'signature');
      for(const [ordinal,argument] of argumentsList.entries()){
        if(ordinal)next=g.expect(next,',');
        const actual=verify(argument,value.range,scope,context,next,depth+1);
        check(actual.type===value.signature.parameters[ordinal]&&actual.mask===0,'signature','indirect argument type differs');next=actual.next;
      }
      next=g.expect(next,')');g.raw(value.range,parent,index,next-1);
      return {type:value.type,next,mask:0};
    },
  };
}
