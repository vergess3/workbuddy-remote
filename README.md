# WorkBuddy Remote Bridge

[English README](./README.en.md)

本项目可将 Windows 主机上运行的腾讯 `WorkBuddy` 暴露为可通过浏览器访问的 Web UI。你可以在任何地方通过电脑、平板、手机等设备直接用浏览器远程访问 WorkBuddy，无需预装任何额外应用。

## 功能特性

- 随时随地使用 WorkBuddy，只要有公网 IP、VPN、隧穿或其他可达方式，就能从浏览器远程访问
- 可在电脑、平板、手机等各种设备上直接使用，无需预装客户端
- 可让 WorkBuddy 24 小时运行在旧电脑或云服务器上，不因关掉日常办公电脑而中断
- 可将 WorkBuddy 运行在你拥有完整控制权的电脑或云服务器上，并与本地文件隔离，降低信息泄露与误删本地文件等失控风险
- 提供更 user friendly、更低门槛的文件管理方式，可直接使用 WorkBuddy-Remote 自带的文件管理界面，也可远程登录云服务器或直接操作电脑
- 降低工作电脑的资源开销，重复利用旧电脑或借用云服务器的算力
- 保留 WorkBuddy 本身的优势，例如接入腾讯生态、一键连接微信等能力

## 环境要求

完整环境检查清单见 [SYSTEM_REQUIREMENTS.zh-CN.md](./SYSTEM_REQUIREMENTS.zh-CN.md)。
英文版见 [SYSTEM_REQUIREMENTS.md](./SYSTEM_REQUIREMENTS.md)。

关键要求：

- Windows 10+ 或 Windows Server 2016+
- 已安装腾讯 WorkBuddy
- Node.js 18 或更高版本
- Windows PowerShell 5.1 或更高版本

## 快速开始

### 方式 1：双击启动

运行：

```text
start-workbuddy-remote.vbs
```

脚本会自动完成以下操作：

- 隐藏 PowerShell 窗口
- 自动启动 WorkBuddy 和 bridge
- 弹出就绪窗口，显示当前可访问地址，可直接点击或复制

### 方式 2：PowerShell 启动

```powershell
powershell -STA -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" 9337 8780
```

如需完全后台运行：

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" -CdpPort 9337 -BridgePort 8780 -Background
```

如果只想对当前这次启动强制弹出 `WorkBuddy Remote Ready` 窗口，可额外加上 `-ShowReadyWindow`。

然后在浏览器中打开：

```text
http://127.0.0.1:8780/agent-manager/
```

bridge 默认监听 `127.0.0.1`，因此默认只能从本机访问；只有在你显式修改监听地址后，其他设备才可访问。

## 配置文件

项目使用 [workbuddy-remote.config.json](./workbuddy-remote.config.json) 作为配置文件。

示例：

```json
{
  "workbuddyExePath": "C:\\Apps\\WorkBuddy\\WorkBuddy.exe",
  "cdpPort": 9333,
  "bridgePort": 8780,
  "listenHost": "127.0.0.1",
  "killWorkBuddyProcessesBeforeStart": false,
  "showReadyWindow": false,
  "workspaceRoots": [],
  "maskBridgeModelSecrets": false
}
```

字段说明：

- `workbuddyExePath`：可选，指定 `WorkBuddy.exe` 的绝对路径；留空时仍按原逻辑从当前项目目录向上搜索
- `cdpPort`：启动脚本默认使用的 CDP 端口
- `bridgePort`：bridge 默认监听端口
- `listenHost`：bridge 默认监听地址
- `killWorkBuddyProcessesBeforeStart`：启动前是否强制结束所有现有 `WorkBuddy` 进程；默认是 `false`
- `showReadyWindow`：启动完成后是否弹出 `WorkBuddy Remote Ready` 窗口；默认是 `false`
- `workspaceRoots`：可选，指定允许访问的工作区根目录列表；留空时默认使用 `C:\Users\<当前用户>\WBWorkspaces`
- `maskBridgeModelSecrets`：是否在 WorkBuddy-Remote 的浏览器页面内隐藏 API 地址和 API Key 输入框内容

命令行参数仍然保留，而且优先级高于配置文件。也就是说，`-CdpPort`、`-BridgePort`、`-ListenHost` 这些 flag 继续可用；只有你没传参数时，才会回退到 `workbuddy-remote.config.json` 里的默认值。

## 密码保护

如果你准备从其他设备访问，建议先配置密码哈希；如果要放通到公网，程序会强制要求配置密码。

生成密码哈希：

```powershell
node .\tools\workbuddy-password-hash.mjs "替换成你的密码"
```

输出示例：

```text
sha256:8b1f6b4f2bbf3b4938d31a92:7d53b0...
```

可直接通过参数传入：

```powershell
powershell -STA -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" `
  -CdpPort 9337 `
  -BridgePort 8780 `
  -PasswordHash "sha256:..."
