// SPDX-License-Identifier: MIT
// Fresh, complete hand-authored ordinary-FDI cold-metadata inputs.
// Literal assembly/identity arithmetic: ordinary-fdi-literal-oracle.cjs.
// Synthetic source descriptors establish joins only; no Source facts or body
// admission/execution is asserted. Empty instruction lists are intentional:
// this target calls only the listed metadata APIs plus the narrow standalone
// annotation grammar owner seam; never whole Source/graph/Actual/VM admission.
#include "bytecode-common-verify-tables.h"
#include "bytecode-common-cold.h"
#include "common-program-syntax.h"
#include "llvm/Support/Error.h"
#include <iostream>
#include <utility>

namespace OrdinaryFDIMetadataHarness {
struct Result {
  bool passed;
  const char *stage;
  std::string detail;
  size_t remaining;
  size_t ordinaryInputs=0;
  std::string incoming,declared;
  uint16_t minimum=UINT16_MAX;
};
Result check(const tsfg::wire::Program &program){
  using namespace tsfg::wire;
  Error error;size_t remaining=tsfg::commonProgram::programWorkLimit;
  CommonTableVerifier tables{program,error,remaining};
  if(!tables.directory())return {false,"directory",error.message,remaining};
  if(!tables.semanticTypes())return {false,"semantic-types",error.message,remaining};
  if(!tables.memberJoins())return {false,"member-joins",error.message,remaining};
  if(!tables.storageJoins())return {false,"storage-joins",error.message,remaining};
  if(!tables.moduleJoins())return {false,"module-joins",error.message,remaining};
  CommonCold cold{tables};
  if(!cold.publicationBoundary())return {false,"publication-boundary",error.message,remaining};
  if(!cold.metadata())return {false,"metadata",error.message,remaining};
  if(!cold.interfaces())return {false,"interfaces",error.message,remaining};
  Result out{true,"metadata-compatible",{},remaining,cold.model.ordinaryParameterInputs.size()};
  if(out.ordinaryInputs==1){
    const auto &entry=cold.model.ordinaryParameterInputs.begin()->second;
    out.minimum=entry.minimumArgumentCount;
    if(entry.argumentTypes.size()==1)out.incoming=entry.argumentTypes.front();
  }
  const auto &functions=*cold.model.hir.getAsObject()->getArray("functions");
  if(functions.size()==1){
    const auto &parameters=*functions.front().getAsObject()->getArray("parameters");
    if(parameters.size()==1)out.declared=parameters.front().getAsObject()->getString("type")->str();
  }
  return out;
}
} // namespace OrdinaryFDIMetadataHarness

