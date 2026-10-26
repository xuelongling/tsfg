# SPDX-License-Identifier: MIT
cmake_minimum_required(VERSION 3.20)
project(tsfg-core-ir LANGUAGES C CXX)

set(TSFG_CORE_BUILD_ROLE "native" CACHE STRING "Core command build responsibility")
if(NOT TSFG_CORE_BUILD_ROLE STREQUAL "native" AND NOT TSFG_CORE_BUILD_ROLE STREQUAL "static")
  message(FATAL_ERROR "Core build role must be native or static")
endif()
if(TSFG_CORE_BUILD_ROLE STREQUAL "static" AND
   (LLVM_TARGETS_TO_BUILD OR LLVM_EXPERIMENTAL_TARGETS_TO_BUILD OR TSFG_VERIFIED_SOURCE_SDK))
  message(FATAL_ERROR "Static Core requires an independent direct-source build without LLVM backends")
endif()

# The optional SDK boundary is qualified by the formal HBE before CMake. It
# imports only the exact read-only source-built packages; no ambient package
# search or alternative compiler is allowed. All new outputs use this build.
if(TSFG_VERIFIED_SOURCE_SDK)
  find_package(LLVM REQUIRED CONFIG PATHS
    "${TSFG_VERIFIED_SOURCE_SDK}/build/lib/cmake/llvm" NO_DEFAULT_PATH)
  find_package(MLIR REQUIRED CONFIG PATHS
    "${TSFG_VERIFIED_SOURCE_SDK}/build/lib/cmake/mlir" NO_DEFAULT_PATH)
  set(LLVM_MAIN_SRC_DIR "${TSFG_VERIFIED_SOURCE_SDK}/source/llvm")
  set(LLVM_BINARY_DIR "${TSFG_VERIFIED_SOURCE_SDK}/build")
  list(APPEND CMAKE_MODULE_PATH "${LLVM_BINARY_DIR}/lib/cmake/llvm")
  include(AddLLVM)
  separate_arguments(_tsfg_sdk_definitions NATIVE_COMMAND "${LLVM_DEFINITIONS}")
  add_definitions(${_tsfg_sdk_definitions} -DLLVM_BUILD_STATIC -D_HAS_EXCEPTIONS=0)
  set(LLVM_RUNTIME_OUTPUT_INTDIR "${CMAKE_BINARY_DIR}/bin")
  set(LLVM_LIBRARY_OUTPUT_INTDIR "${CMAKE_BINARY_DIR}/lib")
endif()

# Every build uses either the admitted source or its exact qualified SDK.
if(NOT LLVM_MAIN_SRC_DIR OR NOT LLVM_BINARY_DIR)
  message(FATAL_ERROR "tsfg Core IR requires the admitted LLVM/MLIR source build")
endif()

