---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# 请求终止不继续执行用户 finally

用户于 2026-09-30 接受 R03 Q7：Managed Exception 继续沿用 TypeScript 的 catch/finally 行为；语义 trap（含 Semantic Fuel 或调用深度耗尽）与 Execution Abort 终止本次请求，不进入语言 catch，也不继续执行用户 finally。相对于在资源失败后继续执行任意用户清理代码，此选择保持请求终止和预算的确定边界，代价是程序不能依赖 finally 在这些终止下完成业务效果；Runtime 仍须清理自身必要的帧、GC 根、借用与宿主边界资源，且不承诺回滚先前效果。

R03 显式区分语言异常和请求终止，R05/R06 联合验证正式执行、资源清理及宿主存活；这补齐 [R01 语言契约](../r01-language-contract.md)此前保留的特殊差异，不改变普通 throw/catch/finally 的规则。