namespace {
using namespace tsfg::wire;
using Json=llvm::json::Value;
using Object=llvm::json::Object;
using Array=llvm::json::Array;
// Decode pinned constants only. No identity producer is invoked by this target.
tsfg::bytecode::Hash literalHash(const char *text){
  tsfg::bytecode::Hash out{};
  const auto digit=[](char c)->uint8_t{return c<='9'?uint8_t(c-'0'):uint8_t(c-'a'+10);};
  for(size_t i=0;i<out.size();++i)out[i]=uint8_t((digit(text[7+i*2])<<4)|digit(text[8+i*2]));
  return out;
}

bool makeDefault(Program &program){
  program.input=literalHash("sha256:e91c6dad432e4d73071ad7e2d9c60c77bf55187573e54aaf22a0c9625818f123");program.sourceHash=literalHash("sha256:e312d7f8d5a823854b8b5d663d45797f9990218ce0710cc52288298b798d47f4");
  program.sourcePath="/independent-cpp-ordinary-fdi.ts";program.sourceLength=256;program.rootSource=0;
  auto values=llvm::json::parse(R"FDI_TABLES([[{"hash":"sha256:e312d7f8d5a823854b8b5d663d45797f9990218ce0710cc52288298b798d47f4","length":256,"path":"/independent-cpp-ordinary-fdi.ts"}],[{"base":null,"element":null,"id":"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","kind":"union","members":[1,2],"methods":null,"name":"union","nativeCode":0,"nominalKey":null,"runtimeKey":null},{"base":null,"element":null,"id":"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","kind":"undefined","members":[],"methods":null,"name":"undefined","nativeCode":0,"nominalKey":null,"runtimeKey":null},{"base":null,"element":null,"id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","kind":"scalar","members":[],"methods":null,"name":"i32","nativeCode":1,"nominalKey":null,"runtimeKey":null},{"base":null,"element":null,"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","kind":"void","members":[],"methods":null,"name":"void","nativeCode":0,"nominalKey":null,"runtimeKey":null}],{"constructions":[],"fields":[],"methods":[]},[{"actualTypes":[1,2],"alignment":4,"byteSize":8,"id":"sha256:60a4662ffddf9342d8f47c4b109f89773e81c681efe7ef72bb193036c87fe6cc","referenceCount":0,"representation":"finite-union","tagBytes":2}],{"arrays":[],"bindings":[{"carrier":{"kind":2,"ref":2},"declarationKind":"parameter","id":"argument:accept:0","name":"value","origin":{"end":29,"source":0,"start":24},"owner":0,"role":"param","scope":0,"type":2,"writable":false}],"concrete":[{"body":null,"carrier":{"alignment":1,"byteSize":0,"fieldOffsets":[],"referenceCount":0},"type":1},{"body":null,"carrier":{"alignment":4,"byteSize":4,"fieldOffsets":[],"referenceCount":0},"type":2},{"body":null,"carrier":{"alignment":1,"byteSize":0,"fieldOffsets":[],"referenceCount":0},"type":3}],"environments":[],"payload":{"alignment":8,"byteSize":16,"referenceCount":1}},{"compatibility":[],"dispatch":[],"entries":[]},[{"argumentTypes":[0],"construction":null,"function":0,"kind":"common","lexicalEnvironment":null,"methodMinimumArgumentCount":null,"ordinaryMinimumArgumentCount":0,"parameters":[0],"physicalParameters":[{"kind":0,"ref":0}],"receiver":null,"receiverFrame":null,"result":null,"resultCarrier":null,"signature":"sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7","sourcePlan":{"blocks":[{"operations":[],"parameters":[0]}],"carriers":["sha256:60a4662ffddf9342d8f47c4b109f89773e81c681efe7ef72bb193036c87fe6cc"]}},{"argumentTypes":[],"construction":null,"function":1,"kind":"common","lexicalEnvironment":null,"methodMinimumArgumentCount":null,"ordinaryMinimumArgumentCount":null,"parameters":[],"physicalParameters":[],"receiver":null,"receiverFrame":null,"result":null,"resultCarrier":null,"signature":"sha256:50cd1355ef01bc1eb19aa1de9ab2fee50426a6d8de0b488503257956494b4896","sourcePlan":{"blocks":[{"operations":[],"parameters":[]}],"carriers":[]}}],{"globals":[],"hosts":[],"initialization":[0],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":1,"source":0}],"roots":{"requiredRoots":[],"roots":[]}},{"entries":[],"exports":[],"fixedPublication":{"dependencies":[{"callees":[],"functionId":"sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54","hosts":[]},{"callees":[],"functionId":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","hosts":[]}],"publication":{"contracts":[{"callables":{"parameters":[],"returns":null,"slotWrites":[]},"digest":"sha256:d6a30eadc3c978febf388acb194dbc85d3e9430b0f9179c3a4ab9a31a198a834","functionId":"sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54","returnOrigins":null,"signatureHash":"sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7","upper":{"captures":[],"facets":{"allocation":false,"await":false,"ehControl":false,"escape":false,"lock":false,"managedReference":false,"mayThrow":false,"unknownHost":false},"globals":{"reads":[],"writes":[]},"hostResources":{"reads":[],"writes":[]},"parameters":[{"index":0,"read":false,"structural":false,"write":false}]}}],"expectedDigest":"sha256:40bbae1a579287be9e137fa3db01ec4a69b812bc7f30fbfaeae8bab7029ac9e3","format":{"family":"tsfg.program-publication-candidate","version":6},"mode":"fixed","scope":{"constructions":[],"declarationTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190"],"environments":[],"functions":[{"access":"public","activationEnvironment":null,"captures":[],"construction":null,"declKey":{"kind":"function","name":"accept","path":[],"sourcePath":"/independent-cpp-ordinary-fdi.ts"},"functionId":"sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54","kind":"source","lexicalEnvironment":null,"lexicalParent":null,"methodMinimumArgumentCount":null,"ordinaryParameterInitialization":{"argumentTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"],"minimumArgumentCount":0},"parameterTypes":["sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"],"returnType":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","signatureHash":"sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7"}],"globals":[],"hostContext":null,"hostImports":[],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","sourcePath":"/independent-cpp-ordinary-fdi.ts"}],"profile":"common-program-fixed-v6","rootFile":"/independent-cpp-ordinary-fdi.ts","roots":{"requiredRoots":[],"roots":[]},"storage":{"fields":[],"results":[]},"types":[{"id":"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","shape":{"kind":"union","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","members":["{\"kind\":\"scalar\",\"name\":\"i32\"}","{\"kind\":\"undefined\",\"name\":\"undefined\"}"]}},{"id":"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}","shape":{"kind":"undefined","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}"}},{"id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}","shape":{"kind":"scalar","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}"}},{"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","label":"{\"kind\":\"void\",\"name\":\"void\"}","shape":{"kind":"void","label":"{\"kind\":\"void\",\"name\":\"void\"}"}}]},"scopeDigest":"sha256:a57f3f3f7ca3dd43df83476cd8958c4374105b99a9108eb6ab896ef231e20311"},"request":{"targets":[]},"stableScope":{"constructions":[],"declarationTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190"],"environments":[],"functions":[{"access":"public","activationEnvironment":null,"captures":[],"construction":null,"declKey":{"kind":"function","name":"accept","path":[],"sourcePath":"/independent-cpp-ordinary-fdi.ts"},"functionId":"sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54","kind":"source","lexicalEnvironment":null,"lexicalParent":null,"methodMinimumArgumentCount":null,"ordinaryParameterInitialization":{"argumentTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"],"minimumArgumentCount":0},"parameterTypes":["sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"],"returnType":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","signatureHash":"sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7"}],"globals":[],"hostContext":null,"hostImports":[],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","sourcePath":"/independent-cpp-ordinary-fdi.ts"}],"profile":"common-program-fixed-v6","rootFile":"/independent-cpp-ordinary-fdi.ts","roots":{"requiredRoots":[],"roots":[]},"storage":{"fields":[],"results":[]},"types":[{"id":"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","shape":{"kind":"union","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","members":["{\"kind\":\"scalar\",\"name\":\"i32\"}","{\"kind\":\"undefined\",\"name\":\"undefined\"}"]}},{"id":"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}","shape":{"kind":"undefined","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}"}},{"id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}","shape":{"kind":"scalar","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}"}},{"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","label":"{\"kind\":\"void\",\"name\":\"void\"}","shape":{"kind":"void","label":"{\"kind\":\"void\",\"name\":\"void\"}"}}]}},"published":[],"resources":[]},{"calls":[],"environments":[],"functions":[{"activationEnvironment":null,"captures":[],"function":0,"lexicalEnvironment":null,"parent":null}]},{"bindings":[{"binding":0,"scope":0}],"functions":[{"function":0,"handlers":[]},{"function":1,"handlers":[]}],"scopes":[{"owner":0,"path":[]},{"owner":1,"path":[]}]}])FDI_TABLES");
  if(!values){std::cerr<<"literal JSON: "<<llvm::toString(values.takeError())<<"\n";return false;}
  auto *rows=values->getAsArray();
  if(!rows||rows->size()!=static_cast<size_t>(Table::Count))return false;
  for(size_t i=0;i<rows->size();++i)program.tables[i]=std::move((*rows)[i]);
  {Function function;function.id=literalHash("sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54");function.signature=literalHash("sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7");
    function.abi=0;function.source=0;function.role=0;function.declaration={16,112};function.name="accept";
    function.registers={{0,0,0}};
    Block entry;entry.parameters={0};function.blocks.push_back(std::move(entry));program.functions.push_back(std::move(function));}
  {Function function;function.id=literalHash("sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138");function.signature=literalHash("sha256:50cd1355ef01bc1eb19aa1de9ab2fee50426a6d8de0b488503257956494b4896");
    function.abi=1;function.source=0;function.role=2;function.declaration={0,256};function.name="$moduleInit";
    function.registers={};
    Block entry;entry.parameters={};function.blocks.push_back(std::move(entry));program.functions.push_back(std::move(function));}
  return true;
}

