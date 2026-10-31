// SPDX-License-Identifier: MIT
#pragma once
#include "llvm/ADT/StringRef.h"
#include "llvm/Support/JSON.h"
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <initializer_list>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>

// Ordinary v3 data equations only. No Source/Runtime/Actual/Borrow adapter.
namespace CommonReturnOriginV3 {
using Ref=std::size_t;
using Charge=std::function<bool(std::size_t)>;
struct SymbolLess {
  using is_transparent=void;
  bool operator()(std::string_view a,std::string_view b)const{return a<b;}
};
template<class T> using Symbols=std::map<std::string,T,SymbolLess>;
using SymbolSet=std::set<std::string,SymbolLess>;
enum class TypeKind {Scalar,String,Undefined,Null,Void,Array,ReadSpan,Value,Reference,Function,Union,Unknown,Future};
struct TypeRow {TypeKind kind=TypeKind::Future;};
enum class FunctionKind {Source,Method,ConstructionBody,Future};
struct FunctionRow {
  FunctionKind kind=FunctionKind::Future;
  // Ordered LOGICAL vector, including an ordinary method receiver.
  std::vector<std::string> parameterTypes;
  std::string returnType;
  bool hasLexicalEnvironment=false,hasActivationEnvironment=false;
};
struct Directory {
  std::string functionId;
  Symbols<TypeRow> types;
  Symbols<FunctionRow> functions;
  Symbols<std::string> globals,captures;
  SymbolSet fields;
};
enum class Completion {Normal,Language};
enum class ValueKind {Parameter,Global,Capture,Local,Nonowning,Unknown,Join,Gate,Projection,Copy,Call};
struct Value {
  ValueKind kind=ValueKind::Unknown;
  std::optional<std::string> type;
  std::string id,selector,view,site;
  Ref index=0,heap=0,control=0,call=0;
  std::vector<Ref> inputs,bases;
  Completion completion=Completion::Normal;
};
enum class HeapKind {Entry,Join,Store,Copy,Call};
struct Heap {
  HeapKind kind=HeapKind::Entry;
  std::vector<Ref> inputs,bases,values;
  Ref previous=0,control=0,value=0,call=0;
  std::string selector,view;
  bool initialize=false;
  Completion completion=Completion::Normal;
};
enum class ControlKind {Entry,Join,Call};
struct Control {ControlKind kind=ControlKind::Entry;std::vector<Ref> inputs;Ref call=0;Completion completion=Completion::Normal;};
struct Call {std::string functionId,site;std::vector<std::vector<Ref>> arguments;Ref heap=0,control=0;};
struct State {Ref heap=0,control=0;};
struct Exits {std::vector<State> normal,language;};
enum class AccessFlag {Read,Write,Structural};
struct Access {std::vector<Ref> values;AccessFlag flag=AccessFlag::Read;Ref control=0;};
struct Graph {
  std::vector<Value> nodes;
  std::vector<Heap> heaps;
  std::vector<Control> controls;
  std::vector<Call> calls;
  std::vector<Ref> normal,language;
  Exits exits;
  std::vector<Access> accesses;
};
enum class ReadStatus {Typed,Open,Rejected,BudgetError};
struct ReadResult {ReadStatus status=ReadStatus::Rejected;Graph graph;const char *reason="unread";};
enum class InclusionStatus {Covered,Open,BudgetError};
struct InclusionResult {InclusionStatus status=InclusionStatus::Open;const char *reason="unproved";};
// Body/upper are already joined to the same current function signature. All
// graphs/references come from ONE admitted immutable scope/schema/group. This
// map never reinterprets an older caller's published Fn reference.
using FixedContracts=Symbols<const Graph *>;

namespace Detail {
inline std::string_view view(llvm::StringRef value){return {value.data(),value.size()};}
class Meter {
  const Charge &charge_;
public:
  bool good=true;
  explicit Meter(const Charge &charge):charge_(charge){}
  bool spend(std::size_t n=1){if(!good)return false;if(!charge_||!charge_(n))good=false;return good;}
  bool text(std::size_t n){return spend(n/8+1);}
  bool equal(llvm::StringRef a,llvm::StringRef b){return text(a.size())&&text(b.size())&&a==b;}
  bool copy(std::string &to,llvm::StringRef from){if(!text(from.size())||!spend())return false;to.assign(from.data(),from.size());return true;}
  // Transparent map/set lookups allocate no query string. Precharge comparison
  // work before traversal; comparison length is bounded by the query length.
  bool lookup(std::size_t count,std::size_t queryBytes){
    std::size_t depth=1;for(auto n=count;n;n>>=1){if(!spend())return false;depth+=2;}
    for(std::size_t i=0;i<depth;++i)if(!text(queryBytes))return false;return true;
  }
};
template<class T> inline bool room(std::vector<T> &out,Meter &m){return out.size()!=out.capacity()||m.spend(out.size()+1);}
template<class T> inline bool push(std::vector<T> &out,T value,Meter &m){if(!m.spend()||!room(out,m))return false;out.push_back(std::move(value));return true;}
template<class T> inline bool reserve(std::vector<T> &out,std::size_t count,Meter &m){if(!m.spend(count))return false;out.reserve(count);return true;}
inline bool copyRefs(std::vector<Ref> &out,const std::vector<Ref> &source,Meter &m){if(!reserve(out,source.size(),m))return false;for(auto id:source){if(!push(out,id,m))return false;}return true;}
inline const std::vector<State> &exits(const Graph &g,Completion c){return c==Completion::Normal?g.exits.normal:g.exits.language;}
inline const std::vector<Ref> &returns(const Graph &g,Completion c){return c==Completion::Normal?g.normal:g.language;}
inline const char *flagName(AccessFlag flag){return flag==AccessFlag::Read?"read":flag==AccessFlag::Write?"write":"structural";}

class Reader {
  const Directory &directory_;
  Meter &m_;
  std::size_t nodes_=0,heaps_=0,controls_=0,calls_=0;
  std::vector<const FunctionRow *> callees_;
  const FunctionRow *current_=nullptr;
  using Json=llvm::json::Value;
  using Object=llvm::json::Object;
  using Array=llvm::json::Array;
  bool reject(const char *reason){result.status=ReadStatus::Rejected;result.reason=reason;return false;}
  bool open(const char *reason){result.status=ReadStatus::Open;result.reason=reason;return false;}
  bool object(const Json &raw,const Object *&out,std::initializer_list<llvm::StringRef> keys){
    out=raw.getAsObject();if(!out)return reject("record-required");if(out->size()!=keys.size())return reject("exact-record-keys");
    if(!m_.spend(keys.size()+1))return false;
    for(const auto &member:*out){const llvm::StringRef name=llvm::StringRef(member.first);if(!m_.text(name.size())||!m_.spend(keys.size()+1))return false;bool found=false;
      for(auto expected:keys){if(!m_.spend())return false;if(m_.equal(name,expected)){found=true;break;}if(!m_.good)return false;}
      if(!found)return reject("exact-record-keys");}return true;
  }
  bool array(const Json *raw,const Array *&out){if(!m_.spend())return false;out=raw?raw->getAsArray():nullptr;if(!out)return reject("array-required");return m_.spend(out->size()+1);}
  bool symbol(const Json *raw,llvm::StringRef &out){if(!m_.spend())return false;auto value=raw?raw->getAsString():std::optional<llvm::StringRef>{};if(!value)return reject("string-required");out=*value;return m_.text(out.size());}
  bool text(const Json *raw,std::string &out){llvm::StringRef value;return symbol(raw,value)&&m_.copy(out,value);}
  bool ref(const Json *raw,std::size_t count,Ref &out){
    if(!m_.spend())return false;if(!raw)return reject("reference-range");
    if(auto integer=raw->getAsInteger()){if(*integer<0||std::uint64_t(*integer)>9007199254740991ULL||std::uint64_t(*integer)>=count)return reject("reference-range");out=Ref(*integer);return true;}
    if(auto number=raw->getAsNumber()){if(!std::isfinite(*number)||*number<0||*number>9007199254740991.0||std::floor(*number)!=*number||*number>=double(count))return reject("reference-range");out=Ref(*number);return true;}
    return reject("reference-range");
  }
  bool refs(const Json *raw,std::size_t count,std::vector<Ref> &out){const Array *values;if(!array(raw,values)||!reserve(out,values->size(),m_))return false;bool first=true;Ref previous=0;
    for(const auto &value:*values){Ref id;if(!ref(&value,count,id))return false;if(!first&&id<=previous)return reject("sorted-unique-references");first=false;previous=id;if(!push(out,id,m_))return false;}return true;}
  template<class T> const T *find(const Symbols<T> &rows,llvm::StringRef id){if(!m_.lookup(rows.size(),id.size()))return nullptr;auto found=rows.find(view(id));return found==rows.end()?nullptr:&found->second;}
  bool ownedType(const Json *raw,std::string &out,const TypeRow **shape=nullptr){llvm::StringRef id;if(!symbol(raw,id))return false;const auto *row=find(directory_.types,id);if(!m_.good)return false;if(!row)return reject("unowned-type");if(shape)*shape=row;return m_.copy(out,id);}
  bool ownedType(const std::string &id){const auto *row=find(directory_.types,id);return m_.good&&(row||reject("unowned-signature-type"));}
  bool nullableType(const Json *raw,std::optional<std::string> &out){if(!raw)return reject("missing-type");if(raw->getAsNull()){out.reset();return m_.spend();}std::string type;if(!ownedType(raw,type))return false;out=std::move(type);return true;}
  bool protocol(const FunctionRow &fn){if(!m_.spend())return false;if(fn.kind==FunctionKind::ConstructionBody)return open("construction-frame-open");
    if(fn.hasLexicalEnvironment||fn.hasActivationEnvironment)return open("code-environment-open");if(fn.kind!=FunctionKind::Source&&fn.kind!=FunctionKind::Method)return open("function-protocol-open");return true;}
  bool signature(const FunctionRow &fn){if(!m_.spend(fn.parameterTypes.size()+1))return false;for(const auto &type:fn.parameterTypes)if(!ownedType(type))return false;return ownedType(fn.returnType);}
  bool channel(const Json *raw,Completion &out){llvm::StringRef name;if(!symbol(raw,name))return false;if(m_.equal(name,"normal")){out=Completion::Normal;return true;}if(!m_.good)return false;if(m_.equal(name,"language")){out=Completion::Language;return true;}return m_.good&&reject("completion");}
  bool selector(const Json *raw,std::string &out){llvm::StringRef name;if(!symbol(raw,name))return false;if(m_.equal(name,"element"))return m_.copy(out,name);if(!m_.good)return false;
    if(!m_.text(name.size())||!m_.equal(name.take_front(6),"field:"))return m_.good&&reject("field-selector");const auto id=name.drop_front(6);
    if(!m_.lookup(directory_.fields.size(),id.size()))return false;if(directory_.fields.find(view(id))==directory_.fields.end())return reject("unowned-field");return m_.copy(out,name);}
  bool discriminator(const Json &raw,const Object *&row,llvm::StringRef &kind){row=raw.getAsObject();if(!row)return reject("record-required");return symbol(row->get("kind"),kind);}
  bool readCall(const Json &raw){const Object *row;if(!object(raw,row,{"functionId","arguments","heap","control","site"}))return false;llvm::StringRef id;if(!symbol(row->get("functionId"),id))return false;
    const auto *fn=find(directory_.functions,id);if(!m_.good)return false;if(!fn)return reject("unowned-function");if(!protocol(*fn)||!signature(*fn))return false;
    const Array *arguments;if(!array(row->get("arguments"),arguments))return false;if(arguments->size()!=fn->parameterTypes.size())return reject("logical-call-arity");
    Call call;if(!m_.copy(call.functionId,id)||!text(row->get("site"),call.site)||!ref(row->get("heap"),heaps_,call.heap)||!ref(row->get("control"),controls_,call.control)||!reserve(call.arguments,arguments->size(),m_))return false;
    for(const auto &argument:*arguments){std::vector<Ref> values;if(!refs(&argument,nodes_,values)||!push(call.arguments,std::move(values),m_))return false;}
    return push(result.graph.calls,std::move(call),m_)&&push(callees_,fn,m_);
  }
  bool readValue(const Json &raw){const Object *row;llvm::StringRef kind;if(!discriminator(raw,row,kind))return false;Value value;std::string type;
    if(m_.equal(kind,"parameter")){
      value.kind=ValueKind::Parameter;if(!object(raw,row,{"kind","type","index"})||!ref(row->get("index"),current_->parameterTypes.size(),value.index)||!ownedType(row->get("type"),type))return false;
      if(!m_.equal(type,current_->parameterTypes[value.index]))return m_.good&&reject("parameter-source-view");value.type=std::move(type);
    }else if(m_.equal(kind,"global")||m_.equal(kind,"capture")){
      value.kind=m_.equal(kind,"global")?ValueKind::Global:ValueKind::Capture;if(!object(raw,row,{"kind","type","id"})||!ownedType(row->get("type"),type))return false;llvm::StringRef id;if(!symbol(row->get("id"),id))return false;
      const auto *declared=find(m_.equal(kind,"global")?directory_.globals:directory_.captures,id);if(!m_.good)return false;if(!declared)return reject("unowned-global-capture");if(!m_.equal(type,*declared))return m_.good&&reject("root-source-view");
      if(!m_.copy(value.id,id))return false;value.type=std::move(type);
    }else if(m_.equal(kind,"local")||m_.equal(kind,"nonowning")){
      value.kind=m_.equal(kind,"local")?ValueKind::Local:ValueKind::Nonowning;const TypeRow *shape;if(!object(raw,row,{"kind","type"})||!ownedType(row->get("type"),type,&shape))return false;
      if(value.kind==ValueKind::Local&&(shape->kind==TypeKind::Unknown||shape->kind==TypeKind::Union||shape->kind==TypeKind::Void||shape->kind==TypeKind::Future))return reject("local-actual-tag");value.type=std::move(type);
    }else if(m_.equal(kind,"unknown")){
      value.kind=ValueKind::Unknown;if(!object(raw,row,{"kind","type"})||!row->get("type")->getAsNull())return reject("unknown-null-type");
    }else if(m_.equal(kind,"join")||m_.equal(kind,"gate")){
      value.kind=m_.equal(kind,"join")?ValueKind::Join:ValueKind::Gate;if(m_.equal(kind,"join")){if(!object(raw,row,{"kind","type","inputs"}))return false;}else if(!object(raw,row,{"kind","type","inputs","control"})||!ref(row->get("control"),controls_,value.control))return false;
      if(!nullableType(row->get("type"),value.type)||!refs(row->get("inputs"),nodes_,value.inputs))return false;
    }else if(m_.equal(kind,"projection")||m_.equal(kind,"copy")){
      value.kind=m_.equal(kind,"projection")?ValueKind::Projection:ValueKind::Copy;
      if(m_.equal(kind,"projection")){if(!object(raw,row,{"kind","type","bases","selector","view","heap","control"})||!selector(row->get("selector"),value.selector)||!ownedType(row->get("view"),value.view))return false;}
      else if(!object(raw,row,{"kind","type","bases","site","heap","control"})||!text(row->get("site"),value.site))return false;
      if(!ownedType(row->get("type"),type)||!refs(row->get("bases"),nodes_,value.bases)||!ref(row->get("heap"),heaps_,value.heap)||!ref(row->get("control"),controls_,value.control))return false;value.type=std::move(type);
    }else if(m_.equal(kind,"call")){
      value.kind=ValueKind::Call;if(!object(raw,row,{"kind","type","call","completion"})||!ref(row->get("call"),calls_,value.call)||!channel(row->get("completion"),value.completion)||!nullableType(row->get("type"),value.type))return false;
      if(value.completion==Completion::Language){if(value.type)return reject("language-call-null-view");}
      else if(!value.type||!m_.equal(*value.type,callees_[value.call]->returnType))return m_.good&&reject("normal-call-return-view");
    }else return reject("ordinary-value-kind");
    return push(result.graph.nodes,std::move(value),m_);
  }
  bool readHeap(const Json &raw){const Object *row;llvm::StringRef kind;if(!discriminator(raw,row,kind))return false;Heap heap;
    if(m_.equal(kind,"entry")){if(!object(raw,row,{"kind"}))return false;}
    else if(m_.equal(kind,"join")){heap.kind=HeapKind::Join;if(!object(raw,row,{"kind","inputs"})||!refs(row->get("inputs"),heaps_,heap.inputs))return false;}
    else if(m_.equal(kind,"store")){
      heap.kind=HeapKind::Store;if(!object(raw,row,{"kind","previous","bases","selector","view","values","control","initialize"})||!ref(row->get("previous"),heaps_,heap.previous)||!refs(row->get("bases"),nodes_,heap.bases)||!selector(row->get("selector"),heap.selector)||!ownedType(row->get("view"),heap.view)||!refs(row->get("values"),nodes_,heap.values)||!ref(row->get("control"),controls_,heap.control))return false;
      const auto initialize=row->get("initialize")->getAsBoolean();if(!initialize)return reject("initialize-boolean");heap.initialize=*initialize;
    }else if(m_.equal(kind,"copy")){
      heap.kind=HeapKind::Copy;if(!object(raw,row,{"kind","previous","value"})||!ref(row->get("previous"),heaps_,heap.previous)||!ref(row->get("value"),nodes_,heap.value))return false;if(result.graph.nodes[heap.value].kind!=ValueKind::Copy)return reject("clone-copy-node");
    }else if(m_.equal(kind,"call")){heap.kind=HeapKind::Call;if(!object(raw,row,{"kind","call","completion"})||!ref(row->get("call"),calls_,heap.call)||!channel(row->get("completion"),heap.completion))return false;}
    else return reject("ordinary-heap-kind");return push(result.graph.heaps,std::move(heap),m_);
  }
  bool readControl(const Json &raw){const Object *row;llvm::StringRef kind;if(!discriminator(raw,row,kind))return false;Control control;
    if(m_.equal(kind,"entry")){if(!object(raw,row,{"kind"}))return false;}
    else if(m_.equal(kind,"join")){control.kind=ControlKind::Join;if(!object(raw,row,{"kind","inputs"})||!refs(row->get("inputs"),controls_,control.inputs))return false;}
    else if(m_.equal(kind,"call")){control.kind=ControlKind::Call;if(!object(raw,row,{"kind","call","completion"})||!ref(row->get("call"),calls_,control.call)||!channel(row->get("completion"),control.completion))return false;}
    else return reject("ordinary-control-kind");return push(result.graph.controls,std::move(control),m_);
  }
  bool states(const Json *raw,std::vector<State> &out){const Array *rows;if(!array(raw,rows)||!reserve(out,rows->size(),m_))return false;bool first=true;State previous;
    for(const auto &value:*rows){const Object *row;State state;if(!object(value,row,{"heap","control"})||!ref(row->get("heap"),heaps_,state.heap)||!ref(row->get("control"),controls_,state.control))return false;
      if(!first&&(state.heap<previous.heap||(state.heap==previous.heap&&state.control<=previous.control)))return reject("sorted-unique-states");first=false;previous=state;if(!push(out,state,m_))return false;}return true;
  }
  bool accessKey(const Access &access,std::string &out){
    if(!m_.spend(access.values.size()+32))return false;std::size_t capacity=80;
    for(std::size_t i=0;i<access.values.size();++i){if(!m_.spend(24))return false;capacity+=24;}
    if(!m_.text(capacity))return false;out.reserve(capacity);out="{\"control\":";out+=std::to_string(access.control);out+=",\"flag\":\"";out+=flagName(access.flag);out+="\",\"values\":[";
    bool first=true;for(auto id:access.values){if(!m_.spend())return false;if(!first)out+=',';first=false;out+=std::to_string(id);}out+="]}";return true;
  }
public:
  ReadResult result;
  Reader(const Directory &directory,Meter &meter):directory_(directory),m_(meter){}
  bool run(const Json &raw){
    current_=find(directory_.functions,directory_.functionId);if(!m_.good)return false;if(!current_)return reject("unowned-current-function");if(!protocol(*current_)||!signature(*current_))return false;
    const Object *row;if(!object(raw,row,{"format","nodes","heaps","controls","calls","normal","language","exits","accesses"}))return false;
    const Object *format;if(!object(*row->get("format"),format,{"family","version"}))return false;llvm::StringRef family;if(!symbol(format->get("family"),family))return false;
    if(!m_.equal(family,"tsfg.return-origin-graph-candidate"))return m_.good&&reject("ordinary-v3-format");Ref version;if(!ref(format->get("version"),4,version)||version!=3)return reject("ordinary-v3-format");
    const Array *values,*heaps,*controls,*calls,*accesses;
    if(!array(row->get("nodes"),values)||!array(row->get("heaps"),heaps)||!array(row->get("controls"),controls)||!array(row->get("calls"),calls)||!array(row->get("accesses"),accesses))return false;
    nodes_=values->size();heaps_=heaps->size();controls_=controls->size();calls_=calls->size();
    if(!reserve(result.graph.nodes,nodes_,m_)||!reserve(result.graph.heaps,heaps_,m_)||!reserve(result.graph.controls,controls_,m_)||!reserve(result.graph.calls,calls_,m_)||!reserve(callees_,calls_,m_)||!reserve(result.graph.accesses,accesses->size(),m_))return false;
    for(const auto &value:*calls)if(!readCall(value))return false;for(const auto &value:*values)if(!readValue(value))return false;for(const auto &value:*heaps)if(!readHeap(value))return false;for(const auto &value:*controls)if(!readControl(value))return false;
    const Object *exitRows;if(!object(*row->get("exits"),exitRows,{"normal","language"})||!refs(row->get("normal"),nodes_,result.graph.normal)||!refs(row->get("language"),nodes_,result.graph.language)||!states(exitRows->get("normal"),result.graph.exits.normal)||!states(exitRows->get("language"),result.graph.exits.language))return false;
    std::string previous;bool first=true;
    for(const auto &value:*accesses){const Object *access;Access output;if(!object(value,access,{"values","flag","control"})||!refs(access->get("values"),nodes_,output.values)||!ref(access->get("control"),controls_,output.control))return false;llvm::StringRef flag;if(!symbol(access->get("flag"),flag))return false;
      if(m_.equal(flag,"read"))output.flag=AccessFlag::Read;else if(m_.equal(flag,"write"))output.flag=AccessFlag::Write;else if(m_.equal(flag,"structural"))output.flag=AccessFlag::Structural;else return reject("access-flag");
      std::string order;if(!accessKey(output,order)||!m_.text(previous.size())||!m_.text(order.size()))return false;if(!first&&previous>=order)return reject("canonical-access-order");first=false;previous=std::move(order);if(!push(result.graph.accesses,std::move(output),m_))return false;
    }
    result.status=ReadStatus::Typed;result.reason=nullptr;return true;
  }
};
} // namespace Detail

inline ReadResult read(const llvm::json::Value &raw,const Directory &directory,const Charge &charge){
  Detail::Meter meter(charge);Detail::Reader reader(directory,meter);const bool ok=reader.run(raw);
  if(!meter.good){reader.result.status=ReadStatus::BudgetError;reader.result.reason="work-exhausted";}
  if(!ok)reader.result.graph=Graph{};return std::move(reader.result);
}

// The sufficient ordinary certificate implementation follows below. It takes
// typed immutable graphs; read/group/scope/digest admission is not repeated.
namespace Detail {
enum class TaskKind {Values,Node,ValueChoice,HeapChoice,HeapAlternatives,CallChoice,Heap,Call};
struct Task {TaskKind kind=TaskKind::Values;Ref left=0,right=0;std::vector<Ref> leftRefs,rightRefs;};
using SeenKey=std::tuple<TaskKind,Ref,Ref>;
struct Certificate {
  std::vector<Task> pending;
  std::set<SeenKey> seen;
  Symbols<std::string> copies;
  std::map<Ref,Ref> locals,calls;
};

class Inclusion {
  const Graph &body_,&upper_;
  const FixedContracts &fixed_;
  Meter &m_;
  std::vector<const Graph *> graphs_;
  std::map<const Graph *,std::vector<unsigned char>> controls_;
  std::vector<Certificate> search_;
  bool open(const char *reason){result.reason=reason;return false;}
  const Graph *fixed(llvm::StringRef id){
    if(!m_.lookup(fixed_.size(),id.size()))return nullptr;const auto found=fixed_.find(view(id));
    if(found==fixed_.end()||!found->second){open("missing-fixed-call");return nullptr;}return found->second;
  }
  bool addGraph(const Graph &graph){
    if(!m_.lookup(controls_.size(),sizeof(&graph)))return false;if(controls_.find(&graph)!=controls_.end())return true;
    std::vector<unsigned char> bits;if(!reserve(bits,graph.controls.size(),m_))return false;
    for(std::size_t i=0;i<graph.controls.size();++i)if(!push(bits,static_cast<unsigned char>(0),m_))return false;
    if(!m_.lookup(controls_.size(),sizeof(&graph))||!m_.spend()||!push(graphs_,&graph,m_))return false;controls_.emplace(&graph,std::move(bits));return true;
  }
  std::vector<unsigned char> *bits(const Graph &graph){if(!m_.lookup(controls_.size(),sizeof(&graph)))return nullptr;return &controls_.find(&graph)->second;}
  bool live(const Graph &graph,Ref id){auto *values=bits(graph);return values&&(*values)[id]!=0;}
  bool completes(const Graph &graph,Completion completion){for(const auto &state:exits(graph,completion)){if(!m_.spend())return false;if(live(graph,state.control))return true;if(!m_.good)return false;}return false;}
  bool valueLive(const Graph &graph,const Value &value){
    if(!m_.spend())return false;
    if(value.kind==ValueKind::Gate||value.kind==ValueKind::Copy||value.kind==ValueKind::Projection)return live(graph,value.control);
    if(value.kind==ValueKind::Call){const auto &call=graph.calls[value.call];if(!live(graph,call.control))return false;const auto *callee=fixed(call.functionId);return callee&&completes(*callee,value.completion);}return true;
  }
  bool controlClosure(){
    bool changed=true;while(changed){changed=false;for(const auto *graph:graphs_){auto *values=bits(*graph);if(!values)return false;
      for(Ref id=0;id<graph->controls.size();++id){if(!m_.spend())return false;if((*values)[id])continue;const auto &row=graph->controls[id];bool value=row.kind==ControlKind::Entry;
        if(row.kind==ControlKind::Join)for(auto parent:row.inputs){if(!m_.spend())return false;if((*values)[parent]){value=true;break;}}
        if(row.kind==ControlKind::Call){const auto &call=graph->calls[row.call];const auto *callee=fixed(call.functionId);if(!callee)return false;value=live(*graph,call.control)&&completes(*callee,row.completion);}
        if(!m_.good)return false;if(value){(*values)[id]=1;changed=true;}
      }
    }}return true;
  }
  bool visit(std::set<Ref> &seen,Ref id,bool &fresh){if(!m_.lookup(seen.size(),sizeof(id))||!m_.spend())return false;fresh=seen.insert(id).second;return true;}
  bool atoms(const Graph &graph,const std::vector<Ref> &refs,std::vector<Ref> &out){
    std::vector<Ref> pending;if(!copyRefs(pending,refs,m_))return false;std::set<Ref> seen;
    while(!pending.empty()){if(!m_.spend())return false;const auto id=pending.back();pending.pop_back();bool fresh;if(!visit(seen,id,fresh))return false;if(!fresh)continue;const auto &row=graph.nodes[id];
      const bool active=valueLive(graph,row);if(!m_.good)return false;if(!active||row.kind==ValueKind::Nonowning)continue;
      if(row.kind==ValueKind::Join||row.kind==ValueKind::Gate){if(!m_.spend(row.inputs.size()))return false;for(auto input:row.inputs)if(!push(pending,input,m_))return false;}
      else if(!push(out,id,m_))return false;
    }return true;
  }
  bool heapAtoms(const Graph &graph,const std::vector<Ref> &refs,bool optional,std::vector<Ref> &out){
    std::vector<Ref> pending;if(!copyRefs(pending,refs,m_))return false;std::set<Ref> seen;
    while(!pending.empty()){if(!m_.spend())return false;const auto id=pending.back();pending.pop_back();bool fresh;if(!visit(seen,id,fresh))return false;if(!fresh)continue;const auto &row=graph.heaps[id];
      if(row.kind==HeapKind::Join){if(!m_.spend(row.inputs.size()))return false;for(auto input:row.inputs)if(!push(pending,input,m_))return false;continue;}
      if(row.kind==HeapKind::Store){bool inactive=!live(graph,row.control);if(!m_.good)return false;
        if(!inactive){std::vector<Ref> values;if(!atoms(graph,row.values,values))return false;inactive=values.empty();}
        if((inactive||optional)&&!push(pending,row.previous,m_))return false;if(inactive)continue;
      }
      if(row.kind==HeapKind::Copy){std::vector<Ref> seed,values;if(!push(seed,row.value,m_)||!atoms(graph,seed,values))return false;const bool inactive=values.empty();
        if((inactive||optional)&&!push(pending,row.previous,m_))return false;if(inactive)continue;
      }
      if(!push(out,id,m_))return false;
    }return true;
  }
  bool addTask(Certificate &state,Task task){return push(state.pending,std::move(task),m_);}
  bool values(Certificate &state,const std::vector<Ref> &left,const std::vector<Ref> &right){Task task;task.kind=TaskKind::Values;
    if(!copyRefs(task.leftRefs,left,m_)||!copyRefs(task.rightRefs,right,m_))return false;return addTask(state,std::move(task));}
  bool choice(Certificate &state,TaskKind kind,Ref left,const std::vector<Ref> &right){Task task;task.kind=kind;task.left=left;if(!copyRefs(task.rightRefs,right,m_))return false;return addTask(state,std::move(task));}
  bool heap(Certificate &state,Ref left,Ref right){std::vector<Ref> selected;if(!push(selected,right,m_))return false;return choice(state,TaskKind::HeapChoice,left,selected);}
  bool pair(Certificate &state,TaskKind kind,Ref left,Ref right){Task task;task.kind=kind;task.left=left;task.right=right;return addTask(state,std::move(task));}
  bool seen(Certificate &state,const Task &task,bool &old){if(!m_.lookup(state.seen.size(),sizeof(SeenKey))||!m_.spend())return false;old=!state.seen.emplace(task.kind,task.left,task.right).second;return true;}
  bool alpha(std::map<Ref,Ref> &mapping,Ref left,Ref right,bool &matches){
    if(!m_.lookup(mapping.size(),sizeof(left)))return false;const auto old=mapping.find(left);matches=old==mapping.end()||old->second==right;
    if(matches&&old==mapping.end()){if(!m_.lookup(mapping.size(),sizeof(left))||!m_.spend(2))return false;mapping.emplace(left,right);}return true;
  }
  bool copyAlpha(Certificate &state,const std::string &left,const std::string &right,bool &matches){
    if(!m_.lookup(state.copies.size(),left.size()))return false;const auto old=state.copies.find(std::string_view(left));
    matches=old==state.copies.end()||m_.equal(old->second,right);if(!m_.good)return false;
    if(matches&&old==state.copies.end()){if(!m_.lookup(state.copies.size(),left.size())||!m_.text(left.size())||!m_.text(right.size())||!m_.spend(2))return false;state.copies.emplace(left,right);}return true;
  }
  bool fork(const Certificate &state,TaskKind kind,Ref left,Ref right){
    // Pay for every nested pending ref vector and every copied symbol before
    // invoking any standard container copy constructor.
    if(!m_.spend(state.pending.size()+state.seen.size()+state.locals.size()*2+state.calls.size()*2+state.copies.size()*2+1))return false;
    for(const auto &task:state.pending)if(!m_.spend(task.leftRefs.size())||!m_.spend(task.rightRefs.size()))return false;
    for(const auto &row:state.copies)if(!m_.text(row.first.size())||!m_.text(row.second.size()))return false;
    Certificate next=state;if(!pair(next,kind,left,right))return false;return push(search_,std::move(next),m_);
  }
  bool initial(Certificate &state){
    for(auto completion:{Completion::Normal,Completion::Language}){
      std::vector<Ref> right;for(const auto &exit:exits(upper_,completion)){if(!m_.spend())return false;if(live(upper_,exit.control)&&!push(right,exit.heap,m_))return false;if(!m_.good)return false;}
      bool reachable=false;for(const auto &exit:exits(body_,completion)){if(!m_.spend())return false;if(live(body_,exit.control)){reachable=true;if(!choice(state,TaskKind::HeapChoice,exit.heap,right))return false;}if(!m_.good)return false;}
      if(reachable&&right.empty())return open("unmatched-completion");if(reachable&&!values(state,returns(body_,completion),returns(upper_,completion)))return false;
    }
    for(const auto &access:body_.accesses){if(!m_.spend())return false;const bool active=live(body_,access.control);if(!m_.good)return false;if(!active)continue;std::vector<Ref> right;
      for(const auto &allowed:upper_.accesses){if(!m_.spend())return false;if(access.flag==allowed.flag&&live(upper_,allowed.control)){
        if(!m_.spend(allowed.values.size()))return false;for(auto id:allowed.values)if(!push(right,id,m_))return false;}if(!m_.good)return false;}
      if(!values(state,access.values,right))return false;
    }
    // A discarded result/nonterminating call still has observable prefixes.
    for(Ref left=0;left<body_.calls.size();++left){if(!m_.spend())return false;const auto &call=body_.calls[left];const bool active=live(body_,call.control);if(!m_.good)return false;if(!active)continue;std::vector<Ref> right;
      for(Ref id=0;id<upper_.calls.size();++id){if(!m_.spend())return false;const auto &allowed=upper_.calls[id];if(live(upper_,allowed.control)&&m_.equal(call.functionId,allowed.functionId)){if(!push(right,id,m_))return false;}if(!m_.good)return false;}
      if(right.empty())return open("unmatched-live-call");if(!choice(state,TaskKind::CallChoice,left,right))return false;
    }return true;
  }
  bool matchCall(Certificate &state,const Task &task,bool &matches){
    const auto &a=body_.calls[task.left],&b=upper_.calls[task.right];if(!alpha(state.calls,task.left,task.right,matches)||!matches)return m_.good;
    if(!m_.equal(a.functionId,b.functionId)||a.arguments.size()!=b.arguments.size()){matches=false;return m_.good;}
    bool old;if(!seen(state,task,old))return false;if(old)return true;
    if(live(body_,a.control)&&!live(upper_,b.control)){matches=false;return m_.good;}if(!m_.good)return false;
    if(!m_.spend(a.arguments.size()+1))return false;for(Ref i=0;i<a.arguments.size();++i)if(!values(state,a.arguments[i],b.arguments[i]))return false;return heap(state,a.heap,b.heap);
  }
  bool matchNode(Certificate &state,const Task &task,bool &matches){
    const auto &a=body_.nodes[task.left],&b=upper_.nodes[task.right];if(a.kind!=b.kind){matches=false;return true;}
    if(a.kind==ValueKind::Parameter){matches=a.index==b.index;return true;}
    if(a.kind==ValueKind::Global||a.kind==ValueKind::Capture){matches=m_.equal(a.id,b.id);return m_.good;}
    if(a.kind==ValueKind::Unknown)return true; // Overall scan already returns Open.
    if(a.kind==ValueKind::Local){if(!m_.equal(*a.type,*b.type)){matches=false;return m_.good;}return alpha(state.locals,task.left,task.right,matches);}
    if(a.kind==ValueKind::Copy&&(!copyAlpha(state,a.site,b.site,matches)||!matches))return m_.good;
    bool old;if(!seen(state,task,old))return false;if(old)return true;
    if(a.kind==ValueKind::Projection){if(!m_.equal(a.selector,b.selector)||!m_.equal(a.view,b.view)){matches=false;return m_.good;}return values(state,a.bases,b.bases)&&heap(state,a.heap,b.heap);}
    if(a.kind==ValueKind::Copy)return values(state,a.bases,b.bases)&&heap(state,a.heap,b.heap);
    if(a.kind==ValueKind::Call){if(a.completion!=b.completion){matches=false;return true;}return pair(state,TaskKind::Call,a.call,b.call);}
    matches=false;return true;
  }
  bool matchHeap(Certificate &state,const Task &task,bool &matches){
    const auto &a=body_.heaps[task.left],&b=upper_.heaps[task.right];if(a.kind!=b.kind){matches=false;return true;}bool old;if(!seen(state,task,old))return false;if(old)return true;
    if(a.kind==HeapKind::Entry)return true;
    if(a.kind==HeapKind::Store){if(!m_.equal(a.selector,b.selector)||!m_.equal(a.view,b.view)){matches=false;return m_.good;}
      return values(state,a.bases,b.bases)&&values(state,a.values,b.values)&&heap(state,a.previous,b.previous);}
    if(a.kind==HeapKind::Copy)return pair(state,TaskKind::Node,a.value,b.value)&&heap(state,a.previous,b.previous);
    if(a.kind==HeapKind::Call){if(a.completion!=b.completion){matches=false;return true;}return pair(state,TaskKind::Call,a.call,b.call);}
    matches=false;return true;
  }
public:
  InclusionResult result;
  Inclusion(const Graph &body,const Graph &upper,const FixedContracts &fixed,Meter &meter):body_(body),upper_(upper),fixed_(fixed),m_(meter){}
  bool run(){
    if(!m_.spend(fixed_.size()+3)||!addGraph(body_)||!addGraph(upper_))return false;
    for(const auto &row:fixed_){if(!m_.spend())return false;if(!row.second)return open("missing-fixed-call");if(!addGraph(*row.second))return false;}
    for(const auto *graph:graphs_)for(const auto &node:graph->nodes){if(!m_.spend())return false;if(node.kind==ValueKind::Unknown)return open("unknown-data-origin");}
    for(const auto *graph:graphs_)for(const auto &call:graph->calls)if(!fixed(call.functionId))return false;
    if(!controlClosure())return false;Certificate first;if(!initial(first))return false;if(!push(search_,std::move(first),m_))return false;
    while(!search_.empty()){
      if(!m_.spend())return false;Certificate state=std::move(search_.back());search_.pop_back();bool failed=false;
      while(!state.pending.empty()&&!failed){
        if(!m_.spend())return false;Task task=std::move(state.pending.back());state.pending.pop_back();
        if(task.kind==TaskKind::Values){std::vector<Ref> right,left;if(!atoms(upper_,task.rightRefs,right)||!atoms(body_,task.leftRefs,left))return false;
          for(auto id:left)if(!choice(state,TaskKind::ValueChoice,id,right))return false;continue;}
        if(task.kind==TaskKind::ValueChoice||task.kind==TaskKind::HeapAlternatives||task.kind==TaskKind::CallChoice){
          if(task.rightRefs.empty()){failed=true;continue;}const auto kind=task.kind==TaskKind::ValueChoice?TaskKind::Node:task.kind==TaskKind::HeapAlternatives?TaskKind::Heap:TaskKind::Call;
          for(auto right:task.rightRefs){if(!m_.spend()||!fork(state,kind,task.left,right))return false;}failed=true;continue;
        }
        if(task.kind==TaskKind::HeapChoice){std::vector<Ref> right,left,seed;if(!push(seed,task.left,m_)||!heapAtoms(upper_,task.rightRefs,true,right)||!heapAtoms(body_,seed,false,left))return false;
          for(auto id:left)if(!choice(state,TaskKind::HeapAlternatives,id,right))return false;continue;}
        bool matches=true;const bool ok=task.kind==TaskKind::Call?matchCall(state,task,matches):task.kind==TaskKind::Node?matchNode(state,task,matches):matchHeap(state,task,matches);
        if(!ok)return false;failed=!matches;
      }
      if(!failed){result.status=InclusionStatus::Covered;result.reason=nullptr;return true;}
    }return open("no-structural-certificate");
  }
};
} // namespace Detail

inline InclusionResult covered(const Graph &body,const Graph &upper,const FixedContracts &fixed,const Charge &charge){
  Detail::Meter meter(charge);Detail::Inclusion proof(body,upper,fixed,meter);proof.run();
  if(!meter.good){proof.result.status=InclusionStatus::BudgetError;proof.result.reason="work-exhausted";}return proof.result;
}
} // namespace CommonReturnOriginV3
