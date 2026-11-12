// SPDX-License-Identifier: MIT
#pragma once
#include "common-program-return-origins-v4.h"
#include <array>
#include <limits>
#include <memory>

// Ordinary immutable fixed-summary equations, not an AST/Program interpreter.
namespace CommonReturnOriginDomainV4 {
namespace V4=CommonReturnOriginV4;
using Ref=V4::Ref;
constexpr Ref None=std::numeric_limits<Ref>::max();
enum class Status {Solved,Open,BudgetError};
enum class ProtocolKind {Ordinary,ConstructionFrame,Future};
struct Protocol {
  ProtocolKind kind=ProtocolKind::Future;
  bool complete=false;
  std::optional<std::string> lexicalEnvironment,activationEnvironment;
  std::optional<V4::Constructor> construction;
  // The immutable admitted function row outlives its protocol and the solve.
  const V4::FunctionRow *signature=nullptr;
};
struct Flags {bool read=false,write=false,structural=false;};
struct CaptureAccess {std::string slot;Flags flags;};
struct ResourceAccess {std::vector<std::string> reads,writes;};
struct PublishedEffects {
  std::vector<Flags> parameters;
  std::vector<CaptureAccess> captures;
  ResourceAccess globals,hostResources;
  // True fixed facets. Inferred mayThrow comes from completion control.
  std::vector<std::string> facets;
};
struct FixedFunction {
  const V4::Graph *graph=nullptr;
  const PublishedEffects *upper=nullptr;
  Protocol protocol;
};
using FixedFunctions=V4::Symbols<FixedFunction>;
struct PhysicalField {std::string id;std::optional<std::string> view;};
struct ActualShape {
  V4::TypeKind kind=V4::TypeKind::Future;
  // For Value this must enumerate ALL actual physical slots, including slots
  // absent from a narrower Source view. Absence of that authority yields Open.
  bool completePhysicalFields=false;
  std::vector<PhysicalField> fields;
};
enum class LocationKind {Parameter,Global,CaptureEntry,Local,Nonowning,Unknown,EntryProjection,CopiedValue,EnvironmentEntry,EnvironmentLocal,EnvironmentComponent,Code,Literal,ReceiverFrame,ReceiverError,CategorySelection};
struct LocationView {
  Ref id=0;
  LocationKind kind=LocationKind::Unknown;
  std::optional<llvm::StringRef> type,idLabel;
  Ref copySite=None,source=None,environment=None;
  std::optional<llvm::StringRef> layout,functionId;
};
struct Callbacks {
  Protocol rootProtocol;
  const V4::Environments *environments=nullptr;
  const V4::Symbols<V4::Construction> *constructions=nullptr;
  // Immutable complete admitted directories only. Callback work must use the
  // supplied shared Charge and must not throw or retain borrowed LocationViews.
  std::function<const ActualShape *(llvm::StringRef,const V4::Charge &)> actualType;
  // Optional actual/view field-address identity. Unknown/missing means mayMatch,
  // never distinct. Returned StringRef remains valid through this callback.
  std::function<std::optional<llvm::StringRef>(llvm::StringRef,llvm::StringRef,llvm::StringRef,const V4::Charge &)> projectField;
  // Missing means true. Returning false requires independent admitted evidence;
  // differing formal symbols alone do not establish actual non-aliasing.
  std::function<bool(const LocationView &,const LocationView &,const V4::Charge &)> mayAlias;
  bool settleIndependentLeaves=false;
};
struct Summary {
  // owners[node] and live[control] are root-context queries. Empty data is not
  // an unreachable continuation. Owner strings are conditional lexical roots.
  std::vector<V4::SymbolSet> owners;
  std::vector<bool> live,holdsEnvironment;
  // Root solution, including primitive data and control frames with no owner.
  std::vector<bool> populated,heapReady;
  std::array<V4::SymbolSet,3> effects; // Read, Write, Structural
  V4::SymbolSet facets,calls;
  bool normal=false,language=false;
};
struct SolveResult {Status status=Status::Open;Summary summary;const char *reason="unproved";};

namespace Detail {
using Set=std::set<Ref>;
struct Heap : std::map<Ref,Set> {
  std::size_t revision=0;
  std::map<const Heap *,std::size_t> incorporated;
};
using Key=std::vector<Ref>;
using Meter=V4::Detail::Meter;
struct Location {LocationKind kind=LocationKind::Unknown;Ref type=None,label=None,owner=None,site=None,layout=None,function=None,environment=None,source=None,creator=None;unsigned categories=7;bool receiverRoot=false;};
struct Binding {bool unbound=true;Set values;};
struct FrameWorld : std::map<Ref,Binding> {
  using Revisions=std::map<const FrameWorld *,std::size_t>;
  bool live=false;
  std::size_t revision=0;
  std::unique_ptr<Revisions> incorporated;
};
struct Address {Ref base=0,selector=0,view=0;};
struct CallInput {
  std::size_t cardinality=0,heapRevision=0,frameRevision=0;
  bool scheduled=false,isolated=false;
};
struct HeapInput {
  std::size_t cardinality=0,heapRevision=0,frameRevision=0;
  bool applied=false;
  bool operator==(const HeapInput &other) const{
    return applied==other.applied&&cardinality==other.cardinality&&
      heapRevision==other.heapRevision&&frameRevision==other.frameRevision;
  }
};
struct ExitInput {
  std::size_t heapRevision=None,frameRevision=None;
};
struct ValueInput {
  std::size_t cardinality=None,heapRevision=0;
};
struct InheritedInput {
  std::size_t effectCount=0,boundHistoryRevision=0,boundReceiverCount=0;
};
struct Context {
  enum class Sweep {Shared,Independent,Settled};
  Sweep sweep=Sweep::Shared;
  Ref index=0,function=None,scope=0;
  const V4::Graph *graph=nullptr;
  const PublishedEffects *upper=nullptr;
  const Protocol *protocol=nullptr;
  bool isolated=false;
  Ref scopedCall=None;
  Set environment;
  Set receivers,boundReceivers;
  // Keep each actual Frame's lifetime separate so child-call prefixes can be
  // inherited without attributing an independent nested new to receiver0.
  std::map<Ref,Set> boundHistory;
  std::size_t boundHistoryRevision=0;
  std::set<std::pair<Ref,Ref>> entrySources;
  std::vector<Set> arguments,values,targets;
  std::size_t captureTopologyRevision=0;
  std::vector<CallInput> callInputs;
  std::vector<ValueInput> valueInputs;
  Heap input,normalHeap,languageHeap;
  std::vector<Heap> heaps;
  std::vector<HeapInput> heapInputs;
  std::vector<bool> controls,ready,heapReady;
  FrameWorld inputFrames,normalFrames,languageFrames;
  std::vector<FrameWorld> frames;
  std::vector<Set> receiverValues;
  std::vector<bool> receiverLive;
  Set normal,language;
  bool normalLive=false,languageLive=false,normalReady=false,languageReady=false;
  std::array<std::vector<ExitInput>,2> exitInputs;
  std::array<Set,3> effects;
  Set facets,calls;
  std::unique_ptr<std::map<Ref,InheritedInput>> inheritedInputs;
};

class Solver {
  const V4::Graph &root_;
  const FixedFunctions &fixed_;
  const Callbacks &callbacks_;
  Meter m_;
  V4::Charge callbackCharge_;
  SolveResult result_;
  bool changed_=false;
  V4::Symbols<Ref> symbols_;
  std::vector<const std::string *> symbolNames_;
  std::map<const std::string *,Ref> graphSymbols_;
  std::map<Key,Ref> locationIds_,addressIds_,scopeIds_,siteIds_,contextIds_;
  std::vector<Location> locations_;
  std::optional<std::map<Ref,bool>> inlineTypes_;
  std::vector<Address> addresses_;
  std::map<Ref,Set> environmentParents_;
  std::map<Ref,Ref> slotOwners_;
  enum class ClosedEnvironment {None,Incoming,Activation,Delegated};
  struct ClosedProof {
    bool privateStorage=false;
    ClosedEnvironment returned=ClosedEnvironment::None;
    Ref scopedCall=None;
  };
  struct ClosedCall {
    const FixedFunction *member=nullptr;
    ClosedEnvironment environment=ClosedEnvironment::None;
  };
  struct ClosedWork {
    const FixedFunction *member=nullptr;
    const V4::Value *activation=nullptr;
    std::vector<ClosedCall> calls;
    std::size_t next=0;
  };
  std::map<const FixedFunction *,ClosedProof> closedRoutines_;
  struct CaptureRead {
    const CaptureAccess *access;
    std::size_t heapRevision,baseCount;
    Set values;
  };
  struct CaptureSource {
    Ref context;
    std::optional<Ref> heap;
    const Set *bases;
    std::unique_ptr<CaptureRead> read;
  };
  struct CaptureSourceMemo {
    std::vector<CaptureSource> sources;
    std::vector<std::pair<Ref,std::size_t>> dependencies;
  };
  std::optional<std::map<std::pair<Ref,Ref>,CaptureSourceMemo>> captureSourceMemo_;
  struct CaptureSlotKey {
    Ref layout;
    const std::string *key;
    bool operator<(const CaptureSlotKey &other) const{
      if(layout!=other.layout)return layout<other.layout;
      return std::less<const std::string *>{}(key,other.key);
    }
  };
  struct CaptureSlot {Ref label,type,selector,view;};
  std::optional<std::map<CaptureSlotKey,CaptureSlot>> captureSlots_;
  enum class Definition {Absent,Undefined,Defined};
  std::map<std::tuple<Ref,Ref,Ref,Ref>,Definition> definitionMemo_;
  std::vector<std::unique_ptr<Context>> contexts_;
  std::set<const V4::Graph *> checkedActivations_;
  std::vector<Set> rootArguments_;
  Ref initial_=0,element_=None,void_=None;

