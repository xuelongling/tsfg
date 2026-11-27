---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# 普通原生 Array 使用受检查的 T 读取

用户于 2026-09-30 选择 R03 Q12 B：普通密集 Array 有效下标读取返回 T，缺失/越界在原生访问前产生结构化语义 trap；T 自身含 undefined 时，有效元素仍可返回该值。相对于普通 TS/JS 缺失读取返回 undefined，此明确差异使高性能游戏脚本的正常密集计算保持 T 结果，并与原生布局及统一 VM/AOT 语义目标一致；密集存储并不必然要求它，备选 T | undefined 也不自动导致逐元素装箱，尚无性能测量证明 B 更快。

代价是普通 TS 越界行为不再兼容，必须提供独立差异 oracle、原生访问前安全检查及 VM/AOT 相同的求值/首个失败时序；断言不能绕过安全，未到达路径不能提前 trap。沿用 [ADR-0017](0017-request-termination-skips-user-finally.md)：终止请求、不进用户 catch/finally、不回滚此前效果，由 Runtime 清理自身资源并保持宿主存活。详见 [R01](../r01-language-contract.md) 与 [R03 验收要求](../r03-ir-normalization.md)。

这是文档决定，未宣称前端/IR/Runtime 已实现，不批准开启 noUncheckedIndexedAccess；类型事实、特殊映射及交换版本须在正式实现协调。可选查询需求及接口另行设计，名称/签名未批准；Q13 动态修改和 Span 边界政策已另由用户选择 A，见 [ADR-0022](0022-dynamic-dense-container-boundaries.md)；不以 Q12 推导或覆盖其静态安全边界。
