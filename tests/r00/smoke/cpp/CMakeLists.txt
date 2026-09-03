# SPDX-License-Identifier: MIT

cmake_minimum_required(VERSION 4.4)
project(tsfg_r00_cpp_smoke LANGUAGES CXX)

set(CMAKE_CXX_SCAN_FOR_MODULES OFF)

add_executable(tsfg-r00-cpp-smoke main.cpp)
target_compile_features(tsfg-r00-cpp-smoke PRIVATE cxx_std_20)
target_compile_options(tsfg-r00-cpp-smoke PRIVATE -fno-exceptions -fno-rtti)
target_link_options(tsfg-r00-cpp-smoke PRIVATE -nostdlib++)
