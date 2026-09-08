<!-- SPDX-License-Identifier: MIT -->

# tsfg 完整方案交付 Roadmap

日期：2026-09-07
状态：Windows 优先的方案已重构；功能、平台与发布结果按证据分别验收。
变更依据：[ECP-0001](proposals/0001-windows-first-development.md)。
自主开发范围与例外：[ECP-0002](proposals/0002-bounded-autonomous-development.md)。
架构来源：[tsfg-architecture.md](tsfg-architecture.md)。

## 1. 第一目标与完成状态

第一目标是在 Windows 本机完成 tsfg 功能开发。当前宿主可作为开发与功能验证环境，报告真实 OS/build、CPU、工具和输入；Windows Server 上的成功不等同于 Windows 11 最低版本认证。Linux、最低 OS VM、跨平台矩阵和首次 Stable 不再是进入功能开发的前置。

三个状态必须分别记录，不能互相推定：

- **Development Ready**：R00 的 Windows 本机工程验收完成，允许继续语言和运行时开发。
- **Windows Functional Complete**：本路线 Windows 范围内语言、双后端、GC、ABI、热更、CPU 游戏计算、选定单 GPU 后端与本地工具全部通过真实项目验收。
- **Certified Release**：承诺平台、版本兼容与发布治理的 R13 验收完成。

完整方案仍包括最终平台与发布能力。现有代码、独立仓库、锁文件、CI 和取证结果保留；没有通过的项目记录待验收或延期，不能通过改写文档变成成功。

## 2. 开发与验收原则

1. 按可运行能力切片推进，每张票有真实输入、正式入口、可观察结果、负例和复跑命令。保留最终架构，初始子集必须明确列出尚未实现项。
2. 依赖具体接口和测试能力，不能把整个 R01、R04、R06、R08 或 R13 的完成作为所有下游的启动门槛。
3. 同一语义在 HIR/Core IR 归一化，VM/AOT 共同消费；不加入 JS fallback 或临时第二套 IR/语言语义。
4. 同仓且未承诺兼容的开发格式允许版本递增后原子更新 producer/consumer；旧缓存和不匹配制品明确拒绝。已发布受支持版本继续执行原兼容与迁移承诺。
5. GC 根、句柄、字节码验证、ABI、并发与代码回收的正确性必须与其功能同批交付；性能优化可以独立，不降低已支持功能的安全要求。
6. 工具按当前能力需要提供。CLI、诊断和查看入口从首条执行链开始；公共包生态与托管服务后置。
7. 本地开发模式允许未提交改动并标记不可发布；固定工具、输入追溯和明确失败继续保留。正式 package/repro/release 的干净身份要求不因开发便利而改变。
8. 测试分层：本机快速相关测试；集成点 Windows clean/debug/release；性能与随机压力按能力；跨平台和 VM 认证归 R13。远端现存 required checks 在显式实施迁移前仍须遵守，不以文档跳过保护。
9. 所有新增任务数据、软件、缓存、日志、下载、工具临时目录和 worktree 置于 E 盘。默认写 C 盘的工具必须先定向配置；本机开发不要求安装 Windows VM。
10. “Source”要求始终是可维护源码、明确来源与许可证、可复跑构建和真实消费者；未实际引入的 upstream 不创建占位 fork。不存在的 Reflection/制品不能用 fixture 或空摘要冒充。

## 3. 分层验收规则

