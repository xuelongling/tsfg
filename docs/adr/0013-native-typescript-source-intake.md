---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# 从固定官方原生源码接入 TypeScript 前端

tsfg 采用与已定语言基线对应的官方 Go 原生前端源码，通过同级 Upstream Fork 与锁定 Toolchain Closure 接入，不以旧 TypeScript Compiler API 替代基线，也不等待未来公开 API。用户于 2026-09-10 接受 R02a Q1–Q4；工程授权边界见 [ECP-0003](../proposals/0003-native-typescript-source-intake.md)，具体来源身份与阶段验收见 [R02a 规范](../r02a-source-intake.md)。

该选择以维护 Go 构建闭包和必要的内部接口适配为代价，换取官方语义基线、可修改源码和可验证消费者的一致性。它不授权全量自建 parser、黑盒外部编译器或 JS 回退，也不要求整个 tsfg 编译器用 Go 实现。Go 只服务编译器侧，游戏发布运行时仍保持 Zig 边界；接口出口形态不在本决定中预先锁死。

后续 Q5–Q6 已确认在 fork 新特性分支直接修改必要源码，不强制仅新增 wrapper；保留分析/诊断所需的共享 printer 与包级构建依赖，通过真实消费边界隔离 JS 产品能力，而非先对上游全量瘦身。代价是必须维护明确准入清单、不可达性/产物检查与负例，不能只凭 noEmit 配置或未验证的链接器裁剪声称符合架构。
