# 多 profile MCP 接口讨论

状态: 2026-09-25 初步研究记录.  接口已与 mie-main 确认并完成 MCP 实现,
最终接口见 [多 profile 路由](../docs/profile-routing.md).
本文保留设计讨论, 不替代最终接口说明.

现有实现与变更边界:

- `src/index.ts` 创建唯一 BridgeClient, `MIE_BRIDGE_SOCKET` 覆盖默认路径.
- BridgeClient 已负责惰性连接, 断线后的下次调用重连, 请求隔离及发送状态错误.
- ToolRegistry 先用 shared schema 校验, 再通过 BridgeRequester 转发.
- MCP 不接入 CDP.  bridge 为每个进程创建独立 relay, 将带 token 的 endpoint
  写入 socket 同目录的 `cdp.json`.
- 当前未提交的 0.15 密码输入变更必须保留.  本轮不修改 shared 文件,
  不创建或登录用户的实际 Chrome profile.

建议保持 BridgeClient 单连接职责, 新增实现 BridgeRequester 的路由层,
按 profile 身份缓存客户端.  不引入全局当前 profile, 不自动重放失败请求.

待冻结的协议:

1. profile 名称精确匹配, 省略时固定为 `default`.  名称格式和长度由 shared
   schema 统一定义.  稳定 UUID 不随改名变化, 名称不直接拼接文件路径.
2. bridge 分别持有独立目录与发现记录, 使用 shared 路径函数和记录 schema.
   目录按 UUID 隔离.  记录由 bridge 原子发布与清理, MCP 只读.
3. 明确定义记录与在线状态的关系.  不能仅凭 JSON 文件存在就认定在线;
   过期记录不能造成假在线或错误路由, 活跃同名身份必须明确报冲突.
4. hello 提供 profile UUID, 名称及必要的实例标识.  MCP 在发送工具请求前
   核对发现记录与握手身份.  bridge 也应核验请求的目标 profile, 防止握手后
   改名的竞态.  旧 hello 只允许在明确的旧单 default 兼容路径使用.
5. `profiles_list` 建议由 MCP 路由层聚合, shared 定义参数和结果结构.
   结果只提供调用所需身份及状态, 不返回 CDP token 或带 token 的 URL.
   列表不依赖 default 在线, 不自动选择其他 profile.
6. `MIE_BRIDGE_SOCKET` 建议只覆盖 default.  显式其他 profile 仍按发现记录
   路由, 不能都发往覆盖 socket.  需另行确认发现根目录覆盖及优先级,
   不假定任意自定义 socket 的父目录就是发现根目录.
7. 兼容现有 default 的 socket 与 CDP 接入路径, 其他 profile 使用独立
   `bridge.sock` 和 `cdp.json`.  MCP 不读取 CDP endpoint 文件.
8. shared 需明确 profile 不存在, 离线, 重名及身份不匹配的错误码.
   `NOT_SENT`, `SENT_LINK_LOST`, `TIMEOUT` 保留原有发送状态语义.

消费测试准备范围:

| 场景 | 预期 |
| --- | --- |
| 省略 profile, 另一个 profile 在线 | 只请求 default, 不 fallback |
| 两个 profile 使用相同 tabId 和 ref | 并发请求仅到各自 bridge |
| 显式覆盖 default socket | default 到覆盖地址, 其他名称不受覆盖 |
| default 离线, 其他在线 | 列表可用, default 调用明确失败 |
| 两个活跃 UUID 同名 | 报冲突, 不发送工具请求 |
| 残留记录, bridge 重启, profile 改名 | 重新发现并核验身份, 不使用过期映射 |
| 发现记录与 hello 身份不符 | 发送前拒绝, 不重试到其他 profile |
| 一条连接中断 | 不影响其他连接, 已发送请求不重放 |
| 关闭 MCP | 关闭全部缓存连接并正常退出 |
| 非法 profile 或损坏的发现记录 | schema 边界拒绝, 不误路由 |
| profile 参数与密码输入同时使用 | 参数准确路由, 保留无明文回显契约 |
| CDP 兼容 | default 旧接入可用, 各 profile endpoint 独立 |

可复用现有 FakeBridge 和 stdio McpHarness 执行路由消费测试.
真实多 profile 验收使用隔离 CFT 环境, 由主仓库验证 extension/bridge/CDP
链路; 协议冻结后再落实可执行测试, 避免预先固化猜测的字段.
