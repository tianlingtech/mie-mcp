# bridge-transport Specification

## Purpose
TBD - created by archiving change add-bridge-transport. Update Purpose after archive.
## Requirements
### Requirement: bridge socket 连接与惰性重连
系统 SHALL 通过 unix domain socket 连接 bridge.  路径默认推导为 `$TMPDIR/mie-bridge/<uid>/bridge.sock` (`<uid>` 为当前进程的用户 id); 当进程启动时通过环境变量 `MIE_BRIDGE_SOCKET` 显式给出路径, 系统 SHALL 使用该显式路径而非默认推导 (联调等场景下 bridge socket 位于隔离目录, 默认推导无法命中).  显式路径 MUST 每次进程启动时重新指定, 系统 MUST NOT 以任何形式持久化它; 未设置或值为空白时行为与默认推导完全一致.  连接 MUST 是惰性的: MCP server 启动时不要求 bridge 已存在, 仅在首次需要发送请求时才建立连接.  连接断开后, 系统 MUST 在下一次请求时重新尝试连接, 而不是永久进入失败态.

#### Scenario: 显式 socket 路径优先于默认推导
- **WHEN** 进程启动时设置了 `MIE_BRIDGE_SOCKET` 为一个非空路径并调用 default
- **THEN** 系统连接该路径, 不使用 `$TMPDIR` 默认推导; 显式其他 profile 不受此覆盖影响

#### Scenario: 启动时 bridge 未运行
- **WHEN** MCP server 启动而 socket 文件不存在
- **THEN** server 正常完成启动并对外提供 MCP 服务, 不抛出致命错误, 不退出进程

#### Scenario: 首次请求时建立连接
- **WHEN** server 已启动且尚未连接, 此时收到第一个工具调用
- **THEN** 系统建立到 socket 的连接, 完成握手后再发送该请求

#### Scenario: 断线后的下一次请求自动重连
- **WHEN** 已建立的连接被对端关闭, 之后再次收到工具调用
- **THEN** 系统重新建立连接并重新握手, 该次调用正常完成

#### Scenario: bridge 不可用时的错误码
- **WHEN** legacy default 需要发送请求但 socket 文件不存在或连接被拒绝
- **THEN** 系统返回错误码 `BRIDGE_NOT_RUNNING`; 已有发现记录的 profile 不在线时返回 `PROFILE_OFFLINE`

### Requirement: 按 profile 发现与路由

系统 SHALL 接受浏览器工具的可选 profile, 省略时固定为 default, 不保留全局当前 profile 且不回退到其他在线实例.  系统 SHALL 逐次读取 shared 定义的发现记录, 默认目录为 `~/.config/mie/profiles`, 可用 `MIE_PROFILE_REGISTRY_DIR` 指定绝对路径.  目录及记录 MUST 验证本机所有者和权限, 记录 MUST 是有界普通文件并符合 shared schema 与 UUID 文件名, 不接受符号链接或 FIFO 等特殊文件.

#### Scenario: 同 tabId 跨 profile 调用
- **WHEN** 两个 profile 的调用携带相同 tabId 或元素引用
- **THEN** 请求分别发往所选 profile, 不共享页面状态或可变默认目标

#### Scenario: 在线列表
- **WHEN** 调用无参数 profiles_list, 即使 default 离线
- **THEN** MCP 只用 hello 握手聚合在线身份, 返回 id/name/instanceId/status, 不转发浏览器工具或读取 CDP endpoint; 无身份的 legacy default 不伪造 UUID

#### Scenario: default 兼容及禁止回退
- **WHEN** 缺少 default 发现记录
- **THEN** 允许尝试旧 default socket, 新版 hello 必须声明 default; 若已有 default 记录但离线或身份不符, 不回退旧路径或其他 profile

#### Scenario: 显式 default 调用旧 bridge
- **WHEN** 工具参数显式包含 profile:default, 且 legacy default hello 无身份字段
- **THEN** MCP 剥离 profile 后发送其余参数, 不携带 expectedProfile, 兼容旧版严格输入 schema

#### Scenario: 身份不符与活跃重名
- **WHEN** 记录与 hello 的 UUID/name/instanceId 不同, 或多个握手成功实例同名
- **THEN** 分别返回 PROFILE_IDENTITY_MISMATCH 或 PROFILE_CONFLICT, 不发送工具请求; 不存在的名称返回 PROFILE_NOT_FOUND

