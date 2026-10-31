// SPDX-License-Identifier: MIT
#include "common-program-actual.h"
#include "common-program-return-origin-scope-v4.h"
#include "llvm/Support/ConvertUTF.h"
namespace tsfg::commonProgram {
namespace V4=CommonReturnOriginV4;
namespace Scope=CommonReturnOriginScopeV4;
namespace Domain=CommonReturnOriginDomainV4;
struct ReturnOriginContracts {
  Scope::ScopeDirectories fixedDirectories,bodyDirectories;
  std::map<std::string,V4::Graph> graphs;
  std::map<std::string,Domain::PublishedEffects> permissions;
  Domain::FixedFunctions fixed;
  V4::FixedContracts graphBounds;
  std::map<std::string,Domain::ActualShape> shapes;
  std::map<std::string,std::map<std::string,std::string>> fieldRoutes;
  std::map<std::string,bool> scalarLocal;
  std::map<std::string,std::set<std::string>> scalarDependencies;
  bool storageReady=false,scalarReady=false;
};
namespace {
bool work(Program &p,Error &e,size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","fixed return-origin metadata work exceeded");}
bool need(bool value,Error &e,llvm::StringRef message){return value||reject(e,"core-ir-common-return-origin",message);}
bool samePaid(Program &p,const Json &a,const Json &b,Error &e){return returnOriginMetadataCost(p,a,e)&&returnOriginMetadataCost(p,b,e)&&same(a,b);}
bool text(Program &p,const Json &v,Error &e){const auto s=v.getAsString();return need(bool(s),e,"fixed archive string required")&&work(p,e,s->size()/8+1);}
std::vector<std::string> children(Program &p,const Json &shape,Error &e){
  std::vector<std::string> out;
  const auto add=[&](const Json &v){if(!text(p,v,e)||!work(p,e))return false;out.push_back(string(v));return true;};
  for(auto key:{"base","elementType"})if(!field(shape,key).getAsNull()&&!add(field(shape,key)))return {};
  for(const auto &v:items(field(shape,"members")))if(!add(v))return {};
  for(const auto &v:items(field(shape,"fields")))if(!add(field(v,"type")))return {};
  for(const auto &method:items(field(shape,"methods"))){for(const auto &v:items(field(method,"parameters")))if(!add(v))return {};if(!add(field(method,"returnType")))return {};}
  for(const auto &v:items(field(field(shape,"construction"),"parameters")))if(!add(v))return {};
  if(string(field(shape,"kind"))=="function"){for(const auto &v:items(field(shape,"parameters")))if(!add(v))return {};if(!add(field(shape,"returnType")))return {};}
  return out;
}
bool sortedShapes(Program &p,const std::map<std::string,const Json *> &byLabel,const std::string &root,Array &out,Error &e){
  std::set<std::string> seen;std::vector<std::string> pending{root};std::vector<std::pair<std::u16string,const Json *>> ordered;
  while(!pending.empty()){
    if(!work(p,e))return false;auto label=std::move(pending.back());pending.pop_back();if(!seen.insert(label).second)continue;
    const auto found=byLabel.find(label);if(!need(found!=byLabel.end(),e,"fixed archive semantic dependency absent"))return false;
    auto nested=children(p,field(*found->second,"shape"),e);if(!e.message.empty())return false;
    if(!work(p,e,nested.size()+label.size()+1))return false;pending.insert(pending.end(),nested.begin(),nested.end());
    std::u16string units(label.size(),0);auto *from=reinterpret_cast<const llvm::UTF8 *>(label.data());auto *to=reinterpret_cast<llvm::UTF16 *>(units.data());auto *start=to;
    if(!need(llvm::ConvertUTF8toUTF16(&from,from+label.size(),&to,to+units.size(),llvm::strictConversion)==llvm::conversionOK,e,"archive label Unicode differs"))return false;
    units.resize(to-start);ordered.emplace_back(std::move(units),found->second);
  }
  size_t rounds=1,bytes=0;for(size_t n=ordered.size();n>1;n=(n+1)/2)++rounds;for(const auto &v:ordered)bytes+=v.first.size();
  if(!work(p,e,ordered.size()+rounds*(bytes/8+1)))return false;std::sort(ordered.begin(),ordered.end(),[](const auto &a,const auto &b){return a.first<b.first;});
  for(const auto &v:ordered){const auto &shape=field(*v.second,"shape");if(!returnOriginMetadataCost(p,shape,e))return false;out.push_back(shape);}return true;
}
V4::TypeKind typeKind(llvm::StringRef kind){
  if(kind=="scalar")return V4::TypeKind::Scalar;if(kind=="string")return V4::TypeKind::String;if(kind=="undefined")return V4::TypeKind::Undefined;
  if(kind=="null")return V4::TypeKind::Null;if(kind=="void")return V4::TypeKind::Void;if(kind=="array")return V4::TypeKind::Array;
  if(kind=="readSpan")return V4::TypeKind::ReadSpan;if(kind=="value")return V4::TypeKind::Value;if(kind=="reference")return V4::TypeKind::Reference;
  if(kind=="function")return V4::TypeKind::Function;if(kind=="union")return V4::TypeKind::Union;if(kind=="unknown")return V4::TypeKind::Unknown;return V4::TypeKind::Future;
}
bool projectScope(Program &p,const Json &raw,Scope::FixedScope &out,Error &e){
  // raw has passed the one archive boundary below; this only copies typed rows.
  if(!returnOriginMetadataCost(p,raw,e))return false;out.profile=string(field(raw,"profile"));
  for(const auto &v:items(field(raw,"types"))){Scope::Type row;row.id=string(field(v,"id"));row.label=string(field(v,"label"));row.shape.kind=typeKind(string(field(field(v,"shape"),"kind")));
    for(const auto &f:items(field(field(v,"shape"),"fields")))row.shape.fields.push_back({string(field(f,"name")),uint64_t(*field(f,"index").getAsInteger())});out.types.push_back(std::move(row));}
  for(const auto &v:items(field(raw,"functions"))){Scope::Function row;row.functionId=string(field(v,"functionId"));const auto kind=string(field(v,"kind"));
    row.kind=kind=="source"?V4::FunctionKind::Source:kind=="method"?V4::FunctionKind::Method:kind=="construction-body"?V4::FunctionKind::ConstructionBody:V4::FunctionKind::Future;
    for(const auto &type:items(field(v,"parameterTypes")))row.parameterTypes.push_back(string(type));row.returnType=string(field(v,"returnType"));
    if(!field(v,"lexicalEnvironment").getAsNull())row.lexicalEnvironment=string(field(v,"lexicalEnvironment"));if(!field(v,"activationEnvironment").getAsNull())row.activationEnvironment=string(field(v,"activationEnvironment"));out.functions.push_back(std::move(row));}
  for(const auto &v:items(field(raw,"globals")))out.globals.push_back({string(field(v,"globalId")),string(field(v,"type"))});
  for(const auto &v:items(field(raw,"environments"))){Scope::Environment row;row.id=string(field(v,"id"));if(!field(v,"parent").getAsNull())row.parent=string(field(v,"parent"));
    for(const auto &slot:items(field(v,"slots")))row.slots.push_back({string(field(slot,"key")),string(field(slot,"type")),field(slot,"writable").getAsBoolean()==true});out.environments.push_back(std::move(row));}
  return true;
}
bool archive(Program &p,const Json &raw,Json &currentScope,Error &e){
  if(!need(exact(raw,{"profile","rootFile","declarationTypes","types","hostImports","hostContext","functions","environments","globals","modules","roots","storage"})&&field(raw,"types").getAsArray()&&field(raw,"declarationTypes").getAsArray(),e,"complete fixed-v3 archive required")||!publicationScope(p,currentScope,e))return false;
  std::map<std::string,const Json *> current,byId,byLabel;std::set<std::string> declared;Array declarationRows;std::string previous;
  for(const auto &v:items(field(p.hir,"types"))){if(!work(p,e))return false;current.emplace(string(field(v,"id")),&v);}
  for(const auto &v:items(field(raw,"declarationTypes"))){if(!text(p,v,e))return false;auto id=string(v);if(!need(previous.empty()||previous<id,e,"archive declaration order differs"))return false;previous=id;declared.insert(std::move(id));}
  previous.clear();
  for(const auto &v:items(field(raw,"types"))){
    if(!work(p,e)||!need(exact(v,{"id","label","shape"})&&field(v,"shape").getAsObject(),e,"archive type row differs")||!text(p,field(v,"id"),e)||!text(p,field(v,"label"),e))return false;
    const auto id=string(field(v,"id")),label=string(field(v,"label"));if(!need((previous.empty()||previous<id)&&byId.emplace(id,&v).second&&byLabel.emplace(label,&v).second,e,"archive type identity/order differs"))return false;previous=id;
    if(declared.count(id)){if(!returnOriginMetadataCost(p,v,e))return false;declarationRows.push_back(v);}auto known=current.find(id);
    if(known!=current.end()&&(!samePaid(p,field(v,"label"),field(*known->second,"semanticLabel"),e)||!samePaid(p,field(v,"shape"),field(*known->second,"semanticShape"),e)))return need(false,e,"archive interpretation differs from current admitted HIR");
  }
  if(!returnOriginMetadataCost(p,raw,e))return false;Json projected=raw;auto &object=*projected.getAsObject();object["types"]=std::move(declarationRows);object.erase("storage");
  if(!samePaid(p,projected,currentScope,e))return need(false,e,"stable declaration projection differs");
  for(const auto &[id,row]:byId){for(const auto &label:children(p,field(*row,"shape"),e))if(!need(byLabel.count(label),e,"archive semantic dependency absent"))return false;if(!e.message.empty())return false;
    if(current.count(id))continue;if(!need(!declared.count(id),e,"new declaration missing from current HIR"))return false;const auto &shape=field(*row,"shape");const auto kind=string(field(shape,"kind"));
    if(!samePaid(p,field(shape,"label"),field(*row,"label"),e))return need(false,e,"archive label differs");std::string expected;
    if(kind=="scalar"){
      if(!need(exact(shape,{"label","kind"}),e,"archived scalar shape differs"))return false;
      for(auto name:{"i8","u8","i16","u16","i32","u32","i64","u64","isize","usize","bool","f32","f64"})if(samePaid(p,field(*row,"label"),Json(canonical(Object{{"kind","scalar"},{"name",name}})),e))expected=digest(std::string("tsfg.type")+std::string(1,'\0')+name);
    }else if(kind=="string"||kind=="unknown"||kind=="undefined"||kind=="null"||kind=="void"){
      if(!need(exact(shape,{"label","kind"}),e,"archived primitive shape differs")||!samePaid(p,field(*row,"label"),Json(canonical(Object{{"kind",kind},{"name",kind}})),e))return need(false,e,"archived primitive label differs");expected=digest(std::string("tsfg.type")+std::string(1,'\0')+kind);
    }else{
      if(!need(kind=="array"||kind=="readSpan"||kind=="function"||kind=="union",e,"archive cannot introduce undeclared nominal storage"))return false;Json label=nullptr;
      if(kind=="function"){
        if(!need(exact(shape,{"label","kind","parameters","returnType"})&&field(shape,"parameters").getAsArray(),e,"archived function shape differs"))return false;
        label=Object{{"kind",kind},{"parameters",field(shape,"parameters")},{"returnType",field(shape,"returnType")}};
      }else if(kind=="union"){
        if(!need(exact(shape,{"label","kind","members"})&&field(shape,"members").getAsArray(),e,"archived union shape differs"))return false;label=Object{{"kind",kind},{"members",field(shape,"members")}};
      }else{
        if(!need(exact(shape,{"label","kind","elementType"}),e,"archived element shape differs"))return false;label=Object{{"kind",kind},{"element",field(shape,"elementType")}};
      }
      if(!returnOriginMetadataCost(p,label,e)||!samePaid(p,field(*row,"label"),Json(canonical(label)),e))return need(false,e,"archived structural label differs");Array graph;
      if(!sortedShapes(p,byLabel,string(field(*row,"label")),graph,e))return false;Json identityBody=Object{{"root",field(*row,"label")},{"graph",std::move(graph)}};
      if(!returnOriginMetadataCost(p,identityBody,e))return false;expected=identity("type",identityBody);
    }
    if(!need(expected==id,e,"archived type semantic identity differs"))return false;
  }
  // No storage-tag certificate is invented from Source type/view inventory.
  const auto &storage=field(raw,"storage");
  if(!need(exact(storage,{"fields","results"})&&field(storage,"fields").getAsArray()&&field(storage,"results").getAsArray(),e,"fixed storage table shape differs"))return false;
  const auto &fieldRows=items(field(storage,"fields")),&resultRows=items(field(storage,"results"));
  if(fieldRows.empty()&&resultRows.empty())return true;
  std::map<std::string,const Json *> fields;std::set<std::string> pairs;
  for(const auto &[id,type]:current){for(const auto &fieldRow:items(field(*type,"fields"))){if(!work(p,e))return false;fields.emplace(string(field(fieldRow,"id")),&fieldRow);}
    const auto kind=string(field(*type,"kind"));if(kind!="value"&&kind!="reference")continue;auto owner=type;std::set<std::string> seen;
    for(;;){const auto ownerId=string(field(*owner,"id"));if(!work(p,e,ownerId.size()/8+1)||!need(seen.insert(ownerId).second&&!field(*owner,"construction").getAsNull(),e,"fixed storage construction ancestry differs"))return false;
      const auto construction=string(field(field(*owner,"construction"),"id"));if(!work(p,e,(construction.size()+id.size())/8+1))return false;pairs.insert(construction+"/"+id);
      if(field(*owner,"base").getAsNull())break;const auto parent=current.find(string(field(*owner,"base")));if(!need(parent!=current.end(),e,"fixed storage base is unowned"))return false;owner=parent->second;
    }
  }
  if(!need(fieldRows.size()==fields.size()&&resultRows.size()==pairs.size(),e,"fixed storage catalogue coverage differs"))return false;
  previous.clear();
  for(const auto &row:fieldRows){if(!returnOriginMetadataCost(p,row,e)||!need(exact(row,{"fieldId","actualTypes","unknown"})&&field(row,"fieldId").getAsString()&&field(row,"actualTypes").getAsArray()&&field(row,"unknown").getAsBoolean(),e,"fixed scalar storage row differs"))return false;
    const auto id=string(field(row,"fieldId"));const auto found=fields.find(id);if(!need(found!=fields.end()&&(previous.empty()||previous<id),e,"fixed storage field identity/order differs"))return false;previous=id;
    const auto &actual=items(field(row,"actualTypes"));
    if(field(row,"unknown").getAsBoolean()==true){if(!need(actual.empty(),e,"unresolved fixed field storage must be explicit TOP"))return false;continue;}
    const auto type=string(field(*found->second,"type"));const auto known=current.find(type);if(!need(actual.size()==1&&actual[0].getAsString()&&known!=current.end()&&string(field(*known->second,"kind"))=="scalar"&&string(actual[0])==type&&byId.count(type),e,"fixed storage is not complete scalar field capacity"))return false;
  }
  previous.clear();
  for(const auto &row:resultRows){if(!returnOriginMetadataCost(p,row,e)||!need(exact(row,{"construction","newTarget","actualTypes","unknown"})&&field(row,"construction").getAsString()&&field(row,"newTarget").getAsString()&&field(row,"actualTypes").getAsArray()&&field(row,"unknown").getAsBoolean(),e,"fixed construction storage row differs"))return false;
    const auto target=string(field(row,"newTarget")),key=string(field(row,"construction"))+"/"+target;const auto &actual=items(field(row,"actualTypes"));
    if(!need(pairs.count(key)&&(previous.empty()||previous<key)&&byId.count(target)&&(field(row,"unknown").getAsBoolean()==true?actual.empty():actual.size()==1&&actual[0].getAsString()&&string(actual[0])==target),e,"fixed construction storage identity/order differs"))return false;previous=key;
  }
  return true;
}
Domain::PublishedEffects permission(const Effects &effect){
  Domain::PublishedEffects out;for(const auto &v:effect.parameters)out.parameters.push_back({v.read,v.write,v.structural});for(const auto &[slot,v]:effect.captures)out.captures.push_back({slot,{v.read,v.write,v.structural}});
  out.globals.reads.assign(effect.reads.begin(),effect.reads.end());out.globals.writes.assign(effect.writes.begin(),effect.writes.end());out.hostResources.reads.assign(effect.hostReads.begin(),effect.hostReads.end());out.hostResources.writes.assign(effect.hostWrites.begin(),effect.hostWrites.end());
  for(const auto &v:std::initializer_list<std::pair<const char *,bool>>{{"allocation",effect.allocation},{"managedReference",effect.managedReference},{"ehControl",effect.ehControl},{"mayThrow",effect.mayThrow},{"await",effect.await},{"lock",effect.lock},{"escape",effect.escape},{"unknownHost",effect.unknownHost}})if(v.second)out.facets.push_back(v.first);return out;
}
}
bool returnOriginMetadataCost(Program &p,const Json &value,Error &e){
  std::vector<const Json *> pending{&value};while(!pending.empty()){
    if(!work(p,e))return false;const auto *row=pending.back();pending.pop_back();
    if(auto s=row->getAsString()){if(!work(p,e,s->size()/8+1))return false;}
    else if(auto rows=row->getAsArray()){if(!work(p,e,rows->size()))return false;for(const auto &v:*rows)pending.push_back(&v);}
    else if(auto rows=row->getAsObject()){for(const auto &v:*rows){if(!work(p,e,llvm::StringRef(v.first).size()/8+2))return false;pending.push_back(&v.second);}}
  }return true;
}
bool prepareReturnOriginContracts(Program &p,Error &e){
  const auto &scope=field(p.publication,"scope");Json current=nullptr;if(!archive(p,scope,current,e))return false;
  const auto charge=[&](size_t n){return work(p,e,n);};Scope::FixedScope fixed,body;
  if(!projectScope(p,scope,fixed,e))return false;
  // Current body-local tags are interpreted only for current body graphs.
  Array bodyTypes;for(const auto &type:items(field(p.hir,"types"))){if(!returnOriginMetadataCost(p,type,e))return false;bodyTypes.push_back(Object{{"id",field(type,"id")},{"label",field(type,"semanticLabel")},{"shape",field(type,"semanticShape")}});}
  (*current.getAsObject())["types"]=std::move(bodyTypes);if(!projectScope(p,current,body,e))return false;
  const auto fieldId=[](llvm::StringRef owner,llvm::StringRef name,uint64_t index){return identity("field",Object{{"owner",owner},{"name",name},{"index",index}});};
  auto admitted=Scope::build(fixed,fieldId,charge),currentDirectories=Scope::build(body,fieldId,charge);
  if(!need(admitted.status==Scope::BuildStatus::Ready&&currentDirectories.status==Scope::BuildStatus::Ready,e,"fixed/body interpretation directory is unavailable"))return false;
  auto state=std::make_shared<ReturnOriginContracts>();state->fixedDirectories=std::move(admitted.directories);state->bodyDirectories=std::move(currentDirectories.directories);
  for(const auto &type:fixed.types){if(!work(p,e,type.id.size()/8+2))return false;Domain::ActualShape shape;shape.kind=type.shape.kind;state->shapes.emplace(type.id,std::move(shape));}
  for(const auto &type:body.types){if(!work(p,e,type.id.size()/8+2))return false;Domain::ActualShape shape;shape.kind=type.shape.kind;state->shapes.insert_or_assign(type.id,std::move(shape));}
  for(const auto &row:items(field(p.publication,"contracts"))){const auto id=string(field(row,"functionId"));const auto &raw=field(row,"returnOrigins");if(!work(p,e,id.size()/8+2))return false;
    if(!raw.getAsNull()){
      auto parsed=state->fixedDirectories.read(id,raw,charge);if(!need(parsed.status==V4::ReadStatus::Typed,e,parsed.reason?parsed.reason:"fixed return graph rejected"))return false;
      state->graphs.emplace(id,std::move(parsed.graph));
    }
    // Permission and protocol come from this same fully identity-checked group.
    const auto &upper=p.fixedEffects.at(id);if(!work(p,e,upper.parameters.size()+upper.captures.size()+upper.reads.size()+upper.writes.size()+upper.hostReads.size()+upper.hostWrites.size()+12))return false;
    state->permissions.emplace(id,permission(upper));auto protocol=state->fixedDirectories.protocol(id,charge);if(!need(protocol.status==Scope::BuildStatus::Ready,e,"fixed member protocol rejected"))return false;
    const auto graph=state->graphs.find(id);const auto *pointer=graph==state->graphs.end()?nullptr:&graph->second;
    state->fixed.emplace(id,Domain::FixedFunction{pointer,&state->permissions.at(id),std::move(protocol.protocol)});if(pointer)state->graphBounds.emplace(id,pointer);
  }
  p.returnOriginContracts=std::move(state);return true;
}
bool prepareReturnOriginStorage(ActualCheck &check){
  auto &p=check.p;auto &e=check.e;if(!need(bool(p.returnOriginContracts),e,"storage requires the admitted fixed group"))return false;
  auto &saved=*p.returnOriginContracts;if(!work(p,e,saved.fieldRoutes.size()+1))return false;saved.storageReady=false;saved.fieldRoutes.clear();
  const auto &payload=field(field(p.hir,"snapshot"),"payload");
  if(!work(p,e,items(field(payload,"compatibilityWitnesses")).size()+items(field(payload,"entryCompatibilityRoots")).size()+1))return false;
  if(!items(field(payload,"compatibilityWitnesses")).empty())return true;
  for(const auto &entry:items(field(payload,"entryCompatibilityRoots")))for(const auto &root:items(field(entry,"roots"))){
    if(!returnOriginMetadataCost(p,root,e))return false;if(!same(field(root,"sourceType"),field(root,"targetType")))return true;
  }
  if(!items(field(p.hir,"hostImports")).empty())return true;
  std::map<std::string,const Json *> types,bindings;std::vector<const Json *> nominal;std::map<std::string,bool> bodyIdentity;
  for(const auto &type:items(field(p.hir,"types"))){if(!work(p,e))return false;types.emplace(string(field(type,"id")),&type);}
  for(const auto &binding:items(field(p.representation,"bindings"))){if(!returnOriginMetadataCost(p,binding,e))return false;bindings.emplace(string(field(binding,"id")),&binding);}
  const auto &fixedStorage=field(field(p.publication,"scope"),"storage");
  for(const auto &[id,type]:types){const auto kind=string(field(*type,"kind"));if(!work(p,e,id.size()/8+1))return false;if(kind!="reference"&&kind!="value")continue;
    const auto &ctor=field(*type,"construction");
    if(!field(*type,"base").getAsNull()||ctor.getAsNull()||string(field(ctor,"kind"))!="implicit-base"||!field(ctor,"functionId").getAsNull()||!field(ctor,"implicitForward").getAsNull())return true;
    const auto &fields=items(field(*type,"fields")),&initializers=items(field(ctor,"initializationFields"));if(!work(p,e,fields.size()+initializers.size()+1))return false;
    bool closed=fields.size()==initializers.size();std::set<std::string> names;
    for(size_t i=0;i<fields.size();++i){const auto &row=fields[i];const auto name=string(field(row,"name"));if(!work(p,e,name.size()/8+2))return false;
      if(!names.insert(name).second||i>=initializers.size()||!same(field(row,"id"),initializers[i]))closed=false;
    }
    if(!work(p,e,2))return false;nominal.push_back(type);bodyIdentity.emplace(id,closed);
  }
  if(!nominal.empty()&&items(field(fixedStorage,"fields")).empty()&&items(field(fixedStorage,"results")).empty())return true;
  std::map<std::string,const Json *> fieldBounds,resultBounds;
  for(const auto &row:items(field(fixedStorage,"fields"))){if(!returnOriginMetadataCost(p,row,e))return false;fieldBounds.emplace(string(field(row,"fieldId")),&row);}
  for(const auto &row:items(field(fixedStorage,"results"))){if(!returnOriginMetadataCost(p,row,e))return false;resultBounds.emplace(string(field(row,"construction"))+"/"+string(field(row,"newTarget")),&row);}
  struct Primitive {uint32_t width,code;};
  static const std::map<std::string,Primitive> primitives={{"i32",{4,1}},{"bool",{1,2}},{"i8",{1,3}},{"i16",{2,4}},{"i64",{8,5}},{"u8",{1,6}},{"u16",{2,7}},{"u32",{4,8}},{"u64",{8,9}},{"isize",{8,10}},{"usize",{8,11}},{"f32",{4,12}},{"f64",{8,13}}};
  std::map<std::string,Domain::ActualShape> shapes;std::map<std::string,std::map<std::string,std::string>> routes;std::set<std::string> fieldIds,resultIds;
  for(const auto *type:nominal){const auto id=string(field(*type,"id")),kind=string(field(*type,"kind"));Domain::ActualShape shape;shape.kind=typeKind(kind);shape.completePhysicalFields=kind=="value";
    const bool identityClosed=bodyIdentity.at(id);bool closed=identityClosed;
    uint32_t bytes=0,alignment=1;std::vector<uint32_t> offsets;std::map<std::string,std::string> addresses;
    for(const auto &row:items(field(*type,"fields"))){const auto fieldId=string(field(row,"id")),raw=string(field(row,"sourceBinding")),typeId=string(field(row,"type"));
      if(!work(p,e,(id.size()+fieldId.size()+raw.size()+typeId.size())/8+7))return false;fieldIds.insert(fieldId);
      const auto bound=fieldBounds.find(fieldId);if(!need(bound!=fieldBounds.end(),e,"actual tuple field lacks its complete fixed role"))return false;
      const auto binding=bindings.find(raw);const auto capacity=check.storageCapacity.find(raw);const auto child=types.find(typeId);
      const auto &initializer=field(row,"initializer");const auto initialKind=string(field(initializer,"kind"));
      const auto primitive=primitives.find(child==types.end()?std::string{}:string(field(*child->second,"name")));const auto layout=p.layouts.find(typeId);
      const bool known=identityClosed&&child!=types.end()&&string(field(*child->second,"kind"))=="scalar"&&!initializer.getAsNull()&&(initialKind=="numericLiteral"||initialKind=="booleanLiteral")&&same(field(initializer,"type"),field(row,"type"))&&binding!=bindings.end()&&string(field(*binding->second,"carrier"))==typeId&&capacity!=check.storageCapacity.end()&&!capacity->second.unknown&&!capacity->second.callableTop&&!capacity->second.hasEnvironment&&capacity->second.tags.size()==1&&capacity->second.tags.count(typeId)&&primitive!=primitives.end()&&layout!=p.layouts.end();
      const bool unresolved=field(*bound->second,"unknown").getAsBoolean()==true;
      if(!unresolved&&!need(known&&string(items(field(*bound->second,"actualTypes"))[0])==typeId,e,"actual field capacity exceeds its fixed complete scalar upper"))return false;
      // A fixed unresolved row remains TOP even when this body is narrower.
      // Failure of one field closes only its own nominal body's authority.
      if(!known||unresolved){closed=false;continue;}
      const auto width=primitive->second.width;const auto &physical=layout->second;
      if(!need(physical.byteSize==width&&physical.alignment==width&&physical.referenceCount==0,e,"verified primitive layout differs from the scalar tuple plan"))return false;
      bytes=(bytes+width-1)/width*width;const auto offset=bytes;bytes+=width;alignment=std::max(alignment,width);
      if(!work(p,e,(id.size()+fieldId.size())/8+64))return false;offsets.push_back(offset);
      addresses.emplace(fieldId,"private4-tuple:"+id+":"+std::to_string(offset)+":"+fieldId);
      if(kind=="value")shape.fields.push_back({fieldId,id});
    }
    bytes=(bytes+alignment-1)/alignment*alignment;
    if(closed){const auto &directory=kind=="value"?p.layouts:p.referenceBodyLayouts;const auto tuple=directory.find(id);
      if(!need(tuple!=directory.end()&&tuple->second.byteSize==bytes&&tuple->second.alignment==alignment&&tuple->second.referenceCount==0&&tuple->second.fieldOffsets==offsets,e,"complete verified tuple does not match its primitive slot plan"))return false;}
    const auto construction=string(field(field(*type,"construction"),"id"));if(!work(p,e,(construction.size()+id.size())/8+3))return false;
    const auto key=construction+"/"+id;resultIds.insert(key);const auto result=check.constructionCapacity.find(key);const auto bound=resultBounds.find(key);
    if(!need(bound!=resultBounds.end(),e,"actual tuple result lacks its complete fixed role"))return false;
    const bool known=result!=check.constructionCapacity.end()&&!result->second.unknown&&!result->second.callableTop&&!result->second.hasEnvironment&&result->second.tags.size()==1&&result->second.tags.count(id);
    const bool unresolved=field(*bound->second,"unknown").getAsBoolean()==true;
    if(!unresolved&&!need(known&&string(items(field(*bound->second,"actualTypes"))[0])==id,e,"actual construction result exceeds its fixed complete nominal upper"))return false;
    if(!known||unresolved)closed=false;
    if(closed){if(!work(p,e,2))return false;shapes.emplace(id,std::move(shape));routes.emplace(id,std::move(addresses));}
  }
  // Every admitted role remains present, including TOP rows for open bodies.
  // Only independently complete bodies publish copy and physical field routes.
  const auto &fields=items(field(fixedStorage,"fields")),&results=items(field(fixedStorage,"results"));
  if(!need(fields.size()==fieldIds.size()&&results.size()==resultIds.size(),e,"actual nominal tuple catalogue differs from fixed coverage"))return false;
  for(const auto &row:fields)if(!work(p,e)||!need(fieldIds.count(string(field(row,"fieldId"))),e,"actual tuple field has a different fixed identity"))return false;
  for(const auto &row:results){const auto construction=field(row,"construction").getAsString(),newTarget=field(row,"newTarget").getAsString();if(!work(p,e,(construction->size()+1+newTarget->size())/8+1))return false;const auto key=construction->str()+"/"+newTarget->str();if(!need(resultIds.count(key),e,"actual tuple result has a different fixed identity"))return false;}
  for(auto &[id,shape]:shapes){if(!work(p,e,id.size()/8+shape.fields.size()+1))return false;saved.shapes.insert_or_assign(id,std::move(shape));}
  saved.fieldRoutes=std::move(routes);saved.storageReady=true;return true;
}

bool finishReturnOriginProofs(Program &p,Error &e){
  auto &state=*p.returnOriginContracts;bool changed;
  do{changed=false;for(const auto &[id,graph]:state.graphs){
    if(!work(p,e,id.size()/8+1))return false;if(p.returnOriginPending.count(id))continue;
    for(const auto &call:graph.calls){if(!work(p,e,call.functionId.size()/8+1))return false;
      if(!p.returnOriginVerified.count(call.functionId)||p.returnOriginPending.count(call.functionId)){
        p.returnOriginPending.insert(id);p.returnOriginVerified.erase(id);changed=true;break;
      }
    }
  }}while(changed);return e.message.empty();
}
bool fixedReturnOriginAvailable(const Program &p,const std::string &id){return p.returnOriginContracts&&p.returnOriginVerified.count(id)&&!p.returnOriginPending.count(id);}
bool scalarReturnOriginProof(Program &p,const std::string &root,Error &e){
  if(!need(bool(p.returnOriginContracts),e,"scalar proof requires the admitted fixed group"))return false;
  auto &state=*p.returnOriginContracts;
  if(!state.scalarReady){
    std::map<std::string,const Json *> types,functions;
    for(const auto &type:items(field(p.hir,"types"))){const auto &id=field(type,"id");if(!text(p,id,e))return false;types.emplace(string(id),&type);}
    for(const auto &fn:items(field(p.hir,"functions"))){const auto &id=field(fn,"id");if(!text(p,id,e))return false;functions.emplace(string(id),&fn);}
    for(const auto &[id,source]:functions){const auto &fn=*source;
      if(!returnOriginMetadataCost(p,fn,e))return false;
      bool scalar=string(field(fn,"kind"))=="source"&&field(fn,"ownerType").getAsNull()&&field(fn,"lexicalEnvironment").getAsNull()&&field(fn,"activationEnvironment").getAsNull()&&items(field(fn,"captures")).empty();
      const auto view=[&](const Json &value){
        const auto type=string(value);if(!work(p,e,type.size()/8+1))return false;if(type=="void")return true;
        const auto found=types.find(type);if(!need(found!=types.end(),e,"scalar Source view is not owned"))return false;
        const auto kind=string(field(*found->second,"kind"));return kind=="scalar"||kind=="void"||kind=="null"||kind=="undefined";
      };
      if(scalar)scalar=view(field(fn,"returnType"));
      for(const auto &row:items(field(fn,"parameters"))){if(!work(p,e))return false;if(scalar)scalar=view(field(row,"type"));}
      for(const auto &row:items(field(fn,"bindings"))){if(!work(p,e))return false;if(scalar)scalar=view(field(row,"type"));}
      std::set<std::string> targets;std::vector<const Json *> pending{&field(fn,"body")};
      // Once a member is not scalar-local, every closure reaching it fails;
      // its remaining data/source paths cannot confer this exception.
      while(scalar&&!pending.empty()){
        if(!work(p,e))return false;const auto *row=pending.back();pending.pop_back();
        if(const auto *array=row->getAsArray()){if(!work(p,e,array->size()))return false;for(const auto &child:*array)pending.push_back(&child);continue;}
        const auto *object=row->getAsObject();if(!object)continue;
        if(field(*row,"type").getAsString())scalar=view(field(*row,"type"));if(!scalar)break;
        const auto kind=string(field(*row,"kind"));
        if(kind=="new"||kind=="superConstruct"||kind=="hostCall"||kind=="functionReference"||kind=="indirectCall"||kind=="globalReference"||kind=="globalTarget"){scalar=false;break;}
        if(kind=="call"){
          const auto target=string(field(*row,"callee"));if(!work(p,e,target.size()/8+2))return false;
          if(target!="intrinsic:readSpan"){
            const auto found=functions.find(target);if(!need(found!=functions.end(),e,"scalar call target is not owned"))return false;
            // A method necessarily has an owner/receiver view, outside the
            // same scalarLocal premise regardless of its dispatch arm.
            if(string(field(*found->second,"kind"))=="method"){scalar=false;break;}
            targets.insert(target);
          }
        }
        for(const auto &entry:*object){if(!work(p,e,llvm::StringRef(entry.first).size()/8+1))return false;
          if(entry.second.getAsObject()||entry.second.getAsArray())pending.push_back(&entry.second);}
      }
      if(!e.message.empty())return false;
      const auto graph=state.graphs.find(id);if(graph!=state.graphs.end())for(const auto &call:graph->second.calls){if(!work(p,e,call.functionId.size()/8+2))return false;targets.insert(call.functionId);}
      if(!work(p,e,id.size()/8+2))return false;state.scalarLocal.emplace(id,scalar);state.scalarDependencies.emplace(id,std::move(targets));
    }
    state.scalarReady=true;
  }
  std::set<std::string> seen;std::vector<std::string> pending{root};
  while(!pending.empty()){
    if(!work(p,e))return false;auto id=std::move(pending.back());pending.pop_back();if(!work(p,e,id.size()/8+2))return false;if(!seen.insert(id).second)continue;
    const auto local=state.scalarLocal.find(id);
    if(!need(local!=state.scalarLocal.end()&&p.fixedEffects.count(id),e,"scalar fixed member is not admitted"))return false;
    if(!local->second)return false;
    // Missing graph data may be irrelevant to a scalar closure. Supplied
    // contracts are not optional: every such member must have completed its
    // real body coverage and dependency proof, regardless of function order.
    if(!work(p,e,id.size()/8+1))return false;
    if(state.graphs.count(id)&&!fixedReturnOriginAvailable(p,id))return false;
    const auto &upper=p.fixedEffects.at(id);
    if(!work(p,e,upper.parameters.size()+upper.captures.size()+12))return false;
    if(!upper.reads.empty()||!upper.writes.empty()||!upper.hostReads.empty()||!upper.hostWrites.empty()||upper.managedReference||upper.escape||upper.unknownHost||upper.mayThrow)return false;
    for(const auto &access:upper.parameters)if(access.read||access.write||access.structural)return false;
    for(const auto &[slot,access]:upper.captures)if(access.read||access.write||access.structural)return false;
    for(const auto &target:state.scalarDependencies.at(id)){if(!work(p,e,target.size()/8+2))return false;pending.push_back(target);}
  }
  return true;
}
bool deriveFixedReturnEffects(Program &p,const Json &fn,Effects &out,Error &e,EffectDiagnostics *diagnostics){
  if(!need(bool(p.returnOriginContracts),e,"fixed return group is not admitted"))return false;auto &state=*p.returnOriginContracts;const auto id=string(field(fn,"id"));auto bound=state.graphs.find(id);
  if(bound==state.graphs.end()){p.returnOriginPending.insert(id);return true;}
  // The physical capability belongs to each complete actual Value body, not
  // to the mere presence of a partial program-wide storage projection. Match
  // the Source availability premise for signature, capture and body views.
  if(!work(p,e,3))return false;
  std::vector<const Json *> views{&field(fn,"returnType")},pending{&field(fn,"body")};
  if(!field(fn,"ownerType").getAsNull()){if(!work(p,e))return false;views.push_back(&field(fn,"ownerType"));}
  for(const auto name:{"parameters","bindings"})for(const auto &row:items(field(fn,name))){if(!work(p,e,2))return false;views.push_back(&field(row,"type"));}
  std::set<std::string> captured;
  for(const auto &row:items(field(fn,"captures"))){if(!returnOriginMetadataCost(p,row,e)||!work(p,e))return false;captured.insert(string(field(row,"binding")));}
  if(!captured.empty())for(const auto &layout:items(field(p.hir,"environments")))for(const auto &slot:items(field(layout,"slots"))){
    if(!text(p,field(slot,"binding"),e)||!work(p,e,2))return false;const auto binding=string(field(slot,"binding"));
    if(captured.count(binding)){if(!work(p,e))return false;views.push_back(&field(slot,"type"));}
  }
  while(!pending.empty()){
    if(!work(p,e))return false;const auto *row=pending.back();pending.pop_back();
    if(const auto *array=row->getAsArray()){if(!work(p,e,array->size()))return false;for(const auto &child:*array)pending.push_back(&child);continue;}
    if(const auto *object=row->getAsObject()){
      if(const auto *type=object->get("type");type&&type->getAsString()){if(!work(p,e))return false;views.push_back(type);}
      for(const auto &entry:*object){if(!work(p,e,llvm::StringRef(entry.first).size()/8+1))return false;
        if(entry.second.getAsObject()||entry.second.getAsArray()){if(!work(p,e))return false;pending.push_back(&entry.second);}}
    }
  }
  for(const auto *view:views){if(!text(p,*view,e)||!work(p,e,2))return false;const auto type=string(*view);if(type=="void")continue;
    const auto found=state.shapes.find(type);if(!need(found!=state.shapes.end(),e,"Source view is outside the admitted type directory"))return false;
    const auto &shape=found->second;if(shape.kind==V4::TypeKind::Unknown||shape.kind==V4::TypeKind::Union||(shape.kind==V4::TypeKind::Value&&!shape.completePhysicalFields)){
      if(!work(p,e))return false;p.returnOriginPending.insert(id);return true;}
  }
  Json raw=nullptr;std::vector<ReturnOriginAccessWitness> witnesses;
  if(!deriveReturnOriginBody(p,fn,raw,out,e,diagnostics,diagnostics?&witnesses:nullptr)){
    if(e.code!="core-ir-common-return-origin-open")return false;p.returnOriginPending.insert(id);e=Error{};return true;
  }
  const auto charge=[&](size_t n){return work(p,e,n);};auto parsed=state.bodyDirectories.read(id,raw,charge);
  if(!need(parsed.status==V4::ReadStatus::Typed,e,parsed.reason?parsed.reason:"current body graph rejected"))return false;
  // Data completion reachability cannot narrow the full fixed mayThrow
  // permission. Until that independent potential is routed through Source
  // catch/finally, even a data graph with no language edge grants no proof.
  // This intentionally also leaves caught potential throws pending.
  for(const auto &call:parsed.graph.calls){
    if(!work(p,e,call.functionId.size()/8+2))return false;const auto upper=p.fixedEffects.find(call.functionId);
    if(!need(upper!=p.fixedEffects.end(),e,"body call lacks complete fixed throw permission"))return false;
    if(upper->second.mayThrow){p.returnOriginPending.insert(id);return true;}
  }
  const auto included=V4::covered(parsed.graph,bound->second,state.graphBounds,charge);
  if(included.status==V4::InclusionStatus::BudgetError)return false;
  if(included.status!=V4::InclusionStatus::Covered){p.returnOriginPending.insert(id);return true;}
  auto protocol=state.bodyDirectories.protocol(id,charge);if(!need(protocol.status==Scope::BuildStatus::Ready,e,"body protocol unavailable"))return false;
  Domain::Callbacks callbacks;callbacks.rootProtocol=std::move(protocol.protocol);callbacks.environments=&state.fixedDirectories.interpretation().environments;
  callbacks.actualType=[&](llvm::StringRef type,const V4::Charge &paid)->const Domain::ActualShape *{
    V4::Detail::Meter meter(paid);std::string key;if(!meter.lookup(state.shapes.size(),type.size())||!meter.copy(key,type))return nullptr;const auto found=state.shapes.find(key);if(found==state.shapes.end()||(found->second.kind==V4::TypeKind::Value&&!found->second.completePhysicalFields))return nullptr;return &found->second;
  };
  // Source local roots carry independently admitted actual allocation tags.
  // Source casts preserve that root. Only two known different local tags are
  // disjoint; formal/entry/global/capture/unknown sources still may alias.
  callbacks.mayAlias=[](const Domain::LocationView &left,const Domain::LocationView &right,const V4::Charge &paid){
    V4::Detail::Meter meter(paid);if(!meter.spend(5))return true;
    if(left.kind!=Domain::LocationKind::Local||right.kind!=Domain::LocationKind::Local||!left.type||!right.type)return true;
    if(!meter.text(left.type->size())||!meter.text(right.type->size()))return true;
    return *left.type==*right.type;
  };
  bool routeOpen=false;
  if(state.storageReady)callbacks.projectField=[&](llvm::StringRef actual,llvm::StringRef view,llvm::StringRef selector,const V4::Charge &paid)->std::optional<llvm::StringRef>{
    V4::Detail::Meter meter(paid);if(!meter.text(actual.size())||!meter.text(view.size())||!meter.text(selector.size())||!meter.spend(4))return std::nullopt;
    if(actual==view&&selector.starts_with("field:")){
      if(!meter.lookup(state.fieldRoutes.size(),actual.size()))return std::nullopt;const auto found=state.fieldRoutes.find(actual.str());
      if(found!=state.fieldRoutes.end()){
        const auto field=selector.drop_front(6);if(!meter.lookup(found->second.size(),field.size()))return std::nullopt;const auto route=found->second.find(field.str());
        if(route!=found->second.end())return llvm::StringRef(route->second);
      }
    }
    routeOpen=true;return std::nullopt;
  };
  auto result=Domain::solve(parsed.graph,state.fixed,callbacks,charge);
  if(routeOpen){p.returnOriginPending.insert(id);return e.message.empty();}
  if(result.status==Domain::Status::BudgetError)return false;if(result.status!=Domain::Status::Solved){p.returnOriginPending.insert(id);return true;}
  const auto mark=[&](const std::string &owner,unsigned flag,const Json *origin){
    if(!work(p,e,owner.size()/8+1))return false;const auto selected=llvm::StringRef(owner);
    if(selected.starts_with("unknown:")){p.returnOriginPending.insert(id);return true;}
    if(selected.starts_with("g:")){(flag?out.writes:out.reads).insert(owner.substr(2));}
    else if(selected.starts_with("h:")){(flag?out.hostWrites:out.hostReads).insert(owner.substr(2));}
    else if(selected.starts_with("c:")){auto &v=out.captures[owner.substr(2)];if(flag==0)v.read=true;else if(flag==1)v.write=true;else v.structural=true;}
    else if(selected.starts_with("p:")){size_t index=0;if(!need(!selected.drop_front(2).getAsInteger(10,index)&&index<out.parameters.size(),e,"derived owner index differs"))return false;auto &v=out.parameters[index];if(flag==0)v.read=true;else if(flag==1)v.write=true;else v.structural=true;}
    if(diagnostics&&origin&&(selected.starts_with("g:")||selected.starts_with("h:")||selected.starts_with("c:"))){
      Json reason=selected.starts_with("c:")?Json(Object{{"kind","capture"},{"slot",owner.substr(2)},{"access",flag==0?"read":flag==1?"write":"structural"}}):Json(Object{{"kind",selected.starts_with("h:")?"host-resource":"global"},{"resource",owner.substr(2)},{"access",flag?"write":"read"}});
      if(!returnOriginMetadataCost(p,reason,e)||!returnOriginMetadataCost(p,*origin,e))return false;diagnostics->local.try_emplace(canonical(reason),*origin);
    }return true;
  };
  for(unsigned flag=0;flag<3;++flag)for(const auto &owner:result.summary.effects[flag])if(!mark(owner,flag,nullptr))return false;
  for(const auto &witness:witnesses)for(auto ref:witness.values){if(!need(ref<result.summary.owners.size(),e,"access witness lacks body node"))return false;for(const auto &owner:result.summary.owners[ref])if(!mark(owner,witness.flag,&witness.origin))return false;}
  for(const auto &target:result.summary.calls){if(!work(p,e,target.size()/8+1))return false;out.calls.insert(target);}
  for(const auto &facet:result.summary.facets){if(!work(p,e,facet.size()/8+1))return false;
    if(facet=="allocation")out.allocation=true;else if(facet=="managedReference")out.managedReference=true;else if(facet=="ehControl")out.ehControl=true;else if(facet=="await")out.await=true;else if(facet=="lock")out.lock=true;else if(facet=="escape")out.escape=true;else if(facet=="unknownHost")out.unknownHost=true;
  }
  out.mayThrow=result.summary.language;
  const auto returned=state.shapes.find(string(field(fn,"returnType")));
  if(returned!=state.shapes.end()&&returned->second.kind==V4::TypeKind::Function)for(auto ref:parsed.graph.normal)if(ref<result.summary.holdsEnvironment.size()&&(result.summary.holdsEnvironment[ref]||!result.summary.owners[ref].empty()))out.managedReference=out.escape=true;
  if(!p.returnOriginPending.count(id))p.returnOriginVerified.insert(id);return e.message.empty();
}
} // namespace tsfg::commonProgram
