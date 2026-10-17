<!-- SPDX-License-Identifier: MIT -->

# ECP-0008：owned closure target 分析的三个精确生产输入

Status: accepted
Date: 2026-10-17
Decision basis: 用户已明确采纳M19七项并要求“不要一直让我决策。合理范围自主推进”；Root按该R03同类内部职责模块/机械补录授权采用本三项。不是新增逐项Owner投票，不扩大外部、信任、正式版本或执行权限。

## 精确决定

Product154→157、M13155→158，两声明各仅增加189B；所有旧entry、M13 managed-heap、SDKv2、schemaVersion字符串1、entry字段、UTF8排序/JCS+LF、身份与载荷格式保持。只加入：

- compiler/closure-target-domain.mjs
- compiler/closure-target-solver.mjs
- compiler/closure-targets.mjs

| 声明 | 成员 | 字节 | SHA256 |
| --- | ---: | ---: | --- |
| Product | 157 | 9237 | 3769701c6b9ff295415f675f5652583f43ba42c473f6feb36621c5256c50816a |
| M13 | 158 | 9292 | b60f53a9197d3c34d8e66ce3c75126490f79a24654e01a515a295906e45c48bf |

## 已验证实现与限制

私有分析提交 db4f96f4dabdccfa4834974ba34e8cf3e183a0aa 的31路径已验证tested/staged/committed一致、postclean，独立Spec/Standards最终0。68 distinct相关资格由修复后完整57、新增身份覆盖2和未变依赖legacy9组成，非一次68运行；最终TYPE386与351稳定输入。真实能力及传递外部环境/null边界的因果RED→GREEN、同名不同parent/scope目标断言保留。代码不超过477LF。

报告为context-insensitive-may私有tsfg.closure-targets-candidate v1，仅绑定已验HIR和显式入口。未知词法环境保持TOP；代码目标集合不代表闭包实例或环境等价。API未接入lowering或正式consumer，正式Core0.9/wire9/registry不变；不增加Source/Frontend012正式采用、VM/GC/Runtime执行、ResourceProof/RF或发布信用。

## 串行采用与回退

保持Product/M13原工作区及M13五独有行为，集成同一已测字节后做受影响类型/最小集成检查、独立增量评审和已授权本地提交，再对最终158实际成员/mode/epoch/工具闭包验证新的普通initial-false构建。旧139/140或154/155制品不能重贴。失败原件保持，回退用可审revert或匹配的完整组合，不移动tag、不push。

所有历史cyber STOP及变体继续停止，human012的14/17与279333 UNKNOWN组仍只按既有人工作业边界处理；不借本补录换工具、模型或路径恢复被拒动作。
