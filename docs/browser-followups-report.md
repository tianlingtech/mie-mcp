本轮对应 tool-defs 0.20.0 / protocol 1 / 22 tools.  MCP 适配、定向契约
测试及独立代码审查已通过.  独立真实 MCP 功能验收累计 70 PASS,
辅助截图在两个专用环境可复现失败.  最终 manifest 判定 FAIL,
最新覆盖汇总为 70 PASS / 1 FAIL / 0 BLOCKED, 不标为全部通过.

需求与产品契约见 `../mie/docs/browser-acceptance-followups.md`, MCP
使用方式见 [e2e-tools.md](e2e-tools.md).

本仓库运行时变更仅为所有 `tabs_close` 请求注入本 MCP 进程 sessionId,
包括显式 tabIds 且 mineOnly=false 的调用, 用于审计关闭方.
客户端仍不能提交内部 sessionId, 工具列表也不暴露该字段.
network_idle 排除、includeClosed 和 hashOnly 复用共享 schema 验证与
现有透传, 不新增工具、不扩展 MCP bridge 超时、不添加自动重试.

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| npm run build | PASS | 编译 MCP dist |
| npm run typecheck | PASS | 源码与测试类型检查 |
| 7 个定向测试文件 | 60/60 PASS | 新契约及相关既有回归, SDK stdio + fake bridge |
| schema 快照 | 44 项匹配 | 仅 request/tabs_context/wait_for 的 6 项预期变化, 更新后单独复跑通过 |
| 独立代码审查 | PASS | network_idle actual 夹具结构问题已修正并复核 |
| 新 SDK 进程 tools/list | PASS | 0.20.0 / protocol 1 / 22 tools, 新参数可见 |
| 独立真实 MCP 功能 E2E | 累计 70 PASS | network 30 / audit 7 / hash 30 / 顺序新 profile 隔离 3, 含定向补验 |
| 辅助截图 | FAIL | 两个专用环境均有 Page.captureScreenshot 20000 ms 超时, 未解决 |
| 资源清理 | PASS | 自建 tabs/SDK/HTTP 已清理, 两个专用浏览器均取得 owner 清理回执 |

60 项为去重后的测试数, 不累计前期 25 项及快照复跑中的 5 项.
定向文件为 tool-registry、tool-defs、p0-tools、round2-tools、
request-response、browser-followups、request-hash-only 对应测试文件.
未运行全量测试, 未操作用户 Chrome 或 tmux.

新契约覆盖排除参数边界和透传、两个 MCP 进程的关闭方 session、
includeClosed 查询与审计结果透传、hashOnly 的模式约束、上限、完整与
不完整摘要、写授权、重定向及无重试.  fake bridge 返回的摘要由测试
构造, 不证明扩展实际流式哈希、网络空闲算法或关闭来源归因正确.
这些行为必须由专用浏览器上的独立真实 E2E 验证.

原始 tools/list 和 32 个编译 JS 文件指纹位于
`.e2e-test/runs/mcp-followups-0.20-schema-proof/` 的 tools-list.json 与
summary.json.  此证据对应首轮构建, 基于提交
`1ba5ba27a7110eb4d2690a5811da857cce9fd2d5` 加本轮未提交工作区.

首轮 extension background.js SHA-256 为
`ed49d558188ae6c28188973205c0ba24e20d1266b499097f0263d5134a7b1878`,
MCP dist/tool-registry.js SHA-256 为
`35dd7ca0b0f6974e3ea366561cfcccabd29e74b6ff748793dcf934dc7be9c6c7`.

mie-main 的产品审查随后发现 101+ 批量关闭可能挤掉审计意图, 以及 CDP
关闭尚未接入审计, 已在 xats event 14545 通知修复.  首轮指纹不作为
最终产品验收依据, 保留此历史证据.

第二轮冻结由 mie-main 在 xats event 14566 交付.  新 background.js
SHA-256 为 `dd923439c4db7809f33a26ac322fcb1a4ee7690013d3ac53456d27489627b30c`.
独立重算全部 32 个 JS 文件, 只有 background.js 变化, 其余 31 个
MCP/shared 文件不变, 原有 MCP 契约验证仍对应当前产物, 未重复累计测试.
第二轮指纹保存在同一证据目录的 summary-round2.json, 未覆盖首轮记录.

产品修复包括独立保存 pending 关闭关联、CDP 关闭审计, 以及导航提交时
按 frame/loader 清理旧文档在途请求.  独立真实 MCP 验收采用第二轮冻结
产物, 原始证据位于 `.e2e-test/runs/mcp-followups-020-20261001/`.

首跑 summary.json 为 66 PASS / 1 FAIL / 1 BLOCKED.  FAIL 对应脚本
调用 window.open 未建立真实用户交互而未观察到 popup; 随后改用
find + computer 点击真实按钮, popup 继承和跨 session 批量关闭 1 PASS,
原记录保留在 popup-retest/ 之外的首跑证据中, 未覆盖或改判.
顺序创建的新 profile 补验另有 3 PASS / 1 FAIL, 位于 profile2/.
因此功能累计 70 PASS 来自首跑及定向补验, 并非单次完整 70 项重跑.
已核对 manifest.json 的 71 个不同案例, 以及 build-final.json 中
32 个编译文件的执行后指纹, 均与当前文件一致.

