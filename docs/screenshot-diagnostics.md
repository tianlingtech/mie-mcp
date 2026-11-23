# 截图故障诊断

MCP 0.9.0 / tool-defs 0.24.0 增加 `screenshot_diagnostics`, 用于读取和清理
当前 profile 的扩展截图诊断.  本轮提供故障发生后的关联证据, 不宣称历史
截图超时已经修复.  MCP 不另建日志数据库, 不自动重试截图或读取系统电源日志.

## 读取与清理

先确认 `profiles_list` 中的目标 profile, 再读取该 profile 的日志:

```json
{"profile":"work","action":"read","limit":20}
```

`action` 省略时为 `read`.  可按 `diagnosticId` UUID、正整数 `tabId`
筛选, `limit` 为 1..150 的整数, 默认 20.  读取不要求 tab 仍存在,
不触发截图、不附着 debugger、不激活页面.  省略 profile 固定使用 default,
与既有浏览器工具相同, 不沿用上一调用的 profile.

清理当前 profile 全部诊断:

```json
{"profile":"work","action":"clear"}
```

clear 不接受 diagnosticId/tabId/limit 过滤项.  清理后的迟到回调不能把旧
记录写回来.  读取、清理只路由到指定 profile, 不清理其他 profile 日志.
profile 本身需在线才能访问扩展 storage.local; tab 已关闭与 profile 离线
是不同情况.  离线恢复方式见 [Profile 本机启动](profile-launch.md).

## 如何解释诊断

新版截图成功时, MCP 原生 image 块保持图片字节及 MIME 不变,
关联元数据出现在同一响应的 text JSON 和 structuredContent 中:

```json
{"mimeType":"image/png","width":1280,"height":800,"diagnosticId":"11111111-1111-4111-8111-111111111111","diagnosticStatus":"saved"}
```

`diagnosticStatus` 为 saved/pending/unavailable, saved 与 pending 必须带
合法诊断 ID.  saved 表示诊断已保存, 不等同于页面业务操作成功;
pending 表示保存尚未确认, unavailable 表示诊断不可用.
普通写入为异步, pending 状态下突然退出可能丢失该次更新.
unavailable 也可能表示记录已清除或淘汰, 不仅是存储故障.
收到合法图片而诊断字段损坏时, MCP 保留图片, 将诊断状态降为 unavailable,
不回显无效字段.  旧截图载荷没有这两个字段时, 保持原有输出, 不伪造 ID.
截图落盘仍保存原图片字节, 诊断元数据不写进图片文件.

扩展返回的截图错误保持原 code 和 message, 原生响应的诊断关联在 error.data
中.  MCP 既有格式将整个 bridge error 放进 MCP error.data, 因此客户端应从
`structuredContent.error.data.data.diagnosticId` 读取关联 ID, 同级
diagnosticStatus 是保存状态; text JSON 中相应路径为 error.data.data.
不要求从错误文本解析 UUID, 不改变既有错误包装.  传输中断或旧版本失败可能没有
关联 ID, 此时可在 profile 恢复后按 tabId 和时间查找已有记录.
MCP 自身图片校验、文件保存错误不保证携带扩展关联 ID.

扩展在本机 storage.local 保存有界元数据, 保留 7 天, 成功、失败和 pending
各最多 50 条, 总数最多 150 条, 记录存储预算 512 KB.  三类独立预算避免
成功截图的 pending 阶段挤掉已有失败记录.  worker 或浏览器重启后仍可
查询保留记录.
截图调用结果与底层 CDP 结果分别记录: 调用超时不代表 Chrome 已取消截图,
迟到的成功或错误仍属于同一诊断 ID.  tab 关闭或 debugger detach 是相关
事件, 不应仅凭其时间接近就推断截图失败原因.

日志只保存诊断 ID、UTC 毫秒时间、版本、tab/window 状态、viewport/DPR
及截图参数等元数据.  不保存图片、页面正文、URL、标题、输入内容、cookie
或任意错误文本.  存储及辅助状态读取故障不能覆盖真实截图结果, 也不能造成
无界等待; 不把无法保存诊断说成截图本身失败.

读取同时返回 storageStatus、storageError、pendingWrite, 即使磁盘写入失败,
仍可读取的内存记录也不会被隐藏.  初始载入和 clear 写入确认最多等 200ms;
clear 只有在写入确认后返回 cleared=true, 超时明确表示未确认, 后续仍可能
完成.  辅助 tab/window 采样最多等 100ms, 失败或超时状态明确记录.
callerOutcome/callerFinishedAt 只表示扩展内截图处理, 不包含 MCP 图片校验、
文件保存或客户端收包.  worker 重启后旧 pending 记录不能推断为成功或失败.

取得故障记录后, 先按诊断 ID 对齐调用开始、调用结束和底层 CDP 结束.
必要时再按明确时间范围与已授权的系统日志对照.  UTC 时间相近只是相关性,
不是休眠、后台窗口或某个 tab 状态导致失败的证明.  document.hasFocus
不证明物理窗口处于前台.  不为补日志再次截图或自动重放其他操作.

该诊断用于 MIE 扩展处理的截图请求.  外部原生 CDP 客户端直接发送的
Page.captureScreenshot 不会因为 MCP 新增此工具而自动产生 MIE 诊断.
旧版本截图可能没有诊断 ID, 读取不到记录不能证明截图请求从未执行.

## 实施状态

