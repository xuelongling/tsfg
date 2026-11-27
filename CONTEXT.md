<!-- SPDX-License-Identifier: MIT -->

# tsfg Context

tsfg 是面向游戏计算的静态语言与工具链，以官方 TypeScript 前端和语言基线为基础，只引入明确的必要差异及 tsfg Syntax Extension；复用语言规则不表示提供 JS 运行时或完整 TypeScript 生态兼容。

## Language

**tsfg Program**:
使用 TypeScript 语法基础及已规定的 tsfg Syntax Extension、通过 tsfg 静态语义检查并按 tsfg 运行时语义执行的程序。
_Avoid_: TypeScript program, JavaScript program, TS script

**tsfg Syntax Extension**:
为满足已有 TypeScript 表达无法充分承载的实际 tsfg 需求而明确规定的语法扩展；不表示继承 JS 执行行为或允许任意语法差异。
_Avoid_: Undocumented parser exception, new keyword without a language need

**Compile-time Marker**:
为不能由已有类型或分析结果充分表达的 tsfg 声明意图提供的少量静态标记；其语义由 tsfg 规定，不等同于运行用户 decorator 函数。
_Avoid_: General decorator runtime, arbitrary macro, duplicated inferred layout or effects

**Sealed Reference Type**:
由 tsfg GC 管理的普通 class 类型，字段集合及单继承关系在编译期封闭，允许规定的派生与方法覆写；运行时对象身份不等于源码类型必须使用名义赋值规则。
_Avoid_: Arbitrarily extensible JS object, fixed-layout value type, inheritance always forbidden

**Execution Equivalence**:
同一 tsfg 程序在解释器与同目标 AOT 严格模式下必须满足的结果关系：整数、trap 与控制流完全一致，浮点结果按位一致；fast-math、并行归约与 GPU 不属于该严格关系。
_Avoid_: Approximately equivalent, usually identical

**FrontendSnapshot**:
特定源码输入与前端配置对应、独立拥有且不可变的 tsfg 前端分析数据，提供当前能力范围内的源码、符号、类型与诊断事实；不依赖上游会话存活，也不暴露 Program、AST、Checker 和缓存细节。
_Avoid_: TypeScript Project Snapshot, source intake probe output, tsfg HIR

**tsfg HIR**:
表达 tsfg 程序高层语义的程序表示，保留源位置、高层类型、泛型、空值收窄、闭包和异常含义；不同于只提供前端分析事实的 FrontendSnapshot。
_Avoid_: FrontendSnapshot, TypeScript AST, backend IR

**tsfg Core IR**:
完成语言语义归一化、具有显式控制流与类型的 SSA 程序表示，是字节码与原生后端共同消费的语义中枢；它不等同于运行时字节码或后端的 MLIR 表示。
_Avoid_: TypeScript AST, VM-only semantics, AOT-only semantics

**Compilation Closure**:
一次 tsfg 编译所覆盖的明确输入、模块初始化、可调用入口及其依赖和可达特化实例组成的完整程序范围，包含宿主回调、热更和内核入口。
_Avoid_: Main-only call graph, entire filesystem, runtime generic discovery

**Host Semantic Contract**:
正式宿主绑定对特定原生实现提供的版本化调用语义约束，描述其借用、回调保留和效果，构成 tsfg 跨宿主分析的明确可信输入。
_Avoid_: ABI signature alone, source comment as proof, capability grant

**Published Call Contract**:
tsfg 可替换函数对调用方发布并保持稳定的调用语义上界；实际实现须满足该上界，它不等同于当前函数体的推导摘要。
_Avoid_: Current body summary, silently expanded effects, directional hash match

**tsfg String**:
tsfg 引用平面中的不可变文本值，具有既定 TypeScript UTF-16 码元可观察语义并允许孤立代理码元；不等同于严格 UTF-8 字节视图。
_Avoid_: JavaScript String wrapper, UTF-8 byte length as logical length

**StringView**:
tsfg 原生边界上按字节长度描述的严格 UTF-8 受控借用视图，其有效性受来源寿命和借用范围约束。
_Avoid_: Arbitrary managed string pointer, WTF-8 interchange, retained unowned bytes

