// SPDX-License-Identifier: MIT
// Compiler metadata only: no Source program, VM, native code or device execution.
#include "common-program-source.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/IR/Diagnostics.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/Error.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/raw_ostream.h"
#include <array>
#include <fstream>
#include <set>
#include <string>
#include <utility>

namespace {
using namespace tsfg::commonProgram;

// Both explicit inputs are read in fixed chunks, with the limit checked before
// appending. No discovery, process invocation, input mutation or output files.
bool readFile(llvm::StringRef path, size_t limit, std::string &bytes, std::string &failure) {
  if (!llvm::sys::path::is_absolute(path)) {
    failure = "an explicit absolute input path is required";
    return false;
  }
  std::ifstream input(path.str(), std::ios::binary);
  if (!input) {
    failure = "the explicit input could not be opened";
    return false;
  }
  std::array<char, 8192> chunk;
  while (input) {
    input.read(chunk.data(), static_cast<std::streamsize>(chunk.size()));
    const auto count = static_cast<size_t>(input.gcount());
    if (count > limit - bytes.size()) {
      failure = "the explicit input exceeds its byte bound";
      return false;
    }
    bytes.append(chunk.data(), count);
  }
  if (!input.eof() || bytes.empty()) {
    failure = "the explicit input is empty or could not be read completely";
    return false;
  }
  return true;
}
} // namespace

