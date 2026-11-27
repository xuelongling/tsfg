// SPDX-License-Identifier: MIT
#include "common20-gpu-source-lease.h"
#include <array>
#include <cstring>
#include <utility>

extern "C" {
struct TsfgCommon20GlobalWrite {
  uint8_t id[32];
  uint32_t i32_bits;
};

void *tsfg_common20_admit(
    const uint8_t *bytes_ptr,
    size_t bytes_len,
    const uint8_t *expected_input_id,
    const uint8_t *expected_scope_digest,
    const uint8_t *expected_published_digest);
void tsfg_common20_destroy(void *handle);
int32_t tsfg_common20_initialize(void *handle, uint64_t fuel_in, uint32_t depth_limit, uint64_t *fuel_out);
uint8_t tsfg_common20_status(const void *handle);
int32_t tsfg_common20_lease_acquire(void *handle);
void tsfg_common20_lease_release(void *handle);
int32_t tsfg_common20_read_global_i32(const void *handle, const uint8_t *id, uint32_t *out_bits);
int32_t tsfg_common20_validate_writable_globals(const void *handle, const uint8_t *ids, size_t count);
int32_t tsfg_common20_commit_globals_i32(void *handle, const TsfgCommon20GlobalWrite *writes, size_t count);
}

namespace tsfg::commonProgram {
namespace {

bool parseSha256Digest(llvm::StringRef text, std::array<uint8_t, 32> &out) {
  if (!text.starts_with("sha256:")) return false;
  llvm::StringRef hex = text.drop_front(7);
  if (hex.size() != 64) return false;
  auto nibble = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
  };
  for (size_t i = 0; i < 32; ++i) {
    int hi = nibble(hex[i * 2]);
    int lo = nibble(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = static_cast<uint8_t>((hi << 4) | lo);
  }
  return true;
}

class Common20ExclusiveLease final : public GpuSoftwareSourceLease {
public:
  Common20ExclusiveLease(
      void *handle,
      GpuCallIdentity identity,
      GpuHostBudget budget,
      std::vector<GpuHostValue> args,
      std::optional<uint32_t> *returnCellOut)
      : handle_(handle),
        identity_(std::move(identity)),
        budget_(budget),
        args_(std::move(args)),
        returnCellOut_(returnCellOut) {}

  ~Common20ExclusiveLease() override {
    if (handle_) tsfg_common20_lease_release(handle_);
  }

  const GpuCallIdentity &identity() const noexcept override { return identity_; }
  GpuHostBudget remainingBudget() const noexcept override { return budget_; }
  llvm::ArrayRef<GpuHostValue> evaluatedArguments() const noexcept override { return args_; }

  std::optional<GpuHostValue> readGlobal(llvm::StringRef globalId) const override {
    std::array<uint8_t, 32> raw{};
    if (!parseSha256Digest(globalId, raw)) return std::nullopt;
    uint32_t bits = 0;
    if (!tsfg_common20_read_global_i32(handle_, raw.data(), &bits)) return std::nullopt;
    return GpuHostValue{tsfg::exception::i32Id.str(), bits};
  }

  bool reserveOutputs(llvm::ArrayRef<const GpuDescriptor *> outputs) noexcept override {
    reservedGlobals_.clear();
    reservedReturn_ = false;
    std::vector<std::array<uint8_t, 32>> globalIds;
    for (const GpuDescriptor *desc : outputs) {
      if (!desc || desc->access == GpuResourceAccess::Read) return false;
      if (desc->kind == GpuResourceKind::Global) {
        std::array<uint8_t, 32> raw{};
        if (!parseSha256Digest(desc->id, raw)) return false;
        globalIds.push_back(raw);
        reservedGlobals_.push_back(desc->id);
      } else if (desc->kind == GpuResourceKind::Return) {
        if (reservedReturn_) return false;
        reservedReturn_ = true;
      } else {
        return false;
      }
    }
    if (!globalIds.empty()) {
      if (!tsfg_common20_validate_writable_globals(
              handle_, reinterpret_cast<const uint8_t *>(globalIds.data()), globalIds.size())) {
        reservedGlobals_.clear();
        reservedReturn_ = false;
        return false;
      }
    }
    return true;
  }

