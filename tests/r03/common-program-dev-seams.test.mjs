// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {admittedInputScope,sourceLexicalTokens,sourceIsExternal} from '../../compiler/conversions.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {numericTokenSyntax,floatBits} from '../../compiler/float.mjs';
import {coreQuote} from '../../compiler/mlir-strings.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonTextBudget} from '../../compiler/common-program-budget.mjs';

test('candidate lexical exports retain original UTF16 ranges and external-module classification',()=>{
  const source='/* ignored */ export const \\u0061lpha="😀";',tokens=sourceLexicalTokens(source),
    name=tokens.find(token=>token.kind==='name'&&token.value==='alpha'),text=tokens.find(token=>token.kind==='text');
  assert.equal(source.slice(name.start,name.end),'\\u0061lpha');
  assert.equal(source.slice(text.start,text.end),'"😀"');assert.equal(text.end-text.start,4);
  assert.equal(sourceIsExternal(source),true);
  assert.equal(sourceIsExternal('/* export {} */ function local(){import("x");}'),false);
  assert.equal(sourceIsExternal('function local(){} export {local};'),true);
  assert.equal(sourceLexicalTokens('"unfinished'),null);assert.equal(sourceIsExternal('\ud800'),null);
});
test('formal dev input admission keeps its single-source contract',()=>{
  const declaration='/src/minimal-bool-v1.d.ts',scope={sourceRoot:'/src',rootFile:'/src/main.ts',
    config:{strict:true,noEmit:true,allowJs:false},declarations:{version:'minimal-bool-v1',paths:[declaration]},
    files:[{path:'/src/main.ts',content:'function main():bool{return true;}'},
      {path:declaration,content:readFileSync(new URL('../../compiler/minimal-bool-v1.d.ts',import.meta.url),'utf8')}]},
    admitted=value=>admittedInputScope(value,sha256(canonical(value)));
  assert.equal(admitted(scope),true);
  assert.equal(admitted({...scope,hostImports:[]}),false);
  assert.equal(admitted({...scope,compilationClosure:{roots:[]}}),false);
  const files=[...scope.files,{path:'/src/other.ts',content:'export {};'}].sort((a,b)=>a.path<b.path?-1:1);
  assert.equal(admitted({...scope,files}),false);
});
test('shared MLIR quoting retains the exact escaped budgeted Core text',()=>{
  const samples=[['\r','"\\0D"'],['\b','"\\08"'],['\f','"\\0C"'],['\0','"\\00"'],['😀','"😀"'],['"\\\n\t','"\\"\\\\\\n\\t"']];
  for(const [source,expected]of samples){const text=commonTextBudget(commonMeter());assert.equal(coreQuote(source),expected);assert.equal(text.quote(source),expected);}
});
test('shared numeric syntax keeps exact floating rounding and rejection',()=>{
  assert.equal(numericTokenSyntax('0xFF').radix,true);assert.equal(numericTokenSyntax('-1_024').negative,true);
  assert.equal(floatBits('0.1','f32'),'3dcccccd');assert.equal(floatBits('0.1','f64'),'3fb999999999999a');
  assert.equal(floatBits('1.000000059604644775390625','f32'),'3f800000');
  assert.equal(floatBits('-0','f32'),'80000000');assert.throws(()=>numericTokenSyntax('1e'),TypeError);
});
