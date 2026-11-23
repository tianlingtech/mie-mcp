0.7.0 Agent 页面活动提示的 MCP 配合报告, 2026-10-02.

MCP 本地版本配合完成, build、typecheck、必要定向检查及独立静态审查 PASS.
最终候选的独立最小真实 SDK 验收 3/3 PASS, 8 张原生图片由 tester
逐图复核通过.  tester 自身资源及 owner 实例清理均 PASS.
需求见 `../mie/docs/agent-activity-indicator.md`.

MCP package/lock 产品版本为 0.7.0, initialize.version 与
profiles_list.serverVersion 继续使用同一启动期 PACKAGE_VERSION.
运行时代码不变, 无新增 MCP 参数、工具或 wire 字段.
tool-defs 保持 0.22.1, protocol 1, 工具数 22.

定向验证为 1 项无 bridge 新鲜 SDK 版本测试及 5 项 tool-defs 测试,
共 6 项 PASS, 44 项快照全部匹配且未更新.  profile-routing 文件其余
18 项未在本轮执行, 不计为通过; 不重跑前轮文件选择 28 项真实验收.

另启隔离 SDK 保存 initialize、profiles_list 与完整 tools/list,
工具列表与 0.6.1 已验收版本逐项深比较完全一致, 包含参数与说明.
准备证据为 `.e2e-test/runs/mcp-activity-0.7.0-proof/`,
build-preparation.json 记录 33 项 MCP/shared/package 指纹,
不包含扩展构建.  冻结后确认这 33 项未变, 再加入扩展 3 项及 bridge/dist
的 16 个执行 JS, 最终 build.json 共 52 项, 不沿用此前 36 项的固定计数.
扩展 background SHA256 为
`5dedd17a6f7271dcefc11d4e9fc667938ef37d7b34d7f6c956fa7a42f447819f`,
manifest SHA256 为
`cd34e255705e89ef34d788f3e868d0cb3cb8e7007f93a8ebb6673f8a39dd5bd1`.

视觉提示由扩展负责.  它表示当前 tab 的 MIE 工具调用活动, 不是页面锁,
不代表整个 LLM 任务的结束.  MIE 截图应隐藏提示层, 所以不能用正常
MIE 截图里没有边框来证明提示未生效.  真实 MCP 接力计划限一两个
长等待/读取场景, 以原生可见截图和调用时序验证, 与 mie-tester 协调
专用实例独占交接, 由 mcp-tester 执行.

MCP 维护侧仅构建本仓 MCP, 未构建共享包, 未启动浏览器或操作用户 runtime,
原始验收产物不纳入提交.  用户现有扩展不会因 MCP 升版自动 reload.

真实接力由 mcp-tester 在 owner 专用实例执行, 版本/schema、长 wait 和
单次 read_page 三项分别 PASS.  wait 实际 5014ms, 在 534/3538/4433ms
采样时 SDK 仍 pending, 4px CSS 橙色边框和 `MIE 正在操作, 请勿干预`
持续可见.  结束 403ms 时为 recent, 3594ms 已淡出.  read_page 实际 7ms,
结束 403ms 为 recent, 3592ms 已淡出.  过渡阶段与 3 秒保持时间分别核对,
不要求恰好 3000ms 时完成 CSS 淡出.

所有采样均使用独立原生 CDP, 没有额外 MIE 调用重置活动状态.
正文/AX 不含提示词, pointer-events/aria-hidden 与业务文字、input 值、
焦点、选择区间、目标 rect 和事件记录符合断言.  本轮被动命中检查不等同
完整点击键盘回归; 本机 fixture 日志无新增不扩大为全浏览器网络否定结论.
自然 wait 超时不冒充 TOOL_ERROR, 未重跑 owner 的并发、跨 tab、导航、
frame、MIE 截图隐藏/异常恢复或连接异常兜底矩阵, 也不混入前轮计数.

完整证据见
[独立报告](../.e2e-test/runs/mcp-agent-activity-070-20261002/report.md).
维护侧核对 3 个唯一原始 PASS、运行前后及当前 52 项指纹一致,
另抽查 wait-active-4400.png 与 wait-faded.png 的实际可见效果.
tabs/SDK/fixture/native 已清理, cleanupErrors 为空, release event 15128
对应 owner PID 29914.  owner event 15130 的销毁回执已核对原件与复制件
一致且为 PASS, 进程、临时目录及状态均已删除.  manifest/final-status
记录最终 PASS, 原始 summary 保留人工视觉复核前的时序状态, 不改写历史.