**tsfg Array**:
连续同构、共享容器身份的密集向量；普通下标读取有效元素返回元素类型 T，缺失索引触发语义 trap。
_Avoid_: JavaScript sparse array, missing-read undefined sentinel, unchecked native load

**Span Borrow**:
tsfg 的 Span 或 ReadSpan 对特定拥有者有效元素范围的借用关系，活跃期间保持所借容器结构稳定；只读视图不表示冻结全部可写别名。
_Avoid_: Owned container, copied snapshot, global readonly freeze

**值平面**:
承载固定布局值、组件、借用视图和原生容器的内存领域，不包含受管对象或隐式装箱。
_Avoid_: 引用平面, JS 对象存储

**引用平面**:
承载由 tsfg GC 管理的普通类对象、闭包环境和字符串的内存领域。
_Avoid_: 值平面, Zig 持有的受管裸指针

### Language Conformance

**Language Rule**:
规定 tsfg 源程序合法性或执行含义的规范条款，以稳定 Rule ID 标识。
_Avoid_: Backend convention, TypeScript acceptance implies tsfg acceptance

**Conformance Corpus**:
关联 Language Rule 的 tsfg 正例、负例及其 Semantic Oracle 的语料集合。
_Avoid_: R00 smoke tests, backend agreement alone

**Semantic Oracle**:
独立于被测实现、用于裁决 tsfg 行为是否符合 Language Rule 的规范预期，包括类型化结果、必要的可观察效果、trap 或编译诊断。
_Avoid_: Current compiler output, JavaScript reference execution, VM/AOT agreement

**Diagnostic Code**:
tsfg 编译诊断的稳定机器身份，与所涉及的 Language Rule 关联，不等同于可修改的错误文案。
_Avoid_: TypeScript diagnostic number, Rule ID, error message text

**Trap Code**:
tsfg 执行 trap 的稳定机器身份，与所涉及的 Language Rule 关联。
_Avoid_: Compiler diagnostic, process exit code, backend exception text

**Semantic Fuel**:
以 VM/AOT 共同遵守的语义计费点衡量的 tsfg 执行预算，不随后端物理指令数变化。
_Avoid_: Bytecode instruction count, native instruction count, wall-clock timeout

**Execution Abort**:
因物理时限或内存限额等执行条件而中止的 tsfg 执行结果，不构成语言 Semantic Oracle 所要求的正常返回或语义 trap。
_Avoid_: Semantic Fuel trap, successful conformance, host process crash

**Managed Exception**:
tsfg 受管逻辑层中的语言异常通道，不跨越 Zig ABI 或进入计算内核，与语义 trap 和物理执行中止相区分。
_Avoid_: Trap Code, Execution Abort, native ABI exception

## Engineering Integration

**Source Intake**:
将特定外部来源转为已批准、可审计且可从锁定源码重建的工程输入的接入过程；按实际消费者分别验收，不等同于创建 Upstream Fork 或下载发行产物。
_Avoid_: Repository exists, binary package installed, all candidate upstreams admitted

**Intake Ledger**:
按文件关联外部来源、上游基线身份、许可证、本地修改及对应验证依据的来源审计记录。
_Avoid_: Repository license alone, detached patch queue, generated artifact inventory alone

**Development Ready**:
Windows 本机工程基础已通过 R00 验收、可以开展语言和运行时功能开发的状态；不表示最低平台认证或发布完成。
_Avoid_: Stable, all-platform certified

**Windows Functional Complete**:
tsfg 的完整 Windows 功能范围已通过真实项目验收的状态，包含语言、双后端、运行时、热更、CPU 游戏计算、选定单 GPU 后端和本地工具。
_Avoid_: Initial language subset, smoke success, Certified Release

**Certified Release**:
在已完成功能之外，对明确承诺的平台、兼容范围和发布流程形成完整验证证据的产品发布状态。
_Avoid_: Local build passed, Development Ready

**Contracts Seam**:
tsfg 内部隔离契约生产者与消费者的可版本化边界。它是源码 interface 与兼容性边界，不以独立 Git 仓库为成立条件。
_Avoid_: Contracts repository, shared internals

**Engineering Change Proposal**:
用于记录工程边界变化、适用范围、取舍与决策授权的版本化提案；不是普通实现票。已批准的有限委托可覆盖一类开发变化，而不扩大受支持契约或发布权限。
_Avoid_: Implementation ticket, ADR for every change, post-hoc justification

