<!-- SPDX-License-Identifier: MIT -->

# R00：工程章程与 Windows 本机开发基础

状态：**Windows 优先规则已批准；Development Ready 待本机验收**
日期：2026-09-07
范围：R00 本机工程门；保留 R13 发布认证规则并明确其适用范围
上位事实来源：`tsfg-architecture.md`、`tsfg-roadmap.md`

本文依据 [ECP-0001](proposals/0001-windows-first-development.md) 区分本机开发、Windows 功能完成与正式发布。本文中的“必须”“禁止”描述相应阶段的目标，不表示已实现或已验收。R00 关闭只采用 §16 本机门；发布段不再反向阻断功能开发。既有工作流/required checks 在单独实施迁移前仍有效，本次仅改规范。

开发执行与有限委托按 [ECP-0002](proposals/0002-bounded-autonomous-development.md)；该提案不授予发布或系统权限，也不表示受限执行会话已实现。

R02a 本机源码开发的执行方式按 [ECP-0004](proposals/0004-local-development-execution.md)：`--dev` 路径不以 OS 强隔离/UAC 为前置，保留工具锁、输入完整性和 E: 落点，并明确不提供强隔离证明。其他适用阶段规则不变。

## 1. 切换前仓库事实

以下事实记录 2026-09-03 命名切换前的迁移 provenance：

- workspace 根 `E:\ws\pro_tsfg` 不是 Git 仓库；唯一已检出的 Git 仓库是子目录 `tcfg`。
- 本地产品仓 HEAD 为 `6721f81847357400c3cdcd795b79fb7764853d0e`，`origin` 仍是 `https://github.com/langofgame/tcfg.git`。
- 基线 HEAD 只跟踪 `.gitignore`、`LICENSE`、`README.md` 与旧名架构文档。
- `CONTEXT.md`、`docs/adr/` 与旧名 roadmap 文档在基线中尚未跟踪。
- 仓库没有可维护产品源码、构建入口、锁文件、CI、测试、schema 或已验证 dist；不能从产物名称或 `.gitignore` 推断这些能力存在。
- 仓库尚未跟踪 `.gitattributes`；当前用户级 Git 配置为 `core.autocrlf=true`，因此 §12.1 的 LF/CRLF 规则也尚未由仓库强制执行。
- `https://github.com/xuelongling/tsfg`、`https://github.com/xuelongling/manifests.git` 与 `https://github.com/xuelongling/.agents.git` 已存在，main 分别为：
  - `b718c3b22661387e9bc621d4d14915dd1115c77f`
  - `2e33d79e102ac4da2d3af0a0a87ac93ddef2714f`
  - `25874cef7505a0c9dca08dd3a84e879d85eafea6`
- 上述三个远端只有初始化内容；尚未证明当前身份对它们具有写入、设置保护规则或创建环境的权限。

以上只保留切换前历史，不是 2026-09-07 当前仓库盘点或再次执行切换的指令。已有实现与结果按原票保留；新本机验收完成前 R00 仍未验收通过。

## 2. 范围与非目标

R00 必须建立后续任务共享的：

- 工程与变更治理规则；
- 多 Git workspace 的精确物化与验证；
- 平台、版本、契约和发布基线；
- 锁定工具链、依赖来源和 hermetic build 控制面；
- Windows 本机基础检查、适用契约负例、输入身份/本机复现证据和许可证门禁。

R00 不要求取得 Stable、最低 OS/双 VM 或完整平台矩阵。已实现的 Linux 与发布设施保留为后续资产，未来正式发布按 R13 验收。当前用户指定的所有新增软件、下载、数据、临时文件、缓存、日志与工作目录必须位于 E 盘；发现工具默认写 C 盘时先重定向，不能先执行再清理。

R00 不实现语言语义、TypeScript 前端、Core IR、正式 ABI、VM、GC、热更新、GPU 或产品工具。R00 也不批准或迁入任何上游 fork；这属于 R02a。

## 3. 规范名称与仓库边界

### 3.1 名称

语言、产品、本地目录、文档、命令和产品扩展名的规范前缀统一为 `tsfg`。现有 `tcfg` 名称仅在切换前路径、旧 remote 或历史 provenance 中保留。

### 3.2 规范远端

