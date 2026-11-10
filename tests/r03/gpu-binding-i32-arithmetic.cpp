// SPDX-License-Identifier: MIT
// Genuine public-Go Source facts -> Core -> actual emit/owned pending-call reader.
// No Source, Host preflight, numerical oracle, VM or device is executed.
#include "common-program-gpu-lowering.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/SPIRV/IR/SPIRVDialect.h"
#include "mlir/IR/Diagnostics.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/Error.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/raw_ostream.h"

#include <algorithm>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace {
using namespace tsfg::commonProgram;
using tsfg::exception::field;
using tsfg::exception::items;
using tsfg::exception::string;

bool check(bool condition, llvm::StringRef label) {
  if (!condition) llvm::errs() << "i32 arithmetic reader test failed: " << label << '\n';
  return condition;
}

bool readFile(llvm::StringRef root, llvm::StringRef name, std::string &out) {
  const auto file = root.empty() ? name.str() : root.str() + "/" + name.str();
  auto input = llvm::MemoryBuffer::getFile(file);
  if (!check(bool(input), "genuine metadata/oracle input is readable")) return false;
  if (!check((*input)->getBufferSize() <= 1024 * 1024, "bounded compiler-data input")) return false;
  out = (*input)->getBuffer().str();
  return true;
}

bool rangeIs(const Json &value, uint32_t start, uint32_t end) {
  return field(value, "start").getAsInteger() == start &&
         field(value, "end").getAsInteger() == end;
}

Json source(const GpuSourceRange &value) {
  return Object{{"sourceId", value.sourceId}, {"start", int64_t(value.range.start)},
                {"end", int64_t(value.range.end)}};
}

Json site(const GpuObligationSite &value) {
  return Object{{"obligationId", int64_t(value.obligationId)}, {"functionId", value.functionId},
      {"source", source(value.source)},
      {"point", Object{{"block", int64_t(value.point.block)}, {"operation", int64_t(value.point.operation)}}}};
}

