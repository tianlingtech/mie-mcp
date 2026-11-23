# 第三轮 request 独立 MCP 验收计划

状态: 准备完成, 等待 mcp-main 的 build 通知及 mie-tester 的专用实例正式交接.  尚未执行本轮功能测试.

实例协作已确认: mie-tester 在冻结后先执行自己的8组定向验收并清理, 再启动同一冻结构建的专用实例, 正式交接socket/TMPDIR/profile/protected tab IDs.  本方交接前不连接, 不并行启动共享factory.  本轮不需要profile note修改或重连.

需求依据: `../mie/docs/request-response-feedback.md`.  预期 shared 0.19.0, 仍为22个工具.  通过全新 SDK stdio MCP 进程连接专用 Chrome, 使用自建 localhost HTTP fixture 和另一个本地端口作为跨源重定向目标.  所有请求及副作用限一次性虚构数据, 不操作业务站点或用户 Chrome.

最终契约补充: 重定向是正常MCP工具成功结果, 不新增native ERROR_CODES.  解码payload.content中的JSON后断言code=REDIRECT_NOT_FOLLOWED、status=null、location=null、redirectFollowed=false、detailsUnavailable=opaque-redirect及实际method.  网络失败仍为TOOL_ERROR, message含REQUEST_FAILED或REQUEST_TIMEOUT并按GET/HEAD与写请求区分.  binary同样解码payload.content, 无body, 包含method和redactionScope=headers-only; binary-prefix-not-redacted.

| 用例组 | 操作与断言 | 证据 |
| --- | --- | --- |
| 构建及契约 | 保存实际 build hash、bridge 握手和 tools/list; 核对22工具、responseBodyFormat、prefixBytes和maxBytes边界 | build.json, tools.json, stderr.log |
| 默认文本兼容 | 默认模式读取文本; 默认非文本响应省略原始字节; 检查既有文本脱敏行为 | transcript.jsonl |
| 完整二进制 | 返回固定已知字节, maxBytes大于实际长度; bytesRead准确, EOF后sha256等于Node独立计算值, truncated=false, 无body, method和redactionScope符合最终契约 | binary-results.json |
| 默认及显式前缀 | 默认prefixBytes=0无原始字节; 显式0/1/256及超过实际体长, prefixHex与实际前缀一致且长度有界 | binary-results.json |
| 截断及恰好上限 | 长度分别小于、等于、大于maxBytes; 达上限即truncated=true且sha256=null, bytesRead不得越界 | binary-results.json |
| 空体及范围响应 | 空二进制响应和HEAD; 完整EOF摘要对应空字节; 206仅对实际响应范围计算hash | binary-results.json |
| 参数拒绝 | prefixBytes负数/257/小数、非binary时指定prefixBytes、非法格式、maxBytes零/50001; 显式报错且fixture无请求 | validation-results.json, fixture-requests.json |
| 同源及跨源重定向 | GET与授权POST返回manual redirect; MCP工具成功, content JSON包含最终契约全部诊断字段, 不伪造真实状态码/Location; 两个目标计数均为零, 原始请求一次 | redirects.json, fixture-requests.json |
| 读写网络失败 | GET/HEAD连接中断与超时有明确网络/超时提示; 授权POST提示可能已送达且不自动重试, 原始请求计数一次 | errors.json, fixture-requests.json |
| 慢流超时 | headers后延迟body及部分二进制流停顿, 有界失败; 不误报完整hash, 不自动重试 | errors.json, fixture-requests.json |
| 写入授权回归 | POST缺allowWrite显式拒绝且服务端零访问; 显式授权后仅发送一次 | validation-results.json, fixture-requests.json |

执行前复用上一轮 SDK harness 的连接、脱离图片base64的transcript记录和清理模式, 不重用旧socket.  按最终共享schema确认返回字段和错误结构, 不从实现代码复制hash逻辑作为断言.

前置门: 专用连接、创建tab、导航fixture、最小request逐项成功后才运行依赖组.  首个前置错误立即停止该组, 保存原始错误, 下游记BLOCKED而非重复制造FAIL; 参数校验等独立组可继续.  若正常用例首次暴露共用基础设施错误, 先回报并定位, 不连续重试或重复同一失败链路.

待正式交接后创建独立 `.e2e-test/runs/mcp-round3-<timestamp>/`, 保存原始请求/响应、独立hash、fixture请求计数、结果和清理证据.  历史第二轮结果保持不变.  本轮不重跑已验收的截图等无关增量.

资源归属: 只关闭自己创建且记录准确ID的tab, 关闭自己的SDK/HTTP服务, 通知mie-tester释放实例, 浏览器由其所有者清理.  不并发启动共享environment factory, 不全量测试或tmux探针, 不改产品代码, 不commit/push.
