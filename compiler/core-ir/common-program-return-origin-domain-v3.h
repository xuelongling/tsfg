// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-return-origins-v3.h"
#include <array>
#include <limits>
#include <memory>

// Ordinary immutable fixed-summary equations, not an AST/Program interpreter.
namespace CommonReturnOriginDomainV3 {
namespace V3=CommonReturnOriginV3;
using Ref=V3::Ref;
constexpr Ref None=std::numeric_limits<Ref>::max();
enum class Status {Solved,Open,BudgetError};
enum class Protocol {Ordinary,CodeEnvironment,ConstructionFrame,Future};
struct Flags {bool read=false,write=false,structural=false;};
struct CaptureAccess {std::string slot;Flags flags;};
struct ResourceAccess {std::vector<std::string> reads,writes;};
struct PublishedEffects {
  std::vector<Flags> parameters;
  std::vector<CaptureAccess> captures;
  ResourceAccess globals,hostResources;
  // True facet names only; mayThrow is derived from completion control instead.
  std::vector<std::string> facets;
};
struct FixedFunction {
  const V3::Graph *graph=nullptr;
  const PublishedEffects *upper=nullptr;
  Protocol protocol=Protocol::Ordinary;
};
using FixedFunctions=V3::Symbols<FixedFunction>;
struct PhysicalField {std::string id;std::optional<std::string> view;};
struct ActualShape {
  V3::TypeKind kind=V3::TypeKind::Future;
  // For Value this must enumerate ALL actual physical slots, including slots
  // absent from a narrower Source view. Absence of that authority yields Open.
  bool completePhysicalFields=false;
  std::vector<PhysicalField> fields;
};
enum class LocationKind {Parameter,Global,Capture,Local,Nonowning,Unknown,EntryProjection,CopiedValue};
struct LocationView {
  Ref id=0;
  LocationKind kind=LocationKind::Unknown;
  std::optional<llvm::StringRef> type,idLabel;
  Ref copySite=None;
};
struct Callbacks {
  Protocol rootProtocol=Protocol::Ordinary;
  // Immutable complete admitted directories only. Callback work must use the
  // supplied shared Charge and must not throw or retain borrowed LocationViews.
  std::function<const ActualShape *(llvm::StringRef,const V3::Charge &)> actualType;
  // Optional actual/view field-address identity. Unknown/missing means mayMatch,
  // never distinct. Returned StringRef remains valid through this callback.
  std::function<std::optional<llvm::StringRef>(llvm::StringRef,llvm::StringRef,llvm::StringRef,const V3::Charge &)> projectField;
  // Missing means true. Returning false requires independent admitted evidence;
  // differing formal symbols alone do not establish actual non-aliasing.
  std::function<bool(const LocationView &,const LocationView &,const V3::Charge &)> mayAlias;
};
struct Summary {
  // owners[node] and live[control] are root-context queries. Empty data is not
  // an unreachable continuation. Owner strings are conditional lexical roots.
  std::vector<V3::SymbolSet> owners;
  std::vector<bool> live;
  std::array<V3::SymbolSet,3> effects; // Read, Write, Structural
  V3::SymbolSet facets,calls;
  bool normal=false,language=false;
};
struct SolveResult {Status status=Status::Open;Summary summary;const char *reason="unproved";};

namespace Detail {
using Set=std::set<Ref>;
using Heap=std::map<Ref,Set>;
using Key=std::vector<Ref>;
using Meter=V3::Detail::Meter;
struct Location {LocationKind kind=LocationKind::Unknown;Ref type=None,label=None,owner=None,site=None;};
struct Address {Ref base=0,selector=0,view=0;};
struct Context {
  Ref index=0,function=None,scope=0;
  const V3::Graph *graph=nullptr;
  const PublishedEffects *upper=nullptr;
  std::vector<Set> arguments,values,targets;
  Heap input,normalHeap,languageHeap;
  std::vector<Heap> heaps;
  std::vector<bool> controls;
  Set normal,language;
  bool normalLive=false,languageLive=false;
  std::array<Set,3> effects;
  Set facets,calls;
};

class Solver {
  const V3::Graph &root_;
  const FixedFunctions &fixed_;
  const Callbacks &callbacks_;
  Meter m_;
  V3::Charge callbackCharge_;
  SolveResult result_;
  bool changed_=false;
  V3::Symbols<Ref> symbols_;
  std::vector<const std::string *> symbolNames_;
  std::map<Key,Ref> locationIds_,addressIds_,scopeIds_,siteIds_,contextIds_;
  std::vector<Location> locations_;
  std::vector<Address> addresses_;
  std::vector<std::unique_ptr<Context>> contexts_;
  std::vector<Set> rootArguments_;
  Ref initial_=0,element_=None,void_=None;