#### Scenario: 请求身份与生命周期
- **WHEN** 发送新实例的请求或发现记录因改名及重启而变化
- **THEN** 发送前重新核验当前连接身份并携带顶层 expectedProfile, args.profile 留给 bridge 核验后剥离; 在途旧请求不重放, 缓存连接独立管理, 退休连接排空后释放, 关停关闭全部连接

### Requirement: 行分隔 JSON 帧编解码
系统 SHALL 以行分隔 JSON (每帧一行, `\n` 结尾) 与 bridge 交换帧.  请求帧格式为 `{id, type:"tool_request", tool, args, timeout_ms}`, 响应帧格式为 `{id, type:"tool_response", payload}` 或 `{id, type:"tool_response", error}`.  系统 MUST 正确处理 TCP/socket 分片: 一次读取中可能包含半帧或多帧.

#### Scenario: 单次读取包含多个完整帧
- **WHEN** 一次 socket 读取的数据中含有两个以 `\n` 分隔的完整响应帧
- **THEN** 系统解析出两帧, 分别派发给对应 `id` 的等待方

#### Scenario: 帧跨越多次读取
- **WHEN** 一个响应帧被拆成两次读取送达
- **THEN** 系统缓冲前半段, 待收到 `\n` 后解析出完整帧并正确派发

#### Scenario: 收到预留的 event 帧
- **WHEN** bridge 发来 `{type:"event", ...}` 帧
- **THEN** 系统安全忽略该帧并继续正常处理后续帧, 不报错也不中断连接

#### Scenario: 收到无法解析的行
- **WHEN** bridge 发来一行非法 JSON
- **THEN** 系统丢弃该行并记录诊断信息, 不使进程崩溃, 后续合法帧仍能正常处理

### Requirement: hello 握手与版本协商
连接建立后, bridge SHALL 主动发送 `{type:"hello", protocol_version, bridge_version, tool_defs_version}`.  系统 MUST 在握手完成后才发送任何 `tool_request`.  本实现支持的 `protocol_version` 起始值为 1.  当 bridge 的 `protocol_version` 与本实现不兼容时, 系统 MUST 拒绝使用该连接, 并在错误信息中同时给出双方的版本号.

#### Scenario: 握手成功
- **WHEN** 连接建立后 bridge 发来 `protocol_version` 为 1 的 hello 帧
- **THEN** 系统记录 `bridge_version` 与 `tool_defs_version`, 并开始发送待处理的 `tool_request`

#### Scenario: 协议版本不兼容
- **WHEN** bridge 发来的 `protocol_version` 不被本实现支持
- **THEN** 系统拒绝该连接, 返回的错误信息中同时包含 bridge 的 `protocol_version` 与本实现支持的版本

#### Scenario: 握手前不发送请求
- **WHEN** 连接已建立但 hello 帧尚未到达, 此时有工具调用待发送
- **THEN** 系统暂不发送该请求, 直到握手完成后才发出

### Requirement: 超时归属与迟到响应丢弃
每个请求帧 MUST 携带 `timeout_ms`, 由 bridge 负责计时并回 `TIMEOUT` 响应帧.  系统仅做兜底计时, 兜底时长为 `timeout_ms + 5000` 毫秒, 使得正常路径下始终由 bridge 先超时.  对于已经结束 (已响应或已兜底超时) 的请求 `id`, 系统 MUST 丢弃其迟到响应.

#### Scenario: bridge 回 TIMEOUT 响应帧
- **WHEN** 请求超时且 bridge 回 `{id, type:"tool_response", error:{code:"TIMEOUT"}}`
- **THEN** 系统按错误码 `TIMEOUT` 结束该请求, 不再触发自身的兜底计时器

#### Scenario: bridge 无响应时的兜底超时
- **WHEN** 请求发出后超过 `timeout_ms + 5000` 毫秒仍未收到任何响应帧
- **THEN** 系统以错误码 `TIMEOUT` 结束该请求

#### Scenario: 丢弃迟到响应
- **WHEN** 某请求已因兜底超时结束, 之后其 `id` 对应的响应帧才到达
- **THEN** 系统丢弃该响应帧, 不重复结算该请求, 不报错

