本文保留验收前的准备计划与当时状态.  最终功能结果、历史失败和清理回执见
[Profile 本机启动与关闭恢复](../docs/profile-launch.md).

0.8 Profile 生命周期独立 SDK 验收准备计划.  来源: xats event15167, src/profile-launcher.ts、src/profile-launch-config.ts、共享profiles_launch定义, ../mie/docs/profile-lifecycle-feedback.md 与 profile-lifecycle-acceptance.md.  当前仅只读核对和准备, 未启动SDK、浏览器、fixture或测试子进程, 未生成/安装启动配置.  初版计划时产品review尚待; event15184已确认review PASS和最终55项冻结清单, 仍须owner明确交接后执行.

目标版本为产品0.8.0、shared0.23.0、protocol1、23tools.  profiles_launch为MCP本地工具, 不把名称当Chrome目录, 不让工具入参指定executable/argv或安装启动映射.  配置仅由本轮临时MIE_PROFILE_LAUNCH_CONFIG指向owned0600普通JSON, 内容为version:1和profiles[name]={profileId,executable,userDataDir,profileDirectory}.  路径必须指向本轮专用已有资源, 固定启动参数为--user-data-dir=...、--profile-directory=...、about:blank, shell=false.  所有用户Chrome/profile、用户启动配置及业务数据均不在范围内.

交接前需要owner确认的环境方案:

- 专用profile的真实id/name、现有userDataDir/profileDirectory、固定可执行入口和发现目录/socket路径.  名称与目录的对应关系来自交接和临时映射, 不按名称猜目录.
- 真实cold launch需要owner确认扩展在隔离profile中持久安装及native-host可用, 不能假定首次CfT --load-extension的临时加载在退出后仍有效.  真实浏览器场景遵循固定3argv, 不用额外任意argv绕过契约, 不用wrapper单独启动bridge冒充Chrome恢复.  小型启动器脚本只用于明确标注的OS边界测试.
- 离线阶段需要停止专用Chrome但保留其数据目录.  在动手前明确由owner停, 或owner明确转交这些特定PID的停止权限; 不能调用原先会连目录一起删除的cleanup来制造离线前提.
- 启动后可能出现全新Chrome PID.  新PID必须从本轮启动日志/实际进程信息解析并与executable、userDataDir及owner标记比对, 由owner确认最终清理身份.  不手写补PID或用旧owned PID冒充新实例清理.
- 最后tab保护用例需明确初始非managed blank属于本轮可清理资源.  对未知来源tab不动; 无法把真实全部tab建立为待关闭集合时, 该组BLOCKED.

环境协调已在event15174发给mie-tester, 当前只请求方案, 不要求其冻结前创建实例.  旧0.7最后tab复现使用其已存原始证据作为背景, 不重新构建或运行旧产品.  该基线是extension0.7与shared0.23的混合链路, 不能称为完整旧版本独立SDK复现.