bool makeOptional(Program &program){
  program.input=literalHash("sha256:e91c6dad432e4d73071ad7e2d9c60c77bf55187573e54aaf22a0c9625818f123");program.sourceHash=literalHash("sha256:e312d7f8d5a823854b8b5d663d45797f9990218ce0710cc52288298b798d47f4");
  program.sourcePath="/independent-cpp-ordinary-fdi.ts";program.sourceLength=256;program.rootSource=0;
  auto values=llvm::json::parse(R"FDI_TABLES([[{"hash":"sha256:e312d7f8d5a823854b8b5d663d45797f9990218ce0710cc52288298b798d47f4","length":256,"path":"/independent-cpp-ordinary-fdi.ts"}],[{"base":null,"element":null,"id":"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","kind":"union","members":[1,2],"methods":null,"name":"union","nativeCode":0,"nominalKey":null,"runtimeKey":null},{"base":null,"element":null,"id":"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","kind":"undefined","members":[],"methods":null,"name":"undefined","nativeCode":0,"nominalKey":null,"runtimeKey":null},{"base":null,"element":null,"id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","kind":"scalar","members":[],"methods":null,"name":"i32","nativeCode":1,"nominalKey":null,"runtimeKey":null},{"base":null,"element":null,"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","kind":"void","members":[],"methods":null,"name":"void","nativeCode":0,"nominalKey":null,"runtimeKey":null}],{"constructions":[],"fields":[],"methods":[]},[{"actualTypes":[1,2],"alignment":4,"byteSize":8,"id":"sha256:60a4662ffddf9342d8f47c4b109f89773e81c681efe7ef72bb193036c87fe6cc","referenceCount":0,"representation":"finite-union","tagBytes":2}],{"arrays":[],"bindings":[{"carrier":{"kind":0,"ref":0},"declarationKind":"parameter","id":"argument:accept:0","name":"value","origin":{"end":29,"source":0,"start":24},"owner":0,"role":"param","scope":0,"type":0,"writable":false}],"concrete":[{"body":null,"carrier":{"alignment":1,"byteSize":0,"fieldOffsets":[],"referenceCount":0},"type":1},{"body":null,"carrier":{"alignment":4,"byteSize":4,"fieldOffsets":[],"referenceCount":0},"type":2},{"body":null,"carrier":{"alignment":1,"byteSize":0,"fieldOffsets":[],"referenceCount":0},"type":3}],"environments":[],"payload":{"alignment":8,"byteSize":16,"referenceCount":1}},{"compatibility":[],"dispatch":[],"entries":[]},[{"argumentTypes":[0],"construction":null,"function":0,"kind":"common","lexicalEnvironment":null,"methodMinimumArgumentCount":null,"ordinaryMinimumArgumentCount":0,"parameters":[0],"physicalParameters":[{"kind":0,"ref":0}],"receiver":null,"receiverFrame":null,"result":null,"resultCarrier":null,"signature":"sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7","sourcePlan":{"blocks":[{"operations":[],"parameters":[0]}],"carriers":["sha256:60a4662ffddf9342d8f47c4b109f89773e81c681efe7ef72bb193036c87fe6cc"]}},{"argumentTypes":[],"construction":null,"function":1,"kind":"common","lexicalEnvironment":null,"methodMinimumArgumentCount":null,"ordinaryMinimumArgumentCount":null,"parameters":[],"physicalParameters":[],"receiver":null,"receiverFrame":null,"result":null,"resultCarrier":null,"signature":"sha256:50cd1355ef01bc1eb19aa1de9ab2fee50426a6d8de0b488503257956494b4896","sourcePlan":{"blocks":[{"operations":[],"parameters":[]}],"carriers":[]}}],{"globals":[],"hosts":[],"initialization":[0],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":1,"source":0}],"roots":{"requiredRoots":[],"roots":[]}},{"entries":[],"exports":[],"fixedPublication":{"dependencies":[{"callees":[],"functionId":"sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54","hosts":[]},{"callees":[],"functionId":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","hosts":[]}],"publication":{"contracts":[{"callables":{"parameters":[],"returns":null,"slotWrites":[]},"digest":"sha256:d6a30eadc3c978febf388acb194dbc85d3e9430b0f9179c3a4ab9a31a198a834","functionId":"sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54","returnOrigins":null,"signatureHash":"sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7","upper":{"captures":[],"facets":{"allocation":false,"await":false,"ehControl":false,"escape":false,"lock":false,"managedReference":false,"mayThrow":false,"unknownHost":false},"globals":{"reads":[],"writes":[]},"hostResources":{"reads":[],"writes":[]},"parameters":[{"index":0,"read":false,"structural":false,"write":false}]}}],"expectedDigest":"sha256:bb1b8da10f9b75f99c47ae8be843a9cbeddfe7820bc9f94cba08e9387466998e","format":{"family":"tsfg.program-publication-candidate","version":6},"mode":"fixed","scope":{"constructions":[],"declarationTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190"],"environments":[],"functions":[{"access":"public","activationEnvironment":null,"captures":[],"construction":null,"declKey":{"kind":"function","name":"accept","path":[],"sourcePath":"/independent-cpp-ordinary-fdi.ts"},"functionId":"sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54","kind":"source","lexicalEnvironment":null,"lexicalParent":null,"methodMinimumArgumentCount":null,"ordinaryParameterInitialization":{"argumentTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"],"minimumArgumentCount":0},"parameterTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"],"returnType":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","signatureHash":"sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7"}],"globals":[],"hostContext":null,"hostImports":[],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","sourcePath":"/independent-cpp-ordinary-fdi.ts"}],"profile":"common-program-fixed-v6","rootFile":"/independent-cpp-ordinary-fdi.ts","roots":{"requiredRoots":[],"roots":[]},"storage":{"fields":[],"results":[]},"types":[{"id":"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","shape":{"kind":"union","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","members":["{\"kind\":\"scalar\",\"name\":\"i32\"}","{\"kind\":\"undefined\",\"name\":\"undefined\"}"]}},{"id":"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}","shape":{"kind":"undefined","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}"}},{"id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}","shape":{"kind":"scalar","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}"}},{"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","label":"{\"kind\":\"void\",\"name\":\"void\"}","shape":{"kind":"void","label":"{\"kind\":\"void\",\"name\":\"void\"}"}}]},"scopeDigest":"sha256:a8f9fa05fd95bc616641ce0a107d9e83cf369befee6f17bd765373f1aa53a797"},"request":{"targets":[]},"stableScope":{"constructions":[],"declarationTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190"],"environments":[],"functions":[{"access":"public","activationEnvironment":null,"captures":[],"construction":null,"declKey":{"kind":"function","name":"accept","path":[],"sourcePath":"/independent-cpp-ordinary-fdi.ts"},"functionId":"sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54","kind":"source","lexicalEnvironment":null,"lexicalParent":null,"methodMinimumArgumentCount":null,"ordinaryParameterInitialization":{"argumentTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"],"minimumArgumentCount":0},"parameterTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"],"returnType":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","signatureHash":"sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7"}],"globals":[],"hostContext":null,"hostImports":[],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","sourcePath":"/independent-cpp-ordinary-fdi.ts"}],"profile":"common-program-fixed-v6","rootFile":"/independent-cpp-ordinary-fdi.ts","roots":{"requiredRoots":[],"roots":[]},"storage":{"fields":[],"results":[]},"types":[{"id":"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","shape":{"kind":"union","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","members":["{\"kind\":\"scalar\",\"name\":\"i32\"}","{\"kind\":\"undefined\",\"name\":\"undefined\"}"]}},{"id":"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}","shape":{"kind":"undefined","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}"}},{"id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}","shape":{"kind":"scalar","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}"}},{"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","label":"{\"kind\":\"void\",\"name\":\"void\"}","shape":{"kind":"void","label":"{\"kind\":\"void\",\"name\":\"void\"}"}}]}},"published":[],"resources":[]},{"calls":[],"environments":[],"functions":[{"activationEnvironment":null,"captures":[],"function":0,"lexicalEnvironment":null,"parent":null}]},{"bindings":[{"binding":0,"scope":0}],"functions":[{"function":0,"handlers":[]},{"function":1,"handlers":[]}],"scopes":[{"owner":0,"path":[]},{"owner":1,"path":[]}]}])FDI_TABLES");
  if(!values){std::cerr<<"literal JSON: "<<llvm::toString(values.takeError())<<"\n";return false;}
  auto *rows=values->getAsArray();
  if(!rows||rows->size()!=static_cast<size_t>(Table::Count))return false;
  for(size_t i=0;i<rows->size();++i)program.tables[i]=std::move((*rows)[i]);
  {Function function;function.id=literalHash("sha256:02812caaab3457cb7e38c4a10e919edfaa0b9c7647b5d0961a2aa4e2e7414c54");function.signature=literalHash("sha256:34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7");
    function.abi=0;function.source=0;function.role=0;function.declaration={16,112};function.name="accept";
    function.registers={{0,0,0}};
    Block entry;entry.parameters={0};function.blocks.push_back(std::move(entry));program.functions.push_back(std::move(function));}
  {Function function;function.id=literalHash("sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138");function.signature=literalHash("sha256:50cd1355ef01bc1eb19aa1de9ab2fee50426a6d8de0b488503257956494b4896");
    function.abi=1;function.source=0;function.role=2;function.declaration={0,256};function.name="$moduleInit";
    function.registers={};
    Block entry;entry.parameters={};function.blocks.push_back(std::move(entry));program.functions.push_back(std::move(function));}
  return true;
}

