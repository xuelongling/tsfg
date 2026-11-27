// SPDX-License-Identifier: MIT
#pragma once
#include "gpu-software-vulkan-consumer.h"
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace tsfg::commonProgram {

// RAII owner of a formally admitted and initialized Zig Common20 runtime instance.
// Provides exclusive GpuSoftwareSourceLease handles bound to this live instance so
// software Vulkan execution reads real globals, checks real budget, and atomically
// writes back committed outputs into the same instance.
class Common20Instance {
public:
  Common20Instance(Common20Instance &&other) noexcept;
  Common20Instance &operator=(Common20Instance &&other) noexcept;
  Common20Instance(const Common20Instance &) = delete;
  Common20Instance &operator=(const Common20Instance &) = delete;
  ~Common20Instance();

  static std::optional<Common20Instance> admit(
      llvm::StringRef packetBytes,
      const GpuCallIdentity &expectedIdentity,
      std::string &errorOut);

  bool initialize(uint64_t fuelIn, uint32_t depthLimit, uint64_t &fuelRemainingOut);
  uint8_t status() const noexcept;
  std::optional<uint32_t> readGlobalI32(llvm::StringRef globalIdHex) const;

  std::unique_ptr<GpuSoftwareSourceLease> createExclusiveLease(
      const GpuCallIdentity &identity,
      GpuHostBudget budget,
      std::vector<GpuHostValue> evaluatedArguments,
      std::optional<uint32_t> *returnCellOut = nullptr);

  void *rawHandle() const noexcept { return handle_; }

private:
  explicit Common20Instance(void *handle) noexcept : handle_(handle) {}
  void *handle_ = nullptr;
};

} // namespace tsfg::commonProgram
