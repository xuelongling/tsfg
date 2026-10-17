<!-- SPDX-License-Identifier: MIT -->

# ECP-0012：函数体局部捕获 Core 消费的一个精确输入

Status: accepted
Date: 2026-10-17
Decision basis: 用户已采纳M19七项并要求合理范围自主推进。Root按同类内部职责模块和机械输入补录采用；不虚构额外Owner表决。

## 精确决定

仅新增 `compiler/closure-core-initialization.mjs`；Product163→164、M13164→165，各增加71B。删此项逐字恢复旧完整声明；全部旧成员、M13受管堆、SDKv2、JCS+LF、schemaVersion字符串1、身份算法与载荷格式保持。

| 声明 | 项 | 字节 | SHA256 |
| --- | ---: | ---: | --- |
| Product |164|9705|e012f6b96414d5829b5a878a5018145daeb1e01b1c6ac5aad203505ecd90bb1d|
| M13候选 |165|9760|e206ca8cf459d0b01c29cb8bd3413da09883eaea9eb7c74e2ab86f4fb07b0329|

## 行为与边界

现有emitClosureCore冷验同一19f完整程序后，接受函数体直属captured local。helper只分析实际typed ops：跨函数祖先槽读写沿direct/make FnID固定点传递；每函数own activation重新分析，声明RHS先求值再initialize，ordinary store不能初始化。造值或调用前不能证明观察安全的真实路径具体capability；合法先make后init也可保守拒绝，不更改TS TDZ或引入默认值/Trap。block/loop局部继续19f原scope capability。

私有Core candidate由v1原子替换为v2，无兼容路由、第二环境表示或新公开API。原7操作不变，slot增加真实declaration_index，role含local；env.alloc逻辑Uninitialized，env.init声明处initialize-once，inactive payload无GC扫描资格。仍绑定完整program/hir字节，root_policy仍consumer-recompute-required。formal registry/Core0.9/wire9与Source接口不改。19h ce6人工v1工作树保持冻结；本票不宣称其消费v2。

## 验证与集成

真实shared-mutable首RED29088在public import/HIR/19f之后触发旧local门；冻结同首测38880 GREEN，相关完整104项和TYPE405零诊断。新增八个Source public Go官方/owned对照最终33652实际25节点PASS、0fail/skip，具体初始化拒例与最终双轴/提交/集成结果归本票唯一final-summary。首Go样本的true字面量不满足既有false-only corruption控制的失败原流完整保留；只修新增样本，不放宽断言。

相关最终检查与独立Spec/Standards通过后执行已授权本地提交与串行集成；M13保五个独有行为。新身份普通initial-false资格单独验证，旧164不重标165。此声明不恢复任何cyber STOP或授予Source EXE/VM/new Core/C或MC执行权限，human012/279333及物理GC/ABI/正式Runtime/RF保持OPEN，不push。
