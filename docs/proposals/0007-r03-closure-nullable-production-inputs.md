<!-- SPDX-License-Identifier: MIT -->

# ECP-0007：R03 closure/nullable 精确生产输入补充

Status: accepted
Date: 2026-10-17
Decision Owner: Human用户（M19七项明确采纳；同类机械补录授权）
Adoption executor: Root

## 授权来源

用户对已完成双轴评审的M19七成员提案明确答复：“采用。不要一直让我决策。！！！合理范围自主推进。” Root据此直接采用该七项，并在同一R03范围自主补录已实现、已本地提交、双轴零发现的M20八项内部职责模块。M20八项是Root依最新同类机械补录授权作出的有限采用，不记录为用户逐项投票；这不扩大外部动作、正式版本、信任或执行权限。

## 精确成员与不变量

Product139→154、M13140→155，各增加952B。新增15项仅如下列表；完整旧entry逐项保持，M13保留managed-heap及全部既有独有行为。schemaVersion字符串1、entry的path/projectId、UTF8排序、JCS+LF、SDKv2、载荷和身份算法保持。实际源码、mode、last-touch commit与工具闭包仍参与最终身份，旧制品不能重贴。

- compiler/closure-common.mjs
- compiler/closure-facts.mjs
- compiler/closure-frontend.mjs
- compiler/closure-hir.mjs
- compiler/closure-source-grammar.mjs
- compiler/frontend-response.mjs
- compiler/scalar-operators.mjs
- compiler/core-ir/nullable.h
- compiler/core-ir/nullable.cpp
- compiler/core-ir/nullable-metadata.cpp
- compiler/core-ir/nullable-cfg.cpp
- contracts/core-nullable-candidate.schema.json
- compiler/core-ir/nullable-wire.h
- compiler/core-ir/nullable-wire.cpp
- contracts/bytecode-nullable-candidate.schema.json

| 声明 | 成员 | 字节 | SHA256 |
| --- | ---: | ---: | --- |
| Product | 154 | 9048 | cf5e3e3144f305a5efa8d4b6c47cdf292b5813074d7f647c92514725de42d23e |
| M13 | 155 | 9103 | 2d99f4a118f4b61d3a730ceff249bac563fd24d844dacac960ec666642ac8900 |

七项候选原为Product146/M13147，精确417B；M20八项原为Product147/M13148，精确535B。联合仅取两集合并集，不删除/替换旧项，不增加第三方、通配符或兼容层。

## 已验证范围

M19 owned closure HIR提交bae16099e1e0056c9f7577e1f7c37f11830d1fee已通过53项、TYPE381、独立Spec/Standards；M20 Core/Wire提交448c156640b4821b443e26722c098a66e3d7a4d6已合入d6浮点修复并通过84项、147次真实Cpp调用、TYPE376、独立Spec/Standards。相同字节证据仅按原切片复用，不相加冒新全量运行。

正式Core0.9/R04wire9和registry保持；M20 nullable Core1/TSFGNUL1 wire1仍为显式私有候选，默认wire9继续在输出前拒绝nullable。Source/Frontend012人工作业14/17组、279333 UNKNOWN、SourceEXE/VM/GC/native inspector/C/MC执行、ResourceProof/RF、发布/Stable不获新增信用。19e分析实现及其额外输入不在此15项内。

## 采用、验证与回退

串行集成Product与M13，保留各树原工作区及独有语义。核对精确旧项保留、成员与模块字节、适用类型/集成检查和独立增量评审后按既有授权本地提交；最终新身份普通initial-false构建单独记录。失败原件和旧身份结果保留，回退用可审revert或匹配的完整组合，不移动tag、不push/发布。

所有历史cyber STOP及变体继续停止；不换工具、模型或路径重放被拒动作，不以此次输入补录恢复任何人工边界。