| 类别 | 当前必需证据 | 后置边界 |
|---|---|---|
| 工程 | Windows 真实 build/test/run，锁文件、输入、OS 和退出状态 | 最低 OS、双 VM、Linux 和第三方复现是认证 |
| 语言 | 当前支持矩阵、正反例、稳定诊断和 oracle | 未支持项诊断拒绝，完整语言在 W3 收口 |
| 格式 | 真实 producer/consumer、版本、哈希、损坏拒绝 | 未发布开发格式不承担虚构旧版本兼容窗口 |
| Reflection RF-01 | 功能引入后，同一源码/目标/选项/工具与 schema 在两个独立输出目录重生成，规范 Reflection Digest 相同；相关输入改变后能检出变化 | R00 尚无 Reflection，记不适用；不同目标仅比较声明为目标无关的投影，空 Contract Set 不作替代 |
| 内存与执行 | verifier、生命周期、异常、GC 根、资源限额、并发负例 | 正确性不得留到 R13；长稳规模认证可后置 |
| 性能 | 性能票明确 workload、硬件、构建配置、测量方法、阈值与正确性 oracle | 无性能主张的普通票不强制性能基线 |
| 发布 | 适用平台、独立复现、签名、provenance、Owner、长期证据和回滚 | 仅阻断 Certified Release，不阻断 Development Ready |

## 4. 大任务清单

“主要产出”保留各领域最终责任，不表示全部是该领域启动前置；阶段与后置项按各节验收、依赖和 W0–W7 表执行。W3 收口通用语言/runtime 支持矩阵；ECS/Query/Jobs 与 GPU 的领域语义分别随 W4/W5 收口，W6 必须覆盖整个产品矩阵。

### R00：工程章程与 Windows 本机开发基础

**目标**：在当前 Windows 本机建立可修改、构建、测试和运行的工程基础，达到 Development Ready。

**澄清规范**：[`r00-engineering-charter.md`](./r00-engineering-charter.md)。该规范记录已批准目标；仓库、源码、CI、缓存与制品在通过阶段验收前均不得视为已存在。

**主要产出**：

- 目标平台 / 三元组 / 构建类型 / 支持矩阵与版本策略。
- 跨仓版本规则、兼容窗口、变更提案模板、所有权和发布流程。
- 工具链锁定文件、依赖来源清单、Hermetic build 入口和制品命名规则。
- 独立 Manifest Repository：以完整 commit OID 锁定 `tsfg`、`.agents` 与以后经批准的同级 upstream fork；仓内 contracts/compiler/runtime/tooling 的版本事实由 Product Version、Contract Registry 与 Contract Set 记录。
- 基础 CI：格式、静态检查、许可证检查、单仓测试、多仓组合测试入口。

**阶段验收**：按精确 manifest 在本机全新目录物化工作区；Windows debug/release 的 C/C++ 与 Zig smoke 通过 build/test/package/runtime smoke；开发模式允许未提交改动并标记不可发布；工具与源码来源、错误诊断、E 盘路径和复跑方法可核验。详细条件见工程章程；不要求最低 OS VM、Linux、独立第三 comparator 或 Stable。

**依赖**：无。完成 R00 本机验收后进入 W1。

### R01：规范化语言语义与一致性测试语料

**目标**：把架构描述提升为可执行、可判定的语言契约。

**主要产出**：

- 词法、语法、名称解析、类型、泛型特化、数值、空值、类/值类型、闭包、异常、模块和初始化顺序规范。
- JS/TS 特性的支持矩阵与必须诊断的拒绝矩阵。
- trap、溢出、浮点、求值顺序、资源限制和确定性语义。
- fast-math、并行归约与 GPU 的独立数值/确定性契约，包括 NaN、容差、迭代顺序和允许的非确定性；不得借用严格 Execution Equivalence 的结论。
- 内核子语言规范：禁止项、借用、效果、并行与 GPU 限制。
- 正例、负例和语义 oracle 组成的 conformance corpus；每个规则有稳定诊断码。

**阶段验收**：按语言能力切片建立支持/待实现/禁止矩阵。每个本轮支持的 MUST/MUST NOT 都有语义 oracle、正反例及诊断码，后端不得自行决定语义；未实现功能显式诊断。Windows Functional Complete 前补齐完整语言范围，不能以初始子集宣布 R01 全部完成。