int main(int argc, char **argv) {
  using namespace tsfg::commonProgram;
  Program program;
  Error error;
  std::string parseDiagnostic;
  Object report{{"family", "tsfg.string-concat-return-origin-driver"}, {"version", 1},
      {"coreRead", false}, {"officialOracleBound", false}, {"wholeProgramVerified", false},
      {"concat", nullptr}, {"kernels", Array{}}, {"authority", false},
      {"execution", Object{{"source", false}, {"vm", false}, {"native", false}, {"device", false}}}};
  const auto finish = [&](int status, llvm::StringRef stage, llvm::StringRef reason) {
    report["passed"] = status == 0;
    report["stage"] = stage.str();
    report["reason"] = reason.str();
    report["remaining"] = int64_t(program.remaining);
    report["firstError"] = error.message.empty() ? Json(nullptr) : Json(Object{
        {"code", error.code}, {"message", error.message}, {"path", error.path},
        {"range", Object{{"start", int64_t(error.range.start)}, {"end", int64_t(error.range.end)}}}});
    report["firstParseDiagnostic"] = parseDiagnostic.empty() ? Json(nullptr) : Json(parseDiagnostic);
    llvm::outs() << canonical(Json(std::move(report))) << '\n';
    llvm::outs().flush();
    return status;
  };
  if (argc != 3) return finish(2, "arguments", "expected <absolute Core file> <absolute official-oracle file>");
  std::string coreBytes, oracleBytes, failure;
  if (!readFile(argv[1], 8 * 1024 * 1024, coreBytes, failure)) return finish(2, "read-core-file", failure);
  if (!readFile(argv[2], 1024 * 1024, oracleBytes, failure)) return finish(2, "read-oracle-file", failure);
  report["coreDigest"] = digest(coreBytes);
  report["officialOracleDigest"] = digest(oracleBytes);

  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry);
  registerDialect(registry);
  registry.insert<mlir::func::FuncDialect, mlir::cf::ControlFlowDialect>();
  mlir::MLIRContext context(registry);
  context.disableMultithreading();
  mlir::ScopedDiagnosticHandler diagnostics(&context, [&](mlir::Diagnostic &diagnostic) {
    if (diagnostic.getSeverity() == mlir::DiagnosticSeverity::Error && parseDiagnostic.empty()) {
      llvm::raw_string_ostream out(parseDiagnostic);
      diagnostic.print(out);
    }
    return mlir::success();
  });
  auto module = mlir::parseSourceString<mlir::ModuleOp>(coreBytes, &context);
  if (!module) return finish(3, "parse-core", "the actual complete Core did not parse or verify");
  if (!readCore(*module, program, error)) return finish(3, "readCore", "the actual Core reader returned false");
  report["coreRead"] = true;
  if (oracleBytes.back() != '\n') return finish(3, "read-oracle", "the official oracle must retain its final LF");
  // The independent Go audit oracle uses ordinary json.Marshal field order;
  // it is not the canonical production package. Preserve those original bytes.
  if (!program.charge(oracleBytes.size() / 64 + 1)) {
    reject(error, "core-ir-common-budget", "official-oracle parse bytes exceeded shared compiler work");
    return finish(3, "read-oracle", "the shared Program could not pay the actual oracle byte cost");
  }
  auto parsedOracle = llvm::json::parse(oracleBytes);
  if (!parsedOracle) {
    report["firstOracleParseError"] = llvm::toString(parsedOracle.takeError());
    return finish(3, "read-oracle", "the actual bounded JSON parser returned an error");
  }
  Json oracle = std::move(*parsedOracle);
  if (!returnOriginMetadataCost(program, oracle, error))
    return finish(3, "read-oracle", "the shared Program could not pay the actual oracle structure cost");
  const auto *officialFunctions = field(oracle, "functions").getAsArray();
  if (!officialFunctions || officialFunctions->size() != 3 ||
      field(field(oracle, "sourceRange"), "start").getAsInteger() != 0 ||
      field(field(oracle, "sourceRange"), "end").getAsInteger() != int64_t(program.sourceLength))
    return finish(3, "official-oracle", "three official declarations and the complete original UTF16 range are required");
  const auto sourceHash = string(field(oracle, "sourceSha256"));
  size_t matchingSources = 0;
  for (const auto &source : items(field(program.hir, "sources"))) {
    if (string(field(source, "path")) != program.sourcePath) continue;
    const auto text = field(source, "content").getAsString();
    if (!text || digest(*text) != "sha256:" + sourceHash)
      return finish(3, "official-oracle", "the official Source hash differs from the complete Core-owned Source");
    ++matchingSources;
  }
  if (matchingSources != 1) return finish(3, "official-oracle", "one complete original primary Source is required");

  // Exactly one production proof pass; a true return alone does not certify an
  // ordinary nonkernel member. Its actual fixed-return state is queried below.
  if (!verifyProgram(program, error)) return finish(3, "verifyProgram", "the actual whole-program verifier returned false");
  report["wholeProgramVerified"] = true;
  if (items(field(program.hir, "functions")).size() != 3 || items(field(program.request, "targets")).size() != 2)
    return finish(3, "scope", "the complete three-function Source and only two requested kernels must be retained");
  std::set<std::string> names, expectedTargets;
  std::string concatId;
  bool concatAvailable = false, kernelsAvailable = true;
  Array kernels;
  for (const auto &official : *officialFunctions) {
    const auto name = string(field(official, "name")), sourceId = string(field(official, "id"));
    const bool concat = name == "concatValue";
    if ((!concat && name != "leftKernel" && name != "rightKernel") || !names.insert(name).second || sourceId.empty() ||
        string(field(official, "sourcePath")) != program.sourcePath)
      return finish(3, "official-oracle", "the three named official declarations must be unique and retain their original Source path");
    const Json *owned = nullptr, *contract = nullptr;
    size_t matches = 0;
    for (const auto &fn : items(field(program.hir, "functions"))) {
      if (string(field(fn, "sourceBinding")) == sourceId) { owned = &fn; ++matches; }
    }
    if (matches != 1 || !owned || string(field(*owned, "name")) != name ||
        string(field(*owned, "sourcePath")) != program.sourcePath || !same(field(*owned, "range"), field(official, "range")))
      return finish(3, "Source-join", "the official Source declaration must join one complete owned HIR declaration");
    const auto id = string(field(*owned, "id"));
    for (const auto &row : items(field(program.publication, "contracts")))
      if (string(field(row, "functionId")) == id) contract = &row;
    const bool nonnullGraph5 = contract && field(*contract, "returnOrigins").getAsObject() &&
        same(field(field(*contract, "returnOrigins"), "format"), Object{{"family", "tsfg.return-origin-graph-candidate"}, {"version", 5}});
    if (!nonnullGraph5) return finish(3, "Published", "each original function must retain its supplied nonnull fixed Graph5");
    bool declaredRole = false, requiredKernel = false;
    for (const auto &root : items(field(field(program.hir, "closure"), "roots")))
      if (string(field(root, "target")) == id && string(field(root, "kind")) == (concat ? "application" : "kernel")) declaredRole = true;
    for (const auto &root : items(field(field(program.hir, "closure"), "requiredRoots")))
      if (string(field(root, "target")) == id && string(field(root, "kind")) == "kernel") requiredKernel = true;
    if (!declaredRole || requiredKernel != !concat)
      return finish(3, "scope", "concat remains an application root; only the two genuine i32 declarations are required kernels");
    const bool available = fixedReturnOriginAvailable(program, id);
    Object actual{{"name", name}, {"sourceFunctionId", sourceId}, {"semanticId", id},
        {"source", Object{{"path", program.sourcePath}, {"range", field(*owned, "range")}}},
        {"nonnullPublishedGraph5", nonnullGraph5}, {"fixedReturnAvailable", available},
        {"pending", bool(program.returnOriginPending.count(id))},
        {"verified", bool(program.returnOriginVerified.count(id))}};
    if (concat) { concatId = id; concatAvailable = available; report["concat"] = std::move(actual); }
    else { expectedTargets.insert(id); kernelsAvailable &= available; kernels.push_back(std::move(actual)); }
  }
  report["officialOracleBound"] = true;
  report["kernels"] = std::move(kernels);
  std::set<std::string> actualTargets;
  for (const auto &target : items(field(program.request, "targets"))) actualTargets.insert(string(target));
  if (concatId.empty() || actualTargets != expectedTargets || actualTargets.count(concatId))
    return finish(3, "scope", "the actual request must select precisely the two i32 kernels and never concat");
  if (!kernelsAvailable) return finish(3, "kernel-control", "an actual i32 control lacks its fixed-return certificate");
  if (!concatAvailable) return finish(3, "concat-fixed-return", "the ordinary concat fixed return/content proof remains Pending or unavailable");
  return finish(0, "concat-fixed-return", "the actual whole-program proof certifies the ordinary concat fixed return graph");
}
