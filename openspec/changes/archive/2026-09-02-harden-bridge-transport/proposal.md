## Why

`add-bridge-transport` 交付时留下两笔明确的欠账.  一是独立 code review 提出的 5 条 WARNING 未修, 其中"bridge 接受连接但迟迟不发 hello 会导致永久活锁且无恢复路径"与"schema 校验失败的响应帧被丢弃却不结算 pending, 使协议漂移表现为等到兜底超时"两条, 被 reviewer 点名应在与真实 bridge 联调之前修掉 —— 它们正是跨仓库联调时最容易被误判成"对端的锅"的形态.  二是 mie 仓库的 `packages/tool-defs` 已定稿并锁定 zod v4 (`peerDependency ^4.0.0`), 而本仓库当前是 zod 3.25.76 + `zod-to-json-schema`, 接入前必须先完成迁移.

三是 `packages/tool-defs` 定稿后, 本仓库的 tool 注册接口仍停在一个测试用 stub 上, 6 个 P0 tool 一个都没接 —— 接入姿势已与 mie-main 核对确认 (只 import `./schemas` 与常量, 不使用其 `./protocol`), 没有待解的阻塞.

三件事合并成一个 change 做, 是因为它们改动同一片代码: zod v4 里 `z.unknown()` 的可选语义与 v3 不同, 而 `src/protocol.ts` 的 payload/error 互斥校验正建立在 v3 那个语义上; W4 (校验失败按 id 结算) 也落在同一条校验路径上.  分两轮做会在同一处返工两次.  tool-defs 接入则强依赖 zod v4 —— 该包的 `peerDependency` 是 `^4.0.0`, 迁移不完成就接不上, 因此它必须排在迁移之后、同一轮之内.

## What Changes

**zod v3 → v4 迁移**

- 依赖从 `zod@3.25.76` + `zod-to-json-schema@3.25.2` 换成 `zod@^4`, 用 v4 内置的 `z.toJSONSchema` 派生 MCP tool schema, 移除 `zod-to-json-schema`
- 迁移后必须重跑两侧矩阵并同时为绿, 缺一不可: **未知字段前向兼容侧** (hello 带 `capabilities` / 成功响应带 `duration_ms` / 错误响应带 `retriable` / `error.data` 带额外字段 均应正常工作) 与 **畸形 error 拒绝侧** (`error` 为 `{}` / 字符串 / `null` / `code` 为数字 / `code` 为空串 / `payload` 与 `error` 两键同时存在 / 两键都不存在 均应被拒)

**传输层加固 (review 的 5 条 WARNING)**

- 补进程关停路径: transport close 与 SIGTERM/SIGINT 上关闭 bridge client 并退出, 使 `BridgeClient.close()` 不再是生产代码里的死代码
- 新增**独立握手超时**: bridge 接受连接却不发 hello 时, 到点 destroy socket 交给重连逻辑, 消除无恢复路径的活锁; 同时把请求兜底计时改为从写出确认起算, 使连接与握手耗时不再挤占 `timeout_ms + 5000` 预算
- `socket.on("data")` 边界补 try/catch, 并让诊断上报自身也吞掉调用方回调抛出的异常, 使任何 handler 异常降级为一条诊断而不是掀掉长驻进程
- schema 校验失败的 `tool_response`, 若原始帧带合法 `id` 且该 `id` 在等待表中, 立即以携带校验详情的错误结算, 不再让它熬到兜底超时
- 明确未发出的本地失败 (入参校验失败、协议版本不兼容、错误归一化兜底) 从 `TOOL_ERROR` 改为 `NOT_SENT`.  **不新造错误码** —— 码空间跨仓库共享, 单侧新造有撞车风险

**tool-defs 接入与 P0 tool 注册**

