# Profile 本机启动与关闭恢复

MCP 0.8.0 / tool-defs 0.23.0 新增 `profiles_launch`.  此工具由 MCP 本机处理,
不发送 bridge 工具请求, 不重放此前结果未知的操作.  `profiles_list` 仍只返回
已完成身份握手的在线 profile, 不列出离线启动映射.

```json
{"profile":"work","timeoutMs":10000}
```

`profile` 必填, 规则与既有名称一致.  `timeoutMs` 是本次等待上限,
整数 1..60000, 默认 10000 毫秒.  成功返回:

```json
{"profile":{"id":"11111111-1111-4111-8111-111111111111","name":"work","instanceId":"22222222-2222-4222-8222-222222222222"},"status":"online","launched":true}
```

`launched:false` 表示调用发现 profile 已在线, 没有启动进程.
`launched:true` 表示本次启动流程已请求启动, 并确认了在线身份.
Chrome 可能把请求交给已有进程, 所以此字段不保证新建了进程或窗口.

## 显式本机映射

在 MCP 启动环境中设置 `MIE_PROFILE_LAUNCH_CONFIG=/absolute/path/launch.json`.
不设置时, 已在线 profile 仍能幂等返回; 离线 profile 明确报未配置.
以下为配置格式示例, UUID 和路径必须替换为本机已确认的真实值:

```json
{
  "version": 1,
  "profiles": {
    "work": {
      "profileId": "11111111-1111-4111-8111-111111111111",
      "executable": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "userDataDir": "/Users/your-user/Library/Application Support/Google/Chrome",
      "profileDirectory": "Profile 2"
    }
  }
}
```

MIE 名称与 Chrome profile 目录不是一回事.  `profileId` 从此前确认的
`profiles_list` 身份取得, Chrome 目录由本机配置者确认, 不从名称猜测.
本功能不安装扩展、不注册 native host、不创建 Chrome profile、不登录账号.
目标必须已配置 MIE 扩展和 native bridge, 且使用与 MCP 相同的发现目录.

映射文件每次启动调用读取, 必须是当前 uid 所有的 0600 普通文件,
不能是符号链接或 FIFO, 最大 64 KiB.  所有字段严格校验, 拒绝任意额外 argv.
执行文件必须为可执行普通文件, 不可被 group/world 写入.
userDataDir 与其下的 profileDirectory 必须已存在, 属当前 uid,
不可被 group/world 写入; 所检查路径的末级不允许符号链接.
profileDirectory 只能是单个目录名, 不允许路径分隔符、NUL、`.` 或 `..`.
同 uid 恶意进程不属于本机配置的隔离安全边界.

启动只使用固定参数 `--user-data-dir=...`, `--profile-directory=...`,
`--no-startup-window`, 不经 shell.  参数来自本机映射, 工具调用不能提供执行路径.
MCP 0.9.3 起不再打开 `about:blank` 起始窗口: profile 只加载扩展上线,
没有任何窗口, 也不走启动时的会话恢复 (后者按 Chrome 参数语义, 未单独实测).
无窗口时 `tabs_create` 依赖扩展 0.10.x 的兜底, 以不聚焦的新窗口创建 tab.
超时或 MCP 退出后不终止已启动 Chrome.  不修改用户现有 MCP 启动配置.

### 不抢 macOS 前台

旧版本以 `about:blank` 启动时, Chrome 会把自己切到 macOS 前台.
2026-10-05 在 stable 154.0.8037.95 / macOS 26.2 上用临时 user-data-dir
对照, 每 250ms 采样 `lsappinfo front`: 直接运行二进制、`open -g -n`、
`open -g -j -n` 冷启动及转发到已运行实例都抢前台, 且被激活的是新 Chrome
进程本身; 任意方式加 `--no-startup-window` 均不抢.  所以起作用的是该参数,
不是 `open -g`, MCP 仍直接 spawn 映射中的 executable.  Chrome for Testing
用 `open -g` 不抢, 与 stable 行为不同, 不能用它推断日常 Chrome.

## 身份与失败边界

