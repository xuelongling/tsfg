// SPDX-License-Identifier: MIT
// Domain-free SSA allocation and formatting, shared by scalar/closure and
// formal exception control. Construction handles never enter leaf-policy input.
export function createCoreSsaGraph(coreType,budget){
  const blocks=[];let valueIndex=0,blockIndex=0,reservedBodyBytes=0,edges=0;
  // Exception publication has an independent edge cap; scalar/closure policies
  // retain their existing block/register/line accounting without that cap.
  const successors=count=>{edges+=count;budget?.edge?.(edges);};
  const variable=()=>{budget?.register(valueIndex+1);return '%v'+valueIndex++;};
  const line=(block,text)=>{if(!block)throw new TypeError('r03-hir-cfg: missing live block');
    budget?.line(text);reservedBodyBytes+=Buffer.byteLength(text,'utf8')+1;block.lines.push(text);};
  const newBlock=(parameterTypes=[])=>{
    budget?.block(blocks.length+1);if(!blocks.length)budget?.parameters(parameterTypes.length);
    const block={name:'bb'+blockIndex++,parameters:parameterTypes.map(type=>({name:variable(),type})),lines:[],terminated:false,incoming:0};
    blocks.push(block);return block;
  };
  const attrsFor=anchor=>'tsfg_source.start = '+anchor.start+' : i64, tsfg_source.end = '+anchor.end+' : i64';
  const edge=(block,values=[])=>'^'+block.name+(values.length?'('+values.join(', ')+' : '+block.parameters.map(p=>coreType(p.type)).join(', ')+')':'');
  const branch=(from,to,values,anchor)=>{successors(1);to.incoming++;line(from,'    cf.br '+edge(to,values)+' {'+attrsFor(anchor)+'}');from.terminated=true;};
  const conditional=(from,condition,left,right,anchor)=>{successors(2);left.incoming++;right.incoming++;line(from,'    cf.cond_br '+condition+', '+edge(left)+', '+edge(right)+' {'+attrsFor(anchor)+'}');from.terminated=true;};
  const fuel=(block,event,anchor)=>line(block,'    "tsfg_core.fuel"() {event = '+event+' : i32, '+attrsFor(anchor)+'} : () -> ()');
  const operationLine=(block,result,name,operands,operandTypes,resultType,attributes,anchor)=>{
    line(block,'    '+(result===null?'':result+' = ')+'"'+name+'"('+operands.join(', ')+') {'
      +(attributes?attributes+', ':'')+attrsFor(anchor)+'} : ('+operandTypes.map(coreType).join(', ')+') -> '+(resultType===null?'()':coreType(resultType)));
  };
  return {blocks,variable,newBlock,line,attrsFor,edge,branch,conditional,fuel,operationLine,successors,
    get reservedBodyBytes(){return reservedBodyBytes;}};
}