| 组 | 真实操作 | 断言和证据 |
| --- | --- | --- |
| 冻结/版本 | 新鲜SDK, 最终files数组逐项SHA256, initialize/profiles_list/tools/list/owner hello | 产品0.8/shared0.23/protocol1/23tools分别记录, profiles_launch为新工具, profile必填和timeout边界遵最终schema, 不猜固定文件总数; 运行后同清单核验 |
| 在线无配置幂等 | 指向专用在线profile和隔离发现目录, 不设置启动配置, 调profiles_launch一次 | profile身份与真实hello一致, status=online/launched=false, 真实Chrome PID/windows/tabs不增加, 无旧操作重放 |
| 在线有映射幂等 | owned0600临时映射含正确UUID与本轮路径, 新SDK调用 | 返回launched=false, UUID匹配; 已在线不能跳过配置身份校验, 包装器调用日志为空 |
| 在线UUID不匹配 | 另一份临时映射使用运行时生成的不同UUID, 目标路径仍限本轮 | PROFILE_IDENTITY_MISMATCH, 不启动、不关闭现有浏览器、不回退到别的profile; 现有状态不变 |
| 离线无映射 | 确認测试名称没有在线记录且无该映射, 一次调用 | PROFILE_LAUNCH_NOT_CONFIGURED, 不猜Chrome目录, 无进程/窗口/文件夹被创建 |
| 无窗口但进程存活的恢复 | owner在专用环境明确建立Chrome PID仍存活、全部window/tab关闭且hello/发现离线的前提, 保存证据后, 使用直接Chrome executable的单独临时映射调用profiles_launch一次 | 这是原bug类型的恢复, 不是cold launch, 不使用wrapper.  Chrome可能把启动请求转交既有进程, 启动子进程exit0后仍须等真实窗口/扩展hello恢复; 不要求原Chrome主PID改变.  id/name匹配且instanceId与本次活hello一致 |
| 真正cold launch | owner精确停止整个专用Chrome进程但保留持久安装扩展的数据目录, 确认旧PID消失且hello/发现离线后, profiles_launch一次 | 使用固定3argv, 实际新Chrome PID出现, 验证真实hello后才返回status=online/launched=true.  与无窗口恢复单列结果; 持久扩展安装无法建立则明确BLOCKED, 不用单独bridge进程代替 |
| exit0不是上线证据 | 在真实无窗口恢复中观察Chrome启动入口转交既有进程后退出0, 如平台实际出现则保留时间/PID日志 | MCP继续等实际hello, 不因启动入口退出0提前成功或报失败.  若真实平台未出现此路径, 只保留另列的受控OS退出0边界, 不声称真实Chrome此分支已覆盖 |
| 启动后再次在线查询 | 成功后先profiles_list核实, 再进行独立在线幂等用例 | launched=false, 无第二次spawn或额外about:blank.  这是已确认成功后的显式幂等测试, 不是超时后的自动重试 |
| 固定入参边界 | 工具调用试图传argv/executable/userDataDir, 或省略/非法profile/timeout | schema明确拒绝, 不触发启动.  测试配置中的空格等合法路径按字面传递, 不发生shell展开; 每次配置独立且不在运行中修改 |
| 配置拒绝 | 自建配置的坏JSON、非0600、symlink、目录文件、超限JSON、额外argv字段、非法profileDirectory、缺目录或unsafe leaf path | PROFILE_LAUNCH_CONFIG_INVALID且无spawn.  仅使用本轮自建文件/目录, 不改用户权限、不读取敏感配置; 对路径祖先保证直接使用realpath, 不扩大声称未测试的祖先symlink安全语义 |
| 实际OS启动失败 | 专用小型可执行fixture退出非零; 另用合法owned脚本但shebang指向本轮不存在解释器触发真实spawn ENOENT | PROFILE_LAUNCH_FAILED.  区分不存在executable在路径预检查阶段的CONFIG_INVALID与真正spawn失败.  此组是真SDK+OS子进程边界, 明确不是Chrome上线E2E |
| exit0但无hello | 小型本轮可执行fixture记录argv后退出0, 没有注册或伪造bridge | 等待至PROFILE_LAUNCH_TIMEOUT, 不立即FAILED或虚报online.  标为受控启动器边界, 不混入真实浏览器启动成功数 |
| 超时不kill | 在独立映射中运行只记录PID并保持存活的本轮fixture, 短timeout单次launch | timeout后精确PID仍存活、spawn次数1、错误含可能仍启动/未终止/先查profiles_list提示.  之后仅profiles_list与PID只读核对, 不再次launch; 测试收尾单独精确终止自身fixture并留时间记录 |
| 同MCP合并并发 | 若最终契约保留pending共享, 对同一受控启动目标在首调用未完成时发第二个更短timeout调用 | 只启动一次, 各自deadline有界, 一次调用超时不杀child.  两次是计划中的并发调用, 不是失败后的重试; 不宣称跨MCP进程全局互斥 |
| 不重放旧操作 | 离线前在本机fixture明确完成一次唯一标识副作用, 服务端记录一次, 恢复期间不再发送该动作 | 启动/轮询/身份校验后该副作用计数仍1, SDK trace没有旧工具重发.  页面恢复可能产生正常GET, 不把这些GET误认成业务操作重放 |
| 最后全部tab关闭保护 | 只在0.8专用实例, 先用Chrome真实tabs/windows确认待关闭集合覆盖全部tab, 再断开native worker及所有原生CDP连接, 只调用一次tabs_close | 成功返回请求集合, SDK/hello/profile保持在线.  随后重新原生观察应仅剩一个非managed about:blank和有效窗口; tabs_context为空不代表Chrome无tab |
| 保留页不归属agent | 查看mineOnly、关闭审计及原生tab group/URL, 创建并关闭另一个自建managed tab | 保护页不出现在managed列表, 无agent owner, 不被mineOnly清理.  已有blank时不再新增保护页, 空关闭无副作用; 关闭审计只解释真实请求目标 |
| 结果未知处理 | 若关键关闭返回SENT_LINK_LOST, 原样保留错误与在线检查, 不再次关闭 | 不将断连当关闭成功.  先profiles_list及有限只读hello证实实际状态, 不连接options页或创建tab来掩盖离线; 未知状态明确FAIL/BLOCKED分类后与owner协调 |
| 收尾 | 关闭自己的SDK/fixture/native连接, 移除临时launch配置/包装器/自建文件, owner按最终已验证Chrome身份销毁 | 新旧PID和数据目录都明确归属, 每个仍活着的本轮进程可追溯.  timeout遗留子进程不能遗漏, 原生保留blank由owner最终清理; 保存receipt并独立核对tempRoot不存在 |

