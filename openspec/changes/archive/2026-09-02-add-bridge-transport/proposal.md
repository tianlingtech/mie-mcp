## Why

mie 是一个复用浏览器登录态做自动化的 Chrome 插件, 整条链路是 Extension (MV3) →native messaging→ 本地 bridge 进程 →unix socket→ 本仓库的 MCP server → agent.  bridge 与 extension 由 mie 仓库 (另一个 agent) 负责, 本仓库负责 MCP server 一侧.  两侧分仓分 agent 并行开发, 共享的 tool 定义包 (mie 仓库 `packages/tool-defs`) 尚未定稿, 但双方已就传输层协议 v1 达成书面一致.  先把不依赖 tool 定义的传输/协议层建起来, 可以让两边解耦推进, 并让后续接入具体浏览器 tool 时不必返工.

## What Changes

- 新建 TypeScript 项目骨架 (`@modelcontextprotocol/sdk`, stdio transport), 本仓库当前为空仓库
- 实现 bridge client: 连接 `$TMPDIR/mie-bridge/<uid>/bridge.sock` (unix domain socket), 惰性连接 + 断线重连; 启动时 bridge 不存在**不是**致命错误
- 实现行分隔 JSON 帧编解码: 请求 `{id, type:"tool_request", tool, args, timeout_ms}`, 响应 `{id, type:"tool_response", payload|error}`; 预留 `{type:"event"}` 帧位 (本次不实现语义, 收到即安全忽略)
- 实现握手与版本协商: bridge 在连接建立后主动发 `{type:"hello", protocol_version, bridge_version, tool_defs_version}`, `protocol_version` 起始值为 1; 版本不兼容时拒绝启动并报出双方版本差异
- 实现超时归属: 请求携带 `timeout_ms` 由 bridge 计时并回 TIMEOUT 响应帧, MCP server 仅做 `timeout_ms + 5s` 的兜底; 迟到响应按 `id` 丢弃
- 实现错误码原样透传, 不归一化为通用失败: `BRIDGE_NOT_RUNNING` / `NOT_SENT` / `SENT_LINK_LOST` / `TIMEOUT` / `TAB_GONE` / `TOOL_ERROR`; 枚举可扩展, 未知码同样透传而非吞掉
- 提供 tool 注册接口: 从外部 tool-defs (zod schema) 动态派生 MCP tool schema; 本次只留接口 + 测试用 stub, **不实现任何具体浏览器 tool**
- 提供 fake bridge (本地 unix socket mock server) 供测试与 e2e 使用

## Capabilities

### New Capabilities
- `bridge-transport`: 与 bridge 之间的 unix socket 链路 — 连接与重连, 行分隔 JSON 帧编解码, hello 握手与版本协商, 请求超时兜底与迟到响应丢弃, 错误码语义
- `mcp-server`: MCP stdio server 运行时 — 启动与生命周期, 从 tool-defs 动态派生 tool schema 的注册接口, bridge 错误码到 MCP 工具响应的映射规则

### Modified Capabilities
无 (本仓库尚无既有 spec).

## Impact

- 受影响代码: 全部为新增.  新建 `package.json`, `tsconfig.json`, `src/` (bridge client, 帧编解码, 握手, MCP server, tool 注册接口), `test/` (含 fake bridge)
- 新增依赖: `@modelcontextprotocol/sdk`, `zod` (大版本需与 MCP SDK 要求对齐, 并与 mie 仓库 `packages/tool-defs` 的 peerDependency 一致), zod → JSON Schema 转换库; 开发依赖含 TypeScript 与测试框架
- 跨仓库契约: 协议 v1 与 mie 仓库的 bridge 实现一一对应, 任何帧格式/错误码变更都必须同步对方并提升 `protocol_version`
- 不在本次范围: 具体浏览器 tool (P0 tool 集)、CDP relay 通道、与真实 Chrome / 真实 bridge 的联调 (待 mie 仓库 P0 完成后另起一轮)
