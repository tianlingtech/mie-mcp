本文保留验收前的准备计划与当时状态.  最终测试结果、自然截图失败及清理回执见
[截图故障诊断](../docs/screenshot-diagnostics.md).

0.9 截图诊断最小独立 SDK 消费准备计划.  来源: xats event15424和 ../mie/docs/screenshot-diagnostics.md.  当前只读准备, event15443已给精确shared/MCP关联字段, 但尚无冻结清单, 未创建SDK、浏览器、fixture或诊断故障.  等产品冻结与owner专用独占交接后执行.

目标为产品0.9.0、shared0.24.0、protocol1, 新工具screenshot_diagnostics, 准备版tools/list共24个工具; 冻结后仍重新核对.  event15443明确以下契约, 运行前仍核对实际schema和产物:

- 成功图片metadata平铺可选diagnosticId(UUID)与diagnosticStatus(saved/pending/unavailable).  saved或pending必须有ID; 旧图完全没有诊断字段时不伪造ID.  损坏诊断元数据降级unavailable, 有效图片不能因此丢失.
- native bridge error.data使用同一诊断结构, MCP沿用把完整bridge error放入error.data的旧格式.  因此本轮真实SDK关联路径明确为structuredContent.error.data.data.diagnosticId, 状态同级, text JSON与structuredContent.error等价.  这是明确确认的0.9契约, 不是套用旧任务推测层级.
- screenshot_diagnostics为flat strict输入, action默认read, handler补read的默认limit20; profile共同可选.  read支持diagnosticId/tabId/limit, clear拒绝这些三个字段, 只能按本profile清理, 不声称支持按ID局部clear.  其他数值边界以最终schema为准.

新功能提供日志, 不代表历史截图超时已修复.

只使用owner专用profile与本机合成静态页面.  页面含本轮唯一的URL路径、标题、正文和输入值标记, 仅用于验证诊断日志不收录这些内容.  不用真实业务页面、账号、cookie或请求体作探针, 不读取全机电源/pmset日志, 不操作用户Chrome或电源状态.  不build/commit/push.

| 范围 | 最小真实操作 | 断言与证据 |
| --- | --- | --- |
| 前置 | 新鲜SDK initialize/profiles_list/tools/list、owner当前hello与实际冻结files清单 | 产品/契约/协议版本及工具总数分开核对, profile身份正确; 每轮前后逐文件SHA256, 不仅看HEAD或package版本 |
| 正常图与ID | 自建静态页仅一次正常MIE computer screenshot | 原生MCP image有效且尺寸正确, text JSON与structuredContent元数据一致, 原有截图metadata保持, 新ID须为UUID且与saved/pending状态相容.  按该ID读取恰好对应同次记录, 对齐tabId、实际参数、版本和本次调用时间, 不靠最近一条猜关联 |
| 生命周期状态 | 对上述记录检查调用结束与底层CDP结束字段 | 正常完成按最终契约检查, 不把tool返回/超时当成CDP取消.  UTC毫秒与本次起止时间相符, 后续读取以同ID关联; 精确late状态机由owner覆盖 |
| 关闭后读取 | 关闭自己的截图tab, 从managed列表确认消失后按原ID读取 | 记录仍可读, 不要求tab存在或重新打开tab.  不把profile最后窗口保护的blank当作原tab; 不把清理后的空managed列表误认日志已丢失 |
| read无页面操作 | 动作前安装被动native观察, 对read开始/结束取证 | read不触发Page.captureScreenshot、chrome.debugger.attach或主动tab/window激活.  Chrome实际active/focused标志和业务状态不变; 观察器自身原生attachment与产品调用分开记.  不能只看页面没变化就推断无attach |
| profile隔离 | A生成并保留ID; B按A的ID读取、清理B, 随后A再读取 | B无A记录, A原记录仍在.  必须真实独立profile身份/存储且A记录未清.  不把A已销毁后B为空当隔离证据; 两profile方案先与owner对齐 |
| clear稳定 | 仅对已授权的本轮profile执行action=clear且不带diagnosticId/tabId/limit, 立即和有界稍后读取 | 返回清理结果明确, 原ID消失且后续正常read不会复活; 若后续既定用例自然产生新ID, 再核对不复用旧ID, 不为此额外截图.  本组不再截一张图强行补证据, 底层迟到回调防复活由owner受控矩阵证明, 不把普通重复读取扩大成late覆盖 |
| 原错误保留与ID | 若最终明确一个自然、稳定的截图失败路径会分配ID, 用新自建target单次调用; 否则接入owner已审阅的一次受控失败 | MCP原code/message/data保留, 关联ID可读取正确记录, 日志受控原因分类与原错误文本分开.  按已确认的structuredContent.error.data.data路径核对ID/status, 不把MCP入参拒绝强行要求有截图ID.  错误后只读日志, 不重试截图补证据 |
| 诊断故障不盖主结果 | 仅消费owner已有的受控存储/辅助读取故障入口, 最多一个成功图对照及必要错误对照 | 截图成功仍返回真实图片, 截图失败仍保留原错误; 诊断不可用/持久化失败状态显式可见, 不能假称存储成功.  不新增整套故障注入或修改产品代码, 故障注入结果单列且不冒充自然超时 |
| 数据最小化 | 读取本轮正常/错误记录, 比对最终允许字段并搜索唯一标记 | 不含图片/base64、页面正文、URL/标题、输入内容、cookie/请求体或任意脚本.  任意错误文本不直接进入持久记录.  类型/字段长度与最终schema相符, 不只用“没搜到标记”替代结构检查 |
| 收尾 | 清理仅本轮记录和自建tab/fixture/SDK/native观察, 向owner明确release | 恢复被动诊断hook, 不清用户日志; owner精确销毁并给receipt, 独立核对临时目录不存在.  原始结果/错误及截图证据在验收目录保留 |