| 角色 | 规范远端 | workspace 路径 |
|---|---|---|
| 产品仓 | `https://github.com/xuelongling/tsfg` | `tsfg/` |
| Manifest Repository | `https://github.com/xuelongling/manifests.git` | `.repo/manifests`（由 `repo` 管理） |
| Agent Infrastructure Repository | `https://github.com/xuelongling/.agents.git` | `.agents/` |
| 经批准的 Upstream Fork | `https://github.com/xuelongling/<upstream-slug>` | 与 `tsfg/` 同级的小写 kebab-case 路径 |

产品自研内容必须留在单一 `tsfg` 仓，不拆出 contracts/compiler/runtime/tooling 仓。Manifest 与 agent 基础设施是控制仓例外。外部 fork 必须保持独立 Git 历史，tsfg 修改直接提交到 fork 特性分支；集成身份只认完整 commit OID。

GitHub fork 保留上游 slug 和 fork network，本地路径使用 ASCII 小写 kebab-case。禁止 `tsfg-upstream-*` 命名。未经 R02a 批准的 fork 不进入 R00 的 default manifest。

### 3.3 产品仓一级目录

```text
contracts/   contract registry、schema、fixtures
compiler/    编译器产品源码
runtime/     Zig runtime
tooling/     LSP、调试、查看与包工具
eng/         tsfg-build、锁文件、CI/build 控制面源码
tests/       跨模块和阶段验收
docs/        架构、roadmap、ADR、proposal、release evidence
third_party/ 许可证与 provenance 元数据，不保存同级 fork 副本
out/         未跟踪本地输出
```

不建立 `src/` 总目录。产品、构建、契约与集成 ADR 归 `tsfg/docs/adr`；纯 agent 运行机制 ADR 归 `.agents/docs/adr`。根目录入口不得形成第三份事实源。

## 4. Repo Workspace 与 manifest

### 4.1 Bootstrap Trust Root

Git、Python 和 Google `repo` 只负责物化 workspace，不参与发布 payload 生成。Manifest Repository 的 README 必须记录可重跑的安装与初始化契约；按 ECP-0002 的来源、完整性、授权与 E 盘约束允许自动准备和初始化脚本，不要求人工逐条输入。实际脚本及 README 对齐另行实施，不因本条修改而视为已存在。

README 必须固定下载的 `repo.py` SHA-256，并用 `repo init --repo-rev=<固定发布版本>` 锁定 repo 自身。初始化命令还必须同时给出规范 Manifest Repository URL、完整 manifest commit OID 与 manifest 文件名；禁止以 manifest branch tip 作为可重放入口。Windows wrapper 保留：`init` 默认添加 `--worktree`，`sync` 默认添加 `--verify`。规范流程禁止 `--no-verify` 与 `--no-repo-verify`。

R00 不设置 post-sync hook；`repo sync --verify` 不构成项目 OID 校验。

### 4.2 manifest 结构

- 首个 Stable 产生前，唯一规范基线是 Manifest Repository 某一完整 commit OID 上的不可变 `bootstrap/r00.xml`；README 必须以 `-b <完整 manifest commit OID> -m bootstrap/r00.xml` 初始化。它是 Bootstrap Integration Snapshot，不是 Stable。
- `default.xml` 只在首个 Stable 晋升的提交点创建，此后必须始终解析为当前 Stable Integration；首次 Stable 前禁止发布伪造的 default。
- `snapshots/tsfg-v<semver>.xml` 保存待晋升或已晋升的版本快照；文件一旦合入 main 就不得修改、删除、重命名或复用版本名。
- 所有 project `revision` 必须是完整 40 位 commit OID；branch 只能用作 `upstream` 等获取提示。
- R00 使用完整 clone；禁止 shallow clone。
- 首个 default 至少物化 `tsfg` 与 `.agents` 两个独立项目。
- 除 Agent Activation Surface 外，禁止用 manifest `copyfile`/`linkfile` 注入构建输入。

普通 PR 使用固定基线 Integration Snapshot 加 Candidate Overlay：首个 Stable 前基线为 `bootstrap/r00.xml`，之后为当前 Stable。Overlay 只能用完整 OID 替换一个或多个候选 project；CI 必须保存 overlay、解析后的完整 manifest 和 Canonical JSON Digest。producer/consumer 四组合在测试阶段组合 baseline/candidate artifacts，不拼接两个 `tsfg` 源码树。失败候选证据可在 90 天后过期；Stable 或需永久保存的协调组合必须通过 manifest PR 固化。

### 4.3 Workspace Verification