- 以 `file:` 依赖引入 mie 仓库的 `@mie/tool-defs`, **只 import `./schemas`** (6 个 tool 的输入定义) 与常量 (`PROTOCOL_VERSION` / `TOOL_DEFS_VERSION` / `ERROR_CODES`)
- `ERROR_CODES` 仅作"已知码参考表"用于生成提示, **不得**用其 `ErrorCodeSchema` 做校验闸 —— 那会把未知错误码原样透传的保证打回去
- **不使用**该包的 `./protocol`: 已与 mie-main 核实, 那是 extension↔bridge 的 native messaging 内层协议 (strict + 封闭错误码枚举在内层是有意的), 与 socket 层无关; 本仓库自己的 socket 帧校验保留
- 注册 6 个 P0 tool: `tabs_context` / `tabs_create` / `tabs_close` / `navigate` / `computer` / `read_page`, 全部经由现有的动态派生接口, 移除测试用 stub 在生产入口的注册
- `computer` 的输入是按 `action` 判别的 union, 派生 MCP schema 时需确认客户端可用
- MCP 层 **MUST NOT** 把 `obscured=true` 当作失败处理 (对端已知非阻塞项: 点击 input 类控件时 hit-probe 可能把 UA shadow 内部节点误报为 obscured), 原样透传由 agent 判断

**择优采纳的 SUGGESTION**

- 请求 id 前缀改为实例级, 消除同进程两个 client 产出相同前缀的可能
- 写出确认标记的时序加固: 关停路径落地后, "写已 flush 但确认回调尚未执行"会从不可达变为可达, 若不处理会产生假 `NOT_SENT` (即可能重复点击), 必须与关停路径一并处理
- 诊断日志不再回显原始帧内容与校验错误详情原文, 改为只记长度/前缀哈希
- 行解码缓冲区加上限 (阈值取在最大截图 base64 之上), 避免永远收不到换行时无限增长
- 错误提示覆盖全部 v1 错误码及未知码, 不再只覆盖其中三个
- server 版本号改为与 `package.json` 单一来源; 入口模块改为仅在被直接执行时启动 server

## Capabilities

### New Capabilities
无.

### Modified Capabilities
- `bridge-transport`: 新增未知字段前向兼容与保留键校验的显式契约; 新增握手超时; 修改兜底计时起点; 修改校验失败帧的结算方式; 修改未发出失败的错误码语义; 新增诊断脱敏与缓冲上限
- `mcp-server`: 新增进程关停契约; 修改错误提示的覆盖范围; 新增 tool-defs 接入与 P0 tool 注册契约

**说明**: `add-bridge-transport` 尚未 archive, 因此 `openspec/specs/` 下还没有这两个 capability 的主 spec 文件, 无法按 MODIFIED 复制既有 requirement 原文.  本 change 的 delta 一律以 ADDED 表达, requirement 命名与上一个 change 刻意错开; 两个 change 先后 archive 时按顺序 sync 即可.

## Impact

- 受影响代码: `src/protocol.ts` (zod v4 语义 + 校验路径)、`src/bridge-client.ts` (握手超时/计时起点/data 边界/按 id 结算/错误码/id 前缀/写确认时序)、`src/framing.ts` (缓冲上限/诊断脱敏)、`src/index.ts` (关停路径/入口守卫)、`src/mcp-server.ts` (版本号来源)、`src/tool-registry.ts` (错误提示覆盖)、`src/bridge-error.ts` (错误码语义)
- 依赖变更: 移除 `zod-to-json-schema`; `zod` 升至 `^4`; 新增 `@mie/tool-defs` 的 `file:` 依赖, 指向 `../mie/packages/tool-defs` (该包 `peerDependency` 为 `zod ^4.0.0`)
- 测试: 现有 37 个用例需在 v4 下全绿; fake bridge 需新增"接受连接但不发 hello"的能力以覆盖握手超时
- 不在本次范围: 与真实 bridge / 真实 Chrome 的联调 (另起一轮).  本 change 完成后, 本侧应处于"6 个 P0 tool 已注册、可用 fake bridge 走通全部调用路径"的状态, 联调轮只需把对端从 fake bridge 换成真实 bridge
- 对端影响: 本 change 只加固本侧, 不改变 socket 层对外语义, 不需要提升 `protocol_version`
