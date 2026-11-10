// SPDX-License-Identifier: MIT
// Complete official Common3 input through the public HIR/Published/Core seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonSourceGrammar} from '../../compiler/common-program-source.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixtureRoot=process.env.TSFG_STRING_LINE_FIXTURES??fileURLToPath(new URL('./testdata/common-program-string-line-continuation-v3/',import.meta.url));
const outputRoot=process.env.TSFG_STRING_LINE_CORE;
const reportRoot=process.env.TSFG_STRING_LINE_REPORTS;
const fixtures=[
  {
    "name": "lf-double",
    "terminator": "\n",
    "quote": "\"",
    "pins": [
      "fea20454115893769217a2d29241637d2d73bb4951cd2c30b59f7898dae9dbfb",
      "0884643a4520c7fc80cf89369ff61f105c6e6987b198169a8c168f27e9367c9d",
      "24d5f4c2e66279601d1394ebde180815eb1171851bb93726fc93e03eb9910aa2"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "lf-single",
    "terminator": "\n",
    "quote": "'",
    "pins": [
      "6c40b635ccbeb679d33bac7d22409675bf81f441680d882aa3d7fbdb7800ae41",
      "692020ce923af568b05886fa1753f4a935dbaf3cd600603d7a3aa0edfdb8afc9",
      "acca71ba85ac39b28b18fcc649e877f3ac156826c3452d43bdf093d9075177b1"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "crlf-double",
    "terminator": "\r\n",
    "quote": "\"",
    "pins": [
      "65519e6a530221d56cddaabd181dbb1d9059da30cae50c872867d953a8147198",
      "e67b89e41012350c96fdf4151a6de0157274483747fd913a9b7c95d998d2cfe4",
      "d13e44d11e15ec6a48ffc56d4488bd461fee45bbe521d62d92c263377b3b8296"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "crlf-single",
    "terminator": "\r\n",
    "quote": "'",
    "pins": [
      "9852cba27d428164e86765e0b8bda8a1b418f2c49cc54b0460d3130e065135ba",
      "e98a4198de29c3cf65af418df0f3eb6d1506e066fbcf98dfb6199242ec7e7555",
      "92968100336563d4d1367956b275043c67ecf9bb774fee1a4939f97df3c12c94"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "cr-double",
    "terminator": "\r",
    "quote": "\"",
    "pins": [
      "6e31ce72c5b9f03501c0f145f20020b93d88546ed43721524ce0f9e48319b75e",
      "091f9d9323103b86374cd7ee9e9a0fb294d2b561cd417f814f351a2544c76d17",
      "241a2a9e4956d8b97c8ef2a130deb66e13e22ed4f33436a159b22c871a851e42"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "cr-single",
    "terminator": "\r",
    "quote": "'",
    "pins": [
      "808db72bd29b284ab2d8316a7ef9aca937e70180b66864c54457cfeb403a5923",
      "0f7cad600f08f25fdcffe5ce264afc9a02c6e2ee6fb0325d5d4f8acae0977b28",
      "c8c1d8ad5be83d2969ff6a2e324b002fd0668cb9b0abf6ed6dc9babf7fdac443"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "ls-double",
    "terminator": " ",
    "quote": "\"",
    "pins": [
      "20310c16f08660afc0225d0dc8f2b7ae467f7ff4247f077afc273e10e339ffe0",
      "5f748cde62d8581ec0c7b0830f847924d1107957bcdd2142e3d11be516e791d4",
      "b444c53174671dfa5e68b795e6a7e61513f2225fed5c9841b8a7b25161637b9d"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "ls-single",
    "terminator": " ",
    "quote": "'",
    "pins": [
      "20933b31cc4f62aeb97c74acab6ff15484d7a54c169e893e384f18d41d705133",
      "bdd364f09eeb5dbed8e4fc8d38682bff3a689a999330e2c420326239beaac69b",
      "2a2ee0c65a3cbdf7ee422b04f36fb5c3a690ee15fd7f7d4fba5b6acbd7092b41"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "ps-double",
    "terminator": " ",
    "quote": "\"",
    "pins": [
      "90b5ffd888dd8bc95af330a1dcfb4cc00ab67feb116194f50c0f2f8ba7692bbd",
      "4c87efb81d6e19a5a1395fb7f09171937bcff9f6cfea63e78ce6a77a291decad",
      "15273ced544fdd62a10c89b3fd510a015d976eb7ebd93fd137b2e4963dd24dab"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "ps-single",
    "terminator": " ",
    "quote": "'",
    "pins": [
      "e3120637dd00e4d412ff551793ac350889750d869d7de7f44883555124e02b7c",
      "47e68a9ee220de5d2647802297dcf038ed254cced3601f865271c4ca2698d7be",
      "bed2ae978b1ef98d11a22000069a7c409c2e916ef3ec06768a545c11221773b1"
    ],
    "continuation": true,
    "units": [
      65,
      66
    ]
  },
  {
    "name": "raw-ls-double",
    "terminator": " ",
    "quote": "\"",
    "continuation": false,
    "units": [
      65,
      8232,
      66
    ],
    "pins": [
      "1e4c4c7383dc1fb274a53c5b61c99ea5822002b88d798c9329ee1f580b079bc1",
      "f4ada1ca1513b1218bad189d07a73ebc2870f685d433673bb96ebd6a09ead631",
      "bd4c2a09a870fe57285264f83729b70ed009a199f1d26e5062e8caf61122c58b"
    ]
  },
  {
    "name": "raw-ls-single",
    "terminator": " ",
    "quote": "'",
    "continuation": false,
    "units": [
      65,
      8232,
      66
    ],
    "pins": [
      "1478c4b2481d2351a570fe3fcbea042644b011923816479cbb2d2aa428a05d1f",
      "000e3fc15e02c6b11f45cbc76b6169370bb8342f34908309519bb0f635d7b3c5",
      "2f245ebf8ac31943e2d37ae2b34d9ebff0fa5d878ddd3cde647628c9c74618b4"
    ]
  },
  {
    "name": "raw-ps-double",
    "terminator": " ",
    "quote": "\"",
    "continuation": false,
    "units": [
      65,
      8233,
      66
    ],
    "pins": [
      "e9d4554738736c3d5bdc16d102f00785b2df61f1d3024cd58add69de92a3e23e",
      "44d0dd5c68c89147688315dd8817912f02184c56ca658d7cb9569db395c6561d",
      "0abfb64fb8eacddf4f9497a03b2354d323ea1b22d143124562bc8b1f53df4e6f"
    ]
  },
  {
    "name": "raw-ps-single",
    "terminator": " ",
    "quote": "'",
    "continuation": false,
    "units": [
      65,
      8233,
      66
    ],
    "pins": [
      "26f34b37e0a57cfce40d60a61893b3eb951c935938276000ceeea5408ddf8d3b",
      "056ce571a551a948a81a659d616a8fe31dda6f71d50c1e26ee48d47305652f88",
      "ecc54ecd6eb9c8f9720bbba729a01d0a21f52331679469068f2bd429725e7055"
    ]
  }
];
for(const fixture of fixtures){
  /** @type {{coreSHA:string,officialOracleSHA:string,concat:string,source:{start:number,end:number}}|undefined} */
  let generated;
  test('official '+fixture.name+' String spelling preserves official units and every original UTF16 anchor',async()=>{
    const directory=path.join(fixtureRoot,fixture.name);
    const raw=await Promise.all(['package.json','official-oracle.json','source.ts'].map(name=>fs.readFile(path.join(directory,name))));
    raw.forEach((bytes,index)=>assert.equal(sha(bytes),fixture.pins[index],'frozen genuine Source artifact'));
    /** @type {typeof import('./testdata/common-program-string-concat-v3/official-oracle.json')} */
    const oracle=JSON.parse(raw[1].toString('utf8'));
    const source=raw[2].toString('utf8');assert.equal(oracle.sourceSha256,sha(raw[2]));
    assert.deepEqual(oracle.sourceRange,{start:0,end:source.length});
    const original=oracle.functions.find(row=>row.name==='concatValue');assert.ok(original&&original.literal);
    const literal=original.literal;
    const token=fixture.quote+'A'+(fixture.continuation?'\\':'')+fixture.terminator+'B'+fixture.quote;
    assert.equal(source.slice(literal.start,literal.end),token);
    assert.equal(original.literalToken,token);assert.deepEqual(original.literalCodeUnits,fixture.units);
    assert.ok(source.slice(0,literal.start).includes('😀'));
    const facts=readCommonProgramFacts(raw[0]);assert.equal(facts.version,3);
    const originalSource=facts.payload.files.find(row=>row.path==='/src/main.ts');assert.ok(originalSource);
    const syntax=commonSourceGrammar(originalSource,commonMeter());
    assert.deepEqual(syntax.tokens.filter(row=>row.start>=literal.start&&row.end<=literal.end),
      [{text:token,start:literal.start,end:literal.end}], 'official String literal is one original token');
    const hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:facts.version,factsBytes:raw[0],expectedPackageId:facts.packageId});
    assert.deepEqual(hir.snapshot,facts);assert.equal(hir.functions.length,3);
    assert.equal(hir.sources.find(row=>row.path==='/src/main.ts').content,source);
    for(const declaration of oracle.functions){
      const fn=hir.functions.find(row=>row.sourceBinding===declaration.id);assert.ok(fn);
      assert.deepEqual(fn.range,declaration.range);assert.equal(fn.parameters.length,1);
      assert.equal(fn.parameters[0].sourceBinding,declaration.parameterId);assert.deepEqual(fn.parameters[0].range,declaration.parameterRange);
    }
    const concat=hir.functions.find(row=>row.sourceBinding===original.id);assert.ok(concat);
    const returned=concat.body.find(row=>row.kind==='return');assert.ok(returned);
    assert.deepEqual(returned.range,original.return);const expression=returned.value;
    assert.equal(expression.kind,'stringConcat');assert.deepEqual(expression.range,original.expression);
    assert.equal(expression.right.kind,'stringLiteral');assert.deepEqual(expression.right.range,original.literal);
    assert.deepEqual(expression.right.codeUnits,fixture.units);
    const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(row=>row.kind==='kernel').map(row=>row.target).sort()};
    assert.equal(publication.contracts.length,3);assert.equal(request.targets.length,2);assert.ok(!request.targets.includes(concat.id));
    const core=commonProgramCore(hir,publication,request,{borrowProof:true});assert.ok(core.borrowProof);
    assert.match(core.text,/tsfg_program\.string/);assert.match(core.text,/tsfg_program\.binary/);
    generated={coreSHA:'sha256:'+sha(core.text),officialOracleSHA:'sha256:'+sha(raw[1]),concat:concat.id,source:original.range};
    if(outputRoot){assert.ok(path.isAbsolute(outputRoot));await fs.mkdir(outputRoot,{recursive:true});
      await fs.writeFile(path.join(outputRoot,fixture.name+'.mlir'),core.text,{flag:'wx'});}
  });
  test('actual C++ readCore verifies '+fixture.name+' complete String continuation input',
    {skip:reportRoot?false:'TSFG_STRING_LINE_REPORTS is not supplied'},async()=>{
      assert.ok(generated);assert.ok(path.isAbsolute(reportRoot));
      const report=JSON.parse(await fs.readFile(path.join(reportRoot,fixture.name,'raw/stdout.bin'),'utf8'));
      assert.equal(report.family,'tsfg.string-concat-return-origin-driver');assert.equal(report.passed,true);
      assert.deepEqual([report.coreRead,report.officialOracleBound,report.wholeProgramVerified],[true,true,true]);
      assert.equal(report.coreDigest,generated.coreSHA);assert.equal(report.officialOracleDigest,generated.officialOracleSHA);
      assert.equal(report.concat.semanticId,generated.concat);assert.deepEqual(report.concat.source.range,generated.source);
      assert.equal(report.concat.fixedReturnAvailable,true);assert.equal(report.concat.pending,false);
      assert.equal(report.firstError,null);assert.equal(report.authority,false);
      assert.deepEqual(report.execution,{source:false,vm:false,native:false,device:false});
    });
}
