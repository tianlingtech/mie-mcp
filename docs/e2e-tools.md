MCP 使用共享 `@mie/tool-defs` 0.20.0 的 22 个工具定义.  新增
`javascript_exec`, 并扩展截图、标签页归属和观测能力,
保持现有 profile 路由和 managed tabs 隔离.

| 工具 | 主要输入与行为 |
| --- | --- |
| `hover` | `tabId`, `backendNodeId`, 可选 `profile` 和 `frameId`, 真实移动鼠标且不点击 |
| `set_viewport` | 标签页级 `width` / `height`, 可选 `deviceScaleFactor` / `mobile`, 或 `reset=true` |
| `inspect_element` | 只读查询已签发元素 ref 的属性, 布局和样式, 敏感控件脱敏 |
| `wait_for` | 元素 ref 或首个 CSS selector 匹配, `state`, 必填 `timeoutMs` 不超过 20000 |
| `request` | 显式 `expectedOrigin`, 同源 `url`, 写方法必须 `allowWrite=true`, 禁止重定向 |

`wait_for` 的 `state` 支持 `attached`, `detached`, `visible`, `hidden`,
`enabled`, `disabled`, `text`, `value`, `url`.  后三种要求 `expected`,
`match` 可为 `equals` 或 `contains`.  URL 等待不使用元素目标和 `frameId`.
超时返回 `matched=false`, 不等同于协议错误.

`computer` 的 `action=screenshot` 返回原生 MCP `image` content 和一项
文本元数据.  `structuredContent` 与文本元数据相同, 包括 `mimeType`,
实际图片像素 `width` / `height`, 保存时还有绝对 `savePath`.
若 bridge 返回 `obscured`, MCP 同时保留该实际值.
0.21 扩展可返回 `screenshotViewport={x,y,width,height}`, 表示捕获区域的
viewport CSS 坐标.  MCP 保留该区域并返回 `coordinateMapping`, 其中
`space="viewport-css"`, `origin={x,y}`, `cssPixelsPerImagePixel` 的每轴值为
捕获区域 CSS 尺寸除以图片实际像素尺寸.  图片坐标换算为
`viewportX=origin.x+imageX*cssPixelsPerImagePixel.x`, Y 轴同理.
原点不是 document scroll 坐标, 不要再次加上页面滚动量.
旧扩展缺少区域时不生成映射; 旧 MCP 会丢弃新增字段, 需同步升级后使用.
工具列表来自 MCP 加载的共享 schema, 不表示每个在线 profile 的扩展已升级.
0.21 新参数 `find.timeoutMs`, `read_console_messages.excludeExtensions` 和
`computer` 的 `type` 目标 ref 需要对应扩展运行时支持.  旧运行时可能返回
`unrecognized_keys`, 即使 MCP 工具列表已经包含该参数.  握手版本不一致
目前只记录诊断, 不自动 reload 扩展; 重启 MCP 也不会更新已加载的扩展.
元数据不再重复包含 base64 `data`, 客户端应从 `image` content 获取图片.

```json
{
  "name": "computer",
  "arguments": {
    "profile": "no-login",
    "tabId": 123,
    "action": "screenshot",
    "savePath": "login/ready.png"
  }
}
```

截图默认输出根目录为 MCP 进程启动工作目录下的 `.e2e-test/screenshots`.
启动环境变量 `MIE_SCREENSHOT_DIR` 可以指定绝对根目录.  相对 `savePath`
从该根目录解析, 也可指定根目录内的绝对路径.  PNG 文件必须以 `.png` 结尾,
JPEG 文件必须以 `.jpg` 或 `.jpeg` 结尾, 扩展名不区分大小写.
格式与扩展名不匹配时在截图请求发出前拒绝.  缺失的子目录自动创建.  不指定 `savePath` 时仅返回图片, 不写文件.
路径校验报错会列出实际允许根目录及 `MIE_SCREENSHOT_DIR` 启动配置提示.
修改父进程的环境配置后, 需重启 MCP 进程使新配置生效.