```

或先在当前 shell 中设置环境变量：

```powershell
$env:WORKBUDDY_REMOTE_PASSWORD_HASH="sha256:..."
powershell -STA -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" -CdpPort 9337 -BridgePort 8780
```

或设置为当前用户的持久环境变量：

```powershell
[Environment]::SetEnvironmentVariable("WORKBUDDY_REMOTE_PASSWORD_HASH", "sha256:...", "User")
powershell -STA -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" -CdpPort 9337 -BridgePort 8780
```

配置密码后，浏览器必须先登录，才能访问 bridge UI、API 和 WebSocket。

## 远程访问建议

如需开放局域网访问，请显式绑定到 `0.0.0.0`，并同时启用密码保护。启动器会拒绝“非 localhost 监听但没有密码”的启动方式。

推荐的远程访问方案：

- 反向代理，例如 Caddy 或 Nginx
- VPN，例如 Tailscale 或 ZeroTier
- 隧道服务，例如 Cloudflare Tunnel

如果没有通过防火墙限制来源 IP，即使启用了内置密码保护，也不建议将程序直接暴露到公网。反向代理、VPN 或隧道服务能提供更稳妥的传输安全和访问控制。

## 工作区根目录配置

默认情况下，文件管理器使用 `C:\Users\<当前用户>\WBWorkspaces`。为了确保安全，文件管理器被设置为仅能操作工作区根目录下的文件。

如果你想限制为特定目录，可编辑 [workbuddy-remote.config.json](./workbuddy-remote.config.json)：

```json
{
  "workspaceRoots": [
    "C:\\Users\\alice\\WBWorkspaces",
    "D:\\Projects\\RemoteFiles"
  ]
}
```

请使用绝对 Windows 路径。

## 故障排查

### 无法从其他设备访问

默认监听地址是 `127.0.0.1`，所以只有本机可访问。如果要允许其他设备访问，请启动时加上 `-ListenHost 0.0.0.0`，或确保 `workbuddy-remote.config.json` 将 `listenHost` 设置成了 `0.0.0.0`，并确保已经设置 `WORKBUDDY_REMOTE_PASSWORD_HASH` 或 `-PasswordHash`。

### 提示 `node` 不是内部或外部命令

如果出现类似错误：

```text
'node' is not recognized as an internal or external command, operable program or batch file.
```

通常原因如下：

- 没有安装 Node.js
- Node.js 已安装，但 `node.exe` 不在 `PATH` 中
- Node.js 安装在非标准路径，当前机器无法自动找到

可以先执行：

```powershell
node -v
```

如果失败，请先修复 Node.js 运行环境。

### 启动后页面空白

先尝试强制刷新浏览器标签页；如果仍然无效，请重启实例。

## 主要入口文件

- `tools/workbuddy-start-main-window-bridge.ps1`
- `tools/workbuddy-agentmanager-bridge.mjs`
- `tools/workbuddy-password-hash.mjs`
- `tools/workbuddy-config.ps1`
- `start-workbuddy-remote.vbs`

## 项目结构

```text
src/
  bridge/      CDP 连接与运行时协调
  server/      HTTP 路由与 WebSocket bridge
  web/         页面注入与浏览器端 shim
  workspace/   工作区文件操作
  config.mjs   JSON 配置加载
  shared.mjs   共享常量与底层工具
tools/
  workbuddy-config.ps1
  workbuddy-start-main-window-bridge.ps1
  workbuddy-launch-cdp.ps1
  workbuddy-cdp-list-targets.mjs
  workbuddy-password-hash.mjs
```

## 许可证

本项目基于 MIT License 发布，详见 [LICENSE](./LICENSE)。