  bool open(const char *reason){result_.status=Status::Open;result_.reason=reason;return false;}
  bool active()const{return m_.good&&result_.status==Status::Solved;}
  bool numericLookup(std::size_t count,std::size_t width=1){
    std::size_t depth=1;for(auto n=count;n;n>>=1){if(!m_.spend())return false;depth+=2;}
    for(std::size_t i=0;i<depth;++i)if(!m_.spend(width+1))return false;return true;
  }
  bool number(Key &key,Ref value){return V3::Detail::push(key,value,m_);}
  bool key(Key &out,std::initializer_list<Ref> values){if(!V3::Detail::reserve(out,values.size(),m_))return false;for(auto value:values)if(!number(out,value))return false;return true;}
  llvm::StringRef name(Ref symbol)const{return *symbolNames_[symbol];}
  bool symbol(llvm::StringRef text,Ref &out){
    if(!m_.lookup(symbols_.size(),text.size()))return false;const auto found=symbols_.find(V3::Detail::view(text));
    if(found!=symbols_.end()){out=found->second;return true;}
    std::string copy;if(!m_.copy(copy,text)||!m_.spend()||!V3::Detail::room(symbolNames_,m_))return false;
    out=symbolNames_.size();const auto inserted=symbols_.emplace(std::move(copy),out);
    symbolNames_.push_back(&inserted.first->first);return true;
  }
  bool prefixed(llvm::StringRef prefix,llvm::StringRef text,Ref &out){
    if(!m_.text(prefix.size())||!m_.text(text.size())||!m_.spend(2))return false;
    std::string value;value.reserve(prefix.size()+text.size());value.append(prefix.data(),prefix.size());value.append(text.data(),text.size());return symbol(value,out);
  }
  bool parameterOwner(Ref index,Ref &out){if(!m_.spend(64))return false;const auto text=std::to_string(index);return prefixed("p:",text,out);}
  bool insert(Set &target,Ref value,bool lattice=true){
    if(!numericLookup(target.size()))return false;if(target.find(value)!=target.end())return true;
    if(!m_.spend())return false;target.insert(value);if(lattice)changed_=true;return true;
  }
  bool add(Set &target,const Set &source,bool lattice=true){if(!m_.spend(source.size()))return false;for(auto value:source)if(!insert(target,value,lattice))return false;return true;}
  bool merge(Heap &target,const Heap &source){
    if(!m_.spend(source.size()))return false;for(const auto &row:source){
      if(!numericLookup(target.size()))return false;auto found=target.find(row.first);
      if(found==target.end()){if(!m_.spend())return false;found=target.emplace(row.first,Set{}).first;changed_=true;}
      if(!add(found->second,row.second))return false;
    }return true;
  }
  bool resolve(const Context &context,const std::vector<Ref> &refs,Set &out){
    if(!m_.spend(refs.size()))return false;for(auto ref:refs)if(!add(out,context.values[ref],false))return false;return true;
  }
  bool internKey(std::map<Key,Ref> &rows,Key &&identity,Ref &out){
    if(!numericLookup(rows.size(),identity.size()))return false;auto found=rows.find(identity);
    if(found!=rows.end()){out=found->second;return true;}
    out=rows.size();if(!m_.spend())return false;rows.emplace(std::move(identity),out);return true;
  }
  bool location(Key &&identity,Location value,Ref &out){
    if(!numericLookup(locationIds_.size(),identity.size()))return false;const auto found=locationIds_.find(identity);
    if(found!=locationIds_.end()){out=found->second;return true;}
    if(!m_.spend()||!V3::Detail::room(locations_,m_))return false;out=locations_.size();
    locationIds_.emplace(std::move(identity),out);locations_.push_back(value);changed_=true;return true;
  }
  bool address(Ref base,Ref selector,Ref view,Ref &out){
    Key identity;if(!key(identity,{base,selector,view})||!numericLookup(addressIds_.size(),identity.size()))return false;
    const auto found=addressIds_.find(identity);if(found!=addressIds_.end()){out=found->second;return true;}
    if(!m_.spend()||!V3::Detail::room(addresses_,m_))return false;out=addresses_.size();
    addressIds_.emplace(std::move(identity),out);addresses_.push_back({base,selector,view});changed_=true;return true;
  }
  bool put(Heap &heap,Ref base,Ref selector,Ref view,const Set &values){
    if(!m_.spend())return false;if(values.empty())return true;Ref id;if(!address(base,selector,view,id)||!numericLookup(heap.size()))return false;
    auto found=heap.find(id);if(found==heap.end()){if(!m_.spend())return false;found=heap.emplace(id,Set{}).first;changed_=true;}return add(found->second,values);
  }
  const ActualShape *shape(Ref type){
    if(type==None){open("actual-type-open");return nullptr;}
    if(!callbacks_.actualType){open("actual-type-directory-open");return nullptr;}
    if(!m_.text(name(type).size())||!m_.spend())return nullptr;
    const auto *answer=callbacks_.actualType(name(type),callbackCharge_);
    if(!m_.good)return nullptr;if(!answer){open("actual-type-directory-open");return nullptr;}
    if(answer->kind==V3::TypeKind::Future||answer->kind==V3::TypeKind::Unknown||answer->kind==V3::TypeKind::Union){open("actual-tag-open");return nullptr;}return answer;
  }
  bool inlineLocation(Ref id,bool &answer){
    if(!m_.spend())return false;const auto value=locations_[id];answer=value.kind==LocationKind::CopiedValue;
    if(value.kind==LocationKind::Local){const auto *actual=shape(value.type);if(!actual)return false;answer=actual->kind==V3::TypeKind::Value;}return true;
  }
  LocationView locationView(Ref id)const{
    const auto &value=locations_[id];LocationView out;out.id=id;out.kind=value.kind;out.copySite=value.site;
    if(value.type!=None)out.type=name(value.type);if(value.label!=None)out.idLabel=name(value.label);return out;
  }
  bool aliases(Ref a,Ref b,bool &answer){
    if(!m_.spend())return false;const auto x=locations_[a],y=locations_[b];
    if(x.kind==LocationKind::Nonowning||y.kind==LocationKind::Nonowning){answer=false;return true;}
    if(a!=b&&(x.kind==LocationKind::CopiedValue||y.kind==LocationKind::CopiedValue)){
      bool left,right;if(!inlineLocation(a,left)||!inlineLocation(b,right))return false;if(left&&right){answer=false;return true;}
    }
    answer=true;if(callbacks_.mayAlias){if(!m_.spend())return false;answer=callbacks_.mayAlias(locationView(a),locationView(b),callbackCharge_);}return m_.good;
  }
  bool sameField(Ref base,Ref selector,Ref view,const Address &stored,bool &answer){
    if(!m_.spend())return false;if(selector==element_||stored.selector==element_){answer=selector==stored.selector;return true;}
    if(view==stored.view){answer=selector==stored.selector;return true;}if(selector==stored.selector){answer=true;return true;}
    const auto selected=locations_[base];answer=true;
    if((selected.kind==LocationKind::Local||selected.kind==LocationKind::CopiedValue)&&callbacks_.projectField){
      if(!m_.spend()||!m_.text(name(selected.type).size())||!m_.text(name(view).size())||!m_.text(name(selector).size()))return false;
      const auto first=callbacks_.projectField(name(selected.type),name(view),name(selector),callbackCharge_);
      if(!m_.good)return false;Ref a=None;if(first&&!symbol(*first,a))return false;
      if(!m_.spend()||!m_.text(name(selected.type).size())||!m_.text(name(stored.view).size())||!m_.text(name(stored.selector).size()))return false;
      const auto second=callbacks_.projectField(name(selected.type),name(stored.view),name(stored.selector),callbackCharge_);
      if(!m_.good)return false;Ref b=None;if(second&&!symbol(*second,b))return false;if(a!=None&&b!=None)answer=a==b;
    }return true;
  }
  bool read(const Heap &heap,Ref base,Ref selector,Ref view,const Key &origin,Set &out){
    if(!m_.spend())return false;const auto selected=locations_[base];
    if(selected.kind!=LocationKind::Local&&selected.kind!=LocationKind::CopiedValue&&selected.kind!=LocationKind::Nonowning){
      Key identity;if(!key(identity,{7,origin.size()})||!m_.spend(origin.size()))return false;
      for(auto item:origin)if(!number(identity,item))return false;if(!number(identity,selected.owner))return false;
      Ref id;if(!location(std::move(identity),{LocationKind::EntryProjection,None,None,selected.owner,None},id)||!insert(out,id,false))return false;
    }
    if(!m_.spend(heap.size()))return false;for(const auto &row:heap){
      bool alias,match;if(!aliases(base,addresses_[row.first].base,alias))return false;if(!alias)continue;
      if(!sameField(base,selector,view,addresses_[row.first],match))return false;if(match&&!add(out,row.second,false))return false;
    }return true;
  }
  bool copied(Ref source,Ref site,Ref &out){
    bool inlined;if(!inlineLocation(source,inlined))return false;if(!inlined){out=source;return true;}
    Ref owner;if(!symbol("local:return-origin",owner))return false;const auto type=locations_[source].type;
    Key identity;return key(identity,{8,site,type})&&location(std::move(identity),{LocationKind::CopiedValue,type,None,owner,site},out);
  }
  bool site(const Context &context,llvm::StringRef source,Ref &out){
    Ref label;if(!symbol(source,label))return false;Key identity;return key(identity,{context.scope,context.function,label})&&internKey(siteIds_,std::move(identity),out);
  }
  bool contextKey(Ref function,Ref scope,const std::vector<Set> &arguments,const Heap &input,Key &out){
    if(!key(out,{function,scope,arguments.size()})||!m_.spend(arguments.size()))return false;
    for(const auto &values:arguments){if(!number(out,values.size())||!m_.spend(values.size()))return false;for(auto value:values)if(!number(out,value))return false;}
    if(!number(out,input.size())||!m_.spend(input.size()))return false;
    for(const auto &row:input){if(!number(out,row.first)||!number(out,row.second.size())||!m_.spend(row.second.size()))return false;for(auto value:row.second)if(!number(out,value))return false;}return true;
  }
  bool ensure(Ref function,Ref scope,const std::vector<Set> &arguments,const Heap &input,Ref &out){
    Key identity;if(!contextKey(function,scope,arguments,input,identity)||!numericLookup(contextIds_.size(),identity.size()))return false;
    const auto found=contextIds_.find(identity);if(found!=contextIds_.end()){out=found->second;return true;}
    const V3::Graph *graph=&root_;const PublishedEffects *upper=nullptr;
    if(function!=None){
      if(!m_.lookup(fixed_.size(),name(function).size()))return false;const auto selected=fixed_.find(V3::Detail::view(name(function)));
      if(selected==fixed_.end()||!selected->second.graph||!selected->second.upper)return open("fixed-contract-member-open");
      if(selected->second.protocol!=Protocol::Ordinary)return open(selected->second.protocol==Protocol::ConstructionFrame?"construction-frame-open":"code-or-future-protocol-open");
      graph=selected->second.graph;upper=selected->second.upper;if(upper->parameters.size()!=arguments.size())return open("fixed-parameter-vector-open");
    }
    if(!m_.spend()||!m_.spend(graph->nodes.size())||!m_.spend(graph->heaps.size())||!m_.spend(graph->controls.size())||!m_.spend(graph->calls.size())||!m_.spend(arguments.size()))return false;
    auto value=std::make_unique<Context>();value->index=contexts_.size();value->function=function;value->scope=scope;value->graph=graph;value->upper=upper;
    value->values.resize(graph->nodes.size());value->heaps.resize(graph->heaps.size());value->controls.resize(graph->controls.size(),false);value->targets.resize(graph->calls.size());value->arguments.resize(arguments.size());
    for(Ref i=0;i<arguments.size();++i)if(!m_.spend()||!add(value->arguments[i],arguments[i]))return false;
    if(!merge(value->input,input)||!m_.spend()||!V3::Detail::room(contexts_,m_))return false;
    out=value->index;contextIds_.emplace(std::move(identity),out);contexts_.push_back(std::move(value));changed_=true;return true;
  }
  bool effect(Context &context,V3::AccessFlag flag,Ref owner){return insert(context.effects[static_cast<std::size_t>(flag)],owner);}
  bool valueEffects(Context &context,V3::AccessFlag flag,const Set &values){
    if(!m_.spend(values.size()))return false;for(auto id:values)if(locations_[id].owner!=None&&!effect(context,flag,locations_[id].owner))return false;return true;
  }
  bool flagged(Context &context,const Flags &flags,const Set &values){
    return m_.spend(3)&&(!flags.read||valueEffects(context,V3::AccessFlag::Read,values))&&(!flags.write||valueEffects(context,V3::AccessFlag::Write,values))&&(!flags.structural||valueEffects(context,V3::AccessFlag::Structural,values));
  }
  bool ownerFlags(Context &context,const Flags &flags,Ref owner){
    return m_.spend(3)&&(!flags.read||effect(context,V3::AccessFlag::Read,owner))&&(!flags.write||effect(context,V3::AccessFlag::Write,owner))&&(!flags.structural||effect(context,V3::AccessFlag::Structural,owner));
  }
  bool resourceEffects(Context &context,const ResourceAccess &resources,llvm::StringRef prefix){
    if(!m_.spend(resources.reads.size())||!m_.spend(resources.writes.size()))return false;
    for(const auto &id:resources.reads){Ref owner;if(!prefixed(prefix,id,owner)||!effect(context,V3::AccessFlag::Read,owner))return false;}
    for(const auto &id:resources.writes){Ref owner;if(!prefixed(prefix,id,owner)||!effect(context,V3::AccessFlag::Write,owner))return false;}return true;
  }
  bool inherit(Context &context,const Context &called){
    for(Ref i=0;i<3;++i)if(!m_.spend()||!add(context.effects[i],called.effects[i]))return false;
    if(!add(context.facets,called.facets)||!add(context.calls,called.calls)||!insert(context.calls,called.function))return false;
    const auto &upper=*called.upper;if(!m_.spend(upper.parameters.size())||!m_.spend(upper.captures.size())||!m_.spend(upper.facets.size()))return false;
    for(Ref i=0;i<upper.parameters.size();++i)if(!flagged(context,upper.parameters[i],called.arguments[i]))return false;
    for(const auto &capture:upper.captures){Ref owner;if(!prefixed("c:",capture.slot,owner)||!ownerFlags(context,capture.flags,owner))return false;}
    if(!resourceEffects(context,upper.globals,"g:")||!resourceEffects(context,upper.hostResources,"h:"))return false;
    for(const auto &facet:upper.facets){if(!m_.text(facet.size()))return false;if(!m_.equal(facet,"mayThrow")){if(!m_.good)return false;Ref id;if(!symbol(facet,id)||!insert(context.facets,id))return false;}}return true;
  }

