// SPDX-License-Identifier: MIT
#include "exception-source.h"
#include <algorithm>

namespace tsfg::exception {
namespace {
bool hash(llvm::StringRef text) {
  if (!text.consume_front("sha256:") || text.size() != 64) return false;
  for (char c : text) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) return false;
  return true;
}
bool oid(llvm::StringRef text) {
  if (text.size() != 40) return false;
  for (char c : text) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) return false;
  return true;
}
bool path(llvm::StringRef text) {
  if (text.size() > 4096 || !text.starts_with("/") || text.ends_with("/") || text.contains('\\') || text.contains('\0')) return false;
  text = text.drop_front();
  while (true) {
    auto pair = text.split('/');
    if (pair.first.empty() || pair.first == "." || pair.first == "..") return false;
    if (pair.second.empty()) return true;
    text = pair.second;
  }
}
Json target() {
  return Object{{"target","windows-x86_64-msvc"},{"triple","x86_64-pc-windows-msvc"},{"pointerBits","64"},
    {"llvmDataLayout","e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"}};
}
bool origin(const Json &value, Check &check) {
  if (!check.require(exact(value,{"kind","producerBaseOid","producerDirty","requestSha256","responseSha256","testedInputSetHash"}),"identity")) return false;
  return check.require(string(field(value,"kind")) == "owned-go-exception-response"
    && oid(string(field(value,"producerBaseOid"))) && field(value,"producerDirty").getAsBoolean().has_value()
    && hash(string(field(value,"requestSha256"))) && hash(string(field(value,"responseSha256")))
    && hash(string(field(value,"testedInputSetHash"))),"identity");
}
} // namespace
bool verifyProvenance(llvm::StringRef hirJcs, Provenance &result, Check &check) {
  Json hir = nullptr;
  if (!readCanonical(hirJcs,hir,check,true)) return false;
  if (!check.require(exact(hir,{"format","snapshot","inputIdentity","sources","target","types","functions","modules","exports"})
      && equal(field(hir,"format"),tsfg::exception::format("tsfg.exception-hir-candidate",hirSchema)))) return false;
  const auto &snapshot = field(hir,"snapshot");
  if (!check.require(exact(snapshot,{"format","snapshotId","sourceOrigin","inputIdentity","identityInput","sources","target","facts","exports","capture"})
      && equal(field(snapshot,"format"),tsfg::exception::format("tsfg.frontend-exception-candidate",snapshotSchema)))) return false;
  const auto &capture = field(snapshot,"capture"), &custody = field(snapshot,"sourceOrigin");
  if (!check.require(exact(capture,{"request","response"})) || !origin(custody,check)) return false;
  auto requestText = string(field(capture,"request")), responseText = string(field(capture,"response"));
  if (!check.require(digest(requestText) == string(field(custody,"requestSha256"))
      && digest(responseText) == string(field(custody,"responseSha256")),"identity")) return false;
  Json request = nullptr, response = nullptr;
  if (!readCanonical(requestText,request,check) || !readCanonical(responseText,response,check)) return false;
  if (!check.require(exact(request,{"family","version","schemaHash","input"})
      && string(field(request,"family")) == "tsfg.exception-facts-request-candidate"
      && field(request,"version").getAsInteger() == 1 && string(field(request,"schemaHash")) == snapshotSchema)) return false;
  if (!check.require(exact(response,{"family","version","schemaHash","requestId","packageId","payload"})
      && string(field(response,"family")) == "tsfg.exception-facts-package-candidate"
      && field(response,"version").getAsInteger() == 1 && string(field(response,"schemaHash")) == snapshotSchema)) return false;
  const auto &input = field(request,"input");
  if (!check.require(exact(input,{"sourceRoot","rootFile","files","declarations","config","target"}))) return false;
  const std::string root = string(field(input,"sourceRoot")), file = string(field(input,"rootFile"));
  const std::string primary = root + "/minimal-integers-v3.d.ts";
  if (!check.require(path(root) && path(file) && llvm::StringRef(file).starts_with(root + "/")
      && llvm::StringRef(file).ends_with(".ts") && !llvm::StringRef(file).ends_with(".d.ts"),"source")) return false;
  const Json expectedConfig = Object{{"strict",true},{"noEmit",true},{"allowJs",false}};
  const Json declarations = Object{{"version","minimal-integers-v3"},{"paths",Array{primary}}};
  if (!check.require(equal(field(input,"config"),expectedConfig) && equal(field(input,"declarations"),declarations)
      && equal(field(input,"target"),target()),"identity")) return false;
  const auto &supplied = items(field(input,"files"));
  if (!check.require(supplied.size() == 2,"source")) return false;
  struct File { std::string path, content; };
  std::vector<File> files;
  for (const auto &entry : supplied) {
    if (!check.step() || !check.require(exact(entry,{"path","content"},{"sha256"}))) return false;
    File item{string(field(entry,"path")),string(field(entry,"content"))};
    if (!check.require(path(item.path) && (item.path == file || item.path == primary)
        && field(entry,"content").getAsString().has_value(),"source")) return false;
    if (entry.getAsObject()->get("sha256") && !check.require(string(field(entry,"sha256")) == digest(item.content),"identity")) return false;
    files.push_back(std::move(item));
  }
  std::sort(files.begin(),files.end(),[](const File &a,const File &b) { return a.path < b.path; });
  if (!check.require(files[0].path != files[1].path,"source")) return false;
  Array normalizedFiles, manifest, inputs;
  std::string content;
  for (const auto &entry : files) {
    if (!check.step()) return false;
    normalizedFiles.push_back(Object{{"path",entry.path},{"content",entry.content}}); inputs.push_back(entry.path);
    uint32_t length = 1214;
    if (entry.path == primary) {
      if (!check.require(entry.content.size() == 1214 && digest(entry.content) == "sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e","identity")) return false;
    } else {
      content = entry.content;
      if (!readSource(entry.content,file,result.source,check)) return false;
      length = result.source.length;
    }
    manifest.push_back(Object{{"path",entry.path},{"digest",digest(entry.content)},
      {"byteLength",int64_t(entry.content.size())},{"length",int64_t(length)},{"positionUnit","utf16"}});
  }
  Object normalized = *input.getAsObject(); normalized["files"] = std::move(normalizedFiles);
  Json identityInput = std::move(normalized);
  result.inputIdentity = digest(canonical(identityInput)); result.sourceHash = digest(content);
  const auto &actualPayload = field(response,"payload");
  const auto &rawFunctions = field(field(actualPayload,"facts"),"functions");
  if (!check.require(rawFunctions.getAsArray() && items(rawFunctions).size() == 1,"source")) return false;
  auto *rawFunction = items(rawFunctions)[0].getAsObject();
  if (!check.require(bool(rawFunction),"source")) return false;
  const auto *initializers = rawFunction->get("parameterInitializers");
  // Source still requires plain required parameters: only metadata absence or
  // an aligned all-null array is retained, never a default expression or null DTO.
  result.source.parameterInitializersPresent = initializers != nullptr;
  if (initializers) {
    if (!check.require(initializers->getAsArray() && items(*initializers).size() == result.source.parameters.size(),"source")) return false;
    for (const auto &value : items(*initializers)) if (!check.require(bool(value.getAsNull()),"source")) return false;
  }
  Json facts = result.source.facts(); (*facts.getAsObject())["inputs"] = std::move(inputs);
  Json exports = result.source.exports();
  Json payload = Object{{"inputIdentity",result.inputIdentity},{"files",std::move(manifest)},{"facts",facts},{"exports",exports}};
  if (!check.require(equal(actualPayload,payload),"source")) return false;
  std::string requestPreimage = "tsfg.exception-facts.request.v1"; requestPreimage += '\0'; requestPreimage += requestText;
  std::string packagePreimage = "tsfg.exception-facts.package.v1"; packagePreimage += '\0'; packagePreimage += snapshotSchema;
  packagePreimage += '\0'; packagePreimage += canonical(payload);
  if (!check.require(string(field(response,"requestId")) == digest(requestPreimage)
      && string(field(response,"packageId")) == digest(packagePreimage),"identity")) return false;
  std::string snapshotPreimage = "tsfg.frontend-exception-candidate.snapshot.v1"; snapshotPreimage += '\0'; snapshotPreimage += snapshotSchema;
  snapshotPreimage += '\0'; snapshotPreimage += canonical(Object{{"inputIdentity",result.inputIdentity},{"sourceOrigin",custody}});
  Json sources = Array{Object{{"path",file},{"content",content},{"hash",result.sourceHash},
    {"length",int64_t(result.source.length)},{"positionUnit","utf16"}}};
  Json rebuiltSnapshot = Object{{"format",tsfg::exception::format("tsfg.frontend-exception-candidate",snapshotSchema)},
    {"snapshotId",digest(snapshotPreimage)},{"sourceOrigin",custody},{"inputIdentity",result.inputIdentity},
    {"identityInput",identityInput},{"sources",sources},{"target",target()},{"facts",facts},{"exports",exports},
    {"capture",Object{{"request",requestText},{"response",responseText}}}};
  if (!check.require(equal(snapshot,rebuiltSnapshot),"identity")) return false;
  Json rebuilt = reconstructHir(result.source,rebuiltSnapshot,check);
  if (!check.ok || !check.require(equal(hir,rebuilt),"identity")) return false;
  result.hir = std::move(rebuilt); result.hirJcs = hirJcs.str(); return true;
}
} // namespace tsfg::exception
