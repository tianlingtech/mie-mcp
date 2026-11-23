本文保留验收准备阶段的计划与约束.  最终 15/15 组 PASS 及覆盖限制见
[验收报告](../docs/network-observation-report.md).

0.6 网络观测独立 SDK 验收准备计划.  来源: xats event14822, ../mie/docs/network-observation-feedback.md, 当前共享 schema、network-activity.ts、wait-for.ts 与 observability.ts 的只读核对.  当时仅准备, 没有启动 SDK、浏览器、fixture 或测试, 没有新增 PASS 结论.

目标环境为 mie-tester 独占交接的专用 Chrome/profile, local-fresh/disposable.  使用真实 SDK stdio → MCP → bridge → extension, 请求只访问本机 fixture.  MCP/扩展产品目标版本0.6.0, tool-defs0.22.0, protocol1, 工具22个.  等 mcp-main 最终产物清单及 mie-tester handoff, 逐文件 SHA256 核对成功后运行.  不改产品代码或测试、版本、skill, 不 build/commit, 不操作用户 Chrome、电源或 tmux, 不重跑旧37项.

字段已由 events14823/14824定稿: startedAt, 单位为扩展收到当前 requestWillBeSent 跳转段的 Unix 毫秒, 不存在 startedAtUnixms字段.  elapsedMs 为非负观测持续时间, 不等同服务端时间或 CDP 单调 timestamp.  初始化前 actual={pending:true}, 不按字符串pending断言.  新三个查询参数可选且不注入默认值; 检查原始tools/list与真实请求记录.  产品尚未冻结, 字段确认不等同运行授权.

证据目录预计 .e2e-test/runs/mcp-network-observation-060-<实际时间>, 不复用旧运行输出.  每次尝试留原脚本或 hash、原始参数/返回/错误/时间、fixture请求和释放日志、native CDP事件及清理回执.  修正 harness 时另建 attempt, FAIL/BLOCKED/PASS 分开报告.  正式统计使用明确的最新唯一用例, 不将重试或 owner 自验混入本人的 PASS.

| 组 | 真实操作 | 核心断言与证据 |
| --- | --- | --- |
| 前置 | 核对冻结清单, 新鲜 SDK initialize、profiles_list、tools/list, 与 owner 当前 hello 身份比对 | 产品0.6.0/tool-defs0.22.0/protocol1/22tools分别记录, profile id/name/instance一致, baseline tabs为空; 测试后同清单再核对 |
| 捕获基线 | 自建 tab 导航前 captureNetwork=true, 安装只读 native 网络事件观察, 再触发唯一URL请求 | 先确认requestWillBeSent与服务端请求真实存在, 保留 requestId/frameId/loaderId/类型/URL及时间; 不用HTML标签存在代替请求证据 |
| 超时新增字段 | 同时启动普通延迟响应、fetch流、SSE/Media中实际可观测的长请求, 调network_idle至超时 | matched=false/timedOut=true; 初始化已完成后actual保留inflight/idleForMs并追加pendingRequests与pendingRequestsOmitted; 条目与独立事件账本的HTTP(S)在途集合一致 |
| 排除隔离 | 两个SDK对同一自建tab同时等待, A按类型排除, B按URL排除; 再省略排除规则等待 | 每个诊断列表只包含该等待计入的请求, 类型与URL匹配按OR排除, 不互相污染, 不修改read_network_requests底层记录 |
| 成功兼容 | 全部相关请求结束或被显式排除, 等待idleMs满足 | 成功返回保持旧形状, actual不含pendingRequests/pendingRequestsOmitted; 新一轮等待不继承上轮排除或空闲起点 |
| 完成与失败 | 保留一个长阻塞请求, 另一个请求分别正常结束或在响应头/部分正文后断开 | 先证实loadingFinished/loadingFailed, 超时诊断不再列该请求, 仍列阻塞者; 服务端已写完不单独当作浏览器已完成证据 |
| 重定向 | 本机302/307跳转到保持pending的最终URL, 保存相同requestId的跳转段事件 | 诊断只列当前段URL/类型/开始时间, 不重复计入原段; read_network_requests保留redirected与当前pending段, 最终释放后变finished |
| 导航清理 | 自建tab有旧长流时, 导航至本机新文档并产生可识别的新阻塞请求 | 旧loader/frame请求不出现在新诊断; 新文档请求仍计入; 若Chrome没有loadingFailed, 使用真实frameNavigated和服务端close证据, 不补造失败事件 |
| 临近截止变化 | 以有界本机定时释放/失败请求, 保留另一阻塞请求确保等待超时 | 记录wait起止、CDP终结事件、服务端动作, 只在终结事件确认早于返回时断言该请求已移除; 若动作实际晚于截止, 本次不能证明截止前重采, 记时序前置不足 |
| 10条上限与省略 | 最多约13至16个自建长请求, 必要时分散到少量本机端口避免单origin连接上限 | 以已观测账本N为准, 列表长度=min(N,10), omitted=max(N-10,0), 且length+omitted=inflight; 排除部分后重新计算N, 不把未捕获请求算入 |
| 排序与时间 | 分批触发唯一请求, 保留独立事件收到时间 | startedAt非递减、Unix毫秒合理、elapsedMs非负且与回包时间相符; 时间相同只检非递减, 不假定额外tie-break顺序 |
| 字段边界 | 生成完整URL长度512/513及更长的本地pending请求, 超长部分只用无敏感合成字符 | URL最多512字符、urlTruncated与原始URL长度一致; type最多64且typeTruncated准确; 按截断后不可见的URL尾部做排除, 确认匹配先于诊断裁剪 |
| 默认列表 | 建立固定的pending/redirected/finished/failed记录集, 默认查询与显式false查询对照 | 默认保持旧内容/范围, 不因新增过滤自动丢记录; 每种state先用原始CDP事件证明, 状态更新稳定后再比较集合 |
| 状态过滤 | 分别选择四种state, 再选择2项与全部4项, 联合urlPattern | states列表内OR、与其他过滤AND; 对照未过滤稳定记录集, 按requestId和跳转段标识比较, 不只比较条数 |
| 来源scheme | 实际触发本机HTTP URL、data URL与可被Chrome捕获的chrome-extension URL请求 | 以记录url的scheme判断; HTTP路径/query中含data:或chrome-extension://仍保留.  请求发起者是扩展不代表HTTP URL应被过滤; 不用console sourceURL伪造网络来源 |
| data负载降噪 | 自建大data URL请求被确认捕获后, 对照默认与excludeDataUrls=true | 默认沿用原URL展示裁剪, 显式过滤消除对应记录; 保存完整SDK返回的字符数/UTF-8字节数与可读样例, 不把已有裁剪描述成无限输出 |
| filter-before-limit | 将被排除的新记录放在后面、可保留的记录放在前面, limit=1及其他小值 | 返回应为过滤后集合的最后limit条, 不先截断再过滤; states和两种scheme过滤都建立有区分力的对照 |
| clear语义 | 保留不同状态/来源记录, 用只匹配其中一部分的组合过滤并clear=true | 返回先遵守过滤, 随后无过滤查询确认全部历史缓存已清, 不是仅清匹配项; 使用没有新请求的时间窗, 活跃请求相关clear生命周期单独记录 |
| 子session | 先启includeSubSessions观测, 用自建跨站iframe/worker发请求, 独立确认其session和就绪状态 | 默认结果不扩大范围; true只覆盖实际已关联child sessions; 新过滤与原source/limit/clear规则一致, 不声明主network_idle自动汇总全部子session |
| 参数拒绝 | 两boolean非法类型, states空列表/5项/未知状态/非数组/大小写错误状态 | 共享schema显式拒绝, 原始错误留证; 在拒绝前装好诊断观察, 不从事后UI推断没有浏览器调用 |
| 清理 | 关闭自己的tabs, 取消长流并停fixture, 关闭SDK/native连接和自身hook | 自身cleanup与owner清理分别留证; 明确release交接PID, owner按完整owned身份销毁, 复制receipt并独立确认专用tempRoot不存在 |

