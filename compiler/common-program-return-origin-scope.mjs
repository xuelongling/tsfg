// SPDX-License-Identifier: MIT
// Fixed upper graphs use the admitted publication's complete interpretation
// archive, never the replaceable implementation's current HIR type inventory.
import {readCommonReturnOriginGraph} from './common-program-return-origin-graph.mjs';
import {canonical,sha256} from './identity.mjs';

/** @typedef {{id:string,label:string,shape:{kind:string,fields?:{name:string,index:number}[]}}} ScopeType */
/** @typedef {{functionId:string,kind:string,parameterTypes:string[],returnType:string,lexicalEnvironment:string|null,activationEnvironment:string|null}} ScopeFunction */
/** @typedef {{profile:'common-program-fixed-v3',types:ScopeType[],functions:ScopeFunction[],globals:{globalId:string,type:string}[],environments:{id:string,parent:string|null,slots:{key:string,type:string,writable:boolean}[]}[]}} FixedScope */

/**
 * PRECONDITION: scope has already passed fixed-scope semantic identity/hash,
 * owner, unique-directory and acyclic lexical-environment admission. This is
 * its interpretation projection, not a second scope validator. Extra admitted
 * metadata (including declarationTypes) does not narrow the type archive.
 * All required facts are snapshotted before returning; the caller can discard
 * its input. Method parameterTypes already includes the receiver exactly once.
 * read retains the ordinary reader's Typed/Open/boundary-error distinctions;
 * budget exceptions propagate unchanged. No Source, Actual, Borrow, field,
 * initialization, capture permission or containment proof is granted here.
 * @param {FixedScope} admittedFixedScope
 * @param {(units?:number)=>void} spend
 */
export function commonReturnOriginScopeDirectories(admittedFixedScope,spend) {
  const symbol=value=>{spend(Math.ceil(value.length/8)+1);return value;};
  const scope=admittedFixedScope;
  symbol(scope.profile);
  if(scope.profile!=='common-program-fixed-v3')throw new TypeError('return-origin-scope: fixed-v3 profile required');
  spend(scope.types.length+scope.functions.length+scope.globals.length+scope.environments.length+1);
  /** @type {Map<string,{kind:string}>} */
  const types=new Map();
  /** @type {Map<string,import('./common-program-return-origin-graph.mjs').FunctionRow>} */
  const functions=new Map();
  /** @type {Map<string,string>} */
  const globals=new Map();
  /** @type {Map<string,{parent:string|null,slots:{key:string,type:string,writable:boolean}[]}>} */
  const environments=new Map();
  /** @type {Set<string>} */
  const fields=new Set();
  for(const type of scope.types){spend();const id=symbol(type.id),kind=symbol(type.shape.kind);types.set(id,{kind});
    const entries=type.shape.fields??[];spend(entries.length+1);
    for(const field of entries){spend();
      // Exact commonFieldId(id,name,index) identity. The full identities module
      // also imports Source/schema bootstrap; reuse only its pure canonical/hash
      // primitives here. Prepay worst-case JSON escaping, UTF-8 hashing and keys
      // BEFORE canonical allocates strings or sha256 encodes its input.
      spend((id.length+field.name.length)*8+256);
      fields.add(sha256('tsfg.common-program.field.v1\0'+canonical({owner:id,name:field.name,index:field.index})));
    }
  }
  for(const fn of scope.functions){spend(fn.parameterTypes.length+1);const parameterTypes=[];
    for(const type of fn.parameterTypes){spend();parameterTypes.push(symbol(type));}
    const lexicalEnvironment=fn.lexicalEnvironment===null?null:symbol(fn.lexicalEnvironment);
    const activationEnvironment=fn.activationEnvironment===null?null:symbol(fn.activationEnvironment);
    functions.set(symbol(fn.functionId),{kind:symbol(fn.kind),parameterTypes,returnType:symbol(fn.returnType),lexicalEnvironment,activationEnvironment});
  }
  for(const global of scope.globals){spend();globals.set(symbol(global.globalId),symbol(global.type));}
  for(const env of scope.environments){spend(env.slots.length+1);const slots=[];
    for(const slot of env.slots){spend();slots.push({key:symbol(slot.key),type:symbol(slot.type),writable:slot.writable});}
    environments.set(symbol(env.id),{parent:env.parent===null?null:symbol(env.parent),slots});
  }
  /** @param {string} functionId @param {unknown} rawGraph */
  const read=(functionId,rawGraph)=>{
    symbol(functionId);const fn=functions.get(functionId);
    if(fn===undefined)throw new TypeError('return-origin-scope: unowned function context');
    // Env/function rows came from this complete hashed fixed Scope; draft4
    // derives no instance or payload permission from an unbound side table.
    return readCommonReturnOriginGraph(rawGraph,{functionId,types,functions,globals,fields,environments},spend);
  };
  return {read};
}
