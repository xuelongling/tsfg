<!-- SPDX-License-Identifier: MIT -->

# Typed 消费者的生成源码与必测闭包

这些操作沿用 Hermetic Build Entry 的 `prefetch`、`build` 和 `test`，目标为
`typescript-ast`、Windows x86-64、debug、普通权限 `--dev`。Node 是构建工具；
输出的 Go 可执行文件是编译器探针。这些操作不引入游戏 Runtime，也不完成后续的
Source Intake 或 Verified Candidate gate。此目标固定 `GOMAXPROCS=2`，限制 Go 工具和测试的
原生并发；实际值随执行报告保留。工具失败仍阻断，不自动重试。

## 维护者操作

使用当前锁指定的 Node，保持 TEMP/TMP/HOME、配置和所有新缓存位于批准的 E 盘任务目录。
`TSFG_GIT` 指向显式 Git 可执行文件，fork 必须匹配已提交的来源登记；精确子来源 Git
对象也必须可用。统一 prefetch 验证它们，并获取和校验 Go/npm 工具输入。离线构建不会
自动下载缺项，不调用 npm install、npx 或 PATH 中偶然存在的格式化器。

```powershell
& $PinnedNode eng/tsfg-build.mjs prefetch --dev `
  --lock eng/go-ast-toolchains.lock.json --cache $TaskCache `
  --platform windows-x86_64-msvc

$env:TSFG_RUNTIME_LOCK = "$PWD/eng/go-ast-toolchains.lock.json"
$env:TSFG_RUNTIME_CACHE = $TaskCache
$env:TSFG_RUNTIME_PLATFORM = 'windows-x86_64-msvc'
& $PinnedNode eng/tsfg-build.mjs build --dev --source-target typescript-ast `
  --workspace $PWD --intake-plan eng/intake-declarations/typescript-ast.json `
  --target windows-x86_64-msvc --profile debug --generation replay `
  --out $FreshOutput --report $FreshReport
```

显式 `--generation replay` 总是执行真实生成并与已提交源码比较。生成、格式化或逐文件
输入校验失败，以及任何未解释差异，都阻断输出发布；不会自动覆盖 fork 中的基准。
`result.generation`、`result.requiredTests`、typed 探针和 JS 隔离分别报告。

完整运行通过后，维护者核对真实命令日志、输入/输出身份、许可文件、零差异及必测结果，
再将该报告的 `result.generation` 原样保存为 `eng/probes/generation.json` 并提交。
不得使用 fixture、失败、缺项或未运行报告制作记录。预期输出变化应先在 fork 变更及评审
记录中说明新旧输入/输出身份和依据，再更新来源登记与锁并重演。

不指定生成模式时，构建复用适用于当前输入的已提交记录；没有记录或绑定过期时重新生成。
显式 `--generation reuse` 则在记录缺失或过期时拒绝运行。记录被修改但尚未提交、内容无效、
输出未完整覆盖或实际输入不一致时均不能作为验证通过的依据。模式为 `reused` 的报告中，
本次生成命令列表为空；原始重演命令保留在 `verifiedReplay`。

绑定覆盖 Build Input Set、来源/消费声明与探针身份、生成锁、Toolchain Closure 和 fork OID。
新增记录或纯文档提交本身不改变生成输入，因此不要求无限递归地重新生成记录。控制代码、
生成器、适用源码或工具锁改变后必须重新验证。每次完成此目标都实际运行必测上游包，
不复用测试通过记录。

## 当前消费范围

- 31 个输出：AST/schema、9 个 stringer、Unicode 表、诊断及 13 个本地化表，以及 Program
  实际读取的 3 份库声明。声明的输出集合须与实际登记消费者中的生成文件一致。
- 126 个精确 TypeScript 子来源文件，从 gitlink 指定的 OID 读取，保留 Apache 许可及版权文件。
  它们以实际文件模式、SHA-256 和文件 last-touch 时间进入适用 Build Input Set。
- Node/npm 生成包按精确版本和 registry SRI 校验。账本包含完整的已验证 npm 暂存闭包，
  不声称其中每个文件都被 JavaScript import。Unicode 的许可声明来自原始 README；dprint
  平台包映射到同版本主包的 LICENSE；gofumpt 的捆绑许可记录原样保留。
- 生成器和必测包的真实 Go package 输入分别按已登记 fork 文件、已验证 Go 树和模块 ZIP
  逐文件核对，并在执行后复查。Go 自动生成的三个测试 harness 单独记录。
- 必测包为 `internal/ast`、`internal/diagnostics`、`internal/stringutil` 的 12 个顶层测试。
  任何必测缺失、fail 或 skip 都失败，包括原生命令返回 0 的 skip。

上游 bundled 生成器顺带输出的 embedding 表和其他库声明不被本消费者使用，不计入其
比较通过范围。独立 `_tools/go.mod`、编辑器、API、server、打包、发布和性能测试不属于该
消费目标；主模块锁不被宣称覆盖这些任务。仅 benchmark 使用的 `checker.ts` 数据未消费，
因此不作性能验证声明。LLVM/TableGen、其他第三方项目和后续语言/Runtime 里程碑不在本票范围。
