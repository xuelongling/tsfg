// SPDX-License-Identifier: MIT
#include "array-owner-json-policy.h"
#include <algorithm>
#include <charconv>
#include <cmath>
#include <system_error>
#include <vector>

namespace tsfg::arrays::ownerproof {
namespace jsondetail {
bool nextUtf8(llvm::StringRef text, size_t &at, uint32_t &point) {
  if (at >= text.size()) return false;
  const auto first = static_cast<unsigned char>(text[at++]);
  if (first < 128) { point = first; return true; }
  unsigned count; uint32_t minimum;
  if (first >= 0xc2 && first <= 0xdf) { count=1; point=first&31; minimum=0x80; }
  else if (first >= 0xe0 && first <= 0xef) { count=2; point=first&15; minimum=0x800; }
  else if (first >= 0xf0 && first <= 0xf4) { count=3; point=first&7; minimum=0x10000; }
  else return false;
  if (count > text.size()-at) return false;
  while (count--) {
    const auto byte = static_cast<unsigned char>(text[at++]);
    if ((byte&0xc0) != 0x80) return false;
    point=(point<<6)|(byte&63);
  }
  return point >= minimum && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff);
}
bool numberText(double value, std::string &text) {
  if (!std::isfinite(value)) return false;
  if (value == 0) { text="0"; return true; }
  // C++ shortest/nearest scientific digits, then RFC8785/ECMAScript layout.
  // No locale, precision=17 fallback, or LLVM default JSON printer is involved.
  char buffer[64];
  const auto result=std::to_chars(buffer,buffer+sizeof(buffer),value,std::chars_format::scientific);
  if (result.ec != std::errc()) return false;
  const char *cursor=buffer, *end=result.ptr;
  std::string output, digits;
  if (*cursor == '-') { output+='-'; ++cursor; }
  while (cursor != end && *cursor != 'e') {
    if (*cursor != '.') {
      if (*cursor < '0' || *cursor > '9') return false;
      digits+=*cursor;
    }
    ++cursor;
  }
  if (digits.empty() || cursor == end) return false;
  ++cursor; bool negative=false;
  if (cursor != end && (*cursor == '+' || *cursor == '-')) { negative=*cursor=='-'; ++cursor; }
  if (cursor == end) return false;
  int exponent=0;
  while (cursor != end) {
    if (*cursor < '0' || *cursor > '9' || exponent > 1000) return false;
    exponent=exponent*10+(*cursor++-'0');
  }
  if (negative) exponent=-exponent;
  const int k=exponent+1, n=static_cast<int>(digits.size());
  if (k > 0 && k <= 21) {
    if (k >= n) { output+=digits; output.append(k-n,'0'); }
    else { output+=digits.substr(0,k); output+='.'; output+=digits.substr(k); }
  } else if (k <= 0 && k > -6) {
    output+="0."; output.append(-k,'0'); output+=digits;
  } else {
    output+=digits.front();
    if (n > 1) { output+='.'; output+=digits.substr(1); }
    output+='e'; if (exponent >= 0) output+='+';
    output+=std::to_string(exponent);
  }
  text=std::move(output); return true;
}
} // namespace jsondetail
namespace {
// Compare decoded property names by unsigned UTF16 code units without allocating
// a second copy of potentially large keys. Owner-set UTF8 order is unrelated.
struct Units {
  llvm::StringRef text; size_t at=0; uint16_t pending=0;
  bool next(uint16_t &unit) {
    if (pending) { unit=pending; pending=0; return true; }
    if (at == text.size()) return false;
    uint32_t point=0;
    if (!jsondetail::nextUtf8(text,at,point)) return false;
    if (point <= 0xffff) unit=static_cast<uint16_t>(point);
    else {
      point-=0x10000; unit=static_cast<uint16_t>(0xd800+(point>>10));
      pending=static_cast<uint16_t>(0xdc00+(point&1023));
    }
    return true;
  }
};
bool keyLess(llvm::StringRef left, llvm::StringRef right) {
  Units a{left},b{right}; uint16_t x=0,y=0;
  for (;;) {
    const bool hasA=a.next(x),hasB=b.next(y);
    if (!hasA || !hasB) return !hasA && hasB;
    if (x != y) return x < y;
  }
}
class Canonical {
  JsonMode mode;
  const JsonPolicy &policy;
  std::string *output;
  JsonStatus status;
  bool fail(JsonError error) { if (status) status.error=error; return false; }
  bool charge(size_t &counter, size_t amount, size_t maximum) {
    if (amount > maximum-counter) return fail(JsonError::Limit);
    counter+=amount; return true;
  }
  bool emit(llvm::StringRef text) {
    if (!charge(status.counts.bytes,text.size(),policy.bytes)) return false;
    if (output) output->append(text.data(),text.size());
    return true;
  }
  bool quote(llvm::StringRef text, size_t maximum) {
    if (text.size() > maximum) return fail(JsonError::Limit);
    if (!emit("\"")) return false;
    constexpr char hex[]="0123456789abcdef";
    size_t at=0;
    while (at < text.size()) {
      const size_t begin=at; uint32_t point=0;
      if (!jsondetail::nextUtf8(text,at,point)) return fail(JsonError::Input);
      llvm::StringRef escaped;
      switch (point) {
      case '"': escaped="\\\""; break; case '\\': escaped="\\\\"; break;
      case '\b': escaped="\\b"; break; case '\f': escaped="\\f"; break;
      case '\n': escaped="\\n"; break; case '\r': escaped="\\r"; break;
      case '\t': escaped="\\t"; break;
      default: break;
      }
      if (!escaped.empty()) { if (!emit(escaped)) return false; }
      else if (point < 32) {
        char control[]={'\\','u','0','0',hex[point>>4],hex[point&15]};
        if (!emit(llvm::StringRef(control,6))) return false;
      } else if (!emit(text.slice(begin,at))) return false;
    }
    return emit("\"");
  }
  bool token(size_t amount=1) { return charge(status.counts.tokens,amount,policy.tokens); }
  bool walk(const Json &value, unsigned depth, bool coreText=false) {
    if (!token()) return false;
    if (value.getAsNull()) return emit("null");
    if (auto boolean=value.getAsBoolean()) return emit(*boolean ? "true" : "false");
    if (auto number=value.getAsNumber()) {
      std::string text;
      return jsondetail::numberText(*number,text) ? emit(text) : fail(JsonError::Input);
    }
    if (auto text=value.getAsString()) return quote(*text,coreText ? policy.bytes : policy.stringBytes);
    if (depth >= policy.depth) return fail(JsonError::Limit);
    status.counts.depth=std::max(status.counts.depth,depth+1);
    if (auto array=value.getAsArray()) {
      if (!emit("[")) return false;
      for (size_t i=0;i<array->size();++i) {
        if ((i && !emit(",")) || !walk((*array)[i],depth+1)) return false;
      }
      return token() && emit("]");
    }
    const auto *object=value.getAsObject();
    if (!object) return fail(JsonError::Input);
    if (!emit("{")) return false;
    struct Property { llvm::StringRef key; const Json *value; };
    std::vector<Property> ordered;
    // The measuring pass needs no sorted storage. Encoding follows a successful
    // full measurement, so both the member count and all key bytes are bounded.
    if (output) {
      ordered.reserve(object->size());
      for (const auto &entry : *object) ordered.push_back({entry.first,&entry.second});
      std::sort(ordered.begin(),ordered.end(),[](const Property &a,const Property &b){return keyLess(a.key,b.key);});
    }
    size_t index=0;
    const auto property=[&](llvm::StringRef key,const Json &child) {
      if (!charge(status.counts.members,1,policy.members) || !token()) return false;
      if (index++ && !emit(",")) return false;
      return quote(key,policy.stringBytes) && emit(":") &&
        walk(child,depth+1,mode==JsonMode::Envelope && depth==0 && key=="coreText");
    };
    if (output) { for (const auto &entry : ordered) if (!property(entry.key,*entry.value)) return false; }
    else { for (const auto &entry : *object) if (!property(entry.first,entry.second)) return false; }
    return token() && emit("}");
  }
public:
  Canonical(JsonMode mode,const JsonPolicy &policy,std::string *output=nullptr) : mode(mode),policy(policy),output(output) {}
  JsonStatus run(const Json &value) { walk(value,0); return status; }
};
bool equalCounts(const JsonCounts &a,const JsonCounts &b) {
  return a.bytes==b.bytes && a.tokens==b.tokens && a.members==b.members && a.depth==b.depth;
}
} // namespace
JsonStatus measureCanonical(const Json &value,JsonMode mode) { return Canonical(mode,JsonPolicy{}).run(value); }
JsonStatus encodeCanonical(const Json &value,std::string &output,JsonMode mode) {
  return encodeCanonical(value,output,JsonPolicy{},mode);
}
JsonStatus encodeCanonical(const Json &value,std::string &output,const JsonPolicy &policy,JsonMode mode) {
  const auto measured=Canonical(mode,policy).run(value);
  if (!measured) return measured;
  std::string encoded; encoded.reserve(measured.counts.bytes+1);
  auto written=Canonical(mode,policy,&encoded).run(value);
  if (!written) return written;
  if (!equalCounts(measured.counts,written.counts)) { written.error=JsonError::Input; return written; }
  encoded+='\n'; output=std::move(encoded); return written;
}
} // namespace tsfg::arrays::ownerproof
