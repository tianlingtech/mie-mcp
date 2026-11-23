## 1. zod v4 迁移

- [x] 1.1 `package.json` 依赖调整: `zod` 升到 `^4`, 移除 `zod-to-json-schema`; 确认与 `@modelcontextprotocol/sdk` 的兼容性
- [x] 1.2 tool schema 派生改用 v4 内置 `z.toJSONSchema` (`src/tool-registry.ts`)
- [x] 1.3 `src/protocol.ts` 在 v4 语义下重写校验: 未知字段仍 passthrough, 同时保留键互斥与错误载荷强校验必须真实生效 (v4 中 `z.unknown()` 的可选性与 v3 不同, 不能沿用 v3 的写法)
- [x] 1.4 验证未知字段前向兼容侧: hello 带未知字段 / 成功响应带未知字段 / 错误响应带未知字段 / 错误载荷内部带未知字段, 四条均正常工作
- [x] 1.5 验证畸形 error 拒绝侧: `error` 为 `{}` / 字符串 / `null` / `code` 为数字 / `code` 为空串 / 两个保留键同时存在 / 两个保留键都不存在, 七条均被拒绝
- [x] 1.6 确认工具列表中派生出的 input schema 与 zod 定义仍等价 (v4 输出结构与 v3 不同, 需人工确认一次并在测试中断言)

## 2. 握手超时与计时起点

- [x] 2.1 新增独立握手超时 (阈值可配置以便测试注入), 超时到点 destroy socket 而非仅 reject 握手 promise
- [x] 2.2 确认 destroy 后既有的连接关闭路径被触发, 重连逻辑能正常接管
- [x] 2.3 握手超时期间等待的请求以错误结束, 不各自空等到请求级兜底
- [x] 2.4 请求兜底计时起点改为"帧交付给 socket 之后" (不得推迟到写出确认回调 —— 该回调可能永不触发)
- [x] 2.5 交叉验证 2.1 与 2.4 一起消除了所有挂起路径.  注意握手完成后仍可能写不出去 (对端不再读取导致发送缓冲填满), 因此起表点不得依赖写出确认回调; 验收标准是"已握手但对端不再读取时, 多个并发请求全部能超时结算"
- [x] 2.6 测试: fake bridge 新增"接受连接但不发 hello"的能力; 覆盖握手超时、超时后新连接可恢复、握手耗时不挤占请求预算

## 3. 长驻进程健壮性

- [x] 3.1 `socket.on("data")` 边界加 try/catch, 异常降级为诊断
- [x] 3.2 诊断上报自身也要吞掉调用方回调 (`onDiagnostic`) 抛出的异常
- [x] 3.3 测试: 传入会抛异常的 `onDiagnostic`, 确认不产生 uncaughtException 且请求仍能正常结算
- [x] 3.4 行解码缓冲区加上限 (阈值高于最大截图 base64 单帧), 超限时放弃缓冲并记录诊断
- [x] 3.5 测试: 持续投喂无换行数据超过上限, 确认缓冲被放弃且进程正常

## 4. 校验失败帧按 id 结算

- [x] 4.1 schema 校验失败时, 尝试从原始帧中取出合法 `id`
- [x] 4.2 该 `id` 在等待表中时, 立即以携带校验详情的错误 (`TOOL_ERROR`) 结算, 不等兜底超时
- [x] 4.3 无法归属的非法帧 (无合法 `id` 或 `id` 不在等待表) 仍按丢弃处理, 不影响其他在途请求
- [x] 4.4 测试: 畸形响应帧带合法 `id` 时立即返回可诊断错误 (而非等待约 35 秒); 不可归属的非法帧仍被丢弃

## 5. 错误码语义

- [x] 5.1 工具入参校验失败改回 `NOT_SENT`
- [x] 5.2 协议版本不兼容改用 `NOT_SENT`, 错误信息中仍保留双方版本号
- [x] 5.3 错误归一化兜底路径 (`src/bridge-error.ts`) 改用 `NOT_SENT`
- [x] 5.4 确认没有新增任何错误码 (码空间跨仓库共享)
- [x] 5.5 补齐错误提示覆盖: v1 六个码全覆盖 + 未知码的通用提示 (`src/tool-registry.ts`)
- [x] 5.6 测试: 每个 v1 错误码都有相称提示且原始码可见; 未知码原样保留并附通用提示

## 6. 关停路径与写出确认时序

