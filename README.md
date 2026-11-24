# mie-mcp

`mie-mcp` 让支持 MCP 的客户端操作本机 Chrome 中的标签页.  客户端通过 stdio 启动服务, 服务通过 Unix socket 连接本机 MIE bridge, 浏览器扩展在选定的 Chrome profile 中执行操作.  可以用它打开页面, 查找并操作元素, 截图, 或查看控制台和网络请求.

## 一行安装

准备 Node.js 20 或以上和 npm.  当仓库默认分支包含 `mcpsmgr.json`, 且所用 npm registry 提供 `@tianlingtech/mie-mcp@0.15.0` 时, 在目标项目目录执行以下命令, 按提示选择客户端:

```sh
npx -y mcpsmgr add tianlingtech/mie-mcp
```

清单支持 Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Antigravity, OpenClaw, Hermes Agent 和 Kimi Code.  客户端通过 `npx -y @tianlingtech/mie-mcp@0.15.0` 启动名为 `mie` 的 stdio 服务.  操作 Chrome 还需要本机 MIE bridge 和已启用的 MIE 扩展.

## 从源码构建

准备 Node.js 和 npm.  项目要求 Node.js 20 或以上, 本次构建验证使用 Node.js 25.1.0.  构建还需要 MIE 工作区中的共享包 `@mie/tool-defs`.  当前锁文件对应版本为 `0.31.0`.  该包提供运行时代码和 TypeScript 类型, 需要先用 MIE 工作区指定的 pnpm 10.21.0 构建.  两个项目按以下结构放置:

```text
workspace/
  mie/
    packages/tool-defs/
  mie-mcp/
    package.json
```

先取得包含上述版本的 MIE 工作区源码并放到 `workspace/mie`.  单独克隆本仓库不会取得共享包.  从 `workspace` 执行:

```sh
git clone https://github.com/tianlingtech/mie-mcp.git
cd mie
pnpm install --frozen-lockfile
pnpm --filter @mie/tool-defs build
cd ../mie-mcp
npm ci
npm run typecheck
npm run build
```

构建入口为 `dist/index.js`.  修改源码后重新运行 `npm run build`, 再重启客户端中的 MCP 服务.  执行 `npm test` 可运行使用临时 socket 和模拟 bridge 的测试.

## 接入 MCP 客户端

在支持 `mcpServers` 配置的客户端中添加以下条目, 将路径替换为实际构建产物的绝对路径.  客户端启动服务时需要能找到 `node`.

```json
{
  "mcpServers": {
    "mie": {
      "command": "node",
      "args": ["/absolute/path/to/mie-mcp/dist/index.js"]
    }
  }
}
```

加载配置后, 通过客户端的工具列表确认服务已启动.  要实际操作页面, 还需启动兼容的本机 MIE bridge 并在目标 Chrome profile 中启用 MIE 扩展.  首次使用可按以下顺序检查:

1. 调用 `profiles_list` 查看在线 profile 名称.
2. 调用 `tabs_context`, 在参数中指定目标 `profile`, 查看该实例中的标签页.
3. 使用返回的 `tabId` 调用 `get_page_text` 读取页面.  后续操作使用同一 profile, 省略时走 `default`.

工具列表由共享包生成, 实际可用的浏览器能力取决于 bridge 和扩展版本.  如果能列出工具但无法操作页面, 先核对 profile 是否在线.  自定义 default socket 可通过 `MIE_BRIDGE_SOCKET` 指定.  已发送请求若返回 `SENT_LINK_LOST`, 请先核对页面状态再重试, 以免重复提交.

## 工具与排障

- [多 profile 路由](docs/profile-routing.md) 和 [本机 profile 启动配置](docs/profile-launch.md)
- [浏览器工具行为](docs/tool-behavior.md) 和 [浏览器交互示例](docs/e2e-tools.md)
- [截图故障诊断](docs/screenshot-diagnostics.md) 和 [只读图形诊断](docs/graphics-diagnostics.md)
- [密码文件授权与使用边界](docs/password-file-input.md)
- [本地 bridge 协议与请求生命周期](docs/bridge-protocol.md) 和 [Codex 兼容排障](docs/codex-mcp-compatibility.md)

提交问题时请使用虚构页面和数据.  截图, 控制台输出和网络响应可能包含登录会话中的内容.  异常帧诊断仅输出受限元数据, 包括长度和指纹.

本仓库采用 [MIT 许可证](LICENSE).