**Integration Manifest**:
由 Manifest Repository 版本化并交给 Google `repo` 工具的精确集成记录。它以完整 Git commit OID 锁定 `tsfg`、Agent Infrastructure Repository 与参与构建的同级 Upstream Fork；特性分支名只提供协作和来源线索，不构成集成身份。
_Avoid_: Commit manifest, branch manifest, latest-compatible set

**Manifest Repository**:
只保存 Google `repo` 编排元数据的独立 Git 仓库，规范远端为 `https://github.com/xuelongling/manifests.git`，在 Repo Workspace 内由 `repo` 管理的本地工作检出为 `.repo/manifests`。它不包含 tsfg 产品源码。
_Avoid_: Integration repository, product repository, manifest branch in tsfg

**Agent Infrastructure Repository**:
保存 Repo Workspace 级 agent 指令、上下文索引、skills、MCP server 可维护源码与锁文件、非机密配置模板、hooks、插件清单和相关测试的独立 Git 仓库，规范远端为 `https://github.com/xuelongling/.agents.git`，项目检出路径为 `.agents`。它不保存 token、client secret、OAuth 会话、`auth.json`、个人绝对路径、缓存、日志或只有生成产物而没有可维护源码的 MCP；源码归属不等于 Codex 运行时发现路径。
_Avoid_: Workspace Policy Repository, Product documentation repository, duplicated root policy, credential store

**Agent Activation Surface**:
Repo Workspace 根目录下 Codex 实际发现的 agent 入口：根 `AGENTS.md`、原位的 `.agents/skills`、根 `.codex/config.toml` 与根 `.codex/hooks.json`。除 skills 外，这些入口由 Integration Manifest 的 `linkfile` 从 Agent Infrastructure Repository 暴露；Codex 必须从 Repo Workspace 根目录启动并信任该 workspace，才承诺加载完整 workspace 级 agent 基础设施。
_Avoid_: Agent source repository, per-repository copy, machine credential store

**Upstream Fork**:
从外部上游源码派生、独立版本化并由 Google `repo` 在 `tsfg` 同级检出的 Git 仓库。GitHub 仓库保留上游 slug 和 fork network，本地路径规范化为 ASCII 小写 kebab-case；tsfg 专用修改直接提交到该 fork 的特性分支，可重放组合以 Integration Manifest 中的完整 commit OID 为准。未经 R02a 批准的 fork 不进入集成 manifest；R00 bootstrap 不预建未消费来源的 fork，也不创建 Stable default。
_Avoid_: tsfg module, vendored directory, floating upstream, tsfg-upstream prefix

**Repo Workspace**:
由一份 Integration Manifest 通过 Google `repo` 工具物化的多 Git 工作区，其中 `tsfg` 与所有 Upstream Fork 位于同一层级。
_Avoid_: Monorepo, nested dependency checkout

**Contract Set**:
某个集成组合中所有 contract family 的规范映射，每个 family 独立记录 Contract SemVer 与规范化 Schema Hash；Contract Set ID 是该排序映射的派生哈希。
_Avoid_: Product version, manually assigned contract-set version

**Contract Registry**:
产品仓 `contracts/registry.json` 中 contract family 的唯一注册表。每项记录稳定 family ID、Contract SemVer、Schema Hash 算法和值、兼容类别、规范/schema/fixture 路径、producer、consumer、Contracts Owner、支持窗口和弃用状态；Contract Set 只能从该注册表派生。
_Avoid_: Handwritten contract set, version duplicated in consumer, schema-only ownership

**Contract Change Class**:
对 contract 规范、schema 和 fixtures 变化的兼容分类：编辑或测试增补为 patch，向后兼容扩展为 minor，破坏性变化在 1.0 后为 major；已承诺支持的 1.0 前版本发生破坏性变化仍须增加 minor 并遵守扩展—迁移—移除和两个稳定 minor 窗口；未承诺兼容的同仓开发格式可在版本决定后原子更新并拒绝旧输入。exact-match seam 的任何规范变化都产生不兼容新版本。
_Avoid_: SemVer zero means no compatibility, schema hash alone, unversioned semantic change