`repo sync` 后必须检查：

- project 集合与路径；
- `.repo/manifests` 的实际 HEAD 与初始化时锁定的完整 manifest commit OID，以及所选 manifest 文件名；
- 每个实际 HEAD；
- remote URL；
- manifest 解析结果；
- tracked、staged 和 untracked dirty state；
- Agent Activation Surface 的每个 linkfile 是否仍为链接、其规范 target 是否匹配、解析后是否仍位于 workspace 内，以及目标内容身份是否匹配 manifest 管理的 `.agents` 文件。

任一不匹配必须失败。开发者只有显式 `--dev` 才能在 dirty tree 运行 `build`/`test`，输出必须标记为不可发布；`package`、`repro-check` 与 Stable 晋升只接受干净 workspace。

## 5. Agent Infrastructure

`.agents` 必须版本化保存：

- `AGENTS.md`、`CONTEXT-MAP.md` 与 agent 支持文档；
- `skills/**`；
- MCP server 的可维护源码、锁文件、非机密配置模板和测试；
- hooks、插件清单及其测试。

它禁止保存 token、client secret、OAuth 会话、`auth.json`、个人绝对路径、缓存、日志，以及只有 dist 而没有可维护源码的 MCP。

Manifest linkfile 必须把：

- `.agents/AGENTS.md` 暴露为根 `AGENTS.md`；
- `.agents/codex/config.toml` 暴露为根 `.codex/config.toml`；
- `.agents/codex/hooks.json` 暴露为根 `.codex/hooks.json`。

`.agents/skills` 原位供 Codex 发现。完整 workspace agent 环境只承诺在从受信任 Repo Workspace 根目录启动 Codex 时生效。

首次接管现有普通文件时，必须先逐字迁入并校验，再删除原文件并创建 linkfile。Windows 未启用 Developer Mode、缺少符号链接权限或目标冲突时，sync 必须失败；禁止复制回退。当前 `docs/adr/0005-*` 只是三仓切换前的设计暂存，实施切换时必须迁入 `.agents/docs/adr/`，产品仓只保留引用。

## 6. 本机开发平台与后置认证基线

R00 在当前 Windows 宿主直接运行，记录真实 OS/build、CPU 和 SDK。宿主不是最低 Windows 11 时仍可通过 Development Ready，但不产生最低 OS 认证。下面是 R13 待验证的发布基线，不是 R00 的执行环境要求；不能仅凭表格宣称已经支持。

| Target ID | 最低运行基线 | CPU | Profiles |
|---|---|---|---|
| `windows-x86_64-msvc` | Windows 11 24H2；Windows SDK 26100 ABI | `x86-64-v2` | `debug`, `release` |
| `linux-x86_64-gnu` | Debian 12/glibc 2.36；Linux kernel 6.1 ABI | `x86-64-v2` | `debug`, `release` |

Windows 10、macOS ARM64、其他 CPU 与控制台不属当前完成承诺。Windows 的一个实际 GPU 后端在 R11 选择并于 W5 完成；多设备支持另作 R13 认证。Linux/WSL 结果只证明实际测到的环境，WSL1 不替代独立 Linux kernel/netns 认证。

AVX、AVX2、AVX-512 等必须使用运行时检测和多版本分派；禁止 `-march=native`。

`debug` 映射为 Zig Debug 与 C/C++ `-O0`，保留完整断言、安全检查和调试信息且不启用 LTO。`release` 映射为 Zig ReleaseSafe 与 C/C++ `-O2`，保留边界/安全检查并生成 detached symbols。两者都禁止 LTO、PGO、fast-math 和本机 CPU 调优。

## 7. 产品与契约版本

### 7.1 Product Version

- 原计划的初始开发/首次发布/后续开发版本为 `0.1.0-dev.0`、`0.1.0`、`0.2.0-dev.0`，保留为历史计划，不是 R00 关闭动作。
- 本次不改既有 version 文件、tag 或 snapshot。首次正式发布的实际版本与 tag 在 R13 按现有历史决定，版本号本身不代表 Stable。
- R00 达到 Development Ready 不触发产品版本晋升。
- 产品仓根 `version.json` 是源码内 Product Version 事实源。

### 7.2 Contract Registry 与 Contract Set

`contracts/registry.json` 是 contract family 唯一注册表。每项必须记录：

