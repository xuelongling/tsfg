// SPDX-License-Identifier: MIT
// The actual second facts profile supplies only presence-specific semantics.
// Common ownership, shape, ranges, types, calls and construction stay shared.
import descriptor from '../contracts/optional-property-facts-v1.schema.json' with {type:'json'};
import hirDescriptor from '../contracts/optional-property-hir.schema.json' with {type:'json'};
import {canonical,own,sha256,scalarTypeIds} from './identity.mjs';
import {check,sourceRange,byteOrder} from './typed-array-schema.mjs';
import {typedArrayStringUnits} from './typed-array-literals.mjs';
import {identifierName,skipCallTrivia} from './module-facts.mjs';

export const optionalPropertyFactsFormat=own({family:'tsfg.optional-property-facts-package-candidate',version:1,
  schemaHash:'sha256:9d66a69dbce62ecf2ee47968b4b2b3a310314610c1a52b87ccb9ff368bbe020e'});
export const optionalPropertyHirFormat=own({family:'tsfg.optional-property-hir-candidate',contractVersion:'1.0.0',
  schemaHash:sha256(canonical(hirDescriptor)+'\n')});
check(sha256(canonical(descriptor)+'\n')===optionalPropertyFactsFormat.schemaHash,'schema-identity');
const primitiveAnnotations=Object.freeze({number:'f64',boolean:'bool',string:'string',undefined:'undefined',null:'null',void:'void'});

function members(types,id,spend) {
  const found=new Map(),seen=new Set();let row=types.get(id);
  while(row) {
    // Source constructor metadata starts at depth zero: 64 base edges visit
    // 65 nominal nodes. JSON nesting is independent of this flat TypeId graph.
    spend();check(!seen.has(row.id)&&seen.size<=64,'type');seen.add(row.id);
    for(const field of row.fields??[]){spend();if(!found.has(field.name))found.set(field.name,field);}
    row=types.get(row.base);
  }
  return found;
}
function validateFields(payload,sources,types,spend) {
  const ids=new Set();
  for(const owner of types.values())for(const field of owner.fields??[]) {
    spend();check(!ids.has(field.id),'field');ids.add(field.id);
    const presence=field.propertyPresence;check(presence&&types.has(presence.declaredType),'property-presence');
    const text=sources.get(field.origin.source)?.content;check(typeof text==='string','source');
    check(field.origin.source===owner.sourcePath,'source');
    spend(field.origin.end-field.origin.start);
    // The protocol omits an ordinary field nameRange. Its cryptographic ID
    // selects the original identifier spelling inside this supplied anchor.
    let selected;
    const spelling=text.slice(field.origin.start,field.origin.end);
    const identifiers=/(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[$_\p{ID_Start}])(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[$\u200c\u200d\p{ID_Continue}])*/gu;
    for(const match of spelling.matchAll(identifiers)) {
      spend();const start=field.origin.start+match.index,nameRange={start,end:start+match[0].length};
      if(identifierName(match[0])===field.name
        &&field.id===sha256('tsfg.array-facts.field.v8\0'+canonical({sourcePath:owner.sourcePath,nameRange})))selected=nameRange;
    }
    check(selected&&selected.end<=field.origin.end&&!/\s/.test(text[field.origin.start]),'field');
    const afterName=selected.end+skipCallTrivia(text.slice(selected.end,field.origin.end)),question=presence.questionTokenRange;
    if(question) {
      sourceRange(question,text,field.origin);
      check(presence.optional&&question.start===afterName&&question.end===afterName+1
        &&text.slice(question.start,question.end)==='?','property-presence');
    }else check(!presence.optional&&text[afterName]!=='?','property-presence');
    const expected=presence.optional
      ? [...new Set([...(types.get(presence.declaredType).members??[presence.declaredType]),'undefined'])].sort(byteOrder)
      : [presence.declaredType];
    const read=types.get(field.type);
    check(presence.optional
      ?canonical(read.members??[read.id])===canonical(expected)
      :field.type===presence.declaredType,'property-presence');
    const start=afterName+(question?1:0),tail=text.slice(start,field.origin.end);
    // Bare pinned scalar names and primitive keywords have an unambiguous
    // logical identity. Other spellings (aliases, generics, parentheses, unions)
    // are Source claims bound by the separately selected exact packet. Rendering
    // a logical type cannot recover its original TypeScript annotation spelling.
    const colon=tail.indexOf(':');
    if(colon>=0) {
      const token=tail.slice(colon+1).split(/[=;]/,1)[0].trim();
      const direct=Object.hasOwn(scalarTypeIds,token)?token:
        Object.hasOwn(primitiveAnnotations,token)?primitiveAnnotations[token]:undefined;
      if(direct)check(presence.declaredType===direct,'property-presence');
    }else check(!presence.optional,'property-presence');
  }
}
function validateExpression(value,types,source,spend) {
  spend();
  if(value.kind==='stringLiteral') {
    spend(value.range.end-value.range.start);
    check(canonical(value.codeUnits)===canonical(typedArrayStringUnits(source.slice(value.range.start,value.range.end))),'literal');
  }
  if(['fieldAccess','fieldTarget'].includes(value.kind)) {
    const field=[...members(types,value.receiver.flowType,spend).values()].find(field=>field.id===value.property);
    check(field&&field.type===value.type,'field');
    if(value.flowType) {
      const read=types.get(value.type),flow=types.get(value.flowType);
      check(flow&&(flow.members??[flow.id]).every(id=>(read.members??[read.id]).includes(id)),'flow');
    }
  }
  if(value.kind!=='propertyPresenceTest')return;
  check(value.operator==='in'&&value.type==='bool'&&value.flowType==='bool'
    &&source.slice(value.operatorRange.start,value.operatorRange.end)==='in','property-presence');
  const receiver=types.get(value.right.flowType);
  check(['reference','value'].includes(receiver?.kind)&&value.left.kind==='stringLiteral'
    &&value.left.type==='string'&&value.left.flowType==='string','property-presence');
  const name=value.left.codeUnits.map(unit=>String.fromCharCode(unit)).join('');
  const field=members(types,receiver.id,spend).get(name);
  check(field&&field.id===value.property,'property-presence');
}
function validateMissing(state,proof,missing,spend) {
  check(Array.isArray(missing),'compatibility');
  const mapped=new Set(proof.members.map(row=>row.target));
  let previous;
  for(const id of missing) {
    spend();check(!previous||byteOrder(previous,id)<0,'compatibility');
    check(!mapped.has(id),'compatibility');previous=id;
  }
  return missing;
}
export const optionalPropertyProfile=Object.freeze({descriptor,factsFormat:optionalPropertyFactsFormat,
  hirFormat:optionalPropertyHirFormat,requestFamily:'tsfg.optional-property-facts-request-candidate',
  requestDomain:'tsfg.optional-property-facts.request.v1',packageDomain:'tsfg.optional-property-facts.package.v1',
  createValidation() {
    let remaining=100000;const spend=(amount=1)=>{remaining-=amount;check(remaining>=0,'limit');};
    return {validateFields:(payload,sources,types)=>validateFields(payload,sources,types,spend),
      validateExpression:(value,types,source)=>validateExpression(value,types,source,spend),
      validateMissing:(state,proof,missing,relationSpend)=>{
        spend(missing.length+proof.members.length);
        return validateMissing(state,proof,missing,relationSpend);
      }};
  }});
