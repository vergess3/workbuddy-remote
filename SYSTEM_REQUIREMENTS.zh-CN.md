# 系统要求

[English version](./SYSTEM_REQUIREMENTS.md)

## 支持的环境

- 操作系统：Windows 10 或 Windows 11
- Shell：Windows PowerShell 5.1 或更高版本
- 运行时：Node.js 18 或更高版本
- 推荐运行时：Node.js 20 LTS 或更高版本
- 桌面应用：必须已安装 WorkBuddy Desktop

## 运行时发现要求

- `PATH` 中应可直接找到 `node.exe`
- 如果 `PATH` 中没有，启动器还会检查以下位置：
  - `C:\Program Files\nodejs\node.exe`
  - `C:\Program Files (x86)\nodejs\node.exe`

## WorkBuddy 要求

- 默认会从当前项目目录向上搜索 `WorkBuddy.exe`
- 也可以在 `workbuddy-remote.config.json` 中通过 `workbuddyExePath` 固定指定可执行文件路径
- bridge 默认使用 `%APPDATA%\WorkBuddy` 作为用户数据目录

## 文件系统权限

- 对 `%APPDATA%\WorkBuddy` 具有读写权限
- 对 `C:\Users\<当前用户>\WBWorkspaces` 具有读写权限，或者对 `workspaceRoots` 中列出的目录具有读写权限

## 默认端口

- CDP 端口：`9333`
- Bridge 端口：`8780`

## 说明

- 本项目不需要单独安装 `ws`，因为它会从 WorkBuddy 应用 bundle 中加载
