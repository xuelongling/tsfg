// SPDX-License-Identifier: MIT
#include "common-program-source.h"
namespace tsfg::commonProgram {
namespace {
bool work(Program &p,Error &e,size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","internal construction metadata work exceeded");}
bool text(Program &p,Error &e,llvm::StringRef s){return work(p,e,12*s.size()+8);}
bool collect(Program &p,const Json &root,std::set<std::string> &targets,bool &hasSuper,Error &e){
  if(!work(p,e))return false;std::vector<const Json *> pending{&root};
  for(size_t index=0;index<pending.size();++index){
    if(!work(p,e))return false;const auto &value=*pending[index];
    if(auto array=value.getAsArray()){if(!work(p,e,array->size()))return false;for(const auto &child:*array)pending.push_back(&child);continue;}
    if(!value.getAsObject())continue;if(!work(p,e,24))return false;const auto kind=string(field(value,"kind"));
    if(kind=="new"||kind=="superConstruct"){
      hasSuper|=kind=="superConstruct";const auto target=field(value,kind=="new"?"type":"callee").getAsString().value_or("");
      if(!text(p,e,target))return false;if(p.internalTargets.count(target.str()))targets.insert(target.str());
    }
    for(auto key:{"expression","left","right","receiver","index","value","target","initializer","condition","tryBlock","catchClause","finallyBlock","block"}){
      const auto &child=field(value,key);if(!child.getAsNull())pending.push_back(&child);
    }
    for(auto key:{"elements","arguments","body","then","else"}){const auto &children=items(field(value,key));if(!work(p,e,children.size()))return false;for(const auto &child:children)pending.push_back(&child);}
  }return true;
}
}
bool internalConstructionCost(Program &p,const Json &root,Error &e){
  if(!work(p,e))return false;std::vector<const Json *> pending{&root};
  while(!pending.empty()){
    if(!work(p,e))return false;const auto *value=pending.back();pending.pop_back();
    if(auto s=value->getAsString()){if(!text(p,e,*s))return false;}
    else if(auto array=value->getAsArray()){if(!work(p,e,array->size()))return false;for(const auto &child:*array)pending.push_back(&child);}
    else if(auto object=value->getAsObject()){if(!work(p,e,object->size()))return false;for(const auto &entry:*object){if(!text(p,e,entry.first))return false;pending.push_back(&entry.second);}}
  }return true;
}
bool prepareInternalConstructors(Program &p,Error &e){
  if(p.internalMetadataReady)return true;
  const auto &rawTypes=items(field(p.hir,"types"));if(!work(p,e,rawTypes.size()))return false;
  std::map<std::string,const Json *> types,fields;
  for(const auto &type:rawTypes){const auto id=field(type,"id").getAsString().value_or("");if(!text(p,e,id))return false;types.emplace(id.str(),&type);
    for(const auto &f:items(field(type,"fields"))){if(!work(p,e))return false;fields.emplace(string(field(f,"id")),&f);}}
  if(!work(p,e,128))return false;const auto voidId=digest(std::string("tsfg.type")+std::string(1,'\0')+"void");
  if(!types.count(voidId))p.internalTypes.emplace(voidId,Object{{"id",voidId},{"kind","void"},{"name","void"}});
  for(const auto &[owner,type]:types){
    if(!work(p,e))return false;const auto kind=string(field(*type,"kind"));const auto &ctor=field(*type,"construction");
    if((kind!="reference"&&kind!="value")||ctor.getAsNull()||string(field(ctor,"kind"))=="explicit")continue;
    if(!internalConstructionCost(p,ctor,e)||!text(p,e,owner)||!work(p,e,192))return false;
    const auto construction=string(field(ctor,"id")),id="analysis-construction:"+construction;
    Array parameters;const auto &input=items(field(ctor,"parameters"));if(!work(p,e,8*input.size()))return false;
    for(size_t i=0;i<input.size();++i){
      if(!text(p,e,id)||!internalConstructionCost(p,input[i],e)||!work(p,e,32))return false;
      const auto binding=id+"/parameter/"+std::to_string(i);const auto &origin=field(input[i],"origin");
      Json range=Object{{"start",field(origin,"start")},{"end",field(origin,"end")}};
      Json parameter=Object{{"id",binding},{"name","$"+std::to_string(i)},{"kind","parameter"},{"type",field(input[i],"type")},
        {"writable",true},{"range",range},{"nameRange",range}};
      if(!internalConstructionCost(p,parameter,e))return false;p.internalBindings.emplace(binding,parameter);parameters.push_back(std::move(parameter));
    }
    const auto signature=digest(std::string("tsfg.common-program.analysis-construction-signature.v1")+std::string(1,'\0')+
      canonical(Object{{"construction",construction},{"parameters",field(field(ctor,"signature"),"parameters")},{"returnType",owner}}));
    Json range=Object{{"start",field(field(ctor,"origin"),"start")},{"end",field(field(ctor,"origin"),"end")}};
    Json source=Object{{"id",id},{"name","$implicitConstruction"},{"kind","construction-body"},{"analysisOnly",true},{"ownerType",owner},
      {"receiverBinding","analysis-receiver:"+id},{"sourcePath",field(field(ctor,"origin"),"source")},{"range",range},{"nameRange",range},
      {"returnType",owner},{"signatureHash",signature},{"parameters",std::move(parameters)},{"bindings",Array{}},{"body",Array{}},
      {"lexicalParent",nullptr},{"lexicalEnvironment",nullptr},{"activationEnvironment",nullptr},{"captures",Array{}}};
    if(string(field(ctor,"kind"))=="implicit-derived"){
      const auto base=string(field(*type,"base"));const auto &parent=*types.at(base);Array args;
      if(!text(p,e,base)||!internalConstructionCost(p,field(parent,"construction"),e)||!work(p,e,8*input.size()+64))return false;
      for(const auto &parameter:items(field(source,"parameters"))){if(!internalConstructionCost(p,parameter,e))return false;
        args.push_back(Object{{"kind","bindingReference"},{"binding",field(parameter,"id")},{"type",field(parameter,"type")},{"range",field(parameter,"range")}});}
      (*source.getAsObject())["body"]=Array{Object{{"kind","expression"},{"range",range},{"value",Object{{"kind","superConstruct"},{"type",voidId},
        {"callee",base},{"range",range},{"signature",field(field(parent,"construction"),"signature")},{"arguments",std::move(args)}}}}};
    }
    if(!work(p,e,4))return false;p.internalOwners.emplace(id,std::move(source));p.internalTargets.emplace(owner,id);
  }
  // Repeatedly remove nodes that cannot reach an implicit inline cycle.
  // The remaining nodes are exactly cycles and their predecessors; no host
  // recursion or newly invented depth cap is involved.
  std::map<std::string,size_t> degree;std::map<std::string,std::vector<std::string>> reverse;std::vector<std::string> leaves;
  for(const auto &[owner,id]:p.internalTargets){
    if(!text(p,e,owner))return false;const auto &type=*types.at(owner);std::set<std::string> edges;bool ignored=false;
    const auto base=string(field(type,"base"));if(p.internalTargets.count(base)){if(!text(p,e,base))return false;edges.insert(base);}
    for(const auto &fid:items(field(field(type,"construction"),"initializationFields"))){if(!work(p,e))return false;
      if(!collect(p,field(*fields.at(string(fid)),"initializer"),edges,ignored,e))return false;}
    if(!work(p,e,edges.size()+2))return false;degree.emplace(owner,edges.size());if(edges.empty())leaves.push_back(owner);
    for(const auto &to:edges){if(!text(p,e,to)||!text(p,e,owner))return false;reverse[to].push_back(owner);}
  }
  for(size_t i=0;i<leaves.size();++i){if(!work(p,e))return false;auto parents=reverse.find(leaves[i]);if(parents==reverse.end())continue;
    for(const auto &owner:parents->second){if(!work(p,e))return false;if(--degree.at(owner)==0){if(!text(p,e,owner))return false;leaves.push_back(owner);}}}
  for(const auto &[owner,count]:degree)if(count){if(!text(p,e,owner))return false;p.internalCycleTypes.insert(owner);}
  p.internalMetadataReady=true;return e.message.empty();
}
bool projectInternalConstruction(Program &p,const Json &owner,bool &project,Error &e){
  project=false;std::set<std::string> seeds;bool hasSuper=false;
  if(!collect(p,field(owner,"body"),seeds,hasSuper,e))return false;
  if(string(field(owner,"kind"))=="construction-body"){
    const auto own=string(field(owner,"ownerType"));const Json *type=nullptr;
    for(const auto &row:items(field(p.hir,"types"))){if(!work(p,e))return false;if(string(field(row,"id"))==own){type=&row;break;}}
    if(type&&(string(field(*type,"base")).empty()||hasSuper))for(const auto &f:items(field(*type,"fields")))if(!collect(p,field(f,"initializer"),seeds,hasSuper,e))return false;
  }
  if(!work(p,e,seeds.size()))return false;for(const auto &seed:seeds)project|=p.internalCycleTypes.count(seed)!=0;return true;
}
} // namespace tsfg::commonProgram
