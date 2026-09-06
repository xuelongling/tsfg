---
status: accepted
---

<!-- SPDX-License-Identifier: MIT -->

# tsfg 产品单仓、独立控制仓与同级上游 Fork

产品与语言的规范名统一为 `tsfg`，产品规范远端为 `https://github.com/xuelongling/tsfg`。产品自研内容统一放在该产品 Git 仓库，不按 contracts、compiler、runtime 或 tooling 拆成独立仓库；自研控制仓例外为现有 `https://github.com/xuelongling/manifests.git` Manifest Repository 与 `https://github.com/xuelongling/.agents.git` Agent Infrastructure Repository。需要维护的外部上游 fork 作为产品仓的同级仓库，tsfg 专用改动直接提交到 fork 特性分支；Integration Manifest 始终锁定完整 commit OID，不以浮动分支名作为可重放身份。

远端迁移必须保留旧来源的 provenance，并禁止无 lease 的强制更新；具体初始 OID、操作顺序和当前执行状态属于迁移章程与证据，不属于该长期决策。产品源码的版权主体统一为 `xuelongling`。这一拓扑以单提交保持产品仓内自研模块的原子更改，并在 fork 内保留上游改动历史；代价是跨仓修改需要显式的 manifest 晋升和组合 CI，contracts seam 也必须依靠版本化 interface、fixtures 与 CI 而不是 Git 仓库边界来维持。