依据event15175, 无窗口但Chrome进程存活的恢复、全部进程退出后的cold launch、受控启动器OS边界必须分开标注.  exit码/argv/超时用的小型脚本不模拟hello、不发布假profile记录, 不能代替offline→真实Chrome→真实hello的主链路.  若owner只能提供已在线环境而不能安全保留目录并重启, 真正离线启动记BLOCKED, 不能拿进程fake测试当作通过.

成功返回为{profile,status:"online",launched:boolean}, 核对MCP text JSON与structuredContent一致.  失败核对明确code/message/hint和操作次数, 不把缺映射、配置无效、启动失败、身份不匹配、等待超时混为同一失败.  此前SENT_LINK_LOST是结果未知, 无任何自动重放许可.

event15184已定稿: 该profile存在映射时在线校验UUID; 有效配置文件缺该条目时, 已在线允许launched=false, 离线NOT_CONFIGURED.  配置文件本身无效先拒绝, 不因目标在线而忽略.  据此补足“有效配置缺条目但在线”的幂等和“无效配置但在线”的拒绝对照.

证据预计 .e2e-test/runs/mcp-profile-lifecycle-080-<实际时间>.  保留临时配置的合成内容/hash/mode、脚本快照、固定argv日志、子进程PID/退出时间、真实hello/discovery、SDK原始调用/返回/时间、fixture唯一副作用账本、真实tabs/windows前后快照、构建指纹和清理回执.  负断言的spawn日志/副作用计数必须在动作前建立.  修正harness另存attempt, 不覆盖0.7基线或先前失败.

限制: 不重跑文件28/网络15/操作提示18矩阵; 复杂多窗口/跨session关闭矩阵优先复用owner独立结果作为引用, 不计我的PASS.  不通过安装用户环境映射、调用系统默认Chrome、全局pkill/killall、tmux或自动reload来完成启动.  未授权的真实profile、未知PID或不可确认所有权的tab直接停止相关用例并联系owner, 不扩大操作范围.

准备更新: event15184最终55文件已独立匹配, 证据 .e2e-test/runs/mcp-profile-lifecycle-080-20261002/build-preparation.json.  固定真实CFT包装入口是否作为cold启动补充验收, 已在event15183向mcp-main明确口径, 尚不依此启动.

event15193已接受固定真实CFT包装入口: 包装器只能启动实际Chrome及真实扩展/native bridge链, 原样接收产品固定3argv, 不伪造hello/discovery.  运行前审阅并保存wrapper/hash/mode/固定flags, 实际PID/executable/userDataDir与hello对应.  包装入口辅助cold可单列PASS, 不能推出direct Chrome executable且持久扩展安装路径已通过, 后者本轮未覆盖/环境不足须明确.  event15199进一步限定: warm必须用直接Chrome executable, 不能用wrapper; 与wrapper辅助cold使用不同临时映射, 以实际PID是否存活和window数量作区分.
