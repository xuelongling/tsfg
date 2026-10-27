// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include <tuple>
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
  struct Summary {Json row;Capabilities caps;};std::map<std::string,Summary> summaries;
  auto function=module.getBody()->begin();
  for(const auto &system:m.systems){
    if(!m.spend())return false;auto fn=llvm::cast<mlir::func::FuncOp>(&*function++);
    const auto path=text(fn,"tsfg_source.path"),id=text(fn,"tsfg_core.function_id");Capabilities declared;
    // All original Query parameters reserve columns, including unused views.
    // A body with no loads does not erase a declared Read/Write capability.
    for(const auto &parameter:system.parameters)if(!parameter.selection.empty())
      for(const auto &item:items(field(field(*parameter.raw,"query"),"items"))){
        if(!m.spend())return false;const auto source=string(field(item,"componentType"));
        access(declared,m.source->typeIds.at(source),source,string(field(item,"mode")));
      }
    Array loops;Counts systemCounts;auto &body=fn.getBody().front();size_t ordinal=0;
    for(auto &operation:body){
      if(!m.spend())return false;if(operation.getName().getStringRef()!="tsfg.chunk")continue;
      auto *query=operation.getOperand(0).getDefiningOp();auto &parallel=operation.getRegion(0).front().front();
      auto &rows=parallel.getRegion(0).front();Capabilities loopCaps;Array columns,operations;Counts loopCounts;
      std::map<mlir::Operation *,std::pair<int64_t,std::string>> columnOrigins;
      for(auto &op:rows){
        if(!m.spend())return false;const auto name=op.getName().getStringRef();
        if(name=="tsfg.column"){
          const auto component=text(&op,"component_type"),mode=text(&op,"mode"),binding=text(&op,"source_binding");
          const auto index=integer(&op,"tuple_index");access(loopCaps,component,sourceTypes.at(component),mode);
          columnOrigins.emplace(&op,std::make_pair(index,binding));
          columns.push_back(Object{{"tupleIndex",index},{"sourceBinding",binding},{"componentType",component},
            {"sourceComponentType",sourceTypes.at(component)},{"mode",mode},{"source",anchor(&op,path)}});
        }else if(name=="tsfg.field_load"||name=="tsfg.field_store"){
          auto *receiver=op.getOperand(0).getDefiningOp();const auto &column=columnOrigins.at(receiver);
          const auto component=text(receiver,"component_type"),semantic=text(&op,"field"),original=text(&op,"source_field");
          const bool read=name=="tsfg.field_load";FieldKey key{component,semantic,original};
          auto &local=loopCounts[key],&whole=systemCounts[key];
          if(read){++local.first;++whole.first;}else{++local.second;++whole.second;}
          operations.push_back(Object{{"kind",read?"read":"write"},{"componentType",component},{"field",semantic},
            {"sourceField",original},{"tupleIndex",column.first},{"sourceBinding",column.second},{"source",anchor(&op,path)}});
        }
      }
      loops.push_back(Object{{"index",int64_t(ordinal++)},{"selectionId",llvm::cast<QueryType>(query->getResult(0).getType()).key().str()},
        {"queryBinding",text(query,"source_binding")},{"source",anchor(&parallel,path)},{"columns",std::move(columns)},
        {"capabilities",capabilities(loopCaps)},{"fieldEffects",fields(loopCounts)},{"operations",std::move(operations)}});
    }
    Json row=Object{{"functionId",id},{"sourceFunctionId",text(fn,"tsfg.query_source_function")},
      {"signatureHash",text(fn,"tsfg_core.signature_hash")},{"source",anchor(fn,path)},
      {"capabilities",capabilities(declared)},{"fieldEffects",fields(systemCounts)},{"loops",std::move(loops)}};
    summaries.emplace(id,Summary{std::move(row),std::move(declared)});
  }
  Array conflicts;
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
  result=Object{{"family","tsfg.system-query-effects-candidate"},{"version",1},{"queryVersion",1},
    {"coreVersion",text(module,"tsfg_core.version")},{"inputIdentity",m.p.inputIdentity},{"packageId",field(m.source->facts,"packageId")},
    {"target",field(field(m.payload(),"program"),"target")},
    {"source",Object{{"path",m.p.sourcePath},{"sha256",m.p.sourceHash},{"utf16Length",int64_t(m.p.sourceLength)}}},
    {"systems",std::move(systems)},{"conflicts",std::move(conflicts)}};
  return true;
}
} // namespace tsfg::systemQuery
