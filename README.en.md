# WorkBuddy Remote Bridge

[中文说明](./README.md)

This project exposes Tencent `WorkBuddy` running on a Windows host as a browser-accessible web UI. You can remotely access WorkBuddy from anywhere on a desktop, tablet, or phone with just a browser, without preinstalling any extra app.

## Features

- Use WorkBuddy from anywhere through a browser as long as you have a reachable path such as a public IP, VPN, tunnel, or similar setup
- Access it directly from desktops, tablets, phones, and other devices without installing a dedicated client
- Keep WorkBuddy running 24/7 on an old PC or a cloud server so your work does not stop when you shut down your daily machine
- Run WorkBuddy on a machine or cloud server you fully control and isolate it from your local files to reduce information leakage and uncontrolled operations such as accidental file deletion
- Provide a more user-friendly and lower-barrier file management workflow through the built-in WorkBuddy-Remote file manager, remote login to the server, or direct operation on the host machine
- Reduce the resource load on your work computer by reusing an old PC or borrowing cloud compute
- Keep the built-in strengths of WorkBuddy itself, including Tencent ecosystem integration and one-click connection to WeChat

## Requirements

See [SYSTEM_REQUIREMENTS.md](./SYSTEM_REQUIREMENTS.md) for the full environment checklist.
Chinese version: [SYSTEM_REQUIREMENTS.zh-CN.md](./SYSTEM_REQUIREMENTS.zh-CN.md).

Key requirements:

- Windows 10+ or Windows Server 2016+
- Tencent WorkBuddy installed
- Node.js 18 or newer
- Windows PowerShell 5.1 or newer

## Quick Start

### Option 1: Double-click launch

Run:

```text
start-workbuddy-remote.vbs
```

What it does:

- Hides the PowerShell window
- Starts WorkBuddy and the bridge automatically
- Optionally opens a ready window with clickable and copyable access URLs for the current listen host when enabled in config

### Option 2: Launch from PowerShell

```powershell
powershell -STA -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" 9337 8780
```

Run without a visible PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" -CdpPort 9337 -BridgePort 8780 -Background
```

If you want to force the `WorkBuddy Remote Ready` popup for the current launch, add `-ShowReadyWindow`.

Then open:

```text
http://127.0.0.1:8780/agent-manager/
```

The bridge listens on `127.0.0.1` by default, so it is only reachable from the local machine unless you explicitly change the listen host.

## Config File

The project uses [workbuddy-remote.config.json](./workbuddy-remote.config.json) as its configuration file.

Example:

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

Field notes:

- `workbuddyExePath`: optional absolute path to `WorkBuddy.exe`; when empty, the launcher still searches upward from this project directory
- `cdpPort`: default CDP port for the launcher scripts
- `bridgePort`: default HTTP/WebSocket port for the bridge launcher
- `listenHost`: default bind host for the bridge launcher
- `killWorkBuddyProcessesBeforeStart`: whether to kill all existing `WorkBuddy` processes before launch; defaults to `false`
- `showReadyWindow`: whether to show the `WorkBuddy Remote Ready` popup after startup; defaults to `false`
- `workspaceRoots`: optional list of allowed workspace root folders; when empty, the default is `C:\Users\<current-user>\WBWorkspaces`
- `maskBridgeModelSecrets`: whether to hide the API address and API key inputs in the WorkBuddy-Remote browser page

Command-line flags still take precedence over the config file. For example, `-CdpPort`, `-BridgePort`, and `-ListenHost` continue to work exactly as before, but the config file is the default-value source when those flags are omitted.

## Password Protection

If you plan to access the bridge from another device, configure a password hash first; exposing it to the public internet will require a password.

Generate a password hash:

```powershell
node .\tools\workbuddy-password-hash.mjs "replace-with-your-password"
```

Example output:

```text
sha256:8b1f6b4f2bbf3b4938d31a92:7d53b0...
```

You can pass the hash directly:

```powershell
powershell -STA -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" `
  -CdpPort 9337 `
  -BridgePort 8780 `
  -PasswordHash "sha256:..."
```

Or set it once in the current shell:

```powershell
$env:WORKBUDDY_REMOTE_PASSWORD_HASH="sha256:..."
powershell -STA -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" -CdpPort 9337 -BridgePort 8780
```

Or set it as a persistent user environment variable:

```powershell
[Environment]::SetEnvironmentVariable("WORKBUDDY_REMOTE_PASSWORD_HASH", "sha256:...", "User")
powershell -STA -ExecutionPolicy Bypass -File ".\tools\workbuddy-start-main-window-bridge.ps1" -CdpPort 9337 -BridgePort 8780
```

When a password hash is configured, the browser must log in before the bridge UI, API routes, and WebSocket connection are available.

## Remote Access Guidance

To allow LAN access, explicitly bind the bridge to `0.0.0.0` and keep password protection enabled. The launcher refuses non-localhost binds unless a password hash is configured.

Recommended remote-access options:

- Reverse proxy such as Caddy or Nginx
- VPN such as Tailscale or ZeroTier
- Tunnel services such as Cloudflare Tunnel

If source IPs are not restricted by your firewall, it is still not recommended to expose the program directly to the public internet even when the built-in password gate is enabled. A reverse proxy, VPN, or tunnel gives you safer transport security and access control.

## Workspace Root Configuration

By default, the file manager uses `C:\Users\<current-user>\WBWorkspaces`. For safety, the file manager is restricted to files under the configured workspace root directories only.

If you want to limit the file manager to specific paths, edit [workbuddy-remote.config.json](./workbuddy-remote.config.json):

```json
{
  "workspaceRoots": [
    "C:\\Users\\alice\\WBWorkspaces",
    "D:\\Projects\\RemoteFiles"
  ]
}
```

Use absolute Windows paths.

## Troubleshooting

### I cannot reach the bridge from another device

By default the bridge binds to `127.0.0.1`, so only the local machine can open it. To allow remote devices, start it with `-ListenHost 0.0.0.0`, or make sure `listenHost` in `workbuddy-remote.config.json` is set to `0.0.0.0`, and configure `WORKBUDDY_REMOTE_PASSWORD_HASH` or `-PasswordHash`.

### `node` is not recognized

If you see an error similar to:

```text
'node' is not recognized as an internal or external command, operable program or batch file.
```

That usually means one of the following:

- Node.js is not installed
- Node.js is installed, but `node.exe` is not available in `PATH`
- Node.js is installed in a non-default location and the current machine cannot find it

Check it first with:

```powershell
node -v
```

If that fails, install or repair your Node.js environment first.

### Blank page after launch

Force-refresh the browser tab first. If that still does not help, restart the instance.

## Main Entry Points

- `tools/workbuddy-start-main-window-bridge.ps1`
- `tools/workbuddy-agentmanager-bridge.mjs`
- `tools/workbuddy-password-hash.mjs`
- `tools/workbuddy-config.ps1`
- `start-workbuddy-remote.vbs`

## Project Structure

```text
src/
  bridge/      CDP connection and runtime coordination
  server/      HTTP routing and WebSocket bridge
  web/         Page injection and browser-side shim
  workspace/   Workspace root file operations
  config.mjs   JSON config loading
  shared.mjs   Shared constants and low-level helpers
tools/
  workbuddy-config.ps1
  workbuddy-start-main-window-bridge.ps1
  workbuddy-launch-cdp.ps1
  workbuddy-cdp-list-targets.mjs
  workbuddy-password-hash.mjs
```

## License

This project is released under the MIT License. See [LICENSE](./LICENSE) for details.
