来源: `../mie/docs/browser-acceptance-followups.md`, mie-main 的 xats event 14526.
当前阶段: xats event 14535 已确定 tool-defs 0.20 / protocol 1 / 22 tools
契约, MCP 适配和测试已编写, 等待共享构建冻结与完整验证.
本文不表示独立真实验收已完成.

按 network_idle 排除规则、关闭审计、hashOnly 顺序推进.  MIE 产品及
共享 schema 由 mie-main 负责, 本仓库负责 MCP 适配、契约测试与使用文档.
0.19 的验收报告更新保持原样.

| 项目 | MCP 契约校验 | 独立真实 E2E |
| --- | --- | --- |
| network_idle 排除 | 新字段在 tools/list 可见, 参数无损传递, 非法参数在连接前拒绝, 省略规则保持默认行为 | 持续媒体/SSE/fetch, 不匹配规则, 普通 API 仍阻止空闲, profile/tab 隔离 |
| 关闭审计 | 所有关闭调用携带本进程 session, 禁止客户端伪造, 两个 MCP 进程 ID 不同, 可选审计字段及结果无损传递 | A 关闭 B 的 tab, 外部关闭, 批量关闭, popup 继承, 失败不冒充已关闭, 容量及 profile 隔离 |
| hashOnly | 新模式与上限字段可见, 参数组合和边界验证, 完整/不完整摘要及错误无损传递, 无自动重试 | 超过 50000 字节及约 3.3MB 文件独立比对, 空体/206/超限/超时/中断/无 EOF, 无正文或内部编码泄漏 |

已确定的契约:

- `excludeResourceTypes` 使用 CDP 类型, `excludeUrlPatterns` 使用大小写
  敏感子串, 两者 OR 匹配, 数组各最多 20 项, URL 每项 1..1000 字符.
- `includeClosed=true` 额外查询审计, mineOnly 按创建方筛选.  最多
  100 条、24 小时, storage.session 跨 worker 保留, 浏览器重启或插件
  重新加载后清空.  外部关闭的 result 为 null, 不伪造 remove 结果.
- 所有 `tabs_close` 自动注入内部 sessionId, 用于关闭方归因.
- `responseBodyFormat=hashOnly` 的 maxBytes 为 1..64 MiB, 默认 20000,
  timeoutMs 最大 15000, 低于 MCP 30000 ms 总时限.  仅 EOF 返回完整
  hash; byte-limit / timeout / read-error 返回 complete=false 和 null hash.
  exact-cap 要继续判定 EOF, prefixBytes 仍仅限 binary.

验证复用 `test/support/fake-bridge.ts` 和 `test/support/mcp-harness.ts`.
重点更新 session 相关既有断言, 避免把原先显式 ID 关闭不携带 session
的行为误当成新契约.  快照仅接受冻结后预期工具的差异.

编译与类型检查后, 运行相关定向用例.  SDK stdio + fake bridge 仅证明
MCP 契约, 不证明 Chrome 的网络计数、实际关闭归因或流式哈希实现.
独立真实 MCP E2E 联系 mcp-tester@mie, 冻结构建后执行, 保留原始证据
及资源清理结果.  不操作用户 Chrome/tmux, 不跑全量测试.