**依赖**：R00 Development Ready；后续能力的规范先于该能力的前端和执行实现，不等待全部语言规范完成。

### R02a：上游源码治理与可复现集成

**目标**：把外部源码从“参考链接”变成可重放、可审计、可升级的工程输入。

**主要产出**：

- TypeScript、MLIR/LLVM 及其他实际批准来源的同级 fork、固定 commit、逐文件 intake ledger、SPDX/NOTICE 与本地修改记录。
- fork 特性分支与完整 OID manifest、SBOM、允许/禁止消费清单和漏洞响应流程；不以产品仓内 vendor 副本、snapshot/import 脚本或脱离 Git 历史的 patch queue 作为事实源。
- “构建消费的 fork 源码”与“仅借鉴算法/测试方法”的明确分类；不为只借鉴的方法建立虚假仓库 seam。
- 上游升级分支流程，以及语义、诊断、性能、许可证差异报告模板。

**阶段验收**：按实际消费来源分别锁定源码、重建、审查许可证和记录本地修改。TypeScript intake 完成即可供前端使用；MLIR/LLVM intake 在 AOT 使用前完成。未使用候选不要求 fork；SBOM 发布、全面上游升级运营移至 R13。

**依赖**：R00 Development Ready；与对应 R01 能力规范并行。

### R02b：TypeScript 前端产品化

**目标**：形成只服务 tsfg 的 scanner、parser、AST、类型分析、模块解析和 Language Service 基础，不携带 JS 输出路径。

**主要产出**：

- tsfg Program 输入管线、模块图、诊断合并与增量前端 interface。
- tsfg 额外标量、装饰器、值类型、Span、Handle、Query 等声明和解析/类型接入。
- 对 `.js`、动态对象语义、`any`、运行时泛型等禁止项的结构化诊断。
- 隐藏 TypeScript Program、AST、Checker 和缓存细节的 `FrontendSnapshot` interface；下游不暴露上游类型。

**阶段验收**：本轮语言子集的前端正反例通过；真实 .ts 输入形成独立 FrontendSnapshot，禁止 JS 输入和 emitter/runtime 回退；源码位置正确。增量实现加入时必须与 cold compile 一致；所有语言特性在 W3 补齐，Language Service 在 R12 收口。

**依赖**：对应 R01 子集和 R02a TypeScript intake；不依赖全部上游来源、R04 全格式或完整 Language Service。

### R03：HIR、Core IR 与语义归一化

**目标**：建立字节码和 AOT 唯一共享的语义中枢。

**主要产出**：

- 保留源位置、高层类型、收窄、泛型、闭包和异常的 HIR。
- 类型化 SSA Core IR；显式 CFG、值/引用分类、闭包环境、异常边和调用效果。
- 泛型全程序特化、逃逸/借用检查、效果推导和内核合法性分析。
- IR verifier、规范化打印格式、版本化序列化和 pass 管理规则。
- 前端→HIR→Core IR 的 golden、负例、round-trip 与变形测试。

**阶段验收**：本轮支持的语义在进入后端前完成归一化；非法 IR 被拒绝；后端不访问 TypeScript AST。新增 op 带 verifier、正反例和执行测试；增量能力加入时检查全量等价。借用、效果、异常随相关语言功能实现，在完整语言验收时齐备。

**依赖**：对应前端切片及 R04 当前所需 Core IR 约定；不依赖热更协议、GPU 格式和全部语言 lowering。

### R04：跨仓制品格式、元数据与 ABI 单一事实源

**目标**：按真实 producer/consumer 的需要增量定义制品、元数据和 Windows ABI，保持单一事实源。

**主要产出**：

