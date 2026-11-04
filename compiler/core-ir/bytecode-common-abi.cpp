// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"
#include "bytecode-common-budget.h"
#include "bytecode.h"

namespace tsfg::wire::common {
using namespace commonProgram;
bool Builder::abiTable() {
  std::map<std::string,const Json *> physical;
  for(const auto &row:items(field(source.representation,"functions"))){if(!step())return false;physical.emplace(string(field(row,"id")),&row);}
  Array abis;
  for(const auto &[id,actual]:functions){
    if(!step(1+actual->name.size()/64))return false;
    const auto declared=sourceFunctions.find(id);const bool initializer=declared==sourceFunctions.end();
    wire::Function fn;
    if(!bytecode::decodeHash(id,fn.id)||!bytecode::decodeHash(actual->signature,fn.signature))return reject("Common admitted function identity is absent");
    fn.abi=functionIds.at(id);fn.source=sourceIds.at(actual->path);fn.declaration={actual->range.start,actual->range.end};
    fn.role=initializer?2:string(field(*declared->second,"kind"))=="construction-body"?1:0;
    fn.name=initializer?"$moduleInit":string(field(*declared->second,"name"));
    Array parameters,argumentTypes,physicalParameters;Json receiver=nullptr,lexical=nullptr,result=nullptr,resultCarrier=nullptr,construction=nullptr,receiverFrame=nullptr,methodMinimum=nullptr;
    if(!initializer){
      const auto &row=*declared->second;
      if(!step())return false;methodMinimum=field(row,"methodMinimumArgumentCount");
      // The required Core4 provider admits each Source3 FDI step's binding,
      // ordinal and raw incoming type before normalization reaches this owner.
      // Consume that owned HIR; do not reconstruct defaults in this adapter.
      // Incoming views stay separate from declarations and physical carriers.
      if(!step(2))return false;const auto &initialization=field(row,"parameterInitialization");
      const bool fdi=!initialization.getAsNull();const auto &steps=items(field(initialization,"steps"));size_t ordinal=0;
      for(const auto &parameter:items(field(row,"parameters"))){
        if(!step())return false;parameters.emplace_back(bindingIds.at(string(field(parameter,"id"))));
        if(!step(2))return false;const auto incoming=*field(fdi?steps[ordinal]:parameter,fdi?"argumentType":"type").getAsString();
        if(!step(1+incoming.size()/64))return false;argumentTypes.emplace_back(typeIds.at(incoming.str()));++ordinal;
      }
      const auto own=string(field(row,"receiverBinding")),environment=string(field(row,"lexicalEnvironment"));
      if(!own.empty())receiver=bindingIds.at(own);if(!environment.empty())lexical=environmentIds.at(environment);
      const auto type=string(field(row,"returnType"));
      if(fn.role==1){
        if(!step())return false;const auto owner=*field(row,"ownerType").getAsString();uint16_t selected;
        if(!constructionIndex(owner,selected))return false;construction=selected;
        if(!step(1+owner.size()/64))return false;
        const auto target=field(field(*types.at(owner.str()),"construction"),"functionId").getAsString();
        if(!target||*target!=id)
          return reject("Common constructor ABI function differs from its owned construction");
        const size_t frame=environment.empty()?0:1;const auto &entry=actual->blocks.front().parameters;
        if(!step(2+owner.size()/64))return false;
        if(frame>=entry.size()||actual->carriers[entry[frame]]!="receiver:"+owner.str())return reject("Common constructor ABI lacks its admitted hidden receiver frame");
        receiverFrame=int64_t(frame);
        // Physical result comes from the actual Core signature. Recover its
        // logical view only from admitted normal-return operands, not void
        // Source declarations, current tags or a guessed object category.
        const auto &views=source.registerViews.at(id);
        for(const auto &block:actual->blocks){
          if(!step())return false;
          for(const auto &op:block.operations){
            if(!step())return false;if(op.name!="func.return")continue;
            if(op.operands.size()!=1)return reject("Common constructor normal result has no represented payload view");
            if(!step())return false;const auto found=typeIds.find(views[op.operands[0]]);
            if(found==typeIds.end())return reject("Common constructor normal result view is outside its admitted type directory");
            if(!result.getAsNull()&&result.getAsInteger()!=int64_t(found->second))return reject("Common constructor normal result views differ");
            result=found->second;
          }
        }
        if(result.getAsNull()||actual->resultCarrier=="void")return reject("Common constructor result ABI requires an admitted normal payload view");
      }else if(type!="void"&&string(field(*types.at(type),"kind"))!="void")result=typeIds.at(type);
    }
    const auto &contract=*physical.at(id);
    for(const auto &parameter:items(field(contract,"parameters"))){
      Json value=nullptr;if(!carrier(string(parameter),value))return false;physicalParameters.push_back(std::move(value));
    }
    // A terminator's lack of its own result says nothing about the callee:
    // its actual result carrier is marshalled through the normal successor.
    if(!carrier(actual->resultCarrier,resultCarrier,true))return false;
    size_t comparisons=1;for(auto count=source.sourcePlans.size();count;count>>=1){if(!step())return false;comparisons+=2;}
    if(!step(2+comparisons*(id.size()/64+1)))return false;const auto plan=source.sourcePlans.find(id);
    if(plan==source.sourcePlans.end())return reject("Common function lacks a completely matched logical graph witness");
    Json canonicalPlan=nullptr;
    {
      WorkScope work(source,out.remaining);commonProgram::Error failure;
      if(!returnOriginMetadataCost(source,plan->second,failure))return reject(failure.message);
      canonicalPlan=plan->second;
    }
    // Wire canonicalization is confined to this owned output copy. The warm
    // graph and its matched semantic register/block identities stay unchanged.
    size_t operationCount=0;
    for(auto &block:*canonicalPlan.getAsObject()->getArray("blocks")){
      auto &rows=*block.getAsObject()->getArray("operations");
      if(!step(12))return false;Array projected;projected.reserve(std::min<size_t>(8192,rows.size()*2));
      for(auto &operation:rows){
        if(!step(9)||++operationCount>8192)return reject("Common canonical logical instruction count bound");
        auto &row=*operation.getAsObject();auto &props=*row.getObject("properties");const auto name=*row.getString("name");
        if(name=="constant"||name=="floating"){
          const auto token=*props.getString("token");if(!step(3+token.size()/64))return false;
          // Decimal or exact floating bits are the complete encoded value.
          props.erase("token");
        }else if(name.starts_with("receiver_")||name.starts_with("initialize_")){
          const auto owner=*props.getString("owner");size_t comparisons=1;
          for(auto count: {types.size(),constructionIds.size()})for(;count;count>>=1){if(!step())return false;comparisons+=2;}
          if(!step(comparisons*(owner.size()/64+1)))return false;uint16_t selected;
          if(!constructionIndex(owner,selected)||!step(3))return false;
          const auto construction=*field(items(field(out.table(Table::Members),"constructions"))[selected],"id").getAsString();
          if(!step(3+construction.size()/32))return false;
          if(name=="receiver_create"&&props.getString("construction")!=construction)
            return reject("Common logical receiver creation differs from its admitted construction");
          props["construction"]=construction;
        }else if(name=="catch_bind"){
          const auto binding=*props.getString("binding");size_t comparisons=1;
          for(auto count=bindingIds.size();count;count>>=1){if(!step())return false;comparisons+=2;}
          if(!step(12+(comparisons+1)*(binding.size()/64+1)))return false;
          const auto selected=bindingIds.find(binding.str());
          if(selected==bindingIds.end())return reject("Common logical catch lacks its admitted binding");
          const auto &slot=bindings[selected->second];const auto result=*row.getInteger("result");
          const auto view=*row.getString("view"),cell=*items(field(canonicalPlan,"carriers"))[size_t(result)].getAsString();
          if(!step(8+(slot.owner.size()+slot.type.size()+binding.size()+view.size()+cell.size())/32))return false;
          if(slot.owner!=id||slot.role!="local"||slot.declaration!="catch"||slot.type!=view||
            !cell.starts_with("cell:")||cell.drop_front(5)!=binding)
            return reject("Common logical catch Cell/binding owner/view differs");
          Json originalSource=nullptr;
          {
            WorkScope work(source,out.remaining);commonProgram::Error failure;
            if(!returnOriginMetadataCost(source,field(operation,"source"),failure))return reject(failure.message);
            originalSource=field(operation,"source");
          }
          if(!step(20+binding.size()/64)||++operationCount>8192)return reject("Common canonical catch instruction count bound");
          Json store=Object{{"name","store"},{"view","void"},{"properties",Object{{"binding",binding},{"initialize",true}}},
            {"result",nullptr},{"operands",Array{Json(result),items(field(operation,"operands"))[0]}},{"successors",Array{}},
            {"source",std::move(originalSource)}};
          row["name"]="cell";row["operands"]=Array{};
          projected.push_back(std::move(operation));projected.push_back(std::move(store));continue;
        }
        projected.push_back(std::move(operation));
      }
      rows=std::move(projected);
    }
    abis.emplace_back(Object{{"sourcePlan",std::move(canonicalPlan)},{"kind","common"},{"function",functionIds.at(id)},{"signature",actual->signature},
      {"methodMinimumArgumentCount",std::move(methodMinimum)},{"parameters",std::move(parameters)},{"argumentTypes",std::move(argumentTypes)},{"receiver",std::move(receiver)},{"construction",std::move(construction)},
      {"receiverFrame",std::move(receiverFrame)},{"lexicalEnvironment",std::move(lexical)},
      {"physicalParameters",std::move(physicalParameters)},{"result",std::move(result)},{"resultCarrier",std::move(resultCarrier)}});
    out.functions.push_back(std::move(fn));
  }
  out.table(Table::Abis)=std::move(abis);return true;
}
} // namespace tsfg::wire::common
