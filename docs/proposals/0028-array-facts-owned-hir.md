# ECP-0028: 官方 Array facts 与完整 owned HIR 私有切片

Status: accepted
Owner decision: Root，按当前用户“继续完整R03”“合理范围自主推进，不要一直让我决策”的明确授权采用；不是扩大ECP-0002有限委托。
Implementation: private Source producer and owned HIR implemented; local integration follows acceptance checks; no push or formal execution credit
Related tickets: workspace R03 25a / 25b / parent25

## 问题与结果

现有官方checker有Array/类型参数/索引接口，但Source普通投影拒绝f64[]，Product也不能消费完整Array事实。本提案引入独立ArrayFacts v1和Array HIR candidate v1，由实际官方Program/checker核定显式f64[]、密集字面量/const别名/checked读取，再由Product公共HIR路径严格拥有和完整转换。后端不访问上游AST。

## 精确合同

ArrayFacts request/package/schema见contracts/array-facts-candidate.schema.json；Source显式--array-facts-io-v1与其同字节embedded descriptor配套。独立minimal-arrays-v1.d.ts保留必需ambient接口，新增实际Array<T>数字索引签名/length，f64沿既有type f64=number别名。每一显式f64标注都须官方Symbol严格join该DTS声明，不能因checker擦除后同为Number就接受number[]或隐式literal根。旧所有声明profile不改。

每模块1..16个直接export named/zero-param/显式f64返回函数，每fn1..17个source-order const，literal根必须显式f64[]；alias仅指先前本函数binding，可省略重复标注。每literal0..256元素、包共≤4096元素。完整两源/诊断/类型来源/binding/use/签名/export/UTF16锚点/元素token与一次RNE f64 bits全部拥有。每个literal保留独立source-range allocation-site ID；此ID不是动态owner实例。相同元素不得合并literal或复制alias owner。输入和输出均完整canonical JCS+一LF，验证失败在write前零输出。完整包只write一次；I/O短写或write后取消保留真实已写sink结果并返回错误，不声称可回滚外部写入或发布成功。

索引仅原NumericLiteral，按原token的精确数学值判整且在0..4294967294，不先IEEE舍入/截断。允许1.0/1e0/合法基数等同值形式；拒绝1.0000000000000001等非整数。零系数先返回0；非零指数先按有效位及系数长度有界比较，只有最多10位的域内数值才分配有限幂/小BigInt，不能被巨大指数触发无界幂。语法/非整数/域外按当前切片capability拒绝，字节/深度/数量超预算才limit。空数组、等长和远OOB读取仍保留checkedElementAccess，不按length折叠、拒绝或提前trap；执行时的Q12 trap尚未完成。

独立Array HIR descriptor见contracts/array-hir-candidate.schema.json：保留所有函数、两源、精确DTS类型来源、source-binding与既有f64函数GlobalId、全部const/alias、arrayCreate及arrayReadChecked，接收者/索引各一节点，源顺序保持。Array类型为参数化managedReference Array<f64>，不冒tuple/Span/物理地址。显式四字段Array facts context先于任何HIR遍历；cold数据只证明完整自洽，不能自授官方Source准入。所有图、字节、域预算在相应复制、canonical/hash与发布前检查，getter/proxy不可触发。read/verify/print完整选中facts投影，未支持的Core lowering完整验证后明确capability拒绝，不能产局部Core/执行器。

## 精确构建输入变化

仅新增下列7个成员：

- compiler/array-facts.mjs
- compiler/array-facts-model.mjs
- compiler/array-hir-model.mjs
- compiler/array-hir.mjs
- compiler/minimal-arrays-v1.d.ts
- contracts/array-facts-candidate.schema.json
- contracts/array-hir-candidate.schema.json

Product223→230；串行集成M13时224→231，全部旧成员逐项保留，包括M13受管堆、SDKv2与目标特有既有pipeline/vm-build变体。只修改这7个新成员及其真实公共接缝所需实现，不改变身份算法、载荷格式、正式Frontend/HIR版本、Core0.9/wire9或注册的执行ABI。任何真实新增职责拆分导致成员变化，由Root在同一已授权范围精确更新本表和声明后复评，不隐瞒缺项。

## 授权与停动作边界

Source与Product分仓工作树、分仓提交，独立检查/双轴评审通过后本地串行集成；不推送。当前用户明确的fork Go本地开发授权优先于继承的upstream JS maintenance流程，不修改其规则，也不声称本功能属于upstream接受类别。

只运行新Array官方事实/API/owned HIR的精确检查，不恢复旧1438、wholeGo wildcard、正式012/279333 publication/锁与准入、E8、S1、VM/native业务、直接C盘PowerShell预检或其变体。旧调用原流UNKNOWN继续UNKNOWN。普通initial-false Runtime仅验证新精确构建身份和产物留存，证书仍false/upper5/four0，RF/ResourceProof=null、AC OPEN；不授予Array执行信用。

## 验证状态

实际Source旧path语义RED已取得：四套官方完整正控通过，随后真实旧投影在f64[]锚点返回r02b-d-unsupported/r01-ts-baseline/capability。最早测试helper命名冲突编译失败原件保留且不计RED。Product公共HIR FIRST在完整四包/全部身份与Source/HIR范围正控后实际拒绝，只计API gap。Source旧profile控制只改声明版本label，原source/DTS/config字节不变；这一差别明确记录，不冒新handler已准入。

真实Source五精确tops50/50及独立域/类型来源补测三tops15/15、公共HIR相关回归176/176与域边界9/9、四实际Source包→完整HIR5/5、最终TYPE576文件零诊断均已完成，原始失败与完整独立oracle不变。Spec初评要求的16/17函数、17/18const、256/257单literal、4096/4097总量及number[]/implicit根拒绝已实际补测；Standards的内部上下文命名项已修。双轴有限复评、提交集成和新身份普通Runtime结果以workspace本票唯一验收摘要实际记录为准，不由本段预授信用。Main25动态写入/append/shrink/compound与完整求值副作用、Core/Runtime/GC/VM及正式Q12/Q13执行继续OPEN。