  bool open(const char *reason){result_.status=Status::Open;result_.reason=reason;return false;}
  bool active()const{return m_.good&&result_.status==Status::Solved;}
  bool numericLookup(std::size_t count,std::size_t width=1){
    std::size_t depth=1;for(auto n=count;n;n>>=1){if(!m_.spend())return false;depth+=2;}
    for(std::size_t i=0;i<depth;++i)if(!m_.spend(width+1))return false;return true;
  }
  bool number(Key &key,Ref value){return V4::Detail::push(key,value,m_);}
  bool key(Key &out,std::initializer_list<Ref> values){if(!V4::Detail::reserve(out,values.size(),m_))return false;for(auto value:values)if(!number(out,value))return false;return true;}
  llvm::StringRef name(Ref symbol)const{return *symbolNames_[symbol];}
  bool symbol(llvm::StringRef text,Ref &out){
    if(!m_.lookup(symbols_.size(),text.size()))return false;const auto found=symbols_.find(V4::Detail::view(text));
    if(found!=symbols_.end()){out=found->second;return true;}
    std::string copy;if(!m_.copy(copy,text)||!m_.spend()||!V4::Detail::room(symbolNames_,m_))return false;
    out=symbolNames_.size();const auto inserted=symbols_.emplace(std::move(copy),out);
    symbolNames_.push_back(&inserted.first->first);return true;
  }
  // Graph and protocol strings are immutable for the entire synchronous solve.
  bool graphSymbol(const std::string &text,Ref &out){
    if(!numericLookup(graphSymbols_.size()))return false;const auto found=graphSymbols_.lower_bound(&text);
    if(found!=graphSymbols_.end()&&found->first==&text){out=found->second;return true;}
    if(!symbol(text,out)||!m_.spend())return false;graphSymbols_.emplace_hint(found,&text,out);return true;
  }
  bool prefixed(llvm::StringRef prefix,llvm::StringRef text,Ref &out){
    if(!m_.text(prefix.size())||!m_.text(text.size())||!m_.spend(2))return false;
    std::string value;value.reserve(prefix.size()+text.size());value.append(prefix.data(),prefix.size());value.append(text.data(),text.size());return symbol(value,out);
  }
  bool parameterOwner(Ref index,Ref &out){if(!m_.spend(64))return false;const auto text=std::to_string(index);return prefixed("p:",text,out);}
  bool insert(Set &target,Ref value,bool lattice=true,bool prepayRelease=false){
    if(!numericLookup(target.size()))return false;if(target.find(value)!=target.end())return true;
    if(!m_.spend(prepayRelease?2:1))return false;target.insert(value);if(lattice)changed_=true;return true;
  }
  bool add(Set &target,const Set &source,bool lattice=true,bool prepayRelease=false){
    if(!m_.spend(source.size()))return false;
    for(auto value:source)if(!insert(target,value,lattice,prepayRelease))return false;
    return true;
  }
  bool growHeapRevision(Heap &heap){
    if(!m_.spend())return false;
    ++heap.revision;
    return true;
  }
  bool merge(Heap &target,const Heap &source){
    if(!m_.spend(source.size()))return false;
    bool grew=false;
    for(const auto &row:source){
      if(!numericLookup(target.size()))return false;auto found=target.find(row.first);
      if(found==target.end()){if(!m_.spend())return false;found=target.emplace(row.first,Set{}).first;changed_=true;grew=true;}
      const auto size=found->second.size();
      if(!add(found->second,row.second))return false;
      grew=grew||found->second.size()!=size;
    }
    return !grew||growHeapRevision(target);
  }
  bool mergePersistentHeap(Heap &target,const Heap &source){
    if(!m_.spend())return false;
    if(&target==&source||source.empty())return true;
    // These context heaps have stable addresses and only gain rows and values.
    // Growth in the target cannot invalidate an already incorporated source.
    if(!numericLookup(target.incorporated.size()))return false;
    const auto found=target.incorporated.lower_bound(&source);
    const bool recorded=found!=target.incorporated.end()&&found->first==&source;
    if(recorded&&found->second==source.revision)return true;
    if(!merge(target,source)||!m_.spend())return false;
    if(recorded)found->second=source.revision;
    else target.incorporated.emplace_hint(found,&source,source.revision);
    return true;
  }
  bool resolve(const Context &context,const std::vector<Ref> &refs,Set &out,bool lattice=false){
    if(!m_.spend(refs.size()))return false;
    for(auto ref:refs){
      const auto &source=context.values[ref];
      if(&source!=&out&&!add(out,source,lattice))return false;
    }
    return true;
  }
  bool operandCardinality(const Context &context,const std::vector<Ref> &refs,std::size_t &count){
    if(!m_.spend(2*refs.size()+1))return false;
    count=0;
    for(auto ref:refs)count+=context.values[ref].size();
    return true;
  }
  bool joinValue(Context &context,Ref index,const std::vector<Ref> &refs,Set &output){
    if(!m_.spend(2))return false;
    if(refs.empty())return true;
    if(refs.size()==1){
      if(!m_.spend(5))return false;
      const auto &source=context.values[refs.front()];
      // This output is a subset of its sole source, including a self-edge.
      return output.size()==source.size()||add(output,source);
    }
    std::size_t cardinality;
    if(!operandCardinality(context,refs,cardinality)||!m_.spend(3))return false;
    auto &previous=context.valueInputs[index].cardinality;
    if(previous==cardinality)return true;
    if(!resolve(context,refs,output,true)||!m_.spend())return false;
    previous=cardinality;
    return true;
  }
  bool internKey(std::map<Key,Ref> &rows,Key &&identity,Ref &out){
    if(!numericLookup(rows.size(),identity.size()))return false;auto found=rows.find(identity);
    if(found!=rows.end()){out=found->second;return true;}
    out=rows.size();if(!m_.spend())return false;rows.emplace(std::move(identity),out);return true;
  }
  bool location(Key &&identity,Location value,Ref &out){
    if(!numericLookup(locationIds_.size(),identity.size()))return false;const auto found=locationIds_.find(identity);
    if(found!=locationIds_.end()){out=found->second;return true;}
    if(locations_.size()>=65536)return open("return-origin-location-limit");
    if(!m_.spend()||!V4::Detail::room(locations_,m_))return false;out=locations_.size();
    locationIds_.emplace(std::move(identity),out);locations_.push_back(value);changed_=true;return true;
  }
  bool address(Ref base,Ref selector,Ref view,Ref &out){
    Key identity;if(!key(identity,{base,selector,view})||!numericLookup(addressIds_.size(),identity.size()))return false;
    const auto found=addressIds_.find(identity);if(found!=addressIds_.end()){out=found->second;return true;}
    if(addresses_.size()>=65536)return open("return-origin-address-limit");
    if(!m_.spend()||!V4::Detail::room(addresses_,m_))return false;out=addresses_.size();
    addressIds_.emplace(std::move(identity),out);addresses_.push_back({base,selector,view});changed_=true;return true;
  }
  bool put(Heap &heap,Ref base,Ref selector,Ref view,const Set &values){
    if(!m_.spend())return false;if(values.empty())return true;Ref id;if(!address(base,selector,view,id)||!numericLookup(heap.size()))return false;
    auto found=heap.find(id);if(found==heap.end()){if(!m_.spend())return false;found=heap.emplace(id,Set{}).first;changed_=true;}
    const auto size=found->second.size();
    if(!add(found->second,values))return false;
    return found->second.size()==size||growHeapRevision(heap);
  }
  const ActualShape *shape(Ref type){
    if(type==None){open("actual-type-open");return nullptr;}
    if(!callbacks_.actualType){open("actual-type-directory-open");return nullptr;}
    if(!m_.text(name(type).size())||!m_.spend())return nullptr;
    const auto *answer=callbacks_.actualType(name(type),callbackCharge_);
    if(!m_.good)return nullptr;if(!answer){open("actual-type-directory-open");return nullptr;}
    if(answer->kind==V4::TypeKind::Future||answer->kind==V4::TypeKind::Unknown||answer->kind==V4::TypeKind::Union){open("actual-tag-open");return nullptr;}return answer;
  }
  bool inlineLocation(Ref id,bool &answer){
    if(!m_.spend())return false;
    const auto value=locations_[id];
    answer=value.kind==LocationKind::CopiedValue;
    if(value.kind!=LocationKind::Local)return true;
    if(inlineTypes_){
      if(!numericLookup(inlineTypes_->size()))return false;
      const auto found=inlineTypes_->find(value.type);
      if(found!=inlineTypes_->end()){
        if(!m_.spend())return false;
        answer=found->second;
        return true;
      }
    }
    // Keep the first authority check and retain only its immutable verdict.
    const auto *actual=shape(value.type);
    if(!actual)return false;
    answer=actual->kind==V4::TypeKind::Value;
    if(!inlineTypes_){
      if(!m_.spend(2))return false;
      inlineTypes_.emplace();
    }
    if(!numericLookup(inlineTypes_->size())||!m_.spend(3))return false;
    inlineTypes_->emplace(value.type,answer);
    return true;
  }
  LocationView locationView(Ref id)const{
    const auto &value=locations_[id];LocationView out;out.id=id;out.kind=value.kind;out.copySite=value.site;
    if(value.type!=None)out.type=name(value.type);if(value.label!=None)out.idLabel=name(value.label);
    out.source=value.source;out.environment=value.environment;if(value.layout!=None)out.layout=name(value.layout);if(value.function!=None)out.functionId=name(value.function);return out;
  }
  static bool environmentKind(LocationKind kind){return kind==LocationKind::EnvironmentEntry||kind==LocationKind::EnvironmentLocal||kind==LocationKind::EnvironmentComponent;}
  bool protocolReady(const Protocol &protocol){if(!protocol.complete)return open("code-environment-metadata-open");if(protocol.kind==ProtocolKind::ConstructionFrame)return protocol.construction&&protocol.construction->receiverIndex==0?true:open("construction-catalogue-open");if(protocol.kind!=ProtocolKind::Ordinary||protocol.construction)return open("function-protocol-open");return true;}
  const FixedFunction *fixedProtocol(Ref id){if(!m_.lookup(fixed_.size(),name(id).size()))return nullptr;const auto found=fixed_.find(V4::Detail::view(name(id)));
    if(found==fixed_.end()){open("fixed-protocol-member-open");return nullptr;}if(!protocolReady(found->second.protocol))return nullptr;return &found->second;
  }
  const FixedFunction *fixedFunction(Ref id){const auto *member=fixedProtocol(id);if(!member)return nullptr;
    if(!member->graph||!member->upper){open("fixed-contract-member-open");return nullptr;}if(member->graph->version!=5){open("graph5-only");return nullptr;}return member;
  }
  const V4::EnvironmentRow *layout(Ref id){if(id==None||!callbacks_.environments){open("environment-directory-open");return nullptr;}
    if(!m_.lookup(callbacks_.environments->size(),name(id).size()))return nullptr;const auto found=callbacks_.environments->find(V4::Detail::view(name(id)));if(found==callbacks_.environments->end()){open("environment-layout-open");return nullptr;}return &found->second;
  }
  bool parents(Ref id,Set *&out){if(!numericLookup(environmentParents_.size()))return false;auto found=environmentParents_.find(id);if(found==environmentParents_.end()){if(!m_.spend())return false;found=environmentParents_.emplace(id,Set{}).first;}out=&found->second;return true;}
  bool entryEnvironment(Ref id,Ref &out){const auto *row=layout(id);if(!row)return false;Key identity;Location value;value.kind=LocationKind::EnvironmentEntry;value.layout=id;
    if(!key(identity,{9,id})||!location(std::move(identity),value,out))return false;Set *selected;if(!parents(out,selected))return false;
    if(row->parent){Ref parent,actual;if(!symbol(*row->parent,parent)||!entryEnvironment(parent,actual)||!insert(*selected,actual))return false;}return true;
  }
  bool componentEnvironment(Ref source,Ref function,Ref id,Ref &out){const auto *row=layout(id);if(!row)return false;Key identity;Location value;value.kind=LocationKind::EnvironmentComponent;value.layout=id;value.function=function;value.source=source;value.owner=locations_[source].owner;
    if(!key(identity,{10,source,function,id})||!location(std::move(identity),value,out))return false;Set *selected;if(!parents(out,selected))return false;
    if(row->parent){Ref parent,actual;if(!symbol(*row->parent,parent)||!componentEnvironment(source,function,parent,actual)||!insert(*selected,actual))return false;}return true;
  }
  bool selectEnvironments(const Set &bases,Ref target,Set &out){std::vector<Ref> pending;Set seen;
    if(!V4::Detail::reserve(pending,bases.size(),m_))return false;for(auto id:bases)if(!V4::Detail::push(pending,id,m_))return false;
    while(!pending.empty()){if(!m_.spend())return false;const auto id=pending.back();pending.pop_back();if(!numericLookup(seen.size()))return false;if(seen.find(id)!=seen.end())continue;if(!insert(seen,id,false))return false;const auto node=locations_[id];
      if(!environmentKind(node.kind))return open("environment-source-open");if(node.layout==target){if(!insert(out,id,false))return false;continue;}
      const auto *row=layout(node.layout);if(!row)return false;if(!row->parent)return open("environment-parent-layout-open");Ref expected;if(!symbol(*row->parent,expected)||!numericLookup(environmentParents_.size()))return false;
      const auto found=environmentParents_.find(id);if(found!=environmentParents_.end())for(auto parent:found->second){if(!m_.spend())return false;if(locations_[parent].layout!=expected)return open("environment-parent-identity-open");if(!V4::Detail::push(pending,parent,m_))return false;}
    }return true;
  }
  bool environmentAlias(Ref left,Ref right,bool &answer){if(!m_.spend())return false;const auto a=locations_[left],b=locations_[right];answer=left==right||(environmentKind(a.kind)&&environmentKind(b.kind)&&a.layout==b.layout&&(a.kind!=LocationKind::EnvironmentLocal||b.kind!=LocationKind::EnvironmentLocal));return true;}
  bool directCaptureEnvironments(const Set &bases,Ref layoutId,bool &direct){
    // Exact-layout bases never read the growing Env-parent relation.
    if(!m_.spend(bases.size()+1))return false;
    direct=true;
    for(auto base:bases){
      if(!m_.spend(3))return false;
      const auto &value=locations_[base];
      if(value.layout!=layoutId||!environmentKind(value.kind)){direct=false;break;}
    }
    return true;
  }
  bool captureValues(const Heap &heap,const Set &bases,Ref layoutId,const std::string &key,Set &out,bool prepayRelease=false){
    // SlotKey strings belong to immutable graph nodes, fixed upper effects,
    // or environment rows. Only their declaration lookup is reusable.
    if(!captureSlots_){
      if(!m_.spend(2))return false;
      captureSlots_.emplace();
    }
    auto &slots=*captureSlots_;
    // A debug comparison can also compare the two keys in reverse.
    if(!m_.spend(5)||!numericLookup(slots.size(),4))return false;
    const CaptureSlotKey signature{layoutId,&key};
    auto found=slots.lower_bound(signature);
    const bool known=found!=slots.end()&&found->first.layout==layoutId&&found->first.key==&key;
    const V4::EnvironmentSlot *declaration=nullptr;
    if(!known){
      const auto *row=layout(layoutId);if(!row)return false;
      for(const auto &candidate:row->slots){
        if(!m_.spend())return false;
        if(m_.equal(candidate.key,key)){declaration=&candidate;break;}
        if(!m_.good)return false;
      }
      if(!declaration)return open("capture-slot-open");
    }
    Set selected;if(!selectEnvironments(bases,layoutId,selected))return false;
    if(!known){
      CaptureSlot slot;
      if(!symbol(key,slot.label)||!symbol(declaration->type,slot.type)||
         !prefixed("capture:",key,slot.selector)||!prefixed("env:",name(layoutId),slot.view))return false;
      // Prepay the node, six fields and the hinted insertion comparisons.
      if(!m_.spend(15))return false;
      found=slots.emplace_hint(found,signature,slot);
    }
    if(!m_.spend(4))return false;
    const auto [label,type,selector,view]=found->second;
    for(auto base:selected){if(!m_.spend())return false;const auto node=locations_[base];
      if(node.kind==LocationKind::EnvironmentEntry||node.kind==LocationKind::EnvironmentComponent){Location value;value.kind=node.kind==LocationKind::EnvironmentEntry?LocationKind::CaptureEntry:LocationKind::EntryProjection;value.type=type;value.label=label;value.owner=node.owner;
        if(node.kind==LocationKind::EnvironmentEntry&&!prefixed("c:",key,value.owner))return false;Key identity;Ref result;if(!this->key(identity,{11,base,label})||!location(std::move(identity),value,result)||!insert(out,result,false,prepayRelease))return false;}
      if(!m_.spend(heap.size()))return false;for(const auto &entry:heap){const auto stored=addresses_[entry.first];if(stored.selector!=selector||stored.view!=view)continue;bool alias;if(!environmentAlias(base,stored.base,alias))return false;if(alias&&!add(out,entry.second,false,prepayRelease))return false;}
    }return true;
  }
  bool readyRefs(const Context &context,const std::vector<Ref> &refs,bool &answer){answer=true;if(!m_.spend(refs.size()))return false;for(auto id:refs){if(!m_.spend())return false;if(!context.ready[id])answer=false;}return true;}
  bool ready(std::vector<bool> &flags,Ref id,bool value){if(!m_.spend())return false;if(value&&!flags[id]){flags[id]=true;changed_=true;}return true;}
  bool formalCode(Ref id){const auto &value=locations_[id];return (value.kind==LocationKind::Parameter||value.kind==LocationKind::Global||value.kind==LocationKind::CaptureEntry||value.kind==LocationKind::EntryProjection)&&value.owner!=None;}
  bool aliases(Ref a,Ref b,bool &answer){
    if(!m_.spend())return false;const auto x=locations_[a],y=locations_[b];
    if(x.kind==LocationKind::Nonowning||y.kind==LocationKind::Nonowning||x.kind==LocationKind::Literal||y.kind==LocationKind::Literal){answer=false;return true;}
    if(environmentKind(x.kind)||environmentKind(y.kind)){answer=environmentKind(x.kind)&&environmentKind(y.kind)&&a==b;return true;}
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
    if(selected.kind!=LocationKind::Local&&selected.kind!=LocationKind::CopiedValue&&selected.kind!=LocationKind::Nonowning&&selected.kind!=LocationKind::Literal){
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
    Key identity;Location value{LocationKind::CopiedValue,type,None,owner,site};value.categories=1;return key(identity,{8,site,type})&&location(std::move(identity),value,out);
  }
  bool site(const Context &context,const std::string &source,Ref &out){
    Ref label;if(!graphSymbol(source,label))return false;Key identity;return key(identity,{context.scope,context.function,label})&&internKey(siteIds_,std::move(identity),out);
  }
  bool mergeFrames(FrameWorld &out,const FrameWorld &source,bool lattice=true){
    if(!m_.spend())return false;if(!source.live)return true;const bool first=!out.live;
    bool grew=first;
    if(first)out.live=true;
    else for(auto &[frame,binding]:out){
      if(!m_.spend()||!numericLookup(source.size()))return false;
      if(source.find(frame)==source.end()&&!binding.unbound){binding.unbound=true;grew=true;}
    }
    if(!m_.spend(source.size()))return false;for(const auto &[frame,binding]:source){
      if(!numericLookup(out.size()))return false;auto found=out.find(frame);
      if(found==out.end()){if(!m_.spend())return false;found=out.emplace(frame,Binding{first?binding.unbound:true,{}}).first;grew=true;}
      else if(binding.unbound&&!found->second.unbound){found->second.unbound=true;grew=true;}
      const auto size=found->second.values.size();
      if(!add(found->second.values,binding.values,lattice))return false;
      grew=grew||size!=found->second.values.size();
    }
    // Call stamps read persistent context worlds after these joins.
    if(lattice&&grew){
      if(!m_.spend())return false;
      ++out.revision;
      changed_=true;
    }
    return true;
  }
  bool mergePersistentFrames(FrameWorld &out,const FrameWorld &source){
    if(!m_.spend())return false;
    if(&out==&source||!source.live)return true;
    if(out.empty()&&source.empty())return out.live||mergeFrames(out,source);
    // Only solver-owned worlds enter this table. A row added after the first
    // live join is already maybe-unbound, so replaying an unchanged source
    // cannot widen the destination after another source adds a row.
    if(!out.incorporated){
      if(!m_.spend(2))return false;
      out.incorporated=std::make_unique<FrameWorld::Revisions>();
    }
    auto &revisions=*out.incorporated;
    if(!numericLookup(revisions.size()))return false;
    const auto found=revisions.find(&source);
    const bool recorded=found!=revisions.end();
    const auto revision=source.revision;
    if(recorded&&found->second==revision)return true;
    if(!mergeFrames(out,source)||!m_.spend())return false;
    if(recorded)found->second=revision;
    else{
      if(!numericLookup(revisions.size()))return false;
      revisions.emplace(&source,revision);
    }
    return true;
  }
  bool frameIdentity(const Context &context,Ref index,Ref construction,Ref target,Ref parent,Ref &out,bool root=false){
    Key identity;Location value;value.kind=LocationKind::ReceiverFrame;value.label=construction;value.type=target;value.source=parent;value.categories=0;
    value.receiverRoot=root;return key(identity,{20,context.index,context.function,context.scope,index,construction,target,parent,root})&&location(std::move(identity),value,out);
  }
  bool recordBoundReceiver(Context &context,Ref frame,const Set &values){
    if(context.receivers.empty()||values.empty())return true;
    auto &history=context.boundHistory;
    if(!numericLookup(history.size()))return false;
    auto found=history.find(frame);
    // An admitted row already proved ownership against the immutable frame
    // ancestry and this context's immutable receiver set.
    if(found==history.end()){
      bool owned=false;
      for(auto current=frame;current!=None;current=locations_[current].source){
        if(!m_.spend()||!numericLookup(context.receivers.size()))return false;
        if(locations_[current].kind!=LocationKind::ReceiverFrame)return open("receiver-history-frame-open");
        if(context.receivers.count(current)){owned=true;break;}
      }
      if(!owned)return true;
      if(!numericLookup(history.size())||!m_.spend(3))return false;
      found=history.try_emplace(frame).first;
    }
    if(!m_.spend(2))return false;
    const auto size=found->second.size();
    if(!add(found->second,values))return false;
    if(found->second.size()==size)return true;
    if(!add(context.boundReceivers,values)||!m_.spend())return false;
    ++context.boundHistoryRevision;
    return true;
  }
  bool recordBoundWorld(Context &context,const FrameWorld &world){
    if(context.receivers.empty()||!world.live)return true;if(!m_.spend(world.size()))return false;
    for(const auto &[frame,binding]:world)if(!m_.spend()||!recordBoundReceiver(context,frame,binding.values))return false;
    return true;
  }
  const V4::Construction *construction(Ref id){
    if(!callbacks_.constructions){open("construction-directory-open");return nullptr;}
    if(!m_.lookup(callbacks_.constructions->size(),name(id).size()))return nullptr;const auto found=callbacks_.constructions->find(V4::Detail::view(name(id)));
    if(found==callbacks_.constructions->end()){open("construction-owner-open");return nullptr;}return &found->second;
  }
  bool derives(const V4::Construction &candidate,llvm::StringRef owner,bool &answer){
    const auto *row=&candidate;answer=false;
    while(row){if(!m_.equal(row->owner,owner)){
        if(!m_.good)return false;if(!row->base)return true;const auto base=llvm::StringRef(*row->base);row=nullptr;
        for(const auto &[id,next]:*callbacks_.constructions){if(!m_.spend())return false;if(m_.equal(next.owner,base)){row=&next;break;}if(!m_.good)return false;}
      }else{answer=true;return true;}}
    return open("construction-base-directory-open");
  }
  bool contextKey(Ref function,Ref scope,const std::vector<Set> &arguments,const Set &environment,const Heap &input,const Set &receivers,const FrameWorld &frames,Key &out){
    if(!key(out,{function,scope,arguments.size()})||!m_.spend(arguments.size()))return false;
    for(const auto &values:arguments){if(!number(out,values.size())||!m_.spend(values.size()))return false;for(auto value:values)if(!number(out,value))return false;}
    if(!number(out,environment.size())||!m_.spend(environment.size()))return false;for(auto id:environment)if(!number(out,id))return false;
    if(!number(out,input.size())||!m_.spend(input.size()))return false;
    for(const auto &row:input){if(!number(out,row.first)||!number(out,row.second.size())||!m_.spend(row.second.size()))return false;for(auto value:row.second)if(!number(out,value))return false;}
    if(!number(out,receivers.size())||!m_.spend(receivers.size()))return false;for(auto receiver:receivers)if(!number(out,receiver))return false;
    if(!number(out,frames.live)||!number(out,frames.size())||!m_.spend(frames.size()))return false;
    for(const auto &[frame,binding]:frames){if(!number(out,frame)||!number(out,binding.unbound)||!number(out,binding.values.size())||!m_.spend(binding.values.size()))return false;for(auto value:binding.values)if(!number(out,value))return false;}return true;
  }
  bool remember(Context &context,Ref caller,Ref heap){if(caller==None)return true;const auto source=std::make_pair(caller,heap);
    if(!numericLookup(context.entrySources.size(),2))return false;if(context.entrySources.find(source)==context.entrySources.end()){if(!m_.spend())return false;context.entrySources.insert(source);changed_=true;}return true;
  }
  bool ensure(Ref function,Ref scope,const std::vector<Set> &arguments,const Set &environment,const Heap &input,Ref &out,Ref caller=None,Ref savedHeap=0,const Set &receivers={},const FrameWorld &frames={},bool isolated=false,Ref scopedCall=None){
    Key identity;if(!contextKey(function,scope,arguments,environment,input,receivers,frames,identity)||!numericLookup(contextIds_.size(),identity.size()))return false;
    const auto found=contextIds_.find(identity);if(found!=contextIds_.end()){out=found->second;return remember(*contexts_[out],caller,savedHeap);}
    const V4::Graph *graph=&root_;const PublishedEffects *upper=nullptr;const Protocol *protocol=&callbacks_.rootProtocol;
    if(function!=None){const auto *member=fixedFunction(function);if(!member)return false;graph=member->graph;upper=member->upper;protocol=&member->protocol;
      if(upper->parameters.size()!=arguments.size())return open("fixed-parameter-vector-open");}
    if(graph->version!=5)return open("graph5-only");if(!protocolReady(*protocol))return false;if(contexts_.size()>=65536)return open("return-origin-context-limit");
    if(bool(protocol->construction)!=!receivers.empty())return open("constructor-receiver-context-open");
    if(!numericLookup(checkedActivations_.size()))return false;
    if(checkedActivations_.find(graph)==checkedActivations_.end()){
      bool acyclic;if(!V4::Detail::receiverActivations(*graph,m_,acyclic))return false;
      if(!acyclic)return open("repeated-receiver-frame-activation");if(!m_.spend())return false;checkedActivations_.insert(graph);
    }
    if(!m_.spend(graph->nodes.size()*2)||!m_.spend(graph->heaps.size()*5+9)||!m_.spend(graph->controls.size())||!m_.spend(graph->calls.size()*6)||!m_.spend(arguments.size())||!m_.spend(13))return false;
    auto value=std::make_unique<Context>();value->index=contexts_.size();value->function=function;value->scope=scope;value->graph=graph;value->upper=upper;value->protocol=protocol;value->isolated=isolated;value->scopedCall=scopedCall;
    if(callbacks_.settleIndependentLeaves&&function!=None){
      if(!m_.spend(6))return false;
      if(graph->calls.empty()&&!protocol->lexicalEnvironment&&!protocol->activationEnvironment){
        value->sweep=Context::Sweep::Independent;
        for(const auto &node:graph->nodes){
          if(!m_.spend(3))return false;
          if(environmentValue(node.kind)){value->sweep=Context::Sweep::Shared;break;}
        }
      }
    }
    value->values.resize(graph->nodes.size());value->ready.resize(graph->nodes.size(),false);value->heaps.resize(graph->heaps.size());value->heapReady.resize(graph->heaps.size(),false);value->controls.resize(graph->controls.size(),false);value->targets.resize(graph->calls.size());value->arguments.resize(arguments.size());
    if(!m_.spend(graph->heaps.size()*4))return false;value->frames.resize(graph->heaps.size());value->receiverValues.resize(graph->heaps.size());value->receiverLive.resize(graph->heaps.size(),false);
    if(!m_.spend(graph->heaps.size()*4))return false;
    value->heapInputs.resize(graph->heaps.size());
    value->callInputs.resize(graph->calls.size());
    if(!m_.spend(2*graph->nodes.size()+1))return false;
    value->valueInputs.resize(graph->nodes.size());
    if(!m_.spend(2*(graph->exits.normal.size()+graph->exits.language.size())))return false;
    value->exitInputs[0].resize(graph->exits.normal.size());
    value->exitInputs[1].resize(graph->exits.language.size());
    for(Ref i=0;i<arguments.size();++i)if(!m_.spend()||!add(value->arguments[i],arguments[i]))return false;
    if(!add(value->environment,environment)||!add(value->receivers,receivers)||!mergeFrames(value->inputFrames,frames)||!merge(value->input,input)||!remember(*value,caller,savedHeap)||!m_.spend()||!V4::Detail::room(contexts_,m_))return false;
    value->inputFrames.live=true;
    for(auto receiver:receivers){if(!m_.spend()||!numericLookup(value->inputFrames.size()))return false;
      if(value->inputFrames.find(receiver)==value->inputFrames.end()){if(!m_.spend())return false;value->inputFrames.emplace(receiver,Binding{});}}
    if(!recordBoundWorld(*value,value->inputFrames))return false;
    out=value->index;contextIds_.emplace(std::move(identity),out);contexts_.push_back(std::move(value));changed_=true;return true;
  }
  bool effect(Context &context,V4::AccessFlag flag,Ref owner){return insert(context.effects[static_cast<std::size_t>(flag)],owner);}
  bool valueEffects(Context &context,V4::AccessFlag flag,const Set &values){
    if(!m_.spend(values.size()))return false;for(auto id:values)if(locations_[id].owner!=None&&!effect(context,flag,locations_[id].owner))return false;return true;
  }
  bool flagged(Context &context,const Flags &flags,const Set &values){
    return m_.spend(3)&&(!flags.read||valueEffects(context,V4::AccessFlag::Read,values))&&(!flags.write||valueEffects(context,V4::AccessFlag::Write,values))&&(!flags.structural||valueEffects(context,V4::AccessFlag::Structural,values));
  }
  bool ownerFlags(Context &context,const Flags &flags,Ref owner){
    return m_.spend(3)&&(!flags.read||effect(context,V4::AccessFlag::Read,owner))&&(!flags.write||effect(context,V4::AccessFlag::Write,owner))&&(!flags.structural||effect(context,V4::AccessFlag::Structural,owner));
  }
  bool resourceEffects(Context &context,const ResourceAccess &resources,llvm::StringRef prefix){
    if(!m_.spend(resources.reads.size())||!m_.spend(resources.writes.size()))return false;
    for(const auto &id:resources.reads){Ref owner;if(!prefixed(prefix,id,owner)||!effect(context,V4::AccessFlag::Read,owner))return false;}
    for(const auto &id:resources.writes){Ref owner;if(!prefixed(prefix,id,owner)||!effect(context,V4::AccessFlag::Write,owner))return false;}return true;
  }
  // Stable capture permissions summarize the entire fixed call closure,
  // including a callee's own activation and descendants. Resolve each payload
  // in its actual saved context, never in a guessed immediate lexical Env.
  bool captureSources(const Context &called,const std::string &key,Ref &selected,
      std::vector<CaptureSource> *&out){
    Ref slot;if(!graphSymbol(key,slot)||!numericLookup(slotOwners_.size()))return false;const auto owned=slotOwners_.find(slot);
    if(owned==slotOwners_.end())return open("fixed-capture-slot-unowned");selected=owned->second;
    if(!captureSourceMemo_){
      if(!m_.spend(2))return false;
      captureSourceMemo_.emplace();
    }
    auto &memo=*captureSourceMemo_;
    if(!m_.spend(2)||!numericLookup(memo.size(),2))return false;
    const auto signature=std::make_pair(called.index,selected);
    auto found=memo.find(signature);
    if(found!=memo.end()){
      bool current=true;
      for(const auto &[index,revision]:found->second.dependencies){
        if(!m_.spend(2))return false;
        if(contexts_[index]->captureTopologyRevision!=revision){current=false;break;}
      }
      if(current){
        if(!m_.spend())return false;
        out=&found->second.sources;
        return true;
      }
    }
    // Only target edges and control reachability change the source list.
    // Source sets and heap rows are still read at their current versions.
    if(!m_.spend(2))return false;
    CaptureSourceMemo rebuilt;
    std::vector<Ref> pending;Set seen;if(!V4::Detail::push(pending,called.index,m_))return false;
    const auto append=[&](const Context &context,std::optional<Ref> heap,const Set &bases){
      // Pay this source row's release before it enters the topology memo.
      if(!m_.spend(5)||!V4::Detail::room(rebuilt.sources,m_))return false;
      rebuilt.sources.push_back({context.index,heap,&bases,{}});
      return true;
    };
    while(!pending.empty()){
      if(!m_.spend())return false;const auto index=pending.back();pending.pop_back();if(!numericLookup(seen.size()))return false;
      if(seen.find(index)!=seen.end())continue;if(!insert(seen,index,false))return false;const auto &current=*contexts_[index];
      if(!m_.spend()||!V4::Detail::push(rebuilt.dependencies,std::make_pair(index,current.captureTopologyRevision),m_))return false;
      Ref lexical=None;if(current.protocol->lexicalEnvironment&&!symbol(*current.protocol->lexicalEnvironment,lexical))return false;
      while(lexical!=None){if(!m_.spend())return false;if(lexical==selected){if(!append(current,std::nullopt,current.environment))return false;break;}
        const auto *row=layout(lexical);if(!row)return false;if(row->parent){if(!symbol(*row->parent,lexical))return false;}else lexical=None;}
      Ref activation=None;if(current.protocol->activationEnvironment&&!symbol(*current.protocol->activationEnvironment,activation))return false;
      if(activation==selected){if(!m_.spend(current.graph->nodes.size()))return false;
        for(Ref value=0;value<current.graph->nodes.size();++value){if(!m_.spend())return false;const auto &node=current.graph->nodes[value];
          if(node.kind!=V4::ValueKind::EnvironmentCreate||!current.controls[node.control])continue;Ref created;if(!symbol(node.layout,created))return false;if(created!=selected)continue;
          for(auto completion:{V4::Completion::Normal,V4::Completion::Language})for(const auto &state:V4::Detail::exits(*current.graph,completion)){
            if(!m_.spend())return false;if(current.controls[state.control]&&!append(current,state.heap,current.values[value]))return false;}
        }
      }
      if(!m_.spend(current.targets.size()))return false;for(const auto &targets:current.targets){if(!m_.spend(targets.size()))return false;for(auto target:targets)if(!V4::Detail::push(pending,target,m_))return false;}
    }
    if(found==memo.end()){
      if(!numericLookup(memo.size(),2)||!m_.spend(5))return false;
      found=memo.emplace(signature,std::move(rebuilt)).first;
    }else{
      if(!m_.spend(2))return false;
      found->second=std::move(rebuilt);
    }
    if(!m_.spend())return false;
    out=&found->second.sources;
    return true;
  }
  bool inheritCapture(Context &context,const CaptureAccess &capture,CaptureSource &source,Ref layoutId){
    if(!m_.spend(8))return false;
    const auto &saved=*contexts_[source.context];
    const auto &heap=source.heap?saved.heaps[*source.heap]:saved.input;
    const auto &bases=*source.bases;
    const auto revision=heap.revision,count=bases.size();
    const bool sameSlot=source.read&&source.read->access==&capture;
    if(sameSlot&&source.read->heapRevision==revision&&source.read->baseCount==count)
      return flagged(context,capture.flags,source.read->values);
    Set values;
    if(!captureValues(heap,bases,layoutId,capture.slot,values,/*prepayRelease=*/true)||!flagged(context,capture.flags,values))return false;
    // The topology memo owns this source row. Share its first proven slot
    // read across callers and keep each caller's effect transfer independent.
    if(!source.read||sameSlot){
      bool direct;
      if(!directCaptureEnvironments(bases,layoutId,direct))return false;
      if(direct){
        // Values paid release on insertion. A new read record also pays its release.
        if(!m_.spend(source.read?5:8))return false;
        CaptureRead read{&capture,revision,count,std::move(values)};
        if(source.read)*source.read=std::move(read);
        else source.read=std::make_unique<CaptureRead>(std::move(read));
      }
    }
    return true;
  }
  bool inherit(Context &context,const Context &called){
    if(!m_.spend(8))return false;
    if(!context.inheritedInputs){
      if(!m_.spend(2))return false;
      context.inheritedInputs=std::make_unique<std::map<Ref,InheritedInput>>();
    }
    auto &inputs=*context.inheritedInputs;
    if(!numericLookup(inputs.size()))return false;
    const auto found=inputs.lower_bound(called.index);
    const bool first=found==inputs.end()||found->first!=called.index;
    const auto &upper=*called.upper;
    const bool history=!context.receivers.empty();
    const bool receiverParameter=called.protocol->construction&&!upper.parameters.empty();
    // Each effect set only grows. Read the total before transferring, since
    // the caller and callee can be the same context.
    const InheritedInput input{
      called.effects[0].size()+called.effects[1].size()+called.effects[2].size()+called.facets.size()+called.calls.size(),
      history?called.boundHistoryRevision:0,
      receiverParameter?called.boundReceivers.size():0
    };
    if(!first&&!m_.spend(3))return false;
    const bool historyChanged=history&&(first||found->second.boundHistoryRevision!=input.boundHistoryRevision);
    const bool effectsChanged=first||found->second.effectCount!=input.effectCount;
    const bool receiverChanged=receiverParameter&&(first||found->second.boundReceiverCount!=input.boundReceiverCount);
    if(historyChanged){
      if(!m_.spend(called.boundHistory.size()))return false;
      for(const auto &[frame,values]:called.boundHistory)if(!m_.spend()||!recordBoundReceiver(context,frame,values))return false;
    }
    if(effectsChanged){
      for(Ref i=0;i<3;++i)if(!m_.spend()||!add(context.effects[i],called.effects[i]))return false;
      if(!add(context.facets,called.facets)||!add(context.calls,called.calls))return false;
    }
    if(first){
      if(!insert(context.calls,called.function)||!m_.spend(upper.parameters.size())||!m_.spend(upper.facets.size()))return false;
      for(Ref i=0;i<upper.parameters.size();++i)
        if(!flagged(context,upper.parameters[i],receiverParameter&&i==0?called.boundReceivers:called.arguments[i]))return false;
    }else if(receiverChanged&&(!m_.spend()||!flagged(context,upper.parameters.front(),called.boundReceivers)))return false;
    // Capture sources depend on live Env parents and reachable descendants.
    if(!m_.spend(upper.captures.size()))return false;
    for(const auto &capture:upper.captures){if(!m_.spend(3))return false;if(!capture.flags.read&&!capture.flags.write&&!capture.flags.structural)continue;
      Ref selected;std::vector<CaptureSource> *sources;
      if(!captureSources(called,capture.slot,selected,sources)||!m_.spend(sources->size()))return false;
      for(auto &source:*sources)if(!inheritCapture(context,capture,source,selected))return false;
    }

    if(first){
      if(!resourceEffects(context,upper.globals,"g:")||!resourceEffects(context,upper.hostResources,"h:"))return false;
      for(const auto &facet:upper.facets){if(!m_.text(facet.size()))return false;if(!m_.equal(facet,"mayThrow")){if(!m_.good)return false;Ref id;if(!symbol(facet,id)||!insert(context.facets,id))return false;}}
    }
    if(historyChanged||effectsChanged||receiverChanged){
      // lower_bound supplied the correct hint, so insertion needs only
      // neighboring key comparisons in addition to the new node.
      if(!m_.spend(first?9:3))return false;
      if(first)inputs.emplace_hint(found,called.index,input);
      else found->second=input;
    }
    return true;
  }

  bool readonlyAlternative(const V4::Call &call,const FixedFunction &fixed,Ref function,const Set &codes,bool &eligible){
    eligible=false;const auto &upper=*fixed.upper;
    if(!call.callee||call.receiver||call.environment||fixed.protocol.lexicalEnvironment||fixed.protocol.construction||codes.empty()||
        !upper.captures.empty()||!upper.globals.writes.empty()||!upper.hostResources.reads.empty()||!upper.hostResources.writes.empty()||
        upper.parameters.size()!=call.arguments.size())return true;
    for(const auto &parameter:upper.parameters){if(!m_.spend())return false;if(parameter.write||parameter.structural)return true;}
    for(const auto &facet:upper.facets){if(!m_.equal(facet,"managedReference"))return m_.good;}
    for(auto id:codes){if(!m_.spend())return false;const auto &code=locations_[id];if(code.kind!=LocationKind::Code||code.function==function)return true;}
    eligible=true;return true;
  }
  bool inheritReadonlyAlternative(Context &context,Ref function,const PublishedEffects &upper,const std::vector<Set> &arguments){
    if(!insert(context.calls,function)||!resourceEffects(context,upper.globals,"g:"))return false;
    for(Ref i=0;i<arguments.size();++i)if(!flagged(context,upper.parameters[i],arguments[i]))return false;
    for(const auto &facet:upper.facets){Ref id;if(!symbol(facet,id)||!insert(context.facets,id))return false;}
    return true;
  }
  llvm::StringRef indirectOccurrence(const V4::Call &call){
    llvm::StringRef site=call.site;if(!m_.text(site.size())||!m_.text(call.functionId.size()))return {};
    if(!site.consume_front("[\"")||!site.consume_front(call.functionId)||!site.consume_front("\""))return {};
    const auto occurrence=site;uint32_t start,end;
    if(!site.consume_front(",")||site.consumeInteger(10,start)||!site.consume_front(",")||site.consumeInteger(10,end)||
        start>=end||site!=",\"indirectCall\"]")return {};
    return occurrence;
  }
  bool sameOccurrenceWitness(const Context &context,const V4::Call &call,const Set &codes,bool &covered){
    covered=false;const auto occurrence=indirectOccurrence(call);if(!m_.good)return false;if(occurrence.empty())return true;
    bool ready;if(!readyRefs(context,*call.callee,ready))return false;if(!ready||!context.heapReady[call.heap])return true;
    size_t argumentWork=call.arguments.size()+call.callee->size();
    for(const auto &argument:call.arguments){if(!readyRefs(context,argument,ready))return false;if(!ready)return true;argumentWork+=argument.size();}
    Set scheduled;const auto &calls=context.graph->calls;
    for(Ref i=0;i<calls.size();++i){
      if(!m_.spend())return false;const auto &other=calls[i];
      if(context.targets[i].empty()||!other.callee||other.receiver||other.heap!=call.heap||other.control!=call.control)continue;
      const auto otherOccurrence=indirectOccurrence(other);if(!m_.good)return false;
      if(!m_.equal(occurrence,otherOccurrence)){if(!m_.good)return false;continue;}
      if(!m_.spend(argumentWork+1))return false;if(*other.callee!=*call.callee||other.arguments!=call.arguments)continue;
      Ref function;if(!symbol(other.functionId,function)||!insert(scheduled,function,false))return false;
    }
    for(auto id:codes){if(!numericLookup(scheduled.size()))return false;if(!scheduled.count(locations_[id].function))return true;}
    covered=true;return true;
  }

  template<class Accept>
  bool allClosedLeaves(const V4::Graph &graph,const std::vector<Ref> &roots,Accept accept,bool &answer){
    using Kind=V4::ValueKind;
    answer=false;
    if(!m_.spend(roots.size()))return false;
    std::vector<Ref> pending=roots;
    Set seen;
    bool leaf=false;
    while(!pending.empty()){
      const auto id=pending.back();pending.pop_back();
      if(!m_.spend()||!numericLookup(seen.size()))return false;
      if(!seen.insert(id).second)continue;
      const auto &node=graph.nodes[id];
      const auto *inputs=node.kind==Kind::Join||node.kind==Kind::Gate?&node.inputs:node.kind==Kind::Copy?&node.bases:nullptr;
      if(inputs){
        if(inputs->empty())return true;
        for(auto input:*inputs)if(!V4::Detail::push(pending,input,m_))return false;
      }else{
        bool accepted;
        if(!accept(node,accepted))return false;
        if(!accepted)return true;
        leaf=true;
      }
    }
    answer=leaf;return true;
  }

  bool closedMember(llvm::StringRef id,const FixedFunction *&member){
    if(!m_.lookup(fixed_.size(),id.size()))return false;
    const auto found=fixed_.find(V4::Detail::view(id));
    member=found==fixed_.end()?nullptr:&found->second;
    return true;
  }

  bool closedActivation(ClosedWork &work,bool &accepted){
    accepted=false;
    const auto &graph=*work.member->graph;
    const auto &protocol=work.member->protocol;
    for(const auto &node:graph.nodes){
      if(!m_.spend())return false;
      if(node.kind!=V4::ValueKind::EnvironmentCreate)continue;
      if(work.activation||!protocol.activationEnvironment||
          graph.controls[node.control].kind!=V4::ControlKind::Entry||
          node.parent.has_value()!=protocol.lexicalEnvironment.has_value())return true;
      if(!m_.equal(node.layout,*protocol.activationEnvironment))return m_.good;
      if(!m_.lookup(callbacks_.environments->size(),node.layout.size()))return false;
      const auto layout=callbacks_.environments->find(V4::Detail::view(node.layout));
      if(layout==callbacks_.environments->end()||
          layout->second.parent.has_value()!=protocol.lexicalEnvironment.has_value())return true;
      if(node.parent){
        const auto &lexical=*protocol.lexicalEnvironment;
        if(!m_.equal(*layout->second.parent,lexical))return m_.good;
        bool incoming;
        if(!allClosedLeaves(graph,*node.parent,[&](const V4::Value &leaf,bool &matches){
          matches=leaf.kind==V4::ValueKind::EnvironmentInput&&m_.equal(leaf.layout,lexical);
          return m_.good;
        },incoming))return false;
        if(!incoming)return true;
      }
      work.activation=&node;
    }
    accepted=bool(work.activation)==protocol.activationEnvironment.has_value();
    return true;
  }

  bool closedEnvironmentRole(const ClosedWork &work,const std::vector<Ref> &refs,
      llvm::StringRef layout,ClosedEnvironment &role){
    role=ClosedEnvironment::None;
    const auto &lexical=work.member->protocol.lexicalEnvironment;
    bool owned;
    if(!allClosedLeaves(*work.member->graph,refs,[&](const V4::Value &node,bool &matches){
      matches=false;
      auto candidate=ClosedEnvironment::None;
      if(&node==work.activation)candidate=ClosedEnvironment::Activation;
      else if(node.kind==V4::ValueKind::EnvironmentInput&&lexical&&m_.equal(node.layout,*lexical))
        candidate=ClosedEnvironment::Incoming;
      if(candidate==ClosedEnvironment::None||(role!=ClosedEnvironment::None&&role!=candidate))return m_.good;
      if(!m_.equal(node.layout,layout))return m_.good;
      role=candidate;
      matches=true;
      return true;
    },owned))return false;
    if(!owned)role=ClosedEnvironment::None;
    return true;
  }

  bool slotOwner(llvm::StringRef slot,Ref &owner){
    Ref id;
    if(!symbol(slot,id)||!numericLookup(slotOwners_.size()))return false;
    const auto found=slotOwners_.find(id);
    owner=found==slotOwners_.end()?None:found->second;
    return true;
  }

  bool closedCapture(const ClosedWork &work,const std::vector<Ref> &refs,
      llvm::StringRef layout,llvm::StringRef slot,bool &owned){
    owned=false;
    Ref owner;
    if(!slotOwner(slot,owner))return false;
    if(owner==None||!m_.equal(name(owner),layout))return m_.good;
    ClosedEnvironment role;
    if(!closedEnvironmentRole(work,refs,layout,role))return false;
    owned=role!=ClosedEnvironment::None;
    return true;
  }

  bool closedValueLeaves(const V4::Graph &graph,const std::vector<Ref> &refs,bool &owned){
    using Kind=V4::ValueKind;
    return allClosedLeaves(graph,refs,[](const V4::Value &node,bool &accepted){
      accepted=node.kind==Kind::Parameter||node.kind==Kind::Literal||node.kind==Kind::Nonowning||
        node.kind==Kind::ReceiverValue||node.kind==Kind::Capture||node.kind==Kind::Projection||
        (node.kind==Kind::Call&&node.completion==V4::Completion::Normal);
      return true;
    },owned);
  }

  bool closedLocalGraph(const ClosedWork &work,bool &answer){
    using Kind=V4::ValueKind;
    answer=false;
    const auto &record=*work.member;
    const auto &protocol=record.protocol;
    const bool constructor=protocol.construction.has_value();
    const auto &upper=*record.upper;
    if((constructor&&!upper.captures.empty())||!upper.globals.reads.empty()||!upper.globals.writes.empty()||
        !upper.hostResources.reads.empty()||!upper.hostResources.writes.empty())return true;
    for(const auto &facet:upper.facets){
      if(m_.equal(facet,"unknownHost")||(!constructor&&m_.equal(facet,"mayThrow")))return true;
      if(!m_.good)return false;
    }
    for(const auto &capture:upper.captures){
      Ref owner;
      if(!m_.spend()||!slotOwner(capture.slot,owner))return false;
      if(owner==None)return true;
      if(protocol.activationEnvironment&&m_.equal(name(owner),*protocol.activationEnvironment))continue;
      if(!protocol.lexicalEnvironment||!m_.equal(name(owner),*protocol.lexicalEnvironment))return m_.good;
    }
    const auto &graph=*record.graph;
    for(const auto &node:graph.nodes){
      if(!m_.spend())return false;
      switch(node.kind){
        case Kind::Parameter:case Kind::Literal:case Kind::Nonowning:case Kind::Join:
        case Kind::Gate:case Kind::Copy:case Kind::ReceiverValue:case Kind::ReceiverFrame:case Kind::Call:break;
        case Kind::EnvironmentCreate:case Kind::Code:
          if(constructor)return true;
          break;
        case Kind::ReceiverInput:
          if(!constructor)return true;
          break;
        case Kind::EnvironmentInput:
          if(constructor||!protocol.lexicalEnvironment||!m_.equal(node.layout,*protocol.lexicalEnvironment))return m_.good;
          break;
        case Kind::Capture:{
          if(constructor||!node.environment)return true;
          bool owned;
          if(!closedCapture(work,*node.environment,node.layout,node.id,owned))return false;
          if(!owned)return true;
          break;
        }
        case Kind::Projection:{
          if(constructor||!llvm::StringRef(node.selector).starts_with("field:"))return true;
          bool owned;
          if(!closedValueLeaves(graph,node.bases,owned))return false;
          if(!owned)return true;
          break;
        }
        default:return true;
      }
    }
    for(const auto &heap:graph.heaps){
      if(!m_.spend())return false;
      if(heap.kind!=V4::HeapKind::Store)continue;
      const llvm::StringRef selector=heap.selector;
      bool owned;
      if(selector.starts_with("capture:")){
        const llvm::StringRef view=heap.view;
        if(constructor||!view.starts_with("env:"))return true;
        if(!closedCapture(work,heap.bases,view.drop_front(4),selector.drop_front(8),owned))return false;
      }else{
        if(!selector.starts_with("field:"))return true;
        if(!allClosedLeaves(graph,heap.bases,[&](const V4::Value &node,bool &accepted){
          accepted=node.kind==Kind::ReceiverValue&&graph.heaps[node.action].completion==V4::Completion::Normal;
          return true;
        },owned))return false;
      }
      if(!owned)return true;
    }
    answer=true;return true;
  }

  bool closedRoutineShape(ClosedWork &work,bool &answer){
    answer=false;
    const auto &record=*work.member;
    const auto &protocol=record.protocol;
    if(!record.graph||record.graph->version!=5||!record.upper||!protocol.complete)return true;
    const bool constructor=protocol.construction.has_value();
    if(constructor){
      if(protocol.kind!=ProtocolKind::ConstructionFrame||protocol.construction->receiverIndex!=0||
          protocol.lexicalEnvironment||protocol.activationEnvironment)return true;
    }else{
      if(protocol.kind!=ProtocolKind::Ordinary)return true;
      bool activation;
      if(!closedActivation(work,activation))return false;
      if(!activation)return true;
    }
    bool local;
    if(!closedLocalGraph(work,local))return false;
    if(!local)return true;
    const auto &graph=*record.graph;
    if(!V4::Detail::reserve(work.calls,graph.calls.size(),m_))return false;
    for(const auto &call:graph.calls){
      if(!m_.spend())return false;
      if(call.callee)return true;
      ClosedCall edge;
      if(!closedMember(call.functionId,edge.member))return false;
      if(!edge.member)return true;
      const auto &child=edge.member->protocol;
      if(child.construction){
        if(call.environment||!call.receiver)return true;
        const auto &role=*child.construction;
        if(constructor&&(!protocol.construction->base||!m_.equal(*protocol.construction->base,role.owner)))return m_.good;
        bool frame;
        if(!allClosedLeaves(graph,*call.receiver,[&](const V4::Value &node,bool &accepted){
          accepted=false;
          if(node.kind!=V4::ValueKind::ReceiverFrame||!m_.equal(node.construction,role.id))return m_.good;
          if(!constructor){accepted=!node.parent;return true;}
          if(!node.parent||node.newTarget)return true;
          return allClosedLeaves(graph,*node.parent,[](const V4::Value &parent,bool &matches){
            matches=parent.kind==V4::ValueKind::ReceiverInput;
            return true;
          },accepted);
        },frame))return false;
        if(!frame)return true;
      }else{
        if(constructor||call.receiver||call.environment.has_value()!=child.lexicalEnvironment.has_value())return true;
        if(call.environment){
          if(!closedEnvironmentRole(work,*call.environment,*child.lexicalEnvironment,edge.environment))return false;
          if(edge.environment==ClosedEnvironment::None)return true;
        }
        for(const auto &argument:call.arguments){
          bool owned;
          if(!m_.spend()||!closedValueLeaves(graph,argument,owned))return false;
          if(!owned)return true;
        }
      }
      if(!V4::Detail::push(work.calls,edge,m_))return false;
    }
    answer=true;return true;
  }

  bool closedOwnReceiver(const ClosedWork &work,const V4::Value &node,bool &answer){
    using Kind=V4::ValueKind;
    answer=false;
    if(!m_.spend(5))return false;
    if(node.kind!=Kind::Call||node.completion!=V4::Completion::Normal)return true;
    // The enclosing private routine has already proved this direct constructor
    // call uses a matching root frame with no parent.
    const auto &member=*work.calls[node.call].member;
    if(!member.protocol.construction)return true;
    const auto &graph=*member.graph;
    return allClosedLeaves(graph,graph.normal,[&](const V4::Value &value,bool &own){
      own=false;
      if(!m_.spend(7))return false;
      if(value.kind!=Kind::ReceiverValue)return true;
      const auto &result=graph.heaps[value.action];
      if(result.kind!=V4::HeapKind::ReceiverAction||result.action!=V4::ReceiverAction::Result||
          result.completion!=V4::Completion::Normal||!result.operands.empty())return true;
      return allClosedLeaves(graph,result.frames,[](const V4::Value &frame,bool &implicit){
        implicit=frame.kind==Kind::ReceiverInput;
        return true;
      },own);
    },answer);
  }

  bool closedReadOnlyCode(const FixedFunction &member,bool &answer){
    return allClosedLeaves(*member.graph,member.graph->normal,[&](const V4::Value &node,bool &readonly){
      readonly=false;
      if(!m_.spend(4))return false;
      if(node.kind!=V4::ValueKind::Code||!node.environment)return true;
      const FixedFunction *target;
      if(!closedMember(node.functionId,target)||!m_.spend(12))return false;
      if(!target||!target->graph||target->graph->version!=5||!target->upper||!target->protocol.signature)return true;
      const auto &type=target->protocol.signature->returnType;
      const auto &upper=*target->upper;
      if(!target->protocol.signature->parameterTypes.empty()||!upper.parameters.empty()||
          !upper.globals.reads.empty()||!upper.globals.writes.empty()||
          !upper.hostResources.reads.empty()||!upper.hostResources.writes.empty())return true;
      bool scalar;
      if(!closedScalar(type,scalar))return false;
      if(!scalar)return true;
      for(const auto &capture:upper.captures){
        if(!m_.spend(3))return false;
        if(capture.flags.write||capture.flags.structural)return true;
      }
      for(const auto &facet:upper.facets)if(!m_.equal(facet,"managedReference"))return m_.good;
      return allClosedLeaves(*target->graph,target->graph->normal,[&](const V4::Value &value,bool &sameType){
        sameType=value.type&&m_.equal(*value.type,type);
        return m_.good;
      },readonly);
    },answer);
  }

  bool closedDelegatedReturn(const ClosedWork &work,const V4::Value &node,const ClosedCall &call,
      Ref selectedCall,bool &answer,Ref &scopedCall){
    answer=false;
    scopedCall=None;
    if(!m_.spend(10))return false;
    const auto &signature=work.member->protocol.signature;
    const auto &childSignature=call.member->protocol.signature;
    const auto &graph=*work.member->graph;
    if(!signature||!childSignature||!node.type||work.member->protocol.lexicalEnvironment||work.activation||
        signature->parameterTypes.empty()||graph.calls.size()!=2||
        call.environment!=ClosedEnvironment::None||(selectedCall!=None&&selectedCall!=node.call))return true;
    if(!m_.equal(*node.type,signature->returnType)||!m_.equal(*node.type,childSignature->returnType))return m_.good;
    if(!m_.spend(5))return false;
    const auto &arguments=graph.calls[node.call].arguments;
    if(arguments.empty()&&childSignature->parameterTypes.empty()&&call.member->upper->parameters.empty()){
      if(!closedReadOnlyCode(*call.member,answer))return false;
      if(answer)scopedCall=node.call;
      return true;
    }
    for(const auto &argument:arguments){
      bool owned;
      if(!m_.spend()||!allClosedLeaves(graph,argument,[&](const V4::Value &value,bool &own){
        return closedOwnReceiver(work,value,own);
      },owned))return false;
      if(owned)return closedReadOnlyCode(*call.member,answer);
    }
    return true;
  }

  bool closedDelegatedFormals(const FixedFunction &member,bool &answer){
    answer=false;
    const auto &types=member.protocol.signature->parameterTypes;
    if(!m_.spend(3)||types.size()!=member.upper->parameters.size())return m_.good;
    if(!m_.spend(types.size()+1))return false;
    std::vector<bool> found(types.size(),false);
    size_t matched=0;
    for(const auto &node:member.graph->nodes){
      if(!m_.spend())return false;
      if(node.kind!=V4::ValueKind::Parameter)continue;
      if(!m_.spend(5))return false;
      if(node.index>=types.size()||!node.type||!m_.equal(*node.type,types[node.index]))return m_.good;
      if(!found[node.index]){found[node.index]=true;++matched;}
    }
    answer=matched==types.size();
    return true;
  }

  bool closedReturnEnvironment(const ClosedWork &work,ClosedEnvironment &role,Ref &scopedCall){
    role=ClosedEnvironment::None;
    scopedCall=None;
    if(work.member->protocol.construction)return true;
    bool exact;
    Ref delegatedCall=None;
    if(!allClosedLeaves(*work.member->graph,work.member->graph->normal,[&](const V4::Value &node,bool &matches){
      auto selected=ClosedEnvironment::None;
      if(node.kind==V4::ValueKind::Call&&node.completion==V4::Completion::Normal){
        const auto &call=work.calls[node.call];
        if(!numericLookup(closedRoutines_.size()))return false;
        const auto child=closedRoutines_.find(call.member);
        if(child!=closedRoutines_.end()){
          if(child->second.returned==ClosedEnvironment::Incoming)selected=call.environment;
          if(child->second.returned==ClosedEnvironment::Activation){
            bool delegated;
            Ref nested;
            if(!closedDelegatedReturn(work,node,call,delegatedCall,delegated,nested))return false;
            if(delegated){selected=ClosedEnvironment::Delegated;delegatedCall=node.call;scopedCall=nested;}
          }
        }
      }else if(node.kind==V4::ValueKind::Code&&node.environment){
        const FixedFunction *target;
        if(!closedMember(node.functionId,target))return false;
        if(target&&target->protocol.lexicalEnvironment&&
            !closedEnvironmentRole(work,*node.environment,*target->protocol.lexicalEnvironment,selected))return false;
      }
      matches=selected!=ClosedEnvironment::None&&(role==ClosedEnvironment::None||role==selected);
      if(matches)role=selected;
      return true;
    },exact))return false;
    if(!exact){role=ClosedEnvironment::None;scopedCall=None;}
    if(role==ClosedEnvironment::Delegated){
      bool formals;
      if(!closedDelegatedFormals(*work.member,formals))return false;
      if(!formals){role=ClosedEnvironment::None;scopedCall=None;}
    }
    return true;
  }

  bool closedFactoryGraph(const FixedFunction &record,const ClosedProof *&closed){
    if(!numericLookup(closedRoutines_.size()))return false;
    auto found=closedRoutines_.find(&record);
    if(found==closedRoutines_.end()){
      std::vector<ClosedWork> pending;
      const auto enter=[&](const FixedFunction &member){
        // An unfinished proof rejects a backedge to an active ancestor.
        if(!numericLookup(closedRoutines_.size())||!m_.spend())return false;
        closedRoutines_.emplace(&member,ClosedProof{});
        ClosedWork work;
        work.member=&member;
        bool accepted;
        if(!closedRoutineShape(work,accepted))return false;
        return !accepted||V4::Detail::push(pending,std::move(work),m_);
      };
      if(!enter(record))return false;
      while(!pending.empty()){
        if(!m_.spend()||!numericLookup(closedRoutines_.size()))return false;
        auto &work=pending.back();
        if(work.next==work.calls.size()){
          const auto proof=closedRoutines_.find(work.member);
          ClosedEnvironment returned;Ref scopedCall;
          if(!closedReturnEnvironment(work,returned,scopedCall)||!m_.spend(2))return false;
          proof->second={true,returned,scopedCall};
          pending.pop_back();
          continue;
        }
        const auto *child=work.calls[work.next].member;
        const auto proof=closedRoutines_.find(child);
        if(proof==closedRoutines_.end()){
          if(!enter(*child))return false;
        }else if(proof->second.privateStorage)++work.next;
        else pending.pop_back();
      }
      if(!numericLookup(closedRoutines_.size()))return false;
      found=closedRoutines_.find(&record);
    }
    closed=&found->second;
    return true;
  }

  bool closedScalar(llvm::StringRef type,bool &answer){
    answer=false;
    if(!callbacks_.actualType)return true;
    if(!m_.text(type.size())||!m_.spend())return false;
    const auto *shape=callbacks_.actualType(type,callbackCharge_);
    if(!m_.good)return false;
    answer=shape&&shape->kind==V4::TypeKind::Scalar;
    return true;
  }

  // The verified factory graph cannot inspect or mutate an ambient data root.
  // Call-site leaves and resolved values both need an ownerless scalar proof.
  bool closedFactoryCall(const V4::Graph &graph,const V4::Call &call,const FixedFunction &record,
      const std::vector<Set> &arguments,bool &answer,Ref &scopedCall){
    answer=false;
    scopedCall=None;
    const auto &protocol=record.protocol;
    if(call.callee||call.environment||call.receiver||protocol.kind!=ProtocolKind::Ordinary||protocol.construction||
        protocol.lexicalEnvironment||!callbacks_.environments||record.graph->calls.empty())return true;
    if(!protocol.activationEnvironment){
      if(record.graph->calls.size()!=2)return true;
      if(!m_.spend(3))return false;
      if(!protocol.signature||protocol.signature->parameterTypes.empty())return true;
    }
    const ClosedProof *closed;
    if(!closedFactoryGraph(record,closed))return false;
    if(closed->returned!=ClosedEnvironment::Activation&&closed->returned!=ClosedEnvironment::Delegated)return true;
    const auto *expected=closed->returned==ClosedEnvironment::Delegated?&protocol.signature->parameterTypes:nullptr;
    if(expected&&(!m_.spend(3)||expected->size()!=arguments.size()||call.arguments.size()!=arguments.size()))return m_.good;
    for(Ref index=0;index<arguments.size();++index){
      const auto &values=arguments[index];
      if(!m_.spend())return false;
      if(values.empty())return true;
      bool scalar;
      if(!allClosedLeaves(graph,call.arguments[index],[&](const V4::Value &node,bool &accepted){
        using Kind=V4::ValueKind;
        accepted=false;
        if(!node.type||(node.kind!=Kind::Nonowning&&(node.kind!=Kind::Literal||node.category!=V4::Category::Other)))return true;
        if(expected&&!m_.equal(*node.type,(*expected)[index]))return m_.good;
        return closedScalar(*node.type,accepted);
      },scalar))return false;
      if(!scalar)return true;
      for(auto id:values){
        if(!m_.spend())return false;
        const auto &value=locations_[id];
        if(value.owner!=None||value.type==None||(value.kind!=LocationKind::Nonowning&&
            (value.kind!=LocationKind::Literal||value.categories!=4)))return true;
        if(expected&&!m_.equal(name(value.type),(*expected)[index]))return m_.good;
        if(!closedScalar(name(value.type),scalar))return false;
        if(!scalar)return true;
      }
    }
    if(!m_.spend())return false;scopedCall=closed->scopedCall;
    answer=true;return true;
  }

  // A selected Code may be available before the incoming heap has its exact
  // local capture cells. Save only snapshots that contain those payloads.
  bool incomingCapturesReady(const Heap &heap,const Set &environment,Ref incoming,
      const PublishedEffects &upper,bool &available){
    available=true;
    if(incoming==None||environment.empty()||upper.captures.empty())return true;
    bool local=false;
    for(auto base:environment){
      if(!m_.spend())return false;
      if(locations_[base].kind==LocationKind::EnvironmentLocal){local=true;break;}
    }
    if(!local)return true;
    Ref view=None;
    for(const auto &capture:upper.captures){
      if(!m_.spend())return false;
      if(!capture.flags.read&&!capture.flags.write&&!capture.flags.structural)continue;
      Ref owner,selector;
      if(!slotOwner(capture.slot,owner))return false;
      if(owner!=incoming)continue;
      if(view==None&&!prefixed("env:",name(incoming),view))return false;
      if(!prefixed("capture:",capture.slot,selector))return false;
      for(auto base:environment){
        if(!m_.spend())return false;
        if(locations_[base].kind!=LocationKind::EnvironmentLocal)continue;
        Key identity;
        if(!key(identity,{base,selector,view})||!numericLookup(addressIds_.size(),identity.size()))return false;
        const auto address=addressIds_.find(identity);
        if(address==addressIds_.end()){available=false;return true;}
        if(!numericLookup(heap.size()))return false;
        const auto cell=heap.find(address->second);
        if(cell==heap.end()||cell->second.empty()){available=false;return true;}
      }
    }
    return true;
  }

  bool runCalls(Context &context){const auto &graph=*context.graph;if(!m_.spend(graph.calls.size()))return false;
    for(Ref index=0;index<graph.calls.size();++index){if(!m_.spend())return false;const auto &call=graph.calls[index];if(!context.controls[call.control]||!context.heapReady[call.heap])continue;
      bool available=true;for(const auto &argument:call.arguments){bool value;if(!readyRefs(context,argument,value))return false;available=available&&value;}
      if(call.callee){bool value;if(!readyRefs(context,*call.callee,value))return false;available=available&&value;}if(call.environment){bool value;if(!readyRefs(context,*call.environment,value))return false;available=available&&value;}if(!available)continue;
      if(call.receiver){bool value;if(!readyRefs(context,*call.receiver,value))return false;if(!value)continue;}
      std::size_t cardinality=0;
      const bool settledIndirect=call.callee&&!context.targets[index].empty();
      if(settledIndirect||(!call.callee&&!call.environment)){
        // Each operand set only grows. An unchanged sum means every input is
        // unchanged, including the settled indirect Code/Env selection.
        const auto count=[&](const std::vector<Ref> &refs){
          if(!m_.spend(refs.size()))return false;
          for(auto ref:refs)cardinality+=context.values[ref].size();
          return true;
        };
        if(!m_.spend(call.arguments.size()+3))return false;
        for(const auto &argument:call.arguments)if(!count(argument))return false;
        if(call.receiver&&!count(*call.receiver))return false;
        if(call.callee&&!count(*call.callee))return false;
        if(call.environment&&!count(*call.environment))return false;
        const auto &previous=context.callInputs[index];
        if(previous.scheduled&&previous.cardinality==cardinality&&
           (previous.isolated||(previous.heapRevision==context.heaps[call.heap].revision&&
                               previous.frameRevision==context.frames[call.heap].revision)))continue;
      }
      if(!m_.spend(call.arguments.size()))return false;std::vector<Set> arguments(call.arguments.size());for(Ref i=0;i<call.arguments.size();++i)if(!resolve(context,call.arguments[i],arguments[i]))return false;
      Ref function,label,scope;Key identity;
      if(!graphSymbol(call.functionId,function)||!graphSymbol(call.site,label)||!m_.spend(2))return false;
      // A nullary helper has no argument to carry the private parent identity.
      // Only its certified direct call gets the exact parent's context key.
      if(context.scopedCall==index){
        if(!key(identity,{context.function,label,index,context.index}))return false;
      }else if(!key(identity,{context.function,label,index}))return false;
      if(!internKey(scopeIds_,std::move(identity),scope))return false;
      const auto *record=fixedFunction(function);if(!record)return false;Ref expected=None;if(record->protocol.lexicalEnvironment&&!graphSymbol(*record->protocol.lexicalEnvironment,expected))return false;
      Set receivers;if(call.receiver&&!resolve(context,*call.receiver,receivers))return false;
      if(record->protocol.construction){
        Ref expected;if(!symbol(record->protocol.construction->id,expected)||!m_.spend(receivers.size()))return false;
        for(auto receiver:receivers)if(locations_[receiver].kind!=LocationKind::ReceiverFrame||locations_[receiver].label!=expected)return open("constructor-call-frame-owner-open");
        if(!m_.spend(arguments.size()+1))return false;arguments.insert(arguments.begin(),Set{});
      }
      bool isolated;Ref scopedCall;
      if(!closedFactoryCall(graph,call,*record,arguments,isolated,scopedCall))return false;
      if(isolated){
        Key closedScope;
        if(!key(closedScope,{None,scope})||!internKey(scopeIds_,std::move(closedScope),scope))return false;
      }
      const auto schedule=[&](const Set &environment){
        const auto &input=context.heaps[call.heap];
        bool ready;
        if(!incomingCapturesReady(input,environment,expected,*record->upper,ready))return false;
        if(!ready)return true;
        Ref target;
        if(isolated){
          if(!m_.spend())return false;FrameWorld frames;frames.live=true;
          if(!ensure(function,scope,arguments,environment,Heap{},target,None,0,receivers,frames,true,scopedCall))return false;
        }else if(!ensure(function,scope,arguments,environment,input,target,context.index,call.heap,receivers,context.frames[call.heap]))return false;
        if(!m_.spend(3))return false;
        const auto previous=context.targets[index].size();
        if(!insert(context.targets[index],target))return false;
        if(previous!=context.targets[index].size())++context.captureTopologyRevision;
        return true;
      };
      const auto rememberInput=[&](){
        if(!m_.spend(5))return false;
        // Record only after the target and saved input are established.
        context.callInputs[index]={cardinality,context.heaps[call.heap].revision,
          context.frames[call.heap].revision,true,isolated};
        return true;
      };
      if(call.callee){Set codes,components;if(!resolve(context,*call.callee,codes))return false;if(call.environment&&!resolve(context,*call.environment,components))return false;
        for(auto id:codes){if(!m_.spend())return false;const auto code=locations_[id];if(code.kind==LocationKind::Code){
          if(code.function!=function)continue;if((expected==None)!=(code.environment==None))return open("code-environment-protocol-open");
          if(expected==None){if(call.environment)return open("unexpected-code-component");if(!schedule(Set{}))return false;}
          else{if(!call.environment)return open("missing-code-component");for(auto env:components){if(!m_.spend())return false;if(env==code.environment){Set selected;if(!insert(selected,env,false)||!schedule(selected))return false;}}}
        }else{
          if(!formalCode(id))return open("code-source-nonowning-or-unknown");if(expected==None){if(call.environment)return open("unexpected-code-component");if(!schedule(Set{}))return false;}
          else{if(!call.environment)return open("missing-formal-code-component");for(auto env:components){if(!m_.spend())return false;const auto component=locations_[env];if(component.kind==LocationKind::EnvironmentComponent&&component.source==id&&component.function==function&&component.layout==expected){Set selected;if(!insert(selected,env,false)||!schedule(selected))return false;}}}
        }}
        if(context.targets[index].empty()){
          bool readonly;if(!readonlyAlternative(call,*record,function,codes,readonly))return false;
          // Keep the full allowed upper on the effect lattice. Only a settled
          // same-site witness may leave this alternative out of the data path.
          if(readonly&&!inheritReadonlyAlternative(context,function,*record->upper,arguments))return false;
        }else if(settledIndirect&&!rememberInput())return false;
      }else if(expected==None){
        if(call.environment)return open("unexpected-direct-environment");
        if(!schedule(Set{})||!rememberInput())return false;
      }
      else{if(!call.environment)return open("missing-direct-environment");Set bases,selected;if(!resolve(context,*call.environment,bases)||!selectEnvironments(bases,expected,selected))return false;if(!selected.empty()&&!schedule(selected))return false;}
    }return true;
  }
  bool runControls(Context &context){
    const auto &graph=*context.graph;if(!m_.spend(graph.controls.size()))return false;
    for(Ref i=0;i<graph.controls.size();++i){if(!m_.spend())return false;const auto &control=graph.controls[i];bool live=false;
      if(control.kind==V4::ControlKind::Entry)live=true;
      else if(control.kind==V4::ControlKind::Join){if(!m_.spend(control.inputs.size()))return false;for(auto input:control.inputs){if(!m_.spend())return false;live=live||context.controls[input];}}
      else if(control.kind==V4::ControlKind::Call){if(!m_.spend(context.targets[control.call].size()))return false;for(auto target:context.targets[control.call]){if(!m_.spend())return false;const auto &called=*contexts_[target];live=live||(control.completion==V4::Completion::Normal?called.normalLive:called.languageLive);}}
      else if(control.kind==V4::ControlKind::ReceiverCompletion)live=context.receiverLive[control.action];
      else return open("control-equation-open");
      if(live&&!context.controls[i]){
        if(!m_.spend())return false;
        ++context.captureTopologyRevision;
        context.controls[i]=true;
        changed_=true;
      }
    }return true;
  }
  bool rootLocation(Context &context,Ref index,const V4::Value &node,Ref &out){
    Ref type=None,label=None,owner=None;if(node.type&&!symbol(*node.type,type))return false;
    LocationKind kind;Key identity;
    if(node.kind==V4::ValueKind::Global){kind=LocationKind::Global;if(!symbol(node.id,label)||!prefixed("g:",node.id,owner)||!key(identity,{2,type,label}))return false;}
    else if(node.kind==V4::ValueKind::Local){kind=LocationKind::Local;if(!symbol("local:return-origin",owner)||!key(identity,{4,context.function,context.scope,index,type}))return false;}
    else if(node.kind==V4::ValueKind::Nonowning){kind=LocationKind::Nonowning;if(!key(identity,{5,type}))return false;}
    else if(node.kind==V4::ValueKind::Literal){kind=LocationKind::Literal;if(!key(identity,{21,type,Ref(node.category)}))return false;}
    else return open("unknown-value-equation-open");
    Location value{kind,type,label,owner,None};if(kind==LocationKind::Local)value.categories=1;else if(kind==LocationKind::Literal)value.categories=node.category==V4::Category::Undefined?2:4;
    return location(std::move(identity),value,out);
  }
  bool receiverValue(Context &context,Ref index,const V4::Value &node,Set &output){
    if(node.kind==V4::ValueKind::ReceiverInput)return add(output,context.receivers);
    if(node.kind==V4::ValueKind::ReceiverValue){
      if(!context.receiverLive[node.action])return true;
      if(!m_.spend(4))return false;
      const auto &values=context.receiverValues[node.action];
      // This result receives values only from this growing receiver action.
      return output.size()==values.size()||add(output,values);
    }
    if(!context.controls[node.control])return true;
    std::size_t cardinality;
    if(node.parent){
      if(!operandCardinality(context,*node.parent,cardinality)||!m_.spend(3))return false;
      // Frame metadata is fixed. Measure before producing any child frame.
      if(context.valueInputs[index].cardinality==cardinality)return true;
    }
    Ref id;if(!symbol(node.construction,id))return false;const auto *row=construction(id);if(!row)return false;
    const auto append=[&](Ref parent,Ref target){Ref value;return frameIdentity(context,index,id,target,parent,value,parent!=None&&locations_[parent].receiverRoot)&&insert(output,value);};
    if(node.parent){Set parents;if(!resolve(context,*node.parent,parents)||!m_.spend(parents.size()))return false;
      for(auto parent:parents){if(!m_.spend())return false;const auto &frame=locations_[parent];if(frame.kind!=LocationKind::ReceiverFrame)return open("receiver-parent-data-open");const auto *owner=construction(frame.label);if(!owner||!owner->base||!m_.equal(*owner->base,row->owner))return open("receiver-child-owner-open");if(!append(parent,frame.type))return false;}
      if(!m_.spend(2))return false;
      context.valueInputs[index].cardinality=cardinality;
    }else{Ref target;if(!node.newTarget||!symbol(*node.newTarget,target)||!m_.equal(row->owner,*node.newTarget))return open("receiver-new-target-open");if(!append(None,target))return false;}
    return true;
  }
  static bool environmentValue(V4::ValueKind kind){return kind==V4::ValueKind::EnvironmentInput||kind==V4::ValueKind::EnvironmentCreate||kind==V4::ValueKind::EnvironmentParent||kind==V4::ValueKind::EnvironmentComponent||kind==V4::ValueKind::Capture||kind==V4::ValueKind::Code;}
  bool nonowning(const std::optional<std::string> &view,Ref &out){if(!view)return open("nonowning-source-view-open");Ref type;Key identity;if(!symbol(*view,type)||!key(identity,{5,type}))return false;return location(std::move(identity),{LocationKind::Nonowning,type,None,None,None},out);}
  bool voidView(const std::optional<std::string> &view,bool &answer){answer=false;if(!view)return true;Ref type;if(!graphSymbol(*view,type))return false;if(type==void_){answer=true;return true;}
    if(callbacks_.actualType){if(!m_.text(view->size())||!m_.spend())return false;const auto *shape=callbacks_.actualType(*view,callbackCharge_);if(!m_.good)return false;answer=shape&&shape->kind==V4::TypeKind::Void;}return true;
  }
  bool runEnvironmentComponent(Context &context,Ref index,const V4::Value &node,Set &output){
    std::size_t cardinality;
    if(!operandCardinality(context,node.callee,cardinality)||!m_.spend(3))return false;
    auto &previous=context.valueInputs[index].cardinality;
    // An admitted Code has a fixed Env, and formal components follow the
    // immutable layout chain. New operands still need the complete checks.
    if(previous==cardinality)return true;
    Ref id;
    if(!graphSymbol(node.layout,id))return false;
    bool available;if(!readyRefs(context,node.callee,available))return false;if(!available)return true;
    Ref function;if(!graphSymbol(node.functionId,function))return false;const auto *record=fixedProtocol(function);if(!record)return false;
    Ref expected=None;if(record->protocol.lexicalEnvironment&&!graphSymbol(*record->protocol.lexicalEnvironment,expected))return false;if(expected!=id)return open("component-function-layout-open");if(!layout(id))return false;Set sources;if(!resolve(context,node.callee,sources))return false;
    for(auto source:sources){if(!m_.spend())return false;const auto value=locations_[source];if(value.kind==LocationKind::Code){if(value.function!=function)continue;if(value.environment==None||locations_[value.environment].layout!=id)return open("selected-code-env-layout-open");if(!insert(output,value.environment))return false;}
      else{if(!formalCode(source))return open("formal-code-component-owner-open");Ref env;if(!componentEnvironment(source,function,id,env)||!insert(output,env))return false;}}
    if(!m_.spend())return false;
    previous=cardinality;
    return true;
  }
  bool runCaptureValue(Context &context,Ref index,const V4::Value &node,Set &output){
    std::size_t cardinality;
    if(!operandCardinality(context,*node.environment,cardinality)||!m_.spend(4))return false;
    const auto &heap=context.heaps[node.heap];
    const auto revision=heap.revision;
    auto &previous=context.valueInputs[index];
    if(previous.cardinality==cardinality&&previous.heapRevision==revision)return true;
    Ref layoutId;Set bases,values;
    // The union cannot own more nodes than the sum of its input cardinalities.
    if(!graphSymbol(node.layout,layoutId)||!m_.spend(cardinality)||!resolve(context,*node.environment,bases))return false;
    bool direct;
    if(!directCaptureEnvironments(bases,layoutId,direct))return false;
    if(!captureValues(heap,bases,layoutId,node.id,values,/*prepayRelease=*/true)||!add(output,values))return false;
    if(direct){if(!m_.spend(2))return false;previous={cardinality,revision};}
    return true;
  }
  bool runEnvironmentValue(Context &context,Ref index,const V4::Value &node,Set &output){
    if(node.kind!=V4::ValueKind::EnvironmentInput&&!context.controls[node.control])return true;
    if(node.kind==V4::ValueKind::EnvironmentComponent)return runEnvironmentComponent(context,index,node,output);
    if(node.kind==V4::ValueKind::Capture)return runCaptureValue(context,index,node,output);
    Ref id=None;if(node.kind!=V4::ValueKind::Code&&!graphSymbol(node.layout,id))return false;
    if(node.kind==V4::ValueKind::EnvironmentInput){Ref expected=None;if(context.protocol->lexicalEnvironment&&!graphSymbol(*context.protocol->lexicalEnvironment,expected))return false;if(id!=expected)return open("entry-environment-layout-open");return add(output,context.environment);}
    if(node.kind==V4::ValueKind::EnvironmentCreate){Ref expected=None;if(context.protocol->activationEnvironment&&!graphSymbol(*context.protocol->activationEnvironment,expected))return false;if(id!=expected)return open("activation-environment-layout-open");const auto *row=layout(id);if(!row)return false;
      Ref siteLabel,owner,result;Key identity;if(!graphSymbol(node.site,siteLabel)||!symbol("local:return-origin",owner)||!key(identity,{12,context.function,context.scope,index,siteLabel,id,context.environment.size()}))return false;
      if(!m_.spend(context.environment.size()))return false;for(auto env:context.environment)if(!number(identity,env))return false;if(!number(identity,context.arguments.size())||!m_.spend(context.arguments.size()))return false;
      for(const auto &argument:context.arguments){if(!number(identity,argument.size())||!m_.spend(argument.size()))return false;for(auto value:argument)if(!number(identity,value))return false;}
      Location value;value.kind=LocationKind::EnvironmentLocal;value.layout=id;value.owner=owner;if(!m_.spend())return false;value.creator=context.index;if(!location(std::move(identity),value,result))return false;Set *selected;if(!parents(result,selected))return false;
      if(!row->parent){if(node.parent)return open("unexpected-activation-parent");}else{if(!node.parent)return open("activation-parent-open");Ref parent;Set bases,actual;if(!symbol(*row->parent,parent)||!resolve(context,*node.parent,bases)||!selectEnvironments(bases,parent,actual)||!add(*selected,actual))return false;}return insert(output,result);
    }
    if(node.kind==V4::ValueKind::EnvironmentParent){Set bases,selected;return resolve(context,node.bases,bases)&&selectEnvironments(bases,id,selected)&&add(output,selected);}
    Ref function,type;if(!node.type)return open("code-source-view-open");if(!graphSymbol(node.functionId,function)||!graphSymbol(*node.type,type))return false;const auto *record=fixedProtocol(function);if(!record)return false;Ref expected=None;if(record->protocol.lexicalEnvironment&&!graphSymbol(*record->protocol.lexicalEnvironment,expected))return false;
    const auto pack=[&](Ref env){Key identity;Location value;value.kind=LocationKind::Code;value.type=type;value.function=function;value.environment=env;value.owner=env==None?None:locations_[env].owner;value.categories=1;Ref code;return key(identity,{13,function,env,type})&&location(std::move(identity),value,code)&&insert(output,code);};
    if(expected==None){if(node.environment)return open("unexpected-code-environment");return pack(None);}if(!node.environment)return open("code-environment-open");Set bases,selected;if(!resolve(context,*node.environment,bases)||!selectEnvironments(bases,expected,selected))return false;for(auto env:selected)if(!pack(env))return false;return true;
  }
  bool valueReady(Context &context,Ref index,const V4::Value &node){
    if(!m_.spend())return false;
    if(context.ready[index])return true;
    bool defined=true;
    if(node.kind==V4::ValueKind::ReceiverFrame){if(node.parent&&!readyRefs(context,*node.parent,defined))return false;defined=defined&&context.controls[node.control];}
    else if(node.kind==V4::ValueKind::ReceiverValue)defined=context.receiverLive[node.action]&&context.heapReady[node.action];
    else if(node.kind==V4::ValueKind::Join){defined=node.inputs.empty();for(auto id:node.inputs){if(!m_.spend())return false;defined=defined||context.ready[id];}}
    else if(node.kind==V4::ValueKind::Gate){if(!readyRefs(context,node.inputs,defined))return false;defined=defined&&context.controls[node.control];}
    else if(node.kind==V4::ValueKind::Capture){if(!readyRefs(context,*node.environment,defined))return false;defined=defined&&context.controls[node.control]&&context.heapReady[node.heap];}
    else if(node.kind==V4::ValueKind::Copy||node.kind==V4::ValueKind::Projection){if(!readyRefs(context,node.bases,defined))return false;defined=defined&&context.controls[node.control]&&context.heapReady[node.heap];}
    else if(node.kind==V4::ValueKind::EnvironmentCreate){if(node.parent&&!readyRefs(context,*node.parent,defined))return false;defined=defined&&context.controls[node.control];}
    else if(node.kind==V4::ValueKind::EnvironmentParent){if(!readyRefs(context,node.bases,defined))return false;defined=defined&&context.controls[node.control];}
    else if(node.kind==V4::ValueKind::EnvironmentComponent){if(!readyRefs(context,node.callee,defined))return false;defined=defined&&context.controls[node.control];}
    else if(node.kind==V4::ValueKind::Code){if(node.environment&&!readyRefs(context,*node.environment,defined))return false;defined=defined&&context.controls[node.control];}
    else if(node.kind==V4::ValueKind::Call){defined=false;for(auto target:context.targets[node.call]){if(!m_.spend())return false;const auto &called=*contexts_[target];const bool normal=node.completion==V4::Completion::Normal;bool values;if(!readyRefs(called,normal?called.graph->normal:called.graph->language,values))return false;
        bool emptyVoid=false;if(normal&&!voidView(node.type,emptyVoid))return false;defined=defined||((normal?called.normalReady:called.languageReady)&&((!(normal?called.graph->normal:called.graph->language).empty()&&values)||emptyVoid));}}
    return ready(context.ready,index,defined);
  }
  static bool fixedValue(const V4::Value &node){
    switch(node.kind){
      case V4::ValueKind::Parameter:case V4::ValueKind::Global:case V4::ValueKind::Local:case V4::ValueKind::Nonowning:
      case V4::ValueKind::Literal:case V4::ValueKind::EnvironmentInput:case V4::ValueKind::ReceiverInput:return true;
      case V4::ValueKind::Code:return !node.environment;
      case V4::ValueKind::EnvironmentCreate:case V4::ValueKind::ReceiverFrame:return !node.parent;
      default:return false;
    }
  }
  bool projectValue(Context &context,Ref index,const V4::Value &node,Set &output){
    if(!m_.spend(node.bases.size()+8))return false;
    std::size_t cardinality=0;
    for(auto ref:node.bases)cardinality+=context.values[ref].size();
    const auto &source=context.heaps[node.heap];
    const auto revision=source.revision;
    auto &previous=context.valueInputs[index];
    // Fixed operand sets only grow, and the physical source grows through
    // versioned heap joins. This is the same read already added to output.
    if(previous.cardinality==cardinality&&previous.heapRevision==revision)return true;
    const auto readBases=[&](const Set &bases){
      Ref selector,view;
      Key origin;
      if(!graphSymbol(node.selector,selector)||!graphSymbol(node.view,view)||
          !key(origin,{context.function,index})||!m_.spend(bases.size()))return false;
      for(auto base:bases){
        Set values;
        if(!read(source,base,selector,view,origin,values)||!add(output,values))return false;
      }
      return true;
    };
    if(!m_.spend(3))return false;
    if(node.bases.size()==1&&node.bases.front()!=index){
      if(!readBases(context.values[node.bases.front()]))return false;
    }else{
      // A self-edge needs the original snapshot, even for one operand.
      Set bases;
      if(!resolve(context,node.bases,bases)||!readBases(bases))return false;
    }
    if(!m_.spend(2))return false;
    previous={cardinality,revision};
    return true;
  }
  bool runValues(Context &context){
    const auto &graph=*context.graph;if(!m_.spend(graph.nodes.size()))return false;
    for(Ref i=0;i<graph.nodes.size();++i){if(!m_.spend())return false;const auto &node=graph.nodes[i];auto &output=context.values[i];
      // Arguments and the incoming Env/receiver belong to the immutable context key.
      if(context.ready[i]&&fixedValue(node))continue;
      if(environmentValue(node.kind)){if(!runEnvironmentValue(context,i,node,output))return false;}
      else if(node.kind==V4::ValueKind::ReceiverInput||node.kind==V4::ValueKind::ReceiverFrame||node.kind==V4::ValueKind::ReceiverValue){if(!receiverValue(context,i,node,output))return false;}
      else if(node.kind==V4::ValueKind::Parameter){const auto &args=context.function==None?rootArguments_:context.arguments;if(node.index>=args.size())return open("parameter-vector-open");if(!add(output,args[node.index]))return false;if(context.function!=None&&args[node.index].empty()){Ref id;if(!nonowning(node.type,id)||!insert(output,id))return false;}}
      else if(node.kind==V4::ValueKind::Join){if(!joinValue(context,i,node.inputs,output))return false;}
      else if(node.kind==V4::ValueKind::Gate){if(context.controls[node.control]&&!joinValue(context,i,node.inputs,output))return false;}
      else if(node.kind==V4::ValueKind::Projection){
        if(!context.controls[node.control])continue;
        if(!projectValue(context,i,node,output))return false;
      }else if(node.kind==V4::ValueKind::Copy){
        if(!context.controls[node.control])continue;
        if(!m_.spend(node.bases.size()+3))return false;
        // The fixed operand sets only grow. Measure before adding output
        // because a cyclic Copy may contribute to its own source set.
        std::size_t cardinality=0;
        for(auto ref:node.bases)cardinality+=context.values[ref].size();
        auto &previous=context.valueInputs[i].cardinality;
        if(previous!=cardinality){
          Set sources;
          Ref selectedSite;
          if(!resolve(context,node.bases,sources)||!site(context,node.site,selectedSite)||!m_.spend(sources.size()))return false;
          for(auto source:sources){Ref target;if(!copied(source,selectedSite,target)||!insert(output,target))return false;}
          if(!m_.spend())return false;
          previous=cardinality;
        }
        if(output.empty()&&context.heapReady[node.heap]){
          bool available;
          if(!readyRefs(context,node.bases,available))return false;
          if(available){Ref id;if(!nonowning(node.type,id)||!insert(output,id))return false;}
        }
      }else if(node.kind==V4::ValueKind::Call){
        if(!m_.spend(context.targets[node.call].size()))return false;
        for(auto target:context.targets[node.call]){if(!m_.spend())return false;const auto &called=*contexts_[target];
          if(node.completion==V4::Completion::Normal?called.normalLive:called.languageLive){
            if(!add(output,node.completion==V4::Completion::Normal?called.normal:called.language))return false;
            if(node.completion==V4::Completion::Normal&&called.normal.empty()&&node.type){
              Ref type;if(!graphSymbol(*node.type,type))return false;bool isVoid=type==void_;
              // This is a Source RETURN VIEW, not an asserted actual tag. An
              // erased union/unknown view must not be rejected or reclassified
              // as a local actual value merely to recognize native void data.
              if(!isVoid&&callbacks_.actualType){
                if(!m_.text(name(type).size())||!m_.spend())return false;
                const auto *view=callbacks_.actualType(name(type),callbackCharge_);if(!m_.good)return false;
                isVoid=view&&view->kind==V4::TypeKind::Void;
              }
              if(isVoid){Key identity;Ref id;if(!key(identity,{5,type})||!location(std::move(identity),{LocationKind::Nonowning,type,None,None,None},id)||!insert(output,id))return false;}
            }
          }
        }
      }else {Ref id;if(!rootLocation(context,i,node,id)||!insert(output,id))return false;}
      if(!valueReady(context,i,node))return false;
    }return true;
  }
  bool copyHeap(Context &context,Ref index,const V4::Heap &heap,Heap &output){
    const auto &operation=context.graph->nodes[heap.value];if(operation.kind!=V4::ValueKind::Copy)return open("copy-heap-equation-open");
    if(!mergePersistentHeap(output,context.heaps[heap.previous]))return false;if(!context.controls[operation.control])return true;
    if(!m_.spend(operation.bases.size()+8))return false;
    std::size_t cardinality=0;
    for(auto ref:operation.bases)cardinality+=context.values[ref].size();
    const auto &source=context.heaps[operation.heap];
    const auto revision=source.revision;
    auto &previous=context.heapInputs[index];
    // Each root set grows monotonically. An exact replay with no inline root
    // reads no source fields, even if the source heap grows later.
    if(previous.applied&&previous.cardinality==cardinality&&
        (previous.heapRevision==None||previous.heapRevision==revision))return true;
    Ref selectedSite=None;
    Set roots;
    if(!resolve(context,operation.bases,roots)||!m_.spend(roots.size()))return false;
    std::vector<Ref> pending;Set seen;if(!V4::Detail::reserve(pending,roots.size(),m_))return false;for(auto root:roots)if(!V4::Detail::push(pending,root,m_))return false;
    while(!pending.empty()){
      if(!m_.spend())return false;const auto original=pending.back();pending.pop_back();if(!numericLookup(seen.size()))return false;if(seen.find(original)!=seen.end())continue;
      bool inlined;if(!inlineLocation(original,inlined))return false;if(!inlined)continue;if(!insert(seen,original,false))return false;
      if(selectedSite==None&&!site(context,operation.site,selectedSite))return false;
      Ref target;if(!copied(original,selectedSite,target))return false;const auto type=locations_[original].type;const auto *actual=shape(type);
      if(!actual)return false;if(actual->kind!=V4::TypeKind::Value||!actual->completePhysicalFields)return open("complete-physical-copy-fields-open");
      if(!m_.spend(actual->fields.size()))return false;
      for(const auto &field:actual->fields){
        Ref selector,view,label;if(!m_.spend()||!prefixed("field:",field.id,selector)||!symbol(field.id,label))return false;
        if(field.view){if(!symbol(*field.view,view))return false;}else view=type;
        Key origin;Set values,children;if(!key(origin,{context.function,heap.value,label,view})||!read(source,original,selector,view,origin,values)||!m_.spend(values.size()))return false;
        for(auto child:values){Ref selected;bool childInline;if(!copied(child,selectedSite,selected)||!insert(children,selected,false)||!inlineLocation(child,childInline))return false;if(childInline&&!V4::Detail::push(pending,child,m_))return false;}
        if(!put(output,target,selector,view,children))return false;
      }
    }
    if(!m_.spend(4))return false;
    // Read the version from before the physical copy, including on a cycle.
    previous={cardinality,selectedSite==None?None:revision,0,true};
    return true;
  }
  bool selectCategory(Ref source,unsigned mask,Ref &out){
    const auto selected=locations_[source];if(selected.categories==mask){out=source;return true;}
    Key identity;Location value=selected;value.kind=LocationKind::CategorySelection;value.source=source;value.categories=mask;
    return key(identity,{24,source,mask})&&location(std::move(identity),value,out);
  }
  bool heapInput(const Context &context,Ref previous,const std::vector<Ref> &bases,
      const std::vector<Ref> &values,HeapInput &input){
    if(!m_.spend(bases.size()+values.size()+8))return false;
    // The fixed operand sets only grow. Save predecessor versions before the
    // transfer in case its output is also an input of a cyclic equation.
    for(auto id:bases)input.cardinality+=context.values[id].size();
    for(auto id:values)input.cardinality+=context.values[id].size();
    input.heapRevision=context.heaps[previous].revision;
    input.frameRevision=context.frames[previous].revision;
    input.applied=true;
    return true;
  }
  bool runStore(Context &context,Ref index,const V4::Heap &heap,Heap &output){
    HeapInput input;
    if(!heapInput(context,heap.previous,heap.bases,heap.values,input))return false;
    if(input==context.heapInputs[index])return true;
    if(!mergePersistentHeap(output,context.heaps[heap.previous])||
        !mergePersistentFrames(context.frames[index],context.frames[heap.previous]))return false;
    if(!context.controls[heap.control])return true;
    Set bases,values;
    Ref selector,view;
    if(!resolve(context,heap.bases,bases)||!resolve(context,heap.values,values)||
        !graphSymbol(heap.selector,selector)||!graphSymbol(heap.view,view)||!m_.spend(bases.size()))return false;
    const bool capture=llvm::StringRef(heap.selector).starts_with("capture:");
    Ref expected=None;
    if(capture&&(!llvm::StringRef(heap.view).starts_with("env:")||
        !symbol(llvm::StringRef(heap.view).drop_front(4),expected)))return open("capture-store-view-open");
    for(auto base:bases){
      if(capture&&(!environmentKind(locations_[base].kind)||locations_[base].layout!=expected))
        return open("capture-store-environment-layout-open");
      if(!put(output,base,selector,view,values))return false;
    }
    if(!m_.spend(4))return false;
    context.heapInputs[index]=input;
    return true;
  }
  bool runReceiverAction(Context &context,Ref index,const V4::Heap &heap,Heap &output){
    if(!context.controls[heap.control]||!context.heapReady[heap.previous])return true;
    bool framesReady,operandsReady;if(!readyRefs(context,heap.frames,framesReady)||!readyRefs(context,heap.operands,operandsReady))return false;if(!framesReady||!operandsReady)return true;
    HeapInput input;
    if(!heapInput(context,heap.previous,heap.frames,heap.operands,input))return false;
    if(input==context.heapInputs[index])return true;
    Set frames,operands,objects;if(!resolve(context,heap.frames,frames)||!resolve(context,heap.operands,operands)||!m_.spend(operands.size()))return false;
    bool undefined=heap.operands.empty(),other=false;
    for(auto operand:operands){if(!m_.spend())return false;const auto mask=locations_[operand].categories;undefined|=bool(mask&2);other|=bool(mask&4);
      if(mask&1){Ref selected;if(!selectCategory(operand,1,selected)||!insert(objects,selected,false))return false;}}
    if(!m_.spend(frames.size()))return false;for(auto frame:frames){
      if(!m_.spend())return false;const auto value=locations_[frame];if(value.kind!=LocationKind::ReceiverFrame)return open("receiver-action-frame-open");const auto *row=construction(value.label);if(!row)return false;
      const auto &previous=context.frames[heap.previous];if(!numericLookup(previous.size()))return false;const auto found=previous.find(frame);Binding entry;
      const auto &binding=found==previous.end()?entry:found->second;bool normal=false,language=false;Set selected;
      if(heap.action==V4::ReceiverAction::Allocate){
        if(row->base)return open("derived-allocation-open");Ref owner,id;Key identity;Location allocated;allocated.kind=LocationKind::Local;allocated.type=value.type;allocated.categories=1;
        if(!(value.receiverRoot?parameterOwner(0,owner):symbol("local:return-origin",owner))||!key(identity,{22,frame}))return false;allocated.owner=owner;
        if(!location(std::move(identity),allocated,id)||!insert(selected,id,false))return false;normal=true;
      }else if(heap.action==V4::ReceiverAction::Get){normal=!binding.values.empty();language=binding.unbound;if(!add(selected,binding.values,false))return false;}
      else if(heap.action==V4::ReceiverAction::Bind){normal=binding.unbound&&!objects.empty();language=!binding.values.empty();if(!add(selected,objects,false))return false;}
      else{
        if(!add(selected,objects,false))return false;normal=!objects.empty();
        const bool fallback=undefined||(!row->base&&other);if(fallback){if(!add(selected,binding.values,false))return false;normal|=!binding.values.empty();language|=binding.unbound;}
        if(row->base&&other)language=true;
      }
      const bool live=heap.completion==V4::Completion::Normal?normal:language;if(!live)continue;
      if(!m_.spend())return false;FrameWorld world;if(!mergeFrames(world,previous,false))return false;
      if(heap.completion==V4::Completion::Normal&&heap.action==V4::ReceiverAction::Bind){
        if(!numericLookup(world.size())||!m_.spend())return false;auto &bound=world[frame];bound.unbound=false;bound.values.clear();if(!add(bound.values,objects,false))return false;
      }
      if(!numericLookup(world.size()))return false;const auto bound=world.find(frame);
      if(bound!=world.end()&&!recordBoundReceiver(context,frame,bound->second.values))return false;
      if(!mergePersistentHeap(output,context.heaps[heap.previous])||!mergeFrames(context.frames[index],world))return false;
      if(heap.completion==V4::Completion::Normal){if(!add(context.receiverValues[index],selected))return false;}
      else{Ref owner,error;Key identity;Location thrown;thrown.kind=LocationKind::ReceiverError;thrown.categories=1;
        if(!symbol("local:return-origin",owner)||!key(identity,{23,context.function,context.scope,index,frame}))return false;thrown.owner=owner;
        if(!location(std::move(identity),thrown,error)||!insert(context.receiverValues[index],error))return false;}
      if(!ready(context.receiverLive,index,true))return false;
    }
    if(!m_.spend(4))return false;
    context.heapInputs[index]=input;
    return true;
  }
  bool heapReady(Context &context,Ref index,const V4::Heap &heap){
    if(!m_.spend())return false;
    if(context.heapReady[index])return true;
    bool defined=false;
    if(heap.kind==V4::HeapKind::Entry)defined=true;
    else if(heap.kind==V4::HeapKind::Join){for(auto input:heap.inputs){if(!m_.spend())return false;defined=defined||context.heapReady[input];}}
    else if(heap.kind==V4::HeapKind::Store){bool bases,values;if(!readyRefs(context,heap.bases,bases)||!readyRefs(context,heap.values,values))return false;defined=context.controls[heap.control]&&context.heapReady[heap.previous]&&bases&&values;}
    else if(heap.kind==V4::HeapKind::Copy)defined=context.heapReady[heap.previous]&&context.ready[heap.value];
    else if(heap.kind==V4::HeapKind::ReceiverAction)defined=context.receiverLive[index];
    else for(auto target:context.targets[heap.call]){if(!m_.spend())return false;const auto &called=*contexts_[target];defined=defined||(heap.completion==V4::Completion::Normal?called.normalReady:called.languageReady);}
    return ready(context.heapReady,index,defined);
  }
  bool runHeaps(Context &context){
    const auto &graph=*context.graph;if(!m_.spend(graph.heaps.size()))return false;
    for(Ref i=0;i<graph.heaps.size();++i){if(!m_.spend())return false;const auto &heap=graph.heaps[i];auto &output=context.heaps[i];
      if(heap.kind==V4::HeapKind::Entry&&context.heapReady[i])continue;
      if(heap.kind!=V4::HeapKind::ReceiverAction){if(!heapReady(context,i,heap))return false;if(!context.heapReady[i])continue;}
      if(heap.kind==V4::HeapKind::Entry){if(!merge(output,context.input)||!mergeFrames(context.frames[i],context.inputFrames))return false;}
      else if(heap.kind==V4::HeapKind::Join){if(!m_.spend(heap.inputs.size()))return false;for(auto parent:heap.inputs){if(!m_.spend())return false;if(context.heapReady[parent]&&(!mergePersistentHeap(output,context.heaps[parent])||!mergePersistentFrames(context.frames[i],context.frames[parent])))return false;}}
      else if(heap.kind==V4::HeapKind::Store){if(!runStore(context,i,heap,output))return false;}
      else if(heap.kind==V4::HeapKind::Copy){if(!copyHeap(context,i,heap,output)||!mergePersistentFrames(context.frames[i],context.frames[heap.previous]))return false;}
      else if(heap.kind==V4::HeapKind::ReceiverAction){if(!runReceiverAction(context,i,heap,output)||!heapReady(context,i,heap))return false;}
      else if(heap.kind==V4::HeapKind::Call){
        if(!m_.spend(context.targets[heap.call].size()))return false;
        const bool normal=heap.completion==V4::Completion::Normal;
        for(auto target:context.targets[heap.call]){
          if(!m_.spend())return false;
          const auto &called=*contexts_[target];
          if(!(normal?called.normalReady:called.languageReady))continue;
          if(called.isolated){
            const auto saved=graph.calls[heap.call].heap;
            if(!mergePersistentHeap(output,context.heaps[saved])||!mergePersistentFrames(context.frames[i],context.frames[saved]))return false;
          }
          if(!mergePersistentHeap(output,normal?called.normalHeap:called.languageHeap))return false;
          if(!called.isolated&&!mergePersistentFrames(context.frames[i],normal?called.normalFrames:called.languageFrames))return false;
        }
      }else return open("heap-equation-open");
    }return true;
  }
  bool finishContext(Context &context){
    const auto &graph=*context.graph;
    for(unsigned channel=0;channel<2;++channel){
      const bool normal=channel==0;
      auto &live=normal?context.normalLive:context.languageLive;
      auto &ready=normal?context.normalReady:context.languageReady;
      auto &heap=normal?context.normalHeap:context.languageHeap;
      auto &frames=normal?context.normalFrames:context.languageFrames;
      auto &values=normal?context.normal:context.language;
      const auto &exits=normal?graph.exits.normal:graph.exits.language;
      if(!m_.spend(exits.size()))return false;
      for(Ref index=0;index<exits.size();++index){
        if(!m_.spend())return false;
        const auto &exit=exits[index];
        if(!context.controls[exit.control])continue;
        if(!live){live=true;changed_=true;}
        if(!context.heapReady[exit.heap])continue;
        if(!ready){ready=true;changed_=true;}
        // The fixed exit always refers to these same solver-owned worlds.
        // Receiver history is a growing union over immutable frame ancestry.
        const auto &sourceHeap=context.heaps[exit.heap];
        const auto &sourceFrames=context.frames[exit.heap];
        auto &previous=context.exitInputs[channel][index];
        if(!m_.spend(2))return false;
        const bool frameChanged=previous.frameRevision!=sourceFrames.revision;
        const bool heapChanged=previous.heapRevision!=sourceHeap.revision;
        if(frameChanged&&!recordBoundWorld(context,sourceFrames))return false;
        if(heapChanged&&!mergePersistentHeap(heap,sourceHeap))return false;
        if(frameChanged&&!mergePersistentFrames(frames,sourceFrames))return false;
        if(frameChanged||heapChanged){
          if(!m_.spend(2))return false;
          previous={sourceHeap.revision,sourceFrames.revision};
        }
      }
      if(live&&!resolve(context,normal?graph.normal:graph.language,values,true))return false;
    }
    if(!m_.spend(graph.accesses.size()))return false;for(const auto &access:graph.accesses){if(!m_.spend())return false;if(context.controls[access.control]){Set values;if(!resolve(context,access.values,values)||!valueEffects(context,access.flag,values))return false;}}
    if(!m_.spend(context.targets.size()))return false;for(const auto &targets:context.targets){if(!m_.spend(targets.size()))return false;for(auto target:targets)if(!inherit(context,*contexts_[target]))return false;}
    return true;
  }
  // This existential query uses settled control and completion flags. A call
  // is a terminal test, so every predecessor belongs to this same context.
  bool possibleHeap(const Context &context,Ref index,bool &live){
    live=false;
    const auto &graph=*context.graph;
    std::vector<Ref> pending;
    Set visited;
    if(!V4::Detail::push(pending,index,m_))return false;
    while(!pending.empty()){
      if(!m_.spend()||!numericLookup(visited.size()))return false;
      const auto current=pending.back();pending.pop_back();
      if(!visited.insert(current).second)continue;
      const auto &heap=graph.heaps[current];
      switch(heap.kind){
        case V4::HeapKind::Entry:
          live=true;return true;
        case V4::HeapKind::Join:
          for(auto parent=heap.inputs.rbegin();parent!=heap.inputs.rend();++parent)
            if(!V4::Detail::push(pending,*parent,m_))return false;
          break;
        case V4::HeapKind::Store:
          if(context.controls[heap.control]&&!V4::Detail::push(pending,heap.previous,m_))return false;
          break;
        case V4::HeapKind::Copy:
          if(context.controls[graph.nodes[heap.value].control]&&!V4::Detail::push(pending,heap.previous,m_))return false;
          break;
        case V4::HeapKind::ReceiverAction:
          if(context.receiverLive[current]&&!V4::Detail::push(pending,heap.previous,m_))return false;
          break;
        case V4::HeapKind::Call:
          for(auto target:context.targets[heap.call]){
            if(!m_.spend())return false;
            const auto &called=*contexts_[target];
            if(heap.completion==V4::Completion::Normal?called.normalLive:called.languageLive){live=true;return true;}
          }
          break;
      }
    }
    return true;
  }
  // Data closure is immutable here. Memoize only a complete query; a path
  // fragment may depend on which creator/entry alternatives remain reachable.
  bool captureDefinition(Context &context,std::optional<Ref> heap,Ref environment,Ref slot,Definition &defined){
    if(!m_.spend(5)||!numericLookup(definitionMemo_.size(),4))return false;
    const auto signature=std::make_tuple(context.index,heap?*heap:None,environment,slot);const auto memo=definitionMemo_.find(signature);
    if(memo!=definitionMemo_.end()){defined=memo->second;return true;}
    const auto node=locations_[environment];defined=Definition::Absent;
    if(node.kind==LocationKind::EnvironmentEntry||node.kind==LocationKind::EnvironmentComponent)defined=Definition::Defined;
    else{
      std::vector<std::pair<Ref,Ref>> pending;std::set<std::pair<Ref,Ref>> seen;
      const auto append=[&](Ref current,Ref state){if(!m_.spend(3)||!V4::Detail::room(pending,m_))return false;pending.emplace_back(current,state);return true;};
      if(!append(context.index,heap?*heap:None))return false;
      while(!pending.empty()){
        if(!m_.spend())return false;const auto current=pending.back();pending.pop_back();if(!numericLookup(seen.size(),2))return false;
        if(seen.find(current)!=seen.end())continue;if(!m_.spend())return false;seen.insert(current);auto &saved=*contexts_[current.first];
        const auto *row=current.second==None?nullptr:&saved.graph->heaps[current.second];
        if(!row||row->kind==V4::HeapKind::Entry){
          if(node.creator==saved.index){defined=Definition::Undefined;break;}
          if(!m_.spend(saved.entrySources.size()))return false;for(const auto &source:saved.entrySources)if(!append(source.first,source.second))return false;continue;
        }
        if(row->kind==V4::HeapKind::Join){if(!m_.spend(row->inputs.size()))return false;for(auto parent:row->inputs){
            bool live;if(!possibleHeap(saved,parent,live))return false;if(live&&!append(saved.index,parent))return false;}continue;}
        if(row->kind==V4::HeapKind::Store){Ref selector,actual;if(!prefixed("capture:",name(slot),selector)||!symbol(row->selector,actual))return false;
          if(saved.controls[row->control]&&actual==selector){Set bases,values;
            if(!resolve(saved,row->bases,bases)||!resolve(saved,row->values,values)||!numericLookup(bases.size()))return false;
            // MAY {A,B} writes do not define either instance on every path.
            if(bases.size()==1&&bases.find(environment)!=bases.end()&&!values.empty()){defined=Definition::Defined;continue;}}
          if(!append(saved.index,row->previous))return false;continue;
        }
        if(row->kind==V4::HeapKind::Copy||row->kind==V4::HeapKind::ReceiverAction){if(!append(saved.index,row->previous))return false;continue;}
        if(!m_.spend(saved.targets[row->call].size()))return false;for(auto target:saved.targets[row->call]){const auto &called=*contexts_[target];
          bool live=false;
          for(const auto &state:V4::Detail::exits(*called.graph,row->completion)){
            if(!m_.spend())return false;
            if(!called.controls[state.control])continue;
            if(!append(called.index,state.heap))return false;
            live=true;
          }
          // Private exits prove their own cells; the saved predecessor owns
          // the ambient cells that pass unchanged through the factory.
          if(live&&called.isolated&&!append(saved.index,saved.graph->calls[row->call].heap))return false;
        }
      }
    }
    if(!m_.spend())return false;definitionMemo_.emplace(signature,defined);return true;
  }
  bool completeCapture(Context &context,std::optional<Ref> heap,const Set &bases,Ref layoutId,const std::string &key){Set selected;if(!selectEnvironments(bases,layoutId,selected))return false;if(selected.empty())return open("capture-environment-unresolved");Ref slot;if(!symbol(key,slot))return false;
    for(auto environment:selected){if(!m_.spend())return false;Definition defined;if(!captureDefinition(context,heap,environment,slot,defined))return false;
      Set single,values;if(!insert(single,environment,false)||!captureValues(heap?context.heaps[*heap]:context.input,single,layoutId,key,values))return false;
      if(defined!=Definition::Defined||values.empty())return open("capture-payload-unresolved-on-reachable-path");}return true;
  }
  bool returnedEnvironments(Context &context,const Set &values,Ref heap){for(auto value:values){if(!m_.spend())return false;const auto code=locations_[value];if(code.kind!=LocationKind::Code||code.environment==None)continue;
      Ref selected=locations_[code.environment].layout;while(selected!=None){const auto *row=layout(selected);if(!row)return false;for(const auto &slot:row->slots){Set base;if(!m_.spend()||!insert(base,code.environment,false)||!completeCapture(context,heap,base,selected,slot.key))return false;}if(row->parent){if(!symbol(*row->parent,selected))return false;}else selected=None;}
    }return true;
  }
  bool strict(Context &context){
    if(context.isolated&&context.languageLive)return open("closed-factory-language-completion-open");
    const auto &graph=*context.graph;
    for(auto completion:{V4::Completion::Normal,V4::Completion::Language}){Set values;if(!resolve(context,V4::Detail::returns(graph,completion),values))return false;for(const auto &state:V4::Detail::exits(graph,completion)){if(!m_.spend())return false;if(context.controls[state.control]&&!returnedEnvironments(context,values,state.heap))return false;}}
    for(Ref index=0;index<graph.nodes.size();++index){if(!m_.spend())return false;const auto &node=graph.nodes[index];if(node.kind!=V4::ValueKind::Capture&&node.kind!=V4::ValueKind::EnvironmentParent&&node.kind!=V4::ValueKind::EnvironmentCreate)continue;if(!context.controls[node.control])continue;
      if(node.kind==V4::ValueKind::Capture){Ref selected;Set bases;if(!symbol(node.layout,selected)||!resolve(context,*node.environment,bases)||!completeCapture(context,node.heap,bases,selected,node.id))return false;}
      else if(node.kind==V4::ValueKind::EnvironmentParent&&context.values[index].empty())return open("actual-parent-environment-unresolved");
      else if(node.kind==V4::ValueKind::EnvironmentCreate){Ref selected;if(!symbol(node.layout,selected))return false;const auto *row=layout(selected);if(!row)return false;if(row->parent)for(auto env:context.values[index]){if(!numericLookup(environmentParents_.size()))return false;const auto found=environmentParents_.find(env);if(found==environmentParents_.end()||found->second.empty())return open("activation-parent-unresolved");}}
    }
    for(Ref index=0;index<graph.calls.size();++index){if(!m_.spend())return false;const auto &call=graph.calls[index];if(!context.controls[call.control])continue;Ref function;if(!symbol(call.functionId,function))return false;const auto *record=fixedFunction(function);if(!record)return false;Ref expected=None;if(record->protocol.lexicalEnvironment&&!symbol(*record->protocol.lexicalEnvironment,expected))return false;
      const auto checkIncoming=[&](const Set &environment){
        bool ready;
        if(!incomingCapturesReady(context.heaps[call.heap],environment,expected,*record->upper,ready))return false;
        return ready||open("capture-payload-unresolved-on-reachable-path");
      };
      Set codes;
      if(call.callee){
        Set components;
        if(!resolve(context,*call.callee,codes))return false;
        if(call.environment&&!resolve(context,*call.environment,components))return false;
        for(auto id:codes){
          if(!m_.spend())return false;
          const auto code=locations_[id];
          if(code.kind==LocationKind::Code&&code.function!=function)continue;
          if(expected==None)continue;
          if(!call.environment)return open("selected-code-component-missing");
          bool matched=false;
          for(auto env:components){
            if(!m_.spend())return false;
            const auto component=locations_[env];
            const bool compatible=code.kind==LocationKind::Code?env==code.environment:
              component.kind==LocationKind::EnvironmentComponent&&component.source==id&&component.function==function&&component.layout==expected;
            if(!compatible)continue;
            matched=true;
            Set selected;
            if(!insert(selected,env,false)||!checkIncoming(selected))return false;
          }
          if(!matched)return open("selected-code-env-pair-unresolved");
        }
      }else if(expected!=None&&call.environment){
        Set bases,selected;
        if(!resolve(context,*call.environment,bases)||!selectEnvironments(bases,expected,selected)||!checkIncoming(selected))return false;
      }
      if(context.targets[index].empty()){
        bool readonly,covered=false;
        if(!readonlyAlternative(call,*record,function,codes,readonly)||(readonly&&!sameOccurrenceWitness(context,call,codes,covered)))return false;
        if(!covered)return open("permitted-code-env-target-unresolved");
      }
      for(auto target:context.targets[index]){auto &called=*contexts_[target];for(const auto &capture:called.upper->captures){if(!m_.spend())return false;if(!capture.flags.read&&!capture.flags.write&&!capture.flags.structural)continue;
          Ref selected;std::vector<CaptureSource> *sources;
          if(!captureSources(called,capture.slot,selected,sources))return false;
          if(sources->empty())return open("fixed-capture-saved-environment-unresolved");
          if(!m_.spend(sources->size()))return false;for(const auto &source:*sources)if(!completeCapture(*contexts_[source.context],source.heap,*source.bases,selected,capture.slot))return false;}}
    }return true;
  }
  bool exportSet(V4::SymbolSet &out,const Set &source){
    if(!m_.spend(source.size()))return false;for(auto id:source){const auto text=name(id);std::string copy;
      if(!m_.lookup(out.size(),text.size())||!m_.copy(copy,text)||!m_.spend())return false;out.emplace(std::move(copy));}return true;
  }
  bool summarize(){
    const auto &initial=*contexts_[initial_];auto &out=result_.summary;
    if(!m_.spend(initial.values.size())||!m_.spend(initial.values.size())||!m_.spend(initial.controls.size()))return false;out.owners.resize(initial.values.size());out.holdsEnvironment.resize(initial.values.size(),false);out.live=initial.controls;
    if(!m_.spend(initial.values.size())||!m_.spend(initial.heapReady.size()))return false;out.populated.resize(initial.values.size(),false);out.heapReady=initial.heapReady;
    for(Ref i=0;i<initial.values.size();++i){Set owners;if(!m_.spend(2)||!m_.spend(initial.values[i].size()))return false;out.populated[i]=!initial.values[i].empty();for(auto id:initial.values[i]){if(locations_[id].owner!=None&&!insert(owners,locations_[id].owner,false))return false;if(locations_[id].kind==LocationKind::Code&&locations_[id].environment!=None)out.holdsEnvironment[i]=true;}if(!exportSet(out.owners[i],owners))return false;}
    for(Ref i=0;i<3;++i)if(!m_.spend()||!exportSet(out.effects[i],initial.effects[i]))return false;
    if(!exportSet(out.facets,initial.facets)||!exportSet(out.calls,initial.calls))return false;
    out.normal=initial.normalLive;out.language=initial.languageLive;return true;
  }
public:
  Solver(const V4::Graph &root,const FixedFunctions &fixed,const Callbacks &callbacks,const V4::Charge &charge):root_(root),fixed_(fixed),callbacks_(callbacks),m_(charge){}
  SolveResult run(){
    result_.status=Status::Solved;result_.reason="ordinary-fixed-context-closure";
    // Account for the initial empty memos alongside solver startup.
    if(!m_.spend(4))return finish();callbackCharge_=[this](std::size_t n){return m_.spend(n);};
    if(root_.version!=5){open("graph5-only");return finish();}if(!protocolReady(callbacks_.rootProtocol))return finish();
    // The global stable SlotKey directory belongs to this one admitted group.
    if(callbacks_.environments)for(const auto &row:*callbacks_.environments){Ref owner;if(!symbol(row.first,owner)||!m_.spend(row.second.slots.size()))return finish();
      for(const auto &slot:row.second.slots){Ref key;if(!symbol(slot.key,key)||!numericLookup(slotOwners_.size())||!m_.spend())return finish();slotOwners_.emplace(key,owner);}}
    if(!symbol("element",element_)||!symbol("void",void_)||!m_.spend(root_.nodes.size()))return finish();
    for(const auto &node:root_.nodes){if(!m_.spend())return finish();if(node.kind!=V4::ValueKind::Parameter)continue;
      Ref type,owner,id;Key identity;if(!node.type){open("parameter-type-open");return finish();}
      if(!symbol(*node.type,type)||!parameterOwner(node.index,owner)||!key(identity,{1,node.index,type})||!location(std::move(identity),{LocationKind::Parameter,type,None,owner,None},id))return finish();
      if(node.index>=rootArguments_.size()){if(!m_.spend(node.index+1))return finish();rootArguments_.resize(node.index+1);}
      if(!insert(rootArguments_[node.index],id))return finish();
    }
    Set environment;if(callbacks_.rootProtocol.lexicalEnvironment){Ref layout,id;if(!symbol(*callbacks_.rootProtocol.lexicalEnvironment,layout)||!entryEnvironment(layout,id)||!insert(environment,id,false))return finish();}
    Ref rootScope;Key identity;if(!key(identity,{None})||!internKey(scopeIds_,std::move(identity),rootScope))return finish();
    Set receivers;if(callbacks_.rootProtocol.construction){
      Ref id;if(!m_.spend(11))return finish();Context root;root.scope=rootScope;const auto &protocol=*callbacks_.rootProtocol.construction;
      if(!symbol(protocol.id,id)||!construction(id))return finish();
      for(const auto &[key,candidate]:*callbacks_.constructions){bool eligible;if(!m_.spend()||!derives(candidate,protocol.owner,eligible))return finish();if(!eligible)continue;
        Ref target,frame;if(!symbol(candidate.owner,target)||!frameIdentity(root,None,id,target,None,frame,true)||!insert(receivers,frame,false))return finish();}
      if(rootArguments_.empty()){if(!m_.spend())return finish();rootArguments_.resize(1);}
    }
    if(!m_.spend()||!ensure(None,rootScope,rootArguments_,environment,Heap{},initial_,None,0,receivers))return finish();
    changed_=true;
    while(changed_&&active()){
      changed_=false;
      // Stable heap-allocated contexts survive vector growth while calls append
      // new contexts to this very worklist. Results resume only recorded targets.
      for(Ref i=0;i<contexts_.size();++i){
        if(!m_.spend())return finish();
        auto &context=*contexts_[i];
        bool independent=false,priorChange=false;
        if(callbacks_.settleIndependentLeaves){
          if(!m_.spend(6))return finish();
          if(context.sweep==Context::Sweep::Settled)continue;
          independent=context.sweep==Context::Sweep::Independent;
          if(independent){priorChange=changed_;changed_=false;}
        }
        if(!runCalls(context)||!runControls(context)||!runValues(context)||!runHeaps(context)||!finishContext(context))return finish();
        if(independent){
          if(!m_.spend(5))return finish();
          // This complete sweep used immutable input and no other context or
          // Env equation. A zero-change pass also interned no new origin IDs.
          if(!changed_)context.sweep=Context::Sweep::Settled;
          changed_|=priorChange;
        }
      }
    }
    if(active())for(auto &context:contexts_)if(!strict(*context))return finish();
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
inline SolveResult solve(const V4::Graph &entryGraph,const FixedFunctions &fixed,const Callbacks &callbacks,const V4::Charge &charge){
  return Detail::Solver(entryGraph,fixed,callbacks,charge).run();
}
} // namespace CommonReturnOriginDomainV4
