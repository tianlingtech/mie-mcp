0.6.0 网络观测 MCP 配合报告, 2026-10-01.

本地实现、构建、类型检查与 58 项定向测试通过, 独立代码审查 PASS.
最终冻结构建的真实 SDK → bridge → extension 独立验收单次运行
15/15 组 PASS, 0 FAIL / BLOCKED.  自身及 owner 资源清理均完成.

契约来源为 `../mie/docs/network-observation-feedback.md` 及 xats events
14818、14823.  MCP 产品版本 0.6.0, 共享 tool-defs 0.22.0, protocol 1,
工具数 22.  本仓库未改 MCP 运行时代码: 现有共享 schema 验证参数,
通用结果转换无损保留产品响应, 不计算或补造网络诊断.

`read_network_requests` 新增三个可选参数: excludeExtensions、
excludeDataUrls、states.  无新增默认值注入.  network_idle 超时诊断包含
actual.pendingRequests 与 actual.pendingRequestsOmitted, 时间字段为
startedAt, 单位 Unix 毫秒.  未完成初始化时 actual 为 `{pending:true}`,
成功及旧运行时响应保持原样.  使用范围和限制见 [工具文档](e2e-tools.md).

本地验证:

- 新增 network-observation-filters 的 12 项 SDK stdio + fake bridge 测试,
  覆盖字段可见、默认/false 兼容、四状态及过滤组合无改写、非法参数在
  连接前拒绝、子 session 诊断保留、0/1/10 条在途摘要及省略计数保留,
  成功/初始化中/旧超时返回不添加字段.
- observability-tools、subsession-observation、browser-followups、
  profile-routing 相关回归与上述测试合计 53 项 PASS.
- tool-defs 5 项 PASS.  仅更新 read_network_requests 的 schema/说明和
  wait_for 的说明, 共 3 项已确认契约快照.  不重复累计快照首次失败及复跑.
- 新鲜隔离 SDK 确认 initialize.version 与 profiles_list.serverVersion
  均为 0.6.0, 22 tools 及新参数可见.  无浏览器连接, 不证明扩展已加载新版.

本地准备证据为 `.e2e-test/runs/mcp-network-observation-0.6-proof/`.
build-preparation.json 包含 33 个 MCP/shared JS 及 package/lock 指纹.
随后核对这些文件未变, 新增扩展 background/options/manifest 后的最终
build.json 包含 36 项.  扩展 background SHA256 为
`7545edc8c9ef2e61b1c71c64794c8b5f87f100594fdd96e2932d344d0b566e03`,
manifest 产品版本 0.6.0.  指纹核对不替代实际加载及功能验收.

产品随后将缺失 CDP type 的诊断缺省值修正为 unknown, 排除逻辑不变.
旧候选的 owner 测试环境清理后重新冻结, 最终 background SHA256 为
`da083b3fb67f4afa8af3aba6d40be8cde9f55832d007ccd9802ba9662267035a`.
build-final.json 实际核对 36 项, 仅 background 变化, 其余 35 项相同.
MCP 夹具补充 unknown 原样保留断言, 12 项定向复跑通过, 不增加去重计数.
旧 build.json 保留, 独立 SDK 验收以最终清单为准.

独立验收由 mcp-tester 在 mie-tester 新建并独占交接的专用实例执行, 计划见
[独立验收计划](../discuss/mcp-network-observation-060-independent-plan.md).
fake bridge 夹具仅验证透传, 不证明请求过滤、排序、截止重采或浏览器事件行为.
本轮不操作用户 runtime、tmux 或电源, 不运行全量测试.

真实验收结果及边界:

- 混合 Fetch/EventSource/Document、排除规则及两个 SDK 并发等待隔离,
  成功返回旧形状, 完成/abort/失败/redirect 当前段/导航清理均通过.
- 13 个已观测在途请求返回 10 条和省略 3 条, actual JSON 为 2057 字符.
  512/513 URL 边界、长 URL 截断后尾部规则排除、观测时间排序通过.
  在等待期间完成或失败后返回空在途列表, 不将其称为精确截止竞态覆盖.
- 四状态 OR 与其他过滤 AND、默认/false、filter-before-limit、clear
  全清、真实 OOPIF 子 session 范围通过.  7 项非法参数拒绝时无新增 CDP 命令.
- 实际捕获 data: 完成记录及 chrome-extension://invalid/ 失败记录,
  不伪造网络来源, 不声称扩展资源读取成功.  HTTP query 含同文仍保留.
  排除 data: 后本次合成输出由 2218 降到 1048 字符/字节, 不是修复无限输出.

15 组包含多个断言, 不额外累计断言数量, 不混入 owner 或旧轮测试数.
未独立真实 E2E 覆盖的分支: 缺失 CDP type 的 unknown、超过 64 的类型截断、
10001 请求跟踪溢出、capture 初始化前 pending、精确最后轮询截止竞态、
浏览器规范化前的混合大小写 scheme.  这些限制未伪装为已通过或已复现.

完整证据见
[独立报告](../.e2e-test/runs/mcp-network-observation-060-20261001/report.md).
MCP 维护侧核对 15 个唯一用例的原始 PASS、前后及当前 36 项构建指纹一致.
两会话 tabs 均为空, SDK、fixture、native 与 hooks 已清理, cleanupErrors 为空.
release event 14856 对应 PID 96757, owner event 14857 的回执原件与复制件
一致且为 PASS, 进程、临时目录及状态已删除.  历史截图超时及 no-login
根因未因本轮结果改写, 本次通过也不代表用户现有实例已自动更新.