- 稳定 family ID、Contract SemVer；
- Schema Hash 算法及当前值；
- `backward`、`bidirectional` 或 `exact` 兼容类别；
- 规范、schema、fixtures；
- producer、consumer、Contracts Owner；
- 支持窗口与弃用状态。

Contract Set 必须从 registry 按 family ID 字节序生成。R00 没有正式 family，规范空映射字节为 `{}`，其 ID 为 `sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`。兼容拒绝验收使用测试 fixture，不把假契约加入产品集合。

Contract 变化规则适用于承诺受支持的正式版本：

- 纯编辑或测试增补：patch；
- 向后兼容扩展：minor；
- 破坏变化：1.0 后 major；1.0 前 bump minor，但仍执行跨两个稳定 product minor 的扩展—迁移—移除；
- exact-match seam 的任何规范变化都形成不兼容新版本。

Schema Hash 变化但版本不变、兼容变化误标 patch、破坏变化绕过适用迁移窗口或 exact-match 新旧混用，检查必须拒绝。规范语义变化即使 schema 不变也必须触发版本决定。

同仓且未承诺兼容的开发格式允许 producer/consumer 随规范版本递增原子更新，并明确使旧缓存失效、拒绝不匹配格式，不要求两个稳定 product minor 的等待窗口。保留已发布受支持版本的窗口。现有 gate/schema 不在本次修改，相关变更随真实格式实现单独验收。

Reflection 尚未实现时记不适用。引入后执行 Roadmap RF-01：同一源码、target、选项、工具与 schema，在两个独立输出目录重生成的规范 Reflection Digest 必须一致；相关语义输入变化必须可检测。空 Contract Set 不是 Reflection 证据，不要求目标相关 ABI 布局跨 target 相同。

## 8. 规范数据与 Build Identity

`version.json`、`toolchains.lock.json`、`dependency-sources.json`、Contract Registry/Set、Candidate Overlay、Build Input Set、Toolchain Closure projection 与 Artifact Manifest 必须使用 RFC 8785 JCS：UTF-8、无 BOM、无重复 key。精确整数、版本和摘要使用字符串。

所有摘要格式为 `sha256:<64位小写十六进制>`。身份比较只使用完整摘要；文件名中的 16 位仅为展示缩写，碰撞时扩展到完整摘要。非 JSON schema 必须由 family 专属、版本化 canonicalizer 产生规范字节，算法 ID 写入 registry。

`eng/build-inputs.json` 声明允许影响 payload 的仓库和路径根。Build Input Set 的每项包含：

```text
project-id
repository-relative-path
normalized-mode
sha256(file-bytes)
```

条目按 project ID 和 UTF-8 path 字节序排序后生成 digest。完整项目 OID 进入 provenance 与 Release Evidence，但不直接进入 Build Input Set digest；因此纯文档、未参与 payload 的测试或 agent 资产变化不会改变制品身份。`eng/`、产品源码、contracts 和权威锁属于输入；R00 期间，`tests/r00/**` 中实际编译进 smoke payload 或控制该编译的源码与构建描述也必须作为临时输入显式列出，正式模块接管后删除这些条目。其余 `docs/`、`.agents`、测试、测试报告与 CI metadata 默认不是输入。构建读取未声明文件必须失败。

Build Identity 的规范 payload 明确包含 Build Input Set digest、target、profile、影响 payload 的显式选项、`source_date_epoch` 与 Toolchain Closure digest。`source_date_epoch` 的值是：对每个 Build Input Set entry 的 repository-relative path 查找其 last-touch commit，取这些 commit 的 committer timestamp 最大值；该值随其他字段一起 JCS 编码并摘要。它不取 project HEAD 时间，因此纯文档提交不得改变 Build Identity。

## 9. 工具链、依赖与缓存

初始 Toolchain Closure 的版本记录如下；本次不下载或升级工具。R00 只要求 Windows 当前实际使用的 closure，Linux/MSVC 兼容 lane 等额外认证不作为本机启动前置：

| 工具/输入 | 锁定版本 |
|---|---|
| Zig | 0.16.0 |
| LLVM/Clang/LLD | 22.1.6 |
| CMake | 4.4.3 |
| Ninja | 1.13.2 |
| Node.js | 24.20.0 LTS |
| pnpm | 11.25.0 |
| Windows SDK | 10.0.26100；获取介质 10.0.26100.9169 |
| VS Build Tools / MSVC tools | 2022 17.14.35 / 14.44.35207 |
| Linux sysroot | Debian 12.15 amd64 snapshot |

