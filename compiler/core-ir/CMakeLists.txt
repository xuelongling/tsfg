# SPDX-License-Identifier: MIT
cmake_minimum_required(VERSION 3.20)
project(tsfg-core-ir LANGUAGES C CXX)

# This target is an LLVM external project, built from the admitted source tree.
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
set(CMAKE_CXX_STANDARD 17)
include_directories(${LLVM_INCLUDE_DIRS}
  ${LLVM_MAIN_SRC_DIR}/../mlir/include
  ${LLVM_BINARY_DIR}/tools/mlir/include)
add_llvm_executable(tsfg-core-ir main.cpp module.cpp)
target_link_libraries(tsfg-core-ir PRIVATE MLIRIR MLIRParser MLIRFuncDialect MLIRControlFlowDialect LLVMCore)