### Requirement: 错误码原样透传
系统 MUST 原样透传 bridge 返回的错误码, 不得归一化为通用失败.  v1 错误码枚举为 `BRIDGE_NOT_RUNNING`, `NOT_SENT`, `SENT_LINK_LOST`, `TIMEOUT`, `TAB_GONE`, `TOOL_ERROR`.  枚举 SHALL 可扩展: 遇到未在枚举内的错误码时, 系统同样原样透传而非替换或吞掉.

#### Scenario: 请求未发出与链路中断的区分
- **WHEN** 连接在请求写入 socket 之前断开
- **THEN** 系统返回 `NOT_SENT`; 而当连接在请求已写出之后断开时, 系统返回 `SENT_LINK_LOST`

#### Scenario: 透传未知错误码
- **WHEN** bridge 返回一个不在 v1 枚举内的错误码
- **THEN** 系统原样透传该错误码字符串, 不替换为 `TOOL_ERROR` 或其他通用码

### Requirement: 帧的未知字段前向兼容与保留键校验
系统 SHALL 接受 bridge 发来的帧中出现的未知字段, 不得因此丢弃整帧.  同时, 响应帧的两个保留键 MUST 被强制校验: 成功响应必须含 `payload` 且不得含 `error` 键, 错误响应必须含 `error` 且不得含 `payload` 键; 错误载荷的 `code` MUST 为非空字符串.  这两条约束并存 —— 放宽的是未知字段, 不是结构合法性.

此契约的目的是让对端在跨仓库并行开发中新增可选字段时不必提升 `protocol_version`, 因为纯增量字段属于向后兼容改动.

#### Scenario: hello 帧携带未知字段
- **WHEN** bridge 发来的 hello 帧除约定字段外还携带一个未知字段
- **THEN** 握手正常完成, 后续请求正常工作

#### Scenario: 响应帧携带未知字段
- **WHEN** 成功响应携带未知字段, 或错误响应携带未知字段, 或错误载荷内部携带未知字段
- **THEN** 该响应被正常解析并结算对应请求, 未知字段不影响结果

#### Scenario: 畸形错误载荷被拒绝
- **WHEN** 错误响应的 `error` 为空对象、字符串、`null`, 或其 `code` 为数字、为空串
- **THEN** 该帧被判定为非法, 不被当作合法响应处理

#### Scenario: 保留键缺失或同时出现
- **WHEN** 响应帧同时含有 `payload` 与 `error` 两个键, 或两个键都不含
- **THEN** 该帧被判定为非法, 不被当作合法响应处理

### Requirement: 握手超时与活锁消除
系统 SHALL 为握手设置独立超时.  当连接已建立但 bridge 在超时窗口内未发送 hello 帧时, 系统 MUST 主动销毁该连接, 使重连逻辑能够接管.  系统 MUST NOT 出现"连接已建立但握手永不结束, 且后续请求永远无法恢复"的状态.

#### Scenario: bridge 接受连接但不发 hello
- **WHEN** bridge 接受了连接却始终不发送 hello 帧
- **THEN** 系统在握手超时后销毁该连接, 该期间等待的请求以错误结束, 而不是各自空等到请求级兜底超时

#### Scenario: 握手超时后仍可恢复
- **WHEN** 一次握手因超时被放弃后, bridge 恢复正常 (新连接会正常发 hello), 此时发起新的工具调用
- **THEN** 系统重新建立连接并完成握手, 该调用正常成功 —— 即握手超时不是终态

### Requirement: 请求兜底计时的起点排除连接与握手
请求级兜底超时的计时 SHALL 在请求帧被交付给 socket 之后开始, 而非从调用进入时开始.  连接建立与握手所消耗的时间 MUST NOT 计入 `timeout_ms + 5000` 的预算, 以保持"正常路径下始终由 bridge 先超时"这一不变式.

本条约束的是计时起点的**下界** (不早于帧交付给 socket), 不锁定到"数据已 flush 完成"这一具体时点 —— 后者在本传输层上并不是一个可依赖的信号 (写出回调只代表数据交给内核, 不代表 bridge 已收到), 且以它作为起表条件会与下一条"等待中的请求必须被计时器覆盖"直接冲突.

#### Scenario: 握手耗时不挤占请求预算
- **WHEN** 一次工具调用触发了新连接, 且连接与握手耗费了可观时间, 随后 bridge 正常处理请求
- **THEN** 该请求的兜底超时窗口在帧交付给 socket 之后才起算, 不因握手耗时而提前触发

