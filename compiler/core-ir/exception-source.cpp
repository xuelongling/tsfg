// SPDX-License-Identifier: MIT
#include "exception-source.h"
#include "llvm/Support/ConvertUTF.h"
#include <set>

namespace tsfg::exception {
Json SourceSymbol::json() const {
  Object value{{"id",id},{"name",name},{"kind",kind},{"type",type},{"writable",writable},{"range",range.json()}};
  if (!presence.getAsNull()) value["presence"] = presence;
  return value;
}
namespace {
struct Token { std::string text; uint32_t start, end; };
bool space(char16_t c) {
  return c == 9 || c == 10 || c == 11 || c == 12 || c == 13 || c == 32 || c == 0xa0 || c == 0x1680
    || (c >= 0x2000 && c <= 0x200a) || c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff;
}
bool initial(char16_t c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '$'; }
bool continued(char16_t c) { return initial(c) || (c >= '0' && c <= '9'); }
bool reserved(llvm::StringRef name) {
  constexpr llvm::StringLiteral words = " break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with implements interface let package private protected public static yield await eval arguments ";
  return words.contains(" " + name.str() + " ");
}
class Reader {
  SourceProgram &program;
  Check &check;
  std::u16string source;
  std::vector<Token> tokens;
  size_t next = 0;
  unsigned regions = 0, statements = 0, tries = 0;
  const Token &token(size_t index) const { static const Token empty{"",0,0}; return index < tokens.size() ? tokens[index] : empty; }
  bool is(llvm::StringRef text) const { return token(next).text == text; }
  bool expect(llvm::StringRef text) {
    if (!check.require(next < tokens.size() && is(text), "source")) return false;
    ++next; return true;
  }
  uint32_t rawStart(size_t index) const { return index ? token(index - 1).end : 0; }
  Range raw(size_t begin, size_t end) const { return {rawStart(begin), token(end).end}; }
  bool line(uint32_t start, uint32_t end) const {
    for (uint32_t i = start; i < end && i < source.size(); ++i)
      if (source[i] == 10 || source[i] == 13 || source[i] == 0x2028 || source[i] == 0x2029) return true;
    return false;
  }
  std::string name() {
    auto value = token(next).text;
    if (!check.require(!value.empty() && initial(value[0]) && !reserved(value), "source")) return {};
    ++next; return value;
  }
  int symbol(llvm::StringRef spelling, llvm::StringRef kind, llvm::StringRef type, bool writable, Range range, Json presence = nullptr) {
    if (!check.require(program.symbols.size() <= 256, "limit")) return -1;
    int index = static_cast<int>(program.symbols.size());
    program.symbols.push_back({"s" + std::to_string(index + 1),spelling.str(),type.str(),kind.str(),writable,range,std::move(presence)});
    return index;
  }
  bool separator() {
    if (is(";")) { ++next; return true; }
    return check.require(next < tokens.size() && (is("}") || line(token(next - 1).end, token(next).start)), "source");
  }
  std::unique_ptr<SourceRegion> child(unsigned parentDepth) {
    if (!check.require(parentDepth < 16 && regions < 64, "limit")) return {};
    return std::make_unique<SourceRegion>();
  }
  void block(SourceRegion &region, unsigned depth, bool normal) {
    if (!check.require(depth <= 16 && regions < 64, "limit")) return;
    ++regions; size_t first = next;
    if (!expect("{")) return;
    bool terminal = false;
    while (check.ok && next < tokens.size() && !is("}")) {
      if (!check.require(!terminal && statements < 512, "source") || !check.step()) return;
      ++statements; SourceStatement statement;
      const size_t begin = next;
      if (is("const") || is("let")) {
        bool writable = is("let"); ++next;
        size_t identifier = next; auto spelling = name(); Range binding = raw(identifier, identifier);
        if (is(":")) { ++next; expect("i32"); }
        expect("="); size_t reference = next; statement.readName = name();
        statement.expression = raw(reference, reference);
        statement.kind = SourceStatement::Alias; statement.range = raw(identifier, reference);
        statement.declaration = symbol(spelling, "local", "i32", writable, binding);
        separator();
      } else if (is("throw")) {
        if (!check.require(!normal, "source")) return;
        ++next; if (!check.require(!line(token(begin).end, token(next).start), "source")) return;
        size_t reference = next; statement.readName = name(); statement.expression = raw(reference, reference);
        separator(); statement.range = raw(begin, next - 1); statement.kind = SourceStatement::Throw; terminal = true;
      } else if (is("{")) {
        statement.kind = SourceStatement::Block; statement.region = child(depth); if (!statement.region) return;
        block(*statement.region, depth + 1, normal); if (!check.ok) return;
        statement.range = statement.region->range; terminal = !normal;
      } else if (is("try")) {
        if (!check.require(!normal && tries++ == 0, "source")) return;
        ++next; statement.kind = SourceStatement::Try; statement.region = child(depth); if (!statement.region) return;
        block(*statement.region, depth + 1, false); if (!check.ok) return;
        if (is("catch")) {
          const size_t catchFirst = next++;
          if (is("(")) {
            ++next; size_t identifier = next; auto spelling = name();
            statement.declarationRange = raw(identifier, identifier);
            statement.catchBinding = symbol(spelling, "local", "unknown", true, statement.declarationRange);
            expect(")");
          }
          statement.caught = child(depth); if (!statement.caught) return;
          block(*statement.caught, depth + 1, false); if (!check.ok) return;
          statement.catchRange = raw(catchFirst, next - 1);
        }
        if (is("finally")) {
          ++next; statement.finalized = child(depth); if (!statement.finalized) return;
          block(*statement.finalized, depth + 1, true); if (!check.ok) return;
        }
        check.require(statement.caught || statement.finalized, "source");
        statement.range = raw(begin, next - 1); terminal = true;
      } else { check.require(false, "source"); return; }
      if (check.ok) region.body.push_back(std::move(statement));
    }
    if (!expect("}")) return;
    region.range = raw(first, next - 1);
    check.require(normal || terminal, "source");
  }
  void resolve(SourceRegion &region, std::map<std::string,int> visible, std::set<std::string> declared,
               std::set<int> pending) {
    for (const auto &statement : region.body) if (statement.kind == SourceStatement::Alias) {
      const auto &binding = program.symbols[statement.declaration];
      if (!check.require(declared.insert(binding.name).second, "scope")) return;
      visible[binding.name] = statement.declaration; pending.insert(statement.declaration);
    }
    for (auto &statement : region.body) {
      if (!check.ok || !check.step()) return;
      if (statement.kind == SourceStatement::Alias || statement.kind == SourceStatement::Throw) {
        auto found = visible.find(statement.readName);
        if (!check.require(found != visible.end() && !pending.count(found->second), "scope")) return;
        statement.reference = found->second;
        const auto &value = program.symbols[statement.reference];
        if (statement.kind == SourceStatement::Alias) {
          if (!check.require(value.type == "i32", "type")) return;
          pending.erase(statement.declaration);
        }
      } else if (statement.kind == SourceStatement::Block) {
        resolve(*statement.region, visible, {}, pending); if (!check.ok) return;
      } else {
        resolve(*statement.region, visible, {}, pending); if (!check.ok) return;
        if (statement.caught) {
          auto caughtVisible = visible; std::set<std::string> caughtDeclared;
          if (statement.catchBinding >= 0) {
            const auto &binding = program.symbols[statement.catchBinding];
            caughtVisible[binding.name] = statement.catchBinding; caughtDeclared.insert(binding.name);
          }
          resolve(*statement.caught, std::move(caughtVisible), std::move(caughtDeclared), pending); if (!check.ok) return;
        }
        if (statement.finalized) { resolve(*statement.finalized, visible, {}, pending); if (!check.ok) return; }
      }
    }
  }
public:
  Reader(SourceProgram &program, Check &check) : program(program), check(check) {}
  bool run() {
    if (!check.require(program.content.size() <= 262144, "limit")) return false;
    auto *firstByte = reinterpret_cast<const llvm::UTF8 *>(program.content.data());
    auto *end = firstByte + program.content.size(), *cursor = firstByte;
    if (!check.require(llvm::isLegalUTF8String(&cursor,end), "source")) return false;
    uint32_t units = 0;
    // Validate and count without a UTF16 allocation; a non-BMP scalar needs two
    // units. Only the exact in-budget conversion storage is then reserved.
    for (unsigned char byte : llvm::StringRef(program.content).bytes()) if ((byte & 0xc0) != 0x80) {
      const unsigned count = byte >= 0xf0 ? 2 : 1;
      if (!check.require(units <= 65536 - count, "limit")) return false;
      units += count;
    }
    source.assign(units, 0); cursor = firstByte;
    auto *begin = reinterpret_cast<llvm::UTF16 *>(source.data()), *target = begin;
    if (!check.require(llvm::ConvertUTF8toUTF16(&cursor, end, &target, begin + source.size(), llvm::strictConversion) == llvm::conversionOK
        && size_t(target - begin) == units, "source")) return false;
    program.length = units;
    for (uint32_t at = 0; check.ok && at < source.size();) {
      char16_t c = source[at];
      if (space(c)) { ++at; continue; }
      if (c == '/' && at + 1 < source.size() && source[at + 1] == '/') {
        at += 2; while (at < source.size() && source[at] != 10 && source[at] != 13 && source[at] != 0x2028 && source[at] != 0x2029) ++at;
        continue;
      }
      if (c == '/' && at + 1 < source.size() && source[at + 1] == '*') {
        at += 2; while (at + 1 < source.size() && !(source[at] == '*' && source[at + 1] == '/')) ++at;
        if (!check.require(at + 1 < source.size(), "source")) return false;
        at += 2; continue;
      }
      if (!check.require(tokens.size() < 16384, "limit") || !check.step()) return false;
      uint32_t first = at; std::string text;
      if (initial(c)) { do { text += char(source[at++]); } while (at < source.size() && continued(source[at])); }
      else if (c < 128 && llvm::StringRef("{}():;,=").contains(char(c))) { text += char(c); ++at; }
      else return check.require(false, "source");
      tokens.push_back({std::move(text),first,at});
    }
    if (!expect("export") || !expect("function")) return false;
    size_t identifier = next; program.name = name(); program.nameRange = raw(identifier, identifier);
    symbol(program.name, "function", "i32", false, program.nameRange); expect("(");
    std::set<std::string> declared;
    while (check.ok && !is(")")) {
      if (!check.require(program.parameters.size() < 64, "limit")) return false;
      size_t first = next; auto spelling = name(); Range nameRange = raw(first, first); expect(":");
      size_t annotation = next; expect("i32");
      Json presence = Object{{"undefined",false},{"null",false},{"optional",false},{"default",false},
        {"range",raw(first,next - 1).json()},{"annotation",Range{token(annotation).start,token(annotation).end}.json()}};
      int index = symbol(spelling, "parameter", "i32", true, nameRange, std::move(presence));
      if (!check.require(index >= 0 && declared.insert(spelling).second, "scope")) return false;
      program.parameters.push_back(static_cast<unsigned>(index));
      if (!is(",")) break; ++next;
    }
    // Region nesting includes the function root as depth one.
    expect(")"); expect(":"); expect("i32"); block(program.root, 1, false);
    if (!check.ok) return false;
    program.range = raw(0,next - 1); program.root.range = program.range;
    if (!check.require(!program.parameters.empty() && next == tokens.size(), "source")) return false;
    std::map<std::string,int> visible;
    for (unsigned index : program.parameters) visible[program.symbols[index].name] = index;
    resolve(program.root, std::move(visible), std::move(declared), {}); return check.ok;
  }
};
Array rawBody(const SourceProgram &program, const SourceRegion &region);
Json reference(const SourceProgram &program, const SourceStatement &statement) {
  const auto &binding = program.symbols[statement.reference];
  return Object{{"kind","reference"},{"type",binding.type},{"symbol",binding.id},{"range",statement.expression.json()}};
}
Json rawBlock(const SourceProgram &program, const SourceRegion &region) {
  return Object{{"body",rawBody(program,region)},{"range",region.range.json()}};
}
Array rawBody(const SourceProgram &program, const SourceRegion &region) {
  Array body;
  for (const auto &statement : region.body) {
    Object item{{"range",statement.range.json()}};
    if (statement.kind == SourceStatement::Alias) {
      item["kind"] = "variable"; item["symbol"] = program.symbols[statement.declaration].json(); item["initializer"] = reference(program,statement);
    } else if (statement.kind == SourceStatement::Throw) { item["kind"] = "throw"; item["expression"] = reference(program,statement); }
    else if (statement.kind == SourceStatement::Block) {
      item["kind"] = "block"; if (!statement.region->body.empty()) item["body"] = rawBody(program,*statement.region);
    } else {
      item["kind"] = "try"; Object exception{{"tryBlock",rawBlock(program,*statement.region)}};
      if (statement.caught) {
        Object caught{{"range",statement.catchRange.json()},{"block",rawBlock(program,*statement.caught)}};
        if (statement.catchBinding >= 0) {
          caught["binding"] = program.symbols[statement.catchBinding].json(); caught["declarationRange"] = statement.declarationRange.json();
        }
        exception["catchClause"] = std::move(caught);
      }
      if (statement.finalized) exception["finallyBlock"] = rawBlock(program,*statement.finalized);
      item["exception"] = std::move(exception);
    }
    body.push_back(std::move(item));
  }
  return body;
}
} // namespace
bool readSource(llvm::StringRef content, llvm::StringRef path, SourceProgram &program, Check &check) {
  if (!check.require(!content.empty(), "source") || !check.require(content.size() <= 262144, "limit")) return false;
  program.content = content.str(); program.path = path.str(); return Reader(program,check).run();
}
Json SourceProgram::facts() const {
  Array parametersJson, initializers, symbolsJson;
  for (auto index : parameters) { parametersJson.push_back(symbols[index].json()); initializers.push_back(nullptr); }
  for (const auto &binding : symbols) symbolsJson.push_back(binding.json());
  Object fn{{"name",name},{"symbol","s1"},{"parameters",std::move(parametersJson)},
    {"returnType","i32"},{"body",rawBody(*this,root)},{"range",range.json()}};
  if (parameterInitializersPresent) fn["parameterInitializers"] = std::move(initializers);
  return Object{{"status","ok"},{"symbols",std::move(symbolsJson)},{"functions",Array{std::move(fn)}}};
}
Json SourceProgram::exports() const {
  return Array{Object{{"sourcePath",path},{"external",true},{"bindings",Array{Object{{"name",name},{"target","s1"},
    {"sourcePath",path},{"range",range.json()},{"definition",nameRange.json()}}}}}};
}
} // namespace tsfg::exception