- `.tbc`、`.tmeta`、`.tsfgabi`、Core IR exchange form 的规范、版本、校验和前后兼容规则。
- FunctionId、TypeId、资源句柄、签名/效果/schema hash 的规范化算法。
- 原生补丁包、模块重载事务和 compiler-service 请求/响应的版本化协议。
- DataLayout 驱动的 size、align、offset、调用约定、符号性和枚举底层类型模型。
- tsfg 声明与 Zig `extern` 类型/绑定生成器；两端静态断言与运行时握手。
- 独立 contract test kit、二进制 fixtures、fuzzer seed corpus 与旧版本 fixtures。

**阶段验收**：当前格式由真实 writer/reader 通过 fixtures、round-trip、损坏和版本不匹配负例；Windows ABI 与 Zig/C 探针逐字段一致，禁止手写重复布局。Reflection 实现后执行 RF-01；未产生的格式标记待实现。历史兼容仅覆盖已明确支持的版本，多目标探针归 R13。

**依赖**：对应 R01 语义与实际消费者需求；基础格式供 W1，Windows ABI 供 W2，热更协议供 W4，GPU 元数据供 W5，逐项落地。

### R05：类型化字节码、验证器与 Zig 解释器

**目标**：完成稳定、受限、可调试的解释执行路径。

**主要产出**：

- Core IR→寄存器字节码 lowering、常量池、函数签名、异常表、根图和源映射。
- 加载前验证器：类型、CFG、调用、异常区域、资源限额、ABI hash 和能力检查。
- Zig 预解码解释器、紧凑帧、标量专用指令、字段/调用缓存与 superinstruction。
- 唯一公开执行 interface：verified module + FunctionId + 类型化参数帧 + capability table。
- 指令级、函数级、模块级测试，恶意输入 fuzz 和资源配额测试。

**阶段验收**：未经验证模块不能执行；当前子集的实际源码通过正式入口执行并满足 oracle；损坏字节码、越界和资源限额失败可重放。引用/异常一旦支持，其根图、回收与传播测试同时通过。预解码后的进一步缓存和 superinstruction 作为性能任务，不阻挡基础执行正确性。

**依赖**：对应 Core IR、字节码格式及 R06 当前需要的内存/宿主接口；不等待完整 GC/AOT/模块管理阶段关闭。

### R06：Zig Runtime、GC、句柄与宿主能力

**目标**：完成解释器和 AOT 共同依赖的内存与宿主运行时。

**主要产出**：

- 值平面的 allocator/arena/Span/StringView，以及引用平面的对象模型。
- 增量分代追踪 GC：移动年轻代、不移动老年代、写屏障、解释器根表、AOT stack map/statepoint 接入。
- `Handle<T>` 代数校验、资源表、能力表、受管异常与 ABI 异常隔离。
- 模块加载/卸载、静态状态块、生命周期、并发与故障模型。
- 泄漏、悬垂句柄、移动对象、并发 safepoint、OOM 和长帧暂停测试。

**阶段验收**：每个启用的值/引用/句柄/异常能力具备生命周期、OOM、非法访问和根保活测试；Zig 不持有受管裸指针，异常不越过 ABI。移动 GC 加入时必须验证移动后的根与句柄。AOT 根支持与 R07 联合验收，不作为 R07 启动前置；最终补齐架构规定的 GC 和 runtime 能力。

**依赖**：对应 R01 语义与 R04 当前接口；R06 基础接口先供 R05/R07，再联调 AOT GC，消除整阶段循环依赖。

### R07：tsfg MLIR Dialect、优化流水线与 AOT 后端

**目标**：在 Windows 上从同一 Core IR 生成并加载原生制品，保持编译器与 runtime 分离。

**主要产出**：

- `tsfg` dialect 的类型、操作、verifier 和 canonicalization。
- Core IR→tsfg/官方 dialect→LLVM IR lowering；DataLayout、PIC、对象、重定位和调试信息。
- GC statepoint/stack map、热更调用槽、借用和查询操作的 lowering。
- LLD 补丁库链接、目标平台加载所需的对象/导出约定。
- 优化 pass 契约、严格浮点模式、可审计的 pass pipeline 与 miscompile 回归语料。

