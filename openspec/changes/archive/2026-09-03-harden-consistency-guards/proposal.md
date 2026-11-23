## Why

上一轮 review 留下三条 SUGGESTION, 它们的共同点是: **都不是当前的缺陷, 而是让某个已经踩过的坑能够再次发生的形状**.

- `assertOutboundDirection` 是一个可复用的**条件断言** —— 只在 `localAccepted` 为真时才断言.  放在 `it.fails` 下这是有意的设计, 但作为导出形状, 任何人在普通 `it()` 里复用它, 对本侧拒绝的帧都会零断言通过且全绿.  **这正是本项目栽过跟头的那个形状**: 上一个 change 修的那条空转测试就是"看起来覆盖了最危险的边界, 实际一次都没跑过"
- 交叉校验的四张样本表编码的是"期望的裁决对"而非那两条方向规则本身.  加样本时选错表, 会得到一个全绿但断言错了方向的测试 —— 而方向搞反正是这层防护唯一的失效方式
- 关闭路径的顺序依赖在上一轮重构后变成了隐式的: 它从"同一个 `this` 里的语句顺序"变成了"跨文件回调 + 微任务排队".  今天仍等价, 但**行为差分抓不到这种变化** —— 谁日后把 `onClosed` 改成 async 就会静默破掉

三条的成本都极低, 而它们防的是本项目已经付出过代价的问题类型.  在与真实 bridge 联调之前做掉, 是因为联调期一旦出问题, 有护栏比事后回溯便宜得多.

## What Changes

- **消除条件断言的可复用形状**: `assertOutboundDirection` 或内联进 `it.fails` 块 (不再留下可复用的导出), 或对任何非 `it.fails` 的用法强制 `expect.hasAssertions()`.  修后 MUST 验证: 构造一个"本侧拒绝"的样本走该路径, 确认它不会零断言通过
- **把两条方向不变式写成意图注释**: 在交叉校验测试文件顶部用英文写清被强制的两条规则 —— 入站"远端接受则本侧必接受", 出站"本侧接受则远端必接受".  这是陈述不变式而非解释代码, 不违反项目的无解释性注释规范
- **钉住关闭路径的同步性约束**: 在 `src/bridge-connection.ts` 加一行英文意图注释, 说明 `onClosed` 必须同步完成, 且必须在任何 handshake 续体观察 `this.connection` 之前跑完

## Capabilities

### New Capabilities
无.

### Modified Capabilities
- `bridge-transport`: 新增一条**既有但从未被表达**的约束 —— 连接关闭时的状态清理必须同步完成

**说明**: 本 change **不改变任何系统行为**, 实现的语句一行未改 (只加注释).  三条改动是: 一处测试结构调整 (消除可空转的形状)、一处测试注释、一处实现文件的注释.

唯一的 delta 来自第三条, 而它值得写成 requirement 的理由来自上一轮的教训: 当时 verifier 指出"**没有任何 requirement 表达『每个已进入等待表的请求必须被计时器覆盖』, 所以那次回退在 spec 层面是合规的**", 才会一路走到 review 才被抓到.  现在的情形完全相同 —— 关闭路径的同步性约束真实存在且有可观察后果 (破坏它会让等待中的续体观察到不一致状态), 但没有任何 requirement 表达它, 于是谁把 `onClosed` 改成 async, 在 spec 层面同样是合规的.  注释能提醒读代码的人, 但拦不住 verify.

前两条不写成 requirement: 它们描述的是"我们如何守护既有 requirement", 属测试与流程层面.

验收基准: 既有 124 个测试结果与基线逐条一致 (120 passed + 4 expected fail), 第一条改动的有效性证明, 以及新增 requirement 与实现相符.

## Impact

- 受影响文件: `test/socket-protocol-consistency.test.ts` (结构调整 + 顶部注释)、`src/bridge-connection.ts` (**仅注释, 不得改动任何语句**)
- 不改变任何对外协议语义、错误码、提示文案、计时器时机
- 基线: commit `f8edfea` (四个 change 已归档提交, 工作区干净).  改动面可用 `git diff f8edfea` 完整审阅
- 那 4 个 `expected fail` 是 `tool_request.args` 已知缺陷的登记, **必须保持** —— 它们消失意味着缺陷被意外修复 (本轮禁止) 或登记被破坏
- 不在本次范围: 收紧 `tool_request.args` 为 record (行为变化, 单独一轮); 与真实 bridge / 真实 Chrome 的联调 (下一轮)
