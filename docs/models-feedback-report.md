0.21 新增能力的 MCP 实现及独立 SDK 验收已完成.  2026-10-01,
最终 37 个去重用例 PASS, 0 产品 FAIL, 0 待验收 BLOCKED.
结果来自截图/存储运行和参数续跑, 不是一次连续跑完的 37 项.

MCP 复用共享 ScreenshotViewportSchema 校验可选截图区域, 从图片字节读取
实际宽高, 返回 viewport CSS 坐标映射.  缺少区域时保持旧返回行为.
保存路径错误增加实际允许根目录及启动配置提示, 未放宽路径保护.

本地 build、typecheck 和 61 项定向测试通过, jt-code-review 独立静态审查
PASS.  后续共享说明更新通过定向快照检查, 不重复累计测试数量.

独立验收由 mcp-tester 在 mie-tester 创建并独占交接的临时 Chrome/profile
执行.  tool-defs 为 0.21.0, protocol 为 1, 工具数为 22.
扩展 background SHA256:
`d957ec250f5280eaf58a5b9ddc322c626e231ae8a7f8809699c35fb9e95bd286`.
构建包含未提交变更, 不以 HEAD 单独代表受测版本.

- 16 项截图组合: PNG/JPEG、DPR 1/2、scale 1/0.6、全 viewport/非零 clip.
  实际页面已滚动, 从解码图片的目标颜色取得像素位置, 再使用返回映射点击,
  核对实际命中及计数增加.  未用 DOM 坐标正逆换算代替图片定位.
- 5 项存储保护: 越界、父路径、格式不符、覆盖及 symlink 拒绝.
  相对 PNG 和根内绝对 JPEG 成功保存包含在截图组合中.
  路径预检拒绝时, 预先安装的记录确认未增加截图命令.
- 16 项参数及错误用例: find 等待、type 目标与 frame、console 来源过滤,
  以及 7 种 SCRIPT_FAILED 详情保留.  console 扩展来源采用合成 sourceURL,
  不等同于真实安装第三方扩展测试.

17 张实际图片由 tester 完成视觉复核.  MCP 维护侧另核对了 37 个唯一用例
各自的原始 PASS、两段运行前后各 32 项指纹及当前磁盘指纹.
未将 owner 的 nested OOPIF、React 或 Meta+A 专项结果计入这 37 项.

历史证据保留: round2 两次解包前置错误; round3 黄色像素阈值错误及 find
遗漏 role 的错误.  原始失败记录不改写, 另以分类文件说明 harness BLOCKED
及修正后的续跑.  旧 0.20 截图 20s FAIL 不因本轮通过而宣称已修复.

资源清理完成.  release event 14785, owner PID 90221 的清理回执为 PASS,
进程、临时目录及状态均已删除.  MCP 维护侧核对了回执复制件与 owner 原件一致.

完整证据见
[独立报告](../.e2e-test/runs/mcp-models-feedback-021-round3-20261001/report.md)
及 [构建清单](../.e2e-test/runs/mcp-models-feedback-0.21-schema-proof/build-round3.json).
这些本地证据目录被 git 忽略, 本次提交不包含原始运行产物.

功能验收闭环后, MCP 产品版本已更新为 0.5.0.  initialize 的
`serverInfo.version` 和 `profiles_list.serverVersion` 共用现有启动期
PACKAGE_VERSION, 仍从 package.json 单一源读取.  未新增 CLI、工具或 wire 字段.
build、typecheck、4 个文件的 33 项定向测试及独立静态审查 PASS.
回归覆盖无 bridge、旧 bridge、profile 身份与隔离; 初审发现的 P0 旧结果
精确断言已补充新字段并验证通过.

新鲜隔离 SDK 在没有 bridge 时返回两个一致的 0.5.0 版本,
证据见 [版本核验](../.e2e-test/runs/mcp-version-0.5.0-proof/sdk-no-bridge.json).
新的 36 项指纹另行保存, 不覆盖功能阶段清单.  0.5.0 扩展专用实例上的
独立版本 smoke 已通过 4 项: initialize 产品版本、profiles_list 同版及文本
一致性、owner 交接身份、22 tools 与 tool-defs 0.21.0/protocol 1.
维护侧核对了版本原始返回及运行前后各 36 项指纹, 均一致.
证据见 [版本 smoke](../.e2e-test/runs/mcp-version-050-smoke-20261001/report.md).
本次未创建 tab, SDK/bridge 连接已关闭; release event 14804,
owner PID 89228 的销毁回执 event 14806 已核对 PASS, 复制件与原件一致,
进程、临时目录及状态均已删除.  原始 summary 保留运行当时等待回执的状态,
最终清理状态见 manifest 与 cleanup-verification.json.
专用实例通过不表示用户现有扩展或本对话 MCP 已更新.
