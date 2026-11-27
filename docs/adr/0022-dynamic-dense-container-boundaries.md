---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# 合法动态密集操作保留运行时边界检查

用户于 2026-09-30 接受 R03 Q13 A：支持合法动态覆写、恰末尾追加及缩短；静态已知制造 gap/holes 或未初始化增长的非法形式编译期拒绝，受支持动态操作违例及 Span/ReadSpan 越界则在非法访问/修改前结构化语义 trap。相对于要求所有普通索引和长度静态可证，这保留游戏脚本的合法动态数据操作，代价是必须正式实现边界检查及稳定失败时序；不先制造 gap、补零或读取原生垃圾，也不以全部拒绝冒充支持。

普通请求沿用 [ADR-0017](0017-request-termination-skips-user-finally.md)：终止、不进用户 catch/finally、不回滚先前效果，Runtime 清理自身资源并保持宿主存活。VM/AOT 保留求值顺序、首个失败、源码锚点及未到达路径；本次非法修改不发生，不等于撤销先前求值副作用。验收与具体消费者责任见 [R03](../r03-ir-normalization.md)。

动态检查不替代 Q6 的强制静态安全及 [ADR-0020](0020-stable-container-during-span-borrow.md) 的活跃借用结构稳定：任何别名都不得在活跃 Span 期间追加/缩短，即使容量足够。普通 Array 读取保持 [Q12 B](0021-checked-native-array-index-read.md)，GPU 失败/报告/恢复按独立领域协议落实，不能套用普通请求 trap。本决定未实现能力，不批准新的可选查询接口或具体 API。
