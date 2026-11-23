# mcp-server Specification

## Purpose
TBD - created by archiving change add-bridge-transport. Update Purpose after archive.
## Requirements
### Requirement: MCP stdio server 运行时
系统 SHALL 基于 `@modelcontextprotocol/sdk` 以 stdio transport 提供 MCP server.  server 的启动 MUST 不依赖 bridge 的可用性.

#### Scenario: bridge 不可用时仍可启动并列出工具
- **WHEN** MCP client 连接到一个 bridge 未运行的 server 并请求工具列表
- **THEN** server 正常返回已注册的工具列表, 不因 bridge 缺失而失败

### Requirement: 从 tool-defs 派生工具注册
系统 SHALL 提供一个注册接口, 接受外部 tool 定义 (name, description, zod schema) 并据此派生 MCP 工具 schema (JSON Schema).  工具定义 MUST 是唯一来源: 本仓库不重复声明工具的参数结构.  被调用时, 已注册工具 MUST 将调用转换为 `tool_request` 帧交由 bridge 执行, 并把 `payload` 作为结果返回.

#### Scenario: 注册的工具出现在工具列表中
- **WHEN** 以一份 tool 定义完成注册后, MCP client 请求工具列表
- **THEN** 列表中包含该工具, 且其 input schema 与 zod 定义等价

#### Scenario: 调用工具转为 bridge 请求
- **WHEN** MCP client 调用一个已注册的工具
- **THEN** 系统向 bridge 发送 `{id, type:"tool_request", tool, args, timeout_ms}` 帧, 并在收到成功响应后将其 `payload` 作为工具结果返回

#### Scenario: 参数不符合 schema
- **WHEN** MCP client 传入不满足 zod schema 的参数
- **THEN** 系统在发送给 bridge 之前拒绝该调用并返回校验错误

### Requirement: bridge 错误码到 MCP 响应的映射
当 bridge 返回错误时, 系统 SHALL 将其映射为 MCP 工具错误响应, 且 MUST 保留原始错误码字段.  对于影响 agent 后续决策的错误码, 响应中 MUST 附带可操作提示: `BRIDGE_NOT_RUNNING` 提示 "请打开 Chrome 并启用 mie 插件"; `NOT_SENT` 说明该请求未送达, 可以安全重试; `SENT_LINK_LOST` 说明请求已发出但结果未知, 必须先截图确认副作用后再决定是否重试.

#### Scenario: bridge 未运行时的提示
- **WHEN** 工具调用因 bridge 未运行而失败
- **THEN** 返回的错误中包含错误码 `BRIDGE_NOT_RUNNING` 与提示 "请打开 Chrome 并启用 mie 插件"

#### Scenario: 区分可重试与不可重试
- **WHEN** 工具调用以 `NOT_SENT` 失败
- **THEN** 错误信息说明请求未送达且可安全重试; 而以 `SENT_LINK_LOST` 失败时, 错误信息说明副作用未知并要求先截图确认

#### Scenario: 不把 bridge 错误伪装成成功
- **WHEN** bridge 返回任意错误码
- **THEN** 该次工具调用以错误结束, 不返回成功结果, 且原始错误码在响应中可见

### Requirement: 进程关停路径
MCP server SHALL 具备关停路径: 当 stdio transport 关闭, 或进程收到 SIGINT / SIGTERM 时, 系统 MUST 关闭 bridge 连接并使进程能够退出.  系统 MUST NOT 在传输层关闭后因仍持有 bridge socket 而无法自然退出.

#### Scenario: stdin 关闭后进程退出
- **WHEN** MCP client 关闭 stdio transport (stdin EOF), 且此前已与 bridge 建立过连接
- **THEN** 系统关闭 bridge 连接并退出, 不留下持有 socket 的常驻进程

#### Scenario: 收到终止信号
- **WHEN** 进程收到 SIGTERM 或 SIGINT
- **THEN** 系统关闭 bridge 连接并退出