该名称有映射时, 即使已经在线也必须核对配置 UUID.  有效配置文件没有该名称
条目等同于没有该名称的映射, 在线仍允许幂等返回.  没有映射时, 在线结果仍要求
发现记录与 hello 的 name、UUID、instanceId 一致; 无身份的 legacy bridge
不算成功.  离线启动允许新的 instanceId, 但 name 与映射 UUID 必须一致.
同名在线冲突直接失败.  启动进程 exit 0 只表示进程正常退出, 仍等待握手;
非零退出、信号退出或 spawn 失败明确报错.

| 错误码 | 含义与处理 |
| --- | --- |
| PROFILE_LAUNCH_NOT_CONFIGURED | 离线且没有该名称的显式映射, 配置后调用或手动打开 |
| PROFILE_LAUNCH_CONFIG_INVALID | 配置格式、权限或既有路径不符合要求, 修正本机配置 |
| PROFILE_LAUNCH_FAILED | 启动进程失败, 检查 Chrome 配置及当前在线状态 |
| PROFILE_LAUNCH_TIMEOUT | 限时内未确认身份, 浏览器可能仍在启动, 先检查 profiles_list |
| PROFILE_IDENTITY_MISMATCH | 配置 UUID 或发现身份不符, 核实目标, 不绕过校验 |
| PROFILE_CONFLICT | 多个在线实例重名, 先解决名称冲突 |

超时不代表 Chrome 已关闭, 也不代表此前操作没有发生.
同一 MCP 进程内的同名并发调用共享首个启动流程, 避免重复 spawn.
后加入调用仍受自己的等待上限约束, 但不能延长首个启动流程的截止时间.
不同 MCP 进程之间不提供全局启动锁.

## tabs_close 恢复

扩展 0.8.0 在关闭将移除整个 profile 全部 tab 时先保留一个非受管
`about:blank`, 防止普通清理导致最后窗口退出.  该空白页不出现在
`tabs_context` 的受管列表中.  已有其他 tab 时不额外创建, 空列表无副作用.
这项保护由扩展实现, 仅重启 MCP 不会更新现有 Chrome 扩展.

如果 `tabs_close` 返回 `SENT_LINK_LOST`, MCP 保留原 code/message/data,
并提供关闭专用提示: 关闭结果未知, profile 可能离线.  先用 `profiles_list`
检查; 离线时可按映射 `profiles_launch` 或手动打开, 然后用 `tabs_context`
核实受管 tab.  不把断连当作关闭成功, 不自动重试关闭或重放其他旧操作.

## 验证记录

定向 MCP stdio 测试使用临时映射、模拟启动程序和 fake bridge, 不碰用户
Chrome.  该层验证参数、身份、启动/等待行为和错误消费, 不替代真实浏览器
对最后窗口保护及扩展重新上线的独立验收.  真实 E2E 由 mcp-tester 与
mie-tester 使用专用可清理实例执行, 本轮结果及限制如下.

2026-10-02 开发侧结果: build/typecheck 通过, 定向 83 项通过, 23 项未选中.
其中启动 19 项、既有路由/注册/index/shared 58 项、其他列表断言 6 项.
独立代码复审 PASS.  首轮审查发现握手卡住时进程非零退出被误归为超时,
已改为失败 Promise 与探测竞速并补回归; 旧列表断言同步为 23 工具.
补充的进程存活测试曾因模拟进程启动预算与退出等待上限不足失败,
调整测试计时后通过, 不把这些 harness 失败算成产品通过记录.
新鲜隔离 SDK 核实 serverInfo/profiles_list 为 0.8.0, tools/list 为 23 项,
相对 0.7 仅新增 profiles_launch 及修改 tabs_close description,
旧工具全部 input schema 不变.  证据位于
`.e2e-test/runs/mcp-profile-lifecycle-0.8.0-proof/`, `build.json` 包含
55 个 MCP/shared/扩展/bridge 文件的 SHA256, 不证明用户当前运行时已更新.