默认拒绝覆盖已有文件.  `overwrite=true` 才允许原子替换已有普通文件,
不会修改与旧文件共享 inode 的其他 hardlink.  `overwrite` 必须同时提供
`savePath`, 两个字段仅可用于 screenshot, 由 MCP 消费后从 bridge 参数中移除.

保存拒绝 `..` 路径分量, 根目录逃逸, symlink 和非普通目标文件.  所有目录
分量都不能是 symlink, 包括配置根目录的祖先.  macOS 的 `/tmp` 和 `/var`
通常是 symlink, 自定义输出目录应使用对应真实路径, 例如 `/private/tmp`.
最终输出目录必须由当前用户拥有, 且不允许 group 或 others 写入.
新目录权限为 0700, 新截图权限为 0600.

写入使用独立 Node 子进程, 逐级验证目录 inode 后固定当前目录, 最后只通过
文件名创建临时文件并发布.  这避免父目录 symlink 在检查后替换造成重定向,
也不改变 MCP 主进程工作目录.  此机制不隔离拥有相同用户权限的恶意进程,
也不保证其他进程搬移输出目录后返回路径仍然有效.

截图载荷需为规范 base64 编码的 PNG 或 JPEG, MIME 必须匹配请求格式.
MCP 校验图片头和结束标记, 从 PNG IHDR 或 JPEG SOF 读取实际尺寸.
这不是完整图片解码或像素内容验证.
保存失败返回显式工具错误, 不会退化成未落盘的成功响应.

`computer` 截图支持 `format=png/jpeg`, 默认 PNG; `scale` 为 0.1..1,
`quality` 为 1..100 的整数且仅在显式 `format=jpeg` 时可用.
`clip={x,y,width,height}` 使用 viewport CSS 坐标, 区域须在 viewport 内.
例如 `format=jpeg, scale=0.5, quality=70, savePath="page.jpg"`.
缩放和裁剪由扩展执行, MCP 的返回尺寸以图片字节为准.

每个 MCP 进程生成一个随机 session ID.  `tabs_create` 和所有 `tabs_close`
调用自动附带该 ID, 用于记录创建方和关闭方.  `tabs_context` 的
`mineOnly=true` 使用同一 ID.
`tabs_close` 在 `mineOnly=true` 时不要求 `tabIds`, 同时提供时只关闭其中
属于本进程的标签页.  不指定 `mineOnly` 时保持原有显式 ID 关闭行为.
客户端不能提交 `sessionId`, 工具列表也不暴露此内部字段.  旧标签页的
归属为 unknown, 不纳入 mineOnly; popup 继承创建者归属.  进程重启生成新 ID,
不会自动认领旧进程的标签页.  归属标签用于清理筛选, 不构成身份认证.

`tabs_context(includeClosed=true)` 额外返回 `closedTabs`, 按最新记录优先,
每个 profile 最多保留 100 条、24 小时.  `mineOnly=true` 按创建方
`ownerSessionId` 过滤当前标签页及审计记录, 不按关闭方过滤.
记录保存在 `chrome.storage.session`, worker 重启后保留, 浏览器重启或
插件重新加载后清空, 不保存 URL 或页面正文.

每条记录包含 `auditId`, `tabId`, `ownerSessionId`, `closerSessionId`,
`source`, `requestedAt`, `finishedAt`, `result`, `closedAt`.
未知 session 和尚无对应事件的时间字段为 null.  `result` 的 requested /
succeeded / failed 描述 MIE 的 remove 调用, `closedAt` 记录 Chrome
onRemoved 事件, 两者独立.  不能仅凭 succeeded 判断已观测到实际关闭,
也不能将失败请求当成已关闭.  `source=mie` 表示关联到 MIE 关闭意图,
不排除外部竞态.  无法归因的关闭为 `source=unknown/external`,
`closerSessionId`, `requestedAt`, `finishedAt`, `result` 均为 null.
通过 MIE 的 CDP/Playwright 通道关闭也记录为 source=mie, 但该通道没有
MCP 进程身份, closerSessionId 为 null.  未完成的关闭关联独立于 100 条
展示历史保存, 最多 10000 条, 同样保留 24 小时; 达到关联上限时在关闭前
显式报错.  调用结果与实际关闭事件均取得后清除关联.

