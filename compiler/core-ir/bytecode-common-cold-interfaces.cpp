// SPDX-License-Identifier: MIT
#include "bytecode-common-cold.h"

namespace tsfg::wire {
using namespace commonProgram;
bool CommonCold::interfaces(){
  Array functions;
  std::map<uint32_t,const Json *> closureRows;
  std::map<uint32_t,const Json *> memberRows;
  for(const auto &row:*tables.closureFunctions)closureRows.emplace(uint32_t(*field(row,"function").getAsInteger()),&row);
  for(const auto *rows:{tables.methods,tables.constructions})for(const auto &row:*rows){
    if(!charge())return false;if(!field(row,"function").getAsNull()&&!memberRows.emplace(uint32_t(*field(row,"function").getAsInteger()),&row).second)return reject("Common definition belongs to multiple nominal members");
  }
  const auto &original=items(field(scope,"functions"));
  for(const auto &given:original){
    if(!charge())return false;const auto id=string(field(given,"functionId"));const auto n=tables.functionIds.at(id);
    const auto &actual=tables.program.functions[n];const auto &abi=(*tables.abis)[n];const auto &decl=field(given,"declKey");
    if(actual.role==2||!closureRows.count(n)||string(field(decl,"sourcePath"))!=path(actual.source)||string(field(decl,"name"))!=actual.name||
      string(field(given,"signatureHash"))!="sha256:"+bytecode::hex(actual.signature))return reject("Common fixed function/definition join");
    const auto &closure=*closureRows.at(n);const auto receiver=field(abi,"receiver");Json owner=nullptr,receiverBinding=nullptr;
    Array parameters,locals,logicalTypes,captures;
    if(!receiver.getAsNull()){
      const auto &binding=(*tables.bindings)[uint32_t(*receiver.getAsInteger())];owner=type(uint32_t(*field(binding,"type").getAsInteger()));
      receiverBinding=field(binding,"id");logicalTypes.push_back(owner);
    }
    for(const auto &ref:items(field(abi,"parameters"))){
      if(!charge())return false;const auto &binding=(*tables.bindings)[uint32_t(*ref.getAsInteger())];const auto &o=field(binding,"origin");const auto t=type(uint32_t(*field(binding,"type").getAsInteger()));
      parameters.push_back(Object{{"id",field(binding,"id")},{"sourceBinding",field(binding,"id")},{"name",field(binding,"name")},{"kind","parameter"},
        {"type",t},{"writable",field(binding,"writable")},{"range",Object{{"start",field(o,"start")},{"end",field(o,"end")}}}});logicalTypes.push_back(t);
    }
    for(const auto &binding:*tables.bindings){
      if(!charge())return false;if(string(field(binding,"role"))!="local"||field(binding,"owner").getAsInteger()!=int64_t(n))continue;
      const auto &o=field(binding,"origin");locals.push_back(Object{{"id",field(binding,"id")},{"sourceBinding",field(binding,"id")},
        {"name",field(binding,"name")},{"kind",field(binding,"declarationKind")},{"type",type(uint32_t(*field(binding,"type").getAsInteger()))},
        {"writable",field(binding,"writable")},{"range",Object{{"start",field(o,"start")},{"end",field(o,"end")}}}});
    }
    const auto result=field(abi,"result");std::string returnType;
    if(!result.getAsNull())returnType=type(uint32_t(*result.getAsInteger()));
    else for(size_t t=0;t<tables.types->size();++t){if(!charge())return false;if(string(field((*tables.types)[t],"kind"))=="void")returnType=type(uint32_t(t));}
    if(returnType.empty()||!same(Json(Array(logicalTypes)),field(given,"parameterTypes"))||returnType!=string(field(given,"returnType")))return reject("Common fixed logical ABI vector/result join");
    const auto signature=digest(std::string("tsfg.module-callable-signature.candidate.v1")+'\0'+canonical(Object{{"parameters",Json(Array(logicalTypes))},{"returns",returnType}}));
    const auto name=canonical(Object{{"path",field(decl,"path")},{"kind",field(decl,"kind")},{"name",field(decl,"name")}});
    const auto expected=digest(std::string("tsfg.module-callable-function.candidate.v1")+'\0'+canonical(Object{{"path",path(actual.source)},{"name",name},{"signatureHash",signature}}));
    if(signature!="sha256:"+bytecode::hex(actual.signature)||expected!=id)return reject("Common independently reconstructed logical function/signature identity");
    Json parent=nullptr,lexical=nullptr,activation=nullptr;
    if(!field(closure,"parent").getAsNull())parent=function(uint32_t(*field(closure,"parent").getAsInteger()));
    if(!field(closure,"lexicalEnvironment").getAsNull())lexical=field((*tables.environments)[uint32_t(*field(closure,"lexicalEnvironment").getAsInteger())],"id");
    if(!field(closure,"activationEnvironment").getAsNull())activation=field((*tables.environments)[uint32_t(*field(closure,"activationEnvironment").getAsInteger())],"id");
    std::set<std::string> keys;
    for(const auto &capture:items(field(closure,"captures"))){
      if(!charge())return false;const auto &environment=(*tables.environments)[uint32_t(*field(capture,"environment").getAsInteger())];
      const auto &slot=items(field(environment,"slots"))[uint32_t(*field(capture,"slot").getAsInteger())];keys.insert(string(field(slot,"key")));
      captures.push_back(Object{{"binding",field((*tables.bindings)[uint32_t(*field(slot,"binding").getAsInteger())],"id")}});
    }
    Array captureKeys;for(const auto &key:keys){if(!charge())return false;captureKeys.push_back(key);}
    if(!same(parent,field(given,"lexicalParent"))||!same(lexical,field(given,"lexicalEnvironment"))||!same(activation,field(given,"activationEnvironment"))||
      !same(Json(Array(captureKeys)),field(given,"captures")))return reject("Common fixed lexical interface join");
    const auto kind=string(field(given,"kind")),declarationKind=string(field(decl,"kind"));
    if(actual.role==1?(kind!="construction-body"||declarationKind!="constructor"||owner.getAsNull()):
      kind=="method"?declarationKind!="method"||owner.getAsNull():kind!="source"||declarationKind!="function"||!owner.getAsNull())return reject("Common logical function role differs from actual ABI");
    const auto selected=memberRows.find(n);const Json *member=selected==memberRows.end()?nullptr:selected->second;
    if(kind=="source"){
      if(member||string(field(given,"access"))!="public")return reject("Common ordinary function has a nominal member/access claim");
    }else{
      if(!member||!same(field(given,"access"),field(*member,"access"))||!same(owner,Json(type(uint32_t(*field(*member,"owner").getAsInteger())))))return reject("Common fixed function Member owner/access join");
      Array expectedPath;expectedPath.push_back("type");const auto &nominal=field((*tables.types)[uint32_t(*field(*member,"owner").getAsInteger())],"nominalKey");
      for(const auto &part:items(field(nominal,"declarationPath"))){if(!charge())return false;expectedPath.push_back(part);}
      if(!same(Json(std::move(expectedPath)),field(decl,"path"))||!parent.getAsNull())return reject("Common nominal member original declaration key/parent");
    }
    functions.push_back(Object{{"id",id},{"name",actual.name},{"sourcePath",path(actual.source)},{"range",Object{{"start",actual.declaration.start},{"end",actual.declaration.end}}},
      {"declKey",decl},{"kind",kind},{"access",field(given,"access")},{"signatureHash",signature},{"returnType",returnType},
      {"parameters",std::move(parameters)},{"bindings",std::move(locals)},{"receiverBinding",std::move(receiverBinding)},{"ownerType",std::move(owner)},
      {"lexicalParent",std::move(parent)},{"lexicalEnvironment",std::move(lexical)},{"activationEnvironment",std::move(activation)},{"captures",std::move(captures)}});
  }
  (*model.hir.getAsObject())["functions"]=std::move(functions);return true;
}
} // namespace tsfg::wire