clear已确认为整个profile, 须先确认新鲜空日志基线, 或owner已保存原证据并明确交接本轮诊断测试数据的清理范围; 不清其他agent或用户日志.

profile隔离环境先于执行确定.  优先使用两个owner明确隔离且可独占的profile, 各自真实UUID、socket/registry与数据目录核对.  若只能顺序使用, 必须保留A记录/目录, 在B读取和清理后再恢复A验证; 若做不到, 该项BLOCKED并写清原因, 不用客户端本地缓存或fake profile替代.

故障消费由owner主导矩阵, SDK只做必要透传与主结果优先级检查.  受控延迟、CDP异常、storage失败的注入方式/原始预期/恢复步骤必须单列, 若只能引用owner原始错误记录而没有本轮SDK错误响应, 就明确只验证read消费, 不宣称验证过MCP实时错误转发.  自然截图若本轮失败, 直接用该次ID读日志并保留失败, 不为了得到正常图PASS自动重复截图.

覆盖边界:

- 默认storage.local持久、7天TTL、成功/异常各50条、未完成预算、worker/浏览器重启、底层迟到成功/失败、detach/close关联、并发、清理后的迟到回调防复活, 由owner扩展矩阵主验, 不并入本人的最小SDK用例数.
- 原生独立CDP Page.captureScreenshot不经MIE工具截图包装.  既有0.8辅助原生截图timeout属于这条旁路; 新日志没有它的记录不能证明它没执行, 不用新日志倒推或抵消旧FAIL.  新工具具体覆盖的截图入口, 包括原生/CDP relay是否记录, 以冻结实现和明确契约为准.
- read不attach的否定断言要在调用前建立被动观察; 查询已关闭tab的记录不允许通过重新开tab或截图实现.  如果旁路观察器改变了被测路径, 该证据不算纯read证明.
- 不主动查整机休眠记录, 不把document.hasFocus当真实前台窗口证明; 只记录专用Chrome实际tab/window状态和UTC毫秒.  时间字段是关联线索, 不自动建立历史超时因果.
- 明确ID分配边界.  schema拒绝、MCP savePath预校验失败、bridge离线等未进入截图路径的错误, 是否生成ID须按最终契约判断, 不用不存在的记录当日志功能FAIL.

证据预计 .e2e-test/runs/mcp-screenshot-diagnostics-090-<实际时间>.  每轮保留脚本快照/hash、最终tools/list、原始SDK参数/返回/时间、实际图片、ID关联记录、被动native命令/attach/激活观察及profile身份/清理回执.  修正脚本另建attempt, 不覆盖历史自然超时、辅助原生截图FAIL或受控注入失败.  PASS/FAIL/BLOCKED分别统计, 真实路径与注入路径分别注明.

环境对齐更新(event15435): 当前startEnvironment/cleanEnvironment硬编码单一state路径, 不直接创建A/B覆盖同一槽.  owner拟在冻结后提供经审阅的独立state path测试helper, A/B各有独立ownerToken/tempRoot/userDataDir/bridge及清理身份, 不由本SDK tester改helper或绕过归属检查.  两SDK各连独立bridge的对照只计真实profile存储隔离; 同一MCP server通过显式profile选择路由是不同覆盖, 本轮不自动扩充.  helper或一次性fault入口未就绪时, 相应前置条件如实BLOCKED.  目前仍没有启动或修改测试环境.