  bool publish(llvm::ArrayRef<GpuSoftwareOutput> outputs) noexcept override {
    std::vector<TsfgCommon20GlobalWrite> writes;
    writes.reserve(outputs.size());
    std::optional<uint32_t> retBits;
    for (const GpuSoftwareOutput &out : outputs) {
      if (out.descriptor.kind == GpuResourceKind::Global) {
        TsfgCommon20GlobalWrite w{};
        std::array<uint8_t, 32> raw{};
        if (!parseSha256Digest(out.descriptor.id, raw)) return false;
        std::memcpy(w.id, raw.data(), 32);
        w.i32_bits = out.bits;
        writes.push_back(w);
      } else if (out.descriptor.kind == GpuResourceKind::Return) {
        if (!reservedReturn_ || retBits.has_value()) return false;
        retBits = out.bits;
      } else {
        return false;
      }
    }
    if (writes.size() != reservedGlobals_.size()) return false;
    if (!writes.empty()) {
      if (!tsfg_common20_commit_globals_i32(handle_, writes.data(), writes.size())) return false;
    }
    if (returnCellOut_ && retBits.has_value()) *returnCellOut_ = *retBits;
    return true;
  }

private:
  void *handle_ = nullptr;
  GpuCallIdentity identity_;
  GpuHostBudget budget_;
  std::vector<GpuHostValue> args_;
  std::optional<uint32_t> *returnCellOut_ = nullptr;
  std::vector<std::string> reservedGlobals_;
  bool reservedReturn_ = false;
};

} // namespace

Common20Instance::Common20Instance(Common20Instance &&other) noexcept
    : handle_(std::exchange(other.handle_, nullptr)) {}

Common20Instance &Common20Instance::operator=(Common20Instance &&other) noexcept {
  if (this != &other) {
    if (handle_) tsfg_common20_destroy(handle_);
    handle_ = std::exchange(other.handle_, nullptr);
  }
  return *this;
}

Common20Instance::~Common20Instance() {
  if (handle_) tsfg_common20_destroy(handle_);
}

std::optional<Common20Instance> Common20Instance::admit(
    llvm::StringRef packetBytes,
    const GpuCallIdentity &expectedIdentity,
    std::string &errorOut) {
  std::array<uint8_t, 32> inputId{}, scopeDigest{}, publishedDigest{};
  if (!parseSha256Digest(expectedIdentity.inputIdentity, inputId) ||
      !parseSha256Digest(expectedIdentity.scopeDigest, scopeDigest) ||
      !parseSha256Digest(expectedIdentity.publishedDigest, publishedDigest)) {
    errorOut = "invalid sha256 identity format in admission request";
    return std::nullopt;
  }
  void *handle = tsfg_common20_admit(
      reinterpret_cast<const uint8_t *>(packetBytes.data()),
      packetBytes.size(),
      inputId.data(),
      scopeDigest.data(),
      publishedDigest.data());
  if (!handle) {
    errorOut = "Common20 formal admission rejected packet or identity mismatch";
    return std::nullopt;
  }
  return Common20Instance(handle);
}

bool Common20Instance::initialize(uint64_t fuelIn, uint32_t depthLimit, uint64_t &fuelRemainingOut) {
  if (!handle_) return false;
  return tsfg_common20_initialize(handle_, fuelIn, depthLimit, &fuelRemainingOut) == 0;
}

uint8_t Common20Instance::status() const noexcept {
  return tsfg_common20_status(handle_);
}

std::optional<uint32_t> Common20Instance::readGlobalI32(llvm::StringRef globalIdHex) const {
  if (!handle_) return std::nullopt;
  std::array<uint8_t, 32> raw{};
  if (!parseSha256Digest(globalIdHex, raw)) return std::nullopt;
  uint32_t bits = 0;
  if (!tsfg_common20_read_global_i32(handle_, raw.data(), &bits)) return std::nullopt;
  return bits;
}

std::unique_ptr<GpuSoftwareSourceLease> Common20Instance::createExclusiveLease(
    const GpuCallIdentity &identity,
    GpuHostBudget budget,
    std::vector<GpuHostValue> evaluatedArguments,
    std::optional<uint32_t> *returnCellOut) {
  if (!handle_ || !tsfg_common20_lease_acquire(handle_)) return nullptr;
  return std::make_unique<Common20ExclusiveLease>(
      handle_, identity, budget, std::move(evaluatedArguments), returnCellOut);
}

} // namespace tsfg::commonProgram
