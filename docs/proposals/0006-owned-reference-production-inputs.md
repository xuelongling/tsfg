<!-- SPDX-License-Identifier: MIT -->

# ECP-0006：owned reference精确生产输入成员

Status: accepted
Date: 2026-10-17
Decision Owner: Human用户（Contracts/Build Input Set具体决定）
Adoption executor: Root
Authorization: 当前完整R03会话中，用户对精确28成员提案明确选择“采纳精确139/140提案”。这项记录来自实际人类决定，不以测试或Agent评审代替批准。
Fixed Product implementation BASE: 2f0e0974a0bf2bf1b32ec0b9ed51accb8466d525。

## 决定与边界

仅将以下28个既有tsfg生产依赖纳入声明：Product111→139、M13112→140。保留每个旧entry、SDKv2、声明schemaVersion字符串1、entry字段、排序/JCS+LF及载荷格式；身份算法、正式Core0.9/R04wire9/registry、隔离或信任边界不改。本决定只批准成员集合，不以历史源码SHA或旧制品代替最终实际成员字节的Build Identity。

- compiler/core-ir/core-verify.cpp
- compiler/core-ir/core-verify.h
- compiler/core-ir/reference-cfg.cpp
- compiler/core-ir/reference-construction.cpp
- compiler/core-ir/reference-index.cpp
- compiler/core-ir/reference-metadata.cpp
- compiler/core-ir/reference-metadata.h
- compiler/core-ir/reference-provenance.cpp
- compiler/core-ir/reference-roots.cpp
- compiler/core-ir/reference-verify.cpp
- compiler/core-ir/reference-verify.h
- compiler/core-ir/reference.cpp
- compiler/core-ir/reference.h
- compiler/reference-callable.mjs
- compiler/reference-common.mjs
- compiler/reference-core-emitter.mjs
- compiler/reference-core-model.mjs
- compiler/reference-facts-body.mjs
- compiler/reference-facts-shape.mjs
- compiler/reference-facts.mjs
- compiler/reference-forwarding.mjs
- compiler/reference-hierarchy.mjs
- compiler/reference-hir.mjs
- compiler/reference-provenance.mjs
- compiler/reference-relations.mjs
- compiler/reference-scalar-policy.mjs
- compiler/reference-types.mjs
- contracts/core-reference-candidate.schema.json

## 完整声明身份

| 组合 | 旧成员 | 新成员 | 字节 | SHA256 |
| --- | ---: | ---: | ---: | --- |
| Product | 111 | 139 | 8096 | fdbd83cbd6d2d4aa28a04bb8d039f35c74aee5e1db6769f1aae6e4c2c87b4ade |
| M13 | 112 | 140 | 8151 | 70336d77676716d744503c6cd447c5f0ada28bdcc2a3dfe221367687feffadf2 |

两声明各只增加1815B；去掉精确28entry后逐字恢复旧111/112。M13继续仅多既有runtime/managed-heap.zig，不能整段用Product139覆盖其独有成员或行为。没有新增test/fixture/Source Go/SDK/第三方输入或wildcard。

## 私有候选与验收范围

新增生产链实现Source4→facts4/HIR4→private Core-reference。此次成员授权与[ECP-0002](0002-bounded-autonomous-development.md)下同仓未发布私有版本决定分开；private v2及其后经有限委托原子核验的v3不因此成为正式family。所有实际producer/consumer/schema及版本拒绝仍须匹配，不增shim。正式SourceRPC/SourceEXE/Frontend采用、R04引用编码、VM/GC/Runtime执行、发布或Stable没有新增批准，wire9继续在任何packet输出前拒绝reference。

采用前已完成精确成员/旧项保留/依赖闭包及独立Standards和Spec核验；private Core真实Cpp、因果RED→GREEN、TYPE和相关输入资格按原始版本与相同字节适用复用。各批次不能合并冒充一次全量重跑，也不能重贴为139/140新身份构建通过。后续private版本只按原有限委托逐条判断，本记录不扩大委托。

## 采用、验证与回退

1. Root在Product/Core候选逐字采用139，完成受影响的输入完整性检查、独立增量评审和已授权本地提交。
2. 串行集成同版源到Product与M13，M13保留heap及既有独有语义后逐字采用140，分别记录实际Git和检查结果。
3. 以最终实际成员、mode、last-touch commit和锁定工具闭包推导新BIS digest/epoch/Build Identity，再验证普通initial-false构建。旧111/112 cache/manifest/二进制不能重贴为新身份；factory/正式artifact及执行资格仍需各自真实证据。
4. 回退用可审revert或匹配的完整source/声明/制品组合，保留M13 heap、历史WIP和所有失败原件；不只改header/hash，不加compat层、不移动tag、不push/发布。
5. 全部历史cyber STOP及其变体继续停止；不因本决定恢复E8/S1/old native-work、Source12/629/279333及重包、整Go wildcard、旧ToolB/cache删除、NodeREPL宿主process/env/eval/privatecache等动作，不换工具/模型绕过。
