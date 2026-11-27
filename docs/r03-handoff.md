<!-- SPDX-License-Identifier: MIT -->

# R03 换机交接 · 2026-11-27

R03 正式验收进度为 **11/40**。从 tcfg 的 dev 继续完整 R03。下表的 tcfg 提交是本次核对的源码基线，保留此后的交接文档提交。源码、工作区规则、manifest 和工具锁可以通过 Git 恢复。旧机的验收原件、制品和未提交工作仍需单独迁移。

## 1. 恢复 Git 仓库和工作区入口

在 Windows x64 上准备 Git for Windows、Git Credential Manager 和 PowerShell 7。登录有仓库访问权限的 GitHub 账号。迁移分支由 Codex 绑定账号 ifeuille 推送。建议沿用 `E:\ws\pro_tsfg`，便于复用旧回执中的绝对路径。开启 Windows 开发者模式或使用有创建符号链接权限的会话。

| 工作区相对路径 | GitHub 分支 | 已核对提交 |
| --- | --- | --- |
| tcfg | [xuelongling/tsfg dev](https://github.com/xuelongling/tsfg/tree/dev) | `9df6f3f628042bd6b43eb9ab17295a8f957e5113` |
| .agents | [xuelongling/.agents migration/2026-11-26](https://github.com/xuelongling/.agents/tree/migration/2026-11-26) | `9753b3ce2d54b67f2aea5b12862a08ad8515e6be` |
| .repo/manifests | [xuelongling/manifests migration/2026-11-26](https://github.com/xuelongling/manifests/tree/migration/2026-11-26) | `0402126bf4a25d3a17d8d754b89285989d65dea4` |
| typescript | [xuelongling/TypeScript migration/2026-11-26-m24-source](https://github.com/xuelongling/TypeScript/tree/migration/2026-11-26-m24-source) | `8443e0f34e4ef0abd8b67f7bc82c91f60ad55ce6` |
| llvm-project | [ifeuille/llvm-project migration/2026-11-26-mesa-role](https://github.com/ifeuille/llvm-project/tree/migration/2026-11-26-mesa-role) | `e2b6d966852c7830733f516998df7e5d35bd6e23` |

新建工作区时按表克隆到指定路径。已有检出先检查 `git status --short --branch` 和 `git rev-parse HEAD`，保留各自分支的 WIP。工作区根目录是多仓容器，提交以各仓库为边界。

从工作区根目录运行 manifest 仓库的显式链接 hook。

```powershell
& .\.repo\manifests\repo.cmd link-workspace
Get-Item -LiteralPath 'AGENTS.md', 'CONTEXT-MAP.md', 'docs' -Force |
    Select-Object Name, LinkType, Target
```

三项应均为 `SymbolicLink`，分别指向 `tcfg/AGENTS.md`、`tcfg/CONTEXT-MAP.md` 和 `tcfg/docs`。根目录还有需要保留的普通文件时使用 `link-workspace --migrate`。同名文件采用外层版本，目录逐项合并。该入口用于手工多仓检出。需要正式 R00 或 TypeScript 候选工作区时，按相应 pinned manifest 的 `repo` 2.65 流程准备独立工作区。[manifest 链接说明](https://github.com/xuelongling/manifests/blob/0402126bf4a25d3a17d8d754b89285989d65dea4/README.md) · [TypeScript 工作区物化](r02a-workspace-materialization.md)

## 2. 准备环境和构建资源

- **目标和磁盘。** 使用 `windows-x86_64-msvc`。新下载、构建缓存、临时文件和输出放在 E 盘。设置 `TSFG_CACHE_DIR`、`TEMP`、`TMP` 后核对子工具的实际写入路径。旧普通 Runtime 预检要求 E 盘至少 16 GiB 空闲。旧机完整静态重建按保留 16 GiB 加构建峰值规划，启动时可按约 28 GiB 空闲预算，初次克隆和解包另留空间。
- **Bootstrap 工具。** 按 [tcfg README](../README.md) 准备已核准的 Bootstrap Node 和 Git，向 `eng\tsfg-build.cmd` 提供 `TSFG_BOOTSTRAP_NODE`、`TSFG_BOOTSTRAP_NODE_SHA256`、`TSFG_BOOTSTRAP_GIT`、`TSFG_BOOTSTRAP_GIT_SHA256`。使用本机绝对路径及已批准摘要。下载主工具闭包时使用该入口的 `prefetch` 并保存报告，随后走对应离线路径。
- **固定工具版本。** Node 24.20.0、pnpm 11.25.0、Zig 0.16.0、CMake 4.4.3、Ninja 1.13.2、LLVM 22.1.6、MSVC 工具 14.44.35207、Windows SDK 10.0.26100.9169 见 [Windows 主工具锁](../eng/toolchains.lock.json)。涉及 TypeScript Source 时，使用 [Go 工具锁](../eng/go-toolchains.lock.json) 和 [Frontend 工具锁](../eng/frontend-toolchains.lock.json) 固定的 Go 1.26.8。包依赖使用仓内 `pnpm-lock.yaml`。
- **静态 Core 来源。** C79 固定的 LLVM 来源为 `4cb57d27ddcad7c3a89d23ef576662a5c891e8c8`，可从表中 Mesa 分支的历史恢复，在单独检出中使用 [MLIR 来源锁](../eng/mlir-source.lock.json) 核对。按 [Python 工具锁](../eng/mlir-python.lock.json) 准备工具，`TSFG_MLIR_SOURCE`、`TSFG_MLIR_PYTHON_TOOL_ROOT` 指向本机固定输入。旧机对应 `.tmp/r03-01a-llvm-provenance-20261003/llvm-project` 和 `.tmp/r03-01-source-20261003/python-tool`。
- **正式 Source 和设备。** M24 Source 候选已在迁移分支。Product 的正式 [Frontend Source 锁](../eng/frontend-source.lock.json) 仍为 `0.10.0`、`579ee5c0acbadc92f7534b35589df51dd204e53d`。`e2b6d966` 对应 Mesa 来源角色。M39 复用既有软件 Vulkan 验收，实体 GPU 验收属于 M41。

配置好 Bootstrap Node、Git 和各自的摘要后，从 `tcfg` 目录按需获取锁定工具。已有核准缓存时可以直接复用其路径。

```powershell
$env:TSFG_CACHE_DIR = 'E:\tsfg-cache'
$env:TEMP = 'E:\tsfg-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TSFG_CACHE_DIR, $env:TEMP | Out-Null
& .\eng\tsfg-build.cmd prefetch --report E:\tsfg-cache\prefetch-report.json
```

## 3. 从旧机带走验收原件

以下路径相对于工作区。Git 中已有固定源码和许多测试夹具。历史原件仍在旧机。保留清单、原始日志和回执引用的文件。新机构建的产物使用自己的回执。

| 原件 | 保留范围 |
| --- | --- |
| R03 工单和检查点 | `.scratch/tsfg_r03/` 下的 `spec.md`、`map.md`、`checkpoint-current.md`、`handoff-20261008.md`、`issues/`，以及工单引用的 `evidence/` 和定向结果目录 |
| C79 静态制品 | `.scratch/tsfg_r03/c79-static-current-20261124/` 的 `product/`、`controller-result.json`、`closure-verified.json`、`current-text-verification.json` 和六份文本对照。EXE SHA-256 为 `5210b9925137df15c038e07db57803910c12c88463867b3e48eab5f79c1d7e0d` |
| M35 修复和普通构建 | `.scratch/tsfg_r03/M35-core-call-ownership-20261124/` 的报告、因果原流及待验目录。`.scratch/tsfg_r03/Runtime-initialfalse-dev868-3c588f5-20261124/product-build/` 的两份观察回执、`runtime-result-summary.json` 及其引用的证书、原流和十对产物 |
| M39 Common20 原包 | `.scratch/tsfg_r03/M39-gpu-logical-bindings-20261105/right-common20-human/results/` 整个目录，包括 Core、请求、计划、来源清单和报告。`right.common20.tbc` 为 30,046 字节，SHA-256 为 `b16b5cba1c72a906b14ac1854e304b2f32a34d68a4810b45c1e386a2b38ba807` |
| M39 软件设备验收 | 同一 M39 目录下 `gpu-software-vulkan-acceptance-checks-20261110/human-20261119T030211Z/` 的运行索引、原始报告和 oracle 原流 |
| 旧机本地提交与 WIP | `tcfg/main` 在 `41113fea44cef1c353d77286e00251870c898306`，相对本机记录的 `origin/main` 超前 268 个提交，另有 26 处原始未提交文档改动。按保留需要单独迁移这个分支及 WIP。历史 `vm-candidate` 有 38 处改动，按原边界留存 |

工具缓存可按相同锁恢复，也可复制已经核准的工具闭包并复核摘要。新机按固定提交重建所需的工作树。

## 4. 当前验收与接手顺序

1. **同步已通过的终态。** C79 固定 `be50614`，生产 PID 21660 退出和关闭 0/0，静态制品准入通过。六份 Core 与定向结果逐字一致，四份修复样本由退出 3 转为 0。M35 的 `3c588f5` 已进 dev，51 项、类型和独立双轴通过。普通 initial-false PID 19076 和收尾 19256 已通过，868 项更新 1、复用 867，四阶段、两份证书和十对产物一致，生成程序执行 0 次。旧检查点中的两项“运行中”可更新。旧机 C79 和 M35 工作树仍有登记，核对留存证据后按工作区规则处理。
2. **核对 M35 公开验收缺口。** `M35-core-call-ownership-20261124/public-c79/` 只有入口脚本，缺实际结果回执。上一主线程被平台标记为可能有网络安全风险，状态未标明具体触发动作。先核对原始拒绝范围，后续推进明确独立的事项。C79 和 M35 已通过的证据继续复用。
3. **继续正式验收。** 25aa 真实 Common20 冷读已结案，Node 1/1、Zig 20/20。39j 软件 Vulkan 64/64、oracle 106/106 可复用。M39 仍缺已准入、已初始化的同一 Common20 实例，用于提供绑定值、预算和写回目标，并验证成功、零预算及失败报告。M38 缺同次公开 Query 生产和实际代码租约。M36 缺正式后端的优化等价验收。M40 依赖 M36、M38、M39。Frontend012 已有本地采用记录，原 aggregate publication 保持停止。
4. **维持原动作边界。** 已有 `cyber_policy` 拒绝及可能重叠的动作继续停止，保留失败原件。只补本次改动所需的验证。合格的 tcfg 日常更改交付 dev，main 发布由人工处理。
