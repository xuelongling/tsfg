---
status: accepted
---

# 解耦产品版本与契约版本

tsfg 整体使用一个 Product SemVer，每个 contract family 独立使用 Contract SemVer 并绑定规范化 Schema Hash；Contract Set ID 由排序后的 `family -> version + hash` 映射派生，不再人工维护独立版本号。R00 开发版本为 `0.1.0-dev.0`，验收后的首个 Stable Integration 为 `0.1.0`，随后 main 进入 `0.2.0-dev.0`；产品仓根 `version.json` 是源码内事实源，release tag 使用 `tsfg-v<semver>`。R00 尚无正式 contract family，Contract Set 是规范化空映射及其 SHA-256；兼容拒绝验收使用不进入产品 Contract Set 的测试专用 fixture。

1.0 前只承诺当前稳定 product minor 与紧邻上一稳定 minor，破坏性契约迁移必须跨至少两个连续稳定 minor 完成“扩展—迁移—移除”；ABI hash、热更签名等 exact-match seam 明确排除在该窗口外。这避免普通产品发布被误解为契约变更，也使 schema 变更无法隐藏在产品版本中；代价是发布和 CI 必须同时管理产品、各 contract family、派生 Contract Set ID 与方向性兼容证据。

`contracts/registry.json` 是 contract family 的唯一注册表，记录版本、Schema Hash、兼容类别、规范/schema/fixture 路径、producer、consumer、owner、支持窗口与弃用状态，Contract Set 只从该文件按 family ID 字节序派生。编辑性修正或测试增补对应 patch，向后兼容扩展对应 minor，破坏性变化在 1.0 后对应 major；1.0 前破坏变化增加 minor 但仍受迁移窗口约束。Schema Hash 变化却不 bump、兼容变化标成 patch、未完成迁移窗口的破坏变化，以及 exact-match seam 的新旧混用都由 CI 拒绝；规范语义变化即使 schema 不变也必须触发版本与兼容评审。