#### Scenario: 关停时在途请求的结算不产生假可重试信号
- **WHEN** 关停发生时仍有已写出但未收到响应的请求
- **THEN** 这些请求以 `SENT_LINK_LOST` 结束 (副作用未知), 不得被标记为 `NOT_SENT` —— 后者会提示可安全重试, 从而导致真实浏览器操作被重复执行

### Requirement: 错误提示覆盖全部错误码
系统为 bridge 错误附加的可操作提示 SHALL 覆盖 v1 的全部错误码, 并对未知错误码给出通用提示.  提示的覆盖 MUST NOT 只及于其中一部分错误码, 否则 agent 面对不同失败时得到的信息质量不一致.

#### Scenario: 每个 v1 错误码都有提示
- **WHEN** 工具调用以 v1 六个错误码中的任意一个失败
- **THEN** 返回的错误中都带有与该码相称的可操作提示, 且原始错误码仍然可见

#### Scenario: 未知错误码的提示
- **WHEN** 工具调用以一个不在 v1 枚举内的错误码失败
- **THEN** 返回的错误原样保留该错误码, 并附带一条通用提示

### Requirement: 版本号单一来源与入口守卫
server 对外声明的版本号 SHALL 与 `package.json` 同源, 不得在代码中重复硬编码.  入口模块 SHALL 仅在被直接执行时启动 server, 被其他模块 import 时 MUST NOT 产生副作用.

#### Scenario: 版本号一致
- **WHEN** 修改 `package.json` 的版本号后启动 server
- **THEN** server 对 MCP client 声明的版本号随之变化, 无需另行修改源码

#### Scenario: import 不启动 server
- **WHEN** 其他模块 import 入口模块
- **THEN** 不会有 server 被启动, 也不会有 bridge 连接被建立

### Requirement: 从 tool-defs 注册共享工具集
系统 SHALL 从 mie 仓库的共享包 `@mie/tool-defs` 引入 tool 输入定义, 并据此注册该包 `TOOL_DEFINITIONS` 导出的完整工具集 (0.16.0 为 16 个: P0 的 `tabs_context`, `tabs_create`, `tabs_close`, `navigate`, `computer`, `read_page`, 加 P1 的 `get_page_text`, `find`, `form_input`, `read_console_messages`, `read_network_requests`, `read_network_request`, `set_input_files`, `observation_history`, `set_password_from_file`, 以及 MCP 聚合的 `profiles_list`).  工具的名单与参数结构 MUST 以该共享包为唯一来源, 本仓库 MUST NOT 重复声明任何工具的参数结构, 也 MUST NOT 自行维护工具名单.

系统 MUST NOT 使用该共享包的 `./protocol` 导出作为 socket 层的帧校验依据 —— 那是 extension↔bridge 的 native messaging 内层协议, 其严格校验与封闭错误码枚举与 socket 层的前向兼容契约相冲突.  共享包的 `ERROR_CODES` 只能作为已知错误码的参考表使用 (例如生成提示), MUST NOT 作为校验闸.

#### Scenario: 共享工具全部可见
- **WHEN** MCP client 请求工具列表
- **THEN** 列表与共享包 `TOOL_DEFINITIONS` 的名单一致 (0.16.0 为 16 个), 各自的 input schema 与共享包中对应的 zod 定义等价

#### Scenario: 已授权文件的密码输入
- **WHEN** 调用 `set_password_from_file`, 提供合法 tabId/backendNodeId/filePath/expectedOrigin/expectedPathname
- **THEN** MCP 校验五个必填字段及可选 profile, 选择对应实例并转发, 不读取文件或加入 secret; 文件授权验证和安全读取由 bridge 执行, 页面 password 类型及精确 origin/pathname 检查由扩展执行, 成功结果仅包含 ok:true/backendNodeId

#### Scenario: 密码输入边界验证
- **WHEN** 提供 value/text/secret/frameId 等非公开字段, 或非法文件路径, origin, pathname, tabId, backendNodeId
- **THEN** MCP 返回 INVALID_ARGUMENT, 不连接 bridge, 不透传明文参数值

