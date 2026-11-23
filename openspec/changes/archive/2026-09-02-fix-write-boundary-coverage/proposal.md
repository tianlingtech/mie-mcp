## Why

`harden-bridge-transport` 交付时留下一条性质特殊的遗留: 用来覆盖"write 回调晚于 `close()` 到达时, 在途请求必须判 `SENT_LINK_LOST`"的那条测试是**空转的**.

根因是 Node 的 `net.Socket.prototype.connect` 内含 `if (this.write !== Socket.prototype.write) this.write = Socket.prototype.write;` —— 它会在 `connect()` 的同步阶段静默还原测试装在 `socket.write` 上的包装器 (实测包装器调用次数为 0).  于是那条测试实际走的是真实 write 路径, 等价于同文件里另一条已有用例的重复覆盖.

实现本身是正确的 (已由 reviewer 代码审读与 tester 的一次性真实背压验收双重确认), 问题在于**这条安全关键路径在仓库内没有任何持续保护**.  它判错方向的后果是这套错误码里最重的一种: `NOT_SENT` 意味着"可安全重试", 而在真实场景下重试等于重复点击、重复提交.

"测试给了虚假保障"比"没有测试"更危险 —— 后者至少是已知的空白, 前者会让后续任何改动误以为该路径受保护.  同一机制还让一位 reviewer 的探针得出假结果, 差点把正确实现误报成 bug.  因此这一轮先把真实覆盖建起来, 再进入计划中的纯重构轮 —— 顺序不能颠倒: 在唯一守着生命周期交互的测试是空转的状态下做等价变换, "测试全绿背书"是空话.

顺带收掉三项诊断质量与一项工程卫生的遗留.

## What Changes

**恢复真实的边界覆盖 (核心)**

- 用**真实内核背压**重写那条测试, 不再打桩: 对端发 hello 后 `socket.pause()`, 客户端发一个 2MiB 帧使 `socket.write()` 返回 false 且回调真的不触发, 随后 `close()`, 断言结果为 `SENT_LINK_LOST`
- 建立一条防止同类静默失效再次发生的规矩: **凡是仍然依赖打桩 socket 方法的测试, 必须断言桩确实生效** (例如包装器调用次数大于 0).  注意 Node 只还原 `write` 不还原 `connect`, 覆盖 `connect` 的桩是有效的, 不要误伤

**诊断质量**

- 校验失败的 issue 展开不再把 union 中无关分支的抱怨一并摊平: 一个畸形 `tool_response` 目前返回的 7 条 issue 里有 4 条是 "expected hello" 一类的噪音, 跨仓库排查时会把注意力引向错误的方向
- 诊断输出的递归深度与条数加上限, 避免 union 结构演进后规模放大
- 超长完整行被丢弃时, 先在行首有界前缀上尝试提取 `id`: 能归属就按 id 立即结算, 提取不到再走丢弃.  原先"不取 id"的理由是"守住资源边界", 但这是个假二选一 —— 超限的完整行早已整行驻留内存, 代价已经付过, 真正省下的只是 `JSON.parse` 的对象图分配, 而有界正则不建对象图

**工程卫生**

- 清理 write 回调中移除计时器起表后遗留的空行
- 构建前清理 `dist/` 旧产物 (源文件已删除但产物仍残留)

## Capabilities

### New Capabilities
无.

### Modified Capabilities
- `bridge-transport`: 修改校验失败诊断的内容 (剔除无关分支的 issue)、新增诊断输出规模上界、修改超长行的结算方式 (可提取 id 时按 id 立即结算)

**说明**: 前两个 change 均未 archive, `openspec/specs/` 下尚无主 spec 文件, 因此本 change 的 delta 一律以 ADDED 表达, requirement 命名与前两个 change 刻意错开.

**关于测试有效性**: 本 change 的核心工作是修复一条空转的测试, 但系统的**对外行为并未因此改变** —— 被覆盖的那条边界行为在上一个 change 中已经正确实现.  spec 只描述系统行为, 因此测试有效性不写成 requirement, 而是作为 tasks 与 e2e 的验收内容.  e2e 会以"该测试在实现被改坏时确实失败"来证明它不是又一条空转测试.

## Impact

- 受影响代码: `test/bridge-client.test.ts` (真实背压重写)、`test/support/fake-bridge.ts` (若需补充暂停读取的能力)、`src/bridge-diagnostics.ts` (issue 展开的分支选择与上限)、`src/framing.ts` (超长行提取 id)、`src/bridge-client.ts` (超长行按 id 结算、空行清理)、`package.json` (构建前清理 dist)
- 不改变对外协议语义, 不需要提升 `protocol_version`, 不改变任何错误码的含义
- 不在本次范围: `src/bridge-client.ts` 的拆分重构 (下一轮, 必须在本轮建立真实覆盖之后进行); 与真实 bridge / 真实 Chrome 的联调 (独立一轮)
