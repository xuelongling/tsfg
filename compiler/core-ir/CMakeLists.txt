# SPDX-License-Identifier: MIT
cmake_minimum_required(VERSION 3.20)
project(tsfg-core-ir LANGUAGES C CXX)

set(TSFG_CORE_BUILD_ROLE "native" CACHE STRING "Core command build responsibility")
if(NOT TSFG_CORE_BUILD_ROLE STREQUAL "native" AND NOT TSFG_CORE_BUILD_ROLE STREQUAL "static" AND
   NOT TSFG_CORE_BUILD_ROLE STREQUAL "metadata-models" AND NOT TSFG_CORE_BUILD_ROLE STREQUAL "gpu-function-resource-ir")
  message(FATAL_ERROR "Core build role must be native, static, metadata-models or gpu-function-resource-ir")
endif()
if(TSFG_CORE_BUILD_ROLE STREQUAL "metadata-models" AND NOT TSFG_VERIFIED_SOURCE_SDK)
  message(FATAL_ERROR "Metadata models require the independently qualified locked LLVM/MLIR SDK")
endif()
if(TSFG_CORE_BUILD_ROLE STREQUAL "static" AND
   (LLVM_TARGETS_TO_BUILD OR LLVM_EXPERIMENTAL_TARGETS_TO_BUILD OR TSFG_VERIFIED_SOURCE_SDK))
  message(FATAL_ERROR "Static Core requires an independent direct-source build without LLVM backends")
endif()

# One source catalog feeds target selection, staging and consumer freshness.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/sources.json" _tsfg_core_manifest)
function(read_tsfg_core_sources role output)
  string(JSON _tsfg_count LENGTH "${_tsfg_core_manifest}" ${role} sources)
  math(EXPR _tsfg_last "${_tsfg_count} - 1")
  set(_tsfg_sources)
  foreach(_tsfg_index RANGE ${_tsfg_last})
    string(JSON _tsfg_source GET "${_tsfg_core_manifest}" ${role} sources ${_tsfg_index})
    list(APPEND _tsfg_sources "${_tsfg_source}")
  endforeach()
  set(${output} "${_tsfg_sources}" PARENT_SCOPE)
endfunction()