独立 SDK 功能验收覆盖 25 个不同场景, 其中 15 项为受控 OS 启动边界,
10 项为真实 Chrome 场景.  证据根目录为
`.e2e-test/runs/mcp-profile-lifecycle-080-20261002/`, 分为首次运行、
`continuation/` 与 `cold-retest/` 三轮.  主线程核对 25 条唯一 PASS,
三轮前后各 55 文件与冻结清单及当前磁盘一致, 未在轮次之间修改产品产物.
25 项是三轮按最新唯一功能用例合并, 不是单轮连续通过.  独立 manifest
保留 `functionalStatus=PASS`、整体 `status=FAIL`, 因辅助原生截图实际失败,
另列首次冷启动测试入口的历史失败, 不把整个验收记录标为全绿.

| 范围 | 实际证据 |
| --- | --- |
| 受控 OS 边界 15 项 | 真 SDK 调用本轮模拟进程, 包括 exit 0 等待、非零退出、ENOENT、超时不 kill、并发合并、无配置及不安全配置拒绝.  不计为真实 Chrome 启动 |
| 在线与版本 6 项 | 真实 hello、0.8.0/23 工具, 无配置/有效配置缺条目/正确映射幂等, 错 UUID 和无效配置拒绝, 现有窗口/tab 不增加 |
| 关闭保护 2 项 | 关闭真实唯一 tab 后仍在线且只剩一个无 owner 的 about:blank, managed 列表为空; mineOnly/空集合不移除保护页, 后续清理不重复创建保护页 |
| 直接 Chrome 恢复 1 项 | 原主进程 71564 存活, 此前唯一窗口已不存在且无 page target, 列表空/hello 离线.  直接 Chrome executable 启动后返回 launched=true, UUID 不变、新 instanceId 与真实 hello 一致, 主 PID 不变且窗口恢复, 未执行包装入口 |
| 固定包装入口冷启动 1 项 | owner 精确停止旧进程树并保留目录后, 通过固定入口启动真实 CFT 18308.  固定三参数、实际 executable/userDataDir、真实 hello 身份相符; 首次 launched=true, 再次 false, 包装入口只执行一次 |

直接恢复的无窗口前提由关闭前唯一窗口、随后该 windowId 查无结果和无 page
target 联合证明.  当时未取得 Chrome API 的事后 windows.getAll 回调,
不声称该 API 返回空数组.  冷启动使用测试入口固定加载扩展, 不是单独启动
bridge 或伪造 hello; 未验证直接 Chrome executable 加持久安装扩展的冷启动.
冷启动恢复后实际为 1 窗口、3 个空白 tab, 如实保留 Chrome 自身恢复行为.
warm 恢复期间先前唯一业务副作用计数仍为 1.  首次 cold 测试入口失败后,
修复期间本机观察服务曾关闭; cold-retest 在同端口重建观察端点, 从原账本
载入计数 1.  本次真实 cold 启动期间没有 POST /once, 计数不变,
SDK trace 没有旧业务工具重发.  不声称观察服务跨轮次始终存活.

两条原始失败仍保留, 不由后续 PASS 覆盖:

- 首次第 22 组在关闭成功、hello 在线、原生清单仅剩非受管 blank 及
  tabs_context 为空之后, 辅助原生 Page.captureScreenshot 超时失败.
  后续关闭功能续验未重复该辅助截图, 不声称截图缺陷已修复.
- continuation 首次冷启动的测试包装入口因 `/var` 与 `/private/var` 路径
  别名字面比较不等而 exit 1, 尚未执行 Chrome.  MCP 正确返回
  PROFILE_LAUNCH_FAILED.  owner 仅修正测试入口路径规范化及诊断后另轮补验.

最终清理 PASS.  tester 自有 SDK/native/fixture/临时映射已清理,
owner 核验真实 hello 和启动信息并接管新 PID 18308 后, 按 release event
15321 完成清理.  回执 `owner-cleanup.json` 与 owner 原始
`../mie/.e2e-test/runs/profile-lifecycle-handoff-2026-10-01T18-51-21-869Z/cleanup.json`
由主线程逐项比对一致: pidAbsent/tempRootAbsent/stateAbsent 均为 true,
preservationErrors 为空、freshness 为 PASS.  主线程另检查本轮临时目录
`mie-e2e-U2qKX3` 已不存在.  `final-status.json` 保留功能 PASS、辅助截图
FAIL、清理 PASS 的分项结论, 本轮没有待清理资源.