**Reproducibility Set**:
在相同 Build Identity 下必须逐字节一致的全部未签名发布 payload，包括程序、库、调试符号、归档内容和包内 metadata。签名、可信时间戳、运行日志与外部 attestation 是 sidecar，不属于该集合。
_Avoid_: Entire CI output, signed release bundle

**Bootstrap Trust Root**:
在可复现构建边界开始前，用于物化 Repo Workspace 的 Git、Python 与 Google `repo` 所构成的受信工具基础。它们不参与产物生成，安装方式可以是满足既定信任约束的人工或自动化流程。
_Avoid_: Toolchain closure, build dependency

**Integration Snapshot**:
由规范 Manifest Repository URL、完整 manifest commit OID 和 manifest 文件名确定的不可变 Repo Workspace 组合；其中包括 `tsfg`、Agent Infrastructure Repository 与所有参与集成的 Upstream Fork，每个项目都锁定完整 commit OID。
_Avoid_: Branch tip, latest manifest, local checkout state

**Bootstrap Integration Snapshot**:
首个 Stable Integration 产生前唯一允许作为 CI 基线的不可变 Integration Snapshot。R00 将它保存为 `bootstrap/r00.xml`，初始化同时锁定 Manifest Repository 的完整 commit OID 和该文件名；它不是 Stable，不能由 `default.xml` 暗示为 Stable。
_Avoid_: Bootstrap branch tip, provisional default, fake stable

**Candidate Overlay**:
CI 针对固定基线 Integration Snapshot 生成的内容寻址项目替换映射，以完整 commit OID 替换一个或多个候选 project；通常以当前 Stable 为基线，首个 Stable 前以 Bootstrap Integration Snapshot 为基线。CI 必须归档 overlay、解析后的完整 manifest 及其哈希。失败候选可以随证据保留期过期，晋升 Stable 或需永久保存的协调组合必须进入 Manifest Repository。
_Avoid_: Floating PR branch, developer local manifest, permanent manifest for every failed PR

**Build Input Set**:
从解析后的 Integration Snapshot、Candidate Overlay 和 `eng/build-inputs.json` 派生、会影响发布 payload 的文件集合。每项以 project ID、仓库相对路径、规范 mode 和文件字节 SHA-256 标识并排序后摘要；完整项目 OID 进入 provenance 而不直接进入该摘要。Agent Infrastructure Repository 的文档、skill 与 MCP 默认不属于 Build Input Set；R00 中被实际编译或控制编译的 `tests/r00/**` 文件必须显式列入，构建读取任何未声明文件必须失败。
_Avoid_: Entire workspace state, ambient PATH, undocumented input

**Canonical JSON Digest**:
对 I-JSON 数据执行 RFC 8785 JCS 后计算的 SHA-256，表示为 `sha256:<64位小写十六进制>`。Contract Set、Candidate Overlay、Build Input Set、Toolchain Closure projection、Artifact Manifest 与版本元数据统一使用它；文件名中的前 16 位仅是展示缩写。
_Avoid_: Pretty-printed JSON hash, locale sort, truncated identity

**Toolchain Closure**:
构建可读取的完整工具集合及其依赖闭包。R00 初始闭包锁定 Zig 0.16.0、LLVM/Clang/LLD 22.1.6、CMake 4.4.3、Ninja 1.13.2、Node.js 24.20.0 LTS、pnpm 11.25.0，以及目标平台 sysroot/SDK；每个分发物以内容摘要和解包 tree hash 标识，生态依赖以权威 lock digest 标识，选定 target 的规范 projection 经 JCS 生成 Toolchain Closure digest，系统 PATH 不提供回退。
_Avoid_: Installed toolchain, latest stable, runner image contents

**Build Profile**:
跨构建系统统一解释的 `debug` 或 `release` 配置。`debug` 保留完整调试信息、断言和安全检查且不优化；`release` 使用安全发布模式与 `-O2`，保留边界/安全检查并生成 detached symbols；二者都禁止 LTO、PGO、fast-math 和本机 CPU 调优。
_Avoid_: CMake build type alone, arbitrary compiler flags, production-fast profile

**Build Identity**:
由 Build Input Set digest、target、build profile、影响产物的构建选项、规范化 `source_date_epoch` 和 Toolchain Closure digest 共同确定的构建身份。`source_date_epoch` 是每个 Build Input Set entry 对应路径的 last-touch commit 的 committer timestamp 最大值。同一 Build Identity 对应一个 Reproducibility Set。
_Avoid_: Product version, CI run number