Zig 只负责 Zig 源码；Clang/LLD 负责 C/C++、LLVM/MLIR 与 ABI 基线。`cl/link` 使用已锁定 MSVC closure，只做兼容性 CI。R00 不启用 GCC lane；以后启用前必须把 GCC 及其运行依赖作为独立内容锁定工具链纳入 Toolchain Closure。

`toolchains.lock.json` 必须记录每个分发物的版本、平台、URL、SHA-256、字节数、签名/签名者、许可证及解包 tree hash。Git 源由 Integration Manifest 锁定；pnpm 与 Zig 依赖使用各自权威 lock。`dependency-sources.json` 只汇总来源和许可证，不复制版本事实。

Toolchain Closure digest 必须来自目标相关的规范 projection，而不是整个 runner 或下载 URL。projection 至少包含 schema version、target、按工具 ID 排序的工具版本/平台/archive SHA-256/unpacked tree hash，以及按 project ID 与 path 排序的权威 dependency-lock 文件 SHA-256；URL、mirror 与本机安装路径不进入身份。projection 按 JCS 编码并使用完整 Canonical JSON Digest。CI 必须用固定正反验收向量证明排序、字段选择和摘要实现一致。

缓存按完整 `sha256/<digest>` 寻址。URL/mirror 只是位置，不是身份。缺失、摘要不符、额外依赖或系统 PATH fallback 都必须失败。

## 10. Hermetic build 控制面

唯一公开逻辑命令为 `tsfg-build`：

```text
prefetch
verify-workspace
build
test
package
repro-check
```

Windows 与 Linux 可以使用各自的极薄启动器，但必须调用同一版本化实现。只有 `prefetch` 允许联网；其余命令必须使用环境变量白名单、锁定缓存和离线模式。

所有命令支持 `--report <path>`，原子写入版本化 JCS-compatible Build Report；人类日志写 stderr。report 可以记录耗时和宿主信息，但它是 sidecar，不进入 payload。

稳定退出类别：

| Code | Category |
|---:|---|
| 2 | usage/config |
| 10 | workspace mismatch |
| 11 | lock/integrity failure |
| 12 | offline input missing |
| 20 | build failure |
| 21 | test/compatibility failure |
| 22 | package failure |
| 23 | reproducibility mismatch |
| 30 | internal control-plane failure |

命令必须幂等；输出先写临时目录，成功后原子发布。失败不得留下可误认为有效的 package。R00 禁止遥测。

## 11. 制品与可复现规则

包名：

```text
tsfg-v<product-semver>-<target-id>-<profile>-<build-id前16位>.<zip|tar.zst>
```

包内 `artifact-manifest.json` 必须记录完整 Build Identity、Build Input Set、Contract Set ID、工具链摘要及除 `artifact-manifest.json` 自身外每个包成员的完整 SHA-256。manifest 自身及完整归档文件的 SHA-256 由包外 checksums 和 Release Evidence 记录，禁止任何文件直接或间接哈希自身。

Reproducibility Set 包含所有未签名 payload：程序、库、detached debug symbols、归档内容和包内 metadata。签名、可信时间戳、运行日志和外部 attestation 是 sidecar。

规范化要求：

- 归档条目按字节序排列；
- UID/GID 归零，权限规范化；
- 时区固定 UTC；
- `SOURCE_DATE_EPOCH` 等于 Build Identity 中的 `source_date_epoch`：每个 Build Input Set entry 路径的 last-touch commit 之 committer timestamp 最大值；
- 禁止绝对路径、CI run ID、主机名和墙钟时间进入 payload。

同一 Build Identity 必须逐字节一致；不同 target 只要求规范化 Contract Set/schema hash 一致。

R00 在同一 Windows 宿主的两个不同绝对路径、空且不共享编译缓存的干净 workspace 比较 debug/release 的完整 unsigned set；可共享复验后的内容寻址工具缓存。当前 `repro-check` 仍以不构建的 comparator workspace 消费两份 producer 输出，可以在同一宿主执行；不要求三个远端 job 或 VM。独立 job 的完整承诺 target/profile 矩阵归 R13。相同 Build Identity 的差异仍须定位和修复，不能以延期认证掩盖。

日常 `--dev` build/test 不重复整套复现，但不产生可发布 package；本机工程门和正式发布均使用各自适用的干净构建证据。

