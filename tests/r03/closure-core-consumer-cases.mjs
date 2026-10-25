// SPDX-License-Identifier: MIT
// Pure Node preparation only. No CLI invocation, subprocess, generated-program
// execution, C++ loading, root algorithm or MLIR parser belongs in this module.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';
import { lowerClosureEnvironments, verifyClosureEnvironments, printClosureEnvironments } from '../../compiler/closure-environments.mjs';
import { emitClosureCore } from '../../compiler/closure-core-emitter.mjs';
const schemaHash = 'sha256:d75bd977ee61cbe2add19c86b7d1d758cec32eebe52d4eabdfac79f321cfe28c';
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const inputs = {
  "returned": {"directory":"m19-function-values","frames":{"request":[2073,"sha256:1a8fdc95a48caaf4ceef02f291b7f18cffae12743e234072934b952f364efe33"],"response":[5678,"sha256:f329aca7fdbcefea2eeca81317d00f04bb18447b03d243cf1a5593b631eb5b41"],"original":[1713,"sha256:1748bb2bebfe1cac05a5a5b1ac2c6e28e457e56f3c57e9a0c426a75adf9b02a0"],"provenance":[17306,"sha256:53875a3dd1b5171e7b50ac5650cc496d43332389f1cb9e7fef162a408b7facc9"]},"origin":{"kind":"owned-go-response","producerBaseOid":"8d106b6768521c21b9ef4e7a69df023977d71b09","producerDirty":true,"testedInputSetHash":"sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b","requestSha256":"sha256:1a8fdc95a48caaf4ceef02f291b7f18cffae12743e234072934b952f364efe33","responseSha256":"sha256:f329aca7fdbcefea2eeca81317d00f04bb18447b03d243cf1a5593b631eb5b41"}},
  "factory": {"directory":"m19-closure-flow/externalAndFactoryActivations","frames":{"request":[2170,"sha256:b879f81696578db65e7bfbec9ca0539f7d777bfb80bb20d452263e9a097113d0"],"response":[7266,"sha256:6070acf1b5ea1c92993f7a186566f2d71ff0adc804967ae3969c6e882c61dc40"],"original":[1810,"sha256:a4a06e70dd181b836fc2ed708ba2d1d5370c8a869eb75c635308c428dd1273fc"],"provenance":[14759,"sha256:c47edea5f879298faf36d16fe710b3fa3272e1b3e9fc0e3267c00bac8ea5926d"]},"origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:b879f81696578db65e7bfbec9ca0539f7d777bfb80bb20d452263e9a097113d0","responseSha256":"sha256:6070acf1b5ea1c92993f7a186566f2d71ff0adc804967ae3969c6e882c61dc40","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"}},
  "callee": {"directory":"m19-closure-flow/calleeBeforeArgumentRebind","frames":{"request":[2056,"sha256:a0bcf4a037044833eace9b3c3c957ada49a413b2c1dbe64ee796018eb04f67ec"],"response":[5075,"sha256:e0265942a058eaf3b7415aa0e5d8980ba1bbadb5d6edc079acf0230e537fa53a"],"original":[1696,"sha256:6a71bd2de757784fc5d026976d5eab8b70015102bf50135b0cad6efa4c10ee1d"],"provenance":[14753,"sha256:523706e8b6b20fe59f9eb70c1e59f7e163f945aa6f11de1074afb27e08fe13f1"]},"origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:a0bcf4a037044833eace9b3c3c957ada49a413b2c1dbe64ee796018eb04f67ec","responseSha256":"sha256:e0265942a058eaf3b7415aa0e5d8980ba1bbadb5d6edc079acf0230e537fa53a","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"}},
  "parent": {"directory":"m19-closure-flow/nestedParentParameterRead","frames":{"request":[2057,"sha256:cb7c1b91b4b766809bdc2742bfe9561415595a340523f998c3b0dc3ef32443a6"],"response":[4831,"sha256:f36dec7337b190294eaccc70fda6b9306b7ff2a621e2993d9e17cec65f5bad95"],"original":[1697,"sha256:f6afbea6c3a5e7bcef18e9b3b36366ae9343de85d41802cf00ec19e6056f7eb1"],"provenance":[15129,"sha256:ce2f94fb3ee245a0105e1df1d593c1f41f1c815c1ddb763dd48eedb62e683b23"]},"origin":{"kind":"owned-go-response","producerBaseOid":"3a9461a09934e5a932a5a51ad81bd53c9c2b00e7","producerDirty":true,"requestSha256":"sha256:cb7c1b91b4b766809bdc2742bfe9561415595a340523f998c3b0dc3ef32443a6","responseSha256":"sha256:f36dec7337b190294eaccc70fda6b9306b7ff2a621e2993d9e17cec65f5bad95","testedInputSetHash":"sha256:e7fedc04d92ea8e2858f035fd001cded462b691bab8bed111ca4a0b0bd943768"}},
  "writes": {"directory":"m19-closure-flow/capturedCallableParameterWrites","frames":{"request":[2089,"sha256:817f23a81d3a9cc2afe47dda9426ec294a132541eae0e9b9ef3f49f06f9642f3"],"response":[5052,"sha256:61bb689fbffd4919b0b5da9b9f89e598bed9ed1394e2c82a19f4e585c9c856ad"],"original":[1729,"sha256:a9b8591c21d49ddd0bb355500bb136d06ccc3773a3917d78adfdd78165992ba1"],"provenance":[15141,"sha256:4f5bd686790637f7f83cdcaf9ab237036d15c47c7c040957cbd180f95c6d84ce"]},"origin":{"kind":"owned-go-response","producerBaseOid":"3a9461a09934e5a932a5a51ad81bd53c9c2b00e7","producerDirty":true,"requestSha256":"sha256:817f23a81d3a9cc2afe47dda9426ec294a132541eae0e9b9ef3f49f06f9642f3","responseSha256":"sha256:61bb689fbffd4919b0b5da9b9f89e598bed9ed1394e2c82a19f4e585c9c856ad","testedInputSetHash":"sha256:e7fedc04d92ea8e2858f035fd001cded462b691bab8bed111ca4a0b0bd943768"}},
  "rebind": {"directory":"m19-closure-flow/shortCircuitClosureRebind","frames":{"request":[2051,"sha256:5d41821e189f7365e6195ba9345d44900b21214ad25d32fbc32248be7ad738aa"],"response":[4444,"sha256:a32a1d35b1afc167fd0a1aaaf1b3dded36d7b1cfc7723bf9d190dd9d4ff9cc39"],"original":[1691,"sha256:acdc2a1c85b8df41c2331667f6d38e58f472d2ade67c2c620281427906f9114d"],"provenance":[15129,"sha256:5b41590bbf6b2631f42a7d23debe6bd47a5594b3f6f7b617131b4a6adf5088e8"]},"origin":{"kind":"owned-go-response","producerBaseOid":"3a9461a09934e5a932a5a51ad81bd53c9c2b00e7","producerDirty":true,"requestSha256":"sha256:5d41821e189f7365e6195ba9345d44900b21214ad25d32fbc32248be7ad738aa","responseSha256":"sha256:a32a1d35b1afc167fd0a1aaaf1b3dded36d7b1cfc7723bf9d190dd9d4ff9cc39","testedInputSetHash":"sha256:e7fedc04d92ea8e2858f035fd001cded462b691bab8bed111ca4a0b0bd943768"}},
  "loop": {"directory":"m19-closure-flow/branchAndLoop","frames":{"request":[2157,"sha256:905a09e46609b3bc388eb9ecd1ea12a0f14d6ed2adb2dfed27c33809bc8f92d9"],"response":[6009,"sha256:04cc5750818e82f993813fb77159794a7d7f3b29d3bf577047063d27c0b91f44"],"original":[1797,"sha256:7b93b8a695d375988420f09bc3652c81cb8620562669e8038d6fe81cecaee991"],"provenance":[14727,"sha256:f3a088e08e782a11cde9ac55ab58b882b5bed15250f03c8182bd2a9089ea573e"]},"origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:905a09e46609b3bc388eb9ecd1ea12a0f14d6ed2adb2dfed27c33809bc8f92d9","responseSha256":"sha256:04cc5750818e82f993813fb77159794a7d7f3b29d3bf577047063d27c0b91f44","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"}},
  "shared-mutable": {"directory":"m19-closure-boundaries/shared-mutable","frames":{"request":[1997,"sha256:f4bfa8f354caf312c86b88092dd8c2bbfd7923dd7ad757e82423ac51c81a63ac"],"response":[4015,"sha256:f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181"],"original":[1637,"sha256:e752c628052fdb6e98f8ea812482afc13cf8f774b24d27fef6d63a2107a2a960"],"provenance":[1625,"sha256:bb432e8db6c0b8426fe6152f23ef06c8313be3ba064453150a29a5f197a779a3"]},"origin":{"kind":"owned-go-response","producerBaseOid":"8d106b6768521c21b9ef4e7a69df023977d71b09","producerDirty":true,"testedInputSetHash":"sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b","requestSha256":"sha256:f4bfa8f354caf312c86b88092dd8c2bbfd7923dd7ad757e82423ac51c81a63ac","responseSha256":"sha256:f1772e4e0bd90317535e08bead1b2d5b8071d8b81ec621975a7b722e8f6c4181"},"testedInputs":{"path":"../../m19-function-values/provenance.json","bytes":17306,"sha256":"sha256:53875a3dd1b5171e7b50ac5650cc496d43332389f1cb9e7fef162a408b7facc9"}},
  "write-only": {"directory":"m19-closure-boundaries/write-only","frames":{"request":[1948,"sha256:b04536d47445fdbfc739a908a291f111a06efcbe86fe48a3b7fe5728e2e479d5"],"response":[3155,"sha256:c498cee1c2fe1a1c6cf9e3163250e7ddfe91de8389d506ac02880559446730ae"],"original":[1588,"sha256:4b52ac6a53fe8b345770fb01eef4a1602289f8df9b9adf917ecfe5815fe1259d"],"provenance":[1646,"sha256:9352c6ac1ee5f47d9196223370350f99c7820d985343b2bc23928045c3e12f5a"]},"origin":{"kind":"owned-go-response","producerBaseOid":"8d106b6768521c21b9ef4e7a69df023977d71b09","producerDirty":true,"testedInputSetHash":"sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b","requestSha256":"sha256:b04536d47445fdbfc739a908a291f111a06efcbe86fe48a3b7fe5728e2e479d5","responseSha256":"sha256:c498cee1c2fe1a1c6cf9e3163250e7ddfe91de8389d506ac02880559446730ae"},"testedInputs":{"path":"../../m19-function-values/provenance.json","bytes":17306,"sha256":"sha256:53875a3dd1b5171e7b50ac5650cc496d43332389f1cb9e7fef162a408b7facc9"}},
  "ancestor": {"directory":"m19-closure-boundaries/ancestor","frames":{"request":[1963,"sha256:5fdedb8c443be9ffe047fca5ce18a750d0b82d0f8d9bc90af4a914c35614860e"],"response":[2787,"sha256:4c3dfa83995bc302f9e891ff9ea3b3a9352762ac95a58de825395a9d038c5091"],"original":[1603,"sha256:a156843d49c079b3ddeec6200a9caeee9fd952643645b812c5a72c0f9ebc5075"],"provenance":[1650,"sha256:3654f3e0c132ca96f5fc4c7df1d11550620840467f897ba4e76bff0934f9db53"]},"origin":{"kind":"owned-go-response","producerBaseOid":"8d106b6768521c21b9ef4e7a69df023977d71b09","producerDirty":true,"testedInputSetHash":"sha256:12f5d80b083b2b1d7bed7163d7b2dafd757cd7c908fb123611d1df3f4d500f1b","requestSha256":"sha256:5fdedb8c443be9ffe047fca5ce18a750d0b82d0f8d9bc90af4a914c35614860e","responseSha256":"sha256:4c3dfa83995bc302f9e891ff9ea3b3a9352762ac95a58de825395a9d038c5091"},"testedInputs":{"path":"../../m19-function-values/provenance.json","bytes":17306,"sha256":"sha256:53875a3dd1b5171e7b50ac5650cc496d43332389f1cb9e7fef162a408b7facc9"}},
  "sharedCallableWrites": {"directory":"m19-closure-flow/sharedCallableWrites","frames":{"request":[2160,"sha256:ddc69f9f4559bd27eec1b93a80bc47c62e2ca058ef0a95a2c62560a3c6473b47"],"response":[6685,"sha256:1983a4e1d59f636c9dbc60391677106f9343f59f9beae23363bc7d174e623266"],"original":[1800,"sha256:4db7ecbc4435619caed85a709e290375012d891d3411e74010ba22d5f10b1acf"],"provenance":[14741,"sha256:002e3b58995ccfc3162c20c6a8272c25e8be81810710a1ecb9b9d036c4280cbc"]},"origin":{"kind":"owned-go-response","producerBaseOid":"6bab7de3ed66f5e4ca913b8387d21d7b46748a2f","producerDirty":true,"requestSha256":"sha256:ddc69f9f4559bd27eec1b93a80bc47c62e2ca058ef0a95a2c62560a3c6473b47","responseSha256":"sha256:1983a4e1d59f636c9dbc60391677106f9343f59f9beae23363bc7d174e623266","testedInputSetHash":"sha256:df7326fe7ed53ae791abdae7a4a63e15be8f17044437416134d3cd30935b3a28"}},
  "transitiveExternalRootEnvironment": {"directory":"m19-closure-flow/transitiveExternalRootEnvironment","frames":{"request":[2066,"sha256:c60167a16423b628a9026c41fb5f63d5bedbb1124a43967b7b9dfb06fc77bb73"],"response":[4420,"sha256:4fd9db8ffb55ac075a866fab65f4ff7f9b29d8fe45abb38345e36bfb62044f1a"],"original":[1706,"sha256:b78fdca5b757d2c587fc0ab08d3caa3c841120b8d8aa4534970660751eb33f7b"],"provenance":[14960,"sha256:32776cdff6f98d27b4a9b482a363f69b3b58e6ce61ead9fd5bcd95be8c4bbcb7"]},"origin":{"kind":"owned-go-response","producerBaseOid":"a8dc34ed0d7c96fe09070446b2e4e729dbad97b7","producerDirty":true,"requestSha256":"sha256:c60167a16423b628a9026c41fb5f63d5bedbb1124a43967b7b9dfb06fc77bb73","responseSha256":"sha256:4fd9db8ffb55ac075a866fab65f4ff7f9b29d8fe45abb38345e36bfb62044f1a","testedInputSetHash":"sha256:0ae8c1010eaeee5162fb180bbaac3669a2812b7c98a4e255e33e37f1b5d6b965"}},
  "initializedReturnedLocal": {"directory":"m19-closure-local-initialization/initializedReturnedLocal","frames":{"request":[2057,"sha256:9ab4ecc72426bd5a9bfa47e1bca994df3e7314027dcb46c92beb325966dfaeba"],"response":[4696,"sha256:280814d25505f19efaf69d3fafe3b6aefeb167af3892432e461483bd33d69c53"],"original":[1697,"sha256:dc4c4a2dee275dde3642c4fa397e283dee76da77d51a5d015a2f6a424357195b"],"provenance":[1188,"sha256:3f832d1f59b0f3d8cffe169edf1f860f75104ffac66616823895ee7ae3006905"]},"origin":{"kind":"owned-go-response","producerBaseOid":"e73eafaf80eeffc5040f4eef7cd2a58951cfbce1","producerDirty":true,"requestSha256":"sha256:9ab4ecc72426bd5a9bfa47e1bca994df3e7314027dcb46c92beb325966dfaeba","responseSha256":"sha256:280814d25505f19efaf69d3fafe3b6aefeb167af3892432e461483bd33d69c53","testedInputSetHash":"sha256:0a3cba29831a9ed1333ad2c195e98ca7f87564a6614e2c44f8d4dcf43d33dc36"},"testedInputs":{"path":"../tested-inputs.json","bytes":13260,"sha256":"sha256:3ab5c58dd5ea1ccbb44435d920bcbfa4f56135a65b1c275857a8058525843cd1","canonicalHash":"sha256:0a3cba29831a9ed1333ad2c195e98ca7f87564a6614e2c44f8d4dcf43d33dc36"}},
  "initializedCallbackLocal": {"directory":"m19-closure-local-initialization/initializedCallbackLocal","frames":{"request":[1982,"sha256:5688898d3f5766888b70cdf8fb657f2e61a81eceeff0d391ffc98169d3522d9a"],"response":[3494,"sha256:41d421954710596fb2998a56bcc6566e717ff18546890595adc0edfd5833102b"],"original":[1622,"sha256:b9c1ec446db187cbcdc1491922dbf91523fe2592271eb0a596ceec9b2e874266"],"provenance":[1188,"sha256:56199dc4814cc84c264b10135555b32ea86383e2eb9725811c2b86ac1863fef4"]},"origin":{"kind":"owned-go-response","producerBaseOid":"e73eafaf80eeffc5040f4eef7cd2a58951cfbce1","producerDirty":true,"requestSha256":"sha256:5688898d3f5766888b70cdf8fb657f2e61a81eceeff0d391ffc98169d3522d9a","responseSha256":"sha256:41d421954710596fb2998a56bcc6566e717ff18546890595adc0edfd5833102b","testedInputSetHash":"sha256:0a3cba29831a9ed1333ad2c195e98ca7f87564a6614e2c44f8d4dcf43d33dc36"},"testedInputs":{"path":"../tested-inputs.json","bytes":13260,"sha256":"sha256:3ab5c58dd5ea1ccbb44435d920bcbfa4f56135a65b1c275857a8058525843cd1","canonicalHash":"sha256:0a3cba29831a9ed1333ad2c195e98ca7f87564a6614e2c44f8d4dcf43d33dc36"}},
  "recursiveFreshLocal": {"directory":"m19-closure-local-initialization/recursiveFreshLocal","frames":{"request":[2090,"sha256:2828e3c91b0edb1046d799ece00fe9bd96c9770285dd6c99acea3dc227dd0d91"],"response":[5659,"sha256:2b97ba76d5d49a369c2418ea774d4e4a31d046adf59f25ed0a3e72bcde92aa28"],"original":[1730,"sha256:bc515f852a983c0537fd215004f3ed3fd0a1e7ae7daa2fc376a04176dc218764"],"provenance":[1183,"sha256:fd5098da2f305b44555170473261a61d5a8d0b63a156bb387c61202379876b10"]},"origin":{"kind":"owned-go-response","producerBaseOid":"e73eafaf80eeffc5040f4eef7cd2a58951cfbce1","producerDirty":true,"requestSha256":"sha256:2828e3c91b0edb1046d799ece00fe9bd96c9770285dd6c99acea3dc227dd0d91","responseSha256":"sha256:2b97ba76d5d49a369c2418ea774d4e4a31d046adf59f25ed0a3e72bcde92aa28","testedInputSetHash":"sha256:0a3cba29831a9ed1333ad2c195e98ca7f87564a6614e2c44f8d4dcf43d33dc36"},"testedInputs":{"path":"../tested-inputs.json","bytes":13260,"sha256":"sha256:3ab5c58dd5ea1ccbb44435d920bcbfa4f56135a65b1c275857a8058525843cd1","canonicalHash":"sha256:0a3cba29831a9ed1333ad2c195e98ca7f87564a6614e2c44f8d4dcf43d33dc36"}},
  "afterIfInitializerCall": {"directory":"m19-local-core-cases/afterIfInitializerCall","frames":{"request":[2041,"sha256:a7dc8573a3c8d9d8aa236307548a9f519ea342050b0133a5df66f9d4a6c536c0"],"response":[4440,"sha256:0320039d2a846e7d726d441dc1b2ad02e47e4f3e219128a3b3a43c418c72d284"],"original":[1681,"sha256:f8df2c951b4d7db2a3eace0e499628f9156a367836d7ca789969d4cc7b02e0d7"],"provenance":[1180,"sha256:be51f2798fdcd70a1e49cedec3e6537021d2c12ca56c47ba2461d249cd9847e9"]},"origin":{"kind":"owned-go-response","producerBaseOid":"3cedbc286daff5cbc69daf9ca6dc25dfa9426ed6","producerDirty":true,"requestSha256":"sha256:a7dc8573a3c8d9d8aa236307548a9f519ea342050b0133a5df66f9d4a6c536c0","responseSha256":"sha256:0320039d2a846e7d726d441dc1b2ad02e47e4f3e219128a3b3a43c418c72d284","testedInputSetHash":"sha256:f44cd717ccb6f807f54b5fe298e8d0b7d2290a93ecb681c59cbc8c2c66fe1aa2"},"testedInputs":{"path":"../tested-inputs.json","bytes":13260,"sha256":"sha256:d4c0d3ff8a4f79ae9d80ac905447c3d0a03d064cb8ce331b32c2c93ca6f8f36b","canonicalHash":"sha256:f44cd717ccb6f807f54b5fe298e8d0b7d2290a93ecb681c59cbc8c2c66fe1aa2"}},
  "afterWhileLocalInitialization": {"directory":"m19-local-core-cases/afterWhileLocalInitialization","frames":{"request":[1979,"sha256:d71dab75c021afcbfa6f44433348ee2c78ee632a30bcfefb0e251f2fe7e17090"],"response":[2970,"sha256:f7678a902e0dc6fe029af5232fb8f960a12366873b957789b75164f630815de6"],"original":[1619,"sha256:47c0da35ed980f209c80387bc5da1f5716bf6e52dc2bffa462897956299c6e22"],"provenance":[1187,"sha256:598d678f0337e3cde50bad333d1aff391db59a184b37e104fc8ed274208e9726"]},"origin":{"kind":"owned-go-response","producerBaseOid":"3cedbc286daff5cbc69daf9ca6dc25dfa9426ed6","producerDirty":true,"requestSha256":"sha256:d71dab75c021afcbfa6f44433348ee2c78ee632a30bcfefb0e251f2fe7e17090","responseSha256":"sha256:f7678a902e0dc6fe029af5232fb8f960a12366873b957789b75164f630815de6","testedInputSetHash":"sha256:f44cd717ccb6f807f54b5fe298e8d0b7d2290a93ecb681c59cbc8c2c66fe1aa2"},"testedInputs":{"path":"../tested-inputs.json","bytes":13260,"sha256":"sha256:d4c0d3ff8a4f79ae9d80ac905447c3d0a03d064cb8ce331b32c2c93ca6f8f36b","canonicalHash":"sha256:f44cd717ccb6f807f54b5fe298e8d0b7d2290a93ecb681c59cbc8c2c66fe1aa2"}},
};
const one = values => { assert.equal(values.length, 1); return values[0]; };
const named = (program, name) => one(program.functions.filter(fn => fn.name === name));
const symbol = fn => 'f' + fn.id.slice(7);
const anchor = range => 'tsfg_source.start = ' + range.start + ' : i64, tsfg_source.end = ' + range.end + ' : i64';
function replace(text, before, after) {
  assert.equal(text.split(before).length, 2, 'one exact mutation site');
  const result = text.replace(before, after); assert.notEqual(result, text); return result;
}
function functionText(text, fn) {
  const start = text.indexOf('  func.func @"' + symbol(fn) + '"('); assert.ok(start >= 0);
  const end = text.indexOf('\n  }', start); assert.ok(end > start);
  return text.slice(start, end + 4);
}
function operation(text, name, range) {
  return one(text.split('\n').filter(line => line.includes('"' + name + '"(') && line.includes(anchor(range))));
}
function result(line) { return one([...line.matchAll(/^    (%v[0-9]+) = /g)])[1]; }
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function operands(line, name) {
  const start = line.indexOf('"' + name + '"('); assert.ok(start >= 0);
  const value = line.slice(start + name.length + 3).split(')')[0]; return value ? value.split(', ') : [];
}
// Only selected real operation lines are observed; no MLIR parser or root algorithm.
function localInfo(item, name = 'entry') {
  const fn = named(item.program, name), hirFn = named(item.hir, name), body = functionText(item.text, fn);
  const declaration = one(hirFn.body.filter(statement => statement.kind === 'local' && statement.binding.name === 'state'));
  const layout = one(item.program.environments.filter(environment => environment.owner === fn.id));
  const init = operation(body, 'tsfg_closure.env.init', declaration.range);
  const alloc = operation(body, 'tsfg_closure.env.alloc', hirFn.definitionRange);
  const ordinal = hirFn.body.filter(statement => statement.kind === 'local').indexOf(declaration);
  const slot = '{binding = "' + declaration.binding.id + '", type = "' + declaration.binding.type + '", writable = ' + declaration.binding.writable
    + ', role = "local", declaration_index = ' + ordinal + ' : i64}';
  assert.ok(item.text.slice(0, item.text.indexOf('\n')).includes(slot));
  return { fn, hirFn, body, declaration, layout, init, alloc, slot };
}
function moveAfter(text, line, destination) {
  return replace(replace(text, line + '\n', ''), destination + '\n', destination + '\n' + line + '\n');
}
export async function readClosureSourceCase(name) {
  const pin = inputs[name], directory = new URL('../fixtures/r03/' + pin.directory + '/', import.meta.url);
  /** @type {Record<string, Buffer>} */ const frames = {};
  for (const kind of ['request', 'response', 'original', 'provenance']) {
    frames[kind] = await readFile(new URL(kind + '.json', directory));
    assert.equal(frames[kind].length, pin.frames[kind][0]); assert.equal(sha(frames[kind]), pin.frames[kind][1]);
  }
  const provenance = JSON.parse(frames.provenance.toString('utf8'));
  assert.deepEqual(provenance.origin, pin.origin);
  const request = JSON.parse(frames.request.toString('utf8')), original = JSON.parse(frames.original.toString('utf8'));
  assert.deepEqual(request.files, original.files); assert.equal(request.rootFile, original.rootFile);
  const raw = JSON.parse(frames.response.toString('utf8')); assert.equal(raw.status, 'ok');
  if (pin.testedInputs) {
    const bytes = await readFile(new URL(pin.testedInputs.path, directory));
    assert.equal(bytes.length, pin.testedInputs.bytes); assert.equal(sha(bytes), pin.testedInputs.sha256);
    const values = JSON.parse(bytes.toString('utf8'));
    assert.equal(provenance.testedInputSetReference.path, pin.testedInputs.path);
    assert.equal(provenance.testedInputSetReference.sha256, pin.testedInputs.sha256);
    if (pin.testedInputs.canonicalHash) {
      assert.ok(Array.isArray(values)); assert.equal(values.length, 90);
      assert.equal(sha(jcs(values)), pin.testedInputs.canonicalHash);
      assert.equal(pin.origin.testedInputSetHash, pin.testedInputs.canonicalHash);
    } else {
      // These three original frames refer to an entire, separately pinned
      // provenance object. Its embedded 87-member set is the old hash preimage.
      assert.ok(['shared-mutable', 'write-only', 'ancestor'].includes(name));
      assert.equal(pin.testedInputs.path, '../../m19-function-values/provenance.json');
      assert.ok(values && typeof values === 'object' && !Array.isArray(values));
      assert.deepEqual(values.origin, inputs.returned.origin);
      assert.deepEqual(values.execution, provenance.execution); assert.equal(values.deliveryOid, provenance.deliveryOid);
      assert.deepEqual(values.credit, { ownedGoResponse: true, sourceExecutable: false, admitted: false, executionAuthority: false });
      assert.ok(Array.isArray(values.testedInputSet)); assert.equal(values.testedInputSet.length, 87);
      assert.equal(sha(jcs(values.testedInputSet)), pin.origin.testedInputSetHash);
      assert.equal(values.origin.testedInputSetHash, pin.origin.testedInputSetHash);
    }
  }
  const imported = await importCapturedFrontendResponse(frames.request, frames.response, provenance.origin);
  assert.equal(imported.status, 'ok', JSON.stringify(imported)); validateFrontendSnapshot(imported.snapshot);
  const built = buildHir(imported.snapshot); assert.equal(built.status, 'ok', JSON.stringify(built));
  const hirBytes = printHir(verifyHir(built.hir)), hir = readHir(Buffer.from(hirBytes));
  return {hir,provenance,pin};
}
async function sourceCase(name) {
  const {hir,provenance,pin}=await readClosureSourceCase(name);
  const hirBytes=printHir(hir);
  const program = lowerClosureEnvironments(hir); assert.deepEqual(verifyClosureEnvironments(program, hir), program);
  const programBytes = printClosureEnvironments(program, hir), text = emitClosureCore(program, hir);
  const schema = JSON.parse(await readFile(new URL('../../contracts/core-closure-candidate.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.family, 'tsfg.core-closure-candidate'); assert.equal(schema.version, 2); assert.equal(sha(jcs(schema)), schemaHash);
  const metadata = text.slice(0, text.indexOf('\n'));
  assert.ok(metadata.includes('family = "' + schema.family + '", version = 2 : i64, schema = "' + schemaHash + '"'));
  assert.ok(metadata.includes('program_hash = "' + sha(programBytes) + '", hir_hash = "' + sha(hirBytes) + '"'));
  assert.equal(program.hirHash, sha(hirBytes)); assert.ok(text.endsWith('\n')); assert.doesNotMatch(text, /\r|undefined|NaN/);
  assert.equal(emitClosureCore(program, hir), text); assert.equal(printHir(hir), hirBytes);
  assert.equal(printClosureEnvironments(program, hir), programBytes);
  return { name, text, hir, program, provenance, manifest: { source: pin, schema: schemaHash, core: { bytes: Buffer.byteLength(text), sha256: sha(text) },
    hir: { bytes: Buffer.byteLength(hirBytes), sha256: sha(hirBytes) }, program: { bytes: Buffer.byteLength(programBytes), sha256: sha(programBytes) } } };
}

/** Return artifacts to an explicitly authorized caller; never write/run them.
 * C++ parse/verify/root acceptance remains an independent human task.
 */
export async function createClosureConsumerCases() {
  /** @type {Record<string, any>} */ const success = {};
  for (const name of Object.keys(inputs)) success[name] = await sourceCase(name);
  const base = success.returned, program = base.program, make = named(program, 'make'), read = named(program, 'read');
  const makeBody = functionText(base.text, make), readBody = functionText(base.text, read), layout = one(program.environments);
  const value = one(program.bindings.filter(binding => binding.id === make.parameters[0]));
  const init = operation(makeBody, 'tsfg_closure.env.init', value.range);
  const load = operation(readBody, 'tsfg_closure.env.load', read.body[0].value.range);
  const header = base.text.slice(0, base.text.indexOf('\n'));
  const marker = header.indexOf(', tsfg_core.closure = '); assert.ok(marker > 0 && header.endsWith('} {'));
  /** @type {any[]} */ const negative = [];
  const diagnostics = {
    'closure-routing': '[core-ir-closure-marker]', 'closure-metadata': '[core-ir-closure-metadata]',
    'closure-identities': '[core-ir-closure-metadata]', 'closure-function-set': '[core-ir-closure-invalid]',
    'closure-program': '[core-ir-closure-invalid]', 'closure-function-signature': '[core-ir-closure-invalid]',
    'closure-initialization': '[core-ir-closure-initialization]', 'closure-cfg': '[core-ir-closure-cfg]',
    'closure-input-budget': '[core-ir-closure-budget]',
  };
  const add = (name, origin, text, layer, diagnostic = diagnostics[layer]) => {
    assert.notEqual(text, success[origin].text);
    negative.push({ name, origin, text, expect: { exitCode: 3, stdoutBytes: 0, layer, diagnostic, mode: '--canonicalize',
      driverDiagnostic: layer === 'closure-routing' ? '[core-ir-closure-metadata]' : layer === 'parse-or-mlir' ? '[closure-consumer-driver] parse/MLIR verification failed' : layer === 'closure-input-budget' ? '[closure-consumer-driver] input byte limit' : diagnostic },
      bytes: Buffer.byteLength(text), sha256: sha(text) });
  };
  add('no-marker', 'returned', replace(base.text, header, header.slice(0, marker) + '} {'), 'closure-routing');
  add('mixed-marker', 'returned', replace(base.text, ', tsfg_core.closure = ', ', tsfg_core.reference = {}, tsfg_core.closure = '), 'closure-routing');
  add('unknown-roots-field', 'returned', replace(base.text, 'root_policy = "consumer-recompute-required", ', 'root_policy = "consumer-recompute-required", roots = [], '), 'closure-metadata');
  add('wrong-schema', 'returned', replace(base.text, 'schema = "sha256:d75bd977ee61cbe2add19c86b7d1d758cec32eebe52d4eabdfac79f321cfe28c"', 'schema = "sha256:' + '0'.repeat(64) + '"'), 'closure-metadata');
  const hashField = one([...header.matchAll(/program_hash = "[^"]+"/g)])[0];
  add('malformed-program-hash', 'returned', replace(base.text, hashField, 'program_hash = "sha256:bad"'), 'closure-metadata');
  const forgedId = 'sha256:' + 'f'.repeat(64);
  assert.ok(!base.text.includes(forgedId));
  add('function-id-preimage', 'returned', base.text.replaceAll(read.id, forgedId).replaceAll(symbol(read), 'f' + 'f'.repeat(64)), 'closure-identities');
  add('wrong-symbol', 'returned', replace(base.text, 'func.func @"' + symbol(read) + '"(', 'func.func @"g' + read.id.slice(7) + '"('), 'closure-function-set');
  add('missing-function', 'returned', replace(base.text, readBody + '\n', ''), 'closure-function-set');
  add('wrong-slot', 'returned', replace(base.text, load, replace(load, 'binding = "' + value.id + '"', 'binding = "' + forgedId + '"')), 'closure-program');
  add('missing-init', 'returned', replace(base.text, init + '\n', ''), 'closure-initialization');
  add('duplicate-init', 'returned', replace(base.text, init + '\n', init + '\n' + init + '\n'), 'closure-initialization');
  const preLoad = '    %preinit = "tsfg_closure.env.load"(%v1) {binding = "' + value.id + '", ' + anchor(value.range) + '} : (!tsfg_closure.env<"' + layout.id + '">) -> i1';
  add('load-before-init', 'returned', replace(base.text, init, preLoad + '\n' + init), 'closure-initialization');
  add('readonly-parameter-slot', 'returned', replace(base.text, 'writable = true, role = "parameter"', 'writable = false, role = "parameter"'), 'closure-identities');
  const entry = named(program, 'entry'), direct = operation(functionText(base.text, entry), 'func.call', entry.body.at(-1).value.range);
  add('wrong-direct-signature', 'returned', replace(base.text, direct, replace(direct, 'tsfg_core.signature_hash = "' + named(program, 'invoke').signatureHash + '"', 'tsfg_core.signature_hash = "' + forgedId + '"')), 'closure-program');
  const parentCase = success.parent, parentInvoke = named(parentCase.program, 'invoke'), parentMake = named(parentCase.program, 'make');
  const parentEntry = named(parentCase.program, 'entry'), parentExpr = parentInvoke.body.at(-1).value;
  const inner = one(parentCase.program.environments.filter(item => item.owner === parentMake.id));
  const outer = one(parentCase.program.environments.filter(item => item.owner === parentEntry.id));
  const parentLine = operation(functionText(parentCase.text, parentInvoke), 'tsfg_closure.env.parent', parentExpr.right.range);
  const parentLoad = operation(functionText(parentCase.text, parentInvoke), 'tsfg_closure.env.load', parentExpr.right.range);
  let wrongParent = replace(parentCase.text, parentLine, replace(parentLine, '-> !tsfg_closure.env<"' + outer.id + '">', '-> !tsfg_closure.env<"' + inner.id + '">'));
  wrongParent = replace(wrongParent, parentLoad, replace(parentLoad, ': (!tsfg_closure.env<"' + outer.id + '">)', ': (!tsfg_closure.env<"' + inner.id + '">)'));
  add('wrong-parent-result-layout', 'parent', wrongParent, 'closure-program');
  const invokeHidden = functionText(parentCase.text, parentInvoke);
  add('wrong-hidden-environment', 'parent', replace(parentCase.text, invokeHidden,
    invokeHidden.replaceAll('!tsfg_closure.env<"' + inner.id + '">', '!tsfg_closure.env<"' + outer.id + '">')), 'closure-function-signature');
  const writes = success.writes, writer = named(writes.program, 'entry'), writerSelected = one(writes.program.bindings.filter(binding => binding.id === writer.parameters[0]));
  const writerInit = operation(functionText(writes.text, writer), 'tsfg_closure.env.init', writerSelected.range);
  add('init-wrong-actual-parameter', 'writes', replace(writes.text, writerInit, replace(writerInit, ', %v0)', ', %v1)')), 'closure-initialization');
  const invoke = named(program, 'invoke'), invokeBody = functionText(base.text, invoke), invokeExpr = invoke.body[0].value;
  const call = operation(invokeBody, 'tsfg_closure.call', invokeExpr.range);
  const scalar = '    %scalarcallee = "tsfg_core.constant"() {value = 0 : i1, ' + anchor(invokeExpr.range) + '} : () -> i1';
  add('scalar-closure-callee', 'returned', replace(base.text, call, scalar + '\n' + call.replace('(%v0)', '(%scalarcallee)').replace(/: \(!tsfg_closure[.]value<"[^"]+">\)/, ': (i1)')), 'parse-or-mlir', '[core-ir-invalid]');
  const rebind = success.rebind, rebindEntry = named(rebind.program, 'entry'), rebindBody = functionText(rebind.text, rebindEntry);
  const closureEdge = one(rebindBody.split('\n').filter(line => line.includes('cf.br ') && line.includes(': ') && line.includes('!tsfg_closure.value<')).slice(0, 1));
  add('wrong-phi-edge-type', 'rebind', replace(rebind.text, closureEdge, closureEdge.replace(/!tsfg_closure[.]value<"[^"]+">/, 'i1')), 'parse-or-mlir', '[core-ir-invalid]');
  const entryBody = functionText(base.text, entry), dead = '  ^bb_dead:\n    %dead = "tsfg_core.constant"() {value = 0 : i1, ' + anchor(entry.range) + '} : () -> i1\n    "func.return"(%dead) {' + anchor(entry.range) + '} : (i1) -> ()\n';
  add('unreachable-block', 'returned', replace(base.text, entryBody, entryBody.slice(0, -3) + dead + '  }'), 'closure-cfg');
  const loopCase = success.loop, loopBody = functionText(loopCase.text, named(loopCase.program, 'entry'));
  const fuel = one(loopBody.split('\n').filter(line => line.includes('"tsfg_core.fuel"() {event = 2 : i32')));
  add('loop-fuel-bypass', 'loop', replace(loopCase.text, fuel + '\n', ''), 'closure-cfg');
  add('input-byte-budget', 'returned', base.text + '\n//' + 'x'.repeat(8388609 - Buffer.byteLength(base.text) - 3), 'closure-input-budget');
  // Core2 protocol mutations keep real scalar/env types and dominance. Human
  // verification must reach the named consumer layer, not merely fail parsing.
  const typed = (name, origin, text, layer, description) => {
    add(name, origin, text, layer);
    Object.assign(negative.at(-1), { mutation: description });
    Object.assign(negative.at(-1).expect, { mlirVerification: 'must-succeed-before-consumer' });
  };
  typed('old-core-version', 'returned', replace(base.text, 'family = "tsfg.core-closure-candidate", version = 2 : i64',
    'family = "tsfg.core-closure-candidate", version = 1 : i64'), 'closure-metadata', 'Only private closure version changes.');
  const mutable = success['shared-mutable'], scalarLocal = localInfo(mutable), localId = scalarLocal.declaration.binding.id;
  for (const [name, field, changed] of [
    ['local-role-unknown', 'role = "local"', 'role = "unknown"'],
    ['local-role-parameter', 'role = "local"', 'role = "parameter"'],
    ['local-index-negative', 'declaration_index = 0 : i64', 'declaration_index = -1 : i64'],
    ['local-index-overflow', 'declaration_index = 0 : i64', 'declaration_index = 4294967296 : i64'],
  ]) typed(name, 'shared-mutable', replace(mutable.text, scalarLocal.slot, replace(scalarLocal.slot, field, changed)),
    'closure-identities', 'Only slot role/index changes; complete BindingId remains original.');
  const ordinal = success.initializedReturnedLocal, ordinalInfo = localInfo(ordinal, 'make');
  typed('local-index-skips-uncaptured-declaration', 'initializedReturnedLocal', replace(ordinal.text, ordinalInfo.slot,
    replace(ordinalInfo.slot, 'declaration_index = 1 : i64', 'declaration_index = 0 : i64')), 'closure-identities',
    'state follows uncaptured before; the complete original BindingId is unchanged.');
  const wrongOwnerPrefix = '{id = "' + scalarLocal.layout.id + '", owner = "' + scalarLocal.fn.id + '"';
  typed('local-layout-wrong-owner', 'shared-mutable', replace(mutable.text, wrongOwnerPrefix,
    '{id = "' + scalarLocal.layout.id + '", owner = "' + named(mutable.program, 'read').id + '"'), 'closure-identities',
    'Only layout owner changes; original layout preimage and complete IDs remain.');
  const constant = success.ancestor, constLocal = localInfo(constant);
  assert.equal(constLocal.declaration.binding.writable, false);
  const storeInstead = replace(replace(constLocal.init, '"tsfg_closure.env.init"', '"tsfg_closure.env.store"'), ', anchor_kind = "source"', '');
  typed('readonly-local-store', 'ancestor', replace(constant.text, constLocal.init, storeInstead), 'closure-program',
    'Same typed operands; readonly local env.init becomes an ordinary forbidden env.store.');
  typed('local-missing-init', 'shared-mutable', replace(mutable.text, scalarLocal.init + '\n', ''), 'closure-initialization',
    'Original direct write observes the still uninitialized cell.');
  typed('local-duplicate-init', 'shared-mutable', replace(mutable.text, scalarLocal.init + '\n', scalarLocal.init + '\n' + scalarLocal.init + '\n'),
    'closure-initialization', 'Duplicate zero-result init, with unchanged dominating seed.');
  typed('local-wrong-anchor-kind', 'shared-mutable', replace(mutable.text, scalarLocal.init,
    replace(scalarLocal.init, 'anchor_kind = "source"', 'anchor_kind = "parameter"')), 'closure-initialization', 'Only local init anchor kind changes.');
  const localRead = named(mutable.program, 'read'), localReadBody = functionText(mutable.text, localRead);
  const readFuel = operation(localReadBody, 'tsfg_core.fuel', localRead.range), localType = '!tsfg_closure.env<"' + scalarLocal.layout.id + '">';
  assert.ok(!localReadBody.includes('%wrong_owner_value'));
  const falseValue = '    %wrong_owner_value = "tsfg_core.constant"() {value = 0 : i1, ' + anchor(localRead.range) + '} : () -> i1';
  const ancestorInit = '    "tsfg_closure.env.init"(%v0, %wrong_owner_value) {binding = "' + localId + '", anchor_kind = "source", '
    + anchor(localRead.range) + '} : (' + localType + ', i1) -> ()';
  typed('local-init-in-nested-owner', 'shared-mutable', replace(mutable.text, localReadBody,
    replace(localReadBody, readFuel + '\n', readFuel + '\n' + falseValue + '\n' + ancestorInit + '\n')), 'closure-initialization',
    'Nested read attempts to initialize ancestor slot using its actual typed hidden env; all new uses dominate.');
  const firstWrite = one(scalarLocal.hirFn.body.filter(item => item.kind === 'expression' && item.value.kind === 'call'));
  const firstWriteCall = operation(scalarLocal.body, 'func.call', firstWrite.value.range);
  typed('local-direct-need-before-init', 'shared-mutable', moveAfter(mutable.text, scalarLocal.init, firstWriteCall), 'closure-initialization',
    'Move init after the original write direct-call; seed/env still dominate.');
  const throughMiddle = operation(constLocal.body, 'func.call', constLocal.hirFn.body.at(-1).value.range);
  typed('local-transitive-need-before-init', 'ancestor', moveAfter(constant.text, constLocal.init, throughMiddle), 'closure-initialization',
    'Move init after direct middle call; Need must transit the empty direct-capture middle to read.');
  const callback = success.initializedCallbackLocal, callbackInfo = localInfo(callback);
  const published = operation(callbackInfo.body, 'tsfg_closure.make', callbackInfo.hirFn.body.at(-1).value.arguments[0].range);
  typed('local-make-need-before-init', 'initializedCallbackLocal', moveAfter(callback.text, callbackInfo.init, published), 'closure-initialization',
    'Move init after publication but before invoke; real env and RHS already dominate.');
  const joined = success.afterIfInitializerCall, joinedInfo = localInfo(joined);
  const ifStatement = one(joinedInfo.hirFn.body.filter(item => item.kind === 'if'));
  assert.equal(named(joined.hir, 'identity').captures.length, 0);
  assert.deepEqual(named(joined.hir, 'read').captures, [{ binding: joinedInfo.declaration.binding.id, read: true, write: false }]);
  assert.ok(ifStatement.range.end < joinedInfo.declaration.range.start);
  const initializerCall = operation(joinedInfo.body, 'func.call', joinedInfo.declaration.initializer.range);
  const initArguments = operands(initializerCall, 'func.call'); assert.equal(initArguments.length, 2);
  assert.equal(initArguments[0], result(joinedInfo.alloc));
  assert.deepEqual(operands(joinedInfo.init, 'tsfg_closure.env.init'), [result(joinedInfo.alloc), result(initializerCall)]);
  assert.ok(joinedInfo.body.indexOf(initializerCall) < joinedInfo.body.indexOf(joinedInfo.init));
  assert.ok(joinedInfo.body.slice(0, joinedInfo.body.indexOf(initializerCall)).includes('\n  ^bb'));
  const yesFalse = operation(joinedInfo.body, 'tsfg_core.constant', ifStatement.thenBody[0].body[0].value.range);
  // The moved initializer must use the original dominating scalar parameter,
  // not the removed join's block argument. Its result has only the init use.
  const movedCall = replace(initializerCall, '(' + initArguments.join(', ') + ')', '(' + initArguments[0] + ', %v0)');
  const withoutJoinInit = replace(replace(joined.text, initializerCall + '\n', ''), joinedInfo.init + '\n', '');
  typed('local-join-missing-must-init', 'afterIfInitializerCall', replace(withoutJoinInit, yesFalse + '\n',
    yesFalse + '\n' + movedCall + '\n' + joinedInfo.init + '\n'), 'closure-initialization',
    'Only yes branch initializes; no branch reaches final read without init. Call uses entry seed, preserving dominance.');
  const whiled = success.afterWhileLocalInitialization, whileInfo = localInfo(whiled);
  const whileStatement = one(whileInfo.hirFn.body.filter(item => item.kind === 'while'));
  assert.ok(whileStatement.range.end < whileInfo.declaration.range.start);
  assert.deepEqual(named(whiled.hir, 'read').captures, [{ binding: whileInfo.declaration.binding.id, read: true, write: false }]);
  const whileFalse = operation(whileInfo.body, 'tsfg_core.constant', whileStatement.body[0].body[0].value.range);
  const oldInitArguments = operands(whileInfo.init, 'tsfg_closure.env.init');
  assert.equal(oldInitArguments[0], result(whileInfo.alloc));
  const backedgeInit = replace(whileInfo.init, '(' + oldInitArguments.join(', ') + ')', '(' + oldInitArguments[0] + ', %v0)');
  typed('local-loop-may-repeat-init', 'afterWhileLocalInitialization', replace(whiled.text, whileFalse + '\n', whileFalse + '\n' + backedgeInit + '\n'),
    'closure-initialization', 'Retain exit init and add body init before backedge; use entry seed, never an exit phi. May detects prior body/exit init possibilities.');
  const wire = ['--emit-bytecode', '--emit-nullable-candidate'].map(mode => ({ name: mode.slice(2), origin: 'returned', text: base.text,
    expect: { exitCode: 3, stdoutBytes: 0, layer: 'closure-wire-boundary', diagnostic: '[r04-core-closure-unsupported]', mode } }));
  return { actualNativeRED: false, actualNativeExecution: false, status: 'DRAFT: root goldens and final diagnostic pins require independent completion', success, negative, wire,
    rootsExpected: {}, note: 'No C++ consumer or generated code has run. Root may persist these exact Node artifacts for human validation.' };
}

const destination = 'E:/ws/pro_tsfg/.scratch/tsfg_r03/M19-local-core-consumer-checks-20261017/fixtures';
/** Persist preparation artifacts only to the explicit approved scratch directory. */
export async function writeClosureConsumerCases(outputDirectory) {
  assert.equal(outputDirectory.replaceAll('\\', '/').replace(/\/$/, ''), destination);
  const prepared = await createClosureConsumerCases();
  await mkdir(destination, { recursive: true });
  const write = async (name, text) => writeFile(destination + '/' + name, text, { encoding: 'utf8', flag: 'wx' });
  const manifest = { status: prepared.status, actualNativeRED: false, actualNativeExecution: false, success: [], negative: [], wire: [], rootsExpected: prepared.rootsExpected };
  for (const [name, item] of Object.entries(prepared.success)) {
    const file = name + '.mlir'; await write(file, item.text);
    manifest.success.push({ name, file, ...item.manifest, functions: item.program.functions.map(fn => ({ id: fn.id, name: fn.name })) });
  }
  for (const item of prepared.negative) {
    const file = item.name + '.negative.mlir'; await write(file, item.text);
    manifest.negative.push({ name: item.name, origin: item.origin, file, expect: item.expect, bytes: item.bytes, sha256: item.sha256 });
  }
  for (const item of prepared.wire) manifest.wire.push({ name: item.name, origin: item.origin, file: item.origin + '.mlir', expect: item.expect });
  await write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 3, 'one explicit approved output directory argument is required');
  await writeClosureConsumerCases(process.argv[2]);
}