网络案例覆盖持续 SSE/Media/Fetch、显式排除后的普通 API 门控、OR、
大小写和字面子串、并发等待、tab 隔离与同 tab 导航取消.
审计覆盖真实双 MCP 会话、按创建方 mineOnly、失败/外部/CDP 关闭、
单批创建并关闭 102 个 tab 后保留 100 条正确记录及真实按钮 popup.
hash 案例覆盖 50001 / 3300123 字节的独立 Node crypto 比对、空体、
HEAD、206、cap-1/cap/cap+1、默认上限、无 EOF、超时、中断、授权、
重定向及旧 binary/text.  新 profile 验证旧 tab/审计/网络状态不继承.

首跑 BLOCKED 标签为 hash-remaining, 实际发生在 30 项 hash 行为全部
通过后的辅助截图, 没有剩余 hash 行为被跳过.  新鲜 profile 的辅助截图
也再次失败.  已直接核对两个 transcript.jsonl, 均返回 TOOL_ERROR:
`CDP Page.captureScreenshot timed out after 20000ms.`.  首个 network
fixture 截图曾通过, 不能据此否定后续可复现失败.  尚无根因结论, 不将
截图失败改写为环境通过或声称修复, 整体验收不标为全部 PASS.

本次 MCP tester 未独立验证 24h TTL、worker 生命周期、浏览器重启和
extension reload; 产品侧其他 tester 的结果不累计到这里.
64 MiB 仅验证参数接受, 未做该体积压力测试, 也未验证峰值内存.
原始首跑和定向测试均已清理自建 tabs/SDK/HTTP.  两个浏览器环境均已向
owner release 并取得最终清理回执: PID 41277 对应 release event 14587,
PID 72864 对应 release event 14591.  已直接核对 owner-cleanup-first.json、
owner-cleanup-second.json 及各自指向的原始 cleanup.json, 均为 PASS,
tempRootRemoved/stateRemoved=true.  manifest 的 cleanup.status=PASS.
资源清理完成不改变上述截图 FAIL, 截图根因保留为独立调查项.

后续修复范围已在 xats event 14607 扩展: 用户将截图 20 秒失败与
runtime.reload 阻塞纳入当前修复目标.  mie-main 负责产品和日志定位,
mie-tester 独立重现; MCP 侧在修复构建冻结后配合真实截图回归.
之前 70 项功能通过及辅助截图失败记录均不改判.

已从既有原始记录核对三次截图, 参数均仅为 tabId 与 action=screenshot,
未指定 format、scale、clip、quality 或 savePath:

| 实例与 tabId | 已记录前序 | 截图结果 |
| --- | --- | --- |
| PID 41277 / 2025855507 | captureNetwork=true, 可见元素等待成功, 多轮流与空闲等待完成 | PNG 1280×657 成功 |
| PID 41277 / 2025855724 | captureNetwork=false, 30 项 hash 行为验证后 | Page.captureScreenshot 20000 ms 超时 |
| PID 72864 / 1698907802 | captureNetwork=true, network_idle/read_network_requests/get_page_text 成功 | 同样超时 |

三者未在本轮 MCP transcript 中调用 set_viewport.  captureNetwork=true
同时存在成功与失败证据, 不能据此认定该开关是原因.  新 profile 的失败
也未先运行 hash 组, 不能将大文件 hash 作为该失败的必要前提.
现有 native-events.json 记录的是 debugger 事件, native-trace.json 是
诊断客户端调用, 并非扩展内部 sendCommand 全量 trace; 其中没有
Page.captureScreenshot 命令, 不能用于证明该命令未发出.
截图瞬间 active/visibility/focus、浏览器窗口状态及原生命令参数未记录,
需由专用环境的定向诊断补证, 不从截图成功或 get_page_text 成功推断.

后续有界重放记录在 `.e2e-test/runs/mcp-screenshot-replay-20261001/`.
已核对 22 项网络断言通过, 但截图前诊断脚本调用不存在的
chrome.scripting.executeScript 失败, transcript 中 computer 截图调用数为 0.
因此该次重放未完成, 分类为 22 PASS 加诊断前置 BLOCKED, 不是截图
复现或截图修复证据.  原始 summary 的执行状态为 FAIL_RELEASED,
原始 fatal 与 trace 保留, 不将脚本运行失败转换为产品失败.
清理顺序为 B 先退出、A 随后关闭自己剩余 tab, 最后 A 的 tabs=[];
cleanupErrors=[].  专用 Chrome PID 20092 已经由 release event 14645
交还 owner, 并取得 event 14648 最终清理回执.  已核对 owner-cleanup.json
及其原始 cleanup.json 均为 PASS, tempRootRemoved/stateRemoved=true.
新增 manifest 明确 22 PASS / 0 FAIL / 1 BLOCKED, cleanup.status=PASS,
保留原始 summary 与 fatal 不覆盖.  之前 70 功能 PASS 与
截图 FAIL 保持不变, 不将本次 22 项重复计入原有通过数.

根据 xats event 14653, 重放 harness 的页面诊断入口已改为已有
chrome.debugger.sendCommand 的 Runtime.evaluate, 无需新增 scripting
权限.  原脚本保存在 harness-before-diagnostic-fix.mjs, 历史结果未覆盖.
修复通过 node --check 和 5 项离线 VM mock: 正常返回、命令拒绝、页面
异常、缺少结果、null 结果.  证据为同目录 diagnostic-fix-offline-check.json.
这仅验证诊断入口, 尚未连接真实 Chrome 或重跑截图, 不代表产品修复通过.
该诊断阶段的受控熄屏实验当时仍待用户明确批准, MCP 侧未执行任何电源或显示器操作.

此前 0.19 的报告更新仍独立保留, 不计入本轮通过数.
后续 0.21 功能与 0.5.0 产品版本验收见
[新增能力报告](models-feedback-report.md), 不覆盖本报告中的历史失败.