## 12. 源码可移植性、许可证与 provenance

### 12.1 源码规则

- Git 中所有文本为 UTF-8、LF；仅 `*.cmd`/`*.bat` checkout 为 CRLF。
- 路径只能使用 ASCII；项目自定义实现目录与普通文件使用小写字母、数字、`.`、`_`、`-`。工具、生态、控制或法律协议强制的文件名只允许出现在版本化白名单中；R00 初始白名单为 `AGENTS.md`、`CONTEXT.md`、`README.md`、`LICENSE`、`NOTICE`、`UPSTREAM.toml`、`CMakeLists.txt` 与 `CMakePresets.json`。
- 禁止大小写冲突、Windows 保留名、尾随点/空格。
- 产品仓禁止源码 symlink；唯一链接例外是 Repo Workspace 根、由 manifest 管理且不位于产品仓内的 Agent Activation Surface。
- 仓库相对路径最长 180 字符。

### 12.2 许可证

tsfg 自研内容为 MIT，版权主体为 `xuelongling`。允许注释的源码使用 `SPDX-License-Identifier: MIT`；JSON、二进制和生成文件通过机器可读 path mapping 声明。

fork 必须保留 LICENSE/NOTICE，并提供 `UPSTREAM.toml`，记录规范 URL、精确 base OID、许可证、同步分支与本地修改范围。build-only 工具和进入 payload 的代码必须分开审查。`NOASSERTION`、未知许可证、缺失 NOTICE 或不明来源 OID 阻断合入。具体上游批准属于 R02a。

## 13. CI 与安全边界

GitHub Actions 固定 `windows-2025` 与 `ubuntu-24.04` runner label，禁止 `*-latest`。runner 镜像预装内容不属于 Toolchain Closure。

以下完整矩阵保留为 R13 发布认证要求，并描述迁移前已实现的 CI 形态；不再作为每次 Windows 本地开发的门槛：

- format/policy/license/lock 检查；
- Workspace Verification；
- Windows/Linux × debug/release；
- Contract Set/schema hash；
- baseline/baseline、candidate producer/baseline consumer、baseline producer/candidate consumer、candidate/candidate 四种 artifact 组合；组合发生在兼容测试输入层，禁止拼接不同 `tsfg` OID 的源码树。首个 Stable 前以 R00 专用 fixture 的 baseline/candidate artifacts 代替尚不存在的正式 contract family；
- 每个 target/profile 的双 job repro-check。

发布 Manifest PR 对解析后的完整 snapshot 重跑同一矩阵，并与 main 历史比较：任何已合入 `snapshots/**` 文件的修改、删除、重命名或版本名复用都必须失败。产品与 manifests 的 ruleset 还必须拒绝 release tag 的删除或移动。`.agents` PR 运行格式、测试、secret scan 和装配验证；只有显式改变 Build Input Set 时才触发产品矩阵。

Actions cache 永远视为不可信：key 包含平台和完整 lock digest，不使用宽泛 restore key；恢复后逐对象复验 SHA-256/tree hash。PR workflow 默认 `permissions: contents: read`，不读取 secret，不使用 `pull_request_target` 执行候选代码。第三方 action 固定完整 commit SHA。

Linux hosted job 在仅保留 loopback 的 network namespace 中执行 offline 阶段。Windows PR job 对全部锁定构建/测试程序实施进程级出口阻断，并先运行必须失败的 network canary。hosted runner 只负责编排与构建，不证明最低运行平台：R13 平台认证与相应 Stable 晋升必须另在 Debian 12.15、glibc 2.36、6.1 系列 kernel 的 VM 对 Linux package 执行 runtime smoke，并在 cache 注入后由两个 Windows 11 24H2 短生命周期 VM 于虚拟网络层完全断网重演 Windows build/test/package/runtime smoke。无法证明 OS 基线、隔离或 canary 联网即失败。

目标 CI 分层是：普通开发运行 Windows 相关 format/policy/license/lock、workspace、单元和能力测试；Windows 集成点运行 debug/release clean build 与对应集成测试；实际 producer/consumer 的兼容与安全负例随功能持续执行；多平台独立复现和 VM 归发布认证。已有 workflow 和远端 required checks 必须经专门实施票同步迁移，未迁移时继续遵守，不假装已取消。不得因缩小平台范围降低 PR 无 secret、固定 action、缓存复验或历史不可变规则。