#### Scenario: 密码输入安全错误
- **WHEN** bridge 返回 INVALID_SECRET_SOURCE/SECRET_TARGET_MISMATCH/SECRET_INPUT_FAILED 或传输失败
- **THEN** MCP 保留错误码及固定安全消息, 为三个安全错误提供明确提示; 不自动重试, 不把已发送后未知结果当作未设置, 不回读密码确认结果

#### Scenario: 固定长度同构 tuple 的客户端兼容表达
- **WHEN** 共享 schema 的顶层属性派生为固定长度 tuple, 各项 schema 相同且 minItems/maxItems 均等于项数
- **THEN** MCP 将该属性表达为单个 items schema 并保留长度约束, 去掉只适用于 tuple 的 additionalItems; 原始 Zod 参数校验不变, 不同类型的 tuple 不转换

#### Scenario: 观测工具默认参数
- **WHEN** MCP client 调用 `read_console_messages` 或 `read_network_requests`, 仅传合法 `tabId`
- **THEN** 系统通过共享 schema 注入 `limit=100`, `clear=false`, `includeSubSessions=false`, 控制台工具额外注入 `onlyErrors=false`, 再通过现有 socket 帧转发

#### Scenario: 观测工具非法输入
- **WHEN** MCP client 传入非法 `tabId`, 非整数或超出 1..200 的 `limit`, 长度不在 1..200 的过滤串, 非布尔开关或未知字段
- **THEN** 系统返回 `INVALID_ARGUMENT`, 不向 bridge 发送请求

#### Scenario: 观测工具参数与结果透传
- **WHEN** MCP client 传入合法过滤参数和 `clear`, bridge 返回 `{content:string}`
- **THEN** 系统保留过滤串大小写和显式参数, 原样透传结果载荷, 不在 MCP 层执行采集, 过滤或清空; `content` 中的 `entries`, `dropped`, `invalidEvents`, `omitted`, `scope` 由扩展生成

#### Scenario: 网络详情默认参数与显式边界
- **WHEN** MCP client 调用 `read_network_request`, 传入合法 `tabId` 和 `requestId`
- **THEN** 系统通过共享 schema 注入 `maxChars=20000`, `includeBody=true`, `includeRequestBody=false`; 显式传入的 `maxChars` 和 `includeBody=false` 保留并通过现有 socket 帧转发

#### Scenario: 网络详情非法输入
- **WHEN** `tabId` 非正整数, `requestId` 非字符串或长度不在 1..1024, `maxChars` 非整数或不在 1..50000, `includeBody` 或 `includeRequestBody` 非布尔值, 或包含未知字段
- **THEN** 系统返回 `INVALID_ARGUMENT`, 不连接 bridge 或发送请求

#### Scenario: 网络详情结果与错误透传
- **WHEN** bridge 返回网络详情 `{content:string}` 或明确错误
- **THEN** 系统保留原始载荷, 成功时 `structuredContent` 等于载荷且 MCP text 为载荷的 JSON 序列化; 不二次解析, 脱敏或截断内层 `request`, `requestHeaders`, `responseHeaders`, `body`, `requestBody`; 错误码与错误信息沿用现有错误包装

#### Scenario: 请求体与 ExtraInfo 结果透明包装
- **WHEN** client 显式开启 includeRequestBody, 或 bridge 返回 headers 来源状态
- **THEN** 请求体开关与 includeBody 独立转发; MCP 原样保留 requestBody, headers.source/extraInfo 及 response headers.statusCode, 不缓存正文, 不把 pending/unavailable 元数据当成整体失败

#### Scenario: 请求正文格式参数
- **WHEN** client 省略 requestBodyFormat, 或显式传入 text/base64/multipart
- **THEN** 省略时不注入该字段并保持旧 text 行为; 显式任一格式必须同时 includeRequestBody=true, 否则在连接 bridge 前返回 INVALID_ARGUMENT; 未知格式或类型也拒绝

