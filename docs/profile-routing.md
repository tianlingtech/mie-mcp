# 多 profile 路由

MIE 0.16 的每个 Chrome profile 保存独立 UUID 和名称.  初始名称为
`default`, 可在 MIE 设置中改为 `profile1`, `profile2` 或
`profile-no-login` 等名称.  名称为 1..48 位小写 ASCII 字母, 数字,
下划线或短横线, 首位必须是字母或数字.  改名保留 UUID 并重连 bridge.
名字本身不代表登录状态, MIE 不自动创建浏览器 profile, 登录或删除 cookie.

先调用无参数的 `profiles_list`, 再在浏览器工具参数中指定 `profile`:

```json
{"profile":"profile1","tabId":1,"url":"https://example.com"}
```

该示例是 `navigate` 的参数.  所有 15 个浏览器工具都接受可选 `profile`,
包括密码文件输入与 observation history.  省略时固定选择 `default`,
不会沿用上一调用的 profile, 也不会改选另一个在线实例.
tabId, frameId, 元素引用和观测 ID 都只属于其来源 profile.
密码文件授权也按 profile 名称绑定, 省略 grant.profile 仅授权 default,
不能被其他 profile 的同源页面复用.

`profiles_list` 返回 `{profiles:[{id,name,instanceId,status:"online"}]}`.
MCP 只进行 socket hello 握手探测, 不读取标签页或连接 CDP.
列表不依赖 default 在线, 不返回 socket 路径, CDP token 或 endpoint URL.
这是调用时观察到的在线状态, 不保证下次操作时实例仍在线.

公开 MCP 不提供 evaluate/fetch 工具.  既有 CDP relay 是每个 profile 的
browser 兼容入口, 并非完整 browser CDP 实现.  raw WebSocket 客户端不能
假定 `Target.getTargets` 可用于初始枚举: 当前应先监听事件, 再发送 root
`Target.setAutoAttach` 且指定 autoAttach:true, flatten:true,
waitForDebuggerOnStart:false.  从 `Target.attachedToTarget` 事件获取
主页面的 params.sessionId 和 targetInfo, 事件可能先于命令响应到达.
sessionId 的数字后缀不是 Chrome tabId, targetId 也不能替换为 MIE tabId.
按精确页面身份选定 session 后才执行页面命令, 不向 root 发 Runtime.evaluate.
每个 relay 同时只允许一个 CDP client, 不抢占其他连接; 结束关闭自身 WS.
当前 root setAutoAttach 不实现 false 解除模式, 不把它当作清理操作.

发现记录默认位于 `~/.config/mie/profiles/<UUID>.json`, 根目录可通过
`MIE_PROFILE_REGISTRY_DIR` 指定绝对路径.  隔离环境应在 bridge 和 MCP 两侧
配置相同目录.  该目录不依赖 TMPDIR, 也不从自定义 socket 路径推断.
bridge 原子发布及清理记录; MCP 只读, 要求目录当前 uid 所有且权限私有,
记录为当前 uid 所有的 0600 普通文件, 拒绝符号链接和非普通文件,
记录上限 16 KiB, 内容及 UUID 文件名必须通过校验.

default 兼容 `$TMPDIR/mie-bridge/<uid>/bridge.sock` 与同目录 `cdp.json`.
命名 profile 的 bridge 使用 `/tmp/mie-<uid>-profiles/<UUID>/bridge.sock`,
CDP 也位于该实例目录.  `MIE_BRIDGE_SOCKET` 仅覆盖 default 的 socket,
显式其他 profile 继续使用各自发现记录.

没有 default 记录时, MCP 可以探测旧 default 路径; 有记录但不可连接时
不会退回旧路径.  旧 hello 无身份时仅允许 legacy default 调用, 列表不会
伪造 UUID.  旧路径上的新版 hello 必须声明名称 default, 并可返回其实际身份.
无身份的旧 bridge 调用会在 MCP 层剥离 profile 参数, 因此显式
`profile: "default"` 也兼容旧版严格输入 schema; 新版仍由 bridge 校验后剥离.

MCP 逐次读取发现记录, 核对 hello 的 UUID, 名称和 instanceId,
发送时再次核对连接身份并携带 expectedProfile.  bridge 在执行前校验目标,
然后剥离 profile 参数交给扩展.  改名或重启后不会把旧请求重放到新实例.
不同 profile 独立缓存连接; 移除的连接等待在途调用结束后释放,
MCP 关闭时关闭全部连接.

| 情况 | 结果 |
| --- | --- |
| 未发现指定名称 | PROFILE_NOT_FOUND |
| 有记录但不能握手 | PROFILE_OFFLINE |
| 同名实例均在线 | PROFILE_CONFLICT, 不发送工具请求 |
| 记录与握手身份不符 | PROFILE_IDENTITY_MISMATCH, 不发送工具请求 |
| legacy default socket 不存在或拒绝连接 | BRIDGE_NOT_RUNNING |
| 发现目录或记录校验失败 | NOT_SENT |
| 已发送后失联 | SENT_LINK_LOST, 不自动重试 |

仅文件残留不视为在线.  列表忽略不可连接记录, 但身份不匹配或活跃重名
明确报错.  本机同 uid 进程不是隔离安全边界, 不能据此防护同 uid 恶意进程.

MCP 消费测试使用隔离临时目录与模拟 bridge, 覆盖同 tab/ref 并发路由,
default 不回退, 覆盖路径, 重名和身份冲突, 非法记录, 断线及连接释放.
真实 extension/bridge/CDP 多 profile 验收由 mie 主仓库执行.

2026-09-26 验证记录: MCP 12 个针对性测试文件通过, 155 项通过,
另 4 项为既有预期失败.  独立代码审查通过; FIFO 阻塞边界已修复并回归.
后续显式 default 的 legacy 参数剥离先复现失败, 修复后 3 个文件 29 项通过.

mie-main 报告隔离 CFT 最终 r3 的 9 个场景及 UI 无残留错误断言通过,
覆盖账号 A/B/Guest 隔离, 并发操作, 后台标签, 改名, 重启与 default 离线.
本仓主线程审阅 r3 manifest, 其中 9 项均为 pass, 清理记录显示临时目录
已移除且 Chrome 已退出; 另审阅 r2 的 A/B/Guest 截图与对应文本证据.

全局 Codex MCP 已刷新, 当前会话确认 16 个工具可见, 15 个浏览器工具
均暴露可选 profile.  首次刷新时 profiles_list 返回空列表, 当时日常 Chrome
尚待用户 Reload MIE.  随后用户完成两个新 profile 的创建并再次要求全局安装
与刷新, 重建及刷新成功后 profiles_list 已确认 default 和两个命名 profile
均在线.  未代为重载或操作用户页面.
