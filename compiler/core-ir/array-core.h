// SPDX-License-Identifier: MIT
#pragma once
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/BuiltinAttributes.h"
#include "mlir/IR/TypeSupport.h"
#include "llvm/ADT/ArrayRef.h"
#include "llvm/ADT/StringRef.h"
#include <cstddef>
#include <cstdint>
#include <set>
#include <string>
#include <vector>
namespace mlir { class DialectRegistry; }
namespace tsfg::arrays {
inline constexpr llvm::StringLiteral schema =
    "sha256:7a1b9747e100cdc60119a37dbc31e477a5630f05b715a6f6a795a7573dd43f05";
inline constexpr llvm::StringLiteral f64Id =
    "sha256:dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c";
inline constexpr llvm::StringLiteral arrayId =
    "sha256:74dab77c8fbdacf6cf058e37cac033757417c808d57ee23a9c8866565202cb68";
inline constexpr llvm::StringLiteral u32Id =
    "sha256:b72109639ea1cc95816abe01a09e7e4c78c11902a1251c00090a5715cf9b979c";
inline constexpr llvm::StringLiteral readSpanId =
    "sha256:6130247c334f8a7ba10e89f40381e26b0877d57f96860df21befbe668bb6545e";
inline constexpr size_t byteLimit = 8388608;
class ArrayType : public mlir::Type::TypeBase<ArrayType, mlir::Type, mlir::TypeStorage> {
public:
  using Base::Base;
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(ArrayType)
  static constexpr llvm::StringLiteral name = "tsfg_array.array_f64";
  static ArrayType get(mlir::MLIRContext *context) { return Base::get(context); }
};
struct Range { uint32_t start = 0, end = 0; };
struct Parameter { std::string id, name; mlir::Type type; Range declaration, nameRange, annotation, elementAnnotation; };
struct Function {
  mlir::Operation *operation; Range declaration, name, annotation;
  std::vector<Parameter> parameters;
};
struct Metadata {
  std::string path, lengthProperty;
  uint32_t length = 0;
  std::vector<Function> functions;
  std::set<std::string> bindings, sites;
};
void registerDialect(mlir::DialectRegistry &registry);
bool usesCandidate(mlir::ModuleOp module);
bool fields(mlir::DictionaryAttr dictionary, llvm::ArrayRef<llvm::StringRef> names);
bool attributes(mlir::Operation *operation, llvm::ArrayRef<llvm::StringRef> names);
llvm::StringRef text(mlir::DictionaryAttr dictionary, llvm::StringRef name);
llvm::StringRef text(mlir::Operation *operation, llvm::StringRef name);
bool number(mlir::Attribute value, uint32_t &result);
bool span(mlir::Attribute value, Range &result, bool optional = false);
bool range(mlir::Operation *operation, Range &result);
bool encloses(Range outer, Range inner);
bool same(Range left, Range right);
bool validText(llvm::StringRef value);
std::string sourceIdentity(llvm::StringRef path, Range anchor, bool site = false);
mlir::LogicalResult reject(llvm::StringRef code, llvm::StringRef detail);
mlir::LogicalResult verifyMetadata(mlir::ModuleOp module, Metadata &metadata);
mlir::LogicalResult verifyCandidate(mlir::ModuleOp module);
} // namespace tsfg::arrays
