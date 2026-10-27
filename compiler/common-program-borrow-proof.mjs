// SPDX-License-Identifier: MIT
import {commonProgramCore} from './common-program-core.mjs';
import {commonJson,commonBudget,commonCheck as check,canonical} from './common-program-common.mjs';

/** @typedef {Readonly<{family:'tsfg.common-borrow-proof-candidate',version:1,inputIdentity:string,hirDigest:string,scopeDigest:string,publishedDigest:string,request:Readonly<{targets:readonly string[]}>,target:Readonly<{target:string,triple:string,llvmDataLayout:string,pointerBits:string}>,sources:readonly Readonly<{path:string,hash:string}>[],functions:readonly Readonly<{functionId:string,sourceBinding:string|null,signatureHash:string,source:import('./common-program-borrow-events.mjs').BorrowSource}>[],events:import('./common-program-borrow-events.mjs').CommonBorrowEvents}>} CommonBorrowProof */

// The input remains the complete owned Program, fixed publication and request.
// A proof is recomputed data, not a certificate granting execution or borrowing.
/** @returns {CommonBorrowProof} */
export function createCommonBorrowProof(hir,publication,request){
  return commonProgramCore(hir,publication,request,{borrowProof:true}).borrowProof;
}
/** @param {unknown} bytes @returns {CommonBorrowProof} */
export function readCommonBorrowProof(bytes,hir,publication,request){
  const input=commonJson(bytes),expected=createCommonBorrowProof(hir,publication,request);
  check(canonical(input)===canonical(expected),'borrow-proof','borrow proof differs from complete independent reconstruction');return expected;
}
/** @param {unknown} value @returns {Buffer} */
export function writeCommonBorrowProof(value,hir,publication,request){
  commonBudget(value);const expected=createCommonBorrowProof(hir,publication,request);
  check(canonical(value)===canonical(expected),'borrow-proof','borrow proof differs from complete independent reconstruction');return Buffer.from(canonical(expected)+'\n');
}
