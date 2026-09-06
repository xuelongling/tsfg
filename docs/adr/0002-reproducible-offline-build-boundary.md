---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# 按内容锁定的可复现离线构建边界

在相同 Build Identity 下，R00 骨架构建的 Reproducibility Set 必须逐字节一致；不同 target 之间只要求规范化 schema/hash 一致。Build Identity 由 Build Input Set digest、target、build profile、影响产物的构建选项、`source_date_epoch` 和 Toolchain Closure digest 组成，不因未参与构建的 agent 文档、skill 或 MCP 变化而改变。Reproducibility Set 覆盖全部未签名发布 payload，包括程序、库、调试符号、归档内容和包内 metadata；签名、可信时间戳、运行日志与外部 attestation 作为 sidecar 排除。发布包内必须有规范化 `artifact-manifest.json`，它只记录除自身外各包成员的摘要；manifest 自身及完整归档的摘要由外部 checksums 记录，避免自哈希。归档条目按字节序排序，UID/GID 归零，权限规范化，时区固定 UTC；`source_date_epoch` 取每个 Build Input Set entry 路径的 last-touch commit 之 committer timestamp 最大值，并显式进入 Build Identity，纯文档提交不得改变它。绝对路径、CI run ID、主机名和墙钟时间禁止进入 payload。

工具链与依赖必须按内容哈希预热到缓存，验收构建阶段断网；因此“全新环境离线构建”指全新环境先按锁定输入完成可验证预热，再在无网络访问下构建。逻辑命令 `tsfg-build` 是唯一公开控制面，只提供 `prefetch`、`verify-workspace`、`build`、`test`、`package` 与 `repro-check`；只有 `prefetch` 允许联网，其余阶段使用环境变量白名单且禁止系统工具回退。Git、Python 与 Google `repo` 属于构建边界之前的 Bootstrap Trust Root，只负责按 manifest 物化工作区，不参与产物生成；Manifest Repository 的 README 记录人工初始化方法，不创建安装脚本，物化后必须执行 Workspace Verification。`repro-check` 必须在两个不同绝对路径的干净工作区分别构建后比较，不能用同一缓存的连续命中作为证据。该要求牺牲部分构建便捷性与缓存成本，换取可审计、可重放且不依赖维护者主机状态的构建证据。

GitHub hosted runner 只是可变的执行宿主，工作流固定 `windows-2025` 与 `ubuntu-24.04` 标签但不得把镜像预装工具当作输入。Actions cache 仅作加速且始终按不可信输入处理：key 包含平台和完整 lock digest，不使用宽泛 restore key，恢复后逐对象验证 SHA-256 与 tree hash。PR 默认只有 `contents: read`、不读取 secret，也不以 `pull_request_target` 执行候选代码；第三方 action 固定完整 commit SHA。Candidate 的 overlay、resolved manifest、日志和验证证据保存 90 天；Stable 的 artifact manifest、checksums、resolved manifest、许可证报告与 repro 结果进入版本化发布记录并随 GitHub Release 长期保存。

每个 target/profile 的 repro-check 使用两个独立 job、不同临时绝对路径和空编译缓存，再由第三个不执行构建的 job 比较规范包；内容寻址工具缓存可以相同，但不得共享增量构建缓存。Linux hosted job 在只保留 loopback 的 network namespace 中执行；Windows PR job 对全部锁定构建/测试程序实施进程级出口阻断并先运行网络 canary。hosted runner 不证明最低运行 OS：R00 关闭和每次 Stable 晋升另在 Debian 12/kernel 6.1 VM 运行 Linux package smoke，并在 cache 注入后由虚拟网络层完全断网的两个 Windows 11 24H2 短生命周期 VM 中重演；无法证明 OS 基线、隔离或 canary 意外联网即失败。
