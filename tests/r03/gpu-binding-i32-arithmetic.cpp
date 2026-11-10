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

bool readOfficialRange(const Json &value, uint32_t sourceLength, GpuSourceRange &out) {
  const auto start = field(value, "start").getAsInteger();
  const auto end = field(value, "end").getAsInteger();
  if (!check(start && end && *start >= 0 && *end > *start && uint64_t(*end) <= sourceLength,
      "official AST range is nonempty and inside the genuine Source")) return false;
  out = {"/src/main.ts", {uint32_t(*start), uint32_t(*end)}};
  return true;
}

bool sameRange(const GpuSourceRange &actual, const GpuSourceRange &expected) {
  return actual.sourceId == expected.sourceId && actual.range.start == expected.range.start &&
      actual.range.end == expected.range.end;
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
  if (argc != 4 && argc != 5) {
    llvm::errs() << "expected metadata directory, official oracle path and i32 operator\n";
    return 2;
  }
  std::string coreBytes, requestBytes, planBytes, oracleBytes;
  const bool expectedReject = argc == 5;
  if (expectedReject && llvm::StringRef(argv[4]) != "expect-capability") return 2;
  const std::string operation(argv[3]);
  const bool shift = operation == "<<" || operation == ">>" || operation == ">>>";
  if (operation != "+" && operation != "-" && operation != "*" &&
      operation != "&" && operation != "|" && operation != "^" && operation != "~" && !shift) return 2;
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
  const auto sourceLength = field(field(oracle, "sourceRange"), "end").getAsInteger();
  if (!check(official && sourceHash.size() == 64 && sourceLength && *sourceLength > 0 &&
      uint64_t(*sourceLength) <= 0xffffffffull &&
      rangeIs(field(oracle, "sourceRange"), 0, uint32_t(*sourceLength)) &&
      items(field(oracle, "functions")).size() == 2 && field(*official, "operator").getAsString() == operation &&
      field(*official, "id").getAsString() && field(*official, "parameterId").getAsString(),
      "official Source function/parameter identities and complete source range are established independently")) return 3;
  const bool hasLiteral = !field(*official, "literal").getAsNull();
  const bool unary = !hasLiteral && (operation == "-" || operation == "~");
  const size_t arity = unary ? 1 : 2;
  const auto literalToken = hasLiteral ? string(field(*official, "literalToken")) : "";
  int64_t literalValue = 0;
  if (!check((unary || operation != "~") && (!hasLiteral ||
      (!llvm::StringRef(literalToken).getAsInteger(10, literalValue) && literalValue >= -2147483648ll && literalValue <= 2147483647ll)),
      "official AST distinguishes unary, exact signed-i32 literal and variable binary operands")) return 3;
  GpuSourceRange functionRange, parameterRange, expressionRange, returnRange, parameterUseRange, literalRange, operatorRange, rightParameterUseRange;
  if (!readOfficialRange(field(*official, "range"), uint32_t(*sourceLength), functionRange) ||
      !readOfficialRange(field(*official, "parameterRange"), uint32_t(*sourceLength), parameterRange) ||
      !readOfficialRange(field(*official, "expression"), uint32_t(*sourceLength), expressionRange) ||
      !readOfficialRange(field(*official, "return"), uint32_t(*sourceLength), returnRange) ||
      !readOfficialRange(field(*official, "parameterUse"), uint32_t(*sourceLength), parameterUseRange) ||
      (unary ? !readOfficialRange(field(*official, "operatorRange"), uint32_t(*sourceLength), operatorRange) : hasLiteral ?
               !readOfficialRange(field(*official, "literal"), uint32_t(*sourceLength), literalRange) :
               !readOfficialRange(field(*official, "rightParameterUse"), uint32_t(*sourceLength), rightParameterUseRange))) return 3;
  for (const auto &row : {parameterRange, expressionRange, returnRange, parameterUseRange})
    if (!check(row.range.start >= functionRange.range.start && row.range.end <= functionRange.range.end,
        "official parameter and expression anchors belong to the selected function")) return 3;
  const auto &otherOperand = unary ? operatorRange : hasLiteral ? literalRange : rightParameterUseRange;
  if (!check(parameterUseRange.range.start >= expressionRange.range.start && parameterUseRange.range.end <= expressionRange.range.end &&
      otherOperand.range.start >= expressionRange.range.start && otherOperand.range.end <= expressionRange.range.end,
      "official operand and operator/literal anchors belong to the arithmetic expression")) return 3;
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
      program.sourceLength == uint32_t(*sourceLength) && program.sourceHash == "sha256:" + sourceHash,
      "complete genuine two-kernel Program and actual selected plan")) return 3;
  const auto functionId = string(field(items(field(plan, "kernels")).front(), "functionId"));
  const auto fn = std::find_if(program.functions.begin(), program.functions.end(), [&](const Function &row) { return row.id == functionId; });
  const Json *declaration = nullptr;
  for (const auto &row : items(field(program.hir, "functions")))
    if (field(row, "id").getAsString() == functionId) declaration = &row;
  if (!check(fn != program.functions.end() && sameRange({fn->path, fn->range}, functionRange) &&
      declaration && field(*declaration, "name").getAsString() == "constantKernel" &&
      field(*declaration, "sourceBinding").getAsString() == officialFunctionId &&
      items(field(*declaration, "parameters")).size() == 1, "semantic function joins its actual Go Source binding")) return 3;
  const auto &parameter = items(field(*declaration, "parameters")).front();
  const auto parameterId = string(field(parameter, "id"));
  if (!check(field(parameter, "sourceBinding").getAsString() == officialParameterId &&
      rangeIs(field(parameter, "range"), parameterRange.range.start, parameterRange.range.end),
      "parameter identity is joined rather than assumed to be a FunctionId")) return 3;

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
      const GpuSourceRange *expectedRange = nullptr;
      if (op.name == "fuel") {
        if (!check(!entry && field(op.properties, "event").getAsInteger() == 1, "one original entry fuel event")) return 3;
        entry = where; expectedRange = &functionRange;
      } else if (op.name == "numeric_use") {
        auto number = field(op.properties, "index").getAsInteger();
        if (!check(number && *number >= 0 && uint64_t(*number) < arity && !uses[*number] && op.operands.size() == 1 &&
            field(op.properties, "operator").getAsString() == operation, "original arithmetic numeric-use sites")) return 3;
        uses[*number] = where; expectedRange = &expressionRange;
      } else if (op.name == (unary ? "unary" : "binary")) {
        if (!check(!arithmetic && op.operands.size() == arity && field(op.properties, "operator").getAsString() == operation, "original arithmetic site")) return 3;
        arithmetic = where; expectedRange = &expressionRange;
      } else if (op.name == "constant") {
        if (!check(hasLiteral && !literal && field(op.properties, "decimal").getAsString() == literalToken,
            "actual SSA literal retains its independent official Source decimal and anchor")) return 3;
        literal = where; expectedRange = &literalRange;
      } else if (op.name == "cell" || op.name == "store") {
        expectedRange = &parameterRange;
      } else if (op.name == "load") {
        if (!check(field(op.properties, "binding").getAsString() == parameterId, "actual parameter load retains its official Symbol binding")) return 3;
        expectedRange = !unary && !hasLiteral && sameRange(where.source, rightParameterUseRange) ? &rightParameterUseRange : &parameterUseRange;
      } else if (op.name == "value_copy" || op.name == "func.return") {
        expectedRange = &returnRange;
      }
      if (!check(expectedRange && sameRange(where.source, *expectedRange), "every original Core operation retains its independent official Source anchor")) return 3;
    }
  }
  if (!check(entry && uses[0] && arithmetic && (unary ? !uses[1] && !literal : uses[1] && bool(literal) == hasLiteral),
      "all original Source arithmetic sites exist with the official arity")) return 3;
  if (expectedReject) {
    if (!check(shift && (!hasLiteral || literalValue < 0 || literalValue > 31), "negative mode selects a genuinely unproved shift count")) return 3;
    const std::string expectedMessage = hasLiteral ? "GPU shift constant count is outside the implemented 0..31 domain" :
      "GPU shift requires a proven constant-i32 count in 0..31";
    Array rejections;
    const auto rejected = [&](llvm::StringRef api, const Error &failure, bool unchanged, int64_t remaining) {
      if (!check(failure.code == "core-ir-common-gpu-lowering-capability" && failure.message == expectedMessage &&
          failure.path == arithmetic->source.sourceId && failure.range.start == arithmetic->source.range.start &&
          failure.range.end == arithmetic->source.range.end && unchanged && remaining > 0,
          "real shift entry rejects its unproved count at the original binary Source site and preserves out")) return false;
      rejections.push_back(Object{{"api", api.str()}, {"code", failure.code}, {"message", failure.message},
        {"source", source(arithmetic->source)}, {"outUnchanged", unchanged}, {"compilerBudgetRemaining", remaining}});
      return true;
    };
    const Json sentinel = Object{{"sentinel", "preserve-original-output"}};
    Program functionProgram = program; Json functions = sentinel; Error functionError;
    if (lowerGpuBindingFunctions(functionProgram, plan, context, functions, functionError) ||
        !rejected("lowerGpuBindingFunctions", functionError, same(functions, sentinel), int64_t(functionProgram.remaining))) return 3;
    Program moduleProgram = program; Json module = sentinel; Error moduleError;
    if (emitGpuBindingModule(moduleProgram, plan, "single-source-call-v1", context, module, moduleError) ||
        !rejected("emitGpuBindingModule", moduleError, same(module, sentinel), int64_t(moduleProgram.remaining))) return 3;
    // This actual identity envelope reaches the reader's Program-derived
    // lowering. It is never admitted or described as a valid artifact.
    const Json envelope = Object{{"family", "tsfg.gpu-binding-module"}, {"version", 1},
      {"inputIdentity", program.inputIdentity}, {"planDigest", digest(canonical(plan) + "\n")},
      {"profile", Object{{"name", "single-source-call-v1"}}}};
    Program readerProgram = program; std::optional<GpuPendingCall> pending; Error readerError;
    if (readGpuBindingModule(canonical(envelope) + "\n", readerProgram, plan, "single-source-call-v1", context, pending, readerError) ||
        !rejected("readGpuBindingModule", readerError, !pending, int64_t(readerProgram.remaining))) return 3;
    Json report = Object{{"family", "tsfg.gpu-i32-shift-capability-test-report"}, {"version", 1},
      {"operator", operation}, {"arity", int64_t(arity)}, {"coreSHA", digest(coreBytes)},
      {"requestSHA", digest(requestBytes)}, {"planSHA", digest(planBytes)}, {"officialOracleSHA", digest(oracleBytes)},
      {"source", source(arithmetic->source)}, {"rejections", std::move(rejections)},
      {"typedInitial", "empty"}, {"typedFinal", "empty"}, {"readerIdentityEnvelope", envelope},
      {"envelopeAdmittedAsArtifact", false}, {"artifactProduced", false},
      {"execution", Object{{"source", false}, {"vm", false}, {"numerical", false}, {"hostPreflight", false}, {"device", false}}}};
    if (llvm::sys::ChangeStdoutToBinary()) return 2;
    llvm::outs() << canonical(report) << '\n'; llvm::outs().flush();
    return llvm::outs().has_error() ? 2 : 0;
  }
  Json artifact = nullptr;
  if (!emitGpuBindingModule(program, plan, "single-source-call-v1", context, artifact, error)) {
    llvm::errs() << "actual emit [" << error.code << "] " << error.message << '\n' << diagnostics; return 3;
  }
  const auto &host = field(artifact, "hostPreflight");
  if (!check(items(field(artifact, "obligations")).size() == arity + 2 &&
      field(host, "status").getAsString() == "unfulfilled" && items(field(host, "steps")).size() == arity + 1 &&
      std::all_of(items(field(host, "steps")).begin(), items(field(host, "steps")).end(), [](const Json &step) {
        return field(step, "status").getAsString() == "unfulfilled";
      }), "all Source obligations are retained and every ordered Host step remains pending")) return 3;
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
      call.descriptors().size() == 2 && call.hostSteps().size() == arity + 1 && call.discharges().size() == 1,
      "typed explicit profile, pending authority, real words, scalar layout and resources")) return 3;
  size_t parameterIndex = call.descriptors().size(), returnIndex = call.descriptors().size();
  for (size_t index = 0; index < call.descriptors().size(); ++index) {
    const auto &row = call.descriptors()[index];
    if (!check(row.type == GpuScalarType::I32 && row.kernel && *row.kernel == functionId && row.source.sourceId == "/src/main.ts", "typed source-bound scalar descriptor")) return 3;
    if (row.kind == GpuResourceKind::Parameter && row.access == GpuResourceAccess::Read && row.id == parameterId && sameRange(row.source, parameterRange)) parameterIndex = index;
    if (row.kind == GpuResourceKind::Return && row.access == GpuResourceAccess::Write && row.id == functionId && sameRange(row.source, functionRange)) returnIndex = index;
  }
  if (!check(parameterIndex < 2 && returnIndex < 2 && parameterIndex != returnIndex &&
      same(field(typedProjection(call), "descriptors"), field(plan, "bindings")), "parameter/return bindings exactly preserve the verified plan")) return 3;
  const auto *budget = std::get_if<GpuEntryBudgetStep>(&call.hostSteps()[0]);
  const auto *left = std::get_if<GpuNumericUseStep>(&call.hostSteps()[1]);
  if (!check(budget && left && sameSite(budget->site, *entry, functionId) && budget->event == 1 && budget->activeDepth == 1 && budget->fuelCost == 1,
      "ordered pending entry retains its original Source site and budget")) return 3;
  for (size_t index = 0; index < arity; ++index) {
    const auto *step = std::get_if<GpuNumericUseStep>(&call.hostSteps()[index + 1]);
    if (!check(step && sameSite(step->site, *uses[index], functionId) && step->sourceOperator == operation &&
        step->index == index && step->operand == uses[index]->operand,
        "ordered numeric step retains its original Source site and operand")) return 3;
    if (index == 0) {
      const auto *binding = std::get_if<GpuBindingOrigin>(&step->origin);
      if (!check(binding && binding->descriptorIndex == parameterIndex, "actual typed parameter origin binds the selected descriptor")) return 3;
    } else {
      const auto *constant = std::get_if<GpuI32ConstantOrigin>(&step->origin);
      if (!check(constant && constant->bits == uint32_t(literalValue) && constant->decimal == literalToken,
          "actual typed binary constant origin equals the independent official Source literal")) return 3;
    }
  }
  if (!check(sameSite(call.discharges()[0].site, *arithmetic, functionId) &&
      call.discharges()[0].prerequisites == std::vector<uint32_t>{left->site.obligationId},
      "the unknown parameter numeric condition remains the integer-discharge prerequisite")) return 3;
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
  (*(*bindingSource.getAsObject())["source"].getAsObject())["start"] = int64_t(call.descriptors()[0].source.range.start) + 1;
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
  Json report = Object{{"family", "tsfg.gpu-i32-arithmetic-reader-test-report"}, {"version", 1}, {"operator", operation}, {"arity", int64_t(arity)},
      {"coreSHA", coreHash}, {"requestSHA", requestHash}, {"planSHA", planHash}, {"officialOracleSHA", oracleHash},
      {"officialLiteral", unary ? Json(nullptr) : source(literalRange)},
      {"sourceBaseline", Object{{"functionId", functionId}, {"source", source(functionRange)}, {"operations", std::move(baseline)}}},
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
