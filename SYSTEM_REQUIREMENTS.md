# System Requirements

## Supported Environment

- OS: Windows 10 or Windows 11
- Shell: Windows PowerShell 5.1 or newer
- Runtime: Node.js 18 or newer
- Recommended runtime: Node.js 20 LTS or newer
- Desktop app: WorkBuddy Desktop must be installed

## Required Runtime Discovery

- `node.exe` should be available in `PATH`
- If not in `PATH`, the launcher also checks:
  - `C:\Program Files\nodejs\node.exe`
  - `C:\Program Files (x86)\nodejs\node.exe`

## WorkBuddy Requirements

- By default, `WorkBuddy.exe` is discovered by searching upward from this project directory
- You can also pin the executable path in `workbuddy-remote.config.json` via `workbuddyExePath`
- The bridge uses `%APPDATA%\WorkBuddy` as the default user data directory

## Filesystem Permissions

- Read/write access to `%APPDATA%\WorkBuddy`
- Read/write access to `C:\Users\<current-user>\WBWorkspaces`, or to the paths listed in `workspaceRoots`

## Default Ports

- CDP port: `9333`
- Bridge port: `8780`

## Notes

- No separate `ws` installation is required here because it is loaded from the WorkBuddy app bundle
