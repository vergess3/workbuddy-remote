# WorkBuddy Remote New

这是瘦身后的 WorkBuddy 远程桥接项目。它只做三件事：

1. 从桌面版 WorkBuddy 的 `resources/app.asar` 读取原版 `renderer/index.html` 和静态资源。
2. 在网页里注入一个轻量 `buddyAPI` shim。
3. 通过一条浏览器 WebSocket 把 `buddyAPI` 调用转发到桌面 WorkBuddy 主窗口的 CDP 目标。

旧的 native 前端、VS Code IPC 镜像层、动态 MessagePort、窗口清理逻辑没有搬进来。

## 目录

- `src/asar.mjs`: 最小 ASAR 读取器。
- `src/bridge/runtime.mjs`: CDP 连接和 `buddyAPI` 转发。
- `src/server/bridge-server.mjs`: HTTP 静态资源服务和 `/bridge/ws`。
- `src/web/workbuddy-native.mjs`: 浏览器端 `buddyAPI` shim。
- `tools/start-workbuddy-remote.ps1`: Windows 启动脚本。
- `tools/workbuddy-password-hash.mjs`: 生成访问密码哈希。

## 安装

需要 Node.js 18+，并且本机已经安装桌面版 WorkBuddy。

```powershell
cd C:\Users\Public\workbuddy-remote-new
npm install
```

## 本机启动

双击根目录的：

```text
start-workbuddy-remote.vbs
```

它会隐藏 PowerShell 窗口，自动补装 Node 依赖，启动 WorkBuddy 和轻量 bridge，并在就绪后打开浏览器。

也可以手动用 PowerShell 启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-workbuddy-remote.ps1 -ListenHost 127.0.0.1
```

启动后访问：

```text
http://127.0.0.1:8780/agent-manager/
```

如果 `9333` CDP 端口已经有 WorkBuddy 在监听，启动脚本会复用现有 WorkBuddy；否则才会启动新的 WorkBuddy。

## 局域网访问

先生成密码哈希：

```powershell
node .\tools\workbuddy-password-hash.mjs "你的密码"
```

再启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-workbuddy-remote.ps1 -ListenHost 0.0.0.0 -PasswordHash "sha256:..."
```

非 localhost 监听必须设置 `-PasswordHash` 或环境变量 `WORKBUDDY_REMOTE_PASSWORD_HASH`。

## 配置

`workbuddy-remote.config.json`:

```json
{
  "workbuddyExePath": "",
  "workbuddyUserDataDir": "",
  "runtimeRootDir": "output/runtime",
  "cdpPort": 9333,
  "bridgePort": 8780,
  "listenHost": "127.0.0.1",
  "killWorkBuddyProcessesBeforeStart": false,
  "hideWorkBuddyWindowAfterStart": true,
  "maskBridgeModelSecrets": true
}
```

`workbuddyExePath` 留空时会自动查找常见安装路径。

`hideWorkBuddyWindowAfterStart` 设为 `true` 时，bridge 连接到 WorkBuddy 后会自动请求隐藏桌面窗口；WorkBuddy 进程和托盘仍保留，浏览器页面继续可用。

`maskBridgeModelSecrets` 设为 `true` 时，bridge 会先在服务端拦截模型配置读取结果，把接口地址 / Base URL 和 API Key 替换成占位值，再返回给浏览器；页面上也会继续把对应输入框显示为圆点。

## 进程和连接

刷新网页只会断开并重建浏览器到桥接服务的 WebSocket，不会创建新的 WorkBuddy 进程。浏览器 WebSocket 断开时，服务会释放该页面注册的事件订阅，避免刷新后订阅堆积。

桌面 WorkBuddy 仍然负责原生会话、任务、内存和账号状态。这个项目只做远程页面和调用转发，不再包含原来那套 C/native 内存管理代码。

## 检查

```powershell
npm run check
```
