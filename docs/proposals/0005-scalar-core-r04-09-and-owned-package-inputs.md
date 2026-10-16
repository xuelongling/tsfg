<!-- SPDX-License-Identifier: MIT -->

# ECP-0005：同版scalar Core/R04 0.9与owned包精确输入采用

Status: accepted
Date: 2026-10-16
Decision Owner: Human用户（Contracts/Build Input Set具体决定）
Adoption executor: Root；本owner仅按Root分工执行文件IO。
Authorization: 用户在当前完整R03会话中明确接受原具体0.9及111/112提案；此记录来自实际人类决定，不以Agent推定、测试通过或双轴评审代替批准。
Fixed implementation BASE: d45668101ceb0d57e3233d289d7d5bb147286071。

## 背景、范围与非目标

owned泛型包的官方实例化响应已经进入独立cold HIR和唯一scalar SSA emitter；BASE真实Core0.8拒其交换身份、合法冒号逻辑路径及超过256函数的完整闭包。本决定采用同一具体scalar消费者，禁止贴旧header、改包路径/函数身份、截闭包、第二套lowering或私有executor。

批准范围是同仓未发布exact开发格式及精确Build Input Set成员，不注册generic package/IO/HIR三个candidate-v1为正式family，不采用新的Source lock/SourceEXE或正式Runtime执行资格，不改变跨仓Source契约、工具链、隔离、发布权限或既有兼容窗口。本票原规范文件保留候选准备时措辞；其精确0.9/schema/成员决定由本accepted ECP明确采用，不由此升级artifact准入。

## 精确版本、schema与消费者

- tsfg.hir为0.9.0，canonical SHA256：sha256:01961f3315f286d46c5b651495f59284d5db92d0b0654fbaa2a78ff6043b941c。仅HIR JSON contractVersion改变；普通HIR最多256函数及原源码/token校验保持。现有HIR规范内Core交换同为0.9.0，不新增独立Core family。
- tsfg.bytecode为0.9.0，wire9，canonical SHA256：sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6。FrontendSnapshot仍0.8.0。registry/schema与真实producer/reader一致；old Core0.8、wire8、错schema及mixed输入拒绝。
- ordinary与generic owned HIR各自先cold verify，再进入唯一scalar SSA emitter及同版C++ canonical/emit。generic HIR保持candidate-v1 provenance，不伪装普通源码HIR；compilePackage复用现有producer及真实manifest输入门。
- Core/R04/Runtime reader只把完整具体函数表上限升至512，既有u16计数、call低u16目标及高u16 reserved0足够；80字节头/布局/操作/identity domains/capability19保持。每函数CFG256、寄存器4096、指令8192、参数64、包1MiB及全部执行/栈/深度/燃料预算保持。
- 冒号是逻辑source metadata普通字符，从不要求宿主文件读取；原path字节保留在ID与源码映射。NUL、坏UTF8、反斜杠、非rooted路径、空/点/父段及primary .d.ts继续拒绝；module声明路径保留其用途。
- Runtime按owned model、decode/verification、view/serialization及稳定public facade拆分，旧重复正文移除，不加compat shim，不暴露内部Module/cast到facade，不改vm/native-cost执行。实际staging和artifact required名单均精确覆盖三新Runtime模块。

## 精确Build Input Set决定

采用既有算法/格式/所有旧成员；以下14个tsfg相对路径是唯一新增成员，不使用wildcard：

- compiler/frontend-execution.mjs
- compiler/generic-hir.mjs
- compiler/generic-instance.mjs
- compiler/generic-json-budget.mjs
- compiler/generic-json.mjs
- compiler/generic-package-frontend.mjs
- compiler/generic-package-io-shape.mjs
- compiler/generic-package-io.mjs
- compiler/generic-package-shape.mjs
- compiler/generic-package.mjs
- compiler/scalar-core-emitter.mjs
- runtime/bytecode_decode.zig
- runtime/bytecode_model.zig
- runtime/bytecode_view.zig

完整compact JSON加单LF声明的精确文件身份：

| 组合 | 原成员 | 新成员 | 字节 | SHA256 |
| --- | ---: | ---: | ---: | --- |
| Product | 97 | 111 | 6281 | 77bda35c14ca994ffd4586d554c16d1be67b098127212897fbe00c6ba10c4356 |
| M13 | 98 | 112 | 6336 | 1c8d9c6692863f7a6f779557e1410fe643237a09e34df81ba462ea396ec22d22 |

两声明各精确新增852B，所有旧entry逐项不变。M13必须保留其原98项及runtime/managed-heap.zig，包括其既有真实消费门；不能把Product文件整段覆盖M13独有行为。此登记步骤只在独立candidate采用Product111；M13112是accepted但尚未adopted，Product主候选/M13尚无本步骤集成或新提交信用。后续动作由Root按真实Git与测试结果记录。