#### Scenario: 二进制与 multipart 结果透传
- **WHEN** bridge 返回 base64 或 multipart 请求正文, absent 状态或格式错误
- **THEN** MCP 原样保留 base64 data/byteLength/returnedBytes/encodingSource/completeness, 或 multipart 有序重复 parts/partial/filesOmitted/omittedParts 等字段, 保持双通道包装一致; 不解码二进制, 不解析 multipart, 不自行降级格式或重试; text 和 absent 旧结构不变

#### Scenario: frame 选择与元素路由
- **WHEN** client 向 read_page/find/form_input/set_input_files 提供合法 frameId, 或向 computer 提供 frameId 与 backendNodeId click
- **THEN** 共享 schema 接受长度 1..256 的 frameId 并保留原值, 省略时不注入; 文件公开入口仍拒绝 verifiedFiles, 内部 PreparedFileInput schema 保留 frameId; bridge 错误不触发根 frame 自动重试

#### Scenario: frame 路由非法组合
- **WHEN** frameId 类型或长度非法, computer 同时提供 coordinate 或使用非 backendNodeId click, 或 get_page_text 接收 frameId
- **THEN** MCP 返回 INVALID_ARGUMENT, 不连接 bridge 或发送请求

#### Scenario: scoped ref 透明传递
- **WHEN** 带 frameId 的 read_page/find 返回 MIE 签发的 opaque 数字 ref, client 用它调用同 frame 的元素操作
- **THEN** MCP 保持 ref 原值并通过 backendNodeId 转发; 签发与当前文档校验由扩展执行, 原生 CDP 节点 ID 和 computer.hit.backendNodeId 不能替代 scoped ref; 无 frameId 的根调用保持原行为

#### Scenario: 可选正则过滤
- **WHEN** 观测列表提供 patternMode=regex 与合法对应 pattern/urlPattern
- **THEN** 共享 RE2 schema 验证表达式后保持原值转发, 不代替扩展匹配; 省略 patternMode 保持旧子串行为且不注入 wire 默认键, 显式 substring 也保持原值

#### Scenario: 正则非法输入不发 bridge
- **WHEN** regex 模式缺对应过滤串, 使用非法 RE2/lookaround/backreference 或编译指令数超过 128, 模式非法, 或额外提供 flags
- **THEN** MCP 返回 INVALID_ARGUMENT, 不连接 bridge 或发送请求; 仅 RE2 inline flags 可随过滤串传递

#### Scenario: 正文默认主 frame 与显式多 frame
- **WHEN** MCP client 调用 `get_page_text`, 省略或显式提供 `includeFrames`
- **THEN** 共享 schema 为省略值注入 false, 显式 true/false 保留; `maxChars` 仍为 1000..200000 且默认 50000, 参数通过既有 socket 帧转发

#### Scenario: 正文模式边界与工具隔离
- **WHEN** `includeFrames` 非布尔值, 参数包含未知字段, 或 client 向 `read_page` 传入 `includeFrames`
- **THEN** 系统返回 `INVALID_ARGUMENT`, 不连接 bridge 或发送请求; 不因 frame 选择功能接受 includeFrames

#### Scenario: 正文两种结果与逐 frame 错误透传
- **WHEN** `get_page_text` 返回主 frame 纯文本或多 frame JSON 文本的 `{content:string}`
- **THEN** MCP 原样保留载荷, 不解析内层正文; 多 frame 的 `frames`, `omitted`, `truncated` 及逐 frame `error` 均由扩展生成, 逐 frame 错误不转为 MCP 整体失败; bridge 整体错误仍通过既有错误包装返回

#### Scenario: 文件输入严格校验与路径保持
- **WHEN** MCP client 调用 `set_input_files`, 提供合法 `tabId`, `backendNodeId` 和必填 `files`
- **THEN** 系统保持路径顺序, 空格, Unicode, 重复项及空数组; 不注入默认 files 或内部 verifiedFiles, 不读取本机文件内容

#### Scenario: 文件输入非法参数
- **WHEN** ID 非正整数, files 缺失或非数组或超过 10 项, 路径为空/相对/含 NUL/超过 4096 字符, 或包含 verifiedFiles/其它未知字段
- **THEN** 系统返回 `INVALID_ARGUMENT`, 不连接 bridge 或发送请求