**Artifact Manifest**:
发布包内规范化的 `artifact-manifest.json`，记录完整 Build Identity、Build Input Set、Contract Set ID、工具链摘要以及除自身外每个包成员的完整 SHA-256。它属于 Reproducibility Set，不能含墙钟时间、CI run ID、主机名或绝对路径；它自身和完整归档的摘要由包外 checksums 与 Release Evidence 记录。
_Avoid_: CI metadata, release page, unsigned sidecar

**Hermetic Build Entry**:
逻辑命令 `tsfg-build` 的版本化控制面，公开 `prefetch`、`verify-workspace`、`build`、`test`、`package` 与 `repro-check` 六个子命令。只有 `prefetch` 允许联网；其余命令使用净化环境和锁定缓存，缺失输入时 fail closed。
_Avoid_: Individual build-system command, developer shell environment, network fallback

**Build Report**:
`tsfg-build --report <path>` 原子写入的版本化 JCS-compatible JSON sidecar，记录命令、Build Identity、输入/输出摘要、网络模式、dirty 状态、耗时与稳定错误类别。它不属于发布 payload，也不替代 Artifact Manifest。
_Avoid_: Mixed stdout protocol, partial success file, artifact metadata

**Offline Proof**:
prefetch 后在受外部网络隔离且 canary 已证明无法联网的环境中执行 build/test/package 的证据。Linux hosted build 使用 network namespace，最低运行基线另在 Debian 12/kernel 6.1 VM 验证；Windows PR 使用进程级出口阻断，R13 平台认证和相应 Stable 晋升还必须在 Windows 11 24H2、虚拟网络层断网的两个临时 VM 中重演。
_Avoid_: Empty proxy variables, warm cache hit, build made no observed requests

**Stable Integration**:
由 Release Owner 晋升、绑定不可变 Product Version 的 Integration Snapshot。
_Avoid_: Latest successful branch build

**Candidate Integration**:
由 CI 实际验证的固定基线 Integration Snapshot、Candidate Overlay、解析后完整 manifest 及其哈希共同确定的精确候选组合；首个 Stable 前的固定基线是 Bootstrap Integration Snapshot。
_Avoid_: Pull request branch tip, latest stable

**Promotion State**:
集成组合从 `Candidate` 经 `Verified Candidate`、`Promotable` 到 `Stable`，随后只能成为 `Superseded` 或 `Withdrawn` 的单向状态。回滚创建新 manifest commit 指回既有 Stable，不移动 tag 或修改历史 snapshot。
_Avoid_: Mutable release, CI auto-promotion, deleted bad release

**Release Evidence**:
晋升前以内容寻址 provisional evidence bundle 保存解析后 manifest、Artifact Manifest、checksums、许可证报告与 repro-check 结果。不可变 snapshot 与产品 tag 确定后，把其精确身份和预发布材料写入不属于该 tag 的 `docs/releases/<version>.md`；`default.xml` 提交完成晋升后，该记录与 GitHub Release 转为长期 Stable evidence。普通 Candidate 的相应证据保留 90 天。
_Avoid_: CI green badge, transient log only, mutable latest artifact

**Workspace Verification**:
在 `repo sync` 后将 Manifest Repository HEAD、manifest 文件名、项目集合、每个实际 HEAD、remote URL、dirty state，以及 manifest 管理的 Agent Activation Surface 的链接类型、规范 target、workspace 内解析位置和内容身份逐项核对的校验。`repo sync --verify` 只涉及 post-sync hook，不构成 Workspace Verification。
_Avoid_: Successful sync, post-sync hook verification, branch-name comparison

**R00 Smoke Target**:
位于 `tests/r00/`、只用于证明 CMake/Ninja/Clang/LLD 与 Zig 两条独立构建路径、打包、符号和可复现性闭环的非公开目标。实际参与 smoke payload 或控制其构建的文件是 R00 临时 Build Input；其余测试与测试报告仍不是 Build Input。它不建立语言功能、产品 API 或尚未由 R04 定义的 C/Zig ABI，可在正式模块接管后删除。
_Avoid_: Product runtime, public compiler CLI, prototype contract