bool makeRequired(Program &program){
  program.input=literalHash("sha256:e91c6dad432e4d73071ad7e2d9c60c77bf55187573e54aaf22a0c9625818f123");program.sourceHash=literalHash("sha256:e312d7f8d5a823854b8b5d663d45797f9990218ce0710cc52288298b798d47f4");
  program.sourcePath="/independent-cpp-ordinary-fdi.ts";program.sourceLength=256;program.rootSource=0;
  auto values=llvm::json::parse(R"FDI_TABLES([[{"hash":"sha256:e312d7f8d5a823854b8b5d663d45797f9990218ce0710cc52288298b798d47f4","length":256,"path":"/independent-cpp-ordinary-fdi.ts"}],[{"base":null,"element":null,"id":"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","kind":"union","members":[1,2],"methods":null,"name":"union","nativeCode":0,"nominalKey":null,"runtimeKey":null},{"base":null,"element":null,"id":"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","kind":"undefined","members":[],"methods":null,"name":"undefined","nativeCode":0,"nominalKey":null,"runtimeKey":null},{"base":null,"element":null,"id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","kind":"scalar","members":[],"methods":null,"name":"i32","nativeCode":1,"nominalKey":null,"runtimeKey":null},{"base":null,"element":null,"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","kind":"void","members":[],"methods":null,"name":"void","nativeCode":0,"nominalKey":null,"runtimeKey":null}],{"constructions":[],"fields":[],"methods":[]},[{"actualTypes":[1,2],"alignment":4,"byteSize":8,"id":"sha256:60a4662ffddf9342d8f47c4b109f89773e81c681efe7ef72bb193036c87fe6cc","referenceCount":0,"representation":"finite-union","tagBytes":2}],{"arrays":[],"bindings":[{"carrier":{"kind":0,"ref":0},"declarationKind":"parameter","id":"argument:accept:0","name":"value","origin":{"end":29,"source":0,"start":24},"owner":0,"role":"param","scope":0,"type":0,"writable":false}],"concrete":[{"body":null,"carrier":{"alignment":1,"byteSize":0,"fieldOffsets":[],"referenceCount":0},"type":1},{"body":null,"carrier":{"alignment":4,"byteSize":4,"fieldOffsets":[],"referenceCount":0},"type":2},{"body":null,"carrier":{"alignment":1,"byteSize":0,"fieldOffsets":[],"referenceCount":0},"type":3}],"environments":[],"payload":{"alignment":8,"byteSize":16,"referenceCount":1}},{"compatibility":[],"dispatch":[],"entries":[]},[{"argumentTypes":[0],"construction":null,"function":0,"kind":"common","lexicalEnvironment":null,"methodMinimumArgumentCount":null,"ordinaryMinimumArgumentCount":null,"parameters":[0],"physicalParameters":[{"kind":0,"ref":0}],"receiver":null,"receiverFrame":null,"result":null,"resultCarrier":null,"signature":"sha256:0f7219ad8bd33738a531658cae2241923cb46773b62921edd823731327926cad","sourcePlan":{"blocks":[{"operations":[],"parameters":[0]}],"carriers":["sha256:60a4662ffddf9342d8f47c4b109f89773e81c681efe7ef72bb193036c87fe6cc"]}},{"argumentTypes":[],"construction":null,"function":1,"kind":"common","lexicalEnvironment":null,"methodMinimumArgumentCount":null,"ordinaryMinimumArgumentCount":null,"parameters":[],"physicalParameters":[],"receiver":null,"receiverFrame":null,"result":null,"resultCarrier":null,"signature":"sha256:50cd1355ef01bc1eb19aa1de9ab2fee50426a6d8de0b488503257956494b4896","sourcePlan":{"blocks":[{"operations":[],"parameters":[]}],"carriers":[]}}],{"globals":[],"hosts":[],"initialization":[0],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":1,"source":0}],"roots":{"requiredRoots":[],"roots":[]}},{"entries":[],"exports":[],"fixedPublication":{"dependencies":[{"callees":[],"functionId":"sha256:975f2500d80ac120fa347ffed783e32e23e34f0eb388bdcf828573b55dca67dd","hosts":[]},{"callees":[],"functionId":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","hosts":[]}],"publication":{"contracts":[{"callables":{"parameters":[],"returns":null,"slotWrites":[]},"digest":"sha256:f0d0c95c3f771223465099cc58232a349f9fcbdcec7f59c1bce198063cdd16d5","functionId":"sha256:975f2500d80ac120fa347ffed783e32e23e34f0eb388bdcf828573b55dca67dd","returnOrigins":null,"signatureHash":"sha256:0f7219ad8bd33738a531658cae2241923cb46773b62921edd823731327926cad","upper":{"captures":[],"facets":{"allocation":false,"await":false,"ehControl":false,"escape":false,"lock":false,"managedReference":false,"mayThrow":false,"unknownHost":false},"globals":{"reads":[],"writes":[]},"hostResources":{"reads":[],"writes":[]},"parameters":[{"index":0,"read":false,"structural":false,"write":false}]}}],"expectedDigest":"sha256:ea60b5f5a1a0ee267805676eae9a378408b33b98aafd9fae7db9151a8458ed7a","format":{"family":"tsfg.program-publication-candidate","version":6},"mode":"fixed","scope":{"constructions":[],"declarationTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190"],"environments":[],"functions":[{"access":"public","activationEnvironment":null,"captures":[],"construction":null,"declKey":{"kind":"function","name":"accept","path":[],"sourcePath":"/independent-cpp-ordinary-fdi.ts"},"functionId":"sha256:975f2500d80ac120fa347ffed783e32e23e34f0eb388bdcf828573b55dca67dd","kind":"source","lexicalEnvironment":null,"lexicalParent":null,"methodMinimumArgumentCount":null,"ordinaryParameterInitialization":null,"parameterTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"],"returnType":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","signatureHash":"sha256:0f7219ad8bd33738a531658cae2241923cb46773b62921edd823731327926cad"}],"globals":[],"hostContext":null,"hostImports":[],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","sourcePath":"/independent-cpp-ordinary-fdi.ts"}],"profile":"common-program-fixed-v6","rootFile":"/independent-cpp-ordinary-fdi.ts","roots":{"requiredRoots":[],"roots":[]},"storage":{"fields":[],"results":[]},"types":[{"id":"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","shape":{"kind":"union","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","members":["{\"kind\":\"scalar\",\"name\":\"i32\"}","{\"kind\":\"undefined\",\"name\":\"undefined\"}"]}},{"id":"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}","shape":{"kind":"undefined","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}"}},{"id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}","shape":{"kind":"scalar","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}"}},{"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","label":"{\"kind\":\"void\",\"name\":\"void\"}","shape":{"kind":"void","label":"{\"kind\":\"void\",\"name\":\"void\"}"}}]},"scopeDigest":"sha256:a51ff013c040d1222fdbf6aa2b17ba5b143046ddeb7fa179abdf03964d0544c2"},"request":{"targets":[]},"stableScope":{"constructions":[],"declarationTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190"],"environments":[],"functions":[{"access":"public","activationEnvironment":null,"captures":[],"construction":null,"declKey":{"kind":"function","name":"accept","path":[],"sourcePath":"/independent-cpp-ordinary-fdi.ts"},"functionId":"sha256:975f2500d80ac120fa347ffed783e32e23e34f0eb388bdcf828573b55dca67dd","kind":"source","lexicalEnvironment":null,"lexicalParent":null,"methodMinimumArgumentCount":null,"ordinaryParameterInitialization":null,"parameterTypes":["sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"],"returnType":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","signatureHash":"sha256:0f7219ad8bd33738a531658cae2241923cb46773b62921edd823731327926cad"}],"globals":[],"hostContext":null,"hostImports":[],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","sourcePath":"/independent-cpp-ordinary-fdi.ts"}],"profile":"common-program-fixed-v6","rootFile":"/independent-cpp-ordinary-fdi.ts","roots":{"requiredRoots":[],"roots":[]},"storage":{"fields":[],"results":[]},"types":[{"id":"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","shape":{"kind":"union","label":"{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}","members":["{\"kind\":\"scalar\",\"name\":\"i32\"}","{\"kind\":\"undefined\",\"name\":\"undefined\"}"]}},{"id":"sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}","shape":{"kind":"undefined","label":"{\"kind\":\"undefined\",\"name\":\"undefined\"}"}},{"id":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}","shape":{"kind":"scalar","label":"{\"kind\":\"scalar\",\"name\":\"i32\"}"}},{"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","label":"{\"kind\":\"void\",\"name\":\"void\"}","shape":{"kind":"void","label":"{\"kind\":\"void\",\"name\":\"void\"}"}}]}},"published":[],"resources":[]},{"calls":[],"environments":[],"functions":[{"activationEnvironment":null,"captures":[],"function":0,"lexicalEnvironment":null,"parent":null}]},{"bindings":[{"binding":0,"scope":0}],"functions":[{"function":0,"handlers":[]},{"function":1,"handlers":[]}],"scopes":[{"owner":0,"path":[]},{"owner":1,"path":[]}]}])FDI_TABLES");
  if(!values){std::cerr<<"literal JSON: "<<llvm::toString(values.takeError())<<"\n";return false;}
  auto *rows=values->getAsArray();
  if(!rows||rows->size()!=static_cast<size_t>(Table::Count))return false;
  for(size_t i=0;i<rows->size();++i)program.tables[i]=std::move((*rows)[i]);
  {Function function;function.id=literalHash("sha256:975f2500d80ac120fa347ffed783e32e23e34f0eb388bdcf828573b55dca67dd");function.signature=literalHash("sha256:0f7219ad8bd33738a531658cae2241923cb46773b62921edd823731327926cad");
    function.abi=0;function.source=0;function.role=0;function.declaration={16,112};function.name="accept";
    function.registers={{0,0,0}};
    Block entry;entry.parameters={0};function.blocks.push_back(std::move(entry));program.functions.push_back(std::move(function));}
  {Function function;function.id=literalHash("sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138");function.signature=literalHash("sha256:50cd1355ef01bc1eb19aa1de9ab2fee50426a6d8de0b488503257956494b4896");
    function.abi=1;function.source=0;function.role=2;function.declaration={0,256};function.name="$moduleInit";
    function.registers={};
    Block entry;entry.parameters={};function.blocks.push_back(std::move(entry));program.functions.push_back(std::move(function));}
  return true;
}

