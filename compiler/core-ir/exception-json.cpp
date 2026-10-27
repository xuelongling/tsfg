// SPDX-License-Identifier: MIT
#include "exception-json.h"
#include "bytecode_encoding.h"
#include "llvm/Support/ConvertUTF.h"
#include "llvm/Support/Error.h"
#include <algorithm>
#include <set>
#include <vector>

namespace tsfg::exception {
bool Check::require(bool condition, llvm::StringRef code) {
  if (ok && !condition) { ok = false; category = code.str(); }
  return ok;
}
bool Check::step(uint32_t count) {
  if (!require(count <= 100000 - work, "limit")) return false;
  work += count; return true;
}
std::string digest(llvm::StringRef bytes) { return "sha256:" + bytecode::hex(bytecode::hash(bytes)); }
namespace {
bool utf16(llvm::StringRef text, std::u16string &out) {
  out.assign(text.size(), 0);
  auto *source = reinterpret_cast<const llvm::UTF8 *>(text.data());
  auto *end = source + text.size();
  auto *begin = reinterpret_cast<llvm::UTF16 *>(out.data()), *target = begin;
  if (llvm::ConvertUTF8toUTF16(&source, end, &target, begin + out.size(), llvm::strictConversion) != llvm::conversionOK) return false;
  out.resize(target - begin); return true;
}
void quote(llvm::StringRef text, std::string &out) {
  constexpr char hex[] = "0123456789abcdef";
  out += '"';
  for (unsigned char byte : text.bytes()) {
    switch (byte) {
    case '"': out += "\\\""; break;
    case '\\': out += "\\\\"; break;
    case '\b': out += "\\b"; break;
    case '\f': out += "\\f"; break;
    case '\n': out += "\\n"; break;
    case '\r': out += "\\r"; break;
    case '\t': out += "\\t"; break;
    default:
      if (byte < 32) { out += "\\u00"; out += hex[byte >> 4]; out += hex[byte & 15]; }
      else out += static_cast<char>(byte);
    }
  }
  out += '"';
}
void print(const Json &value, std::string &out) {
  if (value.getAsNull()) { out += "null"; return; }
  if (auto boolean = value.getAsBoolean()) { out += *boolean ? "true" : "false"; return; }
  if (auto number = value.getAsInteger()) { out += std::to_string(*number); return; }
  if (auto text = value.getAsString()) { quote(*text, out); return; }
  if (auto array = value.getAsArray()) {
    out += '[';
    for (size_t i = 0; i < array->size(); ++i) { if (i) out += ','; print((*array)[i], out); }
    out += ']'; return;
  }
  auto *object = value.getAsObject();
  if (!object) return;
  struct Key { std::u16string order; std::string key; const Json *value; };
  std::vector<Key> keys;
  for (const auto &entry : *object) {
    std::u16string order; utf16(entry.first, order);
    keys.push_back({std::move(order), entry.first.str(), &entry.second});
  }
  std::sort(keys.begin(), keys.end(), [](const Key &a, const Key &b) { return a.order < b.order; });
  out += '{'; bool first = true;
  for (const auto &key : keys) {
    if (!first) out += ',';
    first = false; quote(key.key, out); out += ':'; print(*key.value, out);
  }
  out += '}';
}
// This preflight never allocates a JSON object. Only bounded decoded key/string
// buffers and key sets exist before LLVM's parser sees the accepted byte span.
class Scan {
  llvm::StringRef text;
  Check &check;
  size_t at = 0;
  int hex(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  }
  uint32_t unit() {
    if (!check.require(text.size() - at >= 4)) return 0;
    uint32_t value = 0;
    for (unsigned n = 0; n < 4; ++n) {
      int digit = hex(text[at++]); if (!check.require(digit >= 0)) return 0;
      value = (value << 4) | static_cast<uint32_t>(digit);
    }
    return value;
  }
  void append(uint32_t point, std::string &value) {
    if (point < 128) value += static_cast<char>(point);
    else if (point < 2048) { value += char(0xc0 | point >> 6); value += char(0x80 | (point & 63)); }
    else if (point < 65536) {
      value += char(0xe0 | point >> 12); value += char(0x80 | ((point >> 6) & 63)); value += char(0x80 | (point & 63));
    } else {
      value += char(0xf0 | point >> 18); value += char(0x80 | ((point >> 12) & 63));
      value += char(0x80 | ((point >> 6) & 63)); value += char(0x80 | (point & 63));
    }
  }
  bool quoted(std::string &value) {
    if (!check.require(at < text.size() && text[at++] == '"')) return false;
    while (check.ok && at < text.size()) {
      unsigned char c = text[at++];
      if (c == '"') { std::u16string decoded; return check.require(utf16(value, decoded)); }
      if (!check.require(c >= 32 && value.size() < 1048576, "limit")) return false;
      if (c != '\\') { value += static_cast<char>(c); continue; }
      if (!check.require(at < text.size())) return false;
      char escape = text[at++];
      switch (escape) {
      case '"': case '\\': case '/': value += escape; break;
      case 'b': value += '\b'; break; case 'f': value += '\f'; break;
      case 'n': value += '\n'; break; case 'r': value += '\r'; break; case 't': value += '\t'; break;
      case 'u': {
        uint32_t point = unit();
        if (point >= 0xd800 && point <= 0xdbff) {
          if (!check.require(text.size() - at >= 6 && text.substr(at, 2) == "\\u")) return false;
          at += 2; uint32_t low = unit();
          if (!check.require(low >= 0xdc00 && low <= 0xdfff)) return false;
          point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00;
        } else if (!check.require(point < 0xdc00 || point > 0xdfff)) return false;
        if (!check.require(value.size() <= 1048572, "limit")) return false;
        append(point, value); break;
      }
      default: return check.require(false);
      }
    }
    return check.require(false);
  }
  bool take(char c) { if (at < text.size() && text[at] == c) { ++at; return true; } return false; }
  bool value(unsigned depth) {
    if (!check.step() || !check.require(depth <= 128 && at < text.size(), "limit")) return false;
    if (text[at] == '"') { std::string scratch; return quoted(scratch); }
    if (take('{')) {
      std::set<std::string> keys;
      if (take('}')) return check.step();
      do {
        std::string key;
        if (!check.step() || !quoted(key) || !check.require(key != "__proto__" && key != "constructor" && key != "prototype")
            || !check.require(keys.size() < 100000, "limit") || !check.require(keys.insert(key).second)
            || !check.require(take(':')) || !value(depth + 1)) return false;
      } while (take(','));
      return check.require(take('}')) && check.step();
    }
    if (take('[')) {
      if (take(']')) return check.step();
      do { if (!value(depth + 1)) return false; } while (take(','));
      return check.require(take(']')) && check.step();
    }
    for (auto literal : {llvm::StringRef("null"), llvm::StringRef("false"), llvm::StringRef("true")})
      if (text.substr(at).starts_with(literal)) { at += literal.size(); return true; }
    const size_t begin = at;
    uint64_t number = 0;
    while (at < text.size() && text[at] >= '0' && text[at] <= '9') {
      unsigned digit = text[at++] - '0';
      if (!check.require(number <= (9007199254740991ULL - digit) / 10)) return false;
      number = number * 10 + digit;
    }
    return check.require(at > begin && (at - begin == 1 || text[begin] != '0'));
  }
public:
  Scan(llvm::StringRef text, Check &check) : text(text), check(check) {}
  bool run() { return value(1) && check.require(at == text.size()); }
};
} // namespace
std::string canonical(const Json &value) { std::string result; print(value, result); return result; }
bool readCanonical(llvm::StringRef bytes, Json &value, Check &check, bool finalLF) {
  if (!check.require(!bytes.empty() && bytes.size() <= 1048576, "limit")) return false;
  if (finalLF) { if (!check.require(bytes.back() == '\n')) return false; bytes = bytes.drop_back(); }
  if (!Scan(bytes, check).run()) return false;
  auto parsed = llvm::json::parse(bytes);
  if (!parsed) { llvm::consumeError(parsed.takeError()); return check.require(false); }
  if (!check.require(canonical(*parsed) == bytes, "schema")) return false;
  value = std::move(*parsed); return true;
}
bool exact(const Json &value, llvm::ArrayRef<llvm::StringRef> required, llvm::ArrayRef<llvm::StringRef> optional) {
  auto object = value.getAsObject(); if (!object) return false;
  for (auto key : required) if (!object->get(key)) return false;
  for (const auto &entry : *object)
    if (std::find(required.begin(), required.end(), llvm::StringRef(entry.first)) == required.end()
        && std::find(optional.begin(), optional.end(), llvm::StringRef(entry.first)) == optional.end()) return false;
  return true;
}
const Json &field(const Json &value, llvm::StringRef key) {
  static const Json missing = nullptr;
  auto object = value.getAsObject(); auto item = object ? object->get(key) : nullptr;
  return item ? *item : missing;
}
const Array &items(const Json &value) { static const Array empty; auto result = value.getAsArray(); return result ? *result : empty; }
std::string string(const Json &value) { auto result = value.getAsString(); return result ? result->str() : std::string(); }
bool equal(const Json &a, const Json &b) { return canonical(a) == canonical(b); }
std::string identity(llvm::StringRef domain, llvm::StringRef schemaHash, const Json &record) {
  std::string text = domain.str(); text += '\0'; text += schemaHash; text += '\0'; text += canonical(record); return digest(text);
}
Json format(llvm::StringRef family, llvm::StringRef hash) { return Object{{"family",family},{"version",1},{"schemaHash",hash}}; }
} // namespace tsfg::exception
