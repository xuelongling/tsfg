<!-- SPDX-License-Identifier: MIT -->

# ECP-0004：本机开发执行优先

Status: accepted
Date: 2026-09-14
Decision Owner: 用户
Authorization: 用户在 02a 的执行路线选择中明确：“权限、隔离都不重要，重要的是更快、更顺畅的完成任务”。

## 决定与范围

R02a Windows 本机源码开发使用普通当前用户进程执行锁定 Node/Go。`build --dev --source-target typescript-dependencies` 不再要求 WFP、LPAC、随机 restricting SID、ACL 改写或 UAC 前置；内部准备入口默认同一 local-development 路径。它仍沿用 Hermetic Build Entry，不新增公开构建系统。

保留固定来源/OID、工具及模块锁、来源许可、输入完整性校验、禁止浮动工具/依赖及隐式 PATH 回退、E: 工具/配置/缓存/临时/输出和原子结果发布。Go 使用声明本地 proxy、GOTOOLCHAIN=local、GOENV/GOWORK=off 等确定配置；缺输入仍失败，不能执行期间修改锁。

此路径不保证 OS 层断网、进程/文件隔离或低完整性，不执行那些以权限拒绝为成功条件的探针。执行报告必须明确 `mode=local-development`、`isolation=not-enforced`，不得伪造 Low/LPAC/WFP 通过。强隔离实现可独立继续，但不阻断这条本机开发路径。

未使用 `--dev` 的路径及显式 restricted 验收保留原语义。正式发布/认证规则不在本次调整范围；本决定不要求关闭系统 UAC、防火墙或修改全局 ACL，也不授予外部发布动作。

## 验证与迁移

02a 以真实普通权限 Node→Go 执行、失败后可重试、锁/输入损坏拒绝及准确结果报告验收。本机 Go 闭包消费与后续来源/AST/类型/生成/可复现要求继续由各票承担；不把执行后端可用当作 intake 完成。

既有失败证据保留，原强隔离假成功不得改写为成功。回退时使用显式 restricted 模式并重新完成其真实验收；不能仅改报告字段晋升为强隔离。