bool makeZero(Program &program){
  program.input=literalHash("sha256:e91c6dad432e4d73071ad7e2d9c60c77bf55187573e54aaf22a0c9625818f123");program.sourceHash=literalHash("sha256:e312d7f8d5a823854b8b5d663d45797f9990218ce0710cc52288298b798d47f4");
  program.sourcePath="/independent-cpp-ordinary-fdi.ts";program.sourceLength=256;program.rootSource=0;
  auto values=llvm::json::parse(R"FDI_TABLES([[{"hash":"sha256:e312d7f8d5a823854b8b5d663d45797f9990218ce0710cc52288298b798d47f4","length":256,"path":"/independent-cpp-ordinary-fdi.ts"}],[{"base":null,"element":null,"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","kind":"void","members":[],"methods":null,"name":"void","nativeCode":0,"nominalKey":null,"runtimeKey":null}],{"constructions":[],"fields":[],"methods":[]},[],{"arrays":[],"bindings":[],"concrete":[{"body":null,"carrier":{"alignment":1,"byteSize":0,"fieldOffsets":[],"referenceCount":0},"type":0}],"environments":[],"payload":{"alignment":8,"byteSize":16,"referenceCount":1}},{"compatibility":[],"dispatch":[],"entries":[]},[{"argumentTypes":[],"construction":null,"function":0,"kind":"common","lexicalEnvironment":null,"methodMinimumArgumentCount":null,"ordinaryMinimumArgumentCount":null,"parameters":[],"physicalParameters":[],"receiver":null,"receiverFrame":null,"result":null,"resultCarrier":null,"signature":"sha256:50cd1355ef01bc1eb19aa1de9ab2fee50426a6d8de0b488503257956494b4896","sourcePlan":{"blocks":[{"operations":[],"parameters":[]}],"carriers":[]}},{"argumentTypes":[],"construction":null,"function":1,"kind":"common","lexicalEnvironment":null,"methodMinimumArgumentCount":null,"ordinaryMinimumArgumentCount":null,"parameters":[],"physicalParameters":[],"receiver":null,"receiverFrame":null,"result":null,"resultCarrier":null,"signature":"sha256:812d7f89a0bb3b2ff92e22ca01d3632517bc3a25758c10b5b6dc160894f298f8","sourcePlan":{"blocks":[{"operations":[],"parameters":[]}],"carriers":[]}}],{"globals":[],"hosts":[],"initialization":[0],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":0,"source":0}],"roots":{"requiredRoots":[],"roots":[]}},{"entries":[],"exports":[],"fixedPublication":{"dependencies":[{"callees":[],"functionId":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","hosts":[]},{"callees":[],"functionId":"sha256:e14dc1b931a871e6ff86eed7185ded8aea1b897a22795277cf6bd5b3a7f02fd3","hosts":[]}],"publication":{"contracts":[{"callables":{"parameters":[],"returns":null,"slotWrites":[]},"digest":"sha256:155967941bd00bea9bcafdecc9bc1a467f4a84c31fe37a65e72d226c4031b711","functionId":"sha256:e14dc1b931a871e6ff86eed7185ded8aea1b897a22795277cf6bd5b3a7f02fd3","returnOrigins":null,"signatureHash":"sha256:812d7f89a0bb3b2ff92e22ca01d3632517bc3a25758c10b5b6dc160894f298f8","upper":{"captures":[],"facets":{"allocation":false,"await":false,"ehControl":false,"escape":false,"lock":false,"managedReference":false,"mayThrow":false,"unknownHost":false},"globals":{"reads":[],"writes":[]},"hostResources":{"reads":[],"writes":[]},"parameters":[]}}],"expectedDigest":"sha256:fb3aaab9f1155dab0c18d710e58267c15385593c0b161be4448dd176fabfac22","format":{"family":"tsfg.program-publication-candidate","version":6},"mode":"fixed","scope":{"constructions":[],"declarationTypes":["sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190"],"environments":[],"functions":[{"access":"public","activationEnvironment":null,"captures":[],"construction":null,"declKey":{"kind":"function","name":"zero","path":[],"sourcePath":"/independent-cpp-ordinary-fdi.ts"},"functionId":"sha256:e14dc1b931a871e6ff86eed7185ded8aea1b897a22795277cf6bd5b3a7f02fd3","kind":"source","lexicalEnvironment":null,"lexicalParent":null,"methodMinimumArgumentCount":null,"ordinaryParameterInitialization":null,"parameterTypes":[],"returnType":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","signatureHash":"sha256:812d7f89a0bb3b2ff92e22ca01d3632517bc3a25758c10b5b6dc160894f298f8"}],"globals":[],"hostContext":null,"hostImports":[],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","sourcePath":"/independent-cpp-ordinary-fdi.ts"}],"profile":"common-program-fixed-v6","rootFile":"/independent-cpp-ordinary-fdi.ts","roots":{"requiredRoots":[],"roots":[]},"storage":{"fields":[],"results":[]},"types":[{"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","label":"{\"kind\":\"void\",\"name\":\"void\"}","shape":{"kind":"void","label":"{\"kind\":\"void\",\"name\":\"void\"}"}}]},"scopeDigest":"sha256:efd7a86c0f4e0eb4c5a8fcec702bb681c892b4a3596388f6ccfea85c005989fd"},"request":{"targets":[]},"stableScope":{"constructions":[],"declarationTypes":["sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190"],"environments":[],"functions":[{"access":"public","activationEnvironment":null,"captures":[],"construction":null,"declKey":{"kind":"function","name":"zero","path":[],"sourcePath":"/independent-cpp-ordinary-fdi.ts"},"functionId":"sha256:e14dc1b931a871e6ff86eed7185ded8aea1b897a22795277cf6bd5b3a7f02fd3","kind":"source","lexicalEnvironment":null,"lexicalParent":null,"methodMinimumArgumentCount":null,"ordinaryParameterInitialization":null,"parameterTypes":[],"returnType":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","signatureHash":"sha256:812d7f89a0bb3b2ff92e22ca01d3632517bc3a25758c10b5b6dc160894f298f8"}],"globals":[],"hostContext":null,"hostImports":[],"modules":[{"dependencies":[],"exports":[],"external":true,"globals":[],"id":"sha256:aa3909ecde2156b5a18986b3ed5f283016294e5acfdcc80103430be2d7c0585b","imports":[],"initializer":"sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138","sourcePath":"/independent-cpp-ordinary-fdi.ts"}],"profile":"common-program-fixed-v6","rootFile":"/independent-cpp-ordinary-fdi.ts","roots":{"requiredRoots":[],"roots":[]},"storage":{"fields":[],"results":[]},"types":[{"id":"sha256:acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190","label":"{\"kind\":\"void\",\"name\":\"void\"}","shape":{"kind":"void","label":"{\"kind\":\"void\",\"name\":\"void\"}"}}]}},"published":[],"resources":[]},{"calls":[],"environments":[],"functions":[{"activationEnvironment":null,"captures":[],"function":1,"lexicalEnvironment":null,"parent":null}]},{"bindings":[],"functions":[{"function":0,"handlers":[]},{"function":1,"handlers":[]}],"scopes":[{"owner":0,"path":[]},{"owner":1,"path":[]}]}])FDI_TABLES");
  if(!values){std::cerr<<"literal JSON: "<<llvm::toString(values.takeError())<<"\n";return false;}
  auto *rows=values->getAsArray();
  if(!rows||rows->size()!=static_cast<size_t>(Table::Count))return false;
  for(size_t i=0;i<rows->size();++i)program.tables[i]=std::move((*rows)[i]);
  {Function function;function.id=literalHash("sha256:d51c0291d902af944efce2e582651db964392f86a0201e3e1715bb3ffa47f138");function.signature=literalHash("sha256:50cd1355ef01bc1eb19aa1de9ab2fee50426a6d8de0b488503257956494b4896");
    function.abi=0;function.source=0;function.role=2;function.declaration={0,256};function.name="$moduleInit";
    function.registers={};
    Block entry;entry.parameters={};function.blocks.push_back(std::move(entry));program.functions.push_back(std::move(function));}
  {Function function;function.id=literalHash("sha256:e14dc1b931a871e6ff86eed7185ded8aea1b897a22795277cf6bd5b3a7f02fd3");function.signature=literalHash("sha256:812d7f89a0bb3b2ff92e22ca01d3632517bc3a25758c10b5b6dc160894f298f8");
    function.abi=1;function.source=0;function.role=0;function.declaration={128,176};function.name="zero";
    function.registers={};
    Block entry;entry.parameters={};function.blocks.push_back(std::move(entry));program.functions.push_back(std::move(function));}
  return true;
}

