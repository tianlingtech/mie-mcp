本文保留验收准备阶段的计划与约束.  最终 28/28 项 PASS 及覆盖限制见
[验收报告](../docs/file-input-delivery-report.md).

0.6.1 文件选择事件消费独立 SDK 验收准备计划.  来源: xats event15009, ../mie/docs/file-input-event-consumption.md, 当前input-files/file-input-selection/file-input-observer/file-input-state及共享工具说明的只读核对.  当时仅准备, 未启动 SDK、浏览器、fixture, 未创建测试文件或执行选择.  等最终冻结清单、独立审查完成通知及owner专用实例交接后运行.

目标为 mie-tester 新鲜独占 Chrome/profile, local-fresh/disposable, 真实 SDK stdio → MCP → bridge → extension.  产品0.6.1, tool-defs0.22.1, protocol1, 22tools; set_input_files入参保持不变.  只创建本轮专用目录内的合成小文件和本机页面, 不读取或上传业务文件, 不配置外部上传端点.  不操作用户runtime、电源、tmux, 不build/commit/push, 不重跑旧37或15组.

成功content JSON保留backendNodeId、可选frameId、files、cleared, 新增verification=current-state|trusted-event和inputState=retained|cleared|removed|changed, 可选observationError.  files是匹配证据元数据, 不必等于页面消费后的当前input.files.  cleared仅请求files=[]为true; 页面自行清空时仍false.  非空选择后匹配证据与当前状态均不足, 或派发后的命令/证据读取/清理失败, 预期message以FILE_SELECTION_UNCONFIRMED开头, 明示页面可能已经处理、先查状态、勿自动重试.  派发前的文件/目标校验拒绝保持原语义, 不笼统要求全部错误都套未确认前缀.

执行纪律: 每个非空选择用例使用新input或新tab, 只调用一次set_input_files.  不在错误后重传同一文件, 不用重复执行来证明修复.  后续仅通过只读页面记录、网络/服务端日志与native CDP轨迹判断结果.  普通input和change各出现一次并不代表两次交付; fixture仅在指定消费回调记录一条非空delivery, 同时独立保留所有事件的type/isTrusted/metadata/time.  不把工具返回、HTTP200、附件UI或文件名出现当作业务上传成功.

