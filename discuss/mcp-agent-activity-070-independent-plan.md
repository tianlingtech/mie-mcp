本文保留验收准备阶段的计划与约束.  最终 3/3 项 PASS 及视觉、清理结果见
[验收报告](../docs/agent-activity-report.md).

0.7 操作提示最小独立 SDK 验收准备计划.  来源: xats event15082和 ../mie/docs/agent-activity-indicator.md.  当时仅只读核对需求及现有visual-feedback文件, 产品尚未冻结, 没有启动浏览器、SDK、fixture或原生诊断连接.

范围限定为新鲜SDK版本确认加两组长wait/只读路径.  产品MCP/extension0.7.0, tool-defs0.22.1, protocol1, 22tools, 公开参数和wire不变.  等最终指纹及mie-tester产品验收完成后的同一专用实例独占交接.  不重跑文件28项、网络15组或owner负责的完整并发/nav/frame/screenshot矩阵, 不操作用户runtime、电源、tmux, 不build/commit/push.

| 组 | 操作 | 独立断言与证据 |
| --- | --- | --- |
| 前置 | 核对最终全量SHA256、owner当前hello/profile身份和空managed-tab基线, 新鲜SDK initialize/profiles_list/tools/list | serverVersion0.7.0、tool-defs0.22.1、protocol1、22tools分别核对; 公开inputSchema与上轮完整列表比较无变化, 运行后重新比对同份产物清单 |
| A: 长wait | 自建本机静态页面, 初始化提示完全淡出后, 对始终不存在的唯一元素调用wait_for, timeoutMs约5000, 等待期间不发任何其他带tabId的MIE调用 | 原生通道在调用中约0.5s、3.5s及4.4s观测, 当SDK promise仍pending时, 4px橙色边框和MIE 正在操作, 请勿干预仍可见.  用实际起止时间确认调用超过3s, 不靠固定sleep推断 |
| A: 结束 | 保存wait_for实际返回的matched=false/timedOut=true及elapsedMs | 这是自然等待超时的正常工具响应, 不冒称TOOL_ERROR.  结束后原生截图/DOM观察显示MIE 刚刚操作, 约3s后开始消退, 在冻结实现对应过渡时长加有界调度容差内不可见 |
| B: 只读 | A已完全淡出后, 单次SDK read_page, 必要时按最终工具说明选get_page_text作为同一只读目标, 不写业务页面 | 原始返回包含fixture业务内容, 不包含提示文字/装饰节点; 原生观察确认只读调用也使提示进入recent, 随后独立淡出.  不为强行抓短调用active帧人为阻塞产品 |
| 无干扰 | fixture内业务文本、输入值、初始焦点/选择范围、固定元素rect和事件计数, 由原生页面快照在A/B前中后读取 | 原内容/输入值/焦点/布局/计数不变; host aria-hidden, pointer-events:none; elementFromPoint仍命中原业务目标.  网络/fixture记录没有提示层新增外部资源请求.  不把被动hit-test扩大成完整点击/键盘回归 |
| 清理 | 关闭自己新建tab、SDK、fixture和原生连接, 明确release给owner | 自身tabs与进程/连接归零, owner按owned身份销毁并给receipt, 复制回执并独立确认临时profile根不存在 |

观测规则:

- 使用专用tab的原生CDP Page.captureScreenshot直接取实际渲染图, 辅以原生DOM/CSS/AX及页面独立业务快照.  不通过MIE computer screenshot观察边框, 因为正常MIE截图按契约主动隐藏整个overlay.
- 提示层可能使用closed shadow DOM.  冻结后按实际渲染节点和CSS定位, 不以内部active计数或函数返回值代替可见图证据.  边框厚度、标签文案和可见性要人工复核实际图片.
- 开始/结束/fade阶段的采样一律走独立原生通道, 不用javascript_exec/read_page等MIE调用轮询提示状态, 否则观察本身会重置active/recent.  B的只读调用是明确的被测动作, 与观察调用分开记录.
- 创建tab及页面初始化本身也可能触发提示.  测试基线必须等其自然淡出, 不手动删除overlay或修改产品activity状态.
- 在成功/自然超时后的recent阶段按实际时间采样.  3s是开始淡出的目标, 不能要求恰好3000ms DOM已移除或opacity已为0; 最终过渡时长和容差在冻结后据CSS/契约记录, 不无限等到通过.
- 不主动让窗口激活、最小化、遮挡或调整系统显示/电源状态.  若专用实例无法形成可判断的原生可见图, 先记录环境前提BLOCKED并联系owner, 不用正常MIE截图看不到边框而误报.

证据预计 .e2e-test/runs/mcp-agent-activity-070-<实际时间>.  保留脚本快照/hash、SDK参数/结果/时间、原生采样时间线、active超过3s图、recent图、淡出后图、只读返回、业务快照、前后构建指纹与cleanup回执.  多次尝试分别留目录, harness问题与产品FAIL区分, 不覆盖历史失败.

覆盖限制: 此处不重复owner完整并发计数、跨tab隔离、导航恢复、frame顶层提示、MIE screenshot隐藏及异常恢复、装饰注入失败不拖延工具、worker/连接异常到期兜底测试.  A的timeout是自然结束路径, 不计作真正异常抛出覆盖.  非页面管理工具不触发及所有公开工具逐项活动矩阵由owner负责, 本轮只独立证明新鲜SDK真实长wait和只读两条路径.  没有全任务所有权锁或业务上传成功之类结论.

准备更新: event15107最终52项清单已独立匹配, 包含bridge执行JS.  脚本及helper已通过语法/导入检查, 未启动SDK/fixture/browser.  最终CSS opacity过渡300ms, recent采样延后至约400ms以避开入场过渡; 随后约2.5s检查仍可见, 约3.7s检查淡出.  实际阶段以各样本时间和SDK promise状态为证.

依据event15121补充off断言: opacity接近0不足以证明淡出, 还须busyUntil/recentUntil均不晚于原生采样时间, 防止把刚淡入起点当作已结束.  逻辑到期仅作附加条件, 最终仍核对computed style和实际原生截图.  当前尚无运行或交接资源.