size_t ordinary(const Program &p){
  for(size_t n=0;n<p.functions.size();++n)if(p.functions[n].role==0)return n;
  return p.functions.size();
}
Object &fixed(Program &p){return *p.table(Table::Authority).getAsObject()->getObject("fixedPublication");}
Object &fixedFunction(Program &p,bool embedded){
  auto &record=fixed(p);
  auto *scope=embedded?record.getObject("publication")->getObject("scope"):record.getObject("stableScope");
  return *scope->getArray("functions")->front().getAsObject();
}
Object &abi(Program &p){return *(*p.table(Table::Abis).getAsArray())[ordinary(p)].getAsObject();}

void missingAbiField(Program &p){abi(p).erase("ordinaryMinimumArgumentCount");}
void abiMinimumMismatch(Program &p){abi(p)["ordinaryMinimumArgumentCount"]=1;}
void rawArgumentMismatch(Program &p){
  // A valid current TypeRef, but it disagrees with the actual raw entry view.
  abi(p)["argumentTypes"]=Array{2};
}
void abiMethodRole(Program &p){abi(p)["methodMinimumArgumentCount"]=0;}
void abiConstructionRole(Program &p){p.functions[ordinary(p)].role=1;}
void abiInitializerRole(Program &p){
  for(size_t n=0;n<p.functions.size();++n)if(p.functions[n].role==2)
    (*(*p.table(Table::Abis).getAsArray())[n].getAsObject())["ordinaryMinimumArgumentCount"]=0;
}
void missingFixedField(Program &p){for(bool embedded:{false,true})fixedFunction(p,embedded).erase("ordinaryParameterInitialization");}
void fixedMinimumMismatch(Program &p){
  for(bool embedded:{false,true})(*fixedFunction(p,embedded).getObject("ordinaryParameterInitialization"))["minimumArgumentCount"]=1;
}
void fixedRawVectorMismatch(Program &p){
  for(bool embedded:{false,true})(*fixedFunction(p,embedded).getObject("ordinaryParameterInitialization"))["argumentTypes"]=Array{"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"};
}
void fixedPresenceMissing(Program &p){for(bool embedded:{false,true})fixedFunction(p,embedded)["ordinaryParameterInitialization"]=nullptr;}
void noFDIFixedNonNull(Program &p){
  for(bool embedded:{false,true})fixedFunction(p,embedded)["ordinaryParameterInitialization"]=Object{
    {"minimumArgumentCount",0},{"argumentTypes",Array{"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"}}};
}
void noFDIAbiNonNull(Program &p){abi(p)["ordinaryMinimumArgumentCount"]=0;}
void fixedLexicalRole(Program &p){
  for(bool embedded:{false,true}){
    auto &fn=fixedFunction(p,embedded);fn["lexicalParent"]=*fn.get("functionId");
  }
}
void fixedMethodRole(Program &p){
  // Both changes describe one coherent claimed method role, so the older
  // method-null rule does not mask the new ordinary-FDI role restriction.
  for(bool embedded:{false,true}){auto &fn=fixedFunction(p,embedded);fn["kind"]="method";fn["methodMinimumArgumentCount"]=0;}
}
void fixedDeclaredTypeMismatch(Program &p){
  for(bool embedded:{false,true})fixedFunction(p,embedded)["parameterTypes"]=Array{"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"};
}
void fixedDeclarationName(Program &p){for(bool embedded:{false,true})(*fixedFunction(p,embedded).getObject("declKey"))["name"]="other";}
void fixedDeclarationIdentity(Program &p){
  // Still a valid source function key; its changed path reconstructs another
  // FunctionId. Earlier function/name/signature joins remain intact.
  for(bool embedded:{false,true})(*fixedFunction(p,embedded).getObject("declKey"))["path"]=Array{"differentScope"};
}
void scopeArchiveMismatch(Program &p){(*fixed(p).getObject("stableScope"))["rootFile"]="/other.ts";}
void oldPublicationFormat(Program &p){(*fixed(p).getObject("publication")->getObject("format"))["version"]=5;}

