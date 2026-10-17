<!-- SPDX-License-Identifier: MIT -->

# ECP-0010：闭包 SSA Core producer 的四个精确输入

Status: accepted
Date: 2026-10-17
Decision basis: 用户明确采纳M19七项并要求合理范围自主推进；Root按同类内部职责模块及机械输入补录授权采用，不新增逐项Owner投票。此项输入决定与功能最终验收分别记录。

## 精确决定

仅新增以下四项：

- compiler/closure-core-emitter.mjs
- compiler/closure-core-model.mjs
- compiler/core-ssa-emitter.mjs
- contracts/core-closure-candidate.schema.json

Product159→163、M13160→164，各仅增加261B；删除四项可逐字节还原旧完整声明，所有旧成员及M13 managed-heap保留。SDKv2、schemaVersion字符串1、entry字段、UTF8排序/JCS+LF、身份算法和载荷格式保持。

| 声明 | 项 | 字节 | SHA256 |
| --- | ---: | ---: | --- |
| Product |163|9634|1798d8275e022276421868a3e2520b66820769b5fc1b475be3e4e1a0dbde4656|
| M13 |164|9689|8c1d801c1ec745d551ff41c84b0c352ad0df79ab26d0a20f4132ef53af2bdc3f|

## 行为与边界

19g公开emitClosureCore先冷验19f closure-explicit program，完整发射有限parameter-capture程序为typed SSA MLIR候选：完整256bit身份、动态entry环境分配/参数初始化、typed父链、共享原槽读写、闭包pair及callee先于有序实参。捕获local明确整份capability，不能漏操作。第二真实consumer抽取既有CFG/definitions/scalar/control，共享SSA；旧scalar入口委托同核，不保第二实现。

候选family tsfg.core-closure-candidate v1；schema为私有producer描述，不登记registry，不改变Core0.9/wire9或旧lowerHir能力。输出完整函数/函数体和source锚，不是layout sidecar。root_policy=consumer-recompute-required明确独立C++类型/操作/根验证尚未完成；不发假根表，不假定机器地址、物理heap/Handle ABI或移动GC已通过。无SourceEXE、新Core二进制、VM/native inspector/新C或MC执行。

## 验证和串行集成

首37296在真实public import→cold HIR→19f程序成功后取得精确能力RED；同冻结首test91ce9313在完整相关34640的92项中GREEN，0fail/skip。旧四representation-only publicHIR与一既有真实generic输入，经8076/22332五完整UTF8输出逐字一致，不冒Source能力或Core consumer执行。Source仅三table行已e73eafaf本地提交/postclean，公开Go28248实际10TestPASS、formatter23856全文同源；执行来源保持3a+dirty，不重贴deliveryOID。新三真实帧的11项Node边界23240曾10PASS1FAIL，真实短路局部初始化暴露共享SSA的Map receiver在递归emit前求值，写回旧表造成后续操作数缺失。原件保留；修复为先求RHS再写当前definitions，不改冻结oracle。修复后完整95项、五份旧字节对照、Type及独立双轴最终结果见19g唯一验收摘要。

最终通过后再已授权本地提交与串行集成，保持M13五独有行为，以最终164新身份验证普通initial-false构建；旧160结果只保旧身份，不重贴。失败原件保存一次，不push、不移tag。所有cyber STOP及变体、human01214/17和279333 UNKNOWN保持；本声明不恢复任何被拒动作或授予正式Core/Runtime/RF资格。