Json typedProjection(const GpuPendingCall &call) {
  Array words, descriptors, steps, discharges;
  for (auto word : call.words()) words.push_back(int64_t(word));
  for (const auto &row : call.descriptors()) {
    const char *kind = row.kind == GpuResourceKind::Global ? "global" :
                       row.kind == GpuResourceKind::Parameter ? "parameter" :
                       row.kind == GpuResourceKind::Return ? "return" : "unknown";
    const char *access = row.access == GpuResourceAccess::Read ? "read" :
                         row.access == GpuResourceAccess::Write ? "write" :
                         row.access == GpuResourceAccess::ReadWrite ? "read-write" : "unknown";
    descriptors.push_back(Object{{"kind", kind}, {"access", access},
        {"type", row.type == GpuScalarType::I32 ? "i32" : "unknown"}, {"id", row.id},
        {"kernel", row.kernel ? Json(*row.kernel) : Json(nullptr)},
        {"set", int64_t(row.set)}, {"binding", int64_t(row.binding)}, {"source", source(row.source)}});
  }
  for (const auto &row : call.hostSteps()) {
    if (const auto *entry = std::get_if<GpuEntryBudgetStep>(&row)) {
      steps.push_back(Object{{"kind", "entry-budget"}, {"site", site(entry->site)},
          {"event", int64_t(entry->event)}, {"activeDepth", int64_t(entry->activeDepth)},
          {"fuelCost", int64_t(entry->fuelCost)}});
    } else {
      const auto &numeric = std::get<GpuNumericUseStep>(row);
      Json origin = nullptr;
      if (const auto *binding = std::get_if<GpuBindingOrigin>(&numeric.origin))
        origin = Object{{"kind", "binding"}, {"descriptorIndex", int64_t(binding->descriptorIndex)}};
      else {
        const auto &constant = std::get<GpuI32ConstantOrigin>(numeric.origin);
        origin = Object{{"kind", "constant-i32"}, {"bits", int64_t(constant.bits)}, {"decimal", constant.decimal}};
      }
      steps.push_back(Object{{"kind", "numeric-use"}, {"site", site(numeric.site)},
          {"operator", numeric.sourceOperator}, {"index", int64_t(numeric.index)},
          {"operand", int64_t(numeric.operand)}, {"origin", std::move(origin)}});
    }
  }
  for (const auto &row : call.discharges()) {
    Array prerequisites;
    for (auto id : row.prerequisites) prerequisites.push_back(int64_t(id));
    discharges.push_back(Object{{"site", site(row.site)}, {"prerequisites", std::move(prerequisites)}});
  }
  const auto &layout = call.layout();
  const auto &identity = call.identity();
  return Object{{"profile", call.profile() == GpuModuleProfile::SingleSourceCallV1 ? "single-source-call-v1" : "unknown"},
      {"launchAuthorized", call.launchAuthorized()}, {"hostPreflightFulfilled", call.hostPreflightFulfilled()},
      {"functionId", call.functionId()}, {"entryPoint", call.entryPoint()},
      {"layout", Object{{"memberOffset", int64_t(layout.memberOffset)}, {"memberBytes", int64_t(layout.memberBytes)},
          {"memberAlignment", int64_t(layout.memberAlignment)}, {"blockBytes", int64_t(layout.blockBytes)}}},
      {"words", std::move(words)}, {"descriptors", std::move(descriptors)},
      {"hostSteps", std::move(steps)}, {"discharges", std::move(discharges)},
      {"identity", Object{{"inputIdentity", identity.inputIdentity}, {"hirDigest", identity.hirDigest},
          {"scopeDigest", identity.scopeDigest}, {"publishedDigest", identity.publishedDigest},
          {"kernelProofDigest", identity.kernelProofDigest}, {"borrowProofDigest", identity.borrowProofDigest},
          {"requestDigest", identity.requestDigest}, {"planDigest", identity.planDigest},
          {"wordsDigest", identity.wordsDigest}, {"artifactDigest", identity.artifactDigest}}}};
}

struct OperationSite {
  GpuSourceRange source;
  GpuSourcePoint point;
  uint16_t operand = noRegister;
};

bool sameSite(const GpuObligationSite &actual, const OperationSite &expected, llvm::StringRef functionId) {
  return actual.functionId == functionId && actual.source.sourceId == expected.source.sourceId &&
      actual.source.range.start == expected.source.range.start && actual.source.range.end == expected.source.range.end &&
      actual.point.block == expected.point.block && actual.point.operation == expected.point.operation;
}
} // namespace

