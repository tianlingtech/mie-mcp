0.6.1 文件选择交付证据的 MCP 配合报告, 2026-10-01.

本地 build、typecheck、61 项定向测试及独立静态审查 PASS.
最终冻结构建的真实 SDK 文件选择验收单次运行 28/28 项 PASS,
0 FAIL / BLOCKED, 11 张实际图片由 tester 人工复核通过.
需求见 `../mie/docs/file-input-event-consumption.md`.

MCP 产品版本 0.6.1, tool-defs 0.22.1, protocol 1, 工具数 22.
本仓未修改运行时代码, set_input_files 沿用通用参数验证与结果透传.
成功 content JSON 新增 verification、inputState 和可选 observationError,
旧响应不含这些字段时保持原样.  files 为匹配证据的元数据, cleared 仅在
请求 files=[] 时为 true; 页面消费选择后清空不改为请求清空.

当前状态或匹配可信事件能确认文件选择交付, 不代表业务上传或后续处理完成.
派发后无法确认的结果保留 TOOL_ERROR 及 FILE_SELECTION_UNCONFIRMED 原文,
提示页面可能已处理, 检查后再决定动作, MCP 不自动重发或回退到根 frame.

定向验证包含:

- file-input-delivery 10 项: 6 种当前/可信事件、控件状态、主动清空及观测
  错误元数据组合, 4 种派发后不确定结果的原文和单次请求断言.
- 旧 file-input 7 项: 原路径和预检查边界、无新增字段的旧成功载荷及错误
  兼容, 不替换历史响应夹具.
- frame-routing 20 项: 保留 scoped ref/frameId、非法输入、失败不回退.
  修正前轮过期的 type+ref+frame 拒绝断言, 将已有合法能力纳入相同路由测试.
- profile-routing 19 项及 tool-defs 5 项.  快照只更新 set_input_files 说明,
  输入 schema 不变.  测试首次预期快照失败及复跑不重复计数.

新鲜隔离 SDK 确认 initialize.version 与 profiles_list.serverVersion
均为 0.6.1, 工具数及说明一致.  准备证据位于
`.e2e-test/runs/mcp-file-input-0.6.1-proof/`, build.json 包含 36 项指纹.
冻结扩展 background SHA256:
`a34a4880492eb630818f35aa261dbc3de1fdda49d056606330e8386941319c45`.
manifest SHA256:
`10907f3553ed5729766e04a99dc9600291592927dbc8d059fa244ae454009967`.

真实验收计划由 mcp-tester 编写, 见
[独立计划](../discuss/mcp-file-input-061-independent-plan.md).
只用自建本地 fixture 和临时文件, 独立记录事件、文件元数据与非空交付次数.
错误后不重传, 不以 fake bridge 证明浏览器事件可信性或业务成功.
本轮未操作用户 runtime 或业务文件, 原始验收产物不纳入提交.

独立验收由 mcp-tester 在 mie-tester 新鲜专用实例执行, 使用自建 19 字节
文本及 257 字节二进制文件.  普通/多文件、同步 input/change 消费清空、
异步清空、移除、新建空控件替换、原控件元数据变化、主动 files=[] 均通过.
异步清空此次在返回时为 current-state/retained, 随后页面清空, 没有重复交付.
同源 iframe 和真实 OOPIF 各覆盖保留/清空/移除, frame 身份及作用域正确.
7 项派发前拒绝均无页面交付和 DOM.setFileInputFiles 命令.

真实 early-clear、early-mismatch 及消费后导航三条未确认路径, 页面均记录
delivery=1, 工具返回 FILE_SELECTION_UNCONFIRMED 原文, 后续仅只读取证.
导航导致实际上下文销毁与证据/清理错误, 工具明确返回可能已处理,
不声称该路径所有内部 release 都成功.  下游 handler 抛错的页面仍能按
有效选择证据返回成功, 证明工具成功与业务处理成功不是同一结论.

单次调用审计记录 28 次 SDK set_input_files 调用, 26 次非空请求含拒绝,
每目标非空调用最多 1 次, 实际 DOM.setFileInputFiles 命令 19 次,
未确认结果后的自动重试为 0.  正常/早期失败/frame 路径的监听器前后数量
一致, 非导航 remote object 创建与释放配对.  未独立真实覆盖 25s 自动移除
兜底、observationError 正向、独立命令故障或上下文存活时独立清理故障.
这些边界不补造为 E2E PASS, 也不混入 owner 或旧轮计数.

完整证据见
[独立报告](../.e2e-test/runs/mcp-file-input-061-20261001/report.md).
MCP 维护侧核对 28 个唯一原始 PASS、运行前后及当前 36 项指纹,
单次交付审计与 owner 清理原件.  release event 15034 对应 PID 14940,
owner event 15035 的回执为 PASS, 进程、临时目录与状态均已删除.
两个合成输入文件及其目录也已删除, tabs/SDK/fixture/native/hooks 无残留.
证据目录使用 UTC 日期 20261001, 验收完成时韩国本地日期为 2026-10-02.
