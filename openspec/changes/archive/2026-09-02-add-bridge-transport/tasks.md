## 1. 项目骨架

- [x] 1.1 创建 `package.json` (TypeScript, ESM, Node >= 20), 加入 `@modelcontextprotocol/sdk` 与 zod 依赖, zod 大版本按 MCP SDK 当前要求锁死并在注释中标注需与 mie 仓库 tool-defs 对齐
- [x] 1.2 创建 `tsconfig.json` 与构建脚本 (`build` / `typecheck`), 输出到 `dist/`
- [x] 1.3 接入测试框架与 `test` 脚本, 确认空测试可运行
- [x] 1.4 补 `.gitignore` 条目 (`node_modules/`, `dist/`)

## 2. 协议类型与帧编解码

- [x] 2.1 定义协议类型: `HelloFrame` / `ToolRequestFrame` / `ToolResponseFrame` / `EventFrame`, 以及错误码常量 `BRIDGE_NOT_RUNNING` `NOT_SENT` `SENT_LINK_LOST` `TIMEOUT` `TAB_GONE` `TOOL_ERROR` (类型上允许未知码)
- [x] 2.2 实现行分隔 JSON 解码器: 支持一次读取含多帧, 支持帧跨多次读取的缓冲拼接
- [x] 2.3 解码器对非法 JSON 行的处理: 丢弃该行并记录诊断, 不抛出到调用方, 后续帧继续处理
- [x] 2.4 实现编码器 (对象 → 单行 JSON + `\n`)
- [x] 2.5 单元测试覆盖 2.2/2.3: 多帧同批, 半帧拼接, 非法行后仍能解析后续帧

## 3. bridge client 连接与握手

- [x] 3.1 实现 socket 路径解析 `$TMPDIR/mie-bridge/<uid>/bridge.sock`
- [x] 3.2 实现惰性连接: server 启动不连接, 首次请求时才建立连接
- [x] 3.3 实现连接失败到 `BRIDGE_NOT_RUNNING` 的映射 (socket 文件不存在 / 连接被拒)
- [x] 3.4 实现握手: 等待 bridge 主动发来的 hello 帧, 记录 `bridge_version` 与 `tool_defs_version`
- [x] 3.5 实现版本协商: 不支持的 `protocol_version` 拒绝该连接, 错误信息同时包含对端版本与本实现支持的版本
- [x] 3.6 实现握手前的请求队列: 窗口内请求排队, 握手成功后发出, 握手失败则队列内请求以同一错误结束
- [x] 3.7 实现断线后下一次请求自动重连并重新握手

## 4. 请求生命周期与错误语义

- [x] 4.1 实现请求 id 生成 (`<uuid>-<seq>`, uuid 每进程一个) 与等待表
- [x] 4.2 实现兜底超时定时器 (`timeout_ms + 5000`), 并在收到响应时清除
- [x] 4.3 实现迟到响应丢弃: 等待表中查不到 id 的响应帧直接丢弃且不报错
- [x] 4.4 实现 `NOT_SENT` / `SENT_LINK_LOST` 判定: 以 `socket.write()` 成功回调为分界点
- [x] 4.5 实现错误码原样透传, 包括不在 v1 枚举内的未知码, 不替换为通用码
- [x] 4.6 实现 `{type:"event"}` 帧的安全忽略
- [x] 4.7 单元测试覆盖 4.2/4.3/4.4/4.5

## 5. fake bridge 测试设施

- [x] 5.1 实现 fake bridge: 在临时目录创建 unix socket server, 可配置 hello 帧内容 (含不兼容 `protocol_version`)
- [x] 5.2 支持按请求配置响应: 正常 payload / 指定错误码 / 延迟 / 完全静默
- [x] 5.3 支持主动断连, 且能分别制造"客户端写入前断开"与"写入后断开"两种时序
- [x] 5.4 提供启动/清理辅助函数, 确保测试结束删除临时 socket 目录

## 6. MCP server 与 tool 注册

- [x] 6.1 实现 MCP stdio server 启动入口 (`src/index.ts`), 启动过程不依赖 bridge 可用性
- [x] 6.2 实现 tool 注册接口: 接受 `{name, description, inputSchema: ZodType}` 数组, 派生 MCP tool schema (zod → JSON Schema)
- [x] 6.3 实现工具调用转发: 校验参数 → 发送 `tool_request` → 成功时返回 `payload`
- [x] 6.4 实现参数校验失败的处理: 在发送给 bridge 之前拒绝并返回校验错误
- [x] 6.5 实现 bridge 错误码到 MCP 工具错误响应的映射, 保留原始错误码字段
- [x] 6.6 为 `BRIDGE_NOT_RUNNING` 附加提示 "请打开 Chrome 并启用 mie 插件"; 为 `NOT_SENT` 附加"未送达, 可安全重试"; 为 `SENT_LINK_LOST` 附加"已发出但结果未知, 请先截图确认副作用"
- [x] 6.7 提供一个测试用 stub tool 定义 (不实现任何真实浏览器行为), 供列表与调用路径验证

## 7. e2e 验收

- [x] 7.1 搭建 e2e 用例骨架: 真实 MCP client (stdio) + 本仓库 server + fake bridge, 全自动无人工步骤
- [x] 7.2 e2e 场景: 握手成功后调用 stub tool, 返回 payload
- [x] 7.3 e2e 场景: bridge 未运行时 server 仍能启动并列出工具, 调用返回 `BRIDGE_NOT_RUNNING` 与中文提示
- [x] 7.4 e2e 场景: fake bridge 返回不兼容 `protocol_version` 时拒绝连接, 错误含双方版本号
- [x] 7.5 e2e 场景: fake bridge 静默不响应时触发兜底超时, 返回 `TIMEOUT`
- [x] 7.6 e2e 场景: 写入前断连返回 `NOT_SENT`, 写入后断连返回 `SENT_LINK_LOST`, 两者提示文案不同
- [x] 7.7 e2e 场景: 断线后再次调用可自动重连并成功

## 8. 收尾

- [x] 8.1 `typecheck` 与全部测试通过
- [x] 8.2 写 `README.md`: 协议 v1 摘要 (帧格式/握手/错误码), 本地开发与测试方式, 明确标注 tool-defs 与真实 bridge 联调属于后续 change
