# ECP-0011：owned closure Core consumer 精确职责输入

Status: accepted
Decision: Root，2026-10-17；依据用户完整R03及“合理范围自主推进”授权，属于同类内部职责模块和机械输入补录；不声称另一次Owner逐项表决。

## 问题与变化

19g已提交的私有typed closure Core候选有第二个独立C++消费者。新增dialect、严格metadata/身份及完整函数验证、初始化、逻辑根适配，并从既有reference路径抽取唯一CFG与live-before核心，避免两套规则。注册与入口分流在现模块内完成；旧reference constructor operation范围与入口fuel范围分别保留。

仅增加以下十二职责成员：

- `compiler/core-ir/closure-cfg.cpp`
- `compiler/core-ir/closure-identities.cpp`
- `compiler/core-ir/closure-metadata.cpp`
- `compiler/core-ir/closure-metadata.h`
- `compiler/core-ir/closure-roots.cpp`
- `compiler/core-ir/closure-verify.cpp`
- `compiler/core-ir/closure.cpp`
- `compiler/core-ir/closure.h`
- `compiler/core-ir/managed-cfg.cpp`
- `compiler/core-ir/managed-cfg.h`
- `compiler/core-ir/managed-liveness.cpp`
- `compiler/core-ir/managed-liveness.h`

完整Product163→175，M13集成候选164→176；两份均只增加 772 字节，删十二项逐字还原旧声明。保留全部既有成员、managed-heap、SDKv2、schemaVersion1、顺序与JCS+LF。BIS/BI算法与载荷格式不改。M13候选目前仅在票外产物目录，未集成、未冒176构建。

## 验证与采用边界

受影响14生产单元及独立driver对象已使用既有锁定clang-cl/SDK实际编译，natural0；TYPE403零诊断。Spec/Standards发现constructor锚静态回归并最小修复后复评零未解决源码问题；首版保存一次，不冒动态RED。具体身份与原始命令/流、15对象及7真Source文本/22负例/7独立手工根表由同票final-summary记录。

此决定只接受精确源码输入，不证明新Core的链接、parse/verify/canonical/roots实际行为。其真实动态验收由19h人工子票承接，未运行保持OPEN；私有工作树可本地提交供人工，Primary/M13暂不集成该消费者。旧scalar/reference行为亦不凭对象编译冒已动态保持。

Core0.9/wire9/正式registry不采用闭包格式；编码边界明确拒绝候选。19g私有schema及Node文本不变，根从consumer SSA重算为内存结果，不收producer根，不将FnID视作指针；Source/program/HIR只有摘要，不冒preimage证明，CLI预算只parse后。物理Handle/GC、调用返回原子保活、ABI/Runtime/VM/RF及父M19继续OPEN。

所有既有cyber STOP、人工作业012及279333 UNKNOWN持续；无SourceEXE/VM/新Core自动执行、无新C/MC执行，不push。
