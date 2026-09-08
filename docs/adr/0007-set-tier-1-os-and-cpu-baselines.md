---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# 固定 Tier 1 OS、ABI 与 CPU 基线

适用范围更新（2026-09-07）：本决定的历史正文保留；[ECP-0001](../proposals/0001-windows-first-development.md) 修订开发/认证阶段及未发布开发格式的兼容范围。R00 采用 Windows 本机 Development Ready，不要求最低 OS/双 VM/首次 Stable；已受支持版本、发布隔离、身份与 Owner 安全规则仍按其适用范围执行。以现行 Roadmap 和工程章程判定当前验收，勿将下文原阶段描述作为新增执行指令。

R00 的 Tier 1 目标固定为 `windows-x86_64-msvc` 与 `linux-x86_64-gnu`。Windows 最低支持 Windows 11 24H2 并以 Windows SDK 26100 为 ABI 基线，Windows 10 仅作 best-effort；Linux 以 Debian 12/glibc 2.36、Linux kernel 6.1 为最低 ABI 基线，允许在更新发行版运行。两者的 CPU 基线统一为 `x86-64-v2`，AVX、AVX2、AVX-512 等更高能力必须通过运行时检测和多版本分派使用，禁止按构建主机生成指令。该范围舍弃已停止常规支持的旧 OS 与不具备 x86-64-v2 的旧硬件，换取更小的支持矩阵、仍受 LTS 覆盖的 Linux 基线和跨平台一致的最低 CPU 能力；新增或下调平台基线必须经过变更提案并更新兼容承诺。