**阶段验收**：Windows 当前能力切片能生成、链接、加载并调用原生代码，布局符合 R04，lowering/verifier 和 VM/AOT 差分通过。使用引用的 AOT 功能与 R06 一同证明 GC 根正确；runtime 无编译器依赖。其他 OS/CPU 在 R13 扩展；GPU 由 R11 完成。

**依赖**：对应 Core IR、Windows ABI、R02a MLIR/LLVM intake、R06 基础接口；不等待 R06 的 AOT 压力验收。

### R08：双后端执行等价与差分验证平台

**目标**：把“解释器与 AOT 共用语义”变成持续、系统性的证据。

**主要产出**：

- Core IR 级程序生成器、reducer、record/replay 和跨后端 runner。
- 整数、浮点严格模式、trap、控制流、异常、内存和 ABI 的结果比较器。
- 优化级别、目标平台、调试/发布、GC 压力和随机调度测试矩阵。
- fast-math、并行归约、GPU 的单独等价关系和容差/非确定性契约。
- 每个失败样例自动最小化并沉淀为永久回归测试。

**阶段验收**：从首个 AOT 功能起，本轮支持范围的 conformance 在同目标 VM/AOT debug/release 一致；所有差异必须归类或修复。新增双后端 op 必须附差分用例。生成预算、reducer、随机压力逐步加入；跨平台全矩阵在 R13，GPU/并行采用各自关系。

**依赖**：对应 R05/R07 可运行能力；测试框架和 oracle 随实现进入，W2 初始通过后可启动热更及 CPU 计算，不等待全语言/全目标认证。

### R09：FunctionCell 热更新与编译服务

**目标**：完整实现函数级“旧 native → bytecode → 新 native”切换和安全回收。

**主要产出**：

- 稳定 FunctionId/FunctionCell、闭包间接调用、原子发布与版本可见性协议。
- 签名、效果、闭包捕获布局和静态状态 schema 的兼容检查与拒绝诊断。
- 增量编译、对象链接、补丁打包、平台加载和失败回滚。
- 活动帧跟踪、epoch 回收、旧补丁库卸载和进程退出清理。
- schema 变化时显式模块重载/迁移事务；函数级补丁不得暗中执行数据迁移。
- 并发调用、递归、异常、补丁失败、服务崩溃、重复更新和高频更新测试。

**阶段验收**：Windows 真实代码完成旧 native→bytecode→新 native；旧帧完成后才回收，签名/捕获/状态不匹配明确拒绝；并发、失败、超时、乱序、服务崩溃保留上一可用版本。模块迁移单独实现并有回滚测试，完成前只能拒绝；最终功能验收包含迁移能力，runtime 无编译器依赖。

**依赖**：FunctionId/补丁格式、当前执行接口、Windows 加载器、对应差分测试；不依赖全部 R08 平台矩阵或完整生态服务。

### R10：ECS 存储、Query、效果图与 CPU Jobs

**目标**：让数据导向计算成为语言和编译器的一等能力，并完成 CPU 高性能执行路径。

**主要产出**：

- `@component` 固定布局、反射、序列化和 `.tmeta` 生成。
- archetype/chunk/连续列存储，结构变更、实体/组件生命周期和句柄规则。
- `Read<T>`/`Write<T>`/Query 借用 interface、静态读写集合和冲突图。
- `tsfg.query`、`tsfg.chunk`、`tsfg.parallel_for` lowering，循环融合、别名/边界分析和向量化。
- Zig work-stealing JobSystem、确定性/非确定性模式、取消、错误与调试检查。
- 解释执行与 AOT 使用同一用户模型和 `.tmeta`，无手工 Job/Burst 旁路。

**阶段验收**：先验证组件布局、存储和串行 Query，再验证完整访问集合、冲突图、并行/取消/异常与竞争负例；最后针对代表性 workload 加入向量化和有基线的性能验收。每层通过真实源码调用，保持同一用户模型；最终 Windows 验收包含完整 CPU Jobs 能力。