## 备选与取舍

保持0.8/256/禁冒号虽然无需迁移，却无法真实消费目标owned包；改路径/截断/换旧header破坏身份和语义。另建独立Core family可解除未来HIR/Core版本耦合，但增加真实规范/registry及所有producer/consumer迁移；本次没有第二种Core操作形态，暂沿用已有归属。所选同版0.9让两种HIR共享验证职责，代价是ordinary HIR即使结构基本不变也随现有Core归属升版本，旧cache/artifact全部失配，必须整体重建，不能混版fallback。

## 兼容、采用顺序与回滚

1. 已完成完整候选实际检查与独立双轴；本accepted记录来自随后人类的精确决定。Root采用获准精确源/registry/schema/声明组合，不扩大其他成员。
2. 独立candidate先逐字采用Product111声明；Root进行必要增量检查和精确提交，再串行处理Product主候选与M13。M13采用时按真实三方内容保留heap与独有语义；必须让新producer、reader、registry/schema和声明形成同版组合。
3. session/schema/registry输入摘要使旧cache/artifact失配。正式factory/manifest还需按最终同版源/输入取得实际资格；已实测本地Cpp候选不能重贴为正式manifest，也不把旧VM/Source二进制当新消费者。
4. SourceEXE/生成VM/native inspect及历史cyber STOP动作不随本决定恢复。必要的后续受阻资格单独保留OPEN并按适用人工子票处理，不使用版本、flag、工具或模型绕过。
5. 回滚使用可审revert或完整旧source、registry/schema、输入声明及匹配artifact组合，保M13 heap/历史WIP，不只回退header/hash，不增加旧读器或compat shim，不移动tag、不擦除失败原件。本决定不授push、发布或Stable晋升。

## 安全、隔离与许可证

没有新增第三方依赖、工具来源/版本、安装或SDK输入；新增Runtime源码是既有MIT实现按真实职责移动并保留SPDX，同仓新增代码沿用原许可，没有新增第三方NOTICE义务。精确锁定工具、输入完整性、真实manifest来源门及原权限/网络/隔离持续适用。512只扩完整函数表，原包和执行预算保持；逻辑路径字符扩展不授权宿主访问，不声称ResourceProof或正式Runtime资格。

## 实际验证与独立评审

原24路径17M7A的源码SHA256与Git blob SHA1经Root逐件匹配；最终diff/raw/check/status各自然exit/close0、FIRST[]，diffcheck双流0。四个RED文件在GREEN中逐字保持。

- RED实际1P9F：旧Core身份首拒，普通旧HIR的三次Core成功但独立reader拒wire8；513负例在RED未到容量门，不能记capacity RED信用。
- 新Core GREEN10/10，PID12048自然exit/close0、FIRST[]、stderr0。38个真实CLI调用为27次0、11次预期3。完全相同extraNativeFunction另在合法2fn表正控通过（PID35104），再2次CLI调用0；Root核新40调用原始stdin/stdout/stderr长度、独立exit/close与错误null。
- 相关Node首次实际50通过，漏codec另补39通过，合89；不冒称first89。均自然0/无skip；TYPE guard修后frontend10定向再过。
- TYPE首pipeline TS2339及失败输入原件保留；以真实HIR字段guard修复，无any/cast。最终TYPE325=150P175T，unknown/duplicate/diagnostic0，PID33944自然0。
- 四个变更C++ TU和link各自然0/FIRST[]；两个未变encoding/nativeCost对象按精确源/头/依赖复用。实际EXE37323264B/SHA256 2a5642fc83e6ece1dad5c6fd137a070da71fd3558a71bc591db69eb52cfd075a，仅直接候选资格。
- 最终Runtime reader/view仅对象编译：PID18848自然exit/close0/FIRST[]/双流0，reader-final.obj4923207B。未执行该对象或VM。
- 独立Spec最终0finding；初文档wire身份P2已修并保原件。独立Standards明确规范违例0、判断性smell0。两轴分开记录，均为Agent独立评审，不冒人类批准；Owner接受来自本记录开头的实际用户决定。

完整原件沿用workspace14.COREPACKAGE的M14-core-package-checks-20261016证据目录，包括首TYPE、旧diffcheck2、P2、所有Core raw流和最终两个review报告；失败不删除、不覆盖。

这些结果不提供新packet的VM可执行资格、SourceEXE准入、正式CMake/Runtime manifest、generic三family正式采用或M14父AC完成信用。源码/输入决定已接受与制品/执行资格分开，所有原STOP及变体保持。
