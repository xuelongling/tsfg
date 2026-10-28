// SPDX-License-Identifier: MIT
#include "exception-source.h"
#include <map>

namespace tsfg::exception {
namespace {
std::string hirId(llvm::StringRef entity, const Json &record) {
  return identity("tsfg.exception-hir-candidate." + entity.str() + ".v1",hirSchema,record);
}
class Projection {
  const SourceProgram &source;
  Check &check;
  std::string owner;
  std::map<std::string,Json> types;
  unsigned scopes = 0, bindings = 0;
  std::string type(llvm::StringRef name) {
    Json record = name == "i32" ? Json(Object{{"kind","scalar"},{"name","i32"}}) : Json(Object{{"kind","unknown"}});
    const auto id = name == "i32" ? i32Id.str() : hirId("type",record);
    (*record.getAsObject())["id"] = id; types.insert_or_assign(id,std::move(record)); return id;
  }
  Json binding(unsigned raw, llvm::StringRef role, unsigned index, const Array &path, std::map<int,std::string> &visible) {
    if (!check.require(bindings < 256,"limit") || !check.require(raw < source.symbols.size(),"scope") || !check.step()) return nullptr;
    ++bindings;
    const auto &symbol = source.symbols[raw];
    auto id = hirId("binding",Object{{"ownerKind","function"},{"owner",owner},{"scopePath",Json(Array(path))},{"role",role},{"index",int64_t(index)}});
    visible[raw] = id;
    return Object{{"id",id},{"name",symbol.name},{"role",role},{"type",type(symbol.type)},
      {"writable",symbol.writable},{"range",symbol.range.json()},{"presence",symbol.presence}};
  }
  Json read(const SourceStatement &statement, const std::map<int,std::string> &visible) {
    if (!check.require(statement.reference >= 0 && size_t(statement.reference) < source.symbols.size(),"scope")) return nullptr;
    auto found = visible.find(statement.reference);
    if (!check.require(found != visible.end(),"scope") || !check.step()) return nullptr;
    return Object{{"kind","bindingRead"},{"type",type(source.symbols[statement.reference].type)},
      {"range",statement.expression.json()},{"binding",found->second},{"presenceFlow",nullptr}};
  }
  Json region(const SourceRegion &raw, const Array &path, llvm::StringRef role, const Json &parent,
              std::map<int,std::string> visible, bool root, int caught = -1) {
    // The root region counts as depth one, matching the producer's budget.
    if (!check.require(scopes < 64 && path.size() + 1 <= 16,"limit") || !check.step()) return nullptr;
    ++scopes;
    const auto scope = hirId("scope",Object{{"ownerKind","function"},{"owner",owner},{"path",Json(Array(path))}});
    Array declarations, body;
    auto declare = [&](unsigned symbol,llvm::StringRef role,unsigned index) {
      Json entry = binding(symbol,role,index,path,visible);
      if (!check.ok) return false;
      declarations.push_back(std::move(entry)); return true;
    };
    if (root) for (size_t i = 0; i < source.parameters.size(); ++i)
      if (!declare(source.parameters[i],"parameter",i)) return nullptr;
    if (caught >= 0 && !declare(caught,"catch",0)) return nullptr;
    unsigned local = 0;
    for (const auto &statement : raw.body) if (statement.kind == SourceStatement::Alias)
      if (!declare(statement.declaration,"local",local++)) return nullptr;
    auto child = [&](const SourceRegion &nested,size_t index,llvm::StringRef slot,int catchSymbol = -1) -> Json {
      if (!check.require(path.size() + 2 <= 16,"limit")) return nullptr;
      Array next = path; next.push_back(Object{{"statement",int64_t(index)},{"slot",slot}});
      return region(nested,next,slot,Json(scope),visible,false,catchSymbol);
    };
    for (size_t index = 0; check.ok && index < raw.body.size(); ++index) {
      const auto &statement = raw.body[index];
      if (!check.step()) return nullptr;
      if (statement.kind == SourceStatement::Alias) {
        auto found = visible.find(statement.declaration);
        if (!check.require(found != visible.end(),"scope")) return nullptr;
        Json initializer = read(statement,visible); if (!check.ok) return nullptr;
        body.push_back(Object{{"kind","local"},{"range",statement.range.json()},
          {"binding",found->second},{"initializer",std::move(initializer)}});
      } else if (statement.kind == SourceStatement::Throw) {
        Json value = read(statement,visible); if (!check.ok) return nullptr;
        body.push_back(Object{{"kind","throw"},{"range",statement.range.json()},{"value",std::move(value)}});
      } else if (statement.kind == SourceStatement::Block) {
        if (!check.require(bool(statement.region),"scope")) return nullptr;
        Json nested = child(*statement.region,index,"block"); if (!check.ok) return nullptr;
        body.push_back(Object{{"kind","block"},{"range",statement.range.json()},{"region",std::move(nested)}});
      } else {
        if (!check.require(bool(statement.region),"scope")) return nullptr;
        Json attempted = child(*statement.region,index,"try"); if (!check.ok) return nullptr;
        Json caughtClause = nullptr, final = nullptr;
        if (statement.caught) {
          Json handled = child(*statement.caught,index,"catch",statement.catchBinding);
          if (!check.ok) return nullptr;
          Json catchId = nullptr;
          if (statement.catchBinding >= 0) {
            const auto &owned = field(handled,"bindings");
            if (!check.require(owned.getAsArray() && !items(owned).empty(),"scope")) return nullptr;
            const auto &declaration = items(owned)[0];
            if (!check.require(string(field(declaration,"role")) == "catch" && field(declaration,"id").getAsString(),"scope")) return nullptr;
            catchId = field(declaration,"id");
          }
          caughtClause = Object{{"range",statement.catchRange.json()},{"binding",std::move(catchId)},
            {"declarationRange",statement.catchBinding < 0 ? Json(nullptr) : statement.declarationRange.json()},
            {"annotationRange",nullptr},{"region",std::move(handled)}};
        }
        if (statement.finalized) {
          final = child(*statement.finalized,index,"finally"); if (!check.ok) return nullptr;
        }
        body.push_back(Object{{"kind","try"},{"range",statement.range.json()},{"tryRegion",std::move(attempted)},
          {"catchClause",std::move(caughtClause)},{"finallyRegion",std::move(final)}});
      }
    }
    if (!check.ok) return nullptr;
    return Object{{"kind","region"},{"role",role},{"scope",scope},{"parentScope",parent},
      {"path",Json(Array(path))},{"range",raw.range.json()},{"bindings",std::move(declarations)},{"body",std::move(body)}};
  }
public:
  Projection(const SourceProgram &source, Check &check) : source(source), check(check) {}
  Json run(const Json &snapshot) {
    const std::string module = hirId("module",Object{{"source",Object{{"path",source.path},{"digest",digest(source.content)}}},{"external",true}});
    const std::string moduleScope = hirId("scope",Object{{"ownerKind","module"},{"owner",module},{"path",Array{}}});
    Array parameterTypes;
    for (size_t i = 0; i < source.parameters.size(); ++i) parameterTypes.push_back(type("i32"));
    Json signatureRecord = Object{{"parameters",Json(Array(parameterTypes))},{"returnType",type("i32")}};
    const auto signature = hirId("signature",signatureRecord);
    Json callable = Object{{"kind","callable"},{"parameters",Json(Array(parameterTypes))},{"returnType",type("i32")}};
    const auto callableId = hirId("type",callable); (*callable.getAsObject())["id"] = callableId;
    types.insert_or_assign(callableId,std::move(callable));
    owner = hirId("function",Object{{"module",module},{"parent",nullptr},{"declaringScopePath",Array{}},
      {"name",source.name},{"signatureHash",signature},{"range",source.range.json()}});
    Json root = region(source.root,{},"function",nullptr,{},true);
    if (!check.ok) return nullptr;
    const auto &rootBindings = field(root,"bindings");
    if (!check.require(rootBindings.getAsArray() && items(rootBindings).size() >= source.parameters.size(),"scope")) return nullptr;
    Array parameters, initializers;
    for (size_t i = 0; i < source.parameters.size(); ++i) {
      parameters.push_back(field(items(rootBindings)[i],"id")); initializers.push_back(nullptr);
    }
    Json function = Object{{"id",owner},{"module",module},{"sourcePath",source.path},{"name",source.name},
      {"nameRange",source.nameRange.json()},{"range",source.range.json()},{"type",callableId},{"signatureHash",signature},
      {"lexicalParent",nullptr},{"declaringScope",moduleScope},{"parameters",std::move(parameters)},
      {"parameterInitializers",source.parameterInitializersPresent ? Json(std::move(initializers)) : Json(nullptr)},
      {"captures",nullptr},{"returnPresence",nullptr},{"body",std::move(root)}};
    Array typeTable; for (auto &entry : types) typeTable.push_back(std::move(entry.second));
    Json moduleRecord = Object{{"id",module},{"sourcePath",source.path},{"external",true},{"functions",Array{owner}},
      {"aggregateTypes",Array{}},{"imports",Array{}},{"globals",Array{}},{"initialization",nullptr},{"closure",nullptr},{"coverage",nullptr}};
    Json exports = Array{Object{{"module",module},{"sourcePath",source.path},{"external",true},{"bindings",Array{Object{
      {"name",source.name},{"target",owner},{"sourcePath",source.path},{"range",source.range.json()},{"definition",source.nameRange.json()}}}}}};
    return Object{{"format",tsfg::exception::format("tsfg.exception-hir-candidate",hirSchema)},{"snapshot",snapshot},
      {"inputIdentity",field(snapshot,"inputIdentity")},{"sources",field(snapshot,"sources")},{"target",field(snapshot,"target")},
      {"types",std::move(typeTable)},{"functions",Array{std::move(function)}},{"modules",Array{std::move(moduleRecord)}},{"exports",std::move(exports)}};
  }
};
} // namespace
Json reconstructHir(const SourceProgram &program, const Json &snapshot, Check &check) { return Projection(program,check).run(snapshot); }
} // namespace tsfg::exception