**依赖**：存储可在基础布局/生命周期就绪后开展；串行 Query 依赖当前语言与执行接口；并行依赖效果分析和借用检查；向量化依赖对应 AOT 能力，不等待所有 R08 场景。

### R11：显式 GPU Kernel 与设备后端

**目标**：在同一 tsfg 内核模型上完成选定 GPU 平台的编译、加载、执行与验证。

**主要产出**：

- GPU 可用类型、地址空间、资源、同步、错误和确定性规范。
- Core IR 内核合法性、host/device seam、GPU dialect lowering 与选定设备后端。
- buffer/资源生命周期、上传下载、pipeline/cache、调度和诊断。
- GPU kernel 与热更的版本规则、在途 kernel/fence 处理和旧设备代码回收。
- CPU reference、设备结果比较、shader/kernel 验证和多设备 CI。
- 不支持能力的静态拒绝与运行时 feature negotiation。

**阶段验收**：在选定的一个 Windows 实际设备后端运行真实 kernel，与 CPU reference 按明确数值关系比较；复制显式，非法引用/异常/借用拒绝；device loss、OOM、缓存损坏、在途热更和回收有测试。该单后端属于 Windows 完整功能范围，缺少设备或后端选择时保持未完成；多设备认证后置 R13。

**依赖**：对应 Core IR/元数据、AOT kernel lowering、CPU Query/Jobs、GPU 数值规范和可用真实设备；仅启动 R11 前确定设备范围，不阻挡 CPU 功能。

### R12：开发者工具、包系统、LSP 与调试体验

**目标**：完成真实项目所需的编译、编辑、诊断、调试、包消费和可观测性闭环。

**主要产出**：

- `tsfgc` CLI/build interface、项目清单、模块解析、增量缓存和预编译包格式。
- `tsfg-lsp`：TypeScript Language Service 与 tsfg 语义、内核、ABI、热更诊断合并。
- `.tbc`/`.tmeta`/Core IR 查看器，源映射，解释器/AOT 统一断点、栈帧和变量模型。
- 热更状态、函数版本、GC、Jobs 和设备执行的 tracing/profiling interface。
- Zig 绑定生成和宿主集成样例；兼容升级、包发布与离线构建流程。

**阶段验收**：CLI/诊断/IR 查看与每条执行链同步可用；增量与 clean build 一致。Windows 非平凡项目通过正式工具完成编辑、编译、运行、调试、热更和本地打包；本地预编译包可脱离原始源码消费并拒绝不兼容。公共包分发、服务托管和生态推广后置。

**依赖**：按工具实际消费的能力分别推进：CLI/诊断从 W1，调试随 VM/AOT，热更观察随 R09，GPU 工具随 R11；基础工具不依赖 R02b–R11 全部关闭。

### R13：系统加固、平台认证与完整发布

**目标**：将所有模块收口为可支持、可升级、可复现的完整产品。

**主要产出**：

- 全平台/架构/配置测试矩阵，长稳、并发、OOM、fuzz、安全、性能和确定性基线。
- 制品签名、SBOM、NOTICE、漏洞响应、崩溃符号、遥测边界和发布/回滚手册。
- 跨版本 `.tbc`/`.tmeta`/`.tsfgabi`/包/热更兼容矩阵和迁移工具。
- 发布 runtime 依赖封闭性审计、可复现构建证明和第三方许可证总审计。
- 完整文档：语言、宿主、ABI、性能、调试、部署、升级与故障排查。
- 分层 CI：PR 快速确定性测试，merge 全平台组合，nightly fuzz/stress/performance/GPU，release 全支持矩阵与长稳认证。

