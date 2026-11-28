<!-- SPDX-License-Identifier: MIT -->

# R13 发布、升级、漏洞响应与回滚手册（Release & Rollback Runbook）

## 1. 三状态事实台账（严格分离，互不推定）

| 状态 | 当前结论 | 验证依据 |
|---|---|---|
| **Development Ready (R00)** | **已达成** | Windows 本机锁定工具链（Zig 0.16 / Clang / LLD / Lavapipe）、E 盘隔离缓存与全部契约门禁通过。 |
| **Windows Functional Complete (W6)** | **已达成** | R01–R12 全链在 Windows x86-64 本机端到端通过：TS→HIR→Core IR→R05 Bytecode/VM、R04 ABI/协议与 RF-01、R06 分代移动 GC、R07 `tsfg` Dialect 与 Windows x64 LLD AOT DLL、R08 5 路差分验证与自动最小化、R09 3 阶段 FunctionCell 热更新与增量编译服务、R10 ECS/Query 冲突图/Work-Stealing CPU Jobs/SIMD VM&AOT、R11 Vulkan 1.3 Lavapipe GPU Compute、R12 CLI/增量构建/`.tpkg` 脱离源码消费/`tsfg-lsp`/统一调试器与 tracing。 |
| **Certified Release (W7)** | **待外部环境认证** | 需在外部目标环境补齐：Windows 11 24H2 最低 OS VM、Debian 12 Linux x86-64 交叉与本机矩阵、多厂商物理 GPU 矩阵、正式外部生产代码签名证书与长稳 24h 压测。 |

## 2. 发布前强制门禁（Windows Local Hardening）

在任何发布候选打包前执行以下自动化检查：

1. **Runtime 依赖封闭性与 PE32+ 导入表审计**：运行 `auditRuntimeDependencyClosure`，确认发布 runtime 源码（`runtime/*.zig`）与实编 Windows x64 PE32+ 二进制（`tsfg-runtime.exe`、`tsfg-r05-vm.exe`）导入表均对 TypeScript、MLIR、LLVM、Clang 与任何 JS VM 保持零依赖。
2. **全仓许可证、NOTICE 与 SPDX 2.3 SBOM 审计**：运行 `auditSpdxAndGenerateSbom`，确认全仓生产源码 100% 携带 `SPDX-License-Identifier`、根 `NOTICE` 完整，并生成含 ISO-8601 `creationInfo.created` 与 Git OID 的 SPDX 2.3 SBOM JSON。
3. **独立 Windows x64 SDK 干净目录端到端验证**：运行 `node eng/build-windows-sdk.mjs --zip`，并在无仓库检出的隔离目录执行 `bin\tsfgc.cmd run` 与 `bin\tsfg-runtime.exe`。
4. **双目录可复现构建证明**：运行 `verifyReproducibleDualDirBuild`，确认两个独立输出目录产出的 `.tsfgabi`、`.tmeta`、`.tbc`、`.tpkg` 与 Zig 绑定字节级一致。
5. **全量功能与契约回归**：
   ```powershell
   Set-Location E:\ws\pro_tsfg\tcfg
   . E:\tsfg-cache\tsfg-env.ps1
   & $env:TSFG_LOCKED_NODE --test tests/r04/*.test.mjs tests/r05/*.test.mjs tests/r07/*.test.mjs tests/r08/*.test.mjs tests/r09/*.test.mjs tests/r10/*.test.mjs tests/r11/*.test.mjs tests/r12/*.test.mjs tests/r13/*.test.mjs
   ```

## 3. 升级与回滚流程

- **函数级热更回滚**：运行时在发布失败、摘要/ABI 不匹配、契约收窄违反或编译服务崩溃时自动保留上一可用 `SlotDescriptor`，无需人工介入。
- **静态状态 Schema 迁移与回滚**：schema 变更禁止走函数热更，必须使用显式 `ModuleReloadTx`（`begin` → `stage` → `validate` → `commit`）；任意迁移变换失败自动触发 `rollback`，完整保留上一 epoch 状态块。
- **包与契约版本回滚**：每次 `.tpkg` 或发布包升级前保留已签名的上一版本快照及 `contractSetId`；若新版本校验失败或线上指标异常，按签名摘要切回上一快照并重新验证 `loadLocalPackage`。

## 4. 上游漏洞响应与分支策略

- `tcfg` 日常集成合入 `dev`，`dev → main` 仅由人工评审发布。
- 锁定上游 fork（`typescript`、`llvm-project`）的安全更新通过独立升级分支拉取、重跑 SPDX/许可证审计与 R04–R13 全套门禁后合入。
