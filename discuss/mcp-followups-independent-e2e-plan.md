来源: xats events 14546, 14552, 产品需求与 MCP 使用文档.
状态: 仅准备, 未执行真实 E2E.  首构建冻结已撤回, 等修复后的完整指纹和专用环境交接.

目标为 disposable 专用 Chrome profile, 使用 SDK stdio → MCP → bridge →
extension 的真实链路.  所有页面和响应来自本机合成 fixture.  不修改产品代码,
不操作用户 Chrome/tmux, 不跑全量测试.  每个测试组前置条件失败时停止该组,
区分 FAIL 与 BLOCKED, 保留每轮原始证据.

| 顺序 | 用例与操作 | 独立断言 | 证据 |
| --- | --- | --- | --- |
| 前置 | 核对交付的编译文件指纹, 启动两个 SDK MCP 会话 | 0.20/protocol 1/22 tools, session 不同, schema 不暴露 sessionId | build.json, tools.json, baseline.json |
| 1 | 导航前开启 captureNetwork, 页面启动 SSE、流式 fetch 和媒体请求 | CDP 日志确实观测到目标类型及未结束请求; 未排除等待超时 | network-transcript.jsonl, fixture-events.json |
| 1 | 分别按 CDP 类型、URL 子串及两者 OR 排除 | 只有匹配请求被排除; 普通 API 未释放时仍不匹配 | network-results.json |
| 1 | fixture 记录普通 API 完成时间, 然后继续等待 | 普通 API 完成后且满足 idleMs 才返回; 每次等待重新计时 | network-results.json, fixture-events.json |
| 1 | 大小写不同、glob/regex 字面文本、无匹配规则 | 不匹配的长请求继续阻止空闲; 网络日志未被规则改写 | network-results.json |
| 1 | 新等待省略规则, 并在第二 tab/profile 等待 | 排除不会持久污染后续等待; tab/profile 计数隔离 | network-results.json |
| 1 | 同 tab 启动长流后导航到无请求页面 | 导航取消的流不会留下永久在途计数; 联合服务端 close 和 CDP 事件判断 | navigation-results.json |
| 1 | 非法 CDP 类型、21 项数组、空/1001 字符 URL、非 network_idle 携带规则 | schema 拒绝, 不触发对应浏览器等待 | invalid-results.json |
| 2 | B 创建 tab, A 显式关闭, 分别查询 mineOnly/includeClosed | owner=B, closer=A, mineOnly 按 owner; result 与 closedAt 分开核对 | audit-transcript.jsonl |
| 2 | 默认查询、popup 继承、外部关闭、失败关闭 | 默认不返回 closedTabs; popup owner 正确; 外部字段为 null; 失败不伪造实际关闭 | audit-results.json |
| 2 | 对自己创建的 tab 批量关闭, 含 101+ 容量用例 | 最新最多 100 条, 仍保留正确关闭意图/归属; 不被 onRemoved 连锁替换为 external | audit-results.json |
| 2 | 在专用环境执行 CDP 关闭及第二 profile 查询 | 按最终修复契约核对来源; profile 不泄漏审计 | audit-results.json |
| 3 | 请求 50001 字节、约 3.3 MB、空体、HEAD、206 合成响应 | Node crypto 独立计算 SHA-256; 仅 EOF complete=true; 206 仅对应返回范围 | hash-results.json, fixture-hashes.json |
| 3 | 响应长度为 cap-1/cap/cap+1, 默认 cap, cap 后无 EOF | exact-cap 必须继续判 EOF; 超限或无 EOF 不能返回部分 hash | hash-results.json |
| 3 | 响应头后慢流、中断、无限流; 响应头前超时/失败 | 正文读取错误返回不完整摘要; 建立阶段沿用工具错误; 超时有界且取消读取 | hash-results.json, fixture-events.json |
| 3 | hashOnly 上限 67108864/67108865、prefixBytes 非法组合、旧 binary/text 上限 | 合法边界按 schema 接受, 非法参数不发送请求; 默认行为不回归 | invalid-results.json |
| 3 | 同源/expectedOrigin/写授权/重定向边界 | 不越权, 不跟随重定向; 服务端请求计数验证无 MCP 自动重试 | hash-results.json, fixture-events.json |
| 清理 | 关闭本轮 tab、SDK、fixture, 向环境 owner 释放浏览器 | 自建资源归零, 不影响交接时受保护资源; owner 回传 profile/state 清理证据 | cleanup.json, owner-cleanup.json |

所有 hashOnly 成功或不完整摘要均检查无正文、Base64、encoded 或 prefix 字段.
响应 cap 后的无 EOF 用例使用 chunked 流, 避免 Content-Length 提前标记完成.
网络失败用例先发送响应头和部分正文, 将响应头前失败单独测试, 避免把 Chrome
可能的透明重试误归因为 MCP 重试.  媒体 fixture 必须由日志证明确实保持在途,
否则记为前置条件不足, 不能凭 HTML 标签存在认定测试有效.

24h TTL 和浏览器/worker 重启的覆盖方式在环境交接时与 mie-tester 协调.
不修改系统时钟, 不重启他人环境; 未独立执行的项目明确记录覆盖限制,
不把 teammate 自验结果计入本 agent 的 PASS 数量.  截图用于 fixture
可见状态留证, API 行为以原始协议响应、事件日志和独立断言为通过依据.

环境安排依据 mie-tester event 14559: 新构建先由其独立验收, 再创建新鲜
profile 交接, 浏览器 owner 仍由其担任.  helper 只有一个 state 槽,
profile 隔离采用顺序释放/新建, 不并发覆盖共享 state.  各网络组用独立
tab, 另设同 tab 导航回归.  reload/重启检查安排在 hashOnly 之后,
避免生命周期检查阻断不相关用例.  首轮 teammate 报告的导航残留与
reload 失联作为待复现线索, 不直接作为本轮独立 FAIL 证据.
