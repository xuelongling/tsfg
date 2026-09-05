# SPDX-License-Identifier: MIT

cmake_minimum_required(VERSION 4.4)
project(tsfg_r00_cpp_smoke LANGUAGES CXX)

set(CMAKE_CXX_SCAN_FOR_MODULES OFF)
if(NOT TSFG_R00_SIMD_DISPATCH_RUNTIME MATCHES "^[01]$")
  message(FATAL_ERROR "TSFG_R00_SIMD_DISPATCH_RUNTIME must be 0 or 1")
endif()

add_executable(tsfg-r00-cpp-smoke main.cpp)
target_compile_features(tsfg-r00-cpp-smoke PRIVATE cxx_std_20)
target_compile_definitions(
  tsfg-r00-cpp-smoke
  PRIVATE TSFG_R00_SIMD_DISPATCH_RUNTIME=${TSFG_R00_SIMD_DISPATCH_RUNTIME}
)
if(MSVC)
  target_compile_options(tsfg-r00-cpp-smoke PRIVATE /EHs-c- /GR- /Brepro)
else()
  target_compile_options(tsfg-r00-cpp-smoke PRIVATE -fno-exceptions -fno-rtti)
endif()
target_link_options(tsfg-r00-cpp-smoke PRIVATE -nostdlib++)