### Requirement: 等待中的请求必须始终被计时器覆盖
任何已进入等待表的请求 MUST 最终被某个计时器覆盖.  系统 MUST NOT 存在这样的状态: 握手已完成、请求已进入等待表, 但该请求没有任何超时保护, 从而在对端停止响应时永久挂起.

这条与上一条是一对约束的两半: 上一条要求计时起点不要过早 (否则握手耗时挤占预算, 表现为过早超时), 本条要求计时起点不得过晚 (否则请求永不超时).  两者中后者严格更严重 —— 过早超时会误报一次失败, 永不超时会让 MCP 调用永远不返回.  实现时任何"把起表推迟到某个可能永不发生的事件"的做法都违反本条.

#### Scenario: 对端已握手但不再读取
- **WHEN** bridge 完成握手后停止读取 socket, 客户端连续发起多个请求直至 socket 发送缓冲被填满
- **THEN** 全部请求最终都以超时结算, 不存在任何一个请求处于无计时器覆盖的挂起状态

#### Scenario: 写出发起后立即具备超时保护
- **WHEN** 一个请求帧刚被交付给 socket, 其数据尚未 flush 完成
- **THEN** 该请求此时已处于计时器覆盖之下, 不依赖任何后续回调是否触发

### Requirement: 校验失败的响应帧按 id 结算
当一个 `tool_response` 帧未通过 schema 校验, 但其原始内容中带有合法的 `id` 且该 `id` 存在于等待表中时, 系统 SHALL 立即以携带校验详情的错误结算该请求, 而不是丢弃该帧并让请求等到兜底超时.

这条的目的是让协议漂移表现为一个可立即诊断的错误, 而不是一个语义上归因错误的超时.

#### Scenario: 畸形响应帧带合法 id
- **WHEN** bridge 返回一个 `id` 合法但结构非法的 `tool_response`, 且该 `id` 有请求正在等待
- **THEN** 该请求立即以错误结束, 错误信息包含校验失败的说明, 而不是等待兜底超时

#### Scenario: 无法归属的非法帧仍被丢弃
- **WHEN** 收到的非法帧不含合法 `id`, 或其 `id` 在等待表中不存在
- **THEN** 系统丢弃该帧并记录诊断, 不影响其他在途请求

### Requirement: 未发出的本地失败使用 NOT_SENT
对于明确没有发送到 bridge 的本地失败 —— 包括工具入参校验失败、协议版本不兼容, 以及错误归一化的兜底路径 —— 系统 SHALL 使用 `NOT_SENT` 而非 `TOOL_ERROR`.  `TOOL_ERROR` 的语义是"工具已执行并失败", 用它描述未发出的失败会在这套错误码唯一存在的那个维度上给出错误信号.

系统 MUST NOT 为此新增错误码: 错误码空间由本仓库与 mie 仓库共享, 单侧新造存在撞车风险.

#### Scenario: 入参校验失败
- **WHEN** 工具调用的参数不满足其 schema, 请求因此未被发送
- **THEN** 返回的错误码为 `NOT_SENT`

#### Scenario: 协议版本不兼容
- **WHEN** bridge 的 `protocol_version` 不被支持, 该连接上的请求因此未被发送
- **THEN** 返回的错误码为 `NOT_SENT`, 且错误信息中仍同时包含双方的版本号

### Requirement: 诊断输出不回显帧内容
系统丢弃非法帧时 SHALL 记录 UTF-8 字节数和前缀哈希.  任何诊断模式均 SHALL NOT 输出帧正文, 截断预览或校验错误详情的原文.

#### Scenario: 详细诊断下丢弃非法帧
- **WHEN** 调用方显式开启详细诊断, 系统丢弃无效 JSON 或协议校验失败的帧
- **THEN** 诊断保留与默认模式相同的指纹, 不含帧正文或截断预览

#### Scenario: 丢弃超长帧
- **WHEN** 完整行或尚未收到换行的缓冲超过上限
- **THEN** 诊断记录被丢弃部分的指纹, 不输出该部分的正文或预览

### Requirement: 行解码缓冲上限
行解码器 SHALL 对未完成行的缓冲区设置上限.  超过上限时, 系统 MUST 放弃该缓冲内容并记录诊断, 而不是无限增长.  上限取值 MUST 高于本协议下可预期的最大单帧 (含截图 base64 载荷).

