<!-- SPDX-License-Identifier: MIT -->

# ECP-0009：闭包环境转换的两个精确输入

Status: accepted
Date: 2026-10-17
Decision basis: 用户明确采用M19七项并要求合理范围自主推进；Root按既定R03同类内部职责模块和机械输入补录授权采用本两项，不新增逐项Owner投票。

## 精确决定

仅新增 compiler/closure-environment-lowering.mjs 与 compiler/closure-environments.mjs。Product157→159，M13158→160；每份仅增加136B，所有旧成员逐项保留，包括M13 managed-heap。SDKv2、schemaVersion字符串1、entry字段、UTF8排序/JCS+LF及身份/载荷格式保持。

| 声明 | 项 | 字节 | SHA256 |
| --- | ---: | ---: | --- |
| Product |159|9373|771c2b7ca46fe6c0c815e72ff39a265c68dcd16c589cc1a581231d9573301a43|
| M13 |160|9428|830ca2a1d540df940aa2bac0be2e9f3885883bf5f70e850772453fee56a594c2|

## 行为与边界

19f将已验证owned HIR转换为私有typed closure-explicit program，保完整FunctionID/原BindingID/类型/控制顺序/来源锚；静态layout只描述槽，allocate操作位于owner函数入口、每次激活创建fresh managed logical environment。捕获读写共享原槽，闭包值带FunctionID与环境引用，无ownenv中间层仍转递祖先环境，closureCall先保存完整callee再依序求实参。捕获block/loop局部尚未实现，必须具体capability拒绝。

公开API及冷读复用现有HIR/JSON验证、完整HIR哈希和同一转换冷重算；不重解析Source、不增加第二typechecker或运行时执行器。格式仅tsfg.closure-environments-candidate v1，未登记正式registry，不改现有lowerHir/Core0.9/wire9/runtime。物理heap布局/GC根与ABI、逃逸分析、正式consumer/执行与RF仍OPEN。不能把结构fresh allocation当寿命或GC实跑证明。

## 验证和串行集成

首32324真实capability RED→同冻结首test36460 GREEN；完整8文件26352为71PASS，后续两个真实Source作用域用例及具体capability回归、类型检查和双轴最终结果记录19f唯一验收摘要。Source自有Go table仅增加两用例、生产0改，公开Go35208七节点PASS，gofmt11024原字节；不冒SourceEXE或Frontend012正式采用。

最终通过后保持Product/M13原工作区和M13五独有行为，采用精确字节、执行适用检查/双轴增量/已授权本地提交，按最终160新身份验证普通initial-false构建。158旧产物不重贴；失败原件保持，回退用完整匹配组合或可审revert，不移动tag、不push。所有cyber STOP及变体和human01214/17、279333 UNKNOWN保持；本声明不恢复任何被拒动作。