# Compiler-side policy: import the two system DLLs normally. The fixed source
# enables delay loading as a startup optimization, while the admitted tool tree
# does not contain delayimp.lib. Preserve both ordinary imports and remove only
# the entire, exact fixed-source optimization from both static link properties.
if(WIN32 AND MSVC)
  if(NOT TARGET LLVMSupport)
    message(FATAL_ERROR "tsfg import policy requires the admitted LLVMSupport target")
  endif()
  set(_tsfg_link_wrapper "$<$<OR:$<LINK_LANG_AND_ID:C,IntelLLVM>,$<LINK_LANG_AND_ID:CXX,IntelLLVM>,$<LINK_LANG_AND_ID:Fortran,IntelLLVM>>:-Qoption,link,>")
  set(_tsfg_delay_load "$<$<NOT:$<LINK_LANGUAGE:Swift>>:delayimp;${_tsfg_link_wrapper}-delayload:shell32.dll;${_tsfg_link_wrapper}-delayload:ole32.dll>")
  if(TSFG_VERIFIED_SOURCE_SDK)
    # The actual original export has already applied the full ordinary-import
    # policy. Verify that exact observed property; never edit the SDK exports.
    get_target_property(_tsfg_imported LLVMSupport IMPORTED)
    get_target_property(_tsfg_interface LLVMSupport INTERFACE_LINK_LIBRARIES)
    if(NOT _tsfg_imported OR NOT _tsfg_interface STREQUAL "psapi;shell32;ole32;uuid;advapi32;ws2_32;ntdll;LLVMDemangle")
      message(FATAL_ERROR "tsfg SDK import policy found an unrecognized export")
    endif()
    file(WRITE "${CMAKE_BINARY_DIR}/tsfg-core-ir-import-policy.txt"
      "SDK ordinary-imports=${_tsfg_interface}\n")
  else()
    foreach(_tsfg_property LINK_LIBRARIES INTERFACE_LINK_LIBRARIES)
      get_target_property(_tsfg_original LLVMSupport ${_tsfg_property})
      string(FIND "${_tsfg_original}" "${_tsfg_delay_load}" _tsfg_position)
      if(_tsfg_position EQUAL -1)
        message(FATAL_ERROR "tsfg import policy found an unrecognized ${_tsfg_property}")
      endif()
      string(REPLACE "${_tsfg_delay_load}" "" _tsfg_remaining "${_tsfg_original}")
      string(FIND "${_tsfg_remaining}" "delayimp" _tsfg_residual_library)
      string(FIND "${_tsfg_remaining}" "-delayload:" _tsfg_residual_flag)
      if(NOT _tsfg_residual_library EQUAL -1 OR NOT _tsfg_residual_flag EQUAL -1)
        message(FATAL_ERROR "tsfg import policy found additional delay-load requirements")
      endif()
      foreach(_tsfg_import shell32 ole32)
        list(FIND _tsfg_remaining "${_tsfg_import}" _tsfg_import_position)
        if(_tsfg_import_position EQUAL -1)
          message(FATAL_ERROR "tsfg import policy lost the ordinary ${_tsfg_import} import")
        endif()
     endforeach()
    set_property(TARGET LLVMSupport PROPERTY ${_tsfg_property} "${_tsfg_remaining}")
    file(APPEND "${CMAKE_BINARY_DIR}/tsfg-core-ir-import-policy.txt"
      "${_tsfg_property}\noriginal=${_tsfg_original}\nordinary-imports=${_tsfg_remaining}\n")
   endforeach()
  endif()
endif()
set(CMAKE_CXX_STANDARD 17)
include_directories(${LLVM_INCLUDE_DIRS}
  ${LLVM_MAIN_SRC_DIR}/../mlir/include
  ${LLVM_BINARY_DIR}/tools/mlir/include)
