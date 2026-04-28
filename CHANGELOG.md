# Changelog

## 2026-04-29

- Improved remote workspace file management, including workspace folder context selection and file transfer handling
- Added clearer upload progress reporting across the web UI and bridge server
- Streamed workspace file transfers to improve stability with larger uploads and downloads
- Limited high-volume bridge logs to reduce noise and runtime overhead
- Improved managed WorkBuddy window cleanup and bridge startup stability
- Kept the committed default bridge listen host on `127.0.0.1` for local-only access by default

## 2026-04-24

- Optimized memory management to significantly reduce memory usage
- Greatly improved web page loading speed
- Fixed silent disconnects when switching away from the app on mobile and then returning
- Fixed intermittent silent disconnects during first load on both desktop and mobile that could cause model loading, sending messages, and opening conversations to fail
- Fixed several known stability issues to improve the remote usage experience

## 更新说明

### 2026-04-29

- 改进远程工作区文件管理，包括工作区目录上下文选择和文件传输处理
- 优化网页端和 bridge server 的上传进度提示
- 工作区文件传输改为流式处理，提升大文件上传和下载稳定性
- 限制高频 bridge 日志输出，减少日志噪音和运行时开销
- 改进受管 WorkBuddy 窗口清理和 bridge 启动稳定性
- 提交到仓库的默认 bridge 监听地址保持为 `127.0.0.1`，默认仅允许本机访问

### 2026-04-24

- 优化内存管理，显著降低内存占用
- 大幅提升网页加载速度
- 修复手机切到其他 App 再切回后可能静默断连的问题
- 修复网页端和手机端首次加载时偶发静默断连，进而导致模型加载失败、发送消息失败、打开历史对话失败的问题
- 修复若干已知稳定性问题，提升远程使用体验