`javascript_exec` 每次要求 `allowUnsafe=true`, `expectedOrigin` 和 `code`.
`code` 是 async function body, 使用 `return` 返回 JSON 数据.  `timeoutMs`
为 1..15000, 默认 5000; `maxChars` 为 1..50000, 默认 20000.
只在 managed tab 的 HTTP(S) 主文档页面上下文执行.  可访问页面会话状态,
改变页面或发起网络请求, 输出不自动脱敏.  不自动重试, 超时不撤销已经
发生的副作用, 调用者负责恢复自己安装的钩子.

`tabs_create` 和 `navigate` 可指定 `captureNetwork` / `captureConsole`,
在导航前开启观测.  `wait_for` 增加 `query` / `role` / `name` / `exact`
动态匹配及 `state=network_idle`, 后者使用 100..5000 ms 的 `idleMs`, 默认 500.
仅 network_idle 可指定 `excludeResourceTypes` 和 `excludeUrlPatterns`,
两个数组各最多 20 项.  类型使用 CDP 原始名称, 如 Media / EventSource / Fetch.
URL 每项 1..1000 字符, 使用大小写敏感子串匹配, 不解释 glob 或正则.
匹配任一类型或任一 URL 子串即排除, 默认不排除任何 HTTP 请求.
排除只作用于本次等待, 不改变其他等待或观测记录.
计数范围为主 CDP session 从 capture 开始观测到的 HTTP 请求;
建议在导航前开启 captureNetwork, 更早开始但未观测到的请求不计入.
每次等待重新计算空闲窗口, WebSocket 原本就不计入 HTTP 在途数.
导航提交后按 frame/loader 清理旧文档的在途请求, 保留新文档请求并重新
计算空闲窗口, 避免旧 SSE 缺少终结事件导致永久占用计数.
排除视频或流式请求后, 其余普通 API 仍需完成并满足 idleMs 才匹配.

tool-defs 0.22.0 的 network_idle 在超时且 capture 初始化完成时,
`actual` 除 `inflight` / `idleForMs` 外返回 `pendingRequests` 和
`pendingRequestsOmitted`.  列表最多 10 条, 按当前请求跳转段观测开始时间
从早到晚排列, 只包含本次排除规则过滤后仍计入等待的 HTTP(S) 在途请求.
每条包含 `url`, `urlTruncated`, `type`, `typeTruncated`, `startedAt`,
`elapsedMs`.  URL 最多 512 字符, 类型最多 64 字符, 超出部分由标记说明;
省略请求数单独返回.  startedAt 是扩展收到 requestWillBeSent 的 Unix 毫秒,
elapsedMs 是非负的已观测时长, 均不代表服务器开始时间.
缺少 CDP 类型时诊断显示 `unknown`, 不冒充可被排除规则匹配的 Other.
超时回包前重新采样; 成功返回形状不变, 未完成初始化时仍返回 pending.
跟踪容量溢出显式报错, 不把残缺记录当作完整诊断.  MCP 原样保留响应,
不会为旧扩展缺失的诊断补造字段.

`read_network_requests` 可选 `excludeExtensions` / `excludeDataUrls` 和
`states`.  两个 boolean 仅按记录 URL 的 scheme 排除 chrome-extension:
或 data:, scheme 不区分大小写, 不推断请求发起者.  states 为 1..4 项,
值为 pending / redirected / finished / failed; 状态之间 OR 匹配,
与 URL 及来源过滤按 AND 组合.  所有新参数省略时保留旧行为.
过滤先于 limit 和输出裁剪, clear 仍清空全部缓存, includeSubSessions
范围不变.  网络记录的 pending 状态不等同于 network_idle 的 HTTP(S)
在途范围.  新字段需对应的 0.22 工具契约运行时支持, MCP 版本单独升级
不表示用户 profile 已更新.

