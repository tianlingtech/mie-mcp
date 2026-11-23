`graphics_diagnostics` 读取受管标签页指定 frame 的有界 canvas 布局元数据.
扩展使用固定 isolated-world 代码, 复用 frame 定位能力, 支持 opaque/OOPIF
frame 和 open shadow root.  不要求 AX 元素 ref, 不接受调用方 JavaScript.

| 参数 | 契约 |
| --- | --- |
| `profile` | 可选, 沿用共享 profile 名称校验, 省略时路由到 `default` |
| `tabId` | 必填正整数, 目标必须是受管标签页 |
| `frameId` | 可选, 长度 1..256, 省略时选择主 frame |
| `maxCanvases` | 整数 1..20, 默认 10 |

输入为严格 object, `code`, `selector`, `allowUnsafe`, `backendNodeId` 和
`sessionId` 等未知字段会在 MCP 连接 bridge 前被拒绝.  MCP 不补造 frame ID,
不因目标 frame 失效自动回退到主 frame, 不自动重试失败请求.

扩展成功 payload 为 `{content: JSON.stringify(inner)}`.  MCP 将此 payload
保留在 `structuredContent`, 并将整个 payload 序列化为 MCP 文本 content.
`GraphicsDiagnosticsResultSchema` 校验的是内部 `inner`, 字段如下:

| 字段 | 内容与限制 |
| --- | --- |
| `frameId` | 实际 frame ID, 长度 1..256 |
| `visibilityScope` | 固定为 `frame_local_css_and_viewport` |
| `viewport` | 非负有限 `width` / `height`, 正有限 `devicePixelRatio` |
| `canvases` | 最多 20 项, 本次返回数量受 `maxCanvases` 限制 |
| `scannedElements` | 已扫描元素数, 整数 0..2000 |
| `truncated` | 是否触及扫描或输出上限, 不表示页面只有这些 canvas |

每个 canvas 只含 `index`, `buffer={width,height}`, `rect={x,y,width,height}`,
`cssVisible`, `intersectsViewport` 和 `webgl`.  `index` 为 0..19 的整数,
尺寸为非负有限数, 坐标为有限数.  `webgl` 固定返回
`contextLost="unknown"`, `reason="existing_context_reference_unavailable"`.
不会调用 `getContext` 或初始化渲染 context 来探测状态.

可见性只描述该 frame 内的 CSS 状态和 viewport 交集, 不包含祖先 iframe
可见性, 祖先裁剪或遮挡判断.  不读取像素, 不修改 DOM 或刷新页面;
布局读取仍可能触发浏览器 layout.

扩展出口使用严格结果 schema 验证内部对象, 未通过时返回固定错误,
不回显原始 payload.  输出不包含 URL, title, text, attributes, 像素,
表单值或凭据.  MCP 消费共享输入 schema 并校验 socket 响应封套,
成功 payload 仍沿通用路径转发, 不额外逐工具校验或过滤内部结果.
输出校验边界是扩展, 不能将 MCP 转发成功视为另一层敏感字段过滤.

本轮使用已构建的共享 tool-defs 0.30.0 未发布候选, 该候选导出 26 个工具.
同一版本字符串不代表内容相同, 已在线 MCP 不会自动增加工具, 重启 MCP
也不会替浏览器 reload 扩展.  当前同步不表示已发布或已验证真实浏览器行为.

定向校验位于 `test/graphics-diagnostics.e2e.test.ts`,
`test/profile-routing.e2e.test.ts` 和 `test/tool-defs.test.ts`.
它们覆盖真实 SDK stdio 到隔离 fake bridge 的参数默认值, 输入边界,
profile/frame 转发, 错误不重试和响应封套, 以及工具列表与 schema 快照.
模拟响应通过共享结果 schema 构造, 不证明扩展的出口过滤或
opaque/OOPIF, shadow root, 扫描截断, 像素禁读等浏览器行为已经通过验收.

首次快照校验因既有描述漂移失败.  对端核对源码后, 本轮同步 10 项历史
工具描述, 新增图形诊断的 2 项快照; 既有输入 schema 与其他快照保持不变.
描述对账不代表本轮重新验收旧功能.  初次失败摘要, 原始快照和差异记录
保留于 `.e2e-test/runs/mcp-graphics-diagnostics-20261107/`.