Candidate 证据保存 90 天。晋升前必须形成内容寻址的 provisional evidence bundle，包含 resolved manifest、Artifact Manifest、checksums、许可证报告和 repro 结果。产品 tag 与 manifest snapshot OID 确定后，再把最终 `docs/releases/<version>.md` 提交到 tag 之后的产品 main；该记录不得被要求包含在它所描述的 tag 中。二进制与同一 checksums 附加到对应 GitHub Release 长期保存。

## 14. 工程治理与发布

### 14.1 Engineering Change Proposal

`docs/proposals/<sequence>-<slug>.md` 用于工程边界变化，状态为 `draft`、`accepted`、`rejected` 或 `superseded`。模板必须覆盖背景、目标/非目标、受影响 contract、备选方案、兼容性、迁移/回滚、安全/许可证、验证证据和 owner。

仓库拓扑、Build Identity/Build Input Set、Tier 1、工具链 major/minor、contract schema/兼容窗口和发布安全边界必须先提案；仅满足 ECP-0002 全部有限委托条件的同仓开发契约无需逐次提案。普通实现与补丁版工具升级不需要 proposal，仍执行来源、许可证、完整性及适用测试。只有难以撤销且存在真实取舍的 accepted proposal 才建立 ADR。

### 14.2 Owner

Contracts Owner、Integration Owner、Release Owner 是逻辑角色，可以暂由一名维护者兼任。bot 仅能按用户通过 ECP-0002 给予的有限委托处理符合条件的开发契约，其他 contract 变化仍需 Owner 决策；bot 不得晋升 Stable。第二名人类维护者出现后启用 CODEOWNERS 异人审批；本地委托不修改远端保护或代替平台要求的人类 review。

### 14.3 Promotion State

这是正式发布状态机，不是 Development Ready 或 Windows Functional Complete 的状态机。既有身份保护持续有效；凭据、Owner 和首次 Stable 事务只阻断对应发布工作。

```text
Candidate
  -> Verified Candidate
  -> Promotable
  -> Stable
  -> Superseded / Withdrawn
```

全套 required CI 通过后才是 Verified Candidate；适用 owner 审批、版本齐备且内容寻址 provisional evidence bundle 完整后才是 Promotable。只有 Release Owner 可以接受不可变 snapshot、创建 release tag、更新 `default.xml` 和晋升 Stable。首个 Stable 的验证基线是 Bootstrap Integration Snapshot；此后才使用当前 Stable。

回滚不得修改 snapshot 或移动 tag；必须用新 manifest commit 把 `default.xml` 指回上一 Stable，并把问题版本标记为 Withdrawn。

`tsfg` 与 `manifests` main 必须要求 PR、required checks、线性历史并禁止强推/删除。当前只有一名维护者时 required approving review 为 0；第二名维护者出现后启用异人审批和 release environment 禁止自审。

## 15. R00 Smoke Targets

R00 后续实现只能建立位于 `tests/r00/` 的工程 smoke targets：

- CMake/Ninja/Clang/LLD 构建一个非公开 C/C++ target；
- Zig 构建一个独立非公开 target；
- Node/pnpm 控制面驱动六个 `tsfg-build` 子命令；
- 生成空 Contract Set、Artifact Manifest、Windows package 与 detached symbols；既有 Linux smoke 保留供 R13；
- 测试 fixture 证明未 bump、错误 bump 与破坏兼容会被拒绝。

实际参与 smoke payload 或控制其构建的 `tests/r00/**` 文件必须列入 R00 临时 Build Input Set；纯测试驱动、兼容 fixture 和测试报告仍排除。两类 smoke target 不互相建立 C/Zig ABI，不构成未来产品 API，可在正式模块接管后连同临时 input 声明删除。R00 不构建 LLVM fork，也不实现语言行为。

## 16. R00 本机关闭条件

R00 spec v2 的 W00-01–W00-10 是逐项验收 ID。验收记录是开发证据，不是 `docs/releases/0.1.0.md` 或 Stable Release Evidence；所有项通过才记录 Development Ready：

