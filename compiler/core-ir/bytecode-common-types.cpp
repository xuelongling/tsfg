// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"
#include "bytecode.h"
#include "dialect.h"

namespace tsfg::wire::common {
using namespace commonProgram;
bool Builder::typeTables() {
  if(!bytecode::decodeHash(source.inputIdentity,out.input)||!bytecode::decodeHash(source.sourceHash,out.sourceHash))
    return reject("Common admitted header identity is absent");
  if(!step(1+source.sourcePath.size()/64))return false;
  out.sourcePath=source.sourcePath;out.sourceLength=source.sourceLength;out.rootSource=sourceIds.at(source.sourcePath);
  if(!step(sourceIds.size()))return false;Array sourceRows;
  for(size_t i=0;i<sourceIds.size();++i)sourceRows.emplace_back(nullptr);
  for(const auto &row:items(field(source.hir,"sources"))){
    const auto path=field(row,"path").getAsString().value();const auto content=field(row,"content").getAsString().value();
    if(!step(1+content.size()/64+path.size()/64))return false;
    // Source admission already established strict UTF8. Count its original
    // UTF16 units without rewriting or normalizing the retained Source bytes.
    uint32_t length=0;for(const unsigned char c:content)if((c&0xc0)!=0x80)length+=c>=0xf0?2:1;
    sourceRows[sourceIds.at(path.str())]=Object{{"path",path.str()},{"hash",field(row,"hash")},{"length",length}};
  }
  out.table(Table::Sources)=std::move(sourceRows);
  Array typeRows;
  for(const auto &[id,type]:types){
    if(!step())return false;const auto kind=string(field(*type,"kind"));const auto name=string(field(*type,"name"));
    uint8_t code=0;
    if(kind=="scalar")for(uint8_t i=1;i<=13;++i)if(scalarName(i)==name){code=i;break;}
    if(kind=="string")code=14;
    Json element=nullptr,base=nullptr,nominal=nullptr,runtime=nullptr,methods=nullptr;Array members;
    if(kind=="array"||kind=="readSpan")element=typeIds.at(string(field(*type,"elementType")));
    else if(kind=="function"){
      element=typeIds.at(string(field(*type,"returnType")));
      for(const auto &parameter:items(field(*type,"parameters"))){if(!step())return false;members.emplace_back(typeIds.at(string(parameter)));}
    }else if(kind=="union"){
      for(const auto &member:items(field(*type,"members"))){if(!step())return false;members.emplace_back(typeIds.at(string(member)));}
    }else if(kind=="reference"||kind=="value"){
      const auto &key=field(*type,"nominalKey");const auto &path=items(field(key,"declarationPath"));
      if(!step(path.size()+1))return false;
      nominal=Object{{"source",sourceIds.at(string(field(key,"sourcePath")))},{"declarationPath",Json(Array(path))},{"category",field(key,"category")}};
      runtime=field(*type,"runtimeKey");
      if(!field(*type,"base").getAsNull())base=typeIds.at(string(field(*type,"base")));
      if(type->getAsObject()->get("methods")){
        Array ordered;for(const auto &method:items(field(*type,"methods"))){if(!step())return false;ordered.push_back(methodIds.at(string(method)));}methods=std::move(ordered);
      }
    }
    typeRows.emplace_back(Object{{"id",id},{"kind",kind},{"name",name},{"nativeCode",code},{"element",std::move(element)},
      {"base",std::move(base)},{"runtimeKey",std::move(runtime)},{"nominalKey",std::move(nominal)},{"members",std::move(members)},{"methods",std::move(methods)}});
  }
  out.table(Table::Types)=std::move(typeRows);Array domainRows;
  for(const auto &[id,domain]:domains){
    if(!step())return false;Array actual;
    for(const auto &type:items(field(*domain,"actualTypes"))){if(!step())return false;actual.emplace_back(typeIds.at(string(type)));}
    domainRows.emplace_back(Object{{"id",id},{"actualTypes",std::move(actual)},{"representation",field(*domain,"representation")},
      {"alignment",field(*domain,"alignment")},{"tagBytes",field(*domain,"tagBytes")},
      {"byteSize",field(*domain,"byteSize")},{"referenceCount",field(*domain,"referenceCount")}});
  }
  out.table(Table::Domains)=std::move(domainRows);return true;
}
} // namespace tsfg::wire::common
