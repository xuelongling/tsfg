// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "common-program-methods.h"
#include <algorithm>
#include <optional>
#include <limits>
#include <tuple>

namespace tsfg::commonProgram {
namespace {
using Ref=size_t;
using Refs=std::set<Ref>;
using Environment=std::map<std::string,Refs>;
struct State {Ref heap=0,control=0;};
enum Completion:unsigned {Normal=1,Returned=2,Thrown=4};

// This is the Source producer of the same ordinary equations consumed by the
// V4 reader/domain, not an evaluator and not a table of callee permissions.
// Calls retain both continuations; the fixed-domain consumer determines live
// normal/language control from its immutable admitted contract archive.
struct ReturnSource {
  Program &p;const Json &fn;Effects &direct;Error &error;EffectDiagnostics *diagnostics;std::vector<ReturnOriginAccessWitness> *witnesses;
  ReturnSource(Program &program,const Json &function,Effects &effects,Error &failure,EffectDiagnostics *diagnosticOutput,std::vector<ReturnOriginAccessWitness> *accessOutput):
    p(program),fn(function),direct(effects),error(failure),diagnostics(diagnosticOutput),witnesses(accessOutput){}
  Array nodes,heaps,controls,calls;
  std::map<std::string,Ref> interned,valuePhis,heapPhis,controlPhis;
  std::map<std::string,Json> accesses;
  State state;
  std::map<std::string,const Json *> types,functions,globals,layouts,bindings;
  struct Slot {std::string key,type,layout;};
  std::map<std::string,Slot> slots;
  std::map<std::string,Refs> environmentRefs;
  std::map<std::string,bool> references;
  std::set<std::string> activeTypes,foreignCaptures;
  std::vector<std::pair<std::string,std::string>> parameters;
  std::string functionId,lexical,activation;
  bool good()const{return error.message.empty();}
  bool step(size_t n=1){return good()&&(p.charge(n)||reject(error,"core-ir-common-budget","Source return-origin equations exceeded shared work"));}
  bool open(llvm::StringRef why){return reject(error,"core-ir-common-return-origin-open",why);}
  bool need(bool value,llvm::StringRef why){return value||reject(error,"core-ir-common-return-origin-source",why);}
  bool text(llvm::StringRef value){return step(value.size()/8+1);}
  bool metadata(const Json &value){
    return returnOriginMetadataCost(p,value,error);
  }
  bool declarationMetadata(const Json &row){
    for(const auto &entry:*row.getAsObject()){
      if(!step()||!text(entry.first))return false;
      if(entry.first!="body"&&entry.first!="parameterInitialization"&&!metadata(entry.second))return false;
    }
    return good();
  }
  std::string encoded(const Json &value){if(!metadata(value))return {};return canonical(value);}
  bool lookup(size_t count,llvm::StringRef key){size_t depth=1;for(auto n=count;n;n>>=1){if(!step())return false;depth+=2;}
    for(size_t i=0;i<depth;++i)if(!text(key))return false;return true;}
  Refs copyRefs(const Refs &values){if(!step(values.size()+1))return {};return values;}
  void add(Refs &into,const Refs &values){if(!step(values.size()))return;for(auto id:values){if(!step())return;into.insert(id);}}
  Refs unite(const Refs &a,const Refs &b){auto out=copyRefs(a);add(out,b);return out;}
  Array refs(const Refs &values){Array out;if(!step(values.size()+1))return out;out.reserve(values.size());for(auto id:values){if(!step())return {};out.push_back(int64_t(id));}return out;}
  Ref append(Array &directory,Json value){if(!step()||!metadata(value)||!need(directory.size()<65536,"return-origin equation directory exceeds finite bound"))return 0;
    const auto id=directory.size();directory.push_back(std::move(value));return id;}
  Ref node(Json value,std::optional<std::string> identity=std::nullopt){
    const auto key=identity?std::move(*identity):encoded(value);if(!good()||!lookup(interned.size(),key))return 0;
    const auto found=interned.find(key);if(found!=interned.end())return found->second;
    const auto id=append(nodes,std::move(value));if(!good()||!step())return 0;interned.emplace(key,id);return id;
  }
  Refs root(llvm::StringRef kind,const std::string &type,const std::string &label={},Ref index=0,const Json *site=nullptr){
    if(!step(8)||!text(kind)||!text(type)||!text(label))return {};
    Object row{{"kind",kind.str()},{"type",type}};
    if(kind=="parameter")row["index"]=int64_t(index);else if(kind=="global")row["id"]=label;
    Json owned(std::move(row));
    std::optional<std::string> identity;
    if(site){if(!metadata(*site)||!metadata(owned))return {};identity=encoded(Array{owned,*site});}
    return {node(std::move(owned),std::move(identity))};
  }
  Refs nonowning(const std::string &type){if(!text(type))return {};return type=="void"?Refs{}:root("nonowning",type);}
  Refs literal(bool undefined,const std::optional<std::string> &type=std::nullopt){
    if(!step(5)||(type&&!text(*type)))return {};return {node(Object{{"kind","literal"},{"type",type?Json(*type):Json(nullptr)},{"category",undefined?"undefined":"other"}})};
  }
  Refs gate(const Refs &values,const std::optional<std::string> &type=std::nullopt){
    if(!step(values.size()+6)||(type&&!text(*type)))return {};
    return {node(Object{{"kind","gate"},{"type",type?Json(*type):Json(nullptr)},{"inputs",refs(values)},{"control",int64_t(state.control)}})};
  }
  Refs projection(const Refs &bases,const std::string &selector,const std::string &type,const std::string &view){
    if(!step(bases.size()+8)||!text(selector)||!text(type)||!text(view))return {};
    return {node(Object{{"kind","projection"},{"type",type},{"bases",refs(bases)},{"selector",selector},{"view",view},{"heap",int64_t(state.heap)},{"control",int64_t(state.control)}})};
  }
  std::string site(const std::string &id,const Json &range,const std::string &role){
    if(!text(id)||!text(role)||!step(12))return {};return encoded(Array{id,field(range,"start"),field(range,"end"),role});
  }
  Refs copied(const Refs &bases,const std::string &type,const Json &range,const std::string &role){
    bool literals=true;for(auto base:bases){if(!step())return {};literals&=string(field(nodes[base],"kind"))=="literal";}if(literals)return copyRefs(bases);
    const auto location=site(functionId,range,role);if(!step(bases.size()+9)||!text(type)||!text(location))return {};
    const auto value=node(Object{{"kind","copy"},{"type",type},{"bases",refs(bases)},{"heap",int64_t(state.heap)},{"control",int64_t(state.control)},{"site",location}});
    state.heap=append(heaps,Object{{"kind","copy"},{"previous",int64_t(state.heap)},{"value",int64_t(value)}});return {value};
  }
  void access(const Refs &values,llvm::StringRef flag){
    if(!step(values.size()+7)||!text(flag))return;Json row=Object{{"values",refs(values)},{"flag",flag.str()},{"control",int64_t(state.control)}};
    const auto key=encoded(row);if(!lookup(accesses.size(),key)||!step())return;accesses.emplace(key,std::move(row));
  }
  void mark(const Refs &values,llvm::StringRef flag,const Json *operation=nullptr){
    auto selected=gate(values);access(selected,flag);if(!witnesses||!operation)return;
    if(!step(selected.size()+2))return;ReturnOriginAccessWitness witness;witness.flag=flag=="read"?0:flag=="write"?1:2;
    witness.values.assign(selected.begin(),selected.end());witness.origin=origin(operation);if(step())witnesses->push_back(std::move(witness));
  }
  void write(const Refs &bases,const std::string &selector,const Refs &values,const std::string &view,bool initialize=false){
    if(!step(bases.size()+values.size()+11)||!text(selector)||!text(view))return;
    if(!llvm::StringRef(selector).starts_with("capture:"))access(bases,"write");
    state.heap=append(heaps,Object{{"kind","store"},{"previous",int64_t(state.heap)},{"bases",refs(bases)},{"selector",selector},{"view",view},
      {"values",refs(values)},{"initialize",initialize},{"control",int64_t(state.control)}});
  }
  Refs environmentInput(const std::string &layout){if(!step(5)||!text(layout))return {};return {node(Object{{"kind","environmentInput"},{"type",nullptr},{"layout",layout}})};}
  Refs environmentCreate(const std::string &layout,const std::optional<Refs> &parent,const std::string &location){
    if(!step(8)||!text(layout)||!text(location))return {};
    return {node(Object{{"kind","environmentCreate"},{"type",nullptr},{"layout",layout},{"parent",parent?Json(refs(*parent)):Json(nullptr)},
      {"site",location},{"control",int64_t(state.control)}})};
  }
  Refs environmentParent(const Refs &bases,const std::string &layout){if(!step(bases.size()+6)||!text(layout))return {};
    return {node(Object{{"kind","environmentParent"},{"type",nullptr},{"layout",layout},{"bases",refs(bases)},{"control",int64_t(state.control)}})};
  }
  Refs environmentComponent(const Refs &callee,const std::string &id,const std::string &layout){if(!step(callee.size()+7)||!text(id)||!text(layout))return {};
    return {node(Object{{"kind","environmentComponent"},{"type",nullptr},{"layout",layout},{"functionId",id},{"callee",refs(callee)},{"control",int64_t(state.control)}})};
  }
  Refs capture(const Refs &environment,const Slot &slot){if(!step(environment.size()+9)||!text(slot.key)||!text(slot.type)||!text(slot.layout))return {};
    return {node(Object{{"kind","capture"},{"type",slot.type},{"id",slot.key},{"layout",slot.layout},{"environment",refs(environment)},
      {"heap",int64_t(state.heap)},{"control",int64_t(state.control)}})};
  }
  Refs code(const std::string &id,const std::optional<Refs> &environment,const std::string &type){if(!step(7)||!text(id)||!text(type))return {};
    return {node(Object{{"kind","code"},{"type",type},{"functionId",id},{"environment",environment?Json(refs(*environment)):Json(nullptr)},
      {"control",int64_t(state.control)}})};
  }
  Refs phi(const std::string &type,const Refs &values,const std::string &location){
    if(!step(values.size()+5)||!text(type)||!lookup(valuePhis.size(),location))return {};
    auto found=valuePhis.find(location);Ref id;
    if(found==valuePhis.end()){id=node(Object{{"kind","join"},{"type",type},{"inputs",Array{}}},encoded(Array{"phi",location}));if(!step())return {};valuePhis.emplace(location,id);}
    else id=found->second;
    Refs inputs;for(const auto &input:items(field(nodes[id],"inputs"))){if(!step())return {};inputs.insert(size_t(input.getAsInteger().value()));}
    add(inputs,values);inputs.erase(id);(*nodes[id].getAsObject())["inputs"]=refs(inputs);return {id};
  }
  Ref joinDirectory(Array &directory,std::map<std::string,Ref> &phis,const Refs &parents,const std::optional<std::string> &location){
    if(!step(parents.size()+2))return 0;if(parents.size()==1&&!location)return *parents.begin();Ref id;
    auto found=phis.end();if(location){if(!lookup(phis.size(),*location))return 0;found=phis.find(*location);}
    if(found==phis.end()){id=append(directory,Object{{"kind","join"},{"inputs",Array{}}});if(location){if(!text(*location)||!step())return 0;phis.emplace(*location,id);}}
    else id=found->second;
    Refs inputs;for(const auto &input:items(field(directory[id],"inputs"))){if(!step())return 0;inputs.insert(size_t(input.getAsInteger().value()));}
    add(inputs,parents);inputs.erase(id);(*directory[id].getAsObject())["inputs"]=refs(inputs);return id;
  }
  State mergeStates(const std::vector<State> &parents,const std::optional<std::string> &location=std::nullopt){
    if(!step(parents.size()*2+1))return {};Refs heapParents,controlParents;
    for(const auto &parent:parents){if(!step(2))return {};heapParents.insert(parent.heap);controlParents.insert(parent.control);}
    return {joinDirectory(heaps,heapPhis,heapParents,location),joinDirectory(controls,controlPhis,controlParents,location)};
  }
  void restore(State value){if(step())state=value;}
  Environment copyEnvironment(const Environment &source){if(!step(source.size()))return {};for(const auto &[key,values]:source)if(!text(key)||!step(values.size()+1))return {};return source;}
  Environment normalEnvironment(const Environment &source){Environment out;if(!step(source.size()))return {};
    for(const auto &[key,values]:source){if(!text(key)||!step())return {};out.emplace(key,gate(values));}return out;}
  void replaceEnvironment(Environment &target,const std::vector<Environment> &sources){
    if(!step(target.size()))return;for(auto &[binding,values]:target){Refs next;for(const auto &source:sources){if(!lookup(source.size(),binding))return;auto found=source.find(binding);if(found!=source.end())add(next,found->second);}values=std::move(next);}
  }
  void appendStates(std::vector<State> &target,const std::vector<State> &source){if(!step(source.size()+1))return;target.insert(target.end(),source.begin(),source.end());}
  void appendEnvironments(std::vector<Environment> &target,const std::vector<Environment> &source){if(!step(source.size()+1))return;for(const auto &environment:source)target.push_back(copyEnvironment(environment));}
  std::vector<Environment> environmentsFor(const Environment &value){std::vector<Environment> out;if(step())out.push_back(copyEnvironment(value));return out;}
  Refs environmentFor(const std::string &id){
    if(!lookup(environmentRefs.size(),id))return {};auto known=environmentRefs.find(id);if(known!=environmentRefs.end())return copyRefs(known->second);
    auto current=lexical;std::set<std::string> seen;
    while(!current.empty()){
      if(!lookup(layouts.size(),current)||!text(current)||!step())return {};
      if(!need(seen.insert(current).second&&layouts.count(current),"required lexical environment is missing or cyclic"))return {};
      const auto parent=string(field(*layouts.at(current),"parent"));if(parent.empty())break;
      if(!lookup(environmentRefs.size(),current)||!need(environmentRefs.count(current),"lexical parent has no input environment"))return {};
      if(!lookup(environmentRefs.size(),parent))return {};auto selected=environmentRefs.find(parent);
      if(selected==environmentRefs.end()){auto value=environmentParent(environmentRefs.at(current),parent);if(!text(parent)||!step())return {};selected=environmentRefs.emplace(parent,std::move(value)).first;}
      if(parent==id)return copyRefs(selected->second);current=parent;
    }
    need(false,"required environment is outside the current lexical chain");return {};
  }
  bool reference(const std::string &id){
    if(!text(id))return false;if(id=="void")return false;if(!lookup(references.size(),id))return false;
    if(auto found=references.find(id);found!=references.end())return found->second;
    if(!lookup(types.size(),id)||!step()||!need(types.count(id)&&activeTypes.insert(id).second,"unowned or cyclic containment type"))return false;
    const auto &row=*types.at(id);const auto kind=string(field(row,"kind"));bool result=kind=="reference"||kind=="array"||kind=="readSpan"||kind=="string"||kind=="unknown";
    if(kind=="union")for(const auto &member:items(field(row,"members"))){if(!step())return false;result|=reference(string(member));}
    if(kind=="value")for(const auto &member:items(field(row,"fields"))){if(!step())return false;result|=reference(string(field(member,"type")));}
    activeTypes.erase(id);if(!text(id)||!step())return false;references.emplace(id,result);return result;
  }
  Json origin(const Json *operation=nullptr,llvm::StringRef functionOperation={}){
    if(!step(18)||!text(functionId)||!text(string(field(fn,"sourcePath"))))return nullptr;
    return Object{{"kind",operation?"operation":"function"},{"functionId",functionId},
      {"source",Object{{"sourceId",field(fn,"sourcePath")},{"start",field(field(operation?*operation:fn,"range"),"start")},{"end",field(field(operation?*operation:fn,"range"),"end")}}},
      {"operation",operation?field(*operation,"kind"):Json(functionOperation.str())}};
  }
  void witness(Json reason,const Json *operation=nullptr,llvm::StringRef functionOperation={}){
    if(!diagnostics)return;const auto key=encoded(reason);auto selected=origin(operation,functionOperation);if(!good()||!lookup(diagnostics->local.size(),key))return;
    const auto order=[](const Json &row){const auto &source=field(row,"source");return std::tuple{string(field(source,"sourceId")),field(source,"start").getAsInteger().value_or(0),
      field(source,"end").getAsInteger().value_or(0),string(field(row,"kind")),string(field(row,"operation"))};};
    auto previous=diagnostics->local.find(key);if(previous==diagnostics->local.end()||order(selected)<order(previous->second)){if(!metadata(selected)||!step())return;diagnostics->local.insert_or_assign(key,std::move(selected));}
  }
  void facet(llvm::StringRef flag,const Json *operation=nullptr,llvm::StringRef functionOperation={}){
    if(!step()||!text(flag))return;
    if(flag=="allocation")direct.allocation=true;else if(flag=="managedReference")direct.managedReference=true;else if(flag=="ehControl")direct.ehControl=true;else if(flag=="escape")direct.escape=true;
    witness(Object{{"kind","facet"},{"facet",flag.str()}},operation,functionOperation);
  }
  void captureAccess(const Slot &slot,bool read,bool write,const Json *operation=nullptr){
    if(!lookup(direct.captures.size(),slot.key)||!step())return;auto &access=direct.captures[slot.key];access.read|=read;access.write|=write;
    if(read)witness(Object{{"kind","capture"},{"slot",slot.key},{"access","read"}},operation,"capture");
    if(write)witness(Object{{"kind","capture"},{"slot",slot.key},{"access","write"}},operation,"capture");
  }
  struct Evaluation {Refs owner,thrown;std::vector<State> throws;std::vector<Environment> throwEnvironments;};
  struct Body {unsigned completions=Normal;Refs returned,thrown;std::vector<State> returns,throws;std::vector<Environment> returnEnvironments,throwEnvironments;};
  void inherit(Evaluation &into,const Evaluation &from){add(into.thrown,from.thrown);appendStates(into.throws,from.throws);appendEnvironments(into.throwEnvironments,from.throwEnvironments);}
  void inheritThrows(Body &into,const Evaluation &from){if(from.throws.empty())return;into.completions|=Thrown;add(into.thrown,from.thrown);appendStates(into.throws,from.throws);appendEnvironments(into.throwEnvironments,from.throwEnvironments);}
  void inherit(Body &into,const Body &from){add(into.returned,from.returned);add(into.thrown,from.thrown);appendStates(into.returns,from.returns);appendStates(into.throws,from.throws);appendEnvironments(into.returnEnvironments,from.returnEnvironments);appendEnvironments(into.throwEnvironments,from.throwEnvironments);}
  Evaluation expression(const Json &,Environment &);
  Body body(const Array &,Environment &);
  Evaluation call(const std::string &,const std::vector<Refs> &,const Json &,Environment &,const Refs *,const Refs *receiver=nullptr);
  bool initialize();
  bool normalized(const Function &,Json &);
  bool finish(const Body &,Json &);
  bool run(Json &);
};

ReturnSource::Evaluation ReturnSource::call(const std::string &id,const std::vector<Refs> &arguments,const Json &value,Environment &environment,const Refs *selectedCode,const Refs *receiver){
  Evaluation result;if(!lookup(functions.size(),id)||!need(functions.count(id),"call has no owned function protocol"))return result;
  const auto &callee=*functions.at(id);const bool constructor=string(field(callee,"kind"))=="construction-body";
  if(!need(constructor==bool(receiver),"constructor call receiver role differs"))return result;
  const auto &ordinary=items(field(callee,"parameters"));const auto count=ordinary.size()+(!constructor&&!field(callee,"ownerType").getAsNull());
  if(!step(count+1))return result;if(arguments.size()<count){open("call lacks the owned default-parameter return-origin protocol");return result;}
  std::optional<Refs> incoming;const auto layout=string(field(callee,"lexicalEnvironment"));
  if(!layout.empty())incoming=selectedCode?environmentComponent(*selectedCode,id,layout):environmentFor(layout);
  // Permission is the COMPLETE independently admitted target upper. The
  // data solver may schedule fewer Code instances; that never removes this
  // target's stable access/facet obligations from the call boundary.
  if(!lookup(p.fixedEffects.size(),id))return result;const auto fixed=p.fixedEffects.find(id);
  if(!need(fixed!=p.fixedEffects.end()&&fixed->second.parameters.size()==count+constructor,"call fixed permission vector is incomplete"))return result;
  const auto &upper=fixed->second;
  const auto resources=[&](std::set<std::string> &to,const std::set<std::string> &from){
    if(!step(from.size()))return false;for(const auto &key:from){if(!lookup(to.size(),key)||!text(key)||!step())return false;to.insert(key);}return true;
  };
  if(!resources(direct.reads,upper.reads)||!resources(direct.writes,upper.writes)||!resources(direct.hostReads,upper.hostReads)||!resources(direct.hostWrites,upper.hostWrites)||!step(9))return result;
  direct.allocation|=upper.allocation;direct.managedReference|=upper.managedReference;direct.ehControl|=upper.ehControl;
  direct.await|=upper.await;direct.lock|=upper.lock;direct.escape|=upper.escape;direct.unknownHost|=upper.unknownHost;
  if(!step(upper.parameters.size()))return result;
  for(size_t i=0;i<count;++i){const auto &flags=upper.parameters[i+constructor];if(!step(3))return result;
    if(flags.read)mark(arguments[i],"read",&value);if(flags.write)mark(arguments[i],"write",&value);if(flags.structural)mark(arguments[i],"structural",&value);
  }
  // Capture uppers are global transitive SlotKeys. The fixed-context domain
  // resolves their actual incoming/activation payload across the full saved
  // call closure; an immediate lexical projection here would be unsound.
  Array supplied;if(!step(count+1))return result;supplied.reserve(count);for(size_t i=0;i<count;++i)supplied.push_back(refs(arguments[i]));
  const auto location=site(id,field(value,"range"),string(field(value,"kind")));
  if(!step(13)||!text(id)||!text(location))return result;
  const auto called=append(calls,Object{{"functionId",id},{"arguments",std::move(supplied)},
    {"environment",incoming?Json(refs(*incoming)):Json(nullptr)},{"callee",selectedCode?Json(refs(*selectedCode)):Json(nullptr)},
    {"receiver",receiver?Json(refs(*receiver)):Json(nullptr)},
    {"heap",int64_t(state.heap)},{"control",int64_t(state.control)},{"site",location}});
  const auto normalControl=append(controls,Object{{"kind","call"},{"call",int64_t(called)},{"completion","normal"}}),
    languageControl=append(controls,Object{{"kind","call"},{"call",int64_t(called)},{"completion","language"}});
  const State normal{append(heaps,Object{{"kind","call"},{"call",int64_t(called)},{"completion","normal"}}),normalControl},
    language{append(heaps,Object{{"kind","call"},{"call",int64_t(called)},{"completion","language"}}),languageControl};
  const auto type=string(field(callee,constructor?"ownerType":"returnType"));if(!step(13)||!text(type))return result;
  result.owner={node(Object{{"kind","call"},{"type",type},{"call",int64_t(called)},{"completion","normal"}})};
  result.thrown={node(Object{{"kind","call"},{"type",nullptr},{"call",int64_t(called)},{"completion","language"}})};
  if(!step(2)||!lookup(direct.calls.size(),id))return result;direct.calls.insert(id);result.throws.push_back(language);
  result.throwEnvironments.push_back(copyEnvironment(environment));
  if(diagnostics){if(!step(14)||!text(id)||!metadata(field(value,"range")))return result;
    diagnostics->calls.push_back(Object{{"caller",functionId},{"callee",id},{"kind",field(value,"kind")},
      {"source",Object{{"sourceId",field(fn,"sourcePath")},{"start",field(field(value,"range"),"start")},{"end",field(field(value,"range"),"end")}}}});}
  restore(normal);return result;
}

ReturnSource::Evaluation ReturnSource::expression(const Json &value,Environment &environment){
  Evaluation result;if(!step())return result;const auto kind=string(field(value,"kind")),type=string(field(value,"type"));
  if(!text(kind)||!text(type))return result;
  result.owner=reference(type)?Refs{}:nonowning(type);if(reference(type))facet("managedReference",&value);
  const auto visit=[&](const Json &child){auto nested=expression(child,environment);inherit(result,nested);return std::move(nested.owner);};
  if(kind=="bindingReference"||kind=="bindingTarget"||kind=="thisReference"){
    const auto binding=kind=="thisReference"?string(field(fn,"receiverBinding")):string(field(value,"binding"));
    if(!lookup(slots.size(),binding))return result;auto slot=slots.find(binding);
    if(slot!=slots.end()){
      result.owner=capture(environmentFor(slot->second.layout),slot->second);
      if(kind!="bindingTarget"&&foreignCaptures.count(binding))captureAccess(slot->second,true,false,&value);
    }else{if(!lookup(environment.size(),binding))return result;auto selected=environment.find(binding);result.owner=selected==environment.end()?Refs{}:copyRefs(selected->second);}
  }else if(kind=="functionReference"){
    const auto id=string(field(value,"functionId"));if(!lookup(functions.size(),id)||!need(functions.count(id),"function value has no owned declaration"))return result;
    const auto layout=string(field(*functions.at(id),"lexicalEnvironment"));std::optional<Refs> incoming;
    if(!layout.empty()){incoming=environmentFor(layout);facet("managedReference",&value);}result.owner=code(id,incoming,type);
  }else if(kind=="globalReference"||kind=="globalTarget"){
    const auto id=string(field(value,"global"));if(!lookup(globals.size(),id)||!need(globals.count(id),"global value has no owned declaration"))return result;
    result.owner=root("global",string(field(*globals.at(id),"type")),id);
    if(kind=="globalReference"){if(!lookup(direct.reads.size(),id)||!step())return result;direct.reads.insert(id);}
  }else if(kind=="parentheses"||kind=="as"||kind=="nonNull")result.owner=visit(field(value,"expression"));
  else if(kind=="binary"&&(string(field(value,"operator"))=="&&"||string(field(value,"operator"))=="||"||string(field(value,"operator"))=="??")){
    const auto left=visit(field(value,"left"));const auto shortState=state;auto shortEnvironment=normalEnvironment(environment);
    const auto right=visit(field(value,"right"));auto rightEnvironment=normalEnvironment(environment);result.owner=unite(left,right);
    std::vector<Environment> branches;if(!step(2))return result;branches.push_back(std::move(shortEnvironment));branches.push_back(std::move(rightEnvironment));replaceEnvironment(environment,branches);
    restore(mergeStates({shortState,state}));
  }else if(kind=="stringLiteral")result.owner=literal(false,type);
  else if(kind=="arrayLiteral"){
    Refs elements;const auto &children=items(field(value,"elements"));if(!step(children.size()))return result;
    for(size_t i=0;i<children.size();++i){const auto &child=children[i];auto nested=visit(child);const auto role="array-element:"+std::to_string(i);
      add(elements,copied(nested,string(field(child,"type")),field(child,"range"),role));}
    facet("allocation",&value);facet("managedReference",&value);const auto &allocation=field(value,"allocationSite");result.owner=root("local",type,{},0,allocation.getAsNull()?nullptr:&allocation);
    write(result.owner,"element",elements,type,true);
  }else if(kind=="fieldAccess"||kind=="fieldTarget"||kind=="checkedElementAccess"||kind=="elementTarget"||kind=="arrayLength"||kind=="readSpanLength"||kind=="lengthTarget"){
    const auto receiver=visit(field(value,"receiver"));if(value.getAsObject()->get("index"))visit(field(value,"index"));
    if(kind=="fieldAccess"||kind=="checkedElementAccess"||kind=="arrayLength"||kind=="readSpanLength")mark(receiver,"read",&value);
    const auto view=string(field(field(value,"receiver"),"type"));
    if(kind=="fieldAccess"||kind=="fieldTarget"){const auto property=string(field(value,"property"));if(!text(property)||!step())return result;result.owner=projection(receiver,"field:"+property,type,view);}
    else if(kind=="checkedElementAccess"||kind=="elementTarget")result.owner=projection(receiver,"element",type,view);
    else result.owner=nonowning(type);
  }else if(kind=="bindingAssignment"||kind=="elementAssignment"||kind=="elementCompoundAssignment"||kind=="lengthAssignment"||kind=="fieldAssignment"||kind=="bindingUpdate"||kind=="elementUpdate"||kind=="fieldUpdate"){
    const Json *target=&field(value,"target");while(string(field(*target,"kind"))=="parentheses"){if(!step())return result;target=&field(*target,"expression");}
    const auto targetKind=string(field(*target,"kind")),binding=string(field(*target,"binding")),operation=string(field(value,"operator"));
    const bool hasContainer=target->getAsObject()->get("receiver")!=nullptr;Refs container;if(hasContainer)container=visit(field(*target,"receiver"));
    if(target->getAsObject()->get("index"))visit(field(*target,"index"));
    if(!lookup(slots.size(),binding))return result;auto slot=slots.find(binding);const bool captured=slot!=slots.end();
    const auto selected=hasContainer?copyRefs(container):captured&&operation=="="?Refs{}:visit(*target);
    const bool external=hasContainer||targetKind=="globalTarget"||foreignCaptures.count(binding),logical=operation=="&&="||operation=="||="||operation=="?" "?=";
    if(external&&operation!="="&&!captured)mark(selected,"read",&value);
    if(captured&&foreignCaptures.count(binding))captureAccess(slot->second,operation!="=",true,&value);
    Refs previous;if(logical){if(hasContainer&&(targetKind=="fieldTarget"||targetKind=="elementTarget")){
      const auto selector=targetKind=="fieldTarget"?"field:"+string(field(*target,"property")):"element";
      previous=projection(container,selector,string(field(*target,"type")),string(field(field(*target,"receiver"),"type")));
    }else previous=copyRefs(selected);}
    const auto shortState=state;Environment shortEnvironment;if(logical)shortEnvironment=normalEnvironment(environment);
    const auto assignedValue=value.getAsObject()->get("value");const auto evaluated=assignedValue?visit(*assignedValue):nonowning(type);
    const auto assigned=operation=="="||logical?copyRefs(evaluated):nonowning(type);
    if(external&&!captured)mark(selected,"write",&value);
    const auto targetType=string(field(*target,"type"));const auto stored=copied(assigned,targetType,field(value,"range"),"assignment-store");
    if(hasContainer&&(targetKind=="fieldTarget"||targetKind=="elementTarget")){
      const auto property=string(field(*target,"property"));if(!text(property)||!step())return result;
      write(container,targetKind=="fieldTarget"?"field:"+property:"element",stored,string(field(field(*target,"receiver"),"type")));
    }
    if(kind=="lengthAssignment"||llvm::StringRef(kind).starts_with("element"))mark(selected,"structural",&value);
    result.owner=logical?unite(previous,assigned):copyRefs(assigned);
    if(captured){if(!text(slot->second.key)||!text(slot->second.layout)||!step(2))return result;write(environmentFor(slot->second.layout),"capture:"+slot->second.key,stored,"env:"+slot->second.layout);}
    if(!binding.empty()&&string(field(*target,"global")).empty()){if(!lookup(environment.size(),binding)||!text(binding)||!step())return result;environment.insert_or_assign(binding,copyRefs(stored));}
    if(targetKind=="globalTarget"){const auto global=string(field(*target,"global"));if(!lookup(direct.writes.size(),global)||!step())return result;direct.writes.insert(global);}
    if(logical){std::vector<Environment> branches;if(!step(2))return result;branches.push_back(std::move(shortEnvironment));branches.push_back(normalEnvironment(environment));replaceEnvironment(environment,branches);restore(mergeStates({shortState,state}));}
  }else if(kind=="new"||kind=="superConstruct")open("receiver frame/result and dynamic-newTarget equations are not connected to Source return-origin production");
  else if(kind=="hostCall")open("Host payload provenance has no admitted fixed return-origin boundary");
  else if(kind=="indirectCall"||kind=="call"){
    Refs selectedCode;const bool indirect=kind=="indirectCall";if(indirect)selectedCode=visit(field(value,"expression"));
    std::vector<Refs> arguments;const auto &rawArguments=items(field(value,"arguments"));if(!step(rawArguments.size()+2))return result;arguments.reserve(rawArguments.size()+1);
    if(!indirect&&value.getAsObject()->get("receiver"))arguments.push_back(visit(field(value,"receiver")));
    const auto &signature=items(field(field(value,"signature"),"parameters"));
    if(!need(signature.size()>=rawArguments.size(),"Source call has incomplete argument signature"))return result;
    for(size_t i=0;i<rawArguments.size();++i){const auto &child=rawArguments[i];auto actual=visit(child);const auto role=(indirect?"indirect-argument:":"direct-argument:")+std::to_string(i);
      arguments.push_back(copied(actual,string(signature[i]),field(child,"range"),role));}
    if(!indirect&&string(field(value,"callee"))=="intrinsic:readSpan"){
      if(!need(!arguments.empty(),"readSpan intrinsic has no owner argument"))return result;result.owner=copyRefs(arguments[0]);
    }else{
      std::vector<std::string> targets;
      if(indirect){const auto &range=field(value,"range");if(!text(functionId)||!step(7))return result;
        const auto key=functionId+"/"+std::to_string(field(range,"start").getAsInteger().value())+":"+std::to_string(field(range,"end").getAsInteger().value());
        if(!lookup(p.callableSites.size(),key))return result;auto fixed=p.callableSites.find(key);
        if(!need(fixed!=p.callableSites.end(),"indirect call has no independently validated target site"))return result;
        if(fixed->second.top||fixed->second.functions.empty()){open("indirect call has an unresolved permitted target set");return result;}
        if(!step(fixed->second.functions.size()))return result;for(const auto &id:fixed->second.functions){if(!text(id)||!step())return result;targets.push_back(id);}
      }else{const auto id=string(field(value,"callee"));if(!lookup(functions.size(),id)||!need(functions.count(id),"direct call has no owned declaration"))return result;
        if(string(field(*functions.at(id),"kind"))=="method"){
          Json dispatch=nullptr;if(!methodDispatch(p,string(field(field(value,"receiver"),"type")),id,dispatch,error)||!methodTargets(p,dispatch,targets,error))return result;
        }else{if(!text(id)||!step())return result;targets.push_back(id);}
      }
      if(!need(!targets.empty(),"call has an empty permitted target set"))return result;
      const auto before=state;std::vector<State> normalStates;Refs returned;std::set<std::string> consumed;
      for(const auto &id:targets){if(!lookup(consumed.size(),id)||!step())return result;if(!consumed.insert(id).second)continue;restore(before);
        auto called=call(id,arguments,value,environment,indirect?&selectedCode:nullptr);add(returned,called.owner);inherit(result,called);if(!step())return result;normalStates.push_back(state);
      }
      result.owner=std::move(returned);restore(mergeStates(normalStates));
    }
  }else if(kind=="numericLiteral"||kind=="booleanLiteral"||kind=="undefinedLiteral"||kind=="nullLiteral"||kind=="unary"||kind=="binary"||kind=="stringConcat"){
    result.owner=literal(kind=="undefinedLiteral",type);
    for(auto name:{"expression","left","right","receiver","index","value"}){if(!step())return result;if(const auto *child=value.getAsObject()->get(name))visit(*child);}
    if(kind=="stringConcat"){facet("allocation",&value);facet("managedReference",&value);result.owner=literal(false,type);}
  }else need(false,"Source expression has no return-origin equation");
  result.owner=gate(result.owner,type);return result;
}

ReturnSource::Body ReturnSource::body(const Array &rows,Environment &environment){
  Body result;
  for(const auto &row:rows){
    if(!step()||!good()||!(result.completions&Normal))break;result.completions&=~Normal;Body current;
    const auto kind=string(field(row,"kind"));if(!text(kind))break;
    const auto inspect=[&](const Json &value){auto evaluated=expression(value,environment);inheritThrows(current,evaluated);return std::move(evaluated.owner);};
    if(kind=="constDeclaration"||kind=="letDeclaration"||kind=="varDeclaration"||kind=="initialize"){
      if(kind!="varDeclaration"||!field(row,"initializer").getAsNull()){
        const auto assigned=inspect(field(row,"initializer"));const auto binding=string(field(row,"binding")),global=string(field(row,"global"));const Json *declaration=nullptr;
        if(!global.empty()){if(!lookup(globals.size(),global)||!need(globals.count(global),"initializer has no owned global"))return result;declaration=globals.at(global);}
        else{if(!lookup(bindings.size(),binding))return result;auto found=bindings.find(binding);if(found!=bindings.end())declaration=found->second;}
        const auto type=declaration?string(field(*declaration,"type")):string(field(field(row,"initializer"),"type"));
        auto stored=copied(assigned,type,field(row,"range"),"declaration-store");if(!text(binding)||!lookup(environment.size(),binding)||!step())return result;environment.insert_or_assign(binding,std::move(stored));
        if(!global.empty()){if(!text(global)||!lookup(direct.writes.size(),global)||!step())return result;direct.writes.insert(global);}
        if(!lookup(slots.size(),binding))return result;auto slot=slots.find(binding);
        if(slot!=slots.end()){if(!text(slot->second.key)||!text(slot->second.layout)||!step(2))return result;
          write(environmentFor(slot->second.layout),"capture:"+slot->second.key,environment.at(binding),"env:"+slot->second.layout,kind!="varDeclaration");}
      }
    }else if(kind=="expression")inspect(field(row,"value"));
    else if(kind=="return"){
      if(const auto *value=row.getAsObject()->get("value")){
        const auto evaluated=inspect(*value);const auto type=string(field(fn,"returnType"));if(!lookup(types.size(),type))return result;
        const bool nothing=type=="void"||(types.count(type)&&string(field(*types.at(type),"kind"))=="void");
        if(!nothing)add(current.returned,copied(evaluated,type,field(row,"range"),"return"));
        if(reference(type))facet("escape",&row);
        // Code/Env actual ownership and conditional ReadSpan escape are checked
        // by the fixed domain plus the existing Actual/Borrow consumer. A
        // Source function view alone is neither an environment nor a proof.
      }
      current.completions=(current.completions&~Normal)|Returned;if(!step())return result;current.returns.push_back(state);current.returnEnvironments.push_back(copyEnvironment(environment));
    }else if(kind=="throw"){
      const auto thrown=inspect(field(row,"value"));add(current.thrown,thrown);facet("ehControl",&row);current.completions=Thrown;
      if(!step())return result;current.throws.push_back(state);current.throwEnvironments.push_back(copyEnvironment(environment));
    }else if(kind=="block"){
      auto child=copyEnvironment(environment);current=body(items(field(row,"body")),child);
      if(current.completions&Normal)replaceEnvironment(environment,environmentsFor(child));
    }else if(kind=="if"){
      auto condition=expression(field(row,"condition"),environment);const auto entry=state;auto yes=copyEnvironment(environment),no=copyEnvironment(environment);
      auto yesBody=body(items(field(row,"then")),yes);const auto yesState=state;restore(entry);
      auto noBody=body(items(field(row,"else")),no);const auto noState=state;current.completions=yesBody.completions|noBody.completions;inherit(current,yesBody);inherit(current,noBody);
      std::vector<State> normalStates;std::vector<Environment> normalEnvironments;if(!step(4))return result;
      if(yesBody.completions&Normal){normalStates.push_back(yesState);normalEnvironments.push_back(std::move(yes));}
      if(noBody.completions&Normal){normalStates.push_back(noState);normalEnvironments.push_back(std::move(no));}
      replaceEnvironment(environment,normalEnvironments);restore(mergeStates(normalStates));inheritThrows(current,condition);
    }else if(kind=="while"){
      const auto loopSite=site(functionId,field(row,"range"),"while");if(!text(loopSite)||!step())return result;const auto heapSite=loopSite+"/heap";const auto entry=state;
      const auto header=mergeStates({entry},heapSite);std::map<std::string,std::string> bindingTypes;
      const auto putType=[&](const std::string &id,const std::string &type){if(!text(id)||!text(type)||!lookup(bindingTypes.size(),id)||!step())return;bindingTypes.insert_or_assign(id,type);};
      for(const auto &[id,type]:parameters)putType(id,type);
      for(const auto &[id,binding]:bindings)putType(id,string(field(*binding,"type")));
      for(const auto &[id,global]:globals)putType(string(field(*global,"sourceBinding")),string(field(*global,"type")));
      for(const auto &capture:items(field(fn,"captures"))){const auto binding=string(field(capture,"binding"));if(!lookup(slots.size(),binding)||!need(slots.count(binding),"loop capture lacks owned slot"))return result;putType(binding,slots.at(binding).type);}
      const auto loopPhi=[&](Environment &target,const Environment &inputs){for(const auto &[binding,values]:inputs){
        if(!lookup(bindingTypes.size(),binding))return;auto type=bindingTypes.find(binding);if(type==bindingTypes.end())continue;
        if(!text(loopSite)||!text(binding)||!step())return;auto joined=phi(type->second,values,loopSite+"/"+binding);
        if(!lookup(target.size(),binding)||!text(binding)||!step())return;target.insert_or_assign(binding,std::move(joined));}};
      auto before=copyEnvironment(environment);loopPhi(environment,before);restore(header);
      auto condition=expression(field(row,"condition"),environment);const auto exit=state;auto loop=copyEnvironment(environment);auto repeated=body(items(field(row,"body")),loop);
      if(repeated.completions&Normal){mergeStates({state},heapSite);loopPhi(environment,loop);}
      restore(exit);current.completions=repeated.completions&~Normal;
      if(!(string(field(field(row,"condition"),"kind"))=="booleanLiteral"&&string(field(field(row,"condition"),"token"))=="true"))current.completions|=Normal;
      inherit(current,repeated);inheritThrows(current,condition);
    }else if(kind=="try"){
      facet("ehControl",&row);auto attemptedEnvironment=copyEnvironment(environment);auto attempted=body(items(field(field(row,"tryBlock"),"body")),attemptedEnvironment);
      if(attempted.completions&Normal)replaceEnvironment(environment,environmentsFor(attemptedEnvironment));
      const auto *catchClause=row.getAsObject()->get("catchClause");const bool hasCatch=catchClause&&!catchClause->getAsNull();
      if(hasCatch&&(attempted.completions&Thrown)){
        auto caughtEnvironment=copyEnvironment(environment);replaceEnvironment(caughtEnvironment,attempted.throwEnvironments);
        const auto &binding=field(*catchClause,"binding");if(!binding.getAsNull()){
          const auto id=string(field(binding,"id"));if(!text(id)||!lookup(caughtEnvironment.size(),id)||!step())return result;caughtEnvironment.insert_or_assign(id,copyRefs(attempted.thrown));}
        const auto normalState=state;restore(mergeStates(attempted.throws));auto caught=body(items(field(field(*catchClause,"block"),"body")),caughtEnvironment);const auto caughtState=state;
        current.completions=(attempted.completions&~Thrown)|caught.completions;
        add(current.returned,attempted.returned);appendStates(current.returns,attempted.returns);appendEnvironments(current.returnEnvironments,attempted.returnEnvironments);inherit(current,caught);
        std::vector<State> normalStates;std::vector<Environment> normalEnvironments;if(!step(4))return result;
        if(attempted.completions&Normal){normalStates.push_back(normalState);normalEnvironments.push_back(std::move(attemptedEnvironment));}
        if(caught.completions&Normal){normalStates.push_back(caughtState);normalEnvironments.push_back(std::move(caughtEnvironment));}
        replaceEnvironment(environment,normalEnvironments);restore(mergeStates(normalStates));
      }else current=std::move(attempted);
      const auto *finallyBlock=row.getAsObject()->get("finallyBlock");if(finallyBlock&&!finallyBlock->getAsNull()){
        std::vector<State> allStates;if(!step())return result;if(current.completions&Normal)allStates.push_back(state);appendStates(allStates,current.throws);appendStates(allStates,current.returns);restore(mergeStates(allStates));
        auto finalEnvironment=copyEnvironment(environment);std::vector<Environment> allEnvironments;
        if(current.completions&Normal){if(!step())return result;allEnvironments.push_back(copyEnvironment(environment));}
        appendEnvironments(allEnvironments,current.throwEnvironments);appendEnvironments(allEnvironments,current.returnEnvironments);replaceEnvironment(finalEnvironment,allEnvironments);
        auto final=body(items(field(*finallyBlock,"body")),finalEnvironment);const auto beforeCompletion=current.completions;
        if(!(final.completions&Normal))current=Body{};
        else{
          replaceEnvironment(environment,environmentsFor(finalEnvironment));
          if(!current.throws.empty()){current.throws.clear();if(!step())return result;current.throws.push_back(state);current.throwEnvironments=environmentsFor(finalEnvironment);}
          if(!current.returns.empty()){current.returns.clear();if(!step())return result;current.returns.push_back(state);current.returnEnvironments=environmentsFor(finalEnvironment);}
        }
        current.completions=((final.completions&Normal)?beforeCompletion:0)|(final.completions&~Normal);inherit(current,final);
      }
    }else if(kind!="functionDeclaration")need(false,"Source statement has no return-origin equation");
    result.completions|=current.completions;inherit(result,current);
  }
  return result;
}

bool ReturnSource::normalized(const Function &cfg,Json &raw){
  if(!step(cfg.carriers.size()+cfg.blocks.size())||!need(cfg.id==functionId&&!cfg.blocks.empty(),"admitted constructor CFG owner differs"))return false;
  const auto views=p.registerViews.find(functionId);if(!need(views!=p.registerViews.end()&&views->second.size()==cfg.carriers.size(),"admitted CFG has no complete semantic register projection"))return false;
  std::map<std::string,std::string> fieldOwners;
  for(const auto &[id,type]:types)for(const auto &member:items(field(*type,"fields"))){
    if(!step()||!text(id)||!text(string(field(member,"id"))))return false;fieldOwners.emplace(string(field(member,"id")),id);
  }
  const auto view=[&](uint16_t reg)->std::optional<std::string>{const auto &type=views->second[reg];if(!text(type))return {};return types.count(type)?std::optional<std::string>{type}:std::nullopt;};
  const auto mergeInputs=[&](Json &row,const Refs &inputs){
    Refs merged;for(const auto &input:items(field(row,"inputs"))){if(!step())return false;merged.insert(size_t(input.getAsInteger().value()));}
    add(merged,inputs);if(!good())return false;(*row.getAsObject())["inputs"]=refs(merged);return good();
  };
  const auto absent=std::numeric_limits<Ref>::max();if(!step(cfg.carriers.size()*3))return false;
  std::vector<Refs> registers(cfg.carriers.size());std::vector<Ref> joins(cfg.carriers.size(),absent);std::vector<bool> blockParameters(cfg.carriers.size(),false);
  for(size_t block=1;block<cfg.blocks.size();++block)for(auto reg:cfg.blocks[block].parameters){if(!step())return false;blockParameters[reg]=true;}
  const auto phi=[&](uint16_t reg){
    if(joins[reg]!=absent)return true;const auto type=view(reg);const auto identity=encoded(Array{"cfg-register",functionId,int64_t(reg)});
    joins[reg]=node(Object{{"kind","join"},{"type",type?Json(*type):Json(nullptr)},{"inputs",refs(registers[reg])}},identity);
    if(!step())return false;registers[reg]={joins[reg]};return good();
  };
  const auto get=[&](uint16_t reg){if(!step()||(registers[reg].empty()&&!phi(reg)))return Refs{};return copyRefs(registers[reg]);};
  const auto define=[&](uint16_t reg,const Refs &values){
    if(blockParameters[reg]||joins[reg]!=absent)return phi(reg)&&mergeInputs(nodes[joins[reg]],values);
    registers[reg]=copyRefs(values);return good();
  };
  const bool constructor=string(field(fn,"kind"))=="construction-body";const auto owner=string(field(fn,"ownerType"));
  const auto &entry=cfg.blocks[0].parameters;size_t argument=0,parameter=0;
  if(!lexical.empty()){
    auto incoming=environmentInput(lexical);if(!define(entry[argument++],incoming))return false;environmentRefs.emplace(lexical,std::move(incoming));facet("managedReference",nullptr,"lexicalEnvironment");
  }
  if(!owner.empty()){
    if(constructor){if(!define(entry[argument++],Refs{node(Object{{"kind","receiverInput"},{"type",nullptr}})}))return false;++parameter;}
    else if(!define(entry[argument++],root("parameter",owner,{},parameter++)))return false;
  }
  for(const auto &binding:items(field(fn,"parameters"))){if(!step()||!define(entry[argument++],root("parameter",string(field(binding,"type")),{},parameter++)))return false;}
  if(!step(parameter))return false;direct.parameters.resize(parameter);
  std::map<std::string,std::string> cellTypes;
  for(const auto &carrier:cfg.carriers){if(!step()||!text(carrier))return false;const auto key=llvm::StringRef(carrier);if(!key.starts_with("cell:"))continue;const auto id=key.drop_front(5).str();
    if(!lookup(bindings.size(),id)||!step())return false;const auto binding=bindings.find(id);
    if(binding!=bindings.end())cellTypes.emplace(id,string(field(*binding->second,"type")));
    else if(id==string(field(fn,"receiverBinding")))cellTypes.emplace(id,owner);else return open("normalized cell lacks its owned binding view");
  }
  std::vector<State> entries;std::vector<Environment> environments;if(!step(cfg.blocks.size()*2))return false;entries.reserve(cfg.blocks.size());environments.resize(cfg.blocks.size());
  for(size_t block=0;block<cfg.blocks.size();++block){
    if(!step())return false;entries.push_back(block==0?State{}:State{append(heaps,Object{{"kind","join"},{"inputs",Array{}}}),append(controls,Object{{"kind","join"},{"inputs",Array{}}})});
    for(const auto &[id,type]:cellTypes){
      if(!text(id)||!text(type)||!step())return false;
      const auto identity=encoded(Array{"cfg-binding",functionId,int64_t(block),id});
      environments[block].emplace(id,Refs{node(Object{{"kind","join"},{"type",type},{"inputs",Array{}}},identity)});
    }
  }
  const auto connect=[&](uint16_t target,const std::vector<Refs> &arguments,const State &from,const Environment &environment){
    if(!step(arguments.size()+1)||!need(target!=0&&arguments.size()==cfg.blocks[target].parameters.size(),"admitted CFG edge arguments differ"))return false;
    if(!mergeInputs(heaps[entries[target].heap],Refs{from.heap})||!mergeInputs(controls[entries[target].control],Refs{from.control}))return false;
    for(size_t index=0;index<arguments.size();++index)if(!define(cfg.blocks[target].parameters[index],arguments[index]))return false;
    for(auto &[id,values]:environments[target]){
      if(!text(id)||!lookup(environment.size(),id))return false;const auto found=environment.find(id);if(found!=environment.end()&&!mergeInputs(nodes[*values.begin()],found->second))return false;
    }return true;
  };
  const auto action=[&](llvm::StringRef name,const Refs &frames,const Refs &operands,const std::optional<std::string> &type,bool language){
    const auto heap=append(heaps,Object{{"kind","receiverAction"},{"previous",int64_t(state.heap)},{"control",int64_t(state.control)},
      {"frames",refs(frames)},{"action",name},{"operands",refs(operands)},{"completion",language?"language":"normal"}});
    const auto control=append(controls,Object{{"kind","receiverCompletion"},{"action",int64_t(heap)}});
    Refs result{node(Object{{"kind","receiverValue"},{"type",!language&&type?Json(*type):Json(nullptr)},{"action",int64_t(heap)}})};
    return std::pair<State,Refs>{{heap,control},std::move(result)};
  };
  Body completed;completed.completions=0;
  for(size_t block=0;block<cfg.blocks.size();++block){
    restore(entries[block]);auto environment=copyEnvironment(environments[block]);
    for(size_t ordinal=0;ordinal<cfg.blocks[block].operations.size();++ordinal){
      const auto &operation=cfg.blocks[block].operations[ordinal];const auto &name=operation.name;const auto &args=operation.operands;const auto &props=operation.properties;
      if(!step(args.size()+operation.successors.size()+1))return false;const Json range=Object{{"start",int64_t(operation.range.start)},{"end",int64_t(operation.range.end)}};
      const auto resultType=operation.result==noRegister?std::optional<std::string>{}:view(operation.result);
      const auto value=[&](size_t index){return get(args[index]);};
      const auto save=[&](const Refs &values){return operation.result==noRegister?good():define(operation.result,values);};
      if(name=="pack"||name=="enter_handler"||name=="catch_bind"||name=="finally_enter"||name=="route")facet("ehControl",nullptr,"normalized-eh");
      if(name=="cell"||name=="fuel"||name=="enter_handler"||name=="finally_enter"||name=="initialize_begin"||name=="initialize_end")continue;
      if(name=="store"||name=="catch_bind"){
        const auto binding=string(field(props,"binding"));if(!text(binding)||!lookup(environment.size(),binding)||!step())return false;environment.insert_or_assign(binding,value(name=="store"?1:0));
      }else if(name=="load"){
        const auto binding=string(field(props,"binding"));if(!text(binding)||!lookup(environment.size(),binding))return false;const auto found=environment.find(binding);
        if(!need(found!=environment.end(),"normalized local load lacks an owned cell")||!save(found->second))return false;
      }else if(name=="undefined"||name=="constant"||name=="floating"||name=="boolean"||name=="null"||name=="string"||name=="unary"||name=="binary"||name=="strict_equal"){
        if(!save(literal(name=="undefined",resultType)))return false;
      }else if(name=="assert"||name=="view"||name=="carrier_cast"||name=="pack"){
        if(!save(value(0)))return false;
      }else if(name=="value_copy"){
        if(!resultType)return open("normalized copy Source view is unavailable");if(!save(copied(value(0),*resultType,range,"cfg-copy:"+std::to_string(operation.result))))return false;
      }else if(name=="global_store"){
        return open("normalized global store payload has no return-origin projection");
      }else if(name=="global_load"){
        const auto id=string(field(props,"global"));if(!lookup(globals.size(),id)||!need(globals.count(id),"normalized global has no owned declaration"))return false;
        const auto type=string(field(*globals.at(id),"type"));auto selected=root("global",type,id);
        if(!lookup(direct.reads.size(),id)||!step())return false;direct.reads.insert(id);mark(selected,"read");if(!save(selected))return false;
      }else if(name=="receiver_create"||name=="receiver_child"){
        const auto type=string(field(props,"owner"));if(!lookup(types.size(),type)||!need(types.count(type),"normalized receiver owner is outside owned types"))return false;
        const auto construction=string(field(field(*types.at(type),"construction"),"id"));if(!text(construction)||!step(9))return false;
        const auto identity=site(functionId,range,"receiver-frame:"+std::to_string(block)+":"+std::to_string(ordinal));
        if(!save(Refs{node(Object{{"kind","receiverFrame"},{"type",nullptr},{"construction",construction},{"newTarget",name=="receiver_create"?field(props,"new_target"):Json(nullptr)},
          {"parent",name=="receiver_child"?Json(refs(value(0))):Json(nullptr)},{"site",identity},{"control",int64_t(state.control)}})}))return false;
      }else if(name=="receiver_allocate"){
        auto normal=action("allocate",value(0),{},resultType,false);restore(normal.first);facet("allocation",nullptr,"receiver_allocate");facet("managedReference",nullptr,"receiver_allocate");if(!save(normal.second))return false;
      }else if(name=="receiver_bind"||name=="receiver_get"||name=="receiver_result"){
        if(!need(operation.successors.size()==2,"normalized receiver action lacks both completions"))return false;
        const auto type=view(cfg.blocks[operation.successors[0]].parameters[0]);const auto before=state;const auto operands=args.size()==2?value(1):Refs{};
        auto normal=action(llvm::StringRef(name).drop_front(9),value(0),operands,type,false);restore(before);auto language=action(llvm::StringRef(name).drop_front(9),value(0),operands,std::nullopt,true);
        if(!connect(operation.successors[0],{normal.second},normal.first,environment)||!connect(operation.successors[1],{language.second},language.first,environment))return false;
      }else if(name=="initialize_field"||name=="field_store"){
        const size_t offset=name=="initialize_field"?1:0;const auto id=string(field(props,"field"));if(!lookup(fieldOwners.size(),id)||!need(fieldOwners.count(id),"normalized field store has no owning declaration"))return false;
        write(value(offset),"field:"+id,value(offset+1),fieldOwners.at(id),name=="initialize_field"||field(props,"initialize").getAsBoolean()==true);
      }else if(name=="field_load"){
        if(!resultType)return open("normalized field load has no result view");const auto id=string(field(props,"field"));if(!lookup(fieldOwners.size(),id)||!need(fieldOwners.count(id),"normalized field load has no owning declaration"))return false;
        const auto base=value(0);mark(base,"read");if(!save(projection(base,"field:"+id,*resultType,fieldOwners.at(id))))return false;
      }else if(name=="env_alloc"){
        const auto layout=string(field(props,"layout")),location=site(functionId,range,"activation");std::optional<Refs> parent;if(!args.empty())parent=value(0);
        auto created=environmentCreate(layout,parent,location);if(!save(created)||!text(layout)||!step())return false;environmentRefs.insert_or_assign(layout,std::move(created));facet("allocation",nullptr,"activationEnvironment");facet("managedReference",nullptr,"activationEnvironment");
      }else if(name=="env_parent"){
        if(!save(environmentParent(value(0),string(field(props,"layout")))))return false;
      }else if(name=="env_init"||name=="env_store"||name=="env_load"){
        const auto binding=field(props,"binding").getAsString().value();if(!text(binding)||!lookup(slots.size(),binding))return false;
        const auto selected=slots.find(binding.str());if(!need(selected!=slots.end(),"normalized environment operation lacks an owned slot"))return false;const auto &slot=selected->second;
        // Complete validated CFG events independently retain the slot binding
        // permission, even when no Source read/write flags are available.
        if(name!="env_init"){
          if(!text(slot.layout)||!text(activation))return false;
          if(slot.layout!=activation)captureAccess(slot,name=="env_load",name=="env_store");
        }
        if(name=="env_load"){if(!save(capture(value(0),slot)))return false;}
        else write(value(0),"capture:"+slot.key,value(1),"env:"+slot.layout,name=="env_init");
      }else if(name=="make_closure"){
        if(!resultType)return open("normalized closure has no Source view");std::optional<Refs> environment;if(!args.empty())environment=value(0);if(!save(code(string(field(props,"function_id")),environment,*resultType)))return false;
      }else if(name=="invoke"){
        const auto target=string(field(props,"function_id"));if(!lookup(functions.size(),target))return false;if(!functions.count(target))return open("private recursive constructor invocation has no public fixed row");
        const auto &callee=*functions.at(target);size_t offset=!field(callee,"lexicalEnvironment").getAsNull();std::optional<Refs> receiver;
        if(string(field(callee,"kind"))=="construction-body")receiver=value(offset++);
        std::vector<Refs> arguments;if(!step(args.size()-offset))return false;for(size_t index=offset;index<args.size();++index)arguments.push_back(value(index));
        const Json site=Object{{"kind","invoke"},{"range",range}};auto called=call(target,arguments,site,environment,nullptr,receiver?&*receiver:nullptr);
        if(!good())return false;
        std::vector<Refs> normal;if(!cfg.blocks[operation.successors[0]].parameters.empty())normal.push_back(called.owner);
        if(!connect(operation.successors[0],normal,state,environment)||!connect(operation.successors[1],{called.thrown},called.throws[0],environment))return false;
      }else if(name=="cf.br"||name=="cf.cond_br"||name=="numeric_use"||name=="route"){
        size_t offset=name=="cf.cond_br"?1:0;
        for(auto target:operation.successors){std::vector<Refs> arguments;const auto count=cfg.blocks[target].parameters.size();if(!step(count)||!need(offset+count<=args.size(),"normalized branch operands differ"))return false;
          for(size_t index=0;index<count;++index)arguments.push_back(value(offset+index));if(!connect(target,arguments,state,environment))return false;offset+=count;}
      }else if(name=="func.return"){
        if(!args.empty())add(completed.returned,value(0));if(!step())return false;completed.returns.push_back(state);
      }else if(name=="return_throw"){
        add(completed.thrown,value(0));if(!step())return false;completed.throws.push_back(state);
      }else if(name!="unreachable")return open("normalized constructor graph operation has no return-origin projection");
      if(!good())return false;
    }
  }
  return finish(completed,raw);
}

bool ReturnSource::initialize(){
  if(!step()||!declarationMetadata(fn))return false;
  direct=Effects{};functionId=string(field(fn,"id"));lexical=string(field(fn,"lexicalEnvironment"));activation=string(field(fn,"activationEnvironment"));
  if(!step(2))return false;heaps.push_back(Object{{"kind","entry"}});controls.push_back(Object{{"kind","entry"}});
  const auto catalog=[&](const Json &rows,auto &directory){if(!step(items(rows).size()))return;for(const auto &row:items(rows)){
    if(!declarationMetadata(row))return;const auto id=string(field(row,"id"));if(!lookup(directory.size(),id)||!step())return;directory.emplace(id,&row);}};
  catalog(field(p.hir,"types"),types);catalog(field(p.hir,"functions"),functions);catalog(field(p.hir,"globals"),globals);catalog(field(p.hir,"environments"),layouts);catalog(field(fn,"parameters"),bindings);catalog(field(fn,"bindings"),bindings);
  if(!good())return false;
  for(const auto &[id,layout]:layouts)for(const auto &slot:items(field(*layout,"slots"))){
    if(!step(8)||!metadata(slot)||!text(id))return false;const auto binding=string(field(slot,"binding"));
    if(!lookup(slots.size(),binding)||!need(!slots.count(binding),"binding has multiple environment slot owners"))return false;
    slots.emplace(binding,Slot{string(field(slot,"key")),string(field(slot,"type")),id});
  }
  for(const auto &capture:items(field(fn,"captures"))){
    if(!step()||!metadata(capture))return false;const auto binding=string(field(capture,"binding"));
    if(!lookup(slots.size(),binding)||!need(slots.count(binding),"capture has no owned lexical slot")||!lookup(foreignCaptures.size(),binding)||!step())return false;foreignCaptures.insert(binding);
    captureAccess(slots.at(binding),field(capture,"read").getAsBoolean()==true,field(capture,"write").getAsBoolean()==true);
  }
  return good();
}

bool ReturnSource::run(Json &raw){
  if(!initialize())return false;
  if(string(field(fn,"kind"))=="construction-body")return open("constructor graph requires admitted normalized CFG");
  if(!lexical.empty()){if(!text(lexical)||!step())return false;environmentRefs.emplace(lexical,environmentInput(lexical));facet("managedReference",nullptr,"lexicalEnvironment");}
  if(!activation.empty()){
    if(!lookup(layouts.size(),activation)||!need(layouts.count(activation),"activation environment has no owned layout"))return false;
    const auto parent=string(field(*layouts.at(activation),"parent"));std::optional<Refs> selected;if(!parent.empty())selected=environmentFor(parent);
    auto value=environmentCreate(activation,selected,site(functionId,field(fn,"range"),"activation"));if(!text(activation)||!step())return false;environmentRefs.insert_or_assign(activation,std::move(value));
    facet("allocation",nullptr,"activationEnvironment");facet("managedReference",nullptr,"activationEnvironment");
  }
  const auto &ordinary=items(field(fn,"parameters"));if(!step(ordinary.size()+2))return false;parameters.reserve(ordinary.size()+1);
  if(!field(fn,"ownerType").getAsNull())parameters.emplace_back(string(field(fn,"receiverBinding")),string(field(fn,"ownerType")));
  for(const auto &parameter:ordinary){if(!metadata(parameter)||!step())return false;parameters.emplace_back(string(field(parameter,"id")),string(field(parameter,"type")));}
  if(!step(parameters.size()))return false;direct.parameters.resize(parameters.size());Environment environment;
  for(size_t i=0;i<parameters.size();++i){const auto &[id,type]=parameters[i];auto value=root("parameter",type,{},i);
    if(!text(id)||!lookup(environment.size(),id)||!step())return false;environment.emplace(id,std::move(value));
    if(!lookup(slots.size(),id))return false;auto slot=slots.find(id);
    if(slot!=slots.end()&&slot->second.layout==activation){if(!text(slot->second.key)||!text(activation)||!step(2))return false;
      write(environmentFor(activation),"capture:"+slot->second.key,environment.at(id),"env:"+activation,true);}
  }
  std::set<std::string> vars;
  std::function<void(const Array &)> collect;
  collect=[&](const Array &rows){for(const auto &row:rows){
    if(!step())return;if(string(field(row,"kind"))=="varDeclaration"){
      const auto binding=field(row,"binding").getAsString().value();
      if(!text(binding)||!lookup(vars.size(),binding)||!step())return;vars.insert(binding.str());
    }
    for(auto key:{"body","then","else"})collect(items(field(row,key)));
    collect(items(field(field(row,"tryBlock"),"body")));collect(items(field(field(field(row,"catchClause"),"block"),"body")));collect(items(field(field(row,"finallyBlock"),"body")));
  }};collect(items(field(fn,"body")));
  for(const auto &binding:items(field(fn,"bindings"))){
    if(!step())return false;const auto key=field(binding,"id").getAsString().value();
    if(!text(key)||!lookup(vars.size(),key)||!step())return false;const auto id=key.str();if(!vars.count(id))continue;
    auto value=literal(true);
    if(!text(id)||!lookup(environment.size(),id)||!step())return false;environment.emplace(id,std::move(value));
    if(!lookup(slots.size(),id))return false;auto slot=slots.find(id);
    if(slot!=slots.end()&&slot->second.layout==activation){if(!text(slot->second.key)||!text(activation)||!step(2))return false;
      write(environmentFor(activation),"capture:"+slot->second.key,environment.at(id),"env:"+activation,true);}
  }
  bool managed=reference(string(field(fn,"returnType")));for(const auto &[id,type]:parameters){if(!step())return false;managed|=reference(type);}
  if(managed)facet("managedReference",nullptr,"signature");auto completed=body(items(field(fn,"body")),environment);
  if(completed.completions&Normal){if(!step())return false;completed.returns.push_back(state);}
  return finish(completed,raw);
}
bool ReturnSource::finish(const Body &completed,Json &raw){
  const auto exitRows=[&](const std::vector<State> &states){Array rows;std::set<std::pair<Ref,Ref>> unique;if(!step(states.size()+1))return rows;
    for(const auto &selected:states){if(!step(3))return Array{};unique.emplace(selected.heap,selected.control);}if(!step(unique.size()+1))return rows;rows.reserve(unique.size());
    for(const auto &[heap,control]:unique){if(!step(5))return Array{};rows.push_back(Object{{"heap",int64_t(heap)},{"control",int64_t(control)}});}return rows;};
  auto normal=exitRows(completed.returns),language=exitRows(completed.throws);Array recorded;if(!step(accesses.size()+1))return false;recorded.reserve(accesses.size());for(auto &[key,value]:accesses){if(!step())return false;recorded.push_back(std::move(value));}
  auto returned=refs(completed.returned),thrown=refs(completed.thrown);if(!good()||!step(25))return false;
  raw=Object{{"format",Object{{"family","tsfg.return-origin-graph-candidate"},{"version",5}}},{"nodes",std::move(nodes)},{"heaps",std::move(heaps)},
    {"controls",std::move(controls)},{"calls",std::move(calls)},{"normal",std::move(returned)},{"language",std::move(thrown)},
    {"exits",Object{{"normal",std::move(normal)},{"language",std::move(language)}}},{"accesses",std::move(recorded)}};
  // mayThrow is determined from the domain's live language completion, not
  // from the syntactic presence of a caught throw or a permitted call arm.
  return good();
}
} // namespace

bool projectNormalizedReturnOriginBody(Program &p,const Json &fn,const Function &cfg,Json &raw,Effects &direct,Error &error,EffectDiagnostics *diagnostics,std::vector<ReturnOriginAccessWitness> *accesses){
  ReturnSource source{p,fn,direct,error,diagnostics,accesses};return source.initialize()&&source.normalized(cfg,raw);
}

bool deriveReturnOriginBody(Program &p,const Json &fn,Json &raw,Effects &direct,Error &error,EffectDiagnostics *diagnostics,std::vector<ReturnOriginAccessWitness> *accesses){
  // Only the Source owner supplies this witness after its independent match.
  // The shared projection itself neither constructs nor requires that token.
  const auto id=field(fn,"id").getAsString().value();
  size_t lookup=1;for(auto count=p.constructorReturnCFGs.size();count;count>>=1)lookup+=2;
  if(!p.charge((id.size()/8+1)*(lookup+1)))return reject(error,"core-ir-common-budget","Source return-origin CFG dispatch exceeded shared work");
  const auto qualified=p.constructorReturnCFGs.find(id.str());
  if(qualified!=p.constructorReturnCFGs.end())return projectNormalizedReturnOriginBody(p,fn,qualified->second.get(),raw,direct,error,diagnostics,accesses);
  ReturnSource source{p,fn,direct,error,diagnostics,accesses};return source.run(raw);
}
} // namespace tsfg::commonProgram
