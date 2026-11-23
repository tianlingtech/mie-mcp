第三轮 request 契约同步报告, 2026-09-30.

MCP 配套改动完成, 构建、类型检查、32 项定向测试和代码审查 PASS.
权限恢复并重新交接专用实例后, 独立真实 MCP E2E 38/38 PASS,
0 FAIL, 0 BLOCKED.  首轮 0 功能执行 / 1 环境前置 BLOCKED 的历史证据保留.

本轮接入共享 `@mie/tool-defs` 0.19.0, protocol 仍为 1, 工具数仍为 22.
修改仅涉及文档、request schema 快照及定向回归测试, 无 MCP `src/` 改动.
既有传输层原样保留重定向的正常 content JSON、二进制摘要和网络错误提示,
无需新增错误码或 hint.  使用契约见 [E2E 工具说明](e2e-tools.md).

| 验证 | 结果与范围 |
| --- | --- |
| build / typecheck / diff-check | PASS |
| `test/tool-registry.test.ts` | 17 项 PASS, 包括错误透传 |
| `test/tool-defs.test.ts` | 5 项 PASS, 44 个快照中仅 request 的两个快照更新 |
| `test/request-response.e2e.test.ts` | 10 项 PASS, SDK stdio 到本地 fake bridge, 不包含真实浏览器 |
| 代码审查 | 最终 PASS, 0 CRITICAL / 0 WARNING |
| 新 stdio 原始 tools/list | PASS, 0.19.0 / 22 工具, 本轮及 0.18 新参数完整 |
| mcp-tester 独立 schema / 冻结指纹预检 | PASS, 尚不代表浏览器功能通过 |
| mcp-tester 独立真实链路 | 复测 38/38 PASS, 0 FAIL / BLOCKED; 首轮阻塞另存 |

新定向测试验证 GET/HEAD/POST 重定向正常返回且不重试, 网络错误的 message
原样保留, 完整/截断二进制摘要透传, 非法参数在连接 bridge 前拒绝,
以及省略格式时保留文本响应.  完整响应夹具的 maxBytes 大于实际字节数;
达到上限的夹具明确标记截断且 sha256=null, 与真实 producer 一致.

开发侧 stdio 测试首次因沙箱禁止 Unix socket 监听而报 EPERM, 随后该定向
命令通过自动审批并重跑成功.  这与独立 tester 会话的权限不同, 不替代其
真实浏览器验收.  后者审批策略为 never, 在首个 fixture
`listen(0, 127.0.0.1)` 时失败, 随即停止依赖组.  未连接 browser/bridge,
未创建标签页, `cleanupErrors=[]`, 专用实例已明确交还 mie-tester.

权限恢复后, tester 在新交接的专用实例完成真实 SDK stdio → MCP → bridge
→ extension 验收.  覆盖同源/跨源 GET、HEAD、授权 POST 重定向且目标零访问,
完整二进制独立 SHA-256、前缀、空体、HEAD、206 范围和到达上限保守截断,
文本默认行为及 JSON 脱敏, 9 组非法参数零请求, 读写错误提示和慢流超时.
本次 fixture 每个合法请求 ID 仅出现一次, 不将其泛化为 Chrome 在所有
网络故障下均不透明重发幂等请求.  50000 上限通过 schema 和越界拒绝验证,
未对 50000 字节成功体额外执行压力测试.

首次恢复时测试脚本误将 get_page_text 普通文本解析为 JSON, 随即停止并清理.
tester 修正自己的解析脚本后完成 38 项验收, 未修改产品, 原错误记录保留.
两次自建标签页均关闭, managed tabs 为空, SDK 及两个 HTTP fixture 服务已清理,
专用浏览器已交还 mie-tester, `cleanupErrors=[]`.

本地证据:

- 原始 tools/list 与属性断言: `.e2e-test/runs/mcp-round3-schema-proof/`.
- 独立预检: `.e2e-test/runs/mcp-round3-20260930/preflight-tools.json`,
  `preflight-summary.json`, `frozen-build.json`.
- 阻塞原始错误及计数: 同目录 `live/fatal.json`, `live/summary.json`,
  `runner.txt`.
- 独立真实链路脚本: 同目录 `request-e2e.mjs`, 已完成语法检查.
- 恢复后报告及 manifest: `.e2e-test/runs/mcp-round3-resume-20260930/`.
  原始 `live/results.json`, `transcript.jsonl`, `requests.json`, `cleanup.json`
  与 `stderr.log` 记录真实链路、服务端计数及清理结果.

独立预检核验的扩展 background.js SHA-256 为
`7bb3dfa54eeb20c41ad163e4dfe3da2e6c7d4015437c21c61a7f8e4a69105bc4`.
主仓另有 bridge/extension 真实 E2E 8/8 组 PASS,
见 [主仓验收报告](../../mie/docs/request-feedback-report.md), 不将该结果
混入本仓 MCP 的真实 E2E 计数.

恢复验收对应提交 `1ba5ba27a7110eb4d2690a5811da857cce9fd2d5`.
已核对 38 个唯一用例的原始 PASS 结果, 当前 HEAD、扩展与 MCP 入口指纹
均与 manifest 一致.  本轮真实验收阻塞已解除, 历史 BLOCKED 记录未覆盖.
产品及测试改动已提交, 本次仅更新报告, 未 push, 未操作用户 Chrome
或其他 agent 进程.