#### Scenario: 永远收不到换行
- **WHEN** 对端持续发送数据但始终不发送换行符, 累计超过缓冲上限
- **THEN** 系统放弃该缓冲并记录诊断, 进程内存不会随之无限增长

### Requirement: 校验失败诊断只报告与实际帧相关的问题
当一个帧未通过 schema 校验时, 系统给出的 issue 列表 SHALL 只包含与该帧实际形态相关的问题.  当帧格式由多个候选分支构成时, 系统 MUST NOT 把未被选中的分支的抱怨一并列出.

跨仓库排查时, 无关分支的 issue 会把注意力引向错误的方向 —— 例如一个畸形的 `tool_response` 报出"缺少 hello 帧的 protocol_version", 会让人误以为问题出在握手.

#### Scenario: 畸形的 tool_response 不报告 hello 分支的问题
- **WHEN** 收到一个结构非法的 `tool_response` 帧并触发校验失败诊断
- **THEN** issue 列表中只包含与 `tool_response` 自身结构相关的问题, 不含其他帧类型 (如 hello / event) 的必填字段抱怨

#### Scenario: 定位信息仍然保留
- **WHEN** 一个 `tool_response` 的错误载荷字段类型不合法
- **THEN** issue 列表中仍能指出出问题的具体字段路径, 降噪 MUST NOT 以牺牲定位能力为代价

### Requirement: 诊断输出规模有界
诊断输出 SHALL 有确定的规模上界: 嵌套结构的展开深度与最终输出的条目数量都 MUST 设有上限.  达到上限时系统 MUST 截断而非无限展开.

#### Scenario: 深度嵌套的校验错误
- **WHEN** 一个帧的校验错误具有超出展开深度上限的嵌套结构
- **THEN** 系统在达到上限处停止展开, 输出保持有界, 不因结构复杂而无限增长

#### Scenario: 大量并列的校验错误
- **WHEN** 一次校验产生的 issue 数量超过输出条数上限
- **THEN** 系统只输出上限以内的条目, 其余被截断

### Requirement: 超长输入在可提取 id 时按 id 结算
当一段输入因超过长度上限而被丢弃时, 系统 SHALL 先在其有界前缀内尝试提取请求 `id`.  提取成功且该 `id` 存在于等待表中时, 系统 MUST 立即结算对应请求; 提取失败时才按丢弃处理.

本条 MUST 与输入的投递形态无关 —— 无论该行是一次性到达还是分成任意多个分片陆续到达, 结算行为必须一致.  真实的 socket 读取以远小于长度上限的分片到达, 因此"整行已完整到达"绝不能作为触发条件: 那样会让本条在生产参数下永远不触发, 而只在测试构造的单次投递下成立.

提取 MUST 在有界前缀上进行且不得解析整行, 以保持原有的资源边界 —— 被丢弃的输入本就已驻留内存, 真正需要避免的是构造完整对象图.

#### Scenario: 超长输入分片到达且可归属
- **WHEN** 一段超过长度上限的输入以多个分片陆续到达 (分片大小远小于长度上限), 其前缀中含有一个合法且正在等待中的 `id`
- **THEN** 对应请求立即以错误结束, 不必等到兜底超时 —— 分片投递与一次性投递的结果必须相同

#### Scenario: 超长输入一次性到达且可归属
- **WHEN** 一段超过长度上限的输入一次性到达, 其前缀中含有一个合法且正在等待中的 `id`
- **THEN** 对应请求立即以错误结束, 不必等到兜底超时

#### Scenario: 超长输入不可归属
- **WHEN** 收到一段超长输入, 但其前缀中无法提取出合法 `id`, 或提取出的 `id` 不在等待表中
- **THEN** 系统丢弃该输入并记录诊断, 不影响其他在途请求

#### Scenario: 丢弃期间内存保持有界
- **WHEN** 一段超长输入触发丢弃后, 其余分片继续到达而结束符始终未出现
- **THEN** 系统不再缓存这些分片, 内存占用保持有界; 结束符到达后能恢复正常处理后续帧

#### Scenario: 提取不破坏资源边界
- **WHEN** 收到一段远超长度上限的输入
- **THEN** 系统不对其做 JSON 解析, 提取工作只在有界前缀上进行

