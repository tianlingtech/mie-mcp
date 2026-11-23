## Context

本仓库 (mie-mcp) 是空仓库, 负责 mie 链路里 MCP server 这一段.  链路另一端 (Chrome extension + bridge 进程) 在 mie 仓库由另一个 agent 并行开发.  两侧已就传输层协议 v1 达成书面一致 (socket 路径, 帧格式, hello 握手, 超时归属, 错误码枚举), 但共享的 tool 定义包 `packages/tool-defs` 尚未定稿, `protocol_version` 起始值定为 1.

约束: 本次不能依赖真实 bridge 与真实 Chrome — 它们还不存在.  因此实现与验收都必须能在只有 fake bridge 的条件下完成, 且接入真实 bridge 时不需要改动传输层.

## Goals / Non-Goals

**Goals:**
- 传输层与协议层完整可用: 连接/重连, 帧编解码, 握手版本协商, 超时兜底, 错误码透传
- 错误语义对 agent 可操作: `NOT_SENT` 与 `SENT_LINK_LOST` 必须能被区分并给出不同的后续动作建议
- 留一个干净的 tool 注册接口, 使 tool-defs 定稿后只需接上而无需返工
- 全部行为可用 fake bridge 验证, 不依赖 Chrome

**Non-Goals:**
- 不实现任何具体浏览器 tool (P0 tool 集属于后续 change)
- 不实现 `{type:"event"}` 帧的语义 (仅预留帧位并安全忽略)
- 不涉及 CDP relay 通道 (那条线不经过 MCP server)
- 不做与真实 bridge / 真实 Chrome 的联调 (等 mie 仓库 P0 完成后另起一轮)

## Decisions

**1. 单例 bridge client + 惰性连接, 不做后台重连轮询**

连接只在需要发送请求时建立.  这样"bridge 未运行"就是一个普通的请求级错误 (`BRIDGE_NOT_RUNNING`), 而不是启动期的致命错误 — 符合真实场景: agent 起来时用户往往还没开 Chrome.  同时避免了后台重连定时器在 Chrome 长期未开时空转.

备选方案是启动即连接 + 指数退避重连, 被否决: 它把"未开 Chrome"变成了持续的后台失败噪音, 且并不能让首个请求更快成功.

**2. 请求 id 用带随机前缀的字符串**

bridge 支持多 client 并发并按 id 前缀多路复用, 因此 id 必须全局唯一而非自增整数.  形式为 `<uuid>-<seq>`: uuid 每个 client 进程一个, seq 进程内自增.

**3. 握手完成前请求进入队列, 而不是直接失败**

连接建立与 hello 到达之间有一个时间窗.  该窗口内到达的请求排队, 握手成功后统一发出; 握手失败 (版本不兼容) 则队列中所有请求以同一错误结束.  这让"首次请求触发连接"这条主路径不会因为竞态而随机失败.

**4. 超时双层, 但正常路径永远由 bridge 结算**

请求帧携带 `timeout_ms` 交给 bridge 计时; MCP server 只设 `timeout_ms + 5000` 的兜底定时器.  这样"超时"在绝大多数情况下是一条正常的响应帧, 双方状态一致; 兜底只覆盖 bridge 自身卡死或链路悄然中断的情况.  已结算的 id 从等待表中移除, 迟到响应因查不到 id 而被丢弃.

备选方案是两侧独立计时且时长相同, 被否决: 竞态下双方对同一请求的结论可能不同, 而这类不一致极难排查.

**5. `NOT_SENT` 与 `SENT_LINK_LOST` 以"是否已写入 socket"为分界**

请求在 `socket.write()` 成功回调之前遇到连接错误 → `NOT_SENT` (可安全重试); 已写出后连接断开且未收到响应 → `SENT_LINK_LOST` (副作用未知).  这个分界偏保守: write 成功只代表数据已交给内核, 不代表 bridge 已执行, 因此可能把实际未执行的请求也报成 `SENT_LINK_LOST`.  这个方向的错误是可接受的 — 代价是 agent 多截一次图确认, 反方向的错误 (把已执行的操作报成可安全重试) 会导致重复点击/重复提交.

**6. tool 注册接口只依赖最小 shape, 不依赖 tool-defs 包的具体形态**

注册接口接受 `{name, description, inputSchema: ZodType}` 数组, 内部用 zod → JSON Schema 派生 MCP schema.  本 change 只提供接口与一个测试用 stub 定义.  tool-defs 定稿后, 由一个薄适配层把它映射成这个 shape 即可, 传输层与 server 主体不受影响.

**7. fake bridge 作为一等测试设施**

fake bridge 是一个可脚本化的本地 unix socket server: 可配置 hello 帧内容 (含不兼容版本), 可配置响应/延迟/静默, 可主动断连于"写入前"或"写入后".  spec 里的每条场景都靠它驱动, 因此它必须能精确制造这些时序, 而不是尽力模拟.

## Risks / Trade-offs

- **write 成功 ≠ bridge 已收到** → 以保守方向处理 (报 `SENT_LINK_LOST`), 并在错误信息里明确要求先截图确认副作用, 而不是让 agent 自行猜测
- **zod 大版本尚未与 mie 仓库对齐** (v3 需要 `zod-to-json-schema`, v4 有内置 `z.toJSONSchema`, 二者产出的 schema 结构有差异) → 本 change 按 `@modelcontextprotocol/sdk` 当前要求选定并在 `package.json` 里锁死大版本; tool-defs 起包时以本仓库锁定的版本为准, 需同步给 mie-main
- **`tool_defs_version` 目前无从校验** (包未定稿) → 本次只记录并在日志中暴露, 不做拒绝逻辑; 待 tool-defs 有版本号后再补校验规则, 属于后续 change
- **协议是跨仓库契约, 单侧改动会静默破坏对方** → 以 hello 握手的 `protocol_version` 为硬闸: 任何帧格式或错误码语义变更都必须提升版本号, 使不匹配在启动期即暴露而不是在运行期表现为丢参数
- **fake bridge 验收通过不等于真实 bridge 可用** → 本 change 的验收边界仅到协议层; 与真实 bridge 的联调作为后续独立一轮, 不在此处宣称通过

## Open Questions

- zod 大版本已定: v4 (见 mie-tool-defs-contract)
- tool-defs 的发布方式 (npm scoped 包 / git dependency), 由 jt 拍板; 本 change 开发期用本地路径覆盖, 不阻塞
- `tool_defs_version` 不匹配时应拒绝启动还是仅告警 — 待 tool-defs 有稳定版本号后再定
