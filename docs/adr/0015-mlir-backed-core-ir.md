---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# 用 MLIR 基础设施承载正式 Core IR

用户于 2026-09-30 接受 R03 Q4：中端采用 C++，复用 MLIR 的 SSA、验证、打印、序列化与 pass 基础设施承载自有 Core IR 语义，HIR 保留独立高层职责；以提前完成 R02a MLIR/LLVM 源码准入及维护编译器依赖的成本，换取通用 IR 基础设施复用。R03 的语义归一化和 R07 的后端 lowering 是不同阶段，即使都使用 MLIR 也不能混同；VM/AOT 共同消费已验证的 tsfg 语义，发布 Runtime 仍不携带 MLIR/LLVM，MLIR 序列化也不构成游戏字节码。

选择独立数据结构与自有通用 pass/verifier 框架可以推迟 MLIR 依赖，但需维护另一套基础设施；本决定选择正式共享框架，不减少 tsfg 特化、借用、效果、异常、数值和预算语义的实现及验收责任。当前已有 LLVM 工具归档不能证明源码准入完成，具体源码、配置与消费证明仍按 R02a 实施；详见 [R03 规范](../r03-ir-normalization.md)。
