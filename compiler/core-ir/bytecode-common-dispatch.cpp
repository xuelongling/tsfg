// SPDX-License-Identifier: MIT
#include "bytecode-common-graph.h"
#include "bytecode-common-budget.h"
#include "common-program-methods.h"
#include "llvm/ADT/SmallVector.h"

namespace tsfg::wire::common {
using namespace commonProgram;
bool Graph::dispatch(const std::string &viewId,const std::string &member,bool method,uint32_t &index){
  Array arms;
  if(method){
    Json rows=nullptr;commonProgram::Error failure;
    {WorkScope budget(builder.source,builder.out.remaining);
      if(!methodDispatch(builder.source,viewId,member,rows,failure))return builder.reject(failure.message);
    }
    for(const auto &row:items(rows)){
      if(!builder.step())return false;const auto target=string(field(row,"target"));
      arms.push_back(Object{{"actual",builder.typeIds.at(string(field(row,"receiver_type")))},
        {"target",builder.functionIds.at(target)},{"abi",builder.functionIds.at(target)}});
    }
  }else{
    for(const auto &[actual,type]:builder.types){
      const auto kind=string(field(*type,"kind"));if(kind!="reference"&&kind!="value")continue;
      bool eligible=false,owned=false;auto parent=actual;
      while(!parent.empty()){
        if(!builder.step())return false;eligible|=parent==viewId;
        for(const auto &fieldRow:items(field(*builder.types.at(parent),"fields"))){if(!builder.step())return false;if(string(field(fieldRow,"id"))==member)owned=true;}
        parent=string(field(*builder.types.at(parent),"base"));
      }
      const auto selected=builder.source.referenceFields.find({actual,viewId});eligible|=selected!=builder.source.referenceFields.end();
      if(!eligible)continue;std::string target=owned?member:std::string();
      if(!owned&&selected!=builder.source.referenceFields.end()){
        auto chosen=selected->second.find(member);if(chosen!=selected->second.end())target=chosen->second;
      }
      if(!builder.step())return false;arms.push_back(Object{{"actual",builder.typeIds.at(actual)},
        {"target",target.empty()?Json(nullptr):Json(builder.fieldIds.at(target))},{"abi",nullptr}});
    }
  }
  auto &rows=*builder.out.table(Table::Views).getAsObject()->getArray("dispatch");
  if(arms.empty()||arms.size()>256||rows.size()>=100000)return builder.reject("Common complete dispatch table bound");
  index=uint32_t(rows.size());rows.push_back(Object{{"kind",method?"method":"field"},{"view",builder.typeIds.at(viewId)},
    {"member",method?builder.methodIds.at(member):builder.fieldIds.at(member)},{"arms",std::move(arms)}});return true;
}
bool Graph::scope(const std::string &handler,llvm::StringRef role,uint16_t &out){
  const auto prefix=source.id+"/body/";if(!llvm::StringRef(handler).starts_with(prefix))return builder.reject("Common handler lacks its original structured Source path");
  llvm::SmallVector<llvm::StringRef> path;llvm::StringRef(handler).drop_front(source.id.size()+1).split(path,'/');
  std::vector<std::string> lexical;size_t at=1;
  while(at+1<path.size()){
    if(!builder.step())return false;const auto statement=path[at++],part=path[at];
    if(part=="then"||part=="else"){lexical.push_back("if:"+part.str()+":"+statement.str());++at;}
    else if(part=="body"){lexical.push_back("while:"+statement.str());++at;}
    else if(part=="try"||part=="catch"||part=="finally"){lexical.push_back(part.str()+":"+statement.str());++at;}
    else lexical.push_back("block:"+statement.str());
  }
  if(at>=path.size())return builder.reject("Common handler statement path is incomplete");lexical.push_back(role.str()+":"+path[at].str());
  const auto found=builder.scopeIds.find({source.id,lexical});if(found==builder.scopeIds.end())return builder.reject("Common handler has no admitted original lexical scope");
  out=found->second;return true;
}
} // namespace tsfg::wire::common
