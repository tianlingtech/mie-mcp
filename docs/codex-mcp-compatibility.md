# Codex MCP 兼容排障记录

2026-09-24, Codex 0.156.1 的可见工具缺少 `computer`.  增加别名
`browser_interact` 并重启后, 两个入口仍不可见.

证据来自本机 `~/.codex/logs_2.sqlite` 的 `logs` 表,
target 为 `codex_core::mcp_tool_exposure`.  两个入口均出现:

```text
Skipping MCP tool ...: failed to build tool spec:
invalid type: map, expected a string
```

排障时 stdio `tools/list` 正常返回 15 个工具, 含两个入口.
因此不能将工具缺失直接归因为未安装, 未重启或名称冲突.
本机 Codex 源码的 `JsonSchema.items` 类型为单个 schema 对象,
而原 coordinate 派生为 draft-07 tuple 的 `items: [schema, schema]`.

修复在 MCP 派生层将固定长度同构 tuple 改为单个 items schema,
保留 minItems/maxItems 和原始 Zod 校验.  不改共享包或 bridge 协议.
针对性测试覆盖 schema 快照, 合法坐标转发, 非法长度/负数/非数字拦截,
异构 tuple 保持原样, 以及别名结果和错误透传.

23:23 全局刷新后, 当前 Codex 会话已可见全部 15 个工具,
`computer` 和 `browser_interact` 均恢复, `tabs_context` 实际调用成功.
这排除了名称冲突假设.  23:26 tester 在自建后台标签完成点击和截图,
页面状态正确变化, 返回 PNG 1728x921, 标签始终 active:false.
单凭 stdio 列表或单元测试通过不能宣称 UI 验收通过.

确认根因后移除临时 `browser_interact` 别名, 恢复共享包的 14 个工具,
交互统一使用 `computer`, 避免相同能力的重复入口增加选择负担.

本机 Codex 使用共享 app-server.  重启前端不保证重建 thread 已持有的
MCP 子进程.  `config/mcpServer/reload` 也可能复用配置未变化的进程.
本次经 jt 授权全局刷新, 并将全局 mie.command 从 `node` 改为当前解析的
Node 绝对路径后再次刷新, 才触发 MIE 进程重建.  该 API 遍历所有已加载
thread, 使用前必须确认影响范围, 不应未经授权重启共享 app-server.
刷新后 xats 的连接绑定可能丢失, 用已知 name/team 重新注册即可.
