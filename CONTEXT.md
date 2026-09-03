# tsfg Context

tsfg 是面向游戏计算的独立静态语言。它采用 TypeScript 语法与部分类型工具，但不承诺 ECMAScript 运行时或 TypeScript 生态兼容。

## Language

**tsfg Program**:
使用 TypeScript 语法、通过 tsfg 静态语义检查并按 tsfg 运行时语义执行的程序。
_Avoid_: TypeScript program, JavaScript program, TS script

**Execution Equivalence**:
同一 tsfg 程序在解释器与同目标 AOT 严格模式下必须满足的结果关系：整数、trap 与控制流完全一致，浮点结果按位一致；fast-math、并行归约与 GPU 不属于该严格关系。
_Avoid_: Approximately equivalent, usually identical

## Engineering Integration

**Contracts Seam**:
tsfg 内部隔离契约生产者与消费者的可版本化边界。它是源码 interface 与兼容性边界，不以独立 Git 仓库为成立条件。
_Avoid_: Contracts repository, shared internals

**Engineering Change Proposal**:
位于 `tsfg/docs/proposals/`、用于在实现前评审工程边界变化的版本化提案。仓库拓扑、Build Identity/Build Input Set、Tier 1、工具链 major/minor、contract schema/兼容窗口及发布安全边界的变化必须经过该流程；普通实现和补丁版工具升级不需要提案。
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
从外部上游源码派生、独立版本化并由 Google `repo` 在 `tsfg` 同级检出的 Git 仓库。GitHub 仓库保留上游 slug 和 fork network，本地路径规范化为 ASCII 小写 kebab-case；tsfg 专用修改直接提交到该 fork 的特性分支，可重放组合以 Integration Manifest 中的完整 commit OID 为准。未经 R02a 批准的 fork 不进入 R00 `default.xml`。
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
对 contract 规范、schema 和 fixtures 变化的兼容分类：编辑或测试增补为 patch，向后兼容扩展为 minor，破坏性变化在 1.0 后为 major；1.0 前的破坏性变化虽增加 minor，仍必须完成扩展—迁移—移除和两个稳定 minor 窗口。exact-match seam 的任何规范变化都产生不兼容新版本。
_Avoid_: SemVer zero means no compatibility, schema hash alone, unversioned semantic change

**Reproducibility Set**:
在相同 Build Identity 下必须逐字节一致的全部未签名发布 payload，包括程序、库、调试符号、归档内容和包内 metadata。签名、可信时间戳、运行日志与外部 attestation 是 sidecar，不属于该集合。
_Avoid_: Entire CI output, signed release bundle

**Bootstrap Trust Root**:
在可复现构建边界开始前，按 Manifest Repository 的 README 人工安装并用于物化 Repo Workspace 的 Git、Python 与 Google `repo`。它们不参与产物生成；物化完成后必须验证所有项目的完整 commit OID。
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
prefetch 后在受外部网络隔离且 canary 已证明无法联网的环境中执行 build/test/package 的证据。Linux hosted build 使用 network namespace，最低运行基线另在 Debian 12/kernel 6.1 VM 验证；Windows PR 使用进程级出口阻断，R00 关闭和 Stable 还必须在 Windows 11 24H2、虚拟网络层断网的两个临时 VM 中重演。
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