### Requirement: 帧判定与共享包声明的一致性按方向约束
本仓库对 socket 帧的接受/拒绝判定 SHALL 与共享包 `@mie/tool-defs` 的 `./socket-protocol` 保持**按方向定义的一致性**.  一致性的形式取决于该类帧的传输方向, 两种形式 MUST 分别断言, MUST NOT 混为一条"判定完全相同":

- **入站帧** (`tool_response` / `hello` / `event`, 由对端发出本仓库接收): 对端的声明 MUST 是本仓库接受集合的**子集** —— 即对端接受的本仓库必须接受, 反之不要求.  接收侧比发送侧宽容是前向兼容的前提, 对端将来放宽或增补字段时本仓库不得因此拒帧
- **出站帧** (`tool_request`, 由本仓库发出对端接收): 本仓库的接受集合 MUST 是对端的**子集** —— 即本仓库接受的对端必须接受.  这一侧对端的 schema 是其**运行时闸**而非声明: 违反它的帧会被对端直接拒绝并返回错误, 因此本仓库在此方向上比对端宽容意味着**发送侧护栏失效**, 属于缺陷而非可接受的差异

本仓库不使用对端的 schema 作为运行时校验闸 (本侧实现经过针对性打磨且有实测矩阵背书), 而是各自维护一份定义.  本条约束正是该决策成立的前提: 两份定义只要有一方先漂移, 必须立刻暴露, 而不是等到联调时才发现分歧.

**两类情况不构成违反本条, 但性质不同, 各自的约束见"判定分歧必须导致失败"一节**: 一是下列**已知的预期差异** (长期保留, 无修复日程), 二是**已登记的待修缺陷** (本侧应当修复但当前不宜修复, 其登记必须能在修复后自动失效).

预期差异 MUST 被显式声明而非默认忽略.  这些位置对端"声明从严", 本侧"接受从宽", 均属有意为之:

- `hello` 的 `protocol_version`: 对端是字面量约束 (版本闸语义)
- `hello` 的 `bridge_version` / `tool_defs_version`: 对端带 semver 格式约束
- `tool_response` 的 `error.message`: 对端要求非空字符串, 本侧为 optional 且接受空串并对缺失有 fallback 文案.  对端保证非空, 且该字段**承载建议动作** (例如 `SENT_LINK_LOST` 的 message 按对端 requirement 必须提示先截图确认副作用) —— 它是 agent 的决策输入而非装饰.  本侧的 fallback 仅为防御, MUST NOT 被理解为"message 可有可无"
- `tool_response` 的 `payload` **形态**: 对端要求其为对象, 本侧接受任意值 (含 `null` / `0` / `false`).  对端已裁定"payload 必须是命名字段的对象"是**有意契约**, 理由是增量演进 —— 给任何 tool 的结果新增字段 (耗时、诊断、分页游标) 都是在 payload 内加键, 配合顶层 passthrough 双向无痛; 一旦允许 primitive, 那个 tool 的结果就永远失去了加字段的余地.  将来确需返回裸标量的 tool, 契约要求其包一层 (`{value: ...}`).

  该差异在真实链路上无后果: 对端 bridge 的出帧由 extension 帧经内层 schema (payload 为 record, strict) 校验后重建, primitive payload 的 extension 帧会在校验处失败并变成 `TOOL_ERROR`, 永远不会以 payload 形态出现在 socket 上.  本侧的宽容接受是既有且有测试守护的行为, **不得为消除此差异而收紧**.

#### Scenario: 合法帧两侧判定一致
- **WHEN** 用一组合法的 socket 帧样本 (含携带未知字段的帧) 分别经本仓库的校验与共享包声明校验
- **THEN** 两者都判定接受

#### Scenario: 畸形帧两侧判定一致
- **WHEN** 用一组畸形帧样本 (错误载荷为空对象/字符串/null, `code` 为数字或空串, 保留键同时存在或同时缺失) 分别经两侧校验
- **THEN** 两者都判定拒绝

#### Scenario: 判定分歧必须导致失败
- **WHEN** 两侧对同一个样本给出不同结论, 且该样本**既不属于已声明的预期差异, 也不属于已登记的已知缺陷**
- **THEN** 一致性检查失败 —— 分歧 MUST NOT 被静默容忍或事后解释

被豁免的两类必须性质不同, 不得混用: **预期差异**是双方确认过、长期保留的方向性差异 (对端声明从严、本侧接受从宽), 它没有修复日程; **已登记的已知缺陷**是本侧应当修复但当前轮次不宜修复的问题, 它必须带一个会在修复后自动失效的登记 (见下条), 否则就退化成了永久豁免.