int main(int argc, char **argv) {
  if (argc != 4) {
    llvm::errs() << "expected metadata directory, official oracle path and + or -\n";
    return 2;
  }
  std::string coreBytes, requestBytes, planBytes, oracleBytes;
  const std::string operation(argv[3]);
  if (operation != "+" && operation != "-") return 2;
  if (!readFile(argv[1], "common-program.mlir", coreBytes) ||
      !readFile(argv[1], "gpu-binding-request.json", requestBytes) ||
      !readFile(argv[1], "gpu-binding-plan.json", planBytes) ||
      !readFile("", argv[2], oracleBytes)) return 3;

  // This boundary owns the separately produced official AST oracle. It is not
  // taken from the emitted artifact or rewritten into a Common/HIR/Core input.
  auto parsedOracle = llvm::json::parse(oracleBytes);
  if (!parsedOracle) { llvm::errs() << llvm::toString(parsedOracle.takeError()) << '\n'; return 3; }
  Json oracle = std::move(*parsedOracle);
  const Json *official = nullptr;
  for (const auto &row : items(field(oracle, "functions")))
    if (field(row, "name").getAsString() == "constantKernel") official = &row;
  const auto sourceHash = string(field(oracle, "sourceSha256"));
  if (!check(sourceHash.size() == 64 &&
      rangeIs(field(oracle, "sourceRange"), 0, 161) && items(field(oracle, "functions")).size() == 2 && official &&
      rangeIs(field(*official, "range"), 39, 102) && rangeIs(field(*official, "parameterRange"), 70, 76) &&
      rangeIs(field(*official, "expression"), 94, 99) && rangeIs(field(*official, "literal"), 98, 99) &&
      field(*official, "operator").getAsString() == operation && field(*official, "literalToken").getAsString() == "7" &&
      field(*official, "id").getAsString() && field(*official, "parameterId").getAsString(),
      "official Source literal/function/parameter anchors and identity are established independently")) return 3;
  const auto officialFunctionId = string(field(*official, "id"));
  const auto officialParameterId = string(field(*official, "parameterId"));

  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry); registerDialect(registry);
  registry.insert<mlir::func::FuncDialect, mlir::cf::ControlFlowDialect, mlir::spirv::SPIRVDialect>();
  mlir::MLIRContext context(registry); context.disableMultithreading();
  std::string diagnostics;
  mlir::ScopedDiagnosticHandler handler(&context, [&](mlir::Diagnostic &diagnostic) {
    llvm::raw_string_ostream stream(diagnostics); diagnostic.print(stream); stream << '\n';
    return mlir::success();
  });
  Program program; Error error; Json request = nullptr, savedPlan = nullptr, plan = nullptr;
  {
    auto core = mlir::parseSourceString<mlir::ModuleOp>(coreBytes, &context);
    if (!core || !readCore(*core, program, error)) {
      llvm::errs() << "actual Core admission [" << error.code << "] " << error.message << '\n' << diagnostics;
      return 3;
    }
  }
  for (auto pair : {std::pair{&requestBytes, &request}, std::pair{&planBytes, &savedPlan}}) {
    const llvm::StringRef bytes(*pair.first);
    if (!check(bytes.size() >= 2 && bytes.back() == '\n', "canonical request/plan plus LF")) return 3;
    if (!readJson(bytes.drop_back(), *pair.second, program, error)) {
      llvm::errs() << "actual request/plan boundary [" << error.code << "] " << error.message << '\n'; return 3;
    }
  }
  if (!createGpuBindingPlan(program, request, plan, error)) {
    llvm::errs() << "actual binding-plan admission [" << error.code << "] " << error.message << '\n'; return 3;
  }
  if (!check(same(plan, savedPlan) && items(field(plan, "groupTargets")).size() == 2 &&
      items(field(plan, "kernels")).size() == 1 && program.sourcePath == "/src/main.ts" &&
      program.sourceLength == 161 && program.sourceHash == "sha256:" + sourceHash,
      "complete genuine two-kernel Program and actual selected plan")) return 3;
  const auto functionId = string(field(items(field(plan, "kernels")).front(), "functionId"));
  const auto fn = std::find_if(program.functions.begin(), program.functions.end(), [&](const Function &row) { return row.id == functionId; });
  const Json *declaration = nullptr;
  for (const auto &row : items(field(program.hir, "functions")))
    if (field(row, "id").getAsString() == functionId) declaration = &row;
  if (!check(fn != program.functions.end() && fn->range.start == 39 && fn->range.end == 102 &&
      declaration && field(*declaration, "name").getAsString() == "constantKernel" &&
      field(*declaration, "sourceBinding").getAsString() == officialFunctionId &&
      items(field(*declaration, "parameters")).size() == 1, "semantic function joins its actual Go Source binding")) return 3;
  const auto &parameter = items(field(*declaration, "parameters")).front();
  const auto parameterId = string(field(parameter, "id"));
  if (!check(field(parameter, "sourceBinding").getAsString() == officialParameterId &&
      rangeIs(field(parameter, "range"), 70, 76), "parameter identity is joined rather than assumed to be a FunctionId")) return 3;

  std::optional<OperationSite> entry, uses[2], arithmetic, literal;
  Array baseline;
  for (size_t block = 0; block < fn->blocks.size(); ++block) {
    for (size_t index = 0; index < fn->blocks[block].operations.size(); ++index) {
      const auto &op = fn->blocks[block].operations[index];
      OperationSite where{{fn->path, op.range}, {uint32_t(block), uint32_t(index)},
                          op.operands.empty() ? noRegister : op.operands.front()};
      Array operands, successors;
      for (auto id : op.operands) operands.push_back(int64_t(id));
      for (auto id : op.successors) successors.push_back(int64_t(id));
      baseline.push_back(Object{{"name", op.name}, {"source", source(where.source)},
          {"point", Object{{"block", int64_t(block)}, {"operation", int64_t(index)}}},
          {"properties", op.properties}, {"result", int64_t(op.result)},
          {"operands", std::move(operands)}, {"successors", std::move(successors)}});
      if (op.name == "fuel") {
        if (!check(!entry && op.range.start == 39 && op.range.end == 102 && field(op.properties, "event").getAsInteger() == 1, "one original entry fuel event")) return 3;
        entry = where;
      } else if (op.name == "numeric_use") {
        auto number = field(op.properties, "index").getAsInteger();
        if (!check(number && (*number == 0 || *number == 1) && !uses[*number] && op.operands.size() == 1 &&
            op.range.start == 94 && op.range.end == 99 && field(op.properties, "operator").getAsString() == operation, "original arithmetic numeric-use sites")) return 3;
        uses[*number] = where;
      } else if (op.name == "binary") {
        if (!check(!arithmetic && op.range.start == 94 && op.range.end == 99 && field(op.properties, "operator").getAsString() == operation, "original arithmetic site")) return 3;
        arithmetic = where;
      } else if (op.name == "constant") {
        if (!check(!literal && op.range.start == 98 && op.range.end == 99 && field(op.properties, "decimal").getAsString() == "7", "actual SSA literal retains official Source 7 anchor")) return 3;
        literal = where;
      }
    }
  }
  if (!check(entry && uses[0] && uses[1] && arithmetic && literal, "all original Source arithmetic sites exist")) return 3;
  Json artifact = nullptr;
  if (!emitGpuBindingModule(program, plan, "single-source-call-v1", context, artifact, error)) {
    llvm::errs() << "actual emit [" << error.code << "] " << error.message << '\n' << diagnostics; return 3;
  }
  const auto &host = field(artifact, "hostPreflight");
  if (!check(items(field(artifact, "obligations")).size() == 4 &&
      field(host, "status").getAsString() == "unfulfilled" && items(field(host, "steps")).size() == 3 &&
      std::all_of(items(field(host, "steps")).begin(), items(field(host, "steps")).end(), [](const Json &step) {
        return field(step, "status").getAsString() == "unfulfilled";
      }), "four Source obligations are retained and all three ordered Host steps remain pending")) return 3;
  auto artifactBytes = canonical(artifact) + "\n";
  std::optional<GpuPendingCall> pending;
  const auto before = program.remaining;
  if (!readGpuBindingModule(artifactBytes, program, plan, "single-source-call-v1", context, pending, error)) {
    llvm::errs() << "actual arithmetic reader [" << error.code << "] " << error.message << '\n' << diagnostics; return 3;
  }
  if (!check(pending && program.remaining < before, "real reader positive consumes compiler work")) return 3;
  const auto &call = *pending;
  const auto &layout = call.layout();
  if (!check(call.profile() == GpuModuleProfile::SingleSourceCallV1 && !call.launchAuthorized() && !call.hostPreflightFulfilled() &&
      call.functionId() == functionId && call.entryPoint() == string(field(artifact, "entryPoint")) &&
      call.words().size() >= 5 && call.words()[0] == 0x07230203 && call.words()[1] == 0x00010300 &&
      layout.memberOffset == 0 && layout.memberBytes == 4 && layout.memberAlignment == 4 && layout.blockBytes == 4 &&
      call.descriptors().size() == 2 && call.hostSteps().size() == 3 && call.discharges().size() == 1,
      "typed explicit profile, pending authority, real words, scalar layout and resources")) return 3;
  size_t parameterIndex = call.descriptors().size(), returnIndex = call.descriptors().size();
  for (size_t index = 0; index < call.descriptors().size(); ++index) {
    const auto &row = call.descriptors()[index];
    if (!check(row.type == GpuScalarType::I32 && row.kernel && *row.kernel == functionId && row.source.sourceId == "/src/main.ts", "typed source-bound scalar descriptor")) return 3;
    if (row.kind == GpuResourceKind::Parameter && row.access == GpuResourceAccess::Read && row.id == parameterId && row.source.range.start == 70 && row.source.range.end == 76) parameterIndex = index;
    if (row.kind == GpuResourceKind::Return && row.access == GpuResourceAccess::Write && row.id == functionId && row.source.range.start == 39 && row.source.range.end == 102) returnIndex = index;
  }
  if (!check(parameterIndex < 2 && returnIndex < 2 && parameterIndex != returnIndex &&
      same(field(typedProjection(call), "descriptors"), field(plan, "bindings")), "parameter/return bindings exactly preserve the verified plan")) return 3;
  const auto *budget = std::get_if<GpuEntryBudgetStep>(&call.hostSteps()[0]);
  const auto *left = std::get_if<GpuNumericUseStep>(&call.hostSteps()[1]);
  const auto *right = std::get_if<GpuNumericUseStep>(&call.hostSteps()[2]);
  if (!check(budget && left && right && sameSite(budget->site, *entry, functionId) && budget->event == 1 && budget->activeDepth == 1 && budget->fuelCost == 1 &&
      sameSite(left->site, *uses[0], functionId) && left->sourceOperator == operation && left->index == 0 && left->operand == uses[0]->operand &&
      sameSite(right->site, *uses[1], functionId) && right->sourceOperator == operation && right->index == 1 && right->operand == uses[1]->operand,
      "ordered pending entry and both numeric steps retain real Source sites/operands")) return 3;
  const auto *binding = std::get_if<GpuBindingOrigin>(&left->origin);
  const auto *constant = std::get_if<GpuI32ConstantOrigin>(&right->origin);
  if (!check(binding && binding->descriptorIndex == parameterIndex && constant && constant->bits == 7 && constant->decimal == "7" &&
      sameSite(call.discharges()[0].site, *arithmetic, functionId) &&
      call.discharges()[0].prerequisites == std::vector<uint32_t>{left->site.obligationId},
      "actual typed constant origin is 7; only the unknown parameter numeric condition remains a wrap-discharge prerequisite")) return 3;
  const auto typed = typedProjection(call);
  if (!check(same(field(typed, "words"), field(artifact, "words")) &&
      call.identity().inputIdentity == program.inputIdentity && call.identity().hirDigest == program.hirHash &&
      call.identity().scopeDigest == string(field(plan, "scopeDigest")) && call.identity().publishedDigest == string(field(plan, "publishedDigest")) &&
      call.identity().kernelProofDigest == string(field(plan, "kernelProofDigest")) && call.identity().borrowProofDigest == string(field(plan, "borrowProofDigest")) &&
      call.identity().requestDigest == string(field(plan, "requestDigest")) && call.identity().planDigest == digest(canonical(plan) + "\n") &&
      call.identity().wordsDigest == digest(canonical(field(typed, "words")) + "\n") && call.identity().artifactDigest == string(field(artifact, "artifactDigest")),
      "owned word vector and complete proof/plan identities survive the actual reader")) return 3;
  Array rejectedArtifacts;
  const auto rejects = [&](llvm::StringRef name, Json changed) {
    changed.getAsObject()->erase("artifactDigest");
    (*changed.getAsObject())["artifactDigest"] = digest(canonical(changed) + "\n");
    Program independent = program;
    Error rejected;
    auto preserved = pending;
    const auto baseline = typedProjection(*preserved);
    const bool accepted = readGpuBindingModule(canonical(changed) + "\n", independent, plan,
      "single-source-call-v1", context, preserved, rejected);
    if (!check(!accepted && rejected.code == "core-ir-common-gpu-artifact-content" &&
        preserved && same(typedProjection(*preserved), baseline), name)) return false;
    rejectedArtifacts.push_back(Object{{"name", name.str()}, {"code", rejected.code},
      {"selfConsistentArtifactDigest", true}, {"ownedOutputUnchanged", true}});
    return true;
  };
  auto wrongWords = artifact;
  (*wrongWords.getAsObject())["words"].getAsArray()->back() = int64_t(0);
  auto wrongSource = artifact;
  auto &bindingSource = (*(*wrongSource.getAsObject())["bindings"].getAsArray())[0];
  (*(*bindingSource.getAsObject())["source"].getAsObject())["start"] = int64_t(71);
  auto wrongDependencies = artifact;
  auto &arithmeticDischarge = (*wrongDependencies.getAsObject())["discharges"].getAsArray()->front();
  (*arithmeticDischarge.getAsObject())["requires"] = Array{};
  auto wrongOperator = artifact;
  auto &arithmeticObligation = (*wrongOperator.getAsObject())["obligations"].getAsArray()->back();
  (*arithmeticObligation.getAsObject())["operator"] = operation == "+" ? "-" : "+";
  if (!rejects("changed words", std::move(wrongWords)) ||
      !rejects("changed Source anchor", std::move(wrongSource)) ||
      !rejects("erased arithmetic prerequisite", std::move(wrongDependencies)) ||
      !rejects("changed Source operator", std::move(wrongOperator))) return 3;
  const auto coreHash = digest(coreBytes), requestHash = digest(requestBytes), planHash = digest(planBytes), oracleHash = digest(oracleBytes);
  const auto after = program.remaining;
  std::fill(artifactBytes.begin(), artifactBytes.end(), 'x'); artifactBytes.clear(); artifactBytes.shrink_to_fit();
  coreBytes.clear(); requestBytes.clear(); planBytes.clear(); oracleBytes.clear();
  program = Program{}; request = nullptr; savedPlan = nullptr; plan = nullptr; oracle = nullptr;
  if (!check(same(typedProjection(*pending), typed), "all typed data remains owned after reader inputs and Program are released")) return 3;
  Json report = Object{{"family", "tsfg.gpu-i32-arithmetic-reader-test-report"}, {"version", 1}, {"operator", operation},
      {"coreSHA", coreHash}, {"requestSHA", requestHash}, {"planSHA", planHash}, {"officialOracleSHA", oracleHash},
      {"officialLiteral", Object{{"sourceId", "/src/main.ts"}, {"start", 98}, {"end", 99}}},
      {"sourceBaseline", Object{{"functionId", functionId}, {"source", Object{{"sourceId", "/src/main.ts"}, {"start", 39}, {"end", 102}}}, {"operations", std::move(baseline)}}},
      {"emittedModule", std::move(artifact)}, {"typedPending", typed}, {"ownedAfterInputRelease", true},
      {"readerApiPositiveCount", 1}, {"readerApiRejectionCount", int64_t(rejectedArtifacts.size())},
      {"readerApiRejections", std::move(rejectedArtifacts)},
      {"compilerBudgetBeforeReader", int64_t(before)}, {"compilerBudgetAfterReader", int64_t(after)},
      {"execution", Object{{"source", false}, {"vm", false}, {"numerical", false}, {"hostPreflight", false}, {"device", false}}},
      {"formalGpuConsumer", false}, {"wholeSdkHoldUnchanged", true}};
  if (llvm::sys::ChangeStdoutToBinary()) return 2;
  llvm::outs() << canonical(report) << '\n'; llvm::outs().flush();
  return llvm::outs().has_error() ? 2 : 0;
}