  bool runCalls(Context &context){
    const auto &graph=*context.graph;if(!m_.spend(graph.calls.size()))return false;
    for(Ref i=0;i<graph.calls.size();++i){if(!m_.spend())return false;const auto &call=graph.calls[i];if(!context.controls[call.control])continue;
      if(!m_.spend(call.arguments.size()))return false;std::vector<Set> arguments(call.arguments.size());
      for(Ref j=0;j<call.arguments.size();++j)if(!m_.spend()||!resolve(context,call.arguments[j],arguments[j]))return false;
      Ref label,function,scope,target;Key identity;
      if(!symbol(call.site,label)||!symbol(call.functionId,function)||!key(identity,{context.function,label,i})||!internKey(scopeIds_,std::move(identity),scope)||
        !ensure(function,scope,arguments,context.heaps[call.heap],target)||!insert(context.targets[i],target))return false;
    }return true;
  }
  bool runControls(Context &context){
    const auto &graph=*context.graph;if(!m_.spend(graph.controls.size()))return false;
    for(Ref i=0;i<graph.controls.size();++i){if(!m_.spend())return false;const auto &control=graph.controls[i];bool live=false;
      if(control.kind==V3::ControlKind::Entry)live=true;
      else if(control.kind==V3::ControlKind::Join){if(!m_.spend(control.inputs.size()))return false;for(auto input:control.inputs){if(!m_.spend())return false;live=live||context.controls[input];}}
      else if(control.kind==V3::ControlKind::Call){if(!m_.spend(context.targets[control.call].size()))return false;for(auto target:context.targets[control.call]){if(!m_.spend())return false;const auto &called=*contexts_[target];live=live||(control.completion==V3::Completion::Normal?called.normalLive:called.languageLive);}}
      else return open("control-equation-open");
      if(live&&!context.controls[i]){context.controls[i]=true;changed_=true;}
    }return true;
  }
  bool rootLocation(Context &context,Ref index,const V3::Value &node,Ref &out){
    Ref type=None,label=None,owner=None;if(node.type&&!symbol(*node.type,type))return false;
    LocationKind kind;Key identity;
    if(node.kind==V3::ValueKind::Global){kind=LocationKind::Global;if(!symbol(node.id,label)||!prefixed("g:",node.id,owner)||!key(identity,{2,type,label}))return false;}
    else if(node.kind==V3::ValueKind::Capture){kind=LocationKind::Capture;if(!symbol(node.id,label)||!prefixed("c:",node.id,owner)||!key(identity,{3,type,label}))return false;}
    else if(node.kind==V3::ValueKind::Local){kind=LocationKind::Local;if(!symbol("local:return-origin",owner)||!key(identity,{4,context.function,context.scope,index,type}))return false;}
    else if(node.kind==V3::ValueKind::Nonowning){kind=LocationKind::Nonowning;if(!key(identity,{5,type}))return false;}
    else return open("unknown-value-equation-open");
    return location(std::move(identity),{kind,type,label,owner,None},out);
  }
  bool runValues(Context &context){
    const auto &graph=*context.graph;if(!m_.spend(graph.nodes.size()))return false;
    for(Ref i=0;i<graph.nodes.size();++i){if(!m_.spend())return false;const auto &node=graph.nodes[i];auto &output=context.values[i];
      if(node.kind==V3::ValueKind::Parameter){const auto &args=context.function==None?rootArguments_:context.arguments;if(node.index>=args.size())return open("parameter-vector-open");if(!add(output,args[node.index]))return false;}
      else if(node.kind==V3::ValueKind::Join){Set values;if(!resolve(context,node.inputs,values)||!add(output,values))return false;}
      else if(node.kind==V3::ValueKind::Gate){if(context.controls[node.control]){Set values;if(!resolve(context,node.inputs,values)||!add(output,values))return false;}}
      else if(node.kind==V3::ValueKind::Projection){
        if(!context.controls[node.control])continue;Set bases;Ref selector,view;Key origin;
        if(!resolve(context,node.bases,bases)||!symbol(node.selector,selector)||!symbol(node.view,view)||!key(origin,{context.function,i})||!m_.spend(bases.size()))return false;
        for(auto base:bases){Set values;if(!read(context.heaps[node.heap],base,selector,view,origin,values)||!add(output,values))return false;}
      }else if(node.kind==V3::ValueKind::Copy){
        if(!context.controls[node.control])continue;Set sources;Ref selectedSite;if(!resolve(context,node.bases,sources)||!site(context,node.site,selectedSite)||!m_.spend(sources.size()))return false;
        for(auto source:sources){Ref target;if(!copied(source,selectedSite,target)||!insert(output,target))return false;}
      }else if(node.kind==V3::ValueKind::Call){
        if(!m_.spend(context.targets[node.call].size()))return false;
        for(auto target:context.targets[node.call]){if(!m_.spend())return false;const auto &called=*contexts_[target];
          if(node.completion==V3::Completion::Normal?called.normalLive:called.languageLive){
            if(!add(output,node.completion==V3::Completion::Normal?called.normal:called.language))return false;
            if(node.completion==V3::Completion::Normal&&called.normal.empty()&&node.type){
              Ref type;if(!symbol(*node.type,type))return false;bool isVoid=type==void_;
              // This is a Source RETURN VIEW, not an asserted actual tag. An
              // erased union/unknown view must not be rejected or reclassified
              // as a local actual value merely to recognize native void data.
              if(!isVoid&&callbacks_.actualType){
                if(!m_.text(name(type).size())||!m_.spend())return false;
                const auto *view=callbacks_.actualType(name(type),callbackCharge_);if(!m_.good)return false;
                isVoid=view&&view->kind==V3::TypeKind::Void;
              }
              if(isVoid){Key identity;Ref id;if(!key(identity,{5,type})||!location(std::move(identity),{LocationKind::Nonowning,type,None,None,None},id)||!insert(output,id))return false;}
            }
          }
        }
      }else {Ref id;if(!rootLocation(context,i,node,id)||!insert(output,id))return false;}
    }return true;
  }
  bool copyHeap(Context &context,const V3::Heap &heap,Heap &output){
    const auto &operation=context.graph->nodes[heap.value];if(operation.kind!=V3::ValueKind::Copy)return open("copy-heap-equation-open");
    if(!merge(output,context.heaps[heap.previous]))return false;if(!context.controls[operation.control])return true;
    Ref selectedSite;Set roots;if(!site(context,operation.site,selectedSite)||!resolve(context,operation.bases,roots)||!m_.spend(roots.size()))return false;
    std::vector<Ref> pending;Set seen;if(!V3::Detail::reserve(pending,roots.size(),m_))return false;for(auto root:roots)if(!V3::Detail::push(pending,root,m_))return false;
    const auto &source=context.heaps[operation.heap];
    while(!pending.empty()){
      if(!m_.spend())return false;const auto original=pending.back();pending.pop_back();if(!numericLookup(seen.size()))return false;if(seen.find(original)!=seen.end())continue;
      bool inlined;if(!inlineLocation(original,inlined))return false;if(!inlined)continue;if(!insert(seen,original,false))return false;
      Ref target;if(!copied(original,selectedSite,target))return false;const auto type=locations_[original].type;const auto *actual=shape(type);
      if(!actual)return false;if(actual->kind!=V3::TypeKind::Value||!actual->completePhysicalFields)return open("complete-physical-copy-fields-open");
      if(!m_.spend(actual->fields.size()))return false;
      for(const auto &field:actual->fields){
        Ref selector,view,label;if(!m_.spend()||!prefixed("field:",field.id,selector)||!symbol(field.id,label))return false;
        if(field.view){if(!symbol(*field.view,view))return false;}else view=type;
        Key origin;Set values,children;if(!key(origin,{context.function,heap.value,label,view})||!read(source,original,selector,view,origin,values)||!m_.spend(values.size()))return false;
        for(auto child:values){Ref selected;bool childInline;if(!copied(child,selectedSite,selected)||!insert(children,selected,false)||!inlineLocation(child,childInline))return false;if(childInline&&!V3::Detail::push(pending,child,m_))return false;}
        if(!put(output,target,selector,view,children))return false;
      }
    }return true;
  }
  bool runHeaps(Context &context){
    const auto &graph=*context.graph;if(!m_.spend(graph.heaps.size()))return false;
    for(Ref i=0;i<graph.heaps.size();++i){if(!m_.spend())return false;const auto &heap=graph.heaps[i];auto &output=context.heaps[i];
      if(heap.kind==V3::HeapKind::Entry){if(!merge(output,context.input))return false;}
      else if(heap.kind==V3::HeapKind::Join){if(!m_.spend(heap.inputs.size()))return false;for(auto parent:heap.inputs)if(!merge(output,context.heaps[parent]))return false;}
      else if(heap.kind==V3::HeapKind::Store){
        if(!merge(output,context.heaps[heap.previous]))return false;if(!context.controls[heap.control])continue;
        Set bases,values;Ref selector,view;if(!resolve(context,heap.bases,bases)||!resolve(context,heap.values,values)||!symbol(heap.selector,selector)||!symbol(heap.view,view)||!m_.spend(bases.size()))return false;
        for(auto base:bases)if(!put(output,base,selector,view,values))return false;
      }else if(heap.kind==V3::HeapKind::Copy){if(!copyHeap(context,heap,output))return false;}
      else if(heap.kind==V3::HeapKind::Call){
        if(!m_.spend(context.targets[heap.call].size()))return false;for(auto target:context.targets[heap.call]){if(!m_.spend())return false;const auto &called=*contexts_[target];if(!merge(output,heap.completion==V3::Completion::Normal?called.normalHeap:called.languageHeap))return false;}
      }else return open("heap-equation-open");
    }return true;
  }
  bool finishContext(Context &context){
    const auto &graph=*context.graph;
    for(unsigned channel=0;channel<2;++channel){const bool normal=channel==0;auto &live=normal?context.normalLive:context.languageLive;auto &heap=normal?context.normalHeap:context.languageHeap;auto &values=normal?context.normal:context.language;
      const auto &exits=normal?graph.exits.normal:graph.exits.language;if(!m_.spend(exits.size()))return false;
      for(const auto &exit:exits){if(!m_.spend())return false;if(context.controls[exit.control]){if(!live){live=true;changed_=true;}if(!merge(heap,context.heaps[exit.heap]))return false;}}
      if(live){Set returned;if(!resolve(context,normal?graph.normal:graph.language,returned)||!add(values,returned))return false;}
    }
    if(!m_.spend(graph.accesses.size()))return false;for(const auto &access:graph.accesses){if(!m_.spend())return false;if(context.controls[access.control]){Set values;if(!resolve(context,access.values,values)||!valueEffects(context,access.flag,values))return false;}}
    if(!m_.spend(context.targets.size()))return false;for(const auto &targets:context.targets){if(!m_.spend(targets.size()))return false;for(auto target:targets)if(!inherit(context,*contexts_[target]))return false;}
    return true;
  }
  bool exportSet(V3::SymbolSet &out,const Set &source){
    if(!m_.spend(source.size()))return false;for(auto id:source){const auto text=name(id);std::string copy;
      if(!m_.lookup(out.size(),text.size())||!m_.copy(copy,text)||!m_.spend())return false;out.emplace(std::move(copy));}return true;
  }
  bool summarize(){
    const auto &initial=*contexts_[initial_];auto &out=result_.summary;
    if(!m_.spend(initial.values.size())||!m_.spend(initial.controls.size()))return false;out.owners.resize(initial.values.size());out.live=initial.controls;
    for(Ref i=0;i<initial.values.size();++i){Set owners;if(!m_.spend()||!m_.spend(initial.values[i].size()))return false;for(auto id:initial.values[i])if(locations_[id].owner!=None&&!insert(owners,locations_[id].owner,false))return false;if(!exportSet(out.owners[i],owners))return false;}
    for(Ref i=0;i<3;++i)if(!m_.spend()||!exportSet(out.effects[i],initial.effects[i]))return false;
    if(!exportSet(out.facets,initial.facets)||!exportSet(out.calls,initial.calls))return false;
    out.normal=initial.normalLive;out.language=initial.languageLive;return true;
  }
public:
  Solver(const V3::Graph &root,const FixedFunctions &fixed,const Callbacks &callbacks,const V3::Charge &charge):root_(root),fixed_(fixed),callbacks_(callbacks),m_(charge){}
  SolveResult run(){
    result_.status=Status::Solved;result_.reason="ordinary-fixed-context-closure";
    if(!m_.spend())return finish();callbackCharge_=[this](std::size_t n){return m_.spend(n);};
    if(callbacks_.rootProtocol!=Protocol::Ordinary){open(callbacks_.rootProtocol==Protocol::ConstructionFrame?"construction-frame-open":"code-or-future-protocol-open");return finish();}
    if(!symbol("element",element_)||!symbol("void",void_)||!m_.spend(root_.nodes.size()))return finish();
    for(const auto &node:root_.nodes){if(!m_.spend())return finish();if(node.kind!=V3::ValueKind::Parameter)continue;
      Ref type,owner,id;Key identity;if(!node.type){open("parameter-type-open");return finish();}
      if(!symbol(*node.type,type)||!parameterOwner(node.index,owner)||!key(identity,{1,node.index,type})||!location(std::move(identity),{LocationKind::Parameter,type,None,owner,None},id))return finish();
      if(node.index>=rootArguments_.size()){if(!m_.spend(node.index+1))return finish();rootArguments_.resize(node.index+1);}
      if(!insert(rootArguments_[node.index],id))return finish();
    }
    Ref rootScope;Key identity;if(!key(identity,{None})||!internKey(scopeIds_,std::move(identity),rootScope)||!ensure(None,rootScope,rootArguments_,Heap{},initial_))return finish();
    changed_=true;
    while(changed_&&active()){
      changed_=false;
      // Stable heap-allocated contexts survive vector growth while calls append
      // new contexts to this very worklist. Results resume only recorded targets.
      for(Ref i=0;i<contexts_.size();++i){if(!m_.spend())return finish();auto &context=*contexts_[i];
        if(!runCalls(context)||!runControls(context)||!runValues(context)||!runHeaps(context)||!finishContext(context))return finish();
      }
    }
    if(active()&&!summarize())return finish();return finish();
  }
  SolveResult finish(){
    if(!m_.good){result_.status=Status::BudgetError;result_.reason="return-origin-context-budget";}
    if(result_.status!=Status::Solved)result_.summary=Summary{};
    return std::move(result_);
  }
};
} // namespace Detail

// Graphs are already ordinary typed DTOs, joined to ONE immutable admitted
// fixed scope/schema/group. FnId must not resolve to replaceable current bodies.
// No graph/metadata/callback directory may mutate during this synchronous solve.
inline SolveResult solve(const V3::Graph &entryGraph,const FixedFunctions &fixed,const Callbacks &callbacks,const V3::Charge &charge){
  return Detail::Solver(entryGraph,fixed,callbacks,charge).run();
}
} // namespace CommonReturnOriginDomainV3