#### Scenario: 预期差异被显式声明
- **WHEN** 样本落在已知预期差异的位置 (如 `hello` 的版本字段格式)
- **THEN** 该位置以显式声明的方式排除在一致性断言之外, 而不是靠断言恰好没覆盖到它

#### Scenario: 出站帧上出现未登记的宽容
- **WHEN** 存在一个 `tool_request` 样本被本仓库接受而被对端拒绝, 且该样本不在已登记的已知缺陷清单内
- **THEN** 检查失败 —— 出站方向的宽容意味着本仓库无法在本地拦下一个必然被对端拒绝的帧

#### Scenario: 已登记的出站宽容缺陷保持可见
- **WHEN** 一处出站宽容因暂不修复而被登记为已知缺陷 (例如收紧它会构成行为变化而当前轮次禁止行为变化)
- **THEN** 该登记 MUST 采取"缺陷消失即报错"的形式, 使检查在缺陷仍存在时通过、在缺陷被修复后**失败并提示清理登记**; MUST NOT 采取静默排除或注释说明一类无法自动失效的形式

#### Scenario: 入站帧上本仓库比对端宽容
- **WHEN** 存在一个 `tool_response` 或 `hello` 样本被本仓库接受而被对端的声明拒绝
- **THEN** 该情况**不**判定为失败 —— 接收侧的宽容是前向兼容的前提, 只需其落在已声明的预期差异内

### Requirement: 连接关闭的状态清理必须同步完成
连接关闭时, 系统对该连接相关状态的清理 —— 清除当前连接引用、结算握手、结算该连接上的在途请求 —— MUST 在同一个同步执行块内完成, 不得跨越任何异步边界.

这条约束保证任何等待中的续体 (例如阻塞在握手上的请求派发) 恢复执行时, 观察到的是一个**已完成清理的一致状态**, 而不是清理进行到一半的中间状态.

**同一约束适用于解码回调**: 行解码器向上层交付帧与超长输入通知的回调同样 MUST 同步完成.  它们的同步性承载两件事 —— 一是使 socket 数据边界的异常兜底真正生效 (回调若返回 promise, 被拒的 promise 会从 try/catch 中逃逸), 二是保证帧按到达顺序处理.

该类约束的破坏**不会被行为差分测试发现** (差分只证明当前实现的行为一致), 也不会被类型检查发现 (返回 promise 的回调在类型上通常仍然合法), 因此必须由 requirement 显式约束.

#### Scenario: 关闭期间等待中的续体观察到一致状态
- **WHEN** 一个请求正阻塞在握手上, 此时连接被关闭
- **THEN** 该请求恢复执行时观察到的连接状态是清理完成后的状态; 系统 MUST NOT 让它观察到"握手已结算但连接引用尚未清除"一类的中间态

#### Scenario: 清理路径不得引入异步边界
- **WHEN** 连接关闭路径上的状态清理被触发
- **THEN** 该清理在同一个同步执行块内全部完成; 若将来清理的任一环节被移入异步执行 —— 无论当前的清理是在单个方法内顺序完成、还是经回调跨模块完成 —— 本条即被违反, 且无论当时的测试是否仍然通过

#### Scenario: 解码回调不得引入异步边界
- **WHEN** 行解码器向上层交付一个帧或一条超长输入通知
- **THEN** 该回调同步完成; 若将来它被改为异步, 本条即被违反 —— 此时数据边界的异常兜底会失效 (被拒 promise 逃逸), 且帧的处理顺序不再有保证 —— **且无论当时的测试是否仍然通过**

本条约束的是**回调的提供方**, 而非要求解码器去容错异步回调.  这个区别是实质性的: 若解码器学会安全吞掉异步回调的拒绝, "回调必须同步"就不再被强制 —— 那是让异步回调变得安全, 而不是让它不被写出来, 防御反而销毁了被防御的规则.  何况捕获拒绝只覆盖同步性承载的两件事之一: 一个被安全捕获的异步回调, 帧顺序照样会乱.

因此本条**无法由运行时测试完整守护**, 与其兄弟条款同属评审期约束.  能真正强制它的机制是静态检查 (例如禁止把 async 函数传给期望同步返回的回调位置), 而非测试.
