// SPDX-License-Identifier: MIT
// Independent scalar CFG oracle. Share lexical decoding with the Array oracle;
// retain a separate closed block/branch model so neither domain weakens the other.
import assert from 'node:assert/strict';
import {coreOracleTokens} from './array-core-structural-oracle.mjs';
/** @param {string} text */
export function parseKernelCore(text){
  // MLIR predecessor comments contain no semantic tokens. Quoted payloads remain
  // byte intact, including quoted slashes or escaped quote characters.
  let clean='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(quoted){clean+=c;if(c==='\\')clean+=text[++i];else if(c==='"')quoted=false;}
    else if(c==='"'){quoted=true;clean+=c;}
    else if(c==='/'&&text[i+1]==='/'){while(i<text.length&&text[i]!=='\n')i++;clean+='\n';}
    else clean+=c;
  }
  const input=coreOracleTokens(clean);let at=0;
  const peek=()=>input[at]?.value;
  /** @param {string} [v] */
  const take=v=>{const t=input[at++];assert.ok(t);if(v!==undefined)assert.equal(t.value,v);return t;};
  /** @param {string} open @param {string} close @param {()=>any} read */
  function list(open,close,read){take(open);const out=[];if(peek()!==close)do{out.push(read());if(peek()!==',')break;take(',');}while(true);take(close);return out;}
  function type(){const t=take().value;assert.ok(['i1','i32','i64'].includes(t));return t;}
  const results=()=>peek()==='('?list('(',')',type):[type()];
  /** @returns {any} */
  function value(){
    if(peek()==='{')return dictionary();if(peek()==='[')return list('[',']',value);
    if(peek()==='@'){take('@');return {symbol:take().value};}
    if(peek()==='('){const inputs=list('(',')',type);take('->');return {inputs,results:results()};}
    const t=take();if(t.kind==='string')return t.value;
    if(t.value==='array'){take('<');const element=take().value,items=[];if(peek()===':'){take(':');do{items.push(take().value);if(peek()!==',')break;take(',');}while(true);}take('>');return {element,items};}
    if(t.value==='true'||t.value==='false')return {boolean:t.value==='true'};
    assert.match(t.value,/^-?\d+$/);const width=peek()===':'?(take(':'),type()):'i64';
    return width==='i1'?{boolean:t.value==='1'}:{integer:t.value,width};
  }
  /** @returns {Record<string,any>} */
  function dictionary(){
    take('{');const entries=[];if(peek()!=='}')do{const k=take().value;take('=');entries.push([k,value()]);if(peek()!==',')break;take(',');}while(true);take('}');
    assert.equal(new Set(entries.map(e=>e[0])).size,entries.length);return Object.fromEntries(entries.sort(([a],[b])=>a<b?-1:a>b?1:0));
  }
  function func(){
    let properties,attributes,parameters=[];
    const generic=input[at]?.kind==='string';
    if(generic){take('func.func');take('(');take(')');take('<');properties=dictionary();take('>');take('(');take('{');}
    else{
      take('func.func');take('@');const symbol=take().value;
      parameters=list('(',')',()=>{const raw=take().value;take(':');return {raw,type:type()};});take('->');const output=results();
      properties={function_type:{inputs:parameters.map(p=>p.type),results:output},sym_name:symbol};take('attributes');attributes=dictionary();take('{');
    }
    const registers=new Map(),blocks=[],rawLabels=new Map();
    /** @param {string} raw */
    const use=raw=>{assert.ok(registers.has(raw),'all SSA uses have a preceding definition');return registers.get(raw);};
    /** @param {string} raw @param {string} t */
    const declare=(raw,t)=>{assert.ok(!registers.has(raw));const id=registers.size;registers.set(raw,id);return {id,type:t};};
    let current={parameters:parameters.map(p=>declare(p.raw,p.type)),operations:[]};blocks.push(current);
    if(peek()?.startsWith('^')){
      const name=take().value;rawLabels.set(name,0);
      if(peek()==='('){assert.equal(parameters.length,0);current.parameters=list('(',')',()=>{const raw=take().value;take(':');return declare(raw,type());});}take(':');
    }
    function target(){const label=take().value;assert.ok(label.startsWith('^'));const args=peek()==='('?list('(',')',()=>{const raw=take().value;take(':');const t=type();return {id:use(raw),type:t};}):[];return {label,args};}
    while(peek()!=='}'){
      if(peek()?.startsWith('^')){
        const label=take().value;assert.ok(!rawLabels.has(label));rawLabels.set(label,blocks.length);
        current={parameters:peek()==='('?list('(',')',()=>{const raw=take().value;take(':');return declare(raw,type());}):[],operations:[]};take(':');blocks.push(current);continue;
      }
      let resultRaw;if(peek()?.startsWith('%')){resultRaw=take().value;take('=');}
      const token=take(),name=token.value;let operands=[],inputTypes=[],outputTypes=[],successors=[],props={},attrs={};
      if(token.kind!=='string'){
        assert.equal(resultRaw,undefined);
        if(name==='cf.br'){const t=target();operands=t.args.map(x=>x.id);inputTypes=t.args.map(x=>x.type);successors=[t.label];}
        else{
          assert.equal(name,'cf.cond_br');operands.push(use(take().value));inputTypes.push('i1');take(',');const yes=target();take(',');const no=target();
          successors=[yes.label,no.label];operands.push(...yes.args.map(x=>x.id),...no.args.map(x=>x.id));inputTypes.push(...yes.args.map(x=>x.type),...no.args.map(x=>x.type));
          props={operandSegmentSizes:{element:'i32',items:['1',String(yes.args.length),String(no.args.length)]}};
        }
        attrs=dictionary();
      }else{
        operands=list('(',')',()=>use(take().value));
        if(peek()==='[')successors=list('[',']',()=>take().value);
        if(peek()==='<'){take('<');props=dictionary();take('>');}if(peek()==='{')attrs=dictionary();
        take(':');inputTypes=list('(',')',type);take('->');outputTypes=results();
        if(name==='func.call'&&Object.hasOwn(props,'callee')){assert.ok(!Object.hasOwn(attrs,'callee'));attrs.callee=props.callee;delete props.callee;}
      }
      assert.equal(operands.length,inputTypes.length);assert.equal(outputTypes.length,resultRaw===undefined?0:1);
      const result=resultRaw===undefined?[]:[declare(resultRaw,outputTypes[0])];
      current.operations.push({name,results:result,operands,inputTypes,outputTypes,successors,properties:props,attributes:attrs});
    }
    take('}');if(generic){take(')');attributes=peek()==='{'?dictionary():{};take(':');take('(');take(')');take('->');take('(');take(')');}
    // Custom assembly's implicit entry is the predecessor of later named blocks.
    if(!generic)rawLabels.set('^bb0',0);
    for(const block of blocks)for(const op of block.operations)op.successors=op.successors.map(label=>{assert.ok(rawLabels.has(label));return rawLabels.get(label);});
    assert.deepEqual(blocks[0].parameters.map(p=>p.type),properties.function_type.inputs);
    return {properties,attributes,blocks};
  }
  const functions=[];let attributes;
  if(input[at]?.kind==='string'){
    take('builtin.module');take('(');take(')');take('(');take('{');while(peek()!=='}')functions.push(func());take('}');take(')');attributes=dictionary();take(':');take('(');take(')');take('->');take('(');take(')');
  }else{take('module');take('attributes');attributes=dictionary();take('{');while(peek()!=='}')functions.push(func());take('}');}
  assert.equal(at,input.length,'all Core tokens consumed');return {attributes,functions};
}