`computer` 支持 `clickCount=1..3` 和 `action=drag` 的 `coordinate` /
`toCoordinate`; `set_viewport` 支持 `colorScheme`, reset 同时重置主题模拟.
`find` 增加 `within` / `nth` / `near`; `read_network_request` 支持显式
`responseBodyFormat=binary` 及有界 `prefixBytes` 摘要, 不默认返回原始二进制.
这些能力由共享 schema 校验并透传到扩展.

`profiles_list` 保留经过共享 schema 验证的可选 `note`, 最长 200 字符.
顶层 `serverVersion` 表示当前 MCP 进程启动时读取的产品版本, 与初始化
`serverInfo.version` 一致.  没有在线 bridge 时也返回该值及空 `profiles`.
它不是扩展版本或 hello 中的 bridge/tool-defs 版本, 不证明扩展已经 reload.
备注由用户填写, MCP 不从网页推断账号信息.

`request` 遇到重定向时不跟随, 工具调用正常返回, payload 的 `content` JSON
包含 `code=REDIRECT_NOT_FOLLOWED`, `redirectFollowed=false`,
`status=null`, `location=null`, `detailsUnavailable=opaque-redirect` 和 `method`.
调用方应检查该结果码, 不将工具成功等同于 HTTP 请求完成.  浏览器不暴露
manual 重定向的真实 3xx 状态或 Location, MCP 不补造这些信息.
网络失败或超时仍是 `TOOL_ERROR`, message 保留 `REQUEST_FAILED` 或
`REQUEST_TIMEOUT`; GET/HEAD 与写请求使用不同提示, 写请求可能已被服务端接收.
MCP 不自动重试.

`request` 的 `responseBodyFormat` 可为 `text`, `binary` 或 `hashOnly`,
省略时保持文本行为.
`prefixBytes` 只允许用于显式 binary 模式, 范围 0..256, 默认不输出原始字节.
text/binary 的 `maxBytes` 为 1..50000, 默认 20000.  binary 的 content JSON 返回
`status`, `headers`, `method`, `bytesRead`, `truncated`, `responseBodyFormat`,
`sha256`, `prefixHex`, `prefixBytes`, 不包含 `body`.
仅在明确读到 EOF 且未截断时返回完整响应的 SHA-256, 否则 `sha256=null`.
达到 maxBytes 即保守标记截断, 即使响应实际长度刚好等于上限.
206 的摘要只代表本次范围响应, 不代表整个文件.  二进制前缀不自动脱敏,
`redactionScope=headers-only; binary-prefix-not-redacted` 明确这一边界.

hashOnly 流式计算摘要, `maxBytes` 为 1..67108864 (64 MiB), 默认仍为
20000; 大文件需显式提高上限.  `timeoutMs` 为 1..15000, 默认 10000,
MCP bridge 总时限仍为 30000 ms.  不允许 prefixBytes.
content JSON 返回 `status`, 允许列表内的 `headers`, `method`,
`responseBodyFormat`, `bytesRead`, `complete`, `sha256`, `termination`,
不返回正文、Base64 或字节前缀.
仅 EOF 返回 `complete=true`, `termination=eof` 和完整 SHA-256.
达到字节上限、读取超时或中断时取消读取, 返回 `complete=false`,
`sha256=null`, termination 分别为 byte-limit / timeout / read-error.
正文恰好等于上限时继续判定 EOF, 无 EOF 仍受超时限制.
调用方应检查 complete, 不将工具调用成功等同于完整读取.
请求建立阶段错误仍遵循原有工具错误契约, 重定向仍返回上述特殊结果.
206 的 hash 仅对应本次响应范围.  同源、expectedOrigin 和写授权要求不变,
MCP 不自动重试.

agent 若看不到新版参数, 应先比较原始 tools/list 与会话显示的 schema.
原始列表过旧时重启 MCP server; 原始列表已更新而会话显示缺失时,
检查客户端工具缓存或增量发现, 并刷新工具列表.
重新加载 Chrome 插件不会刷新既有 MCP 进程的工具列表; bridge 握手版本也
不能单独证明插件已加载新代码, 应分别验证 MCP schema 与插件实际调用.
