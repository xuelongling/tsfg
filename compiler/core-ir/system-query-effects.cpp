// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <tuple>
#include <functional>
#include "llvm/ADT/DenseMap.h"
namespace tsfg::systemQuery {
namespace {
using Capabilities=std::map<std::string,std::pair<std::string,std::string>>;
using FieldKey=std::tuple<std::string,std::string,std::string>;
using Counts=std::map<FieldKey,std::pair<int64_t,int64_t>>;
std::string text(mlir::Operation *op,llvm::StringRef key){return op->getAttrOfType<mlir::StringAttr>(key).getValue().str();}
int64_t integer(mlir::Operation *op,llvm::StringRef key){return op->getAttrOfType<mlir::IntegerAttr>(key).getInt();}
Json anchor(mlir::Operation *op,const std::string &path){
  return Object{{"path",path},{"start",integer(op,"tsfg_source.start")},{"end",integer(op,"tsfg_source.end")}};
}
Json call(mlir::Operation *op,const std::string &path){
  return Object{{"functionId",text(op,"tsfg_core.function_id")},{"sourceHelperId",text(op,"tsfg.query_source_callee")},{"signatureHash",text(op,"tsfg_core.signature_hash")},
    {"source",anchor(op,path)},{"calleeSource",Object{{"path",path},{"start",integer(op,"callee_start")},{"end",integer(op,"callee_end")}}}};
}
void access(Capabilities &caps,const std::string &component,const std::string &source,const std::string &mode){
  auto [it,added]=caps.emplace(component,std::make_pair(source,mode));
  if(!added&&mode=="write")it->second.second="write";
}
Json capabilities(const Capabilities &caps){Array rows;
  for(const auto &[component,entry]:caps)rows.push_back(Object{{"componentType",component},{"sourceComponentType",entry.first},{"mode",entry.second}});
  return rows;
}
Json fields(const Counts &counts){Array rows;
  for(const auto &[key,count]:counts)rows.push_back(Object{{"componentType",std::get<0>(key)},{"field",std::get<1>(key)},
    {"sourceField",std::get<2>(key)},{"readCount",count.first},{"writeCount",count.second}});
  return rows;
}
}
// This is inward of independent whole-Source/typed-SSA verification. In
// particular, field receivers are actual column SSA results, not DTO claims.
bool collectEffects(mlir::ModuleOp module,Model &m,Json &result){
  std::map<std::string,std::string> sourceTypes;
  for(const auto &[source,semantic]:m.source->typeIds)sourceTypes.emplace(semantic,source);
  std::map<std::string,mlir::func::FuncOp> helperFunctions;
  for(auto fn:module.getOps<mlir::func::FuncOp>())if(fn->hasAttr("tsfg.query_source_helper"))helperFunctions.emplace(text(fn,"tsfg_core.function_id"),fn);
  struct Origin {int64_t index;std::string binding;};
  using Environment=llvm::DenseMap<mlir::Value,Origin>;
  // Follow actual SSA operands, including the permission-narrowing result.
  // A callee formal is mapped to the caller's same column identity; Source
  // anchors remain at the real field op and the complete call path is retained.
  std::function<bool(mlir::Block &,Environment,const std::string &,Array,Counts &,Array *,Array &)> walk;
  walk=[&](mlir::Block &body,Environment origins,const std::string &path,Array callPath,Counts &counts,Array *operations,Array &calls){
    if(!m.need(callPath.size()<=32,"effect call path exceeds32"))return false;
    for(auto &op:body){
      if(!m.spend())return false;const auto name=op.getName().getStringRef();
      if(name=="tsfg.view_borrow")origins[op.getResult(0)]=origins.find(op.getOperand(0))->second;
      else if(name=="func.call"){
        const auto edge=call(&op,path);if(callPath.empty())calls.push_back(edge);
        auto fn=helperFunctions.at(text(&op,"tsfg_core.function_id"));Environment nested;
        for(size_t i=0;i<op.getNumOperands();++i)if(auto it=origins.find(op.getOperand(i));it!=origins.end())nested[fn.getArgument(i)]=it->second;
        auto next=callPath;next.push_back(edge);Array ignored;
        if(!walk(fn.getBody().front(),std::move(nested),text(fn,"tsfg_source.path"),std::move(next),counts,operations,ignored))return false;
      }else if(name=="tsfg.field_load"||name=="tsfg.field_store"){
        const auto &origin=origins.find(op.getOperand(0))->second;const auto component=text(&op,"component_type"),semantic=text(&op,"field"),original=text(&op,"source_field");
        const bool read=name=="tsfg.field_load";auto &count=counts[FieldKey{component,semantic,original}];if(read)++count.first;else ++count.second;
        if(operations)operations->push_back(Object{{"kind",read?"read":"write"},{"componentType",component},{"field",semantic},{"sourceField",original},
          {"tupleIndex",origin.index},{"sourceBinding",origin.binding},{"source",anchor(&op,path)},{"callPath",Array(callPath)}});
      }
    }
    return true;
  };
  struct Summary {Json row;Capabilities caps;};std::map<std::string,Summary> summaries;
  auto function=module.getBody()->begin();
  for(const auto &system:m.systems){
    if(!m.spend())return false;auto fn=llvm::cast<mlir::func::FuncOp>(&*function++);
    const auto path=text(fn,"tsfg_source.path"),id=text(fn,"tsfg_core.function_id");Capabilities declared;
    for(const auto &parameter:system.parameters)if(!parameter.selection.empty())
      for(const auto &item:items(field(field(*parameter.raw,"query"),"items"))){
        if(!m.spend())return false;const auto source=string(field(item,"componentType"));access(declared,m.source->typeIds.at(source),source,string(field(item,"mode")));
      }
    Array loops,systemCalls;Counts systemCounts;size_t ordinal=0;
    for(auto &operation:fn.getBody().front()){
      if(!m.spend())return false;if(operation.getName().getStringRef()!="tsfg.chunk")continue;
      auto *query=operation.getOperand(0).getDefiningOp();auto &parallel=operation.getRegion(0).front().front();auto &rows=parallel.getRegion(0).front();
      Capabilities loopCaps;Array columns,operations,calls;Counts loopCounts;Environment origins;
      for(auto &op:rows){
        if(!m.spend())return false;if(op.getName().getStringRef()!="tsfg.column")continue;
        const auto component=text(&op,"component_type"),mode=text(&op,"mode"),binding=text(&op,"source_binding");const auto index=integer(&op,"tuple_index");
        access(loopCaps,component,sourceTypes.at(component),mode);origins[op.getResult(0)]={index,binding};
        columns.push_back(Object{{"tupleIndex",index},{"sourceBinding",binding},{"componentType",component},{"sourceComponentType",sourceTypes.at(component)},{"mode",mode},{"source",anchor(&op,path)}});
      }
      if(!walk(rows,std::move(origins),path,{},loopCounts,&operations,calls))return false;
      for(const auto &[key,count]:loopCounts){systemCounts[key].first+=count.first;systemCounts[key].second+=count.second;}
      for(const auto &edge:calls)systemCalls.push_back(edge);
      loops.push_back(Object{{"index",int64_t(ordinal++)},{"selectionId",llvm::cast<QueryType>(query->getResult(0).getType()).key().str()},
        {"queryBinding",text(query,"source_binding")},{"source",anchor(&parallel,path)},{"columns",std::move(columns)},
        {"capabilities",capabilities(loopCaps)},{"fieldEffects",fields(loopCounts)},{"operations",std::move(operations)},{"calls",std::move(calls)}});
    }
    Json row=Object{{"functionId",id},{"sourceFunctionId",text(fn,"tsfg.query_source_function")},{"signatureHash",text(fn,"tsfg_core.signature_hash")},
      {"source",anchor(fn,path)},{"capabilities",capabilities(declared)},{"fieldEffects",fields(systemCounts)},{"loops",std::move(loops)},{"calls",std::move(systemCalls)}};
    summaries.emplace(id,Summary{std::move(row),std::move(declared)});
  }  Array conflicts;
  for(auto left=summaries.begin();left!=summaries.end();++left)for(auto right=std::next(left);right!=summaries.end();++right){
    if(!m.spend())return false;Array overlap;
    for(const auto &[component,entry]:left->second.caps){
      if(!m.spend())return false;auto other=right->second.caps.find(component);
      // Component columns are the borrowing unit: distinct fields do not
      // authorize two writers, while Read/Read shares the same column.
      if(other!=right->second.caps.end()&&(entry.second=="write"||other->second.second=="write"))overlap.push_back(component);
    }
    if(!overlap.empty())conflicts.push_back(Object{{"left",left->first},{"right",right->first},{"components",std::move(overlap)}});
  }
  Array systems;for(auto &[id,summary]:summaries)systems.push_back(std::move(summary.row));
  struct ScalarSummary {mlir::func::FuncOp fn;std::set<std::string> direct;Array calls;Counts counts;};std::map<std::string,ScalarSummary> scalarSummaries;
  for(const auto &helper:m.scalarHelpers){
    auto fn=helperFunctions.at(helper.id);ScalarSummary summary{fn,{},{},{}};Environment origins;
    for(size_t i=0;i<helper.parameters.size();++i){const auto &p=*helper.parameters[i].raw;if(!field(p,"view").getAsNull())origins[fn.getArgument(i)]={int64_t(i),string(field(field(p,"binding"),"id"))};}
    if(!walk(fn.getBody().front(),std::move(origins),text(fn,"tsfg_source.path"),{},summary.counts,nullptr,summary.calls))return false;
    for(const auto &edge:summary.calls)summary.direct.insert(string(field(edge,"functionId")));
    scalarSummaries.emplace(helper.id,std::move(summary));
  }  Array scalarHelpers;
  for(auto &[id,summary]:scalarSummaries){
    std::set<std::string> transitive;std::vector<std::string> pending(summary.direct.begin(),summary.direct.end());
    for(size_t i=0;i<pending.size();++i){if(!m.spend())return false;const auto next=pending[i];if(!transitive.insert(next).second)continue;const auto &nested=scalarSummaries.at(next).direct;pending.insert(pending.end(),nested.begin(),nested.end());}
    Array direct,all;for(const auto &callee:summary.direct)direct.push_back(callee);for(const auto &callee:transitive)all.push_back(callee);
    auto fn=summary.fn;scalarHelpers.push_back(Object{{"functionId",id},{"sourceFunctionId",text(fn,"tsfg.query_source_function")},{"sourceHelperId",text(fn,"tsfg.query_source_helper")},
      {"signatureHash",text(fn,"tsfg_core.signature_hash")},{"source",anchor(fn,text(fn,"tsfg_source.path"))},{"fieldEffects",fields(summary.counts)},
      {"calls",std::move(summary.calls)},{"directCallees",std::move(direct)},{"transitiveCallees",std::move(all)}});
  }
  result=Object{{"family","tsfg.system-query-effects-candidate"},{"version",3},{"queryVersion",3},
    {"coreVersion",text(module,"tsfg_core.version")},{"inputIdentity",m.p.inputIdentity},{"packageId",field(m.source->facts,"packageId")},
    {"target",field(field(m.payload(),"program"),"target")},
    {"source",Object{{"path",m.p.sourcePath},{"sha256",m.p.sourceHash},{"utf16Length",int64_t(m.p.sourceLength)}}},
    {"systems",std::move(systems)},{"conflicts",std::move(conflicts)},{"scalarHelpers",std::move(scalarHelpers)}};
  return true;
}
} // namespace tsfg::systemQuery
