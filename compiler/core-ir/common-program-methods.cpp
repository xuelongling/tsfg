// SPDX-License-Identifier: MIT
#include "common-program-methods.h"
#include "common-program-actual.h"
namespace tsfg::commonProgram {
namespace {
bool spend(Program &p,Error &e,size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","method selection work exceeded");}
bool need(bool ok,Error &e,llvm::StringRef message){return ok||reject(e,"core-ir-common-method",message);}
}
bool methodDispatch(Program &p,const std::string &view,const std::string &member,Json &out,Error &e){
  referenceContracts::MethodCatalogue catalogue;std::map<std::string,const Json *> functions;
  for(const auto &fn:items(field(p.hir,"functions"))){
    if(!spend(p,e))return false;const auto id=string(field(fn,"id"));functions.emplace(id,&fn);
    if(string(field(fn,"kind"))=="method"){
      const auto name=field(fn,"name").getAsString();if(!spend(p,e,name?name->size()/8+1:1))return false;
      catalogue.methods.emplace(id,referenceContracts::Method{string(field(fn,"ownerType")),string(field(fn,"name")),string(field(fn,"overrideTarget"))});
    }
  }
  for(const auto &t:items(field(p.hir,"types"))){
    if(!spend(p,e))return false;const auto kind=string(field(t,"kind"));if(kind!="reference"&&kind!="value")continue;
    referenceContracts::MethodClass row;row.base=string(field(t,"base"));
    for(const auto &id:items(field(t,"methods"))){if(!spend(p,e))return false;row.methods.push_back(string(id));}catalogue.classes.emplace(string(field(t,"id")),std::move(row));
  }
  std::string error;const auto charge=[&](size_t n){return spend(p,e,n);};
  if(!referenceContracts::validateMethods(catalogue,charge,error))return e.message.empty()?need(false,e,error):false;
  if(!need(catalogue.classes.count(view)&&catalogue.methods.count(member),e,"static method view/member is not owned"))return false;
  std::string visible;if(!referenceContracts::selectMethod(catalogue,{},view,view,member,visible,charge,error))return e.message.empty()?need(false,e,error):false;
  if(!need(visible==member,e,"static method is not the effective Source member"))return false;
  Array rows;
  for(const auto &[actual,type]:catalogue.classes){
    bool eligible=p.referenceMethods.count({actual,view});auto parent=actual;
    while(!eligible&&!parent.empty()){if(!spend(p,e))return false;eligible=parent==view;parent=catalogue.classes.at(parent).base;}
    if(!eligible)continue;
    std::string selected;error.clear();if(!referenceContracts::selectMethod(catalogue,p.referenceMethods,actual,view,member,selected,charge,error))return e.message.empty()?need(false,e,error):false;
    if(selected.empty())continue;const auto *target=functions.at(selected);
    const auto signature=field(*target,"signatureHash").getAsString();
    if(!need(rows.size()<256,e,"method dispatch has no bounded complete target set")||
      !spend(p,e,(actual.size()+selected.size()+(signature?signature->size():0))/8+1))return false;
    rows.push_back(Object{{"receiver_type",actual},{"target",selected},{"signature_hash",field(*target,"signatureHash")}});
  }
  if(!need(!rows.empty(),e,"method dispatch has no bounded complete target set"))return false;out=std::move(rows);return true;
}
bool methodTargets(Program &p,const Json &rows,std::vector<std::string> &out,Error &e){
  std::string previous;std::set<std::string> targets;
  if(!need(rows.getAsArray()&&!items(rows).empty()&&items(rows).size()<=256,e,"method dispatch table shape differs"))return false;
  for(const auto &row:items(rows)){
    if(!spend(p,e)||!need(exact(row,{"receiver_type","target","signature_hash"}),e,"method dispatch row shape differs"))return false;
    const auto actual=string(field(row,"receiver_type")),target=string(field(row,"target")),signature=string(field(row,"signature_hash"));
    if(!need(!actual.empty()&&!target.empty()&&!signature.empty()&&(previous.empty()||previous<actual),e,"method dispatch receiver order/identity differs"))return false;
    previous=actual;targets.insert(target);
  }
  if(!spend(p,e,targets.size()))return false;out.assign(targets.begin(),targets.end());return true;
}
std::string ActualCheck::joinCarriers(const std::vector<std::string> &rows){
  CapacityValue bound;for(const auto &id:rows){if(!step())return {};
    if(id=="payload:"+schema.str())bound.unknown=true;
    else if(types.count(id))bound.tags.insert(id);
    else if(domains.count(id)){for(const auto &tag:items(field(*domains.at(id),"actualTypes"))){if(!step())return {};bound.tags.insert(string(tag));}}
    else {need(false,"method ABI carrier is not owned");return {};}
  }return carrier(bound);
}
bool ActualCheck::methodAbi(const Function &fn,const Operation &op,std::vector<std::string> &parameters,std::string &result){
  const auto id=string(field(op.properties,"function_id"));std::vector<std::string> targets;
  if(!need(sourceFunctions.count(id)&&string(field(*sourceFunctions.at(id),"kind"))=="method"&&
    string(field(*sourceFunctions.at(id),"signatureHash"))==string(field(op.properties,"signature_hash")),"static method signature differs")||
    !methodTargets(p,field(op.properties,"dispatch"),targets,e))return false;
  const auto &source=*sourceFunctions.at(id);const bool empty=types.count(string(field(source,"returnType")))&&string(field(*types.at(string(field(source,"returnType"))),"kind"))=="void";
  if(!need(op.operands.size()==items(field(source,"parameters")).size()+1,"static method argument arity differs"))return false;
  if(!step(op.operands.size()))return false;
  std::vector<std::vector<std::string>> inputs(op.operands.size());std::vector<std::string> outputs;
  for(const auto &row:items(field(op.properties,"dispatch"))){
    if(!step())return false;const auto target=string(field(row,"target"));
    if(!need(sourceFunctions.count(target)&&physicalFunctions.count(target)&&string(field(*sourceFunctions.at(target),"kind"))=="method"&&
      string(field(*sourceFunctions.at(target),"signatureHash"))==string(field(row,"signature_hash")),"method target signature differs"))return false;
    const auto &abi=*physicalFunctions.at(target);const auto &args=items(field(abi,"parameters"));
    if(!need(!args.empty()&&args.size()<=inputs.size(),"method implementation needs unsupported missing parameters"))return false;
    for(size_t i=0;i<args.size();++i){if(!step())return false;inputs[i].push_back(string(args[i]));}
    if(!empty){if(!need(string(field(abi,"result"))!="void","valued method may not discard a void implementation"))return false;outputs.push_back(string(field(abi,"result")));}
  }
  for(size_t i=0;i<inputs.size();++i){if(!step())return false;parameters.push_back(inputs[i].empty()?fn.carriers[op.operands[i]]:joinCarriers(inputs[i]));}
  result=empty?"void":joinCarriers(outputs);return e.message.empty();
}

}
