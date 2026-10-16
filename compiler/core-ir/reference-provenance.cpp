// SPDX-License-Identifier: MIT
#include "reference-metadata.h"
#include "bytecode_encoding.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/Error.h"
#include "llvm/Support/ConvertUTF.h"
#include <algorithm>
#include <map>

namespace tsfg {
std::string referenceDigest(llvm::StringRef domain, llvm::ArrayRef<std::string> parts) {
  std::string input = domain.str();
  for (const auto &part : parts) { input += '\0'; input += part; }
  return "sha256:" + bytecode::hex(bytecode::hash(input));
}
namespace {
void quoted(llvm::StringRef input, std::string &output) {
  static const char digits[] = "0123456789abcdef";
  output += '"';
  for (unsigned char c : input.bytes()) {
    switch (c) {
    case '"': output += "\\\""; break;
    case '\\': output += "\\\\"; break;
    case '\b': output += "\\b"; break;
    case '\f': output += "\\f"; break;
    case '\n': output += "\\n"; break;
    case '\r': output += "\\r"; break;
    case '\t': output += "\\t"; break;
    default:
      if (c < 32) { output += "\\u00"; output += digits[c >> 4]; output += digits[c & 15]; }
      else output += static_cast<char>(c);
    }
  }
  output += '"';
}
// This bounded identity preimage accepts only integer JSON numbers. Keys use
// UTF-16 ordering; strings retain their canonical UTF-8 spelling.
std::u16string utf16(llvm::StringRef input) {
  const auto *source = reinterpret_cast<const llvm::UTF8 *>(input.data());
  const auto *end = source + input.size();
  std::u16string result(input.size(), 0);
  auto *target = reinterpret_cast<llvm::UTF16 *>(result.data()), *begin = target;
  if (llvm::ConvertUTF8toUTF16(&source, end, &target, target + result.size(), llvm::strictConversion) != llvm::conversionOK) return {};
  result.resize(target - begin); return result;
}
bool canonical(const llvm::json::Value &value, std::string &output) {
  if (auto string = value.getAsString()) { quoted(*string, output); return true; }
  if (auto boolean = value.getAsBoolean()) { output += *boolean ? "true" : "false"; return true; }
  if (auto integer = value.getAsInteger()) { output += std::to_string(*integer); return true; }
  if (auto array = value.getAsArray()) {
    output += '[';
    for (size_t i = 0; i < array->size(); ++i) {
      if (i) output += ',';
      if (!canonical((*array)[i], output)) return false;
    }
    output += ']'; return true;
  }
  if (auto object = value.getAsObject()) {
    std::map<std::u16string, std::pair<std::string, const llvm::json::Value *>> sorted;
    for (const auto &entry : *object) sorted.emplace(utf16(entry.first), std::make_pair(entry.first.str(), &entry.second));
    output += '{'; bool first = true;
    for (const auto &entry : sorted) {
      if (!first) output += ',';
      first = false; quoted(entry.second.first, output); output += ':';
      if (!canonical(*entry.second.second, output)) return false;
    }
    output += '}'; return true;
  }
  return false;
}
bool bounded(llvm::StringRef text) {
  if (text.empty() || text.size() > 8388608) return false;
  unsigned depth = 0, tokens = 0; bool string = false, escape = false; size_t stringBytes = 0;
  for (unsigned char c : text.bytes()) {
    if (string) {
      if (++stringBytes > 1048576) return false;
      if (escape) escape = false;
      else if (c == '\\') escape = true;
      else if (c == '"') string = false;
      continue;
    }
    if (c == '"') { string = true; stringBytes = 0; ++tokens; }
    else if (c == '{' || c == '[') { if (++depth > 128) return false; ++tokens; }
    else if (c == '}' || c == ']') { if (!depth) return false; --depth; ++tokens; }
    else if (c == ',' || c == ':') ++tokens;
    else if (c <= 32) return false;
    if (tokens > 200000) return false;
  }
  return !depth && !string;
}
bool exact(const llvm::json::Object &object, llvm::ArrayRef<llvm::StringRef> fields) {
  if (object.size() != fields.size()) return false;
  for (auto field : fields) if (!object.get(field)) return false;
  return true;
}
bool sameString(const llvm::json::Object &object, llvm::StringRef field, llvm::StringRef expected) {
  auto value = object.getString(field); return value && *value == expected;
}
bool trueField(const llvm::json::Object &object, llvm::StringRef field) {
  auto value = object.getBoolean(field); return value && *value;
}
bool falseOrAbsent(const llvm::json::Object &object, llvm::StringRef field) {
  if (!object.get(field)) return true;
  auto value = object.getBoolean(field); return value && !*value;
}
bool options(const llvm::json::Object &object) {
  if (!exact(object, {"effectiveStrict","module","officialOptions","officialOptionsSha256","target","useDefineForClassFields"})) return false;
  auto target = object.getInteger("target"), module = object.getInteger("module");
  auto define = object.getBoolean("useDefineForClassFields");
  auto strict = object.getObject("effectiveStrict");
  static const llvm::StringRef fields[] = {"noImplicitAny","noImplicitThis","strictBindCallApply","strictBuiltinIteratorReturn",
    "strictFunctionTypes","strictNullChecks","strictPropertyInitialization","useUnknownInCatchVariables"};
  if (!target || *target != 99 || !module || *module != 99 || !define || !strict || !exact(*strict, fields)) return false;
  for (auto field : fields) if (!trueField(*strict, field)) return false;
  auto raw = object.getString("officialOptions"), hash = object.getString("officialOptionsSha256");
  if (!raw || !hash || !bounded(*raw) || *hash != "sha256:" + bytecode::hex(bytecode::hash(*raw))) return false;
  auto parsed = llvm::json::parse(*raw);
  if (!parsed) { llvm::consumeError(parsed.takeError()); return false; }
  auto official = parsed->getAsObject(); std::string printed;
  if (!official || !canonical(*parsed, printed) || printed != *raw
      || !trueField(*official, "strict") || !trueField(*official, "noEmit") || !trueField(*official, "noLib")
      || official->getInteger("target") != target || official->getInteger("module") != module) return false;
  for (auto field : {"noCheck","allowJs","skipLibCheck","skipDefaultLibCheck"}) if (!falseOrAbsent(*official, field)) return false;
  for (auto field : fields) if (official->get(field) && !trueField(*official, field)) return false;
  return true;
}
} // namespace
std::string referenceAllocationKey(llvm::StringRef environment, llvm::StringRef source, uint32_t start, uint32_t end) {
  std::string preimage = "{\"declaration\":{\"end\":" + std::to_string(end) + ",\"source\":";
  quoted(source, preimage); preimage += ",\"start\":" + std::to_string(start) + "},\"environmentDigest\":";
  quoted(environment, preimage); preimage += '}';
  return referenceDigest("tsfg.candidate.class-allocation-provenance.v2", {preimage});
}
bool verifyReferenceEnvironment(llvm::StringRef preimage, llvm::StringRef scope,
    llvm::StringRef profile, llvm::StringRef environment, llvm::ArrayRef<ReferenceSource> sources) {
  if (!bounded(preimage)) return false;
  auto parsed = llvm::json::parse(preimage);
  if (!parsed) { llvm::consumeError(parsed.takeError()); return false; }
  auto object = parsed->getAsObject(); std::string printed;
  if (!object || !exact(*object, {"profile","scope","sources","options"}) || !canonical(*parsed, printed) || printed != preimage
      || !sameString(*object, "profile", profile) || !sameString(*object, "scope", scope)
      || environment != referenceDigest("tsfg.candidate.class-environment.v2", {preimage.str()})) return false;
  auto sourceArray = object->getArray("sources");
  auto configuration = object->getObject("options");
  if (!sourceArray || sourceArray->size() != sources.size() || !configuration || !options(*configuration)) return false;
  for (size_t i = 0; i < sources.size(); ++i) {
    const auto &source = sources[i]; auto entry = (*sourceArray)[i].getAsObject();
    if (!entry || !exact(*entry, {"declaration","path","sha256","surrogateStarts","utf16Length"})
        || !sameString(*entry, "path", source.path) || !sameString(*entry, "sha256", source.hash)
        || entry->getInteger("utf16Length") != source.length || entry->getBoolean("declaration") != source.declaration) return false;
    auto surrogates = entry->getArray("surrogateStarts");
    if (!surrogates || surrogates->size() != source.surrogates.size()) return false;
    for (size_t j = 0; j < surrogates->size(); ++j) if ((*surrogates)[j].getAsInteger() != source.surrogates[j]) return false;
  }
  return true;
}
} // namespace tsfg
