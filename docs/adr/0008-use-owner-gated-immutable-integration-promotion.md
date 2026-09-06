---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# 使用 Owner 把关的不可变集成晋升

集成组合只按 `Candidate → Verified Candidate → Promotable → Stable → Superseded/Withdrawn` 单向流转。全套 required CI 通过后才成为 Verified Candidate；所有适用 owner 审批、版本就绪且内容寻址 provisional evidence bundle 齐备后才成为 Promotable。只有 Release Owner 可以接受不可变 snapshot、创建产品 tag、更新 `default.xml` 并晋升 Stable，bot 只能生成材料而不能审批或晋升。Stable 的提交点是 manifest main 中使 `default.xml` 指向已锁 snapshot 的提交；首个 Stable 前只有完整 manifest OID 锁定的 Bootstrap Integration Snapshot。回滚不得移动 tag 或修改历史 snapshot，而要用新的 manifest commit 将 `default.xml` 指回上一 Stable，并把问题版本标为 Withdrawn。`tsfg` 与 `manifests` 的 main 要求 PR、required checks 和线性历史，禁止强推与删除；release tag 也禁止移动或删除。该状态机保留失败发布的可审计身份并防止自动化擅自改变稳定基线，代价是晋升与回滚都需要显式 manifest 事务和长期证据。

为避免 Release Evidence 对其描述的产品提交产生自引用，晋升先固化 snapshot、tag、checksums 与非 Stable 发布材料，再把 `docs/releases/<version>.md` 写入 tag 之后的产品 main，最后才以 manifest 提交更新 `default.xml`。该发布记录不属于其描述的 tag 或 Build Identity。提交点前失败不得改变 default；已经固化的 tag/snapshot 不移动、不复用，只能标记候选 Withdrawn。提交点后的外部状态只允许幂等收尾，失败会阻断阶段关闭但不能重写 Stable 身份。