if(TSFG_CORE_BUILD_ROLE STREQUAL "gpu-function-resource-ir")
  if(TSFG_VERIFIED_SOURCE_SDK OR NOT TSFG_GPU_COMPONENT_CONFIGURATION)
    message(FATAL_ERROR "GPU function IR requires its independently authenticated component configuration")
  endif()
  file(READ "${TSFG_GPU_COMPONENT_CONFIGURATION}" _tsfg_gpu_configuration)
  string(JSON _tsfg_gpu_role GET "${_tsfg_gpu_configuration}" role)
  string(JSON _tsfg_gpu_include_count LENGTH "${_tsfg_gpu_configuration}" includeDirectories)
  string(JSON _tsfg_gpu_archive_count LENGTH "${_tsfg_gpu_configuration}" archives)
  if(NOT _tsfg_gpu_role STREQUAL "gpu-function-resource-ir" OR NOT _tsfg_gpu_include_count EQUAL 4 OR NOT _tsfg_gpu_archive_count EQUAL 46)
    message(FATAL_ERROR "GPU component configuration has another role or input inventory")
  endif()
  set(CMAKE_CXX_STANDARD 17)
  read_tsfg_core_sources(common _tsfg_gpu_common)
  read_tsfg_core_sources(gpu-function-resource-ir _tsfg_gpu_source)
  add_library(tsfg-gpu-function-ir STATIC ${_tsfg_gpu_common} ${_tsfg_gpu_source})
  set_target_properties(tsfg-gpu-function-ir PROPERTIES ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")
  target_include_directories(tsfg-gpu-function-ir PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
  foreach(_tsfg_index RANGE 0 3)
    string(JSON _tsfg_include GET "${_tsfg_gpu_configuration}" includeDirectories ${_tsfg_index})
    target_include_directories(tsfg-gpu-function-ir PUBLIC "${_tsfg_include}")
  endforeach()
  set(_tsfg_gpu_libraries)
  foreach(_tsfg_index RANGE 0 45)
    string(JSON _tsfg_archive GET "${_tsfg_gpu_configuration}" archives ${_tsfg_index} absolute)
    add_library(tsfg_gpu_archive_${_tsfg_index} STATIC IMPORTED)
    set_target_properties(tsfg_gpu_archive_${_tsfg_index} PROPERTIES IMPORTED_LOCATION "${_tsfg_archive}")
    list(APPEND _tsfg_gpu_libraries tsfg_gpu_archive_${_tsfg_index})
  endforeach()
  target_compile_definitions(tsfg-gpu-function-ir PUBLIC LLVM_BUILD_STATIC _HAS_EXCEPTIONS=0 UNICODE _UNICODE
    _CRT_NONSTDC_NO_DEPRECATE _CRT_NONSTDC_NO_WARNINGS _CRT_SECURE_NO_DEPRECATE _CRT_SECURE_NO_WARNINGS
    _GLIBCXX_ASSERTIONS _SCL_SECURE_NO_DEPRECATE _SCL_SECURE_NO_WARNINGS
    __STDC_CONSTANT_MACROS __STDC_FORMAT_MACROS __STDC_LIMIT_MACROS)
  target_link_libraries(tsfg-gpu-function-ir PUBLIC ${_tsfg_gpu_libraries})
  option(TSFG_BUILD_SOFTWARE_VULKAN_CONSUMER "Build the separate external software-device acceptance library" OFF)
  if(TSFG_BUILD_SOFTWARE_VULKAN_CONSUMER)
    # The caller owns the prospective input declaration and fixed Khronos
    # Headers qualification. The ordinary IR build leaves this off.
    if(NOT TSFG_GPU_SOFTWARE_HEADERS_INCLUDE_DIRECTORY OR
       NOT EXISTS "${TSFG_GPU_SOFTWARE_HEADERS_INCLUDE_DIRECTORY}/vulkan/vulkan_core.h")
      message(FATAL_ERROR "Software Vulkan consumer requires qualified fixed Khronos Headers")
    endif()
    add_library(tsfg-gpu-software-vulkan-consumer STATIC ../gpu-software-vulkan-consumer.cpp ../gpu-software-vulkan-consumer.h)
    target_include_directories(tsfg-gpu-software-vulkan-consumer PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/.."
      PRIVATE "${TSFG_GPU_SOFTWARE_HEADERS_INCLUDE_DIRECTORY}")
    target_link_libraries(tsfg-gpu-software-vulkan-consumer PUBLIC tsfg-gpu-function-ir PRIVATE kernel32 advapi32)
    set_target_properties(tsfg-gpu-software-vulkan-consumer PROPERTIES ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")
  endif()
  # No LLVM/MLIR export or generic Core command/native source is selected here.
  return()
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
      file(APPEND "${LLVM_BINARY_DIR}/tsfg-core-ir-import-policy.txt"
        "${_tsfg_property}\noriginal=${_tsfg_original}\nordinary-imports=${_tsfg_remaining}\n")
    endforeach()
  endif()
endif()
set(CMAKE_CXX_STANDARD 17)
include_directories(${LLVM_INCLUDE_DIRS}
  ${LLVM_MAIN_SRC_DIR}/../mlir/include
  ${LLVM_BINARY_DIR}/tools/mlir/include)
read_tsfg_core_sources(common _tsfg_core_common)
if(TSFG_CORE_BUILD_ROLE STREQUAL "metadata-models")
  # This host test supplies its own main. Neither production command entry nor
  # any source from the native responsibility belongs to this target.
  set(_tsfg_core_entry "${CMAKE_CURRENT_SOURCE_DIR}/../../tests/r03/common-program-constructor-projection-models.cpp")
else()
  read_tsfg_core_sources(${TSFG_CORE_BUILD_ROLE} _tsfg_core_entry)
endif()
set(_tsfg_core_libraries
  MLIRIR MLIRParser MLIRFuncDialect MLIRControlFlowDialect
  MLIRArithDialect MLIRSCFDialect MLIRMemRefDialect
  MLIRSCFToControlFlow MLIRArithToLLVM MLIRMemRefToLLVM MLIRFuncToLLVM
  MLIRControlFlowToLLVM MLIRReconcileUnrealizedCasts MLIRLLVMDialect
  MLIRTargetLLVMIRExport MLIRBuiltinToLLVMIRTranslation
  MLIRLLVMToLLVMIRTranslation LLVMAsmParser LLVMCore)
add_library(tsfg-core-common OBJECT ${_tsfg_core_common})
target_include_directories(tsfg-core-common PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(tsfg-core-common PUBLIC ${_tsfg_core_libraries})
if(TSFG_CORE_BUILD_ROLE STREQUAL "metadata-models")
  # A separate metadata-only test responsibility, not a production Core command
  # role or SDK admission path. Its invoker must qualify the SDK/toolchain and
  # current catalog + test source before supplying this executable to Node.
  function(add_tsfg_metadata_models target entry)
    set(USE_SHARED "")
    set(LLVM_LINK_COMPONENTS Support)
    add_llvm_executable(${target} PARTIAL_SOURCES_INTENDED
      DISABLE_LLVM_LINK_LLVM_DYLIB ${entry})
    target_include_directories(${target} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
    target_link_libraries(${target} PRIVATE tsfg-core-common)
  endfunction()
  add_tsfg_metadata_models(tsfg-common-metadata-models "${_tsfg_core_entry}")
  add_tsfg_metadata_models(tsfg-method-minarity-metadata
    "${CMAKE_CURRENT_SOURCE_DIR}/../../tests/r03/method-minarity-complete-literals.cpp")
  add_tsfg_metadata_models(tsfg-ordinary-fdi-metadata
    "${CMAKE_CURRENT_SOURCE_DIR}/../../tests/r03/ordinary-fdi-complete-literals.cpp")
elseif(TSFG_CORE_BUILD_ROLE STREQUAL "static")
  # The static role has no native adapter in its source or link graph.
  function(add_tsfg_static_core_tool)
    set(USE_SHARED "")
    set(LLVM_LINK_COMPONENTS Support)
    add_llvm_executable(tsfg-core-static PARTIAL_SOURCES_INTENDED
      DISABLE_LLVM_LINK_LLVM_DYLIB ${_tsfg_core_entry})
    target_link_libraries(tsfg-core-static PRIVATE tsfg-core-common)
  endfunction()
  add_tsfg_static_core_tool()
else()
  add_llvm_executable(tsfg-core-ir PARTIAL_SOURCES_INTENDED ${_tsfg_core_entry})
  target_link_libraries(tsfg-core-ir PRIVATE tsfg-core-common
    MLIRLLVMCommonConversion MLIRTransforms LLVMObject LLVMX86CodeGen LLVMX86Desc LLVMX86Info LLVMX86Disassembler LLVMX86AsmParser)
endif()
