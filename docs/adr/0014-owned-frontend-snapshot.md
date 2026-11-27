---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# FrontendSnapshot 独立拥有前端分析数据

R02b 采用独立拥有、不可变的 FrontendSnapshot，仅投影当前消费者需要的源码结构、符号、类型与诊断事实，而不是让下游持有上游会话并按需查询。用户于 2026-09-20 接受此方案：以有限的数据投影和内存成本换取上游会话关闭后仍可消费的产品 interface，避免 Checker 生命周期与上游内部对象传播到后续 lowering。该决定不要求复制完整 TypeScript AST、不提前构造 HIR/SSA，也不锁定传输格式或整个编译器宿主语言；内部缓存和共享可以演进，但不能改变独立拥有的外部含义。