- [x] 6.1 `src/index.ts` 补关停路径: stdio transport 关闭时关闭 bridge client 并退出
- [x] 6.2 SIGINT / SIGTERM 上同样关闭 bridge client 并退出
- [x] 6.3 写出确认标记的时序加固: 关停发生在"写已 flush 但确认回调未执行"的窗口内时, 在途请求不得被标记为 `NOT_SENT`
- [x] 6.4 确认 6.1/6.2/6.3 同批落地 —— 只做关停不做时序加固会制造"报可安全重试实则可能已执行"的路径
- [x] 6.5 测试: 关停时已写出的在途请求以 `SENT_LINK_LOST` 结束

## 7. 诊断脱敏

- [x] 7.1 非法帧诊断不再回显原始帧文本, 改为长度 + 前缀哈希
- [x] 7.2 schema 校验失败的诊断不再回显校验错误详情原文 (按 id 结算时返回给调用方的错误信息可含必要说明, 但诊断日志不留原始内容)
- [x] 7.3 测试: 构造带可识别标记的畸形帧, 断言该标记不出现在诊断输出中

## 8. 工程收尾

- [x] 8.1 server 版本号改为与 `package.json` 单一来源 (`src/mcp-server.ts`)
- [x] 8.2 请求 id 前缀改为实例级 (`options.requestPrefix ?? randomUUID()`)
- [x] 8.3 入口模块改为仅在被直接执行时启动 server, 被 import 时无副作用 (`src/index.ts`)
- [x] 8.4 测试: 修改版本号后 server 声明随之变化; import 入口模块不启动 server
- [x] 8.5 `npm run typecheck` / `npm test` / `npm run build` 全部通过
- [x] 8.6 更新 `README.md` 中受本 change 影响的描述 (错误码语义、关停行为、协议 v1 摘要如有变化)

## 9. tool-defs 接入与 P0 tool 注册

- [x] 9.1 `package.json` 新增 `@mie/tool-defs` 的 `file:` 依赖, 指向 `../mie/packages/tool-defs`; 确认其 `peerDependency zod ^4.0.0` 与本仓库迁移后的 zod 版本一致
- [x] 9.2 新建一处薄适配层, 把共享包的 tool 定义映射成现有注册接口的 shape; 对共享包的依赖全部收敛在这一处 (日后换成版本化依赖时改动面最小)
- [x] 9.3 只 import `./schemas` 与常量 (`PROTOCOL_VERSION` / `TOOL_DEFS_VERSION` / `ERROR_CODES`); **不得** import `./protocol` 或用 `ErrorCodeSchema` 做校验闸
- [x] 9.4 注册 6 个 P0 tool: `tabs_context` / `tabs_create` / `tabs_close` / `navigate` / `computer` / `read_page`
- [x] 9.5 生产入口不再注册测试用 stub tool (stub 保留供测试使用)
- [x] 9.6 `computer` 的 union 输入: 实际确认派生出的 JSON Schema (`anyOf`) 对 MCP client 可用, 不能只看类型通过
- [x] 9.7 用共享包的 `ERROR_CODES` 生成已知码提示, 同时确认未知错误码仍原样透传未被收窄
- [x] 9.8 确认 MCP 层不把结果载荷里的 `obscured=true` 当作失败 (对端已知非阻塞项), 原样透传
- [x] 9.9 握手中拿到的 `tool_defs_version` 与共享包常量不一致时的处理: 本 change 只记录诊断, 不做拒绝 (对端尚在演进, 拒绝会造成不必要的阻塞)
- [x] 9.10 测试: 6 个 tool 全部出现在工具列表且 input schema 与共享包 zod 定义等价; 各 tool 的调用能正确转为 `tool_request` 帧

## 10. e2e 验收准备

- [x] 10.1 e2e 覆盖关停路径: stdin EOF 后 server 进程能自然退出, 不留常驻进程
- [x] 10.2 e2e 覆盖握手超时: bridge 接受连接但不发 hello 时能超时并在后续调用中恢复, 而非永久活锁
- [x] 10.3 e2e 覆盖按 id 结算: 畸形响应帧带合法 `id` 时立即返回可诊断错误, 不等约 35 秒
- [x] 10.4 e2e 覆盖 zod v4 迁移后的两侧矩阵 (未知字段前向兼容 + 畸形 error 拒绝)
- [x] 10.5 e2e 覆盖 P0 tool 调用链路: 用 fake bridge 扮演对端, 逐个 tool 走通 "MCP client 调用 → tool_request 帧 → payload 返回"
- [x] 10.6 e2e 覆盖 `obscured=true` 的结果不被判定为失败
- [x] 10.7 确认既有 e2e 场景 (核心链路 / bridge 未运行 / 版本不兼容 / 超时 / NOT_SENT 与 SENT_LINK_LOST 区分 / 重连 / 未知错误码透传) 在本 change 后仍全绿
