# 本机文件到密码输入

`set_password_from_file` 的公开参数为 `tabId`, `backendNodeId`,
`filePath`, `expectedOrigin`, `expectedPathname`, 以及可选 `profile`.
省略 `profile` 时固定为 default, 显式名称将请求发往对应实例.
不接收 `value`,
`text`, `secret` 或 `frameId`.  MVP 仅支持顶层页面的 password 输入框.

MCP 只校验并转发文件引用, 不读取凭据文件, 不在模型参数中携带明文.
native bridge 负责安全读取与授权验证, 扩展在实际赋值时验证节点仍连接,
属于当前 document, 类型为 `INPUT/password`, 且 origin/pathname 精确匹配.
设置成功仅返回 `{ok:true, backendNodeId}`, 不返回值, 长度或哈希.

授权配置位于本机 `~/.config/mie/password-grants.json`:

```json
{
  "version": 1,
  "grants": [
    {
      "filePath": "/absolute/path/to/temporary-password.key",
      "expectedOrigin": "https://example.com",
      "expectedPathname": "/settings",
      "profile": "profile1"
    }
  ]
}
```

grant 的可选 `profile` 也精确绑定目标名称, 省略只授权 default.
命名 profile 必须具有相应的显式 grant.profile, 同源页面和相同文件路径
不能让另一个 profile 复用 default 授权.  改名后需重新核对授权名称.

配置与凭据文件均要求当前 uid 所有, 普通文件, 权限 0600, 拒绝符号链接.
父目录链须由当前 uid 或 root 所有, 且不可由 group/other 写入,
可信 owner 的 sticky 临时目录除外.  打开后核对 canonical path 与 dev/ino,
防止路径替换竞态.  此边界不防护能直接改写 grant 的同 uid 恶意进程.
凭据文件非空, 不超过 4096 bytes, 严格 UTF-8, 不含 NUL, 不隐式 trim.
bridge 每次请求重新验证 grant, 不使用长期缓存; 工具参数不能创建授权.
授权配置与真实文件路径不得提交源码.  任务完成后由持有授权的调用方撤销
该条 grant 并清理临时文件, 保留其他任务的授权.

固定错误码为 `INVALID_SECRET_SOURCE`, `SECRET_TARGET_MISMATCH`,
`SECRET_INPUT_FAILED`.  设置链路不能透传 OS/CDP/页面原始异常或凭据.
超时及断线仍保留 `NOT_SENT` / `SENT_LINK_LOST` 语义,
已发送后结果未知不等于未写入, 不自动重放.

保证范围仅限工具自身设置链路的 password-only 和 no-echo.
页面的 input/change 监听器可以读取新值并产生网络请求或 console 输出.
后续 AX, 截图, console, network, history 和 relay 不自动获得无凭据保证.
调用方必须确认受控页面的事件行为, 并约束填充期及后续敏感观测.
工具不点击提交, 也不代表页面脚本不会执行或联网.

联调开发只使用虚构凭据.  真实注入需等待目标部署就绪, 重新观察并提供
当前引用, 在实际赋值处核验目标, 不能以源码中的 input 类型替代运行时校验.

验收覆盖密码填充和授权清理.  工具返回操作结果, 页面后续查询仅返回掩码.
