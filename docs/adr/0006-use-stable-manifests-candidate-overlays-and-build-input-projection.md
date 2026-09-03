---
status: accepted
---

# 用稳定 Manifest、候选 Overlay 与 Build Input Set 分离重放和制品身份

Manifest Repository 的 `default.xml` 只在首个 Stable 的提交点创建，此后始终解析为当前 Stable Integration。首次 Stable 产生前，以 Manifest Repository 完整 commit OID 和 `bootstrap/r00.xml` 文件名共同锁定不可变 Bootstrap Integration Snapshot，不得依赖 feature branch tip 或伪造 stable default。`snapshots/tsfg-v<semver>.xml` 一旦合入 main 就禁止修改、删除、重命名和版本名复用；`tsfg`、`.agents` 与参与集成的所有 fork 均用完整 40 位 commit OID 锁定，branch 只作获取提示，R00 不使用 shallow clone。普通 PR 不为每个失败组合永久写入 manifest 历史，而是由 CI 在固定 baseline snapshot 上应用内容寻址的 project OID Candidate Overlay，并归档 overlay、解析后的完整 manifest 和哈希；首个 Stable 前 baseline 是 bootstrap，之后是当前 Stable。producer/consumer 四组合在兼容测试层组合 baseline/candidate artifacts，不拼接不同产品 OID 的源码树；R00 用专用 fixture artifacts。晋升 Stable 或需永久保存的协调组合必须通过 manifest PR 固化。

Integration Snapshot 覆盖整个 Repo Workspace，但 Build Identity 只纳入从它派生的 Build Input Set。`eng/build-inputs.json` 声明可影响 payload 的路径根，每个实际输入以 project ID、相对路径、规范 mode 与文件字节 SHA-256 形成有序集合；项目 commit OID 留在 provenance 而不直接改变该摘要，`.agents` 默认不属于构建输入。R00 中实际编译或控制 smoke payload 的 `tests/r00/**` 文件必须临时列入，纯测试与报告仍排除。`source_date_epoch` 取每个 Build Input entry 路径的 last-touch commit 之 committer timestamp 最大值并显式进入 Build Identity，不能由 project HEAD 时间隐式改变。规范 JSON 统一按 RFC 8785 JCS 编码并用完整 SHA-256 标识；构建读取未声明文件必须失败。R00 不配置 repo post-sync hooks，`repo sync --verify` 不充当项目版本证明；README 固定 `repo.py` 内容哈希、repo 发布版本、Manifest Repository 完整 OID 和 manifest 文件名，规范流程禁用跳过校验的参数。sync 后的 Workspace Verification 还校验 `.repo/manifests` HEAD 与 Agent Activation Surface 的链接身份，dirty workspace 不再具有该 snapshot 身份。该设计避免候选组合污染永久历史，也避免 agent 文档变化触发无意义的制品身份变化；代价是 CI 必须可靠保存候选解析结果，并维护 workspace、provenance 与 build-input 三套互相关联的摘要。