精确契约补充的轻量消费边界: 在既定read/clear用例中核对省略action等同read、默认limit20由handler应用、clear携带任一筛选字段明确拒绝且不清记录.  旧图兼容/坏诊断元数据降级若只能由MCP定向夹具建立, 只引用其明确证据, 不修改真实扩展返回来冒充自然E2E.  仍不扩充底层注入矩阵, 等build冻结与owner环境后再运行.

准备版schema核对(event15457): tools-list.json实含24tools; screenshot_diagnostics新增工具description要求扩展0.9.0+且目标profile在线.  action缺省read, diagnosticId为UUID, tabId为正整数, limit=1..100且默认20由handler补; read为最新优先.  当前build-preparation.json仅37个MCP/shared文件, 不是含extension/bridge的最终全链冻结, 不据此启动资源或声称独立PASS.  开发侧97定向与fake-bridge错误路径验证只作来源记录, 不计本轮真实SDK结果.

双profile helper更新(event15458): owner获准提前准备独立绝对stateFile参数, 5项无浏览器检查通过且仅编译E2E包, 仍待独立review和产品freeze.  真实交接必须将A/B各自stateFile作为归属的一部分保存, 创建/读取/清理始终传同一路径.  不使用0.8仍硬编码默认槽的lifecycle owner-control管理这两个实例, 不碰默认状态槽.  当前没有Chrome或交接资源.

冻结及消费准备更新(events15477/15478/15483): 最终build.json共56文件已独立匹配, 产品0.9.0/shared0.24.0/24tools.  独立SDK准备9组, 其中A/B版本身份2组, 正常关联/read-close/isolation/clear及两个受控故障7组.  受控入口为owner的screenshot-diagnostics-hooks.mjs, 仅capture=error(固定原文Fixture CDP rejected marker.)和storage=error(仅mie.screenshotDiagnostics.v1的set), 不启用hold/context故障.  记录命中后恢复mode, 收尾restore API/监听.  目前只写脚本并检查语法, 未启动任何SDK/fixture/browser.

暂停更新(event15492): 旧56项freeze已撤回, 原build-preparation.json保留.  留存修正为success50/failure50/pending50, 总150条; read limit最大150(default20), 存储quota512KB, metadata/wire不变, shared仍0.24.0但需重新构建核对.  前文1..100及成功/异常合并预算仅代表旧准备版, 不再作为执行断言.  未接入任何A/B实例、未启动SDK或fixture, 不继续联测, 等新完整hash清单与owner交接.  底层预算矩阵仍由owner主验, SDK只同步新schema与150/151参数边界的消费要求.

恢复准备(event15506): 新build-final.json最终56项已独立匹配, background a48311dfad111e5d1cb1b2aa34075bb967cc463d91e415308e343fad1ce30819, 原撤回清单/证据不覆盖.  runtime核验改用新清单; read消费同步limit150接受/151拒绝, maxSuccessRecords/maxFailureRecords/maxPendingRecords各50.  小样本默认read与limit20一致不冒充大于20条时的截断验证, 大量保留矩阵仍引用owner独立覆盖.  脚本仅准备及syntax检查, 尚未启动资源, 等owner最终单实例矩阵和A/B helper审阅后的交接.

交接适配更新(event15512): owner首次A命名/reload后短暂ENOENT已清理, 未交接即不启动.  命名profile的实际socket和MCP default fallback分开处理: 通过真实registry记录及显式profile选择路由, 非default时fallback只指向该owned TMPDIR内确认不存在的socket.  profiles_list可包含已授权A/B两身份, 逐一核对并禁止出现其他身份, 不强求列表只有一项.  实际hello另外直接核验每个owned socket, 不伪造discovery或绕过UUID校验.

更正交接原因与方案(event15514): 先前ENOENT是fixture改name后仍访问default socket, 并非readiness; owner已撤回该归因并清理两次失败准备.  最终采用两套default名称, 实际UUID/目录/socket/SDK环境独立, 不做rename/sharedDiscovery.  SDK按各自真实socket+隔离registry连接, 前述命名profile适配不进入本轮执行或覆盖计数.  只证明profile存储隔离, 不计同一server的名称路由.