2026-10-02 首次候选的 MCP build/typecheck 通过, 定向验证 97 项通过,
另 23 项未选中.
其中新增诊断消费 19 项、图片坐标 15 项、图片存储 32 项、profile 路由
20 项、共享契约 5 项、其他工具列表断言 6 项.  静态代码审查 PASS.
错误包装路径按现有实现验证, 图片成功与诊断可用性分开断言.

新鲜隔离 SDK 的 serverInfo/profiles_list 均为 0.9.0, tools/list 为 24 项.
相对 0.8.0, 原有 23 个工具的完整契约不变, 只新增 screenshot_diagnostics;
快照新增其输入和完整契约两项.  证据位于
`.e2e-test/runs/mcp-screenshot-diagnostics-0.9.0-proof/`, 准备清单包含
37 个 MCP/shared 文件.  完整 `build.json` 已补扩展与 bridge, 共 56 文件;
首次冻结时 37 文件未变, 扩展 background/manifest 与 owner 给定值一致.
该候选随后因 pending 与失败共用预算会挤掉失败记录而撤销联测交付,
原清单继续保留.  新候选采用三类独立预算、limit 上限 150, 已重新
build/typecheck 并通过诊断消费 20 项、契约 5 项定向测试.  连同此前未受
影响的测试, 累计 98 项通过; 此次只重跑受影响范围, 不是全量测试.
新鲜 SDK 确认 150 上限及 151 拒绝, 原 23 工具完整契约仍不变.
新增 `build-retention-preparation.json`、`tools-list-retention.json` 和
`sdk-no-bridge-retention.json` 保留修正后证据, MCP 执行文件未变,
共享文件仅 schemas.js 与 screenshot-diagnostics.js 更新.
最终 `build-final.json` 已冻结 56 文件.  相对撤回清单, 仅 extension
background.js 和共享 schemas.js、screenshot-diagnostics.js 三文件变化;
修正后准备阶段的 37 文件全部匹配.  读取结果通过 maxSuccessRecords、
maxFailureRecords、maxPendingRecords 分别报告三类上限.
这些准备证据不证明用户当前 MCP 或 Chrome 扩展已经更新.

## 独立真实 SDK 结果

证据根目录 `.e2e-test/runs/mcp-screenshot-diagnostics-090-20261002/`.
首次运行 2 个版本/身份场景通过, 首次正常 MIE 截图自然超时失败;
`read-only-continuation/` 基于同一条记录续验 4 项通过.  总体为
6 PASS / 1 FAIL, 不是单轮全绿.  两轮前后各 56 文件与最终冻结清单一致,
主线程另核对当前磁盘相同.  没有为补图重试截图或读取整机电源日志.

自然失败保留原 `TOOL_ERROR` 与消息
`CDP Page.captureScreenshot timed out after 20000ms.`.  当时 capture/storage/
context 故障模式均为 normal, held 为空, 仅实际发出一次 capture 请求.
诊断 ID `bea9fe95-df2c-48dd-acf0-e847fa1563a0` 通过既有 MCP 错误包装
完整返回, 最初 diagnosticStatus 为 pending.  随后按 ID 读取成功,
storageStatus 为 saved、storageError 为 null、pendingWrite 为 false.

初读记录为 callerOutcome=timeout、cdpOutcome=pending.  关闭失败 tab 后、
clear 之前读取同一 ID, callerOutcome 仍为 timeout, cdpOutcome 已变为
error、cdpLate=true.  cdpFinishedAt/tabRemovedAt/debuggerDetachedAt 均为
1790919454813 UTC 毫秒.  记录保存了实际 viewport/DPR、截图 CDP 参数和
tab/window 状态, 不把关闭后的迟到错误当作超时起因, 不从 active/focused
状态推断电源问题, 不宣称与历史截图超时同因或已经修复.

| 续验范围 | 结果 |
| --- | --- |
| 原错误、诊断 ID 及关闭后读取 | PASS, 保留原码/原文, 同一记录可读且迟到/生命周期字段更新 |
| 读取与参数边界 | PASS, 预置观测下无新增 attach/capture/activate, limit 150 接受、151 拒绝, 非法 clear 不生效 |
| 独立 profile B 读取与清理 | PASS, B 不能读到 A 的自然失败记录, 清理 B 不影响 A |
| 清理 A | PASS, 确认 clear 后即时、500ms 后及持久记录均为空 |

此 A/B 用两个独立 SDK 环境和不同真实 profile UUID, 验证扩展存储隔离;
不把它扩称为同一个 MCP server 的多名称路由验收.

续验没有新截图或故障模式切换.  已结束记录 clear 后保持为空不等于
重新覆盖所有迟到回调竞态, 底层机制矩阵由扩展 owner 单独验收.
真实正常图片成功元数据、存储失败时仍返回真实 PNG 两条 SDK 路径本轮
没有独立覆盖, 两个原计划注入未执行.  本仓 fake bridge/图片存储测试及
owner 其他实例结果须分列, 不能抵消本次真实正常截图 FAIL.

最终清理 PASS.  tester 自有 SDK/native/fixture 已清理, 按 release event
15532, owner 使用各自独立状态文件清理 A18513/B20335.  主线程将
owner-cleanup-A/B.json 与 owner 原始
`../mie/.e2e-test/runs/screenshot-diagnostics-handoff-2026-10-02T05-31-17-050Z/`
下 A/B/cleanup.json 逐项比对一致, pidAbsent/tempRootAbsent/stateAbsent
均为 true; 另独立确认两个 tempRoot 与两个 stateFile 均不存在.
`final-status.json` 保留整体 FAIL、6 PASS / 1 FAIL、2 项未执行和清理 PASS.
本次借用 A/B 没有残留, 不扩称 owner 其他准备目录也已清理.