**阶段验收**：Windows Functional Complete 后完成明确承诺的发布目标认证、许可证总审计、长期证据、升级与回滚、签名和发布。保留原最低 Windows/Linux、双 VM 与独立复现的要求，在执行认证时按提案重新核对基线；未通过不得宣称 Certified Release。已支持功能的内存/并发安全与负例持续在 R01–R12 验收。

**依赖**：Windows Functional Complete 及发布范围、设备、凭据等真实前置；不反向阻挡 Windows 功能开发。

## 5. 能力里程碑与依赖

R 编号继续表示责任领域；W 编号表示推进和集成顺序。各 W 完成后持续扩展正式实现，不能以阶段样例替代最终功能。

| 里程碑 | 能力与参与领域 | 前置 | 退出条件 |
|---|---|---|---|
| W0 本机基础 | R00 | 无 | R00 本机验收全部通过，Development Ready |
| W1 首条执行链 | R01 子集、R02a TypeScript、R02b、R03、R04 基础格式、R05、R06 基础、R12 CLI | W0 | .ts→Core IR→verified bytecode→Zig 真实执行，含分支、调用、诊断与负例 |
| W2 Windows 双后端 | R02a MLIR/LLVM、R04 ABI、R06/R07 联调、R08 | W1 | 同子集 AOT 可加载，VM/AOT 比较通过，Zig ABI 探针通过；尽早验证 statepoint/移动根和热更加载风险 |
| W3 完整语言与 runtime | R01–R08 通用 Windows 语言范围，R12 调试 | W2 | 通用语言支持矩阵无遗留待实现项；泛型、值/引用、闭包、异常、模块、GC 在两后端完整测试；计算领域扩展另在 W4/W5 收口 |
| W4 热更与 CPU 计算 | R09、R10、对应 R03/R04/R08、R12 | W2 中所需能力；完整验收须 W3 | 原生/解释/原生切换与回收、显式迁移、ECS/Query/Jobs/向量化及其正确性和性能证据 |
| W5 单 GPU 与工具收口 | R11、R12 | W4 对应 CPU/元数据能力 | 选定 Windows 设备真实 kernel、错误恢复、调试与本地包消费；设备缺失保持未完成 |
| W6 Windows 功能完成 | R01–R12 功能与适用 Source 约束 | W3、W4、W5 | 非平凡项目从编辑到运行、调试、热更、CPU/GPU 计算、本地打包；无绕行，Windows Functional Complete |
| W7 平台与发布 | R13 | W6 | 完成承诺平台及发布认证，Certified Release |

早期高风险验证可与功能切片并行，但单独记录探索结果，不声称尚未实现的能力已完成。R06 AOT 根与 R07 GC lowering 联合验收，R08 随首个 AOT 切片接入。串行 ECS 可以早于热更完成；基础 CLI 不等待 GPU。

## 6. 系统级验证门

原 G 编号保留，含义调整为下表。G1 对每个真实格式增量执行，不要求先实现所有未来格式；G2/G3 随能力重复，最终覆盖完整支持矩阵。

| 门 | Windows 开发阶段 | 完整关闭条件 |
|---|---|---|
| G1 契约 | 当前格式读写、版本拒绝、必要 Windows ABI 探针、适用 RF-01 | W6 使用的全部实际格式和元数据已覆盖 |
| G2 语义 | 当前子集源码到验证后字节码执行 | W3 通用语言 corpus 通过；W4/W5 加入领域语义，W6 全部收口 |
| G3 双后端 | 同目标 VM/AOT 当前能力差分 | W3 通用 Windows 语义通过；W4/W5 按各自等价关系补领域验证，W6 收口；多目标认证归 W7 |
| G4 热更 | Windows native→bytecode→native 与旧帧回收 | W4 并发、失败、重载/迁移与回滚通过 |
| G5 游戏计算 | 先 CPU 串行/并行，再单 GPU | W5 正确性、资源故障和声明的性能门槛通过 |
| G6 产品 | W6 非平凡项目端到端 | 分别记录 Windows Functional Complete 与 W7 Certified Release，不互相代替 |

