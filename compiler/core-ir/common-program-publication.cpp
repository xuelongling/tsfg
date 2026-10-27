// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::commonProgram {
namespace {
Json select(const Json &v,llvm::ArrayRef<llvm::StringRef> keys){Object out;for(auto key:keys)out[key]=field(v,key);return out;}
bool work(Program &p,Error &e,size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","fixed Published verification work exceeded");}
bool need(bool c,Error &e,llvm::StringRef detail){return c||reject(e,"core-ir-common-publication",detail);}
bool callableBounds(Program &p,const Json &fn,const Json &value,Error &e){
  if(!need(exact(value,{"parameters","returns","slotWrites"})&&field(value,"parameters").getAsArray()&&
    field(value,"slotWrites").getAsArray()&&items(field(value,"slotWrites")).empty(),e,"fixed callable transfer shape differs"))return false;
  std::map<std::string,const Json *> types,functions;
  for(const auto &type:items(field(p.hir,"types"))){if(!work(p,e))return false;types.emplace(string(field(type,"id")),&type);}
  for(const auto &target:items(field(p.hir,"functions"))){if(!work(p,e))return false;functions.emplace(string(field(target,"id")),&target);}
  const auto bound=[&](const Json &targets,const Json &type){
    if(!need(exact(targets,{"top","functions"})&&field(targets,"top").getAsBoolean()&&
      field(targets,"functions").getAsArray()&&items(field(targets,"functions")).size()<=256,e,"fixed callable set shape differs"))return false;
    std::string previous;
    for(const auto &idValue:items(field(targets,"functions"))){
      if(!work(p,e))return false;const auto id=string(idValue);const auto found=functions.find(id);
      if(!need(found!=functions.end()&&(previous.empty()||previous<id),e,"fixed callable target identity or order differs"))return false;
      const auto &target=*found->second;const auto &parameters=items(field(target,"parameters")),&expected=items(field(type,"parameters"));
      if(!need(field(target,"ownerType").getAsNull()&&parameters.size()==expected.size()&&
        same(field(target,"returnType"),field(type,"returnType")),e,"fixed callable signature differs"))return false;
      if(!work(p,e,parameters.size()))return false;
      for(size_t i=0;i<parameters.size();++i)if(!need(same(field(parameters[i],"type"),expected[i]),e,"fixed callable parameter type differs"))return false;
      previous=id;
    }
    return true;
  };
  const auto &parameters=items(field(fn,"parameters")),&records=items(field(value,"parameters"));size_t record=0;
  for(size_t index=0;index<parameters.size();++index){
    if(!work(p,e))return false;const auto found=types.find(string(field(parameters[index],"type")));
    if(!need(found!=types.end(),e,"fixed callable parameter type is unowned"))return false;
    if(string(field(*found->second,"kind"))!="function")continue;
    if(!need(record<records.size()&&exact(records[record],{"index","allowed"})&&
      field(records[record],"index").getAsInteger()==int64_t(index),e,"fixed callable parameter index or shape differs"))return false;
    if(!bound(field(records[record++],"allowed"),*found->second))return false;
  }
  if(!need(record==records.size(),e,"extra fixed callable parameter transfer"))return false;
  const auto returned=types.find(string(field(fn,"returnType")));
  if(returned!=types.end()&&string(field(*returned->second,"kind"))=="function")return bound(field(value,"returns"),*returned->second);
  return need(bool(field(value,"returns").getAsNull()),e,"noncallable result has a callable return transfer");
}
bool covers(Program &p,const Effects &upper,const Effects &body,Error &e){
  if(!work(p,e,body.reads.size()+body.writes.size()+body.hostReads.size()+body.hostWrites.size()+body.parameters.size()))return false;
  for(const auto &id:body.hostReads)if(!upper.hostReads.count(id))return need(false,e,"body Host read exceeds fixed upper");
  for(const auto &id:body.hostWrites)if(!upper.hostWrites.count(id))return need(false,e,"body Host write exceeds fixed upper");
  for(const auto &id:body.reads)if(!upper.reads.count(id))return need(false,e,"body read exceeds fixed upper");
  for(const auto &id:body.writes)if(!upper.writes.count(id))return need(false,e,"body write exceeds fixed upper");
  if(!need((!body.allocation||upper.allocation)&&(!body.managedReference||upper.managedReference)&&
    (!body.ehControl||upper.ehControl)&&(!body.mayThrow||upper.mayThrow)&&(!body.await||upper.await)&&(!body.lock||upper.lock)&&
    (!body.escape||upper.escape)&&(!body.unknownHost||upper.unknownHost)&&upper.parameters.size()==body.parameters.size(),e,"body capability exceeds fixed upper"))return false;
  for(size_t i=0;i<body.parameters.size();++i){const auto &a=upper.parameters[i],&b=body.parameters[i];
    if(!need((!b.read||a.read)&&(!b.write||a.write)&&(!b.structural||a.structural),e,"body parameter access exceeds fixed upper"))return false;}
  if(!work(p,e,body.captures.size()))return false;
  for(const auto &[slot,access]:body.captures){
    const auto found=upper.captures.find(slot);
    if(!need(found!=upper.captures.end()&&(!access.read||found->second.read)&&
      (!access.write||found->second.write)&&(!access.structural||found->second.structural),e,"body capture access exceeds fixed upper"))return false;
  }
  return true;
}
bool scope(Program &p,Json &out,Error &e){
  std::map<std::string,const Json *> types;for(const auto &t:items(field(p.hir,"types"))){if(!work(p,e))return false;types.emplace(string(field(t,"id")),&t);}
  std::set<std::string> seen;std::vector<std::string> pending;
  for(const auto &g:items(field(p.hir,"globals")))pending.push_back(string(field(g,"type")));
  for(const auto &fn:items(field(p.hir,"functions"))){pending.push_back(string(field(fn,"returnType")));if(!field(fn,"ownerType").getAsNull())pending.push_back(string(field(fn,"ownerType")));
    for(const auto &a:items(field(fn,"parameters"))){if(!work(p,e))return false;pending.push_back(string(field(a,"type")));}}
  for(const auto &[id,t]:types)if(string(field(*t,"kind"))=="value"||string(field(*t,"kind"))=="reference")pending.push_back(id);
  while(!pending.empty()){
    if(!work(p,e))return false;const auto id=pending.back();pending.pop_back();if(!seen.insert(id).second)continue;
    if(!need(types.count(id),e,"stable scope has unowned type"))return false;const auto &t=*types.at(id);
    for(auto key:{"base","elementType"})if(!field(t,key).getAsNull())pending.push_back(string(field(t,key)));
    for(const auto &m:items(field(t,"members"))){if(!work(p,e))return false;pending.push_back(string(m));}
    for(const auto &f:items(field(t,"fields"))){if(!work(p,e))return false;pending.push_back(string(field(f,"type")));}
    if(string(field(t,"kind"))=="function"){
      for(const auto &type:items(field(t,"parameters"))){if(!work(p,e))return false;pending.push_back(string(type));}
      pending.push_back(string(field(t,"returnType")));
    }
  }
  Array typeRows,functions,environments,globals,modules,roots,required;
  std::map<std::string,std::string> slotKeys;
  for(const auto &env:items(field(p.hir,"environments"))){
    if(!work(p,e))return false;Array slots;
    for(const auto &slot:items(field(env,"slots"))){
      if(!work(p,e))return false;slotKeys.emplace(string(field(slot,"binding")),string(field(slot,"key")));
      slots.push_back(select(slot,{"key","type","writable","kind"}));
    }
    environments.push_back(Object{{"id",field(env,"id")},{"owner",field(env,"owner")},{"parent",field(env,"parent")},{"slots",std::move(slots)}});
  }
  for(const auto &t:items(field(p.hir,"types")))if(seen.count(string(field(t,"id")))){
    if(!work(p,e))return false;typeRows.push_back(Object{{"id",field(t,"id")},{"label",field(t,"semanticLabel")},{"shape",field(t,"semanticShape")}});}
  for(const auto &fn:items(field(p.hir,"functions"))){
    if(!work(p,e))return false;Array parameters;if(!field(fn,"ownerType").getAsNull())parameters.push_back(field(fn,"ownerType"));
    for(const auto &a:items(field(fn,"parameters"))){if(!work(p,e))return false;parameters.push_back(field(a,"type"));}
    std::set<std::string> captured;
    for(const auto &capture:items(field(fn,"captures"))){if(!work(p,e))return false;const auto binding=string(field(capture,"binding"));
      if(!need(slotKeys.count(binding),e,"stable capture binding has no owned slot"))return false;captured.insert(slotKeys.at(binding));}
    Array captureKeys;for(const auto &key:captured){if(!work(p,e))return false;captureKeys.push_back(key);}
    functions.push_back(Object{{"functionId",field(fn,"id")},{"declKey",field(fn,"declKey")},{"kind",field(fn,"kind")},{"access",field(fn,"access")},
      {"lexicalParent",field(fn,"lexicalParent")},{"lexicalEnvironment",field(fn,"lexicalEnvironment")},{"activationEnvironment",field(fn,"activationEnvironment")},
      {"captures",std::move(captureKeys)},
      {"signatureHash",field(fn,"signatureHash")},{"parameterTypes",std::move(parameters)},{"returnType",field(fn,"returnType")}});
  }
  for(const auto &g:items(field(p.hir,"globals"))){if(!work(p,e))return false;globals.push_back(Object{{"globalId",field(g,"id")},{"declKey",field(g,"declKey")},{"type",field(g,"type")},{"writable",field(g,"writable")}});}
  for(const auto &m:items(field(p.hir,"modules"))){if(!work(p,e))return false;auto row=*select(m,{"id","sourcePath","external","dependencies","initializer","globals"}).getAsObject();Array imports,exports;
    for(const auto &edge:items(field(m,"imports"))){if(!work(p,e))return false;auto r=*select(edge,{"kind","specifier","sourcePath"}).getAsObject();Array aliases;
      for(const auto &alias:items(field(edge,"bindings"))){if(!work(p,e))return false;aliases.push_back(select(alias,{"kind","name","imported","target","targetSourcePath"}));}r["bindings"]=std::move(aliases);imports.push_back(std::move(r));}
    for(const auto &x:items(field(m,"exports"))){if(!work(p,e))return false;exports.push_back(select(x,{"name","kind","target","targetSourcePath"}));}
    row["imports"]=std::move(imports);row["exports"]=std::move(exports);modules.push_back(std::move(row));
  }
  for(const auto &r:items(field(field(p.hir,"closure"),"roots"))){if(!work(p,e))return false;roots.push_back(select(r,{"kind","sourcePath","name","target"}));}
  for(const auto &r:items(field(field(p.hir,"closure"),"requiredRoots"))){if(!work(p,e))return false;required.push_back(select(r,{"kind","sourcePath","name","target"}));}
  Array hosts;for(const auto &host:items(field(p.hir,"hostImports"))){if(!work(p,e))return false;hosts.push_back(select(host,{"id","sourcePath","name","capabilityId","signatureHash","parameterTypes","returnType"}));}
  Json hostContext=nullptr;if(!p.hosts.empty())hostContext=Object{{"contractDigest",p.hostContractHash},{"buildIdentityDigest",field(field(field(field(p.hir,"hostContext"),"identity"),"buildIdentity"),"digest")}};
  out=Object{{"hostImports",std::move(hosts)},{"hostContext",std::move(hostContext)},{"profile","common-program-fixed-v2"},{"rootFile",field(p.hir,"rootFile")},{"types",std::move(typeRows)},
    {"functions",std::move(functions)},{"environments",std::move(environments)},{"globals",std::move(globals)},{"modules",std::move(modules)},
    {"roots",Object{{"roots",std::move(roots)},{"requiredRoots",std::move(required)}}}};return true;
}
}
bool validateCallableBounds(Program &p,const Json &fn,const Json &value,Error &e){return callableBounds(p,fn,value,e);}
bool readEffects(Program &p,const Json &raw,const Json &fn,Effects &out,Error &e){
  if(!need(exact(raw,{"globals","hostResources","parameters","facets","captures"})&&exact(field(raw,"globals"),{"reads","writes"})&&
    exact(field(raw,"facets"),{"allocation","managedReference","ehControl","mayThrow","await","lock","escape","unknownHost"})&&field(raw,"parameters").getAsArray(),e,"fixed effect shape differs"))return false;
  if(!need(exact(field(raw,"hostResources"),{"reads","writes"}),e,"fixed Host resource shape differs"))return false;
  for(auto key:{"reads","writes"}){const auto &values=field(field(raw,"hostResources"),key);auto &to=llvm::StringRef(key)=="reads"?out.hostReads:out.hostWrites;
    if(!need(values.getAsArray()&&items(values).size()<=p.hostResources.size(),e,"fixed Host resource bound differs"))return false;std::string previous;
    for(const auto &value:items(values)){if(!work(p,e))return false;const auto id=string(value);if(!need(p.hostResources.count(id)&&(previous.empty()||previous<id),e,"fixed Host resource identity/order differs"))return false;previous=id;to.insert(id);}}
  const auto &facets=field(raw,"facets");
  const std::pair<llvm::StringRef,bool *> flags[]={{"allocation",&out.allocation},{"managedReference",&out.managedReference},{"ehControl",&out.ehControl},{"mayThrow",&out.mayThrow},
    {"await",&out.await},{"lock",&out.lock},{"escape",&out.escape},{"unknownHost",&out.unknownHost}};
  for(auto [key,to]:flags){auto value=field(facets,key).getAsBoolean();if(!need(bool(value),e,"fixed facet must be boolean"))return false;*to=*value;}
  std::map<std::string,bool> globals;for(const auto &g:items(field(p.hir,"globals")))globals.emplace(string(field(g,"id")),field(g,"writable").getAsBoolean()==true);
  for(auto key:{"reads","writes"}){const auto &rawSet=field(field(raw,"globals"),key);auto &to=llvm::StringRef(key)=="reads"?out.reads:out.writes;
    if(!need(rawSet.getAsArray()&&items(rawSet).size()<=4096,e,"fixed global set bound differs"))return false;std::string previous;
    for(const auto &value:items(rawSet)){if(!work(p,e))return false;const auto id=string(value);
      if(!need(globals.count(id)&&(llvm::StringRef(key)!="writes"||globals.at(id))&&(previous.empty()||previous<id),e,"fixed GlobalId set differs"))return false;
      previous=id;to.insert(id);}
  }
  const auto count=items(field(fn,"parameters")).size()+(!field(fn,"ownerType").getAsNull());
  if(!need(items(field(raw,"parameters")).size()==count,e,"fixed parameter count differs"))return false;
  for(const auto &param:items(field(raw,"parameters"))){
    if(!work(p,e)||!need(exact(param,{"index","read","write","structural"})&&field(param,"index").getAsInteger()==int64_t(out.parameters.size()),e,"fixed parameter index/shape differs"))return false;
    auto r=field(param,"read").getAsBoolean(),w=field(param,"write").getAsBoolean(),s=field(param,"structural").getAsBoolean();
    if(!need(r&&w&&s,e,"fixed parameter flags must be boolean"))return false;out.parameters.push_back({*r,*w,*s});
  }
  const auto &captures=field(raw,"captures");
  if(!need(bool(captures.getAsArray()),e,"fixed captures must be a sparse array"))return false;
  // Build only for a nonempty capture obligation; unrelated layouts cannot
  // turn every empty function contract into a full slot-directory scan.
  std::map<std::string,bool> slots;std::set<std::string> arrays;
  if(!items(captures).empty())for(const auto &type:items(field(p.hir,"types"))){if(!work(p,e))return false;if(string(field(type,"kind"))=="array")arrays.insert(string(field(type,"id")));}
  if(!items(captures).empty())for(const auto &env:items(field(p.hir,"environments")))for(const auto &slot:items(field(env,"slots"))){
    if(!work(p,e))return false;slots.emplace(string(field(slot,"key")),field(slot,"writable").getAsBoolean()==true||arrays.count(string(field(slot,"type"))));
  }
  std::string previous;
  for(const auto &row:items(captures)){
    if(!work(p,e)||!need(exact(row,{"slot","read","write","structural"}),e,"fixed capture shape differs"))return false;
    const auto id=string(field(row,"slot"));auto r=field(row,"read").getAsBoolean(),w=field(row,"write").getAsBoolean(),s=field(row,"structural").getAsBoolean();
    if(!need(slots.count(id)&&(previous.empty()||previous<id)&&r&&w&&s&&(!*w||slots.at(id)),e,"fixed capture identity, order or permission differs"))return false;
    previous=id;out.captures.emplace(id,Access{*r,*w,*s});
  }
  return true;
}
bool verifyPublication(Program &p,Error &e){
  const auto &pub=p.publication;const auto &contracts=items(field(pub,"contracts")),&functions=items(field(p.hir,"functions"));
  if(!need(exact(pub,{"format","mode","scopeDigest","expectedDigest","contracts"})&&
    same(field(pub,"format"),Object{{"family","tsfg.program-publication-candidate"},{"version",2}})&&
    string(field(pub,"mode"))=="fixed"&&field(pub,"contracts").getAsArray()&&contracts.size()==functions.size(),e,"complete fixed publication required"))return false;
  for(size_t i=0;i<contracts.size();++i){const auto &row=contracts[i],&fn=functions[i];const auto id=string(field(fn,"id"));
    if(!work(p,e)||!need(exact(row,{"functionId","signatureHash","upper","callables","digest"})&&same(field(row,"functionId"),field(fn,"id"))&&same(field(row,"signatureHash"),field(fn,"signatureHash")),e,"fixed contract identity/order differs"))return false;
    Json body=select(row,{"functionId","signatureHash","upper","callables"});Effects upper;
    if(!readEffects(p,field(row,"upper"),fn,upper,e)||!validateCallableBounds(p,fn,field(row,"callables"),e)||
      !need(string(field(row,"digest"))==identity("published-contract",body),e,"fixed contract digest differs"))return false;
    p.fixedEffects.emplace(id,std::move(upper));
  }
  Json stableScope=nullptr;if(!scope(p,stableScope,e))return false;const auto scopeHash=identity("publication-scope",stableScope);
  if(!need(string(field(pub,"scopeDigest"))==scopeHash&&string(field(pub,"expectedDigest"))==identity("publication",Object{{"scopeDigest",scopeHash},{"contracts",field(pub,"contracts")}}),e,"stable scope/fixed table digest differs"))return false;
  for(const auto &fn:functions){Effects effective;const auto id=string(field(fn,"id"));
    if(!deriveEffects(p,fn,p.fixedEffects,effective,e))return false;
    // Actual storage and callee ABI obligations may be wider than a Source
    // assertion's view. They only add requirements to this fixed contract.
    auto physical=p.effects.find(id);if(physical!=p.effects.end()){
      effective.managedReference|=physical->second.managedReference;effective.escape|=physical->second.escape;
    }
    if(!covers(p,p.fixedEffects.at(id),effective,e))return false;p.effects.insert_or_assign(id,std::move(effective));
  }
  for(const auto &m:items(field(p.hir,"modules"))){Effects init;Json fn=Object{{"id",field(m,"initializer")},{"sourcePath",field(m,"sourcePath")},{"returnType","void"},{"parameters",Array{}},{"body",field(m,"initialization")}};
    if(!deriveEffects(p,fn,p.fixedEffects,init,e))return false;}
  return true;
}
} // namespace tsfg::commonProgram