1. 从 E 盘全新目录按完整 manifest OID 物化所需项目；remote/OID/path/activation 和 dirty 负例通过。已完成的仓库迁移事实不重复实施。
2. 当前 Windows 宿主、CPU、工具 closure 和源码输入如实记录；不要求 Windows VM 或 Linux。
3. Windows debug/release 的 C/C++ 与 Zig smoke 经正式 build/test/package/runtime smoke 通过；没有产品 API 或正式 ABI 的虚假完成声明。
4. 显式 `--dev` 允许本地 dirty build/test 且标记不可发布；无该选项的 dirty 操作与 dirty package/repro 必须拒绝。
5. 同宿主两个 E 盘干净 workspace 的独立输出，以现有 comparator 校验完整 unsigned set；输入、JCS、source epoch 与哈希负例通过。
6. 工具、实际依赖、输入声明、SPDX/NOTICE/provenance 和 portable paths 覆盖完整；未知来源、缓存篡改、PATH fallback、未声明读取、离线 canary 失败均被正确拒绝。
7. 空 Contract Set 与 test-only 四组合/版本负例通过；无 Reflection 时明确不适用，不能用空摘要替代。
8. 错误类别、报告与失败输出原子性通过；记录命令、退出码、环境、精确身份、摘要及重放方法，不只填写“通过”。
9. 新工具、缓存、包、临时文件、日志、下载和 workspace 均在 E 盘，确认实际子进程路径，不仅设置表面输出路径。
10. 本机相关门均通过；当前 CI/保护的实际状态单列，未变更或待迁移不冒称成功。不生成 Promotable/Stable，不以 R13 延期项阻断 R00。

本机结果不存在时仍保持待验收；若发现正确性/输入边界失败，先修复，不通过修改验收文字掩盖。Linux/最低 OS、跨平台独立作业、Owner/签名/长期证据和发布收口迁入 R13。

## 17. 历史切换事务与后置发布事务

以下记录原始首次切换次序以保留 provenance。已完成的 1–6 不重复执行；其中固定旧 OID 的导入授权不是当前操作授权。7–9 的实际版本及身份在 R13 核对后执行；本次不操作远端、不晋升、不重命名本地目录：

1. 在产品仓与 `.agents` 分别准备并验证独立提交。
2. 把旧 `langofgame/tcfg` remote 保留为 `legacy`，新 `origin` 指向 `xuelongling/tsfg`。
3. 把目标远端初始提交 `b718c3b22661387e9bc621d4d14915dd1115c77f` 保存为 `archive/pre-import`。
4. 只使用 `--force-with-lease=main:b718c3b22661387e9bc621d4d14915dd1115c77f` 进行受保护导入；禁止裸 `--force`。
5. 版权统一为 `xuelongling`，完成本地目录与文档命名迁移。
6. 在 Manifest Repository 提交并锁定 `bootstrap/r00.xml`，用其完整 manifest commit OID 物化、验证并形成 provisional evidence。
7. 对 Promotable 组合先提交不可变 `snapshots/tsfg-v0.1.0.xml`，但不创建 `default.xml`；再创建不可移动的 `tsfg-v0.1.0` tag，把二进制、checksums 与证据上传为非 Stable 的预发布材料。
8. 在 tag 之后的产品 main 提交 `docs/releases/0.1.0.md`，记录 tag、承载 snapshot 的 manifest commit OID、文件名和既有材料摘要；该提交不属于 tag，也不进入所描述的 Build Identity。
9. 所有身份与长期材料已存在后，Release Owner 以最后一个 manifest 提交创建 `default.xml` 并指向该 snapshot；这是首次 Stable 的提交点。随后只允许幂等地把既有 GitHub 预发布标记为 Stable，并启用 main/tag 保护。

最终 manifest 提交前任一步失败都不得创建 `default.xml` 或宣称 Stable；已创建的 tag/snapshot 不得移动或复用，只能把该候选标为 Withdrawn。提交点之后不得重写身份，外部发布状态的幂等收尾失败必须重试并阻断 Certified Release 关闭，不阻断本机开发状态。

## 18. 相关 ADR

- `0001-single-first-party-repository.md`
- `0002-reproducible-offline-build-boundary.md`
- `0003-decouple-product-and-contract-versions.md`
- `0004-native-build-systems-behind-one-control-plane.md`
- `0005-version-agent-infrastructure-separately-from-activation.md`（切换前暂存；目标位置为 `.agents/docs/adr/`）
- `0006-use-stable-manifests-candidate-overlays-and-build-input-projection.md`
- `0007-set-tier-1-os-and-cpu-baselines.md`
- `0008-use-owner-gated-immutable-integration-promotion.md`