每次验收记录源码/工具/目标/选项、命令、实际结果和失败重放方法；随机测试记录种子，生成物记录相应摘要，性能测试记录基线。诊断测试不强制生成制品，普通功能票不要求无关性能或发布证据。

## 7. 任务与实施流程

- 已批准范围直接实施；只为当前切片未决且影响正确性的问题补充设计。grill、spec、ticket 用来解决具体不确定性，不要求每张普通票重复完整访谈。
- 按 ECP-0002 连续完成范围内的实现、测试、修复和证据闭环；仅在具体权限、产品取舍或工程边界缺口处请求决策。符合全部委托条件的同仓开发契约不逐次等待人类批准；测试失败和已批准选择不自动产生人工门。操作系统权限、工具审批与任务授权分别核验。
- 每张实现票列出：Repository、Status、Blocked by（具体票号）、用户能力、输入与输出、适用规则、负例、验收命令、证据位置和明确非目标。
- 只有当前切片的规范及接口未决才阻断该切片；远期功能可以保留待设计。规划票使用 needs-triage，不作为已批准实现票。
- 同仓开发格式可以原子更新；实际跨仓或受支持版本才要求兼容扩展、迁移与旧路径移除。保留正式接口测试，不依赖未合入 worktree 的隐式路径。
- 本机测试通过不代表 CI/protection 已改变。执行门禁调整有单独实施票；远端写入、权限与发布按具体授权处理。
- 完成记录区分：本次实现已验收、待实施、延期认证、不适用。未完成不得勾选；原票迁移用 wontfix 加 successor 链接保留历史。
- 新功能仍用正式模块和可维护源码。原 smoke 仅为工程探针，不充当语言、Runtime 或 Reflection 实现。

## 8. 仓库与协作

产品自研 contracts/compiler/runtime/tooling 留在一个 tsfg 仓。Manifest Repository 和 Agent Infrastructure Repository 继续独立；经批准且实际消费的 upstream 保持同级 fork、完整 OID、来源与许可证记录。名称、锁文件及既有历史不因阶段调整重建。

并行工作围绕当前里程碑的独立能力，给每个工作者明确写入范围；用 fixtures 或显式集成分支联调。同仓原子更改无需为协作而制造额外发布。未来源码接入按实际需要审批，纯参考方法不建立虚假依赖。

## 9. 认证与资源决策

本机可直接验证 Windows 功能；Linux/WSL 是辅助或后置目标，不是 Windows 开发前置。原 Windows 11 24H2、SDK 26100、Debian 12/glibc 2.36/kernel 6.1 与 x86-64-v2 记录为后置认证基线；在 W7 开始时核对支持状态，变更走 ECP，不能冒称当前宿主已证明最低版本。

GPU 选择只阻断对应 R11 工作；签名、发行、长期兼容、设备矩阵、第三方许可证不确定项只阻断各自工作。已进入源码的来源/许可证不明仍阻断合入。开发基础不要求新的云资源、镜像或发行证书。

首次 Stable 的不可变身份、Owner 与 default 提交点规则继续保留；R00 不再要求首次 Stable。版本文件和既有 tag/snapshot 不随文档重构改写，正式产品版本在 W7 按真实状态确定。

## 10. 迁移与下一步

1. 保留旧规范与验收历史，应用 ECP-0001。
2. 本地任务：R00 原 17/18 的认证发布工作迁往 R13；原 19 拆为本机验收与未来发布收口；旧 Linux/矩阵成果继续可用，不要求重做。
3. 执行新的开发流程对齐票，清点实际 CLI、缓存、路径与 CI 默认门禁。文档不自动解除现有 required checks。
4. 执行 R00 本机验收，逐项链接证据；全部通过后记录 Development Ready。
5. 从 W1 的真实源码执行切片进入 R01–R12，按能力推进至 W6，再开展 W7。
