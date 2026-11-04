// SPDX-License-Identifier: MIT
// New handwritten identity-only premises: no Source bytes, AST, facts/HIR
// package, packet, publication, compiler graph, Runtime or execution carrier.
// The fixed expected hashes were calculated independently with node:crypto
// and JCS over a handwritten labelled graph and canonical signature objects,
// without importing the implementation or using any of its outputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonSemanticIdentities} from '../../compiler/common-program-identities.mjs';

const sourcePath='/literal-method-minimum-metadata.ts';
const nominalKey={sourcePath,declarationPath:['Owner'],category:'reference'};
const functions=[
  {id:'literal:unionRequired',name:'unionRequired',ownerType:'literal:owner',parameters:[{id:'literal:pUnion',name:'p',declaredType:'literal:union'}]},
  {id:'literal:undefinedRequired',name:'undefinedRequired',ownerType:'literal:owner',parameters:[{id:'literal:pUndefined',name:'p',declaredType:'literal:undefined'}]},
  {id:'literal:empty',name:'empty',ownerType:'literal:owner',parameters:[]},
  {id:'literal:free',name:'free',parameters:[{id:'literal:pFree',name:'p',declaredType:'literal:union'}]}
].map(fn=>({...fn,sourcePath,access:'public',lexicalParent:null,returnType:'literal:void',bindings:[],body:[]}));
const payload={
  types:[
    {id:'literal:i32',kind:'scalar',name:'i32',constructor:null},
    {id:'literal:undefined',kind:'undefined',constructor:null},
    {id:'literal:void',kind:'void',constructor:null},
    {id:'literal:union',kind:'union',members:['literal:i32','literal:undefined'],constructor:null},
    {id:'literal:owner',kind:'reference',nominalKey,fields:[],constructor:null,
      methods:['literal:unionRequired','literal:undefinedRequired','literal:empty']}
  ],functions,globals:[]
};
const expectedTypes={
  "i32": "sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727",
  "undefined": "sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b",
  "void": "sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190",
  "union": "sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea",
  "owner": "sha256:da0ec5d6172cc7049379f29556b71460a12e6360bb6e6059a97001c8931522a6"
};
const expectedMethods=[
  {
    "name": "unionRequired",
    "access": "public",
    "parameters": [
      "{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}"
    ],
    "returnType": "{\"kind\":\"void\",\"name\":\"void\"}",
    "minimumArgumentCount": 1
  },
  {
    "name": "undefinedRequired",
    "access": "public",
    "parameters": [
      "{\"kind\":\"undefined\",\"name\":\"undefined\"}"
    ],
    "returnType": "{\"kind\":\"void\",\"name\":\"void\"}",
    "minimumArgumentCount": 1
  },
  {
    "name": "empty",
    "access": "public",
    "parameters": [],
    "returnType": "{\"kind\":\"void\",\"name\":\"void\"}",
    "minimumArgumentCount": 0
  }
];
const expectedCallables=[
  {
    "id": "literal:unionRequired",
    "name": "unionRequired",
    "kind": "method",
    "parameters": [
      "sha256:da0ec5d6172cc7049379f29556b71460a12e6360bb6e6059a97001c8931522a6",
      "sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"
    ],
    "returns": "sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190",
    "minimumArgumentCount": 1,
    "signatureHash": "sha256:19387be97bcde34ce44d58c27cb8038c80252a10544538c4710b9e60c90d8403",
    "functionId": "sha256:54d206a0d091b22ab6fd121a5e2fcd63c099cceac2ed9465655250790728ee87"
  },
  {
    "id": "literal:undefinedRequired",
    "name": "undefinedRequired",
    "kind": "method",
    "parameters": [
      "sha256:da0ec5d6172cc7049379f29556b71460a12e6360bb6e6059a97001c8931522a6",
      "sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b"
    ],
    "returns": "sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190",
    "minimumArgumentCount": 1,
    "signatureHash": "sha256:b5b7ea0cc60c37e0eb6bef011513ad05702a807220af25109a1cfac0dcc8c376",
    "functionId": "sha256:9556d3e98e66dcac553eff7bb8ce84563c9e8670940e4fd7788144eb860f61a3"
  },
  {
    "id": "literal:empty",
    "name": "empty",
    "kind": "method",
    "parameters": [
      "sha256:da0ec5d6172cc7049379f29556b71460a12e6360bb6e6059a97001c8931522a6"
    ],
    "returns": "sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190",
    "minimumArgumentCount": 0,
    "signatureHash": "sha256:2dacf4fdc13d67900bac704ec2181cd24ab0d5d9c80fe17384f29a9808d880f2",
    "functionId": "sha256:9a5be1297b53aa6ab6c79eef84f37cd3ef2083053cf63ded4bba82547bfcde67"
  },
  {
    "id": "literal:free",
    "name": "free",
    "kind": "function",
    "parameters": [
      "sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"
    ],
    "returns": "sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190",
    "signatureHash": "sha256:0f7219ad8bd33738a531658cae2241923cb46773b62921edd823731327926cad",
    "functionId": "sha256:c87e462400089dd599bc251325f21d3eadec7cebcf29de0912106c18a27cf63b"
  }
];

test('pure required-only method identities preserve explicit minimum independently of undefined membership',()=>{
  let work=0;
  const spend=(units=1)=>{
    assert.ok(Number.isSafeInteger(units)&&units>=0);work+=units;
    assert.ok(work<=2000,'the small literal identity walk has one finite cumulative allowance');
  };
  const actual=commonSemanticIdentities(payload,spend);
  for(const [name,id]of Object.entries(expectedTypes))assert.equal(actual.typeIds.get('literal:'+name),id);
  assert.deepEqual(actual.shapes.get('literal:owner').methods,expectedMethods,
    'a union containing undefined and an undefined-only parameter both still require their one argument; an empty method requires zero');
  for(const row of expectedCallables){
    const {id,name,kind,signatureHash,functionId,...signature}=row;
    assert.deepEqual(actual.callableTypes.get(id),signature,
      'method signatures explicitly include owner plus ordinary parameters and minimum; a free signature has no minimum key');
    assert.equal(actual.signatures.get(id),signatureHash);
    assert.equal(actual.functionIds.get(id),functionId);
  }
  assert.ok(work>0&&work<=2000);
});
