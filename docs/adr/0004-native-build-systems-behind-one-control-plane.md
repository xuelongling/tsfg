---
status: accepted
---

# 用统一控制面编排原生构建系统

`repo` 只负责物化多仓，`tsfg` 提供唯一公开的跨平台 prefetch、verify-workspace、build、test、package 与 repro-check 控制面，内部调用内容锁定的 Node 包管理器、`zig build`、CMake presets/toolchain files 与 Ninja；Bazel、Nix 和容器不构成规范性构建接口。Zig 编译 Zig 源码，Clang/LLD 编译 C/C++、LLVM/MLIR 并形成 ABI 基线；目标 SDK/sysroot 也属于闭包。具体 patch 版本属于 R00 章程和 `toolchains.lock.json`，不在 ADR 重复。每个分发物的内容摘要与解包 tree hash、每个权威 dependency-lock 的摘要进入 target-specific Toolchain Closure projection，经 JCS 形成完整 digest；URL/mirror 不是身份，系统 PATH 不提供回退。

`debug` 映射到 Zig Debug 与 C/C++ `-O0`，保留断言、安全检查和完整调试信息；`release` 映射到 Zig ReleaseSafe 与 C/C++ `-O2`，保留边界/安全检查并同时生成 detached symbols。两种 profile 均禁止 LTO、PGO、fast-math 和 `-march=native`。`cl/link` 使用已锁定 MSVC closure 做兼容性 CI；R00 不启用未锁定的 GCC，后续若启用必须先把它作为独立 Toolchain Closure 纳入。这保持 LLVM/MLIR 的正式 CMake 路径并统一两类 Tier 1 ABI，代价是 tsfg 必须自行维护工具闭包、环境净化与跨构建系统的失败语义。

所有控制面子命令支持 `--report <path>`，原子写入版本化 JCS-compatible Build Report，人类日志写 stderr。稳定退出类别为 2 usage/config、10 workspace mismatch、11 lock/integrity、12 offline input missing、20 build、21 test/compatibility、22 package、23 reproducibility mismatch、30 internal；输出先写临时目录，成功后原子发布，失败不得留下可误认为有效的 package。R00 不启用遥测。
