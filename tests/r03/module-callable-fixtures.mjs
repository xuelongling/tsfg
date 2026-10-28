// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export const oracle=JSON.parse(await readFile(new URL('./module-callable-oracle.json',import.meta.url),'utf8'));
export const cases=oracle.cases;
export const sample=name=>cases.find(c=>c.name===name);
export const clone=x=>JSON.parse(JSON.stringify(x));
export const hash=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
export const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
export const bytes=x=>Buffer.from(canonical(x)+'\n');
export function assertError(actual,expected){assert.ok(actual instanceof TypeError);for(const key of Object.keys(expected))assert.deepEqual(actual[key],expected[key],key);return true;}
export function failure(code,message,ruleId='r01-input-boundary',phase='hir'){return{code,message:code+': '+message,ruleId,phase};}
export function assertFrozen(value){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const x of Object.values(value))assertFrozen(x);}}
export function repairContext(context){for(const row of context.contracts){const {digest,...body}=row;row.digest=hash('tsfg.module-published-call-contract.v1\0'+canonical(body));}context.expectedDigest=hash('tsfg.module-call-publication.v1\0'+canonical({scopeDigest:context.scopeDigest,contracts:context.contracts}));return context;}
export const base=(suffix,message)=>failure('r03-module-callable-'+suffix,message);
export const analysis=(suffix,message)=>failure('r03-d-module-call-effects'+suffix,message,'r01-call-contract','analysis');