复用方向: 以旧0.20独立验收的本地fixture和网络观察方式为基础, 在本轮证据目录复制后最小扩展可控释放/失败/跳转/长URL能力.  不直接复用旧已关闭连接或profile配置.  SDK解包沿用已验证模式: wait_for/read_network_requests先解content JSON; javascript_exec再取value并核对world/redacted.  同名AX元素需要role限定, 本轮无需以截图坐标作为网络断言依据.  必要时只取一张合成fixture可见状态图作为补充, 网络通过依据仍为真实SDK返回和事件日志.

覆盖限制与诚实边界:

- 这是准备计划, startedAt等字段已确认, 但产品产物尚未冻结, 不宣称当前源代码等于已运行版本.  开跑前仍须核对最终schema及产物清单.
- Chrome可能不产生data或extension请求的可见CDP记录, 或将scheme规范化.  先证明基线含相应实际记录, 再测过滤; 若没有, 该正向过滤分支记BLOCKED并向owner反馈.  大小写不敏感的实现分支若浏览器规范化导致无法区分, 明确不声称真实E2E穷尽覆盖.
- 常规CDP资源类型是短枚举, 无法用正常浏览器流量自然产生超过64字符的type.  可检查真实type有界及typeTruncated=false, 但typeTruncated=true分支不注入伪造事件冒充E2E.  同样不为跟踪溢出发起10001个请求压力测试; 留给产品定向单元证据, 不计入本人的真实PASS.
- 不修改产品时钟、不阻塞扩展执行、不注入产品内部网络状态.  初始化尚未完成时的pending分支及最后轮询与截止之间的精确竞态, 若无法用可观测时序稳定建立, 单列未覆盖/BLOCKED; 普通截止前完成用例不冒充证明精确竞态.
- network_idle仅限主观测器已捕获HTTP(S)在途, capture前请求不可追溯.  read_network_requests的状态列表、data/extension来源和子session范围与该计数不是同一集合, 不强行断言两个API默认计数相等.
- 长流、重定向与断开用唯一URL区分, 记录浏览器可能的透明重试, 不将其自动归因MCP重试.  对精确状态计数用已证实CDP requestId/跳转段去解释.
- 尽量用固定且较小请求数, 不耗费外部API或连接真实业务.  本轮只做上述新增网络范围, 不扩大为旧功能全量回归, 不把owner的独立证据并入自己的用例数.
