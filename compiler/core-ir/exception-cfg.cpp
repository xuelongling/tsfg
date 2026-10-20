// SPDX-License-Identifier: MIT
#include "exception-cfg.h"
#include <map>

namespace tsfg::exception {
namespace {
Range range(const Json &value) {
  auto start = field(value,"start").getAsInteger(), end = field(value,"end").getAsInteger();
  return {static_cast<uint32_t>(start.value_or(0)),static_cast<uint32_t>(end.value_or(0))};
}
class Planner {
  const Provenance &proof;
  ExpectedGraph &graph;
  Check &check;
  const Json &function;
  std::string owner, program;
  Array frames, blocks, values, bindings, edges;
  unsigned instructions = 0;
  struct Origin { const Json *statement = nullptr; std::string scope; unsigned index = 0; };
  using Definitions = std::map<std::string,unsigned>;
  struct Resume { const Json *region; unsigned position, statement; Definitions definitions; Range range; };
  struct Task {
    const Json *region = nullptr;
    unsigned position = 0;
    std::string arm, role;
    Definitions definitions;
    Origin origin;
    std::vector<Resume> resumes;
    int carrier = -1;
  };
  struct Frame { const Json *statement = nullptr; std::string id; Definitions outer; } frame;
  std::vector<Task> tasks;
  std::string cid(llvm::StringRef entity,const Json &record) {
    return identity("tsfg.core-exception-candidate." + entity.str() + ".v1",schema,record);
  }
  const Json &root() const { return field(function,"body"); }
  unsigned value(unsigned block,llvm::StringRef type,llvm::StringRef definition,unsigned index,const Json &anchor) {
    if (!check.require(graph.values.size() < 4096,"limit") || !check.step()) return 0;
    unsigned ordinal = graph.values.size();
    if (!check.require(block < blocks.size(),"cfg")) return 0;
    const auto blockId = string(field(blocks[block],"id"));
    Json record = Object{{"program",program},{"owner",owner},{"ordinal",int64_t(ordinal)},
      {"type",type},{"block",blockId},{"definition",definition},{"index",int64_t(index)}};
    auto id = cid("value",record);
    graph.values.push_back({id,type.str(),block});
    values.push_back(Object{{"id",id},{"ordinal",int64_t(ordinal)},{"owner",owner},{"type",type},
      {"block",blockId},{"definition",definition},{"index",int64_t(index)},{"range",anchor}});
    return ordinal;
  }
  unsigned block(Task task,bool carrier) {
    if (!check.require(graph.blocks.size() < 256,"limit") || !check.step()) return 0;
    if (!check.require(task.region != nullptr,"cfg")) return 0;
    unsigned ordinal = graph.blocks.size();
    const auto id = cid("block",Object{{"program",program},{"owner",owner},{"ordinal",int64_t(ordinal)}});
    Array active, pending;
    if (!task.arm.empty()) active.push_back(Object{{"frame",frame.id},{"arm",task.arm}});
    if (task.origin.statement && (task.arm == "finally" || task.role == "escape"))
      pending.push_back(Object{{"scope",task.origin.scope},{"statement",int64_t(task.origin.index)}});
    const auto &region = *task.region;
    const Json &anchor = task.role == "escape" ? field(function,"range") : field(region,"range");
    blocks.push_back(Object{{"id",id},{"ordinal",int64_t(ordinal)},{"owner",owner},
      {"scope",field(region,"scope")},{"position",int64_t(task.position)},{"role",task.role},
      {"frames",std::move(active)},{"pending",std::move(pending)},{"parameters",Array{}},{"range",anchor}});
    graph.blocks.push_back({});
    if (carrier) {
      unsigned argument = value(ordinal,graph.payloadType,"blockArgument",0,anchor);
      if (!check.ok) return 0;
      task.carrier = argument; graph.blocks[ordinal].parameters.push_back(argument);
      (*blocks[ordinal].getAsObject())["parameters"] = Array{graph.values[argument].id};
    }
    tasks.push_back(std::move(task)); return ordinal;
  }
  void operation(unsigned block,ExpectedOperation operation) {
    if (!check.require(instructions < 2048,"limit") || !check.step()) return;
    ++instructions; graph.blocks[block].operations.push_back(std::move(operation));
  }
  void edge(unsigned from,unsigned to,std::string kind,const std::vector<unsigned> &arguments,
            std::string scope,unsigned statement,Range anchor) {
    if (!check.require(edges.size() < 256,"limit") || !check.step()) return;
    if (!check.require(from < blocks.size() && to < blocks.size(),"cfg")) return;
    Array ids;
    for (unsigned argument : arguments) {
      if (!check.require(argument < graph.values.size(),"cfg")) return;
      ids.push_back(graph.values[argument].id);
    }
    auto id = cid("edge",Object{{"program",program},{"owner",owner},{"ordinal",int64_t(edges.size())}});
    edges.push_back(Object{{"id",id},{"ordinal",int64_t(edges.size())},{"owner",owner},
      {"from",field(blocks[from],"id")},{"to",field(blocks[to],"id")},{"kind",std::move(kind)},{"arguments",std::move(ids)},
      {"scope",std::move(scope)},{"statement",int64_t(statement)},{"range",anchor.json()}});
    operation(from,{ExpectedOperation::Branch,anchor,arguments,{},static_cast<int>(to)});
  }
  const Json *binding(const Json &region,llvm::StringRef id) {
    for (const auto &entry : items(field(region,"bindings"))) {
      if (!check.step()) return nullptr;
      if (string(field(entry,"id")) == id) return &entry;
    }
    check.require(false,"scope"); return nullptr;
  }
  void event(const Json &binding,const Json &region,unsigned block,unsigned position,unsigned assigned,
             std::string from,const Json *initializer) {
    if (!check.require(bindings.size() < 256,"limit") || !check.step()) return;
    if (!check.require(block < blocks.size() && assigned < graph.values.size(),"cfg")) return;
    bindings.push_back(Object{{"binding",field(binding,"id")},{"scope",field(region,"scope")},{"kind",field(binding,"role")},
      {"block",field(blocks[block],"id")},{"position",int64_t(position)},{"value",graph.values[assigned].id},
      {"from_binding",std::move(from)},{"type",field(binding,"type")},{"writable",field(binding,"writable")},
      {"range",field(binding,"range")},{"initializer_range",initializer ? Array{*initializer} : Array{}}});
  }
  unsigned read(const Json &expression,const Task &task) {
    auto found = task.definitions.find(string(field(expression,"binding")));
    if (!check.require(found != task.definitions.end(),"scope") || !check.step()) return 0;
    return found->second;
  }
  void enter(unsigned index,const Task &parent,const Json &child,llvm::StringRef arm,
             llvm::StringRef edgeKind,unsigned statement,Range anchor,bool carrier,
             Definitions definitions,std::vector<Resume> resumes,Origin origin) {
    Task next; next.region = &child; next.arm = arm.str(); next.role = "region";
    next.definitions = std::move(definitions); next.resumes = std::move(resumes); next.origin = std::move(origin);
    const auto to = block(std::move(next),carrier); if (!check.ok) return;
    std::vector<unsigned> arguments;
    if (carrier) arguments.push_back(static_cast<unsigned>(parent.carrier));
    edge(index,to,edgeKind.str(),arguments,string(field(*parent.region,"scope")),statement,anchor);
  }
  void transfer(unsigned index,Task &task,const Json &statement,unsigned ordinal,unsigned carrier) {
    Origin origin{&statement,string(field(*task.region,"scope")),ordinal};
    const Json *destination = nullptr;
    std::string arm,kind;
    Definitions definitions;
    if (frame.statement && task.arm == "try" && !field(*frame.statement,"catchClause").getAsNull()) {
      destination = &field(field(*frame.statement,"catchClause"),"region"); arm = "catch"; kind = "catch"; definitions = frame.outer;
    } else if (frame.statement && (task.arm == "try" || task.arm == "catch") && !field(*frame.statement,"finallyRegion").getAsNull()) {
      destination = &field(*frame.statement,"finallyRegion"); arm = "finally"; kind = "finally"; definitions = frame.outer;
    } else { destination = &root(); kind = "escape"; }
    Task next; next.region = destination; next.arm = arm; next.role = kind == "escape" ? "escape" : "region";
    next.origin = origin; next.definitions = std::move(definitions);
    unsigned to = block(std::move(next),true); if (!check.ok) return;
    edge(index,to,kind,{carrier},origin.scope,ordinal,range(field(statement,"range")));
  }
  void process(unsigned index) {
    // Work on an owned copy: destination insertion cannot invalidate this task.
    Task task = tasks[index];
    if (task.role == "escape") {
      if (!check.require(task.origin.statement && task.carrier >= 0 && size_t(task.carrier) < graph.values.size(),"cfg")) return;
      operation(index,{ExpectedOperation::Propagate,range(field(*task.origin.statement,"range")),{static_cast<unsigned>(task.carrier)},{},-1}); return;
    }
    if (!check.require(task.region != nullptr,"cfg")) return;
    const auto &region = *task.region;
    if (task.position == 0) {
      for (const auto &decl : items(field(region,"bindings"))) if (string(field(decl,"role")) == "catch") {
        if (!check.require(task.carrier >= 0 && task.arm == "catch","scope")) return;
        task.definitions[string(field(decl,"id"))] = task.carrier;
        event(decl,region,index,0,task.carrier,"",nullptr);
      }
    }
    const auto &body = items(field(region,"body"));
    for (unsigned at = task.position; check.ok && at < body.size(); ++at) {
      if (!check.step()) return;
      const auto &statement = body[at]; const auto kind = string(field(statement,"kind"));
      if (kind == "local") {
        const auto &initializer = field(statement,"initializer");
        unsigned assigned = read(initializer,task);
        auto *decl = binding(region,string(field(statement,"binding"))); if (!decl || !check.ok) return;
        task.definitions[string(field(*decl,"id"))] = assigned;
        event(*decl,region,index,at,assigned,string(field(initializer,"binding")),&field(initializer,"range"));
      } else if (kind == "throw") {
        unsigned carrier = read(field(statement,"value"),task); if (!check.ok) return;
        if (string(field(field(statement,"value"),"type")) == i32Id) {
          const auto input = carrier;
          carrier = value(index,graph.payloadType,"pack",graph.blocks[index].operations.size(),field(field(statement,"value"),"range"));
          if (!check.ok) return;
          operation(index,{ExpectedOperation::Pack,range(field(field(statement,"value"),"range")),{input},{carrier},-1});
        }
        transfer(index,task,statement,at,carrier); return;
      } else if (kind == "block") {
        auto resumes = task.resumes;
        if (task.arm == "finally") resumes.push_back({task.region,at + 1,at,task.definitions,range(field(statement,"range"))});
        enter(index,task,field(statement,"region"),task.arm,"enter",at,range(field(statement,"range")),task.arm == "finally",task.definitions,std::move(resumes),task.origin); return;
      } else if (kind == "try") {
        if (!check.require(!frame.statement,"cfg")) return;
        frame.statement = &statement; frame.outer = task.definitions;
        frame.id = cid("frame",Object{{"program",program},{"owner",owner},{"scope",field(region,"scope")},{"statement",int64_t(at)}});
        const auto &caught = field(statement,"catchClause"), &finalized = field(statement,"finallyRegion");
        frames.push_back(Object{{"id",frame.id},{"owner",owner},{"scope",field(region,"scope")},{"statement",int64_t(at)},
          {"try_scope",field(field(statement,"tryRegion"),"scope")},
          {"catch_scope",caught.getAsNull() ? Json("") : field(field(caught,"region"),"scope")},
          {"catch_binding",field(caught,"binding").getAsNull() ? Json("") : field(caught,"binding")},
          {"finally_scope",finalized.getAsNull() ? Json("") : field(finalized,"scope")},{"range",field(statement,"range")}});
        enter(index,task,field(statement,"tryRegion"),"try","enter",at,range(field(statement,"range")),false,task.definitions,{},{}); return;
      } else { check.require(false,"cfg"); return; }
    }
    if (!check.require(task.arm == "finally" && task.carrier >= 0 && task.origin.statement,"cfg")) return;
    if (!task.resumes.empty()) {
      auto resumes = task.resumes; auto resume = resumes.back(); resumes.pop_back();
      Task next; next.region = resume.region; next.position = resume.position; next.role = "continuation"; next.arm = "finally";
      next.origin = task.origin; next.resumes = std::move(resumes); next.definitions = std::move(resume.definitions);
      unsigned to = block(std::move(next),true); if (!check.ok) return;
      edge(index,to,"resume",{static_cast<unsigned>(task.carrier)},string(field(*resume.region,"scope")),resume.statement,resume.range);
    } else {
      Task next; next.region = &root(); next.role = "escape"; next.origin = task.origin;
      unsigned to = block(std::move(next),true); if (!check.ok) return;
      edge(index,to,"escape",{static_cast<unsigned>(task.carrier)},task.origin.scope,task.origin.index,range(field(*task.origin.statement,"range")));
    }
  }
public:
  Planner(const Provenance &proof,ExpectedGraph &graph,Check &check)
    : proof(proof),graph(graph),check(check),function(items(field(proof.hir,"functions"))[0]) {}
  bool run() {
    owner = string(field(function,"id"));
    Object semantic = *proof.hir.getAsObject(); semantic.erase("snapshot");
    auto semanticHash = digest(canonical(Json(std::move(semantic))));
    program = cid("program",Object{{"hirSchemaHash",hirSchema},{"semanticHirHash",semanticHash}});
    graph.payloadType = cid("type",Object{{"kind","payload"},{"members",Array{i32Id}}});
    Task entry; entry.region = &root(); entry.role = "entry"; block(std::move(entry),false);
    if (!check.ok) return false;
    const auto &parameters = items(field(function,"parameters")); Array parameterIds;
    for (unsigned i = 0; check.ok && i < parameters.size(); ++i) {
      auto *decl = binding(root(),string(parameters[i])); if (!decl) return false;
      unsigned assigned = value(0,i32Id,"parameter",i,field(*decl,"range"));
      if (!check.ok) return false;
      graph.blocks[0].parameters.push_back(assigned); tasks[0].definitions[string(parameters[i])] = assigned;
      parameterIds.push_back(graph.values[assigned].id); event(*decl,root(),0,0,assigned,"",nullptr);
    }
    (*blocks[0].getAsObject())["parameters"] = std::move(parameterIds);
    operation(0,{ExpectedOperation::Fuel,range(field(function,"range")),{},{},-1});
    for (unsigned i = 0; check.ok && i < tasks.size(); ++i) process(i);
    if (!check.ok) return false;
    graph.marker = Object{{"family","tsfg.core-exception-candidate"},{"version",1},{"schema",schema},{"hir_schema",hirSchema},
      {"hir_hash",digest(proof.hirJcs)},{"semantic_hir_hash",semanticHash},{"program_id",program},{"hir_jcs",proof.hirJcs},
      {"payload_types",Array{Object{{"id",graph.payloadType},{"kind","payload"},{"members",Array{i32Id}}}}},
      {"frames",std::move(frames)},{"blocks",std::move(blocks)},{"values",std::move(values)},
      {"bindings",std::move(bindings)},{"edges",std::move(edges)}};
    return true;
  }
};
} // namespace
bool reconstructGraph(const Provenance &proof,ExpectedGraph &graph,Check &check) {
  if (!check.require(proof.hir.getAsObject() && field(proof.hir,"functions").getAsArray()
      && items(field(proof.hir,"functions")).size() == 1,"cfg")) return false;
  return Planner(proof,graph,check).run();
}
} // namespace tsfg::exception