// Delta: zero-parameter ordinary functions have no FDI record. These mutations
// preserve the real void/no-parameter function, initializer and all other joins.
void zeroAbiFDI(Program &p){abi(p)["ordinaryMinimumArgumentCount"]=0;}
void zeroFixedFDI(Program &p){
  for(bool embedded:{false,true})fixedFunction(p,embedded)["ordinaryParameterInitialization"]=Object{
    {"minimumArgumentCount",0},{"argumentTypes",Array{}}};
}

bool annotationCase(const char *label,const char *text,bool optional,bool accepted){
  namespace cp=tsfg::commonProgram;
  cp::Program program;
  program.hir=Object{{"snapshot",Object{{"payload",Object{}}}}};
  cp::Error error;cp::SourceModel model{program,error};
  // Protocol TypeIds consumed by the grammar seam, not semantic SHA identities.
  // This minimal caller-owned catalogue deliberately has no union<i32,null>.
  const Array catalogue{
    Object{{"id","i32"},{"kind","scalar"},{"name","i32"}},
    Object{{"id","null"},{"kind","null"},{"name","null"}},
    Object{{"id","undefined"},{"kind","undefined"},{"name","undefined"}},
    Object{{"id","union<i32,null,undefined>"},{"kind","union"},{"name","union"},
      {"members",Array{"i32","null","undefined"}}},
  };
  for(const auto &row:catalogue)model.types.emplace(row.getAsObject()->getString("id")->str(),&row);
  std::map<std::string,cp::SourceSyntax> syntax;
  cp::SourceSyntax source{model,"/new-ordinary-fdi-annotation-seam.ts"};
  if(!source.read(text)){
    std::cerr<<label<<": FAIL stage=annotation-tokenization detail="<<error.message<<"\n";return false;
  }
  cp::SourceBodies bodies{model,syntax};bodies.source=&source;
  const bool result=bodies.annotation(Object{{"start",0},{"end",int64_t(llvm::StringRef(text).size())}},"union<i32,null,undefined>",optional);
  const bool passed=accepted?result&&error.message.empty():!result&&error.code=="core-ir-common-source"&&
    error.message=="original annotation does not name declared semantic type";
  std::cout<<label<<": "<<(passed?"PASS":"FAIL")<<" stage=annotation-owner detail="<<error.message<<"\n";
  return passed;
}

