// SPDX-License-Identifier: MIT
#include "array-owner-json.h"
#include "llvm/ADT/APFloat.h"
#include "llvm/Support/Error.h"
#include <algorithm>

namespace tsfg::arrays::ownerproof {
namespace {
class Parser {
  llvm::StringRef raw;
  size_t at=0;
  JsonStatus status;
  bool fail(JsonError error=JsonError::Input) { if (status) status.error=error; return false; }
  bool charge(size_t &counter,size_t maximum) {
    if (counter == maximum) return fail(JsonError::Limit);
    ++counter; return true;
  }
  bool token() { return charge(status.counts.tokens,jsonTokenLimit); }
  void whitespace() { while (at<raw.size() && (raw[at]==' ' || raw[at]=='\t' || raw[at]=='\r' || raw[at]=='\n')) ++at; }
  bool take(char c) { if (at<raw.size() && raw[at]==c) { ++at; return true; } return false; }
  bool digit() const { return at<raw.size() && raw[at]>='0' && raw[at]<='9'; }
  bool append(std::string &text,llvm::StringRef bytes,size_t maximum) {
    if (bytes.size()>maximum-text.size()) return fail(JsonError::Limit);
    text.append(bytes.data(),bytes.size()); return true;
  }
  bool point(std::string &text,uint32_t value,size_t maximum) {
    char bytes[4]; size_t count=0;
    if (value<128) bytes[count++]=static_cast<char>(value);
    else if (value<2048) {
      bytes[count++]=char(0xc0|(value>>6)); bytes[count++]=char(0x80|(value&63));
    } else if (value<65536) {
      bytes[count++]=char(0xe0|(value>>12)); bytes[count++]=char(0x80|((value>>6)&63)); bytes[count++]=char(0x80|(value&63));
    } else {
      bytes[count++]=char(0xf0|(value>>18)); bytes[count++]=char(0x80|((value>>12)&63));
      bytes[count++]=char(0x80|((value>>6)&63)); bytes[count++]=char(0x80|(value&63));
    }
    return append(text,llvm::StringRef(bytes,count),maximum);
  }
  bool hexUnit(uint32_t &value) {
    value=0;
    for (unsigned i=0;i<4;++i) {
      if (at==raw.size()) return fail();
      const char c=raw[at++]; unsigned digit;
      if (c>='0' && c<='9') digit=c-'0';
      else if (c>='a' && c<='f') digit=c-'a'+10;
      else if (c>='A' && c<='F') digit=c-'A'+10;
      else return fail();
      value=(value<<4)|digit;
    }
    return true;
  }
  bool quoted(std::string &text,size_t maximum) {
    if (!take('"')) return fail();
    while (at<raw.size()) {
      const unsigned char c=raw[at];
      if (c=='"') { ++at; return true; }
      if (c<32) return fail();
      if (c!='\\') {
        const size_t begin=at; uint32_t value=0;
        if (!jsondetail::nextUtf8(raw,at,value)) return fail();
        if (!append(text,raw.slice(begin,at),maximum)) return false;
        continue;
      }
      ++at; if (at==raw.size()) return fail();
      const char escaped=raw[at++]; char byte=0;
      switch (escaped) {
      case '"': case '\\': case '/': byte=escaped; break;
      case 'b': byte='\b'; break; case 'f': byte='\f'; break;
      case 'n': byte='\n'; break; case 'r': byte='\r'; break; case 't': byte='\t'; break;
      case 'u': {
        uint32_t value=0;
        if (!hexUnit(value)) return false;
        if (value>=0xd800 && value<=0xdbff) {
          if (!take('\\') || !take('u')) return fail();
          uint32_t low=0;
          if (!hexUnit(low)) return false;
          if (low<0xdc00 || low>0xdfff) return fail();
          value=0x10000+((value-0xd800)<<10)+(low-0xdc00);
        } else if (value>=0xdc00 && value<=0xdfff) return fail();
        if (!point(text,value,maximum)) return false;
        continue;
      }
      default: return fail();
      }
      if (!append(text,llvm::StringRef(&byte,1),maximum)) return false;
    }
    return fail();
  }
  bool number(Json &out) {
    const size_t begin=at;
    take('-');
    if (!take('0')) {
      if (!digit() || raw[at]=='0') return fail();
      do { ++at; } while (digit());
    }
    if (take('.')) {
      if (!digit()) return fail();
      do { ++at; } while (digit());
    }
    if (take('e') || take('E')) {
      if (!take('+')) take('-');
      if (!digit()) return fail();
      do { ++at; } while (digit());
    }
    llvm::APFloat value(llvm::APFloat::IEEEdouble());
    auto converted=value.convertFromString(raw.slice(begin,at),llvm::APFloat::rmNearestTiesToEven);
    if (!converted) { llvm::consumeError(converted.takeError()); return fail(); }
    if (!value.isFinite()) return fail();
    // Even integer spellings are admitted as rounded binary64. Canonical text
    // comparison happens before any downstream full-slot/integer type checks.
    out=Json(value.convertToDouble()); return true;
  }
  bool literal(llvm::StringRef text,Json value,Json &out) {
    if (raw.substr(at,text.size())!=text) return fail();
    at+=text.size(); out=std::move(value); return true;
  }
  bool value(Json &out,unsigned depth,bool coreText=false) {
    whitespace();
    if (at==raw.size()) return fail();
    if (!token()) return false;
    if (raw[at]=='"') {
      std::string text;
      if (!quoted(text,coreText ? jsonByteLimit : jsonStringLimit)) return false;
      out=Json(std::move(text)); return true;
    }
    if (raw[at]=='n') return literal("null",Json(nullptr),out);
    if (raw[at]=='t') return literal("true",Json(true),out);
    if (raw[at]=='f') return literal("false",Json(false),out);
    if (raw[at]=='-' || digit()) return number(out);
    const char opening=raw[at];
    if (opening!='{' && opening!='[') return fail();
    if (depth>=jsonDepthLimit) return fail(JsonError::Limit);
    status.counts.depth=std::max(status.counts.depth,depth+1); ++at;
    whitespace();
    if (opening=='[') {
      llvm::json::Array array;
      if (take(']')) { if (!token()) return false; out=Json(std::move(array)); return true; }
      for (;;) {
        Json child(nullptr);
        if (!value(child,depth+1)) return false;
        // The complete child has passed all aggregate reservations before append.
        array.push_back(std::move(child)); whitespace();
        if (take(']')) { if (!token()) return false; out=Json(std::move(array)); return true; }
        if (!take(',')) return fail();
        whitespace();
      }
    }
    llvm::json::Object object;
    if (take('}')) { if (!token()) return false; out=Json(std::move(object)); return true; }
    for (;;) {
      if (at==raw.size() || raw[at]!='"') return fail();
      if (!charge(status.counts.members,jsonMemberLimit) || !token()) return false;
      std::string key;
      if (!quoted(key,jsonStringLimit)) return false;
      // Compare decoded keys before LLVM can overwrite an existing property.
      if (object.find(key)!=object.end()) return fail();
      whitespace(); if (!take(':')) return fail();
      Json child(nullptr);
      if (!value(child,depth+1,depth==0 && key=="coreText")) return false;
      object[std::move(key)]=std::move(child); whitespace();
      if (take('}')) { if (!token()) return false; out=Json(std::move(object)); return true; }
      if (!take(',')) return fail();
      whitespace();
    }
  }
public:
  explicit Parser(llvm::StringRef raw) : raw(raw) {}
  JsonStatus run(Json &out) {
    if (raw.size()>jsonByteLimit+1) { fail(JsonError::Limit); return status; }
    if (value(out,0)) { whitespace(); if (at!=raw.size()) fail(); }
    return status;
  }
};
} // namespace
JsonStatus parseCanonical(llvm::StringRef raw,Json &admitted) {
  Json candidate(nullptr);
  auto parsed=Parser(raw).run(candidate);
  if (!parsed) return parsed;
  std::string canonical;
  auto encoded=encodeCanonical(candidate,canonical,JsonMode::Envelope);
  if (!encoded) return encoded;
  if (canonical!=raw) { encoded.error=JsonError::Canonical; return encoded; }
  admitted=std::move(candidate); return encoded;
}
} // namespace tsfg::arrays::ownerproof
