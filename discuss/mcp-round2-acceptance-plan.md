# 第二轮 MCP 独立验收计划

状态: 准备完成, 等待 mcp-main 的 build 就绪通知和 mie-tester 的专用浏览器接入信息.  本文不代表已执行或通过.

环境协作已确认: mie-tester 在 mie-main 冻结后启动专用 Chrome, 提供 socket/TMPDIR/profile/PID.  本方不并行调用共享 environment factory, 仅管理自己的 tab/SDK/fixture, 完成后通知 mie-tester 再清理 Chrome.  备注测试初值约定为 `synthetic-note-round2`, 更新/清空按设置页真实契约验证.

需求依据: `../mie/docs/example-user-needs.md`.  范围以 MCP 到 bridge 到 extension 的真实调用链为主, 不修改产品代码, 不 commit 或 push.

环境: 复用 mie-tester 本轮自建 Chrome for Testing 实例, 使用独立 MCP SDK stdio 客户端启动当前 `dist/index.js`.  两个 MCP server 进程 A/B 共用该实例, 验证进程归属隔离.  页面、storage 和网络副作用仅使用本轮 localhost fixture 和虚构数据.  不使用用户登录态, 不运行全量测试或 tmux 探针.

| 用例组 | 操作与断言 | 证据 |
| --- | --- | --- |
| 工具发现与 schema | 通过 SDK tools/list 检查 javascript_exec 和本轮增量参数, 核对 bridge/tool-defs 版本与实际 build | tools.json, build.json, stderr.log |
| PNG/JPEG native image | 对有颜色和文本标记的 fixture 截图, 断言 image content 的 MIME、文件签名和独立解码尺寸一致, metadata 无 base64; 查看图像 | screenshots.jsonl, native.png, native.jpg |
| JPEG 落盘 | 分别保存 .jpg/.jpeg, 比较 native image 与磁盘字节完全一致; PNG .png 回归 | storage.jsonl, saved-images/ |
| 格式与扩展名边界 | PNG 到 .jpg、JPEG 到 .png、非法扩展名应显式报错且无文件; 根据最终 schema 验证 format 默认值及 quality 边界 | storage-errors.jsonl |
| 截图尺寸与裁剪 | 设置固定 viewport, 使用 scale 和 viewport 内 clip, 独立解码检查尺寸和标记位置; 非法范围/scale 显式拒绝 | geometry.jsonl, clipped.png, scaled.jpg |
| 落盘安全回归 | JPEG 默认不覆盖、显式覆盖、路径逃逸、父目录/目标 symlink 拒绝; 原文件不变且无临时残留 | storage-safety.jsonl |
| 两进程归属 | A/B 分别创建 tab, mineOnly 各自仅包含自己的集合; 稳定复查和第三个新进程查询证明同进程稳定、跨进程分离 | sessions.jsonl |
| 伪造 sessionId | 尝试在创建、mineOnly 查询/关闭注入另一个进程的 sessionId; 应拒绝或由进程真实标识覆盖, 不得冒用归属或关闭对方 tab | sessions-spoof.jsonl |
| mineOnly 关闭 | A 的 mineOnly 关闭后, B 和本轮专门创建的 unknown tab 仍存活; unknown 不纳入任何进程 mineOnly | sessions-close.jsonl, cleanup.json |
| popup 归属 | fixture 真实用户点击创建 popup, 断言继承 opener 所属进程并可由同一 mineOnly 清理 | sessions-popup.jsonl |
| javascript_exec 默认拒绝 | 缺少/关闭 allowUnsafe、错误 expectedOrigin、非 HTTP(S) 或不符合 managed tab 条件的调用显式拒绝; fixture 计数器不变 | javascript-denied.jsonl |
| javascript_exec 正向 | 在自建页面明确 allowUnsafe=true 和 expectedOrigin, 读取虚构 FormData/storage, await 本地 fetch, 返回可核对的摘要; 写计数器仅递增一次 | javascript-success.jsonl, fixture-requests.json |
| javascript_exec 错误边界 | 抛错、Promise 超时和超量输出有界返回; 检查计数器未因 MCP 自动重试而重复执行, 不把超时当作回滚 | javascript-errors.jsonl |
| profile note | 由 mie-tester 在专用 profile 设置虚构中文备注, 检查 profiles_list 原样保留; 更新与清空后的表现按最终契约核对 | profiles.jsonl |

以上操作均针对一次性本地数据.  unknown tab 由测试专门创建并记录 ID, 不以用户或其他 agent 的 tab 充当删除断言对象.  session 标签只验证清理归属, 不声称提供身份认证.

就绪后按最终 schema 固化参数和独立断言, 将原始 MCP transcript、断言、截图、版本/build hash、清理结果写入 `.e2e-test/runs/mcp-round2-<timestamp>/`.  当前没有本轮执行结果.  如环境或能力不可用, 标记 BLOCKED 并说明原因, 不计为 PASS.

执行后仅关闭自己创建的准确 tab ID, 关闭 SDK 子进程和 fixture 服务, 删除自己创建的 symlink/越界 sentinel.  保留验收证据, 通知 mie-tester 释放借用环境, 由环境所有者清理浏览器.