#### Scenario: 文件元数据与错误包装
- **WHEN** bridge 返回文件选择 `{content:string}` 或明确错误
- **THEN** 系统原样保留载荷, 不解析内层 backendNodeId/files/cleared 或文件 metadata; TOOL_ERROR, TAB_GONE 和 TIMEOUT 沿用既有错误包装, 不自动重试

#### Scenario: 子 session 观测参数与状态透传
- **WHEN** 两类观测列表显式传入 includeSubSessions, 或详情传入 sessionId
- **THEN** 布尔开关原样转发, sessionId 为可选长度 1..1024 字符串且省略时不注入; 新字段非法类型或额外字段在 bridge 连接前返回 INVALID_ARGUMENT

#### Scenario: 子来源与错误不由消费者推断
- **WHEN** bridge 返回含 source 的 child 条目, subSessions 状态, 或明确详情错误
- **THEN** MCP 保持原始载荷与错误包装, 不改写 requestId, 不跨 session 查找, 不把 subSessions.errors 升级为 MCP 整体错误; false 仅根来源及 true 的状态形态由扩展生成

#### Scenario: find增量输入与运行时组合约束
- **WHEN** client传入旧query或role/name/exact组合
- **THEN** 系统通过共享schema注入exact=false, 保持显式参数原值; JSON Schema为flat object且仅tabId必填, 缺查询条件/exact缺name/非exact空白name等由运行时refine在连接bridge前拒绝

#### Scenario: find结果保持纯文本
- **WHEN** bridge返回find的ref/value行, 上限提示或零命中文本
- **THEN** MCP原样保留{content:string}, 不将内层纯文本JSON解析, 不归一化参数或自动执行ref交互

#### Scenario: 历史action边界与wire参数
- **WHEN** 调用observation_history的status/configure/read/clear
- **THEN** action枚举与跨字段约束由shared schema在bridge连接前校验; configure必须enabled, 仅read可查询字段, limit省略不注入wire, UUID原值保留

#### Scenario: 历史状态与错误透明包装
- **WHEN** bridge返回历史状态或分页记录, 或操作失败
- **THEN** MCP保留{content:string}与内层全部状态/游标/摘要; status.error不升级为整体isError, read/configure/clear错误沿用既有错误包装, 不重试或自行操作storage

#### Scenario: 历史与live独立
- **WHEN** 历史read返回旧tabId/captureId/source或requestId
- **THEN** MCP不恢复调试连接或自动调用live详情, live clear和history clear的区别由工具description明确

#### Scenario: 按 action 判别的工具输入
- **WHEN** MCP client 查看 `computer` 工具的 input schema, 或以其中一种 `action` 调用它
- **THEN** 该工具的 schema 正确表达了按 `action` 判别的多形态输入, 且合法调用能被正确转发给 bridge

#### Scenario: 未知错误码不因共享包而被收窄
- **WHEN** bridge 返回一个不在共享包 `ERROR_CODES` 内的错误码
- **THEN** 系统仍原样透传该错误码, 引入共享包 MUST NOT 使未知码被拒绝或归一化

#### Scenario: stub 工具不出现在生产入口
- **WHEN** 生产入口启动的 server 被请求工具列表
- **THEN** 列表中只有共享包导出的工具, 不含仅用于测试的 stub 工具

### Requirement: obscured 标记不得被当作失败
当 bridge 返回的工具结果中包含 `obscured=true` 一类的标记时, 系统 SHALL 原样透传该结果, MUST NOT 据此把调用判定为失败.

对端已知: 点击 input 类控件时命中探测可能把 UA shadow DOM 的内部节点误报为被遮挡, 而功能实际不受影响.  由本侧硬性拒绝会让正常的输入框点击失败, 且 agent 无从得知原因.

#### Scenario: 结果中带 obscured 标记
- **WHEN** 工具调用成功返回, 但结果载荷中含 `obscured=true`
- **THEN** 该调用以成功结束, 载荷原样返回给 agent, 由 agent 自行判断
