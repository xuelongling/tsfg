// SPDX-License-Identifier: MIT
#include "native_cost.h"
#include "llvm/ADT/StringExtras.h"
#include "llvm/MC/MCAsmInfo.h"
#include "llvm/MC/MCContext.h"
#include "llvm/MC/MCDisassembler/MCDisassembler.h"
#include "llvm/MC/MCInst.h"
#include "llvm/MC/MCInstrAnalysis.h"
#include "llvm/MC/MCInstrInfo.h"
#include "llvm/MC/MCRegisterInfo.h"
#include "llvm/MC/MCSubtargetInfo.h"
#include "llvm/MC/MCTargetOptions.h"
#include "llvm/MC/TargetRegistry.h"
#include "llvm/Object/COFF.h"
#include "llvm/Object/SymbolSize.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/SHA256.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/TargetParser/Triple.h"
#include <map>
#include <memory>
#include <set>

namespace {
std::string hash(llvm::StringRef bytes) {
  auto digest = llvm::SHA256::hash(llvm::ArrayRef<uint8_t>(
      reinterpret_cast<const uint8_t *>(bytes.data()), bytes.size()));
  return "sha256:" + llvm::toHex(digest, true);
}
bool reject(llvm::StringRef reason) {
  llvm::errs() << "[r07-native-machine-work] " << reason << '\n'; return false;
}
}
bool tsfg::inspectNativeInstructions(llvm::MemoryBufferRef input,
                                     llvm::raw_ostream &output) {
  if (input.getBufferSize() == 0 || input.getBufferSize() > 16777216)
    return reject("object size");
  auto object = llvm::object::ObjectFile::createObjectFile(input);
  if (!object) { llvm::consumeError(object.takeError()); return reject("object format"); }
  auto *coff = llvm::dyn_cast<llvm::object::COFFObjectFile>(object->get());
  if (!coff || coff->getMachine() != llvm::COFF::IMAGE_FILE_MACHINE_AMD64 ||
      coff->getSizeOfOptionalHeader() != 0) return reject("COFF x64 target");
  LLVMInitializeX86TargetInfo(); LLVMInitializeX86TargetMC();
  LLVMInitializeX86Disassembler();
  const llvm::Triple triple("x86_64-pc-windows-msvc");
  std::string error;
  auto *target = llvm::TargetRegistry::lookupTarget(triple, error);
  if (!target) return reject(error);
  std::unique_ptr<llvm::MCRegisterInfo> registers(target->createMCRegInfo(triple));
  std::unique_ptr<llvm::MCInstrInfo> instructions(target->createMCInstrInfo());
  std::unique_ptr<llvm::MCSubtargetInfo> subtarget(target->createMCSubtargetInfo(
      triple, "x86-64-v2", "-avx,-avx2,-avx512f"));
  if (!registers || !instructions || !subtarget) return reject("X86 MC facilities");
  llvm::MCTargetOptions options;
  std::unique_ptr<llvm::MCAsmInfo> assembler(target->createMCAsmInfo(*registers, triple, options));
  if (!assembler) return reject("X86 assembler info");
  llvm::MCContext context(triple, assembler.get(), registers.get(), subtarget.get());
  std::unique_ptr<llvm::MCDisassembler> decoder(target->createMCDisassembler(*subtarget, context));
  std::unique_ptr<llvm::MCInstrAnalysis> analysis(target->createMCInstrAnalysis(instructions.get()));
  if (!decoder || !analysis) return reject("X86 decoder/analysis");
  llvm::json::Array functions;
  std::set<std::string> names;
  for (const auto &[symbol, size] : llvm::object::computeSymbolSizes(**object)) {
    const auto definition = coff->getCOFFSymbol(symbol);
    if (definition.getComplexType() != llvm::COFF::IMAGE_SYM_DTYPE_FUNCTION ||
        definition.getSectionNumber() <= 0 ||
        (definition.getStorageClass() != llvm::COFF::IMAGE_SYM_CLASS_EXTERNAL &&
         definition.getStorageClass() != llvm::COFF::IMAGE_SYM_CLASS_STATIC)) continue;
    auto name = symbol.getName(); auto section = symbol.getSection(); auto address = symbol.getAddress();
    if (!name || !section || !address) {
      if (!name) llvm::consumeError(name.takeError());
      if (!section) llvm::consumeError(section.takeError());
      if (!address) llvm::consumeError(address.takeError());
      return reject("function symbol");
    }
    if (*section == (*object)->section_end() || !(**section).isText() || size == 0)
      return reject("function code extent");
    if (!names.insert(name->str()).second) return reject("duplicate function symbol");
    auto contents = (**section).getContents(); auto sectionName = (**section).getName();
    if (!contents || !sectionName) {
      if (!contents) llvm::consumeError(contents.takeError());
      if (!sectionName) llvm::consumeError(sectionName.takeError());
      return reject("code section");
    }
    const uint64_t begin = *address - (**section).getAddress();
    if (begin > contents->size() || size > contents->size() - begin) return reject("function range");
    auto code = contents->substr(begin, size);
    struct Relocation { std::string symbol; uint16_t type; };
    std::map<uint64_t, Relocation> relocations;
    for (const auto &relocation : (**section).relocations()) {
      if (relocation.getOffset() < begin || relocation.getOffset() >= begin + size) continue;
      auto targetSymbol = relocation.getSymbol();
      if (targetSymbol == (*object)->symbol_end()) return reject("relocation symbol");
      auto targetName = targetSymbol->getName();
      if (!targetName) { llvm::consumeError(targetName.takeError()); return reject("relocation target"); }
      if (!relocations.emplace(relocation.getOffset() - begin,
          Relocation{targetName->str(), static_cast<uint16_t>(relocation.getType())}).second)
        return reject("duplicate relocation");
    }
    llvm::json::Array nodes;
    std::set<uint64_t> boundaries, branchTargets;
    uint64_t cursor = 0;
    while (cursor < size) {
      llvm::MCInst instruction; uint64_t length = 0;
      const auto bytes = llvm::ArrayRef<uint8_t>(reinterpret_cast<const uint8_t *>(code.data() + cursor), size - cursor);
      if (decoder->getInstruction(instruction, length, bytes, begin + cursor, llvm::nulls()) !=
          llvm::MCDisassembler::Success || length == 0 || length > size - cursor)
        return reject("unknown instruction boundary");
      boundaries.insert(cursor);
      llvm::json::Array successors, callRelocations, operands;
      for (const auto &operand : instruction) {
        if (operand.isReg()) {
          const auto reg = operand.getReg();
          operands.push_back(llvm::json::Object{{"kind", "register"},
            {"id", std::to_string(reg)},
            {"name", reg == 0 ? "" : registers->getName(reg)}});
        } else if (operand.isImm()) {
          operands.push_back(llvm::json::Object{{"kind", "immediate"},
            {"value", std::to_string(operand.getImm())}});
        } else {
          return reject("unbound decoded operand");
        }
      }
      const bool call = analysis->isCall(instruction), returns = analysis->isReturn(instruction);
      const bool branch = analysis->isBranch(instruction);
      if (analysis->isIndirectBranch(instruction))
        return reject("unknown indirect branch in " + name->str() + " at " + std::to_string(cursor));
      if (branch) {
        uint64_t destination;
        if (!analysis->evaluateBranch(instruction, begin + cursor, length, destination) ||
            destination < begin || destination >= begin + size) return reject("branch leaves function");
        branchTargets.insert(destination - begin); successors.push_back(std::to_string(destination - begin));
      }
      if (!returns && !analysis->isUnconditionalBranch(instruction) && cursor + length < size)
        successors.push_back(std::to_string(cursor + length));
      for (auto relocation = relocations.lower_bound(cursor);
           relocation != relocations.end() && relocation->first < cursor + length; ++relocation)
        callRelocations.push_back(llvm::json::Object{{"offset", std::to_string(relocation->first)},
          {"symbol", relocation->second.symbol}, {"type", std::to_string(relocation->second.type)}});
      const auto &description = instructions->get(instruction.getOpcode());
      nodes.push_back(llvm::json::Object{
        {"offset", std::to_string(cursor)}, {"size", std::to_string(length)},
        {"bytes", llvm::toHex(code.substr(cursor, length), true)},
        {"opcode", instructions->getName(instruction.getOpcode()).str()},
        {"isCall", call}, {"isReturn", returns},
        {"isConditionalBranch", analysis->isConditionalBranch(instruction)},
        {"isUnconditionalBranch", analysis->isUnconditionalBranch(instruction)},
        {"mayLoad", description.mayLoad()}, {"mayStore", description.mayStore()},
        {"hasUnmodeledSideEffects", description.hasUnmodeledSideEffects()},
        {"operands", std::move(operands)}, {"successors", std::move(successors)},
        {"relocations", std::move(callRelocations)}, {"decodedInstructionCount", "1"}});
      cursor += length;
    }
    for (auto destination : branchTargets) if (!boundaries.count(destination))
      return reject("branch target is not an instruction boundary");
    functions.push_back(llvm::json::Object{{"name", name->str()}, {"section", sectionName->str()},
      {"sectionOffset", std::to_string(begin)}, {"size", std::to_string(size)},
      {"codeHash", hash(code)}, {"decodedInstructionCount", std::to_string(nodes.size())},
      {"nodes", std::move(nodes)}});
  }
  if (functions.empty()) return reject("no functions");
  output << llvm::json::Value(llvm::json::Object{{"objectHash", hash(input.getBuffer())},
    {"triple", triple.str()}, {"functions", std::move(functions)},
    {"qualification", "inspection-only; interval/call/cycle/Runtime certificates remain required"},
    {"version", "0.2.0"}}) << '\n';
  return true;
}