| 组 | 操作 | 独立断言与证据 |
| --- | --- | --- |
| 前置 | 比对最终全量文件SHA256, 新鲜SDK initialize/profiles_list/tools/list与owner当前hello身份 | 产品0.6.1/tool-defs0.22.1/protocol1/22tools分别记录, set_input_files无新增入参, profile身份匹配且baseline为空; 结束后同清单再核对 |
| 文件基线 | 在本轮真实临时目录创建两个不同名称/大小的小文本或二进制文件, stat记录预期元数据与本地hash | 只将这些绝对路径交给工具, 页面仅记录元数据, 不读取业务路径; 文件内容/hash不经外部服务传送 |
| 普通单选 | 新普通file input选择一个文件, handler保留input.files | current-state/retained, cleared=false, files名称/大小/顺序匹配本地stat, backendNodeId原样; 一次selection命令、一次非空delivery |
| 普通多选 | 新multiple input选择两个自建文件 | files数量/顺序/名称/大小一致, current-state/retained, 每次只一次消费, 不把两个文件计为两次命令 |
| 同步change清空 | handler先独立记录metadata和delivery, 随后input.value="" | trusted-event/cleared, cleared=false, files仍为原匹配metadata, 页面最终files空, delivery=1; 保留可信input/change证据 |
| 同步input清空 | 在input回调记录并清空, 后续change可能见空 | 工具凭清空前可信input证据成功, trusted-event/cleared且cleared=false; 非空delivery仅1, 不要求change也包含原文件 |
| 异步清空 | change后用短定时器清空, 记录timer执行时间并等最终消费完成 | 允许读取发生在清空前而返回current-state/retained, 或清空后trusted-event/cleared; 按实际时序和证据解释, 不硬编码竞态结果.  最终页面空、原metadata交付一次、cleared=false |
| 移除原input | handler记录后remove原控件 | trusted-event/removed, cleared=false, files为已交付metadata; 原控件isConnected=false, delivery=1 |
| 替换原input | handler记录后用新input替换, 新input有独立身份 | 原目标removed, 不把新input误当原backendNodeId成功目标; 返回trusted-event/removed, 原files证据保留, 新input未收到重复交付 |
| 改变原input文件 | handler消费后用DataTransfer把同一控件换为不同名称/大小的合成文件 | trusted-event/changed, cleared=false, 返回files来自原交付证据, 当前状态明确为另一组metadata; 不把替代metadata混入返回 |
| 主动[]清空 | 先在保留模式选择一次, 确认后对同一目标明确调用files=[] | current-state/cleared, cleared=true, files=[], 原非空delivery数不增加; 主动清空的programmatic input/change单独记录, 不误要求isTrusted=true |
| 空控件[] | 新空input执行files=[] | 保持既有主动清空语义, current-state/cleared, files=[], 无非空交付; 不使用非空选择的trusted-event兜底 |
| 同源frame | get_page_text枚举frameId, 在该frame用find/read_page取得issued ref, 分别保留与消费清空 | 返回frameId/ref一致, 对应frame记录单次交付与metadata, 顶层和其他frame未改变 |
| 真实OOPIF | owner支持的专用实例中建立本机127.0.0.1/localhost跨站iframe, 原生Target证明确实OOPIF, issued frame ref选择 | 至少保留/同步消费清空两模式, 同样核对交付与verification/inputState, 不用原生CDP nodeId冒充issued ref, 不用同源iframe冒充OOPIF |
| 派发前拒绝 | 自建不存在路径、自建目录路径、disabled/directory控件、单选控件传两个文件、错frame或已失效ref | 明确拒绝且原页面delivery不变; 动作前装好native命令观察, 确认未发DOM.setFileInputFiles.  只使用本轮资源, 不尝试业务文件权限边界 |
| 无匹配可用证据 | 自建fixture在早期window capture处理器记录交付后清空并stopImmediatePropagation, 使产品被动观测无法取得匹配metadata且当前为空 | 先证明此真实前提确实成立.  应返回FILE_SELECTION_UNCONFIRMED并保留可能已处理/先查勿自动重试提示; 页面独立记录仍可为delivery=1.  此后只读核对, 禁止再次选择 |
| 派发后导航/上下文销毁 | 自建消费回调记录后导航到本机后续页面, 用sessionStorage或本机受控记录保留交付次数 | 若证据已可取回则按有效证据判定; 若上下文确已销毁使证据读取失败, 要求未确认前缀而非猜测成功.  时序未触发则记该失败分支未覆盖, 不为强求错误重复传文件 |
| 后处理异常 | 自建handler记录后抛错, 不伪造工具层异常 | 区分交付与业务handler成功, 保留console异常; 选择可按有效证据确认, 不宣称下游业务成功或自动重试 |
| 资源清理 | 对每条成功/拒绝/未确认路径记录观测创建、finish/dispose和releaseObject轨迹, 可用时只读检查目标world监听器前后差异 | 临时监听和remote object应清理; 配对时区分工具对象与验收自建诊断对象.  证据不足时不宣称完全证明内部资源无泄漏 |
| 收尾 | 关闭自己的tab、SDK、fixture、native观察, 删除本轮自建临时输入文件, 向owner明确release | 保留文件已删除、tabs为空、进程/连接退出证据; owner按owned身份精确销毁并给receipt, 复制回执且独立确认tempRoot不存在 |

证据预计保存在 .e2e-test/runs/mcp-file-input-061-<实际时间>.  每轮固定脚本快照/hash、构建清单、SDK原始tools/list与调用/返回/错误/时间、页面事件与delivery状态、本地文件stat、native命令及必要响应、frame身份与清理证据.  成功和错误均核对MCP外层text/structuredContent以及工具content JSON的解包层级, 防止把{content:"..."}或javascript_exec的value包裹误判为产品问题.  可保留合成fixture截图补充可见状态, 但不以截图代替可信事件或业务完成证据.

限制与判定边界:

- 本文是准备计划, 尚无冻结产物或真实验收结论.  owner旧0.6复现只作背景, 不加入本轮PASS/FAIL计数.
- 异步清空/导航受调度影响.  每次单调用的实际状态均保留; 未建立特定后置失败时序, 该分支记未覆盖/BLOCKED, 不反复上传追求目标结果.
- capture早期拦截只存在于自建页面, 不更改产品observer、不伪造可信事件, 不干预用户页面.  若跨world事件顺序使产品仍能取得可信证据, 记录实际行为, 不能凭fixture意图断言“无证据”.
- 不通过patch chrome.debugger命令返回、伪造CDP网络/输入事件、改产品函数来模拟真实失败.  派发后命令失败、证据序列化失败、dispose/release失败和25s自动清理兜底若无法自然、受控建立, 留给产品定向测试并明确未独立真实覆盖, 不计成E2E PASS.
- observationError是可选诊断.  出现时核对透传、类型及有界内容, 不要求每次成功都产生该字段; 无实际可触发前提时不虚构正向覆盖.
- files metadata只确认选择证据, 本轮没有上传业务端点, 不声称附件持久化、后台处理或最终上传完成.  明确FILE_SELECTION_UNCONFIRMED也不等于文件未交付.
- 任何阶段前置条件失败只停止依赖组, 不将harness问题当产品FAIL.  修改脚本需另建attempt并保留原始证据; 错误后不得通过自动重传覆盖历史结果.  owner自验、单元覆盖和本轮SDK真实结果分开统计.