struct Example {
  const char *name;
  bool (*make)(Program &);
  void (*mutate)(Program &);
  const char *expectedStage,*expectedError;
};
} // namespace

int main(){
  using OrdinaryFDIMetadataHarness::check;
  const struct {const char *name;bool (*make)(Program &);bool fdi;const char *declared;} positives[]={
    {"default-raw-union-declared-i32",makeDefault,true,"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"},
    {"optional-same-union",makeOptional,true,"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"},
    {"required-same-union-no-fdi",makeRequired,false,"sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"},
  };
  bool passed=true;
  for(const auto &example:positives){
    Program program;if(!example.make(program))return 2;
    const auto result=check(program);
    const bool model=result.passed&&result.declared==example.declared&&result.ordinaryInputs==(example.fdi?1u:0u)&&
      (!example.fdi||(result.minimum==0&&result.incoming=="sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea"));
    std::cout<<example.name<<": "<<(model?"PASS":"FAIL")<<" stage="<<result.stage<<" detail="<<result.detail<<" remaining="<<result.remaining<<"\n";
    passed=model&&passed;
  }
  const Example negatives[]={
    {"abi-required-field-missing",makeDefault,missingAbiField,"directory","Common ABI shape/reference"},
    {"abi-fixed-minimum-mismatch",makeDefault,abiMinimumMismatch,"interfaces","Common fixed/ABI ordinary FDI minimum or role differs"},
    {"raw-entry-vector-mismatch",makeDefault,rawArgumentMismatch,"storage-joins","Common incoming ABI entry view/carrier join"},
    {"abi-ordinary-method-role",makeDefault,abiMethodRole,"directory","Common ABI method minimum arity or role"},
    {"abi-ordinary-construction-role",makeDefault,abiConstructionRole,"directory","Common ABI ordinary FDI minimum arity or role"},
    {"abi-ordinary-initializer-role",makeDefault,abiInitializerRole,"directory","Common ABI ordinary FDI minimum arity or role"},
    {"fixed-required-field-missing",makeDefault,missingFixedField,"publication-boundary","Common fixed logical function interface"},
    {"fixed-abi-minimum-mismatch",makeDefault,fixedMinimumMismatch,"interfaces","Common fixed/ABI ordinary FDI minimum or role differs"},
    {"fixed-raw-vector-mismatch",makeDefault,fixedRawVectorMismatch,"interfaces","Common fixed/ABI ordinary FDI incoming vector differs"},
    {"fixed-fdi-presence-missing",makeDefault,fixedPresenceMissing,"interfaces","Common fixed/ABI ordinary FDI presence differs"},
    {"required-no-fdi-fixed-nonnull",makeRequired,noFDIFixedNonNull,"interfaces","Common fixed/ABI ordinary FDI presence differs"},
    {"required-no-fdi-abi-nonnull",makeRequired,noFDIAbiNonNull,"interfaces","Common fixed/ABI ordinary FDI presence differs"},
    {"fixed-ordinary-lexical-role",makeDefault,fixedLexicalRole,"publication-boundary","Common fixed ordinary FDI incoming/minimum shape or role"},
    {"fixed-ordinary-method-role",makeDefault,fixedMethodRole,"publication-boundary","Common fixed ordinary FDI incoming/minimum shape or role"},
    {"fixed-declared-binding-vector",makeDefault,fixedDeclaredTypeMismatch,"interfaces","Common fixed logical ABI vector/result join"},
    {"fixed-declaration-name",makeDefault,fixedDeclarationName,"interfaces","Common fixed function/definition join"},
    {"fixed-declaration-identity",makeDefault,fixedDeclarationIdentity,"interfaces","Common independently reconstructed logical function/signature identity"},
    {"scope-archive-disagrees",makeDefault,scopeArchiveMismatch,"publication-boundary","Common fixed Authority scope differs from its original publication archive"},
    {"publication-format-old",makeDefault,oldPublicationFormat,"publication-boundary","Common original fixed request/publication shape"},
  };
  for(const auto &example:negatives){
    Program program;if(!example.make(program))return 2;
    // Every negative first establishes the complete positive control through
    // every listed metadata stage; no cache/table pointer is written by us.
    const auto baseline=check(program);
    if(!baseline.passed){
      std::cerr<<example.name<<" prerequisite FAIL stage="<<baseline.stage<<" detail="<<baseline.detail<<"\n";
      passed=false;continue;
    }
    example.mutate(program);
    const auto result=check(program);
    const bool rejected=!result.passed&&llvm::StringRef(result.stage)==example.expectedStage&&result.detail==example.expectedError;
    std::cout<<example.name<<": "<<(rejected?"PASS":"FAIL")<<" stage="<<result.stage<<" detail="<<result.detail<<" remaining="<<result.remaining<<"\n";
    passed=rejected&&passed;
  }
  // Delta cases are appended; the original 3 positives and 19 negatives above
  // retain their exact inputs, assertions and expected first-error ordering.
  {
    Program zero;if(!makeZero(zero))return 2;const auto result=check(zero);
    const bool valid=result.passed&&result.ordinaryInputs==0&&result.declared.empty();
    std::cout<<"zero-ordinary-no-fdi: "<<(valid?"PASS":"FAIL")<<" stage="<<result.stage<<" detail="<<result.detail<<"\n";
    passed=valid&&passed;
  }
  const Example zeroNegatives[]={
    {"zero-ordinary-abi-fdi-forbidden",makeZero,zeroAbiFDI,"directory","Common ABI ordinary FDI minimum arity or role"},
    {"zero-ordinary-fixed-fdi-forbidden",makeZero,zeroFixedFDI,"publication-boundary","Common fixed ordinary FDI incoming/minimum shape or role"},
  };
  for(const auto &example:zeroNegatives){
    Program zero;if(!example.make(zero))return 2;const auto baseline=check(zero);
    if(!baseline.passed){
      std::cerr<<example.name<<" prerequisite FAIL stage="<<baseline.stage<<" detail="<<baseline.detail<<"\n";
      passed=false;continue;
    }
    example.mutate(zero);const auto result=check(zero);
    const bool rejected=!result.passed&&llvm::StringRef(result.stage)==example.expectedStage&&result.detail==example.expectedError;
    std::cout<<example.name<<": "<<(rejected?"PASS":"FAIL")<<" stage="<<result.stage<<" detail="<<result.detail<<"\n";
    passed=rejected&&passed;
  }
  passed=annotationCase("annotation-optional-null-union","i32|null",true,true)&&passed;
  passed=annotationCase("annotation-optional-parenthesized-null-union","(i32|null)",true,true)&&passed;
  passed=annotationCase("annotation-required-full-union-old","i32|null|undefined",false,true)&&passed;
  passed=annotationCase("annotation-optional-forbids-extra-null","i32",true,false)&&passed;
  return passed?0:1;
}