# Both tools compile the exact same dialect, complete verifier and wire
# implementation. Native lowering/target initialization is a separate adapter.
add_library(tsfg-core-common OBJECT
  dialect.cpp bytecode.cpp bytecode_encoding.cpp module.cpp
  module-plan.cpp core-verify.cpp finite-domain.cpp finite-fields.cpp
  common-program.cpp common-program-read.cpp common-program-relations.cpp common-program-shape.cpp common-program-json.cpp
  common-program-identities.cpp common-program-projection.cpp common-program-syntax.cpp
  common-program-source.cpp common-program-callable-source.cpp common-program-callable-targets.cpp common-program-callable-ops.cpp common-program-declarations.cpp common-program-modules.cpp
  common-program-bodies.cpp common-program-statements.cpp common-program-expressions.cpp
  common-program-effects.cpp common-program-environments.cpp common-program-environment-ops.cpp common-program-publication.cpp common-program-kernel.cpp
  common-program-types.cpp common-program-graph.cpp common-program-abstract.cpp
  common-program-plan.cpp common-program-leaves.cpp common-program-control.cpp
  common-program-match.cpp common-program-memory.cpp common-program-methods.cpp common-program-transfer.cpp
  common-program-capacity.cpp common-program-flow.cpp
  common-program-borrows.cpp common-program-retention.cpp
  finite-module.cpp finite-catalog.cpp finite-constructor-writes.cpp finite-control-paths.cpp finite-domains.cpp finite-dense-length.cpp finite-abi.cpp finite-entry.cpp finite-entry-arrays.cpp finite-entry-cells.cpp finite-values.cpp finite-members.cpp finite-flow.cpp finite-return-alias.cpp finite-memory.cpp finite-memory-entries.cpp finite-memory-flow.cpp finite-memory-frames.cpp finite-memory-indices.cpp finite-memory-sources.cpp finite-memory-span-sources.cpp finite-memory-lifetime.cpp finite-actual-flow.cpp finite-array-call-effects.cpp finite-array-call-flow.cpp finite-array-flow.cpp finite-array-memory.cpp finite-array-memory-query.cpp finite-array-length.cpp finite-borrow-flow.cpp finite-borrow-storage.cpp finite-borrows.cpp finite-payload-flow.cpp
  kernel-access.cpp kernel-access-metadata.cpp
  nullable.cpp nullable-cfg.cpp nullable-metadata.cpp nullable-wire.cpp
  string.cpp string-formal.cpp string-verify.cpp string-wire.cpp
  array.cpp array-metadata.cpp array-verify.cpp array-view.cpp
  array-publication.cpp array-roots.cpp array-wire.cpp array-owner-json.cpp
  array-owner-canonical.cpp array-owner-schema.cpp array-owner-analysis.cpp array-owner-pairs.cpp
  array-owner-command.cpp reference-metadata.cpp reference-provenance.cpp reference.cpp
  reference-index.cpp reference-cfg.cpp reference-verify.cpp reference-construction.cpp reference-contracts.cpp
  reference-roots.cpp exception.cpp exception-json.cpp exception-source.cpp
  exception-provenance.cpp exception-hir.cpp exception-cfg.cpp exception-verify.cpp
  exception-command.cpp managed-cfg.cpp managed-liveness.cpp closure.cpp
  closure-metadata.cpp closure-identities.cpp closure-verify.cpp closure-cfg.cpp
  closure-roots.cpp closure-initialization.cpp closure-init-flow.cpp environment-contracts.cpp core-command.cpp
  formal-closure.cpp formal-closure-source.cpp formal-closure-targets.cpp
  formal-exception.cpp formal-exception-control.cpp formal-exception-values.cpp
  formal-exception-source.cpp formal-exception-hir.cpp formal-exception-text.cpp
  formal-exception-regions.cpp formal-exception-expressions.cpp
)
# Shared bytecode validation queries LLVM IR types and DataLayout directly.
# Propagate that dependency to both command adapters.
target_link_libraries(tsfg-core-common PUBLIC LLVMCore MLIRIR MLIRParser MLIRFuncDialect MLIRControlFlowDialect)
# AddLLVM inherits these variables from its caller. Keep the ordinary tool's
# component selection local so a parent project cannot select the LLVM umbrella
# or Native components. The full Native target retains its original scope.
function(add_tsfg_static_core_tool)
  set(USE_SHARED "")
  set(LLVM_LINK_COMPONENTS Support)
  # Each tool lists its own sources; this directory also holds common objects
  # and the other command adapter. Tell AddLLVM these are intentional subsets.
  add_llvm_executable(tsfg-core-static PARTIAL_SOURCES_INTENDED
    DISABLE_LLVM_LINK_LLVM_DYLIB static-main.cpp)
  target_link_libraries(tsfg-core-static PRIVATE tsfg-core-common)
endfunction()
add_tsfg_static_core_tool()
# The existing full compiler name and native capabilities remain unchanged.
if(TSFG_CORE_BUILD_ROLE STREQUAL "native")
add_llvm_executable(tsfg-core-ir PARTIAL_SOURCES_INTENDED
  aot-capability.cpp aot-module.cpp aot-program.cpp aot-module-services.cpp
  aot-module-entry.cpp aot-module-codec.cpp aot.cpp aot-lowering.cpp
  aot-float.cpp aot-fmod.cpp aot-fenv.cpp aot-conversions.cpp
  main.cpp native_cost.cpp
)
target_link_libraries(tsfg-core-ir PRIVATE tsfg-core-common
  MLIRArithDialect MLIRLLVMDialect MLIRArithToLLVM MLIRControlFlowToLLVM MLIRFuncToLLVM
  MLIRLLVMCommonConversion MLIRTransforms MLIRLLVMToLLVMIRTranslation
  MLIRBuiltinToLLVMIRTranslation MLIRTargetLLVMIRExport
  LLVMCore LLVMObject LLVMX86CodeGen LLVMX86Desc LLVMX86Info LLVMX86Disassembler LLVMX86AsmParser)
endif()
