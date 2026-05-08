# WorkBuddy Remote New

> WorkBuddy now has an official WorkBuddy Remote / web WorkBuddy at <https://www.codebuddy.cn/agents>. If you want the fastest setup path, use the official WorkBuddy Remote first.
>
> This project is still useful when you prefer local or intranet deployment for data control, custom API settings, or a customizable UI and bridge layer.

This is the refactored WorkBuddy remote bridge. Because the official WorkBuddy frontend has been rebuilt, this project has moved away from the older heavy relay/native mirror approach and now serves the official WebUI directly from `resources/app.asar`, injects a lightweight browser `buddyAPI` shim, and forwards calls to the desktop WorkBuddy window through CDP.

Compared with the old version, the standalone light/native frontend, VS Code IPC mirror, dynamic MessagePort relay, and large window cleanup layer are gone. The browser loads the official WebUI resources, while this bridge only fills in the native capabilities that a normal browser does not have. That keeps the project smaller, shortens startup, and makes the page open much faster.

## Setup

```powershell
cd C:\Users\Public\workbuddy-remote-new
npm install
```

## Start Locally

Double-click:

```text
start-workbuddy-remote.vbs
```

It hides the PowerShell window, installs missing Node dependencies, starts WorkBuddy and the lightweight bridge, then opens the browser when ready.

Manual PowerShell start:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\start-workbuddy-remote.ps1 -ListenHost 127.0.0.1
```

Open:

```text
http://127.0.0.1:8780/agent-manager/
```

If the CDP port is already listening, the launcher reuses the existing WorkBuddy instance. Otherwise it starts WorkBuddy with `--remote-debugging-port`.

## LAN Access

```powershell
node .\tools\workbuddy-password-hash.mjs "your-password"
powershell -ExecutionPolicy Bypass -File .\tools\start-workbuddy-remote.ps1 -ListenHost 0.0.0.0 -PasswordHash "sha256:..."
```

Remote listening requires a password hash.

## Config

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

When `maskBridgeModelSecrets` is `true`, the bridge redacts model API address / Base URL and API Key values on the server before returning config data to the browser, and the page also masks those inputs visually.

When `hideWorkBuddyWindowAfterStart` is `true`, the bridge asks WorkBuddy to hide its desktop window after the CDP connection is ready. The WorkBuddy process and tray entry stay alive, so the browser page remains usable.

Refreshing the web page only recreates the browser WebSocket. It does not create a new WorkBuddy process, and socket cleanup releases event subscriptions for the closed page.
