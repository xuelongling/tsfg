// SPDX-License-Identifier: MIT
#include "aot-module.h"
#include "dialect.h"
#include "scalar-presence.h"
#include "../../runtime/aot-program.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/DerivedTypes.h"
#include "llvm/IR/GlobalVariable.h"

namespace tsfg {
namespace {
using namespace llvm;
class ProgramMetadata {
  ModuleAotContext &context;
  LLVMContext &c;
  Type *i8, *i16, *i32, *ptr, *digest;
  StructType *span, *source, *function, *module, *global, *host, *root, *program;
  unsigned serial = 0;
  Constant *integer(uint64_t value, Type *type = nullptr) {
    return ConstantInt::get(type ? type : i32, value);
  }
  Constant *hash(const ModuleHash &value) { return ConstantDataArray::get(c, ArrayRef<uint8_t>(value)); }
  Constant *hash(mlir::StringAttr value) {
    if (!value || !value.getValue().starts_with("sha256:") || value.getValue().size() != 71) return nullptr;
    ModuleHash bytes{};
    for (unsigned i = 0; i < bytes.size(); ++i) {
      unsigned byte;
      if (value.getValue().substr(7 + i * 2, 2).getAsInteger(16, byte)) return nullptr;
      bytes[i] = byte;
    }
    return hash(bytes);
  }
  Constant *array(Type *element, ArrayRef<Constant *> values) {
    if (values.empty()) return ConstantPointerNull::get(cast<PointerType>(ptr));
    auto *type = ArrayType::get(element, values.size());
    auto *value = new GlobalVariable(context.native, type, true, GlobalValue::PrivateLinkage,
        ConstantArray::get(type, values), "tsfg_program_data_" + std::to_string(serial++));
    value->setUnnamedAddr(GlobalValue::UnnamedAddr::Global);
    return value;
  }
  Constant *bytes(ArrayRef<uint8_t> values) {
    std::vector<Constant *> items;
    for (auto value : values) items.push_back(integer(value, i8));
    return array(i8, items);
  }
  Constant *text(StringRef value) {
    return ConstantStruct::get(span, {bytes(ArrayRef<uint8_t>(reinterpret_cast<const uint8_t *>(value.data()), value.size())),
        integer(value.size()), integer(0)});
  }
  uint64_t attribute(mlir::func::FuncOp fn, StringRef name, uint64_t fallback = 0) {
    auto value = fn->getAttrOfType<mlir::IntegerAttr>(name);
    return value ? value.getInt() : fallback;
  }
  Constant *functions() {
    std::vector<Constant *> values;
    for (auto fn : context.functions) {
      auto *id = hash(fn->getAttrOfType<mlir::StringAttr>("tsfg_core.function_id"));
      auto *signature = hash(fn->getAttrOfType<mlir::StringAttr>("tsfg_core.signature_hash"));
      auto *type = hash(fn->getAttrOfType<mlir::StringAttr>("tsfg_core.type_id"));
      std::vector<uint8_t> masks, parameters;
      if (!id || !signature || !type || !parameterPresence(fn, masks)) return nullptr;
      for (auto parameter : fn.getArgumentTypes()) parameters.push_back(typeCode(parameter));
      uint64_t registers = 0, instructions = 0;
      for (auto &block : fn.getBody()) {
        registers += block.getNumArguments();
        for (auto &op : block) { registers += op.getNumResults(); ++instructions; }
      }
      if (registers > 4096 || instructions > UINT16_MAX || fn.getBody().getBlocks().size() > UINT16_MAX) return nullptr;
      auto name = fn->getAttrOfType<mlir::StringAttr>("tsfg_core.logical_name");
      auto initializing = fn->getAttrOfType<mlir::BoolAttr>("tsfg_core.initializer");
      const bool initializer = initializing && initializing.getValue();
      values.push_back(ConstantStruct::get(function, {id, signature, type,
          text(name ? name.getValue() : fn.getSymName()), integer(attribute(fn, "tsfg_core.source_index")),
          integer(attribute(fn, "tsfg_core.function_start")), integer(attribute(fn, "tsfg_core.function_end")),
          integer(registers, i16), integer(instructions, i16), integer(fn.getBody().getBlocks().size(), i16),
          integer(typeCode(fn.getFunctionType().getResult(0)), i8), integer(initializer, i8),
          integer(parameters.size(), i16), integer(masks.size(), i16), bytes(parameters), bytes(masks)}));
    }
    return array(function, values);
  }
  Constant *sources() {
    std::vector<Constant *> values;
    for (const auto &item : context.tables.sources)
      values.push_back(ConstantStruct::get(source, {text(item.path), hash(item.hash), integer(item.length), integer(0)}));
    return array(source, values);
  }
  Constant *modules() {
    std::vector<Constant *> values;
    for (size_t index = 0; index < context.tables.modules.size(); ++index) {
      const auto &item = context.tables.modules[index];
      std::vector<Constant *> dependencies;
      for (auto dependency : item.dependencies) dependencies.push_back(integer(dependency, i16));
      values.push_back(ConstantStruct::get(module, {hash(item.id), integer(item.source), integer(item.initializer),
          integer(dependencies.size()), integer(context.tables.plan.modules[index]), array(i16, dependencies)}));
    }
    return array(module, values);
  }
  Constant *globals() {
    std::vector<Constant *> values;
    for (const auto &item : context.tables.globals)
      values.push_back(ConstantStruct::get(global, {hash(item.id), text(item.name), integer(item.source),
          integer(item.start), integer(item.end), integer(item.type, i8), integer(item.writable, i8),
          integer(item.generated, i8), integer(0, i8)}));
    return array(global, values);
  }
  Constant *hosts() {
    std::vector<Constant *> values;
    for (size_t index = 0; index < context.tables.hosts.size(); ++index) {
      const auto &item = context.tables.hosts[index];
      values.push_back(ConstantStruct::get(host, {hash(item.id), hash(item.signature), text(item.name), integer(item.source),
          integer(item.capability), integer(item.start), integer(item.end), integer(context.tables.plan.hosts[index]), integer(0)}));
    }
    return array(host, values);
  }
  Constant *roots() {
    std::vector<Constant *> values;
    for (const auto &item : context.tables.roots)
      values.push_back(ConstantStruct::get(root, {integer(item.kind), integer(item.source), integer(item.function), integer(0), text(item.name)}));
    return array(root, values);
  }
public:
  explicit ProgramMetadata(ModuleAotContext &input) : context(input), c(input.native.getContext()),
      i8(Type::getInt8Ty(c)), i16(Type::getInt16Ty(c)), i32(Type::getInt32Ty(c)),
      ptr(PointerType::getUnqual(c)), digest(ArrayType::get(i8, 32)) {
    span = StructType::get(c, {ptr, i32, i32});
    source = StructType::get(c, {span, digest, i32, i32});
    function = StructType::get(c, {digest, digest, digest, span, i32, i32, i32, i16, i16, i16, i8, i8, i16, i16, ptr, ptr});
    module = StructType::get(c, {digest, i32, i32, i32, i32, ptr});
    global = StructType::get(c, {digest, span, i32, i32, i32, i8, i8, i8, i8});
    host = StructType::get(c, {digest, digest, span, i32, i32, i32, i32, i32, i32});
    root = StructType::get(c, {i32, i32, i32, i32, span});
    program = StructType::get(c, {i32, i32, digest, digest, i32, i32, i32, i32, i32, i32, i32, i32, ptr, ptr, ptr, ptr, ptr, ptr, ptr});
  }
  bool emit() {
    if (context.native.getNamedValue("tsfg_aot_program_v1")) return false;
    auto *input = hash(context.core->getAttrOfType<mlir::StringAttr>("tsfg_core.input_identity"));
    auto *allFunctions = functions();
    if (!input || !allFunctions) return false;
    std::vector<Constant *> initialization;
    for (auto index : context.tables.initialization) initialization.push_back(integer(index, i16));
    auto *value = ConstantStruct::get(program, {integer(TSFG_AOT_PROGRAM_VERSION), integer(sizeof(TsfgAotProgramV1)),
        hash(context.identity), input, integer(context.functions.size()), integer(context.tables.sources.size()),
        integer(context.tables.modules.size()), integer(context.tables.globals.size()), integer(context.tables.hosts.size()),
        integer(context.tables.roots.size()), integer(initialization.size()), integer(0),
        allFunctions, sources(), modules(), globals(), hosts(), roots(), array(i16, initialization)});
    new GlobalVariable(context.native, program, true, GlobalValue::ExternalLinkage, value, "tsfg_aot_program_v1");
    return true;
  }
};
} // namespace
bool materializeProgramMetadata(ModuleAotContext &context) { return ProgramMetadata(context).emit(); }
bool verifyProgramMetadataLayout(const llvm::Module &module) {
  auto *global = module.getGlobalVariable("tsfg_aot_program_v1");
  if (!global) return true;
  const auto &layout = module.getDataLayout();
  auto *program = llvm::dyn_cast<llvm::StructType>(global->getValueType());
  if (!program || layout.getTypeAllocSize(program).getFixedValue() != sizeof(TsfgAotProgramV1)
      || layout.getABITypeAlign(program).value() != alignof(TsfgAotProgramV1)
      || layout.getStructLayout(program)->getElementOffset(12) != offsetof(TsfgAotProgramV1, functions)) return false;
  const auto *value = llvm::dyn_cast<llvm::ConstantStruct>(global->getInitializer());
  const uint64_t sizes[] = {sizeof(TsfgAotFunctionV1), sizeof(TsfgAotSourceV1), sizeof(TsfgAotModuleV1),
      sizeof(TsfgAotGlobalV1), sizeof(TsfgAotHostV1), sizeof(TsfgAotRootV1)};
  for (unsigned index = 0; index < 6; ++index) {
    auto *array = llvm::dyn_cast<llvm::GlobalVariable>(value->getOperand(12 + index));
    if (!array) continue;
    auto *type = llvm::dyn_cast<llvm::ArrayType>(array->getValueType());
    if (!type || layout.getTypeAllocSize(type->getElementType()).getFixedValue() != sizes[index]
        || layout.getABITypeAlign(type->getElementType()).value() != 8) return false;
  }
  return true;
}
} // namespace tsfg
