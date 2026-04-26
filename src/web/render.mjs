import { AUTH_LOGIN_REQUEST, AUTH_SESSION_CHANNEL, AUTH_SESSION_REQUEST, PICK_FOLDER_REQUEST } from "../shared.mjs";

function renderAgentManagerHtml(assetVersion) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self' data: blob: http: https: ws:; script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; connect-src 'self' ws: http: https:; font-src 'self' data: blob: http: https:;"
    />
    <style>
      @media (hover: none) and (pointer: coarse) {
        input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="hidden"]),
        textarea,
        select,
        [contenteditable="true"],
        [role="textbox"] {
          font-size: 16px !important;
        }
      }
    </style>
    <link rel="stylesheet" href="/mirror/resources/app/out/codebuddy/main.css?v=${assetVersion}" />
    <title>WorkBuddy Agent Manager Bridge</title>
  </head>
  <body aria-label="">
    <script src="/bridge/vscode-shim.js?v=${assetVersion}"></script>
    <script src="/bridge/agentManager.patched.js?v=${assetVersion}" type="module"></script>
  </body>
</html>`;
}

function renderShimJs() {
  return `(() => {
  if (typeof globalThis.requestIdleCallback !== "function") {
    globalThis.requestIdleCallback = (callback, options = {}) => {
      const startedAt = Date.now();
      const timeout = Number.isFinite(options?.timeout) ? Math.max(0, options.timeout) : 1;
      return globalThis.setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining() {
            return Math.max(0, 50 - (Date.now() - startedAt));
          },
        });
      }, timeout);
    };
  }

  if (typeof globalThis.cancelIdleCallback !== "function") {
    globalThis.cancelIdleCallback = (handle) => {
      globalThis.clearTimeout(handle);
    };
  }

  const authSessionChannel = ${JSON.stringify(AUTH_SESSION_CHANNEL)};
  const authSessionRequest = ${JSON.stringify(AUTH_SESSION_REQUEST)};
  const listeners = new Map();
  const onceWrappers = new WeakMap();
  const pending = new Map();
  const pendingUploadProgress = new Map();
  const acquiredPorts = new Map();
  const livePorts = new Map();
  const pendingPortOpenByWindow = new Map();
  const activePortByWindow = new Map();
  const authSessionStorageKey = \`__workbuddy_bridge_auth_session__:\${location.host}\`;
  let requestId = 0;
  let socket;
  let runtimeConfig = {};
  let bridgeUiConfig = {};
  let authSessionCache = null;
  let hostConnected = true;
  let restartAvailable = true;
  let restartInProgress = false;
  let statusBanner;
  let pendingExternalWindow = null;
  let readyPromise;
  let reconnectTimer = null;
  let reconnectPromise = null;
  let reconnectAttempt = 0;
  let delayedBridgeStatusTimer = null;

  const makeEvent = () => ({ senderId: "workbuddy-web-bridge" });
  const messages = {
    zhCN: {
      chooseWorkspaceOnHost: "选择服务器端上的工作空间",
      chooseWorkspaceSubtitle:
        "先选可操作根目录，再从“工作空间”下拉菜单中选择文件夹；也可以在下拉菜单中直接新建文件夹。",
      drive: "根目录",
      selectDrive: "请选择根目录",
      autoWorkspaceRootHint:
        "选择后，将在这个根目录下管理工作空间。",
      workspace: "工作空间",
      selectWorkspace: "请选择工作空间",
      createFolder: "+ 新建文件夹...",
      searchWorkspaces: "搜索工作空间",
      searchWorkspacePlaceholder: "输入名字过滤列表",
      cancel: "取消",
      chooseThisFolder: "选择此文件夹",
      loadingWorkspaces: "正在加载工作空间...",
      selectDriveFirst: "请先选择一个根目录。",
      scanningWorkspaceRoot: "正在扫描根目录...",
      noWorkspaceOnDrive: "这个根目录下还没有工作空间。",
      noMatchingWorkspace: "没有匹配的工作空间。",
      currentRoot: "当前根目录：{path}",
      workspaceRootMissing: "未找到工作空间根目录。",
      failedLoadDriveContents: "加载根目录内容失败。",
      promptNewFolderName: "请输入新建文件夹名称",
      emptyNewFolderName: "新建文件夹名称不能为空。",
      failedCreateWorkspace: "创建工作空间失败。",
      fileManager: "文件管理",
      restartProgram: "重启程序",
      restartConfirmTitle: "确认重启当前程序",
      restartConfirmDescription:
        "这会关闭当前这个 WorkBuddy、当前 bridge，以及这次启动对应的命令行窗口，然后按相同参数重新拉起。",
      restartConfirmAction: "确认重启",
      restartConfirmWarning: "只会重启当前这一组实例，不会关闭其他 WorkBuddy 或其他命令行窗口。",
      restartStarting: "正在重启当前 WorkBuddy，稍后会自动重新连接...",
      restartTimeout: "重启已发起，但等待重新连接超时，请手动刷新页面确认。",
      fileDownload: "文件下载",
      chooseFolder: "选择文件夹",
      upload: "确认上传",
      attachFile: "添加文件",
      attachFileSubtitle: "选择当前工作空间里的文件并附加到当前输入框。",
      searchFiles: "搜索文件",
      searchFilesPlaceholder: "输入文件名过滤列表",
      close: "关闭",
      refresh: "刷新",
      skills: "技能",
      deleteConfirm: "确认删除",
      deleteWarning: "删除后将直接从服务器端的磁盘移除，且无法恢复。",
      fileManagerSubtitle: "只能操作服务器端允许的根目录里的文件",
      workspaceActionHint: "选中工作空间后，就可以上传文件或删除里面的文件。",
      uploadFiles: "上传文件",
      dropFilesHint: "拖拽文件到这里，或点击这里选择文件",
      noFilesSelected: "当前未选择文件。",
      selectWorkspaceFirst: "请先选择一个工作空间。",
      loadingFiles: "正在加载文件列表...",
      workspaceEmpty: "当前工作空间里还没有文件。",
      delete: "删除",
      deleteFileTitle: "确认删除文件",
      deleteFileDescription: "确定要永久删除文件“{name}”吗？删除后无法恢复。",
      failedDeleteFile: "删除文件失败。",
      download: "下载",
      selectedFilesSuffix: " 等 {count} 个文件",
      selectedFiles: "已选择：{names}{suffix}",
      selectedFilesHint:
        "已选择文件，点击这里可重新选择，或直接继续拖拽替换。",
      uploadProgress: "正在上传：{percent}% ({loaded} / {total})",
      currentWorkspace: "当前工作空间：{path}",
      noWorkspaceAvailable: "还没有可用的工作空间。",
      failedLoadWorkspaces: "加载工作空间失败。",
      autoSelectedWorkspace: "已自动选择当前工作空间：{path}",
      chooseFilesFirst: "请先选择要上传的文件。",
      currentFolderUnavailable: "未识别到当前工作空间。",
      failedLoadCurrentFolder: "加载当前文件夹失败。",
      noMatchingFile: "没有匹配的文件。",
      remoteAttachUnavailable: "当前输入框暂不支持添加文件。",
      hostDisconnected:
        "服务器端上的 WorkBuddy 当前未连接，页面使用的是缓存登录态。请先在服务器端打开 WorkBuddy，再刷新本页。",
      bootstrapUnavailable:
        "无法连接 bridge bootstrap，已退回本地缓存。请确认服务器端上的 WorkBuddy 和 bridge 正在运行。",
      hostConnectionClosed:
        "与服务器端上的 WorkBuddy 连接已断开。请在服务器端重新打开 WorkBuddy 后刷新本页。",
      hostConnectionFailed:
        "与服务器端上的 WorkBuddy 建立连接失败。请稍后刷新重试。",
      loginRedirectPending:
        "正在从服务器端获取登录地址，请稍候...",
      loginRedirectFailed:
        "无法获取登录地址。请检查服务器端 WorkBuddy 的网络连通性或登录服务配置后重试。",
      loginRedirectWindowTitle: "WorkBuddy 登录跳转",
    },
    en: {
      chooseWorkspaceOnHost: "Choose a workspace on the host",
      chooseWorkspaceSubtitle:
        "Select an allowed root first, then choose a folder from the Workspace list. You can also create a new folder directly from the dropdown.",
      drive: "Root",
      selectDrive: "Select a root",
      autoWorkspaceRootHint:
        "After you choose a root, workspaces will be managed inside it.",
      workspace: "Workspace",
      selectWorkspace: "Select a workspace",
      createFolder: "+ Create new folder...",
      searchWorkspaces: "Search workspaces",
      searchWorkspacePlaceholder: "Type a name to filter the list",
      cancel: "Cancel",
      chooseThisFolder: "Use this folder",
      loadingWorkspaces: "Loading workspaces...",
      selectDriveFirst: "Select a root first.",
      scanningWorkspaceRoot: "Scanning workspace root...",
      noWorkspaceOnDrive: "No workspace exists in this root yet.",
      noMatchingWorkspace: "No matching workspace was found.",
      currentRoot: "Current root: {path}",
      workspaceRootMissing: "Workspace root was not found.",
      failedLoadDriveContents: "Failed to load root contents.",
      promptNewFolderName: "Enter a name for the new folder",
      emptyNewFolderName: "The new folder name cannot be empty.",
      failedCreateWorkspace: "Failed to create the workspace.",
      fileManager: "File Manager",
      restartProgram: "Restart",
      restartConfirmTitle: "Restart current app",
      restartConfirmDescription:
        "This will close only the current WorkBuddy instance, the current bridge, and the command window tied to this launch, then start them again with the same parameters.",
      restartConfirmAction: "Restart",
      restartConfirmWarning:
        "Only this launch will be restarted. Other WorkBuddy instances and other command windows will not be closed.",
      restartStarting: "Restarting the current WorkBuddy instance. The page will reconnect automatically...",
      restartTimeout:
        "Restart was triggered, but reconnection timed out. Refresh the page manually to check the result.",
      fileDownload: "File Download",
      chooseFolder: "Choose Folder",
      upload: "Upload",
      attachFile: "Add File",
      attachFileSubtitle: "Choose a file from the current workspace and attach it to the current composer.",
      searchFiles: "Search files",
      searchFilesPlaceholder: "Type a file name to filter the list",
      close: "Close",
      refresh: "Refresh",
      skills: "Skills",
      deleteConfirm: "Delete",
      deleteWarning: "This will delete the file directly from the host machine and cannot be undone.",
      fileManagerSubtitle:
        "Only files inside the allowed workspace roots on the host machine can be managed here.",
      workspaceActionHint:
        "After you select a workspace, you can upload files or delete files inside it.",
      uploadFiles: "Upload files",
      dropFilesHint: "Drag files here, or click to choose files",
      noFilesSelected: "No files selected.",
      selectWorkspaceFirst: "Select a workspace first.",
      loadingFiles: "Loading files...",
      workspaceEmpty: "This workspace does not contain any files yet.",
      delete: "Delete",
      deleteFileTitle: "Delete file",
      deleteFileDescription:
        'Are you sure you want to permanently delete "{name}"? This action cannot be undone.',
      failedDeleteFile: "Failed to delete the file.",
      download: "Download",
      selectedFilesSuffix: ", {count} files total",
      selectedFiles: "Selected: {names}{suffix}",
      selectedFilesHint:
        "Files selected. Click here to choose again, or drag more files here to replace them.",
      uploadProgress: "Uploading: {percent}% ({loaded} / {total})",
      currentWorkspace: "Current workspace: {path}",
      noWorkspaceAvailable: "No workspace is available yet.",
      failedLoadWorkspaces: "Failed to load workspaces.",
      autoSelectedWorkspace: "Auto-selected current workspace: {path}",
      chooseFilesFirst: "Choose files to upload first.",
      currentFolderUnavailable: "The current workspace could not be detected.",
      failedLoadCurrentFolder: "Failed to load the current folder.",
      noMatchingFile: "No matching file was found.",
      remoteAttachUnavailable: "The current composer does not support file attachments.",
      hostDisconnected:
        "WorkBuddy on the host machine is currently offline. The page is using a cached sign-in state. Open WorkBuddy on the host and refresh this page.",
      bootstrapUnavailable:
        "Could not reach the bridge bootstrap endpoint, so cached local data is being used. Make sure WorkBuddy and the bridge are running on the host machine.",
      hostConnectionClosed:
        "The connection to WorkBuddy on the host machine was lost. Reopen WorkBuddy on the host and refresh this page.",
      hostConnectionFailed:
        "Failed to connect to WorkBuddy on the host machine. Refresh and try again.",
      loginRedirectPending:
        "Waiting for the host WorkBuddy instance to provide a sign-in URL...",
      loginRedirectFailed:
        "Could not get a sign-in URL. Check the host WorkBuddy network access or sign-in service configuration, then try again.",
      loginRedirectWindowTitle: "WorkBuddy Login Redirect",
    },
  };

  const getUiLanguage = () => {
    return /^en(?:[-_]|$)/i.test(String(runtimeConfig?.nls?.language || "").trim()) ? "en" : "zhCN";
  };

  const t = (key, values = {}) => {
    const template = messages[getUiLanguage()]?.[key] ?? messages.zhCN[key] ?? key;
    return String(template).replace(/\\{(\\w+)\\}/g, (_match, name) => values?.[name] ?? "");
  };

  const loadStoredAuthSession = () => {
    try {
      const raw = localStorage.getItem(authSessionStorageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const saveAuthSession = (value) => {
    authSessionCache = value ?? null;
    try {
      if (authSessionCache === null) {
        localStorage.removeItem(authSessionStorageKey);
      } else {
        localStorage.setItem(authSessionStorageKey, JSON.stringify(authSessionCache));
      }
    } catch {}
  };

  const ensureStatusBanner = () => {
    if (statusBanner) {
      return statusBanner;
    }

    statusBanner = document.createElement("div");
    statusBanner.style.cssText = [
      "position:fixed",
      "top:12px",
      "right:12px",
      "z-index:2147483647",
      "max-width:360px",
      "padding:10px 12px",
      "border-radius:10px",
      "font:12px/1.5 sans-serif",
      "color:#fff",
      "background:rgba(179, 66, 66, 0.92)",
      "box-shadow:0 8px 24px rgba(0,0,0,0.28)",
      "display:none",
    ].join(";");
    document.body.appendChild(statusBanner);
    return statusBanner;
  };

  const setBridgeStatus = (message) => {
    if (delayedBridgeStatusTimer) {
      globalThis.clearTimeout(delayedBridgeStatusTimer);
      delayedBridgeStatusTimer = null;
    }

    const banner = ensureStatusBanner();
    if (!message) {
      banner.style.display = "none";
      banner.textContent = "";
      return;
    }

    banner.textContent = message;
    banner.style.display = "block";
  };

  const setBridgeStatusWithDelay = (message, delayMs = 0) => {
    if (!message || delayMs <= 0) {
      setBridgeStatus(message);
      return;
    }

    if (delayedBridgeStatusTimer) {
      globalThis.clearTimeout(delayedBridgeStatusTimer);
    }

    delayedBridgeStatusTimer = globalThis.setTimeout(() => {
      delayedBridgeStatusTimer = null;
      setBridgeStatus(message);
    }, delayMs);
  };

  const sensitiveFieldLabels = {
    apiKey: ["API KEY", "APIKEY", "API KEY:"],
    endpoint: ["接口地址", "BASE URL", "ENDPOINT"],
  };

  const normalizeLabelText = (value) =>
    String(value || "")
      .replace(/\\s+/g, " ")
      .trim()
      .toUpperCase();

  const shouldMaskBridgeModelSecrets = () => bridgeUiConfig?.maskBridgeModelSecrets === true;

  const getFieldTypeFromLabel = (value) => {
    const normalized = normalizeLabelText(value);
    for (const [fieldType, labels] of Object.entries(sensitiveFieldLabels)) {
      if (labels.includes(normalized)) {
        return fieldType;
      }
    }
    return null;
  };

  const findFieldContainer = (labelElement) => {
    let current = labelElement;
    for (let depth = 0; current && depth < 6; depth += 1) {
      const parent = current.parentElement;
      if (!parent || parent === document.body) {
        break;
      }

      const inputCount = parent.querySelectorAll("input:not([type='hidden']), textarea").length;
      if (inputCount > 0) {
        return parent;
      }
      current = parent;
    }
    return null;
  };

  const hideFieldRevealControls = (fieldContainer) => {
    if (!fieldContainer) {
      return;
    }

    for (const button of fieldContainer.querySelectorAll("button")) {
      const label = normalizeLabelText(button.textContent);
      if (label) {
        continue;
      }
      if (button.dataset.wbSensitiveButtonMasked === "true") {
        continue;
      }
      button.dataset.wbSensitiveButtonMasked = "true";
      button.style.display = "none";
    }
  };

  const maskSensitiveInput = (input, fieldType) => {
    if (!input || input.dataset.wbSensitiveMasked === "true") {
      return;
    }

    input.dataset.wbSensitiveMasked = "true";
    input.dataset.wbSensitiveType = fieldType;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.style.webkitTextSecurity = "disc";
  };

  const maskSensitiveModelFields = () => {
    if (!shouldMaskBridgeModelSecrets()) {
      return;
    }

    const candidates = document.querySelectorAll("label, span, div, p");
    for (const element of candidates) {
      const fieldType = getFieldTypeFromLabel(element.textContent);
      if (!fieldType) {
        continue;
      }

      const fieldContainer = findFieldContainer(element);
      if (!fieldContainer) {
        continue;
      }

      const input = fieldContainer.querySelector("input:not([type='hidden']), textarea");
      if (!input) {
        continue;
      }

      maskSensitiveInput(input, fieldType);
      if (fieldType === "apiKey") {
        hideFieldRevealControls(fieldContainer);
      }
    }
  };

  const ensureChannel = (channel) => {
    if (!listeners.has(channel)) {
      listeners.set(channel, new Set());
    }
    return listeners.get(channel);
  };

  const emit = (channel, ...args) => {
    const handlers = listeners.get(channel);
    if (!handlers) {
      return;
    }

    for (const handler of [...handlers]) {
      try {
        handler(makeEvent(), ...args);
      } catch (error) {
        console.error("[bridge] listener failed", channel, error);
      }
    }
  };

  const encodePayload = (value) => {
    if (value instanceof ArrayBuffer) {
      const bytes = new Uint8Array(value);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      return { kind: "base64", base64: btoa(binary) };
    }

    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      return { kind: "base64", base64: btoa(binary) };
    }

    return { kind: "json", value };
  };

  const decodePayload = (payload) => {
    if (!payload || payload.kind === "json") {
      return payload ? payload.value : undefined;
    }

    if (payload.kind === "base64") {
      const binary = atob(payload.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    return undefined;
  };

  const sendRpc = (type, payload = {}) => {
    const id = ++requestId;
    const message = { id, type, ...payload };
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Bridge WebSocket is not connected"));
    }
    socket.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const withTimeout = (promise, timeoutMs, message) => {
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);

      Promise.resolve(promise)
        .then((value) => {
          globalThis.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          globalThis.clearTimeout(timer);
          reject(error);
        });
    });
  };

  const withBridgeUiRecovery = (runner, onRecover, options = {}) => {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000;
    const timeoutMessage = options.timeoutMessage || "Bridge request timed out";
    const recover = () => {
      try {
        onRecover?.();
      } catch (error) {
        console.warn("[bridge] UI recovery hook failed", error);
      }
    };

    const task = Promise.resolve().then(runner);
    const guardedTask = timeoutMs > 0 ? withTimeout(task, timeoutMs, timeoutMessage) : task;

    return guardedTask.catch((error) => {
      recover();
      throw error;
    });
  };

  const waitForActiveConnection = () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return readyPromise;
  };

  const cleanupPortState = (portId) => {
    if (!portId) {
      return;
    }

    const livePort = livePorts.get(portId);
    if (livePort) {
      try {
        livePort.close?.();
      } catch {}
      livePorts.delete(portId);
    }

    for (const [windowId, activePortId] of activePortByWindow.entries()) {
      if (activePortId === portId) {
        activePortByWindow.delete(windowId);
      }
    }

    for (const [windowId, entry] of pendingPortOpenByWindow.entries()) {
      if (entry?.portId === portId || entry?.nonce === portId) {
        pendingPortOpenByWindow.delete(windowId);
      }
    }
  };

  const resetDynamicPortState = () => {
    pendingPortOpenByWindow.clear();
    activePortByWindow.clear();

    for (const [portId] of livePorts.entries()) {
      cleanupPortState(portId);
    }

    acquiredPorts.clear();
  };

  const requestDynamicPortOpen = (windowId, nonce) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Bridge WebSocket is not connected");
    }

    if (!Number.isInteger(windowId) || windowId <= 0 || !nonce) {
      throw new Error("Invalid dynamic port request");
    }

    const activePortId = activePortByWindow.get(windowId);
    if (activePortId && livePorts.has(activePortId)) {
      return activePortId;
    }

    const pendingEntry = pendingPortOpenByWindow.get(windowId);
    if (pendingEntry) {
      return pendingEntry.portId;
    }

    const portId = nonce;
    acquiredPorts.set(nonce, {
      channel: "codebuddy:agentManagerChannelReady",
      windowId,
      portId,
    });
    pendingPortOpenByWindow.set(windowId, {
      nonce,
      portId,
      requestedAt: Date.now(),
    });

    socket.send(
      JSON.stringify({
        type: "open-dynamic-port",
        windowId,
        nonce,
        portId,
      })
    );

    return portId;
  };

  const scheduleReconnect = () => {
    if (restartInProgress) {
      return readyPromise;
    }

    if (reconnectPromise) {
      return reconnectPromise;
    }

    const delayMs = Math.min(1000 * Math.max(1, reconnectAttempt + 1), 5000);
    reconnectAttempt += 1;
    setBridgeStatusWithDelay(t("hostConnectionClosed"), 10000);

    reconnectPromise = new Promise((resolve) => {
      reconnectTimer = globalThis.setTimeout(resolve, delayMs);
    })
      .then(() => connect())
      .then(() => {
        reconnectTimer = null;
        reconnectPromise = null;
        reconnectAttempt = 0;
        restoreBridgeSubscriptions();
        setBridgeStatus("");
      })
      .catch((error) => {
        reconnectTimer = null;
        reconnectPromise = null;
        console.warn("[bridge] Reconnect attempt failed", error);
        return scheduleReconnect();
      });

    readyPromise = reconnectPromise;
    return reconnectPromise;
  };

  const probeConnectionOnResume = () => {
    if (restartInProgress) {
      return;
    }

    if (document.visibilityState === "hidden") {
      return;
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      return;
    }

    scheduleReconnect().catch((error) => {
      console.warn("[bridge] Resume probe reconnect failed", error);
    });
  };

  const restoreBridgeSubscriptions = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    for (const channel of listeners.keys()) {
      try {
        socket.send(JSON.stringify({ type: "subscribe", channel }));
      } catch (error) {
        console.warn("[bridge] Failed to restore subscription", channel, error);
      }
    }
  };

  const lastRootStorageKey = "workbuddy-bridge:last-root";
  const lastComposerFolderStorageKey = "workbuddy-bridge:last-composer-folder";

  const loadLastPickedRoot = () => {
    try {
      return localStorage.getItem(lastRootStorageKey) || "";
    } catch {
      return "";
    }
  };

  const saveLastPickedRoot = (rootPath) => {
    try {
      if (rootPath) {
        localStorage.setItem(lastRootStorageKey, rootPath);
      } else {
        localStorage.removeItem(lastRootStorageKey);
      }
    } catch {}
  };

  const saveLastPickedComposerFolder = (folderPath) => {
    try {
      if (folderPath) {
        localStorage.setItem(lastComposerFolderStorageKey, folderPath);
      } else {
        localStorage.removeItem(lastComposerFolderStorageKey);
      }
    } catch {}
  };

  const fetchWorkspaceRoots = async () => {
    const response = await fetch("/bridge/workspace-roots", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load workspace roots");
    }
    const payload = await response.json();
    return payload?.roots || [];
  };

  const fetchWorkspaceFolders = async (rootPath) => {
    const response = await fetch(
      \`/bridge/workspace-folders?rootPath=\${encodeURIComponent(rootPath)}\`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error("Failed to load workspace folders");
    }
    return response.json();
  };

  const createWorkspaceFolder = async (rootPath, name) => {
    const response = await fetch("/bridge/workspace-folders", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rootPath, name }),
    });
    if (!response.ok) {
      throw new Error("Failed to create workspace folder");
    }
    return response.json();
  };

  const deriveInitialRoot = (defaultPath, roots) => {
    const normalizedDefaultPath =
      typeof defaultPath === "string" ? defaultPath.trim().toLowerCase() : "";
    const matchedRoot = roots.find((entry) => {
      const rootPath = String(entry?.path || "").toLowerCase();
      return (
        normalizedDefaultPath &&
        (normalizedDefaultPath === rootPath ||
          normalizedDefaultPath.startsWith(rootPath.endsWith("\\\\") ? rootPath : rootPath + "\\\\"))
      );
    });
    if (matchedRoot?.path) {
      return matchedRoot.path;
    }

    const lastPickedRoot = loadLastPickedRoot();
    return roots.some((entry) => entry.path === lastPickedRoot) ? lastPickedRoot : "";
  };

  const promptForRemoteFolderPath = async (defaultPath) => {
    const roots = await fetchWorkspaceRoots();
    const initialRoot = deriveInitialRoot(defaultPath, roots);

    return new Promise((resolve, reject) => {
      let selectedRootPath = initialRoot;
      let selectedFolderPath = "";
      let workspaceRoot = "";
      let folders = [];
      let filteredFolders = [];
      let isLoading = false;

      const overlay = document.createElement("div");
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483646",
        "background:rgba(0,0,0,0.45)",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:24px",
      ].join(";");

      const panel = document.createElement("div");
      panel.style.cssText = [
        "width:min(860px, 100%)",
        "max-height:min(820px, calc(100vh - 48px))",
        "overflow:hidden",
        "border-radius:16px",
        "background:#151823",
        "color:#eef2ff",
        "box-shadow:0 20px 60px rgba(0,0,0,0.4)",
        "display:flex",
        "flex-direction:column",
        "font:14px/1.45 'Segoe UI', sans-serif",
      ].join(";");
      overlay.appendChild(panel);

      const title = document.createElement("div");
      title.textContent = t("chooseWorkspaceOnHost");
      title.style.cssText = "padding:20px 24px 8px;font-size:20px;font-weight:700;";
      panel.appendChild(title);

      const subtitle = document.createElement("div");
      subtitle.textContent = t("chooseWorkspaceSubtitle");
      subtitle.style.cssText = "padding:0 24px 16px;color:#9aa4c7;font-size:13px;";
      panel.appendChild(subtitle);

      const body = document.createElement("div");
      body.style.cssText =
        "padding:0 24px 20px;display:flex;flex-direction:column;gap:14px;overflow:auto;";
      panel.appendChild(body);

      const topRow = document.createElement("div");
      topRow.style.cssText =
        "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end;";
      body.appendChild(topRow);

      const rootField = document.createElement("label");
      rootField.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      topRow.appendChild(rootField);

      const rootLabel = document.createElement("span");
      rootLabel.textContent = t("drive");
      rootLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      rootField.appendChild(rootLabel);

      const rootSelect = document.createElement("select");
      rootSelect.style.cssText = [
        "height:40px",
        "border:1px solid #39415d",
        "border-radius:10px",
        "background:#0f1320",
        "color:#eef2ff",
        "padding:0 12px",
      ].join(";");
      rootField.appendChild(rootSelect);

      const rootPlaceholder = document.createElement("option");
      rootPlaceholder.value = "";
      rootPlaceholder.textContent = t("selectDrive");
      rootSelect.appendChild(rootPlaceholder);

      for (const rootEntry of roots) {
        const option = document.createElement("option");
        option.value = rootEntry.path;
        option.textContent = rootEntry.label || rootEntry.path;
        rootSelect.appendChild(option);
      }

      rootSelect.value = roots.some((entry) => entry.path === initialRoot) ? initialRoot : "";

      const workspaceField = document.createElement("label");
      workspaceField.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      topRow.appendChild(workspaceField);

      const workspaceLabel = document.createElement("span");
      workspaceLabel.textContent = t("workspace");
      workspaceLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      workspaceField.appendChild(workspaceLabel);

      const workspaceSelect = document.createElement("select");
      workspaceSelect.style.cssText = [
        "height:40px",
        "border:1px solid #39415d",
        "border-radius:10px",
        "background:#0f1320",
        "color:#eef2ff",
        "padding:0 12px",
      ].join(";");
      workspaceField.appendChild(workspaceSelect);

      const workspacePlaceholder = document.createElement("option");
      workspacePlaceholder.value = "";
      workspacePlaceholder.textContent = t("selectWorkspace");
      workspaceSelect.appendChild(workspacePlaceholder);

      const createWorkspaceOption = document.createElement("option");
      createWorkspaceOption.value = "__create_workspace__";
      createWorkspaceOption.textContent = t("createFolder");

      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.textContent = t("refresh");
      refreshButton.style.cssText =
        "height:40px;padding:0 16px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      topRow.appendChild(refreshButton);

      const workspaceHint = document.createElement("div");
      workspaceHint.style.cssText =
        "padding:10px 14px;border:1px solid #2c3350;border-radius:10px;background:#11162a;color:#9aa4c7;";
      workspaceHint.textContent = t("workspaceActionHint");
      body.appendChild(workspaceHint);

      const searchField = document.createElement("label");
      searchField.style.cssText = "display:flex;flex-direction:column;gap:6px;";
      body.appendChild(searchField);

      const searchLabel = document.createElement("span");
      searchLabel.textContent = t("searchWorkspaces");
      searchLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      searchField.appendChild(searchLabel);

      const searchInput = document.createElement("input");
      searchInput.type = "search";
      searchInput.placeholder = t("searchWorkspacePlaceholder");
      searchInput.style.cssText = [
        "height:40px",
        "border:1px solid #39415d",
        "border-radius:10px",
        "background:#0f1320",
        "color:#eef2ff",
        "padding:0 12px",
        "outline:none",
      ].join(";");
      searchField.appendChild(searchInput);

      const listWrapper = document.createElement("div");
      listWrapper.style.cssText = [
        "min-height:260px",
        "max-height:360px",
        "overflow:auto",
        "border:1px solid #2c3350",
        "border-radius:12px",
        "background:#0d1120",
        "padding:8px",
        "display:flex",
        "flex-direction:column",
        "gap:8px",
      ].join(";");
      body.appendChild(listWrapper);

      const emptyState = document.createElement("div");
      emptyState.style.cssText = "padding:36px 12px;text-align:center;color:#7d89b4;font-size:13px;";
      listWrapper.appendChild(emptyState);

      const footer = document.createElement("div");
      footer.style.cssText = [
        "padding:16px 24px 24px",
        "display:flex",
        "justify-content:flex-end",
        "gap:10px",
        "border-top:1px solid #232a42",
      ].join(";");
      panel.appendChild(footer);

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.textContent = t("cancel");
      cancelButton.style.cssText = [
        "height:40px",
        "padding:0 16px",
        "border:1px solid #39415d",
        "border-radius:10px",
        "background:#101528",
        "color:#d9e0ff",
        "cursor:pointer",
      ].join(";");
      footer.appendChild(cancelButton);

      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.textContent = t("chooseThisFolder");
      confirmButton.style.cssText = [
        "height:40px",
        "padding:0 16px",
        "border:none",
        "border-radius:10px",
        "background:#6ea8fe",
        "color:#09111f",
        "font-weight:700",
        "cursor:pointer",
      ].join(";");
      footer.appendChild(confirmButton);

      const cleanup = () => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
      };

      const finish = (result) => {
        cleanup();
        resolve(result);
      };

      const fail = (error) => {
        cleanup();
        reject(error);
      };

      const setBusy = (busy) => {
        isLoading = busy;
        rootSelect.disabled = busy;
        workspaceSelect.disabled = busy;
        searchInput.disabled = busy;
        refreshButton.disabled = busy;
        confirmButton.disabled = busy || !selectedFolderPath;
        cancelButton.disabled = busy;
      };

      const renderWorkspaceOptions = () => {
        workspaceSelect.replaceChildren();

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = isLoading ? t("loadingWorkspaces") : t("selectWorkspace");
        workspaceSelect.appendChild(placeholder);

        for (const entry of folders) {
          const option = document.createElement("option");
          option.value = entry.path;
          option.textContent = entry.name;
          workspaceSelect.appendChild(option);
        }

        workspaceSelect.appendChild(createWorkspaceOption);

        if (selectedFolderPath && folders.some((entry) => entry.path === selectedFolderPath)) {
          workspaceSelect.value = selectedFolderPath;
        } else {
          workspaceSelect.value = "";
        }
      };

      const applyFilter = () => {
        const keyword = searchInput.value.trim().toLowerCase();
        filteredFolders = keyword
          ? folders.filter((entry) => entry.name.toLowerCase().includes(keyword))
          : [...folders];

        listWrapper.replaceChildren();

        if (!selectedFolderPath || !folders.some((entry) => entry.path === selectedFolderPath)) {
          selectedFolderPath = filteredFolders[0]?.path || folders[0]?.path || "";
        }

        if (!selectedRootPath) {
          emptyState.textContent = t("selectDriveFirst");
          listWrapper.appendChild(emptyState);
        } else if (isLoading) {
          emptyState.textContent = t("scanningWorkspaceRoot");
          listWrapper.appendChild(emptyState);
        } else if (filteredFolders.length === 0) {
          emptyState.textContent =
            folders.length === 0 ? t("noWorkspaceOnDrive") : t("noMatchingWorkspace");
          listWrapper.appendChild(emptyState);
        } else {
          for (const entry of filteredFolders) {
            const item = document.createElement("button");
            item.type = "button";
            item.style.cssText = [
              "display:flex",
              "flex-direction:column",
              "align-items:flex-start",
              "gap:6px",
              "width:100%",
              "padding:12px 14px",
              "border:1px solid " + (entry.path === selectedFolderPath ? "#6ea8fe" : "#2b3453"),
              "border-radius:10px",
              "background:" + (entry.path === selectedFolderPath ? "#18253d" : "#12182b"),
              "color:#eef2ff",
              "cursor:pointer",
              "text-align:left",
            ].join(";");

            const name = document.createElement("span");
            name.textContent = entry.name;
            name.style.cssText = "display:block;font-weight:700;font-size:15px;line-height:1.35;";
            item.appendChild(name);

            const folderPath = document.createElement("span");
            folderPath.textContent = entry.path;
            folderPath.style.cssText = "display:block;font-size:12px;line-height:1.45;color:#9aa4c7;word-break:break-all;";
            item.appendChild(folderPath);

            item.addEventListener("click", () => {
              selectedFolderPath = entry.path;
              renderWorkspaceOptions();
              applyFilter();
            });

            item.addEventListener("dblclick", () => {
              saveLastPickedRoot(selectedRootPath);
              finish([entry.path]);
            });

            listWrapper.appendChild(item);
          }
        }

        confirmButton.disabled = isLoading || !selectedFolderPath;
        workspaceHint.textContent = selectedFolderPath
          ? t("currentWorkspace", { path: selectedFolderPath })
          : selectedRootPath
            ? t("noWorkspaceAvailable")
            : t("workspaceActionHint");
      };

      const loadRootFolders = async (rootPath, preferredFolderPath = "") => {
        selectedRootPath = rootPath;
        selectedFolderPath = "";
        searchInput.value = "";

        if (!rootPath) {
          workspaceRoot = "";
          folders = [];
          renderWorkspaceOptions();
          workspaceHint.textContent = t("workspaceActionHint");
          applyFilter();
          return;
        }

        saveLastPickedRoot(rootPath);
        setBusy(true);
        folders = [];
        renderWorkspaceOptions();
        applyFilter();

        try {
          const payload = await withBridgeUiRecovery(
            () => fetchWorkspaceFolders(rootPath),
            () => {
              setBusy(false);
              renderWorkspaceOptions();
              applyFilter();
            },
            {
              timeoutMs: 20000,
              timeoutMessage: "Loading workspace folders timed out",
            }
          );
          workspaceRoot = payload?.workspaceRoot || "";
          folders = payload?.folders || [];
          selectedFolderPath =
            preferredFolderPath && folders.some((entry) => entry.path === preferredFolderPath)
              ? preferredFolderPath
              : folders[0]?.path || "";
          workspaceHint.textContent = selectedFolderPath
            ? t("currentWorkspace", { path: selectedFolderPath })
            : workspaceRoot
              ? t("noWorkspaceAvailable")
              : t("workspaceRootMissing");
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
          folders = [];
          workspaceRoot = "";
          workspaceHint.textContent = t("failedLoadDriveContents");
        } finally {
          setBusy(false);
          renderWorkspaceOptions();
          applyFilter();
        }
      };

      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(undefined);
        }
      };

      rootSelect.addEventListener("change", () => {
        loadRootFolders(rootSelect.value).catch(fail);
      });

      workspaceSelect.addEventListener("change", async () => {
        if (workspaceSelect.value === "__create_workspace__") {
          if (!selectedRootPath) {
            window.alert(t("selectDriveFirst"));
            renderWorkspaceOptions();
            return;
          }

          const folderName = window.prompt(t("promptNewFolderName"), "");
          if (folderName === null) {
            renderWorkspaceOptions();
            return;
          }

          const trimmedName = folderName.trim();
          if (!trimmedName) {
            window.alert(t("emptyNewFolderName"));
            renderWorkspaceOptions();
            return;
          }

          setBusy(true);
          try {
            const result = await withBridgeUiRecovery(
              () => createWorkspaceFolder(selectedRootPath, trimmedName),
              () => {
                setBusy(false);
                renderWorkspaceOptions();
                applyFilter();
              },
              {
                timeoutMs: 20000,
                timeoutMessage: "Creating workspace timed out",
              }
            );
            if (!result?.ok || !result.path) {
              window.alert(result?.error || t("failedCreateWorkspace"));
              renderWorkspaceOptions();
              return;
            }

            await loadRootFolders(selectedRootPath);
            selectedFolderPath = result.path;
            renderWorkspaceOptions();
            applyFilter();
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(false);
            renderWorkspaceOptions();
            applyFilter();
          }
          return;
        }

        selectedFolderPath = workspaceSelect.value;
        applyFilter();
      });

      refreshButton.addEventListener("click", () => {
        loadRootFolders(rootSelect.value, selectedFolderPath).catch(fail);
      });

      searchInput.addEventListener("input", () => {
        applyFilter();
      });

      cancelButton.addEventListener("click", () => finish(undefined));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          finish(undefined);
        }
      });
      confirmButton.addEventListener("click", () => {
        if (!selectedFolderPath) {
          return;
        }
        saveLastPickedRoot(selectedRootPath);
        finish([selectedFolderPath]);
      });

      document.addEventListener("keydown", onKeyDown, true);
      document.body.appendChild(overlay);

      setBusy(false);
      renderWorkspaceOptions();
      applyFilter();
      loadRootFolders(rootSelect.value).catch(fail);
    });
  };

  const fetchWorkspaceFiles = async (folderPath) => {
    const response = await fetch(
      "/bridge/workspace-files?folderPath=" + encodeURIComponent(folderPath),
      { cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error("Failed to load workspace files");
    }
    return response.json();
  };

  const uploadWorkspaceFile = (folderPath, file, onProgress) => {
    return new Promise((resolve, reject) => {
      const uploadId = crypto.randomUUID();
      const params = new URLSearchParams({
        folderPath,
        fileName: file.name,
        uploadId,
      });
      const request = new XMLHttpRequest();
      pendingUploadProgress.set(uploadId, (message) => {
        onProgress?.(Math.min(file.size, Number(message.loadedBytes) || 0));
      });
      const cleanup = () => pendingUploadProgress.delete(uploadId);
      request.open("POST", "/bridge/workspace-files?" + params.toString());
      request.responseType = "json";
      request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      request.onload = () => {
        cleanup();
        if (request.status < 200 || request.status >= 300) {
          reject(new Error("Failed to upload file"));
          return;
        }

        const result = request.response;
        if (!result?.ok) {
          reject(new Error(result?.error || "Upload failed"));
          return;
        }
        onProgress?.(file.size);
        resolve(result);
      };
      request.onerror = () => {
        cleanup();
        reject(new Error("Failed to upload file"));
      };
      request.send(file);
    });
  };

  const uploadWorkspaceFiles = async (folderPath, files, onProgress) => {
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let completedBytes = 0;
    for (const file of files) {
      await uploadWorkspaceFile(folderPath, file, (loadedBytes) => {
        onProgress?.({
          loadedBytes: completedBytes + loadedBytes,
          totalBytes,
        });
      });
      completedBytes += file.size;
    }
  };

  const deleteWorkspaceEntryRequest = async (targetPath) => {
    const response = await fetch("/bridge/workspace-files", {
      method: "DELETE",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetPath,
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to delete workspace entry");
    }
    return response.json();
  };

  const buildWorkspaceDownloadUrl = (targetPath) =>
    "/bridge/workspace-download?targetPath=" + encodeURIComponent(targetPath);

  const fetchWorkspaceFileBlob = async (targetPath) => {
    const response = await fetch(buildWorkspaceDownloadUrl(targetPath), {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Failed to download workspace file");
    }
    return response.blob();
  };

  const normalizeTaskTitle = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .replace(
        /\s*(just now|\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago|刚刚|\d+\s*(秒|分钟|小时|天|周|月|年)前)\s*$/iu,
        ""
      )
      .trim()
      .toLowerCase();

  const isElementVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 12) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number.parseFloat(style.opacity || "1") > 0 &&
      rect.bottom > 0 &&
      rect.right > 0
    );
  };

  const extractCurrentTaskTitle = () => {
    const blacklist = new Set([
      "WorkBuddy",
      "文件管理",
      "文件下载",
      "选择文件夹",
      "确认上传",
      "关闭",
      "刷新",
      "技能",
      "File Manager",
      "File Download",
      "Choose Folder",
      "Upload",
      "Close",
      "Refresh",
      "Skills",
      "Craft",
      "Claw",
    ]);

    const candidates = [];
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      if (!(element instanceof HTMLElement) || !isElementVisible(element)) {
        continue;
      }

      const text = element.innerText?.trim();
      if (!text || text.length > 80 || blacklist.has(text)) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.left < 320 || rect.top > 180) {
        continue;
      }

      if (/Claw Your Ideas Into Reality|Triggered Anywhere|Completed Locally/u.test(text)) {
        continue;
      }

      if (/编辑\(E\)|帮助\(H\)|Edit\(E\)|Help\(H\)|Window/u.test(text)) {
        continue;
      }

      const style = window.getComputedStyle(element);
      const fontWeight = Number.parseInt(style.fontWeight || "400", 10) || 400;
      const hasTitleClass = /title|header|name/u.test(element.className || "");
      const tagBonus = /^H[1-6]$/u.test(element.tagName) ? 20 : 0;
      const weightBonus = fontWeight >= 600 ? 20 : 0;
      const classBonus = hasTitleClass ? 10 : 0;
      const yBonus = Math.max(0, 140 - rect.top) / 10;
      candidates.push({
        text,
        score: tagBonus + weightBonus + classBonus + yBonus,
      });
    }

    candidates.sort((left, right) => right.score - left.score || left.text.length - right.text.length);
    return candidates[0]?.text || "";
  };

  const extractConversationCardTitle = (container, workspaceName = "") => {
    const blockedTexts = new Set(["Pin", "Rename", "Archive", workspaceName]);
    const candidates = Array.from(
      container.querySelectorAll("[class*='title'], span, div")
    )
      .map((element) => String(element.textContent || "").trim())
      .filter((text) => {
        if (!text || text.length > 80 || blockedTexts.has(text)) {
          return false;
        }
        return !/(just now|\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago|刚刚|\d+\s*(秒|分钟|小时|天|周|月|年)前)$/iu.test(
          text
        );
      });

    candidates.sort((left, right) => right.length - left.length);
    return candidates[0] || "";
  };

  const detectCurrentWorkspaceContext = () => {
    const workspaceSections = Array.from(
      document.querySelectorAll(".workspace-drag-item, .collapsible-section")
    );

    for (const section of workspaceSections) {
      if (!(section instanceof HTMLElement)) {
        continue;
      }

      const workspaceName =
        section
          .querySelector(
            ".collapsible-section-label, .collapsible-section-title, [class*='collapsible-section-label'], [class*='_title_4140i_41']"
          )
          ?.textContent?.trim() || "";
      if (!workspaceName) {
        continue;
      }

      const activeCard = Array.from(
        section.querySelectorAll(".conversation-agent-card, button")
      ).find((element) => element.querySelector?.(".agent-card-rename-button"));

      if (!activeCard) {
        continue;
      }

      const taskTitle = extractConversationCardTitle(activeCard, workspaceName);
      if (taskTitle) {
        return {
          taskTitle,
          workspaceName,
          distance: 0,
        };
      }
    }

    const taskTitle = extractCurrentTaskTitle();
    const normalizedTitle = normalizeTaskTitle(taskTitle);
    if (!normalizedTitle) {
      return null;
    }

    const matches = [];

    for (const section of workspaceSections) {
      if (!(section instanceof HTMLElement)) {
        continue;
      }

      const workspaceName =
        section
          .querySelector(
            ".collapsible-section-label, .collapsible-section-title, [class*='collapsible-section-label'], [class*='_title_4140i_41']"
          )
          ?.textContent?.trim() || "";
      if (!workspaceName) {
        continue;
      }

      const cardTitles = Array.from(
        section.querySelectorAll(".conversation-agent-card [class*='title'], .conversation-agent-card span")
      )
        .map((element) => normalizeTaskTitle(element.textContent))
        .filter(Boolean);

      if (cardTitles.includes(normalizedTitle)) {
        const rect = section.getBoundingClientRect();
        matches.push({
          taskTitle,
          workspaceName,
          distance: Math.abs(rect.top - 260),
        });
      }
    }

    matches.sort((left, right) => left.distance - right.distance);
    return matches[0] || null;
  };

  const findWorkspaceFolderByName = async (workspaceName, roots) => {
    const normalizedName = String(workspaceName || "").trim().toLowerCase();
    if (!normalizedName) {
      return null;
    }

    for (const rootEntry of roots || []) {
      const payload = await fetchWorkspaceFolders(rootEntry.path);
      const matchedFolder = (payload?.folders || []).find(
        (entry) => String(entry.name || "").trim().toLowerCase() === normalizedName
      );
      if (matchedFolder) {
        return {
          rootPath: rootEntry.path,
          folder: matchedFolder,
        };
      }
    }

    return null;
  };

  const normalizeComparablePath = (value) =>
    typeof value === "string" && /^[A-Za-z]:[\\/]/.test(value.trim())
      ? value.trim().replace(/\\//g, "\\\\").replace(/[\\\\]+$/g, "").toLowerCase()
      : "";

  const isSameOrChildPath = (parentPath, childPath) => {
    const parent = normalizeComparablePath(parentPath);
    const child = normalizeComparablePath(childPath);
    return Boolean(parent && child && (child === parent || child.startsWith(parent + "\\\\")));
  };

  const getRuntimeWorkspacePathCandidates = () => {
    const workspace = runtimeConfig?.workspace || {};
    const workspaceFolder = runtimeConfig?.workspaceFolder || {};
    const workspaceFolders = Array.isArray(runtimeConfig?.workspaceFolders)
      ? runtimeConfig.workspaceFolders
      : [];
    return [
      runtimeConfig?.cwd,
      runtimeConfig?.workspacePath,
      runtimeConfig?.workspaceFolder,
      runtimeConfig?.currentWorkspacePath,
      runtimeConfig?.currentWorkingDirectory,
      runtimeConfig?.projectPath,
      workspace?.path,
      workspace?.cwd,
      workspace?.workspacePath,
      workspace?.workspaceFolder,
      workspaceFolder?.path,
      workspaceFolder?.fsPath,
      workspaceFolders[0]?.path,
      workspaceFolders[0]?.fsPath,
    ].filter((value, index, values) => typeof value === "string" && value && values.indexOf(value) === index);
  };

  const findWorkspaceFolderByPath = async (targetPath, roots) => {
    const rootEntry = (roots || []).find((entry) => isSameOrChildPath(entry.path, targetPath));
    if (!rootEntry) {
      return null;
    }

    const payload = await fetchWorkspaceFolders(rootEntry.path);
    const matchedFolder = (payload?.folders || [])
      .filter((entry) => isSameOrChildPath(entry.path, targetPath))
      .sort((left, right) => String(right.path || "").length - String(left.path || "").length)[0];
    return matchedFolder
      ? {
          rootPath: rootEntry.path,
          folder: matchedFolder,
        }
      : null;
  };

  const resolveAutoSelectedWorkspace = async (detectedContext, roots) => {
    for (const candidatePath of getRuntimeWorkspacePathCandidates()) {
      const matchedByPath = await findWorkspaceFolderByPath(candidatePath, roots);
      if (matchedByPath) {
        return {
          rootPath: matchedByPath.rootPath,
          preferredFolderPath: matchedByPath.folder.path,
          matched: matchedByPath,
        };
      }
    }

    const matchedByName = detectedContext?.workspaceName
      ? await findWorkspaceFolderByName(detectedContext.workspaceName, roots)
      : null;
    return matchedByName
      ? {
          rootPath: matchedByName.rootPath,
          preferredFolderPath: matchedByName.folder.path,
          matched: matchedByName,
        }
      : {
          rootPath: "",
          preferredFolderPath: "",
          matched: null,
        };
  };

  const triggerWorkspaceDownload = (entry) => {
    const anchor = document.createElement("a");
    anchor.href = buildWorkspaceDownloadUrl(entry.path);
    anchor.download = entry.name || "";
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const formatFileSize = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "-";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return (value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)) + " " + units[unitIndex];
  };

  const createUploadProgressControl = () => {
    const element = document.createElement("div");
    element.style.cssText = "display:none;gap:6px;flex-direction:column;";

    const text = document.createElement("div");
    text.style.cssText = "font-size:12px;color:#9aa4c7;";
    element.appendChild(text);

    const track = document.createElement("div");
    track.style.cssText = "height:6px;border-radius:999px;background:#202842;overflow:hidden;";
    element.appendChild(track);

    const bar = document.createElement("div");
    bar.style.cssText = "height:100%;width:0%;background:#31c48d;";
    track.appendChild(bar);

    return {
      element,
      set(progress) {
        if (!progress || !progress.totalBytes) {
          element.style.display = "none";
          bar.style.width = "0%";
          return;
        }

        const percent = Math.min(
          100,
          Math.max(0, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
        );
        element.style.display = "flex";
        text.textContent = t("uploadProgress", {
          percent,
          loaded: formatFileSize(progress.loadedBytes),
          total: formatFileSize(progress.totalBytes),
        });
        bar.style.width = percent + "%";
      },
    };
  };

  const findActiveComposerEditor = () => {
    if (document.activeElement instanceof HTMLElement) {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLTextAreaElement ||
        activeElement.isContentEditable ||
        activeElement.getAttribute("role") === "textbox"
      ) {
        return activeElement;
      }
    }

    const visibleEditors = Array.from(
      document.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']")
    ).filter(isElementVisible);
    return visibleEditors.at(-1) || null;
  };

  const markRemoteInlineFile = (file, sourcePath) => {
    Object.defineProperty(file, "__WB_REMOTE_INLINE_FILE__", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(file, "__WB_REMOTE_SOURCE_PATH__", {
      value: sourcePath,
      configurable: true,
    });
    return file;
  };

  const attachFilesToComposer = async (files) => {
    const remoteSourcePaths = files
      .map((file) =>
        file?.__WB_REMOTE_INLINE_FILE__ && typeof file.__WB_REMOTE_SOURCE_PATH__ === "string"
          ? file.__WB_REMOTE_SOURCE_PATH__
          : ""
      )
      .filter(Boolean);

    if (
      remoteSourcePaths.length === files.length &&
      typeof globalThis.__WB_REMOTE_ATTACH_LOCAL_FILE__ === "function"
    ) {
      const timestamp = Date.now();
      const results = [];
      for (const sourcePath of remoteSourcePaths) {
        results.push(await globalThis.__WB_REMOTE_ATTACH_LOCAL_FILE__(sourcePath, timestamp));
      }
      if (results.every(Boolean)) {
        return;
      }
    }

    const editor = findActiveComposerEditor();
    if (!editor) {
      throw new Error(t("remoteAttachUnavailable"));
    }

    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(file);
    }

    editor.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      })
    );
  };

  const openRemoteAttachmentPicker = async () => {
    if (document.getElementById("wb-bridge-attachment-picker-overlay")) {
      return;
    }

    const roots = await fetchWorkspaceRoots();
    const detectedContext = detectCurrentWorkspaceContext();
    const autoSelection = await resolveAutoSelectedWorkspace(
      detectedContext,
      roots
    );
    const initialWorkspacePath = autoSelection.preferredFolderPath;
    const initialDrive = autoSelection.rootPath;
    if (roots.length === 0) {
      window.alert(t("currentFolderUnavailable"));
      return;
    }

    return new Promise((resolve, reject) => {
      let selectedDrive = roots.some((entry) => entry.path === initialDrive)
        ? initialDrive
        : "";
      let selectedWorkspacePath = initialWorkspacePath;
      let folders = [];
      let files = [];
      let queuedUploadFiles = [];
      let searchKeyword = "";
      let loadingFolders = false;
      let loadingFiles = false;
      let attaching = false;

      const overlay = document.createElement("div");
      overlay.id = "wb-bridge-attachment-picker-overlay";
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483646",
        "background:rgba(0,0,0,0.45)",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:24px",
      ].join(";");

      const panel = document.createElement("div");
      panel.style.cssText = [
        "width:min(860px, 100%)",
        "max-height:min(820px, calc(100vh - 48px))",
        "overflow:hidden",
        "border-radius:16px",
        "background:#151823",
        "color:#eef2ff",
        "box-shadow:0 20px 60px rgba(0,0,0,0.4)",
        "display:flex",
        "flex-direction:column",
        "font:14px/1.45 'Segoe UI', sans-serif",
      ].join(";");
      overlay.appendChild(panel);

      const title = document.createElement("div");
      title.textContent = t("attachFile");
      title.style.cssText = "padding:20px 24px 8px;font-size:20px;font-weight:700;";
      panel.appendChild(title);

      const subtitle = document.createElement("div");
      subtitle.textContent = t("attachFileSubtitle");
      subtitle.style.cssText = "padding:0 24px 16px;color:#9aa4c7;font-size:13px;";
      panel.appendChild(subtitle);

      const body = document.createElement("div");
      body.style.cssText =
        "padding:0 24px 20px;display:flex;flex-direction:column;gap:14px;overflow:auto;";
      panel.appendChild(body);

      const topRow = document.createElement("div");
      topRow.style.cssText =
        "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end;";
      body.appendChild(topRow);

      const driveField = document.createElement("label");
      driveField.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      topRow.appendChild(driveField);

      const driveLabel = document.createElement("span");
      driveLabel.textContent = t("drive");
      driveLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      driveField.appendChild(driveLabel);

      const driveSelect = document.createElement("select");
      driveSelect.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;";
      driveField.appendChild(driveSelect);

      const drivePlaceholder = document.createElement("option");
      drivePlaceholder.value = "";
      drivePlaceholder.textContent = t("selectDrive");
      driveSelect.appendChild(drivePlaceholder);

      for (const driveEntry of roots) {
        const option = document.createElement("option");
        option.value = driveEntry.path;
        option.textContent = driveEntry.label || driveEntry.path;
        driveSelect.appendChild(option);
      }
      driveSelect.value = selectedDrive;

      const workspaceField = document.createElement("label");
      workspaceField.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      topRow.appendChild(workspaceField);

      const workspaceLabel = document.createElement("span");
      workspaceLabel.textContent = t("workspace");
      workspaceLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      workspaceField.appendChild(workspaceLabel);

      const workspaceSelect = document.createElement("select");
      workspaceSelect.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;";
      workspaceField.appendChild(workspaceSelect);

      const createWorkspaceOption = document.createElement("option");
      createWorkspaceOption.value = "__create_workspace__";
      createWorkspaceOption.textContent = t("createFolder");

      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.textContent = t("refresh");
      refreshButton.style.cssText =
        "height:40px;padding:0 16px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      topRow.appendChild(refreshButton);

      const workspaceHint = document.createElement("div");
      workspaceHint.style.cssText =
        "display:none;";
      workspaceHint.textContent = t("currentWorkspace", { path: selectedWorkspacePath });
      body.appendChild(workspaceHint);

      const searchField = document.createElement("label");
      searchField.style.cssText = "display:flex;flex-direction:column;gap:6px;";
      body.appendChild(searchField);

      const searchLabel = document.createElement("span");
      searchLabel.textContent = t("searchFiles");
      searchLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      searchField.appendChild(searchLabel);

      const searchInput = document.createElement("input");
      searchInput.type = "search";
      searchInput.placeholder = t("searchFilesPlaceholder");
      searchInput.style.cssText = [
        "height:40px",
        "border:1px solid #39415d",
        "border-radius:10px",
        "background:#0f1320",
        "color:#eef2ff",
        "padding:0 12px",
        "outline:none",
      ].join(";");
      searchField.appendChild(searchInput);

      const uploadRow = document.createElement("div");
      uploadRow.style.cssText =
        "display:grid;grid-template-columns:minmax(0,1fr) 76px;gap:12px;align-items:start;";
      body.appendChild(uploadRow);

      const uploadField = document.createElement("label");
      uploadField.style.cssText = "display:flex;flex-direction:column;gap:6px;";
      uploadRow.appendChild(uploadField);

      const uploadLabel = document.createElement("span");
      uploadLabel.textContent = t("uploadFiles");
      uploadLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      uploadField.appendChild(uploadLabel);

      const uploadInput = document.createElement("input");
      uploadInput.type = "file";
      uploadInput.multiple = true;
      uploadInput.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
      uploadField.appendChild(uploadInput);

      const dropZone = document.createElement("button");
      dropZone.type = "button";
      dropZone.textContent = t("dropFilesHint");
      dropZone.style.cssText = [
        "height:72px",
        "padding:12px",
        "border:1px dashed #4d5a86",
        "border-radius:12px",
        "background:#0f1320",
        "color:#cfd8ff",
        "text-align:center",
        "cursor:pointer",
        "font:13px/1.5 'Segoe UI', sans-serif",
      ].join(";");
      uploadField.appendChild(dropZone);

      const uploadHint = document.createElement("div");
      uploadHint.style.cssText = "font-size:12px;color:#7d89b4;";
      uploadHint.textContent = t("noFilesSelected");
      uploadField.appendChild(uploadHint);

      const uploadProgress = createUploadProgressControl();
      uploadField.appendChild(uploadProgress.element);

      const uploadButton = document.createElement("button");
      uploadButton.type = "button";
      uploadButton.textContent = t("upload");
      uploadButton.style.cssText =
        "margin-top:24px;height:72px;padding:0 8px;border:none;border-radius:12px;background:#31c48d;color:#062b1f;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.2;";
      uploadRow.appendChild(uploadButton);

      const listWrapper = document.createElement("div");
      listWrapper.style.cssText = [
        "min-height:280px",
        "max-height:420px",
        "overflow:auto",
        "border:1px solid #2c3350",
        "border-radius:12px",
        "background:#0d1120",
        "padding:8px",
        "display:flex",
        "flex-direction:column",
        "gap:8px",
      ].join(";");
      body.appendChild(listWrapper);

      const emptyState = document.createElement("div");
      emptyState.style.cssText = "padding:36px 12px;text-align:center;color:#7d89b4;font-size:13px;";
      listWrapper.appendChild(emptyState);

      const footer = document.createElement("div");
      footer.style.cssText =
        "padding:16px 24px 24px;display:flex;justify-content:flex-end;border-top:1px solid #232a42;";
      panel.appendChild(footer);

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.textContent = t("close");
      closeButton.style.cssText =
        "height:40px;padding:0 16px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      footer.appendChild(closeButton);

      const cleanup = () => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
      };

      const finish = () => {
        cleanup();
        resolve();
      };

      const fail = (error) => {
        cleanup();
        reject(error);
      };

      const setBusy = () => {
        const busy = loadingFolders || loadingFiles || attaching;
        driveSelect.disabled = busy;
        workspaceSelect.disabled = busy;
        refreshButton.disabled = busy;
        searchInput.disabled = busy;
        uploadInput.disabled = busy || !selectedWorkspacePath;
        dropZone.disabled = busy || !selectedWorkspacePath;
        uploadButton.disabled = busy || !selectedWorkspacePath || queuedUploadFiles.length === 0;
        closeButton.disabled = attaching;
      };

      const renderWorkspaceOptions = () => {
        workspaceSelect.replaceChildren();

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = loadingFolders ? t("loadingWorkspaces") : t("selectWorkspace");
        workspaceSelect.appendChild(placeholder);

        for (const entry of folders) {
          const option = document.createElement("option");
          option.value = entry.path;
          option.textContent = entry.name;
          workspaceSelect.appendChild(option);
        }

        workspaceSelect.appendChild(createWorkspaceOption);
        workspaceSelect.value = folders.some((entry) => entry.path === selectedWorkspacePath)
          ? selectedWorkspacePath
          : "";
      };

      const updateQueuedUploadFiles = (nextFiles) => {
        queuedUploadFiles = Array.from(nextFiles || []);
        setUploadProgress(null);
        if (queuedUploadFiles.length === 0) {
          uploadHint.textContent = t("noFilesSelected");
          dropZone.textContent = t("dropFilesHint");
        } else {
          const names = queuedUploadFiles.slice(0, 3).map((file) => file.name).join(", ");
          const suffix =
            queuedUploadFiles.length > 3
              ? t("selectedFilesSuffix", { count: queuedUploadFiles.length })
              : "";
          uploadHint.textContent = t("selectedFiles", { names, suffix });
          dropZone.textContent = t("selectedFilesHint");
        }
        setBusy();
      };

      const setUploadProgress = uploadProgress.set;

      const getFilteredFiles = () => {
        if (!searchKeyword) {
          return files;
        }
        return files.filter((entry) =>
          entry.name.toLowerCase().includes(searchKeyword)
        );
      };

      const renderFileList = () => {
        const filteredFiles = getFilteredFiles();
        listWrapper.replaceChildren();

        if (!selectedWorkspacePath) {
          emptyState.textContent = loadingFolders ? t("loadingWorkspaces") : t("selectWorkspaceFirst");
          listWrapper.appendChild(emptyState);
          return;
        }

        if (loadingFiles) {
          emptyState.textContent = t("loadingFiles");
          listWrapper.appendChild(emptyState);
          return;
        }

        if (filteredFiles.length === 0) {
          emptyState.textContent = files.length === 0 ? t("workspaceEmpty") : t("noMatchingFile");
          listWrapper.appendChild(emptyState);
          return;
        }

        for (const entry of filteredFiles) {
          const item = document.createElement("button");
          item.type = "button";
          item.style.cssText = [
            "display:grid",
            "grid-template-columns:minmax(0,1fr) auto",
            "gap:12px",
            "align-items:center",
            "width:100%",
            "padding:12px 14px",
            "border:1px solid #2b3453",
            "border-radius:10px",
            "background:#12182b",
            "color:#eef2ff",
            "cursor:pointer",
            "text-align:left",
          ].join(";");

          const meta = document.createElement("div");
          meta.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;";
          item.appendChild(meta);

          const name = document.createElement("span");
          name.textContent = entry.name;
          name.style.cssText = "font-weight:700;word-break:break-all;";
          meta.appendChild(name);

          const extra = document.createElement("span");
          extra.textContent =
            formatFileSize(entry.size) +
            " · " +
            new Date(entry.mtimeMs || Date.now()).toLocaleString(
              getUiLanguage() === "en" ? "en-US" : "zh-CN"
            );
          extra.style.cssText = "font-size:12px;color:#7d89b4;";
          meta.appendChild(extra);

          const action = document.createElement("span");
          action.textContent = t("attachFile");
          action.style.cssText =
            "height:34px;padding:0 12px;border-radius:8px;background:#6ea8fe;color:#09111f;font-weight:700;display:flex;align-items:center;";
          item.appendChild(action);

          item.addEventListener("click", async () => {
            attaching = true;
            setBusy();
            try {
              const blob = await withBridgeUiRecovery(
                () => fetchWorkspaceFileBlob(entry.path),
                () => {
                  attaching = false;
                  setBusy();
                },
                {
                  timeoutMs: 0,
                }
              );
              const file = new File([blob], entry.name, {
                type: blob.type || undefined,
                lastModified: entry.mtimeMs || Date.now(),
              });
              markRemoteInlineFile(file, entry.path);
              await attachFilesToComposer([file]);
              saveLastPickedRoot(selectedDrive);
              saveLastPickedComposerFolder(selectedWorkspacePath);
              finish();
            } catch (error) {
              attaching = false;
              setBusy();
              window.alert(error instanceof Error ? error.message : String(error));
            }
          });

          listWrapper.appendChild(item);
        }
      };

      const loadFiles = async () => {
        if (!selectedWorkspacePath) {
          files = [];
          renderFileList();
          setBusy();
          return;
        }

        loadingFiles = true;
        setBusy();
        renderFileList();
        workspaceHint.textContent = t("currentWorkspace", { path: selectedWorkspacePath });
        try {
          const payload = await withBridgeUiRecovery(
            () => fetchWorkspaceFiles(selectedWorkspacePath),
            () => {
              loadingFiles = false;
              setBusy();
              renderFileList();
            },
            {
              timeoutMs: 20000,
              timeoutMessage: "Loading workspace files timed out",
            }
          );
          files = payload?.entries || [];
        } catch (error) {
          files = [];
          workspaceHint.textContent = t("failedLoadCurrentFolder");
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          loadingFiles = false;
          setBusy();
          renderFileList();
        }
      };

      const loadFoldersForDrive = async (drive, preferredFolderPath = "") => {
        selectedDrive = drive;
        saveLastPickedRoot(drive);
        loadingFolders = true;
        folders = [];
        files = [];
        selectedWorkspacePath = "";
        renderWorkspaceOptions();
        renderFileList();
        setBusy();
        try {
          if (!drive) {
            workspaceHint.textContent = t("selectDriveFirst");
            return;
          }
          const payload = await withBridgeUiRecovery(
            () => fetchWorkspaceFolders(drive),
            () => {
              loadingFolders = false;
              renderWorkspaceOptions();
              renderFileList();
              setBusy();
            },
            {
              timeoutMs: 20000,
              timeoutMessage: "Loading workspace folders timed out",
            }
          );
          folders = payload?.folders || [];
          selectedWorkspacePath =
            preferredFolderPath && folders.some((entry) => entry.path === preferredFolderPath)
              ? preferredFolderPath
              : folders[0]?.path || "";
          workspaceHint.textContent = selectedWorkspacePath
            ? t("currentWorkspace", { path: selectedWorkspacePath })
            : t("noWorkspaceAvailable");
          renderWorkspaceOptions();
          await loadFiles();
        } catch (error) {
          workspaceHint.textContent = t("failedLoadWorkspaces");
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          loadingFolders = false;
          renderWorkspaceOptions();
          renderFileList();
          setBusy();
        }
      };

      const onKeyDown = (event) => {
        if (event.key === "Escape" && !attaching) {
          event.preventDefault();
          finish();
        }
      };

      searchInput.addEventListener("input", () => {
        searchKeyword = searchInput.value.trim().toLowerCase();
        renderFileList();
      });

      driveSelect.addEventListener("change", () => {
        searchKeyword = "";
        searchInput.value = "";
        updateQueuedUploadFiles([]);
        loadFoldersForDrive(driveSelect.value).catch(fail);
      });

      workspaceSelect.addEventListener("change", async () => {
        if (workspaceSelect.value === "__create_workspace__") {
          if (!selectedDrive) {
            window.alert(t("selectDriveFirst"));
            renderWorkspaceOptions();
            return;
          }

          const folderName = window.prompt(t("promptNewFolderName"), "");
          if (folderName === null) {
            renderWorkspaceOptions();
            return;
          }

          const trimmedName = folderName.trim();
          if (!trimmedName) {
            window.alert(t("emptyNewFolderName"));
            renderWorkspaceOptions();
            return;
          }

          loadingFolders = true;
          setBusy();
          try {
            const result = await withBridgeUiRecovery(
              () => createWorkspaceFolder(selectedDrive, trimmedName),
              () => {
                loadingFolders = false;
                renderWorkspaceOptions();
                setBusy();
              },
              {
                timeoutMs: 20000,
                timeoutMessage: "Creating workspace timed out",
              }
            );
            if (!result?.ok || !result.path) {
              window.alert(result?.error || t("failedCreateWorkspace"));
              renderWorkspaceOptions();
              return;
            }
            await loadFoldersForDrive(selectedDrive, result.path);
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
          } finally {
            loadingFolders = false;
            renderWorkspaceOptions();
            setBusy();
          }
          return;
        }

        selectedWorkspacePath = workspaceSelect.value;
        saveLastPickedComposerFolder(selectedWorkspacePath);
        searchKeyword = "";
        searchInput.value = "";
        updateQueuedUploadFiles([]);
        loadFiles().catch(fail);
      });

      refreshButton.addEventListener("click", () => {
        loadFoldersForDrive(driveSelect.value, selectedWorkspacePath).catch(fail);
      });

      uploadInput.addEventListener("change", () => {
        updateQueuedUploadFiles(uploadInput.files || []);
      });

      dropZone.addEventListener("click", () => {
        if (!dropZone.disabled) {
          uploadInput.click();
        }
      });

      const setDropZoneActive = (active) => {
        dropZone.style.borderColor = active ? "#6ea8fe" : "#4d5a86";
        dropZone.style.background = active ? "#15203a" : "#0f1320";
      };

      dropZone.addEventListener("dragenter", (event) => {
        event.preventDefault();
        if (!dropZone.disabled) {
          setDropZoneActive(true);
        }
      });
      dropZone.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (!dropZone.disabled) {
          setDropZoneActive(true);
        }
      });
      dropZone.addEventListener("dragleave", (event) => {
        event.preventDefault();
        if (event.target === dropZone) {
          setDropZoneActive(false);
        }
      });
      dropZone.addEventListener("drop", (event) => {
        event.preventDefault();
        setDropZoneActive(false);
        if (dropZone.disabled) {
          return;
        }
        updateQueuedUploadFiles(event.dataTransfer?.files || []);
      });

      uploadButton.addEventListener("click", async () => {
        if (!selectedWorkspacePath) {
          window.alert(t("selectWorkspaceFirst"));
          return;
        }
        const selectedFiles = [...queuedUploadFiles];
        if (selectedFiles.length === 0) {
          window.alert(t("chooseFilesFirst"));
          return;
        }

        loadingFiles = true;
        setBusy();
        setUploadProgress({
          loadedBytes: 0,
          totalBytes: selectedFiles.reduce((sum, file) => sum + file.size, 0),
        });
        try {
          await withBridgeUiRecovery(
            () => uploadWorkspaceFiles(selectedWorkspacePath, selectedFiles, setUploadProgress),
            () => {
              loadingFiles = false;
              setBusy();
            },
            {
              timeoutMs: 0,
            }
          );
          saveLastPickedRoot(selectedDrive);
          saveLastPickedComposerFolder(selectedWorkspacePath);
          uploadInput.value = "";
          updateQueuedUploadFiles([]);
          await loadFiles();
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          loadingFiles = false;
          setUploadProgress(null);
          setBusy();
        }
      });

      closeButton.addEventListener("click", finish);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay && !attaching) {
          finish();
        }
      });

      document.addEventListener("keydown", onKeyDown, true);
      document.body.appendChild(overlay);
      renderWorkspaceOptions();
      setBusy();
      renderFileList();
      loadFoldersForDrive(selectedDrive, selectedWorkspacePath).catch(fail);
    });
  };

  const enhanceComposerAttachmentButtons = () => {
    for (const button of document.querySelectorAll("[data-addition-id='add-local-files']")) {
      if (!(button instanceof HTMLElement)) {
        continue;
      }
      if (button.dataset.wbRemoteAttachBound === "true") {
        continue;
      }

      button.dataset.wbRemoteAttachBound = "true";
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          openRemoteAttachmentPicker().catch((error) => {
            console.error("[bridge] attachment picker failed", error);
            window.alert(error instanceof Error ? error.message : String(error));
          });
        },
        true
      );
    }
  };

  const openFolderRedirectDocuments = new WeakSet();

  const getEventControl = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      if (!item || item.nodeType !== 1 || typeof item.matches !== "function") {
        continue;
      }
      if (item.matches("button, a, [role='button'], [role='menuitem']")) {
        return item;
      }
    }

    return event.target?.nodeType === 1 && typeof event.target.closest === "function"
      ? event.target.closest("button, a, [role='button'], [role='menuitem']")
      : null;
  };

  const isOpenFolderControl = (control) => {
    if (!control || control.nodeType !== 1 || control.closest?.("[id^='wb-bridge-']")) {
      return false;
    }

    const label = [
      control.textContent,
      control.getAttribute("aria-label"),
      control.getAttribute("title"),
      control.getAttribute("data-testid"),
      control.getAttribute("data-action"),
      control.className,
    ]
      .map((value) => String(value || "").replace(/\\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ");

    return /打开.*文件夹|打开.*目录|文件管理器中显示|资源管理器中显示|open.*folder|show.*folder|reveal.*explorer|reveal.*folder/iu.test(label);
  };

  const installOpenFolderRedirect = (targetDocument) => {
    if (!targetDocument || openFolderRedirectDocuments.has(targetDocument)) {
      return;
    }

    openFolderRedirectDocuments.add(targetDocument);
    const handler = (event) => {
      const control = getEventControl(event);
      if (!isOpenFolderControl(control)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openWorkspaceFileManager().catch((error) => {
        console.error("[bridge] file manager failed", error);
        window.alert(error instanceof Error ? error.message : String(error));
      });
    };

    for (const type of ["pointerdown", "mousedown", "click"]) {
      targetDocument.addEventListener(type, handler, true);
    }
  };

  const ensureOpenFolderRedirect = () => {
    installOpenFolderRedirect(document);
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        installOpenFolderRedirect(frame.contentDocument);
      } catch {}
    }
  };

  const applyFloatingActionButtonStyle = (
    button,
    rightPx,
    disabled = false,
    background = "rgba(24, 31, 53, 0.96)",
    textColor = "#eef2ff"
  ) => {
    button.style.cssText = [
      "position:fixed",
      "top:5px",
      "right:" + rightPx + "px",
      "z-index:2147483645",
      "height:26px",
      "padding:0 8px",
      "border:none",
      "border-radius:999px",
      "background:" + background,
      "color:" + textColor,
      "font:10px/1 'Segoe UI', sans-serif",
      "font-weight:700",
      "box-shadow:0 10px 30px rgba(0,0,0,0.25)",
      "cursor:" + (disabled ? "default" : "pointer"),
      "display:flex",
      "align-items:center",
      "gap:6px",
      "opacity:" + (disabled ? "0.55" : "0.92"),
      "pointer-events:" + (disabled ? "none" : "auto"),
    ].join(";");
    button.disabled = disabled;
  };

  const confirmDestructiveAction = (
    title,
    description,
    confirmLabel = t("deleteConfirm"),
    warningText = t("deleteWarning")
  ) =>
    new Promise((confirmResolve) => {
      const confirmOverlay = document.createElement("div");
      confirmOverlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "background:rgba(0,0,0,0.5)",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:24px",
      ].join(";");

      const confirmPanel = document.createElement("div");
      confirmPanel.style.cssText = [
        "width:min(480px, 100%)",
        "border-radius:16px",
        "background:#141824",
        "color:#eef2ff",
        "box-shadow:0 24px 64px rgba(0,0,0,0.42)",
        "border:1px solid #3b2940",
        "overflow:hidden",
      ].join(";");
      confirmOverlay.appendChild(confirmPanel);

      const confirmHeader = document.createElement("div");
      confirmHeader.style.cssText = "padding:18px 20px 10px;font-size:18px;font-weight:700;color:#ffd5dc;";
      confirmHeader.textContent = title;
      confirmPanel.appendChild(confirmHeader);

      const confirmBody = document.createElement("div");
      confirmBody.style.cssText = "padding:0 20px 18px;color:#d6dcef;line-height:1.6;";
      confirmBody.textContent = description;
      confirmPanel.appendChild(confirmBody);

      if (warningText) {
        const warning = document.createElement("div");
        warning.style.cssText = "margin:0 20px 20px;padding:12px 14px;border-radius:12px;background:#341922;color:#ffd0d7;font-size:13px;font-weight:700;";
        warning.textContent = warningText;
        confirmPanel.appendChild(warning);
      }

      const confirmFooter = document.createElement("div");
      confirmFooter.style.cssText = "padding:0 20px 20px;display:flex;justify-content:flex-end;gap:10px;";
      confirmPanel.appendChild(confirmFooter);

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = t("cancel");
      cancel.style.cssText = "height:38px;padding:0 14px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      confirmFooter.appendChild(cancel);

      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.textContent = confirmLabel;
      confirm.style.cssText = "height:38px;padding:0 14px;border:none;border-radius:10px;background:#f87171;color:#230909;font-weight:800;cursor:pointer;";
      confirmFooter.appendChild(confirm);

      const cleanupConfirm = (result) => {
        document.removeEventListener("keydown", onConfirmKeyDown, true);
        confirmOverlay.remove();
        confirmResolve(result);
      };

      const onConfirmKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanupConfirm(false);
        }
      };

      cancel.addEventListener("click", () => cleanupConfirm(false));
      confirm.addEventListener("click", () => cleanupConfirm(true));
      confirmOverlay.addEventListener("click", (event) => {
        if (event.target === confirmOverlay) {
          cleanupConfirm(false);
        }
      });
      document.addEventListener("keydown", onConfirmKeyDown, true);
      document.body.appendChild(confirmOverlay);
    });

  const waitForBridgeRecovery = async ({ timeoutMs = 90000, intervalMs = 1200 } = {}) => {
    const startedAt = Date.now();
    let sawDisconnect = false;

    while (Date.now() - startedAt < timeoutMs) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        sawDisconnect = true;
      }

      try {
        const response = await fetch("/readyz?restart=" + Date.now(), {
          cache: "no-store",
        });
        if (response.ok) {
          if (sawDisconnect) {
            window.location.reload();
            return;
          }
        } else {
          sawDisconnect = true;
        }
      } catch {
        sawDisconnect = true;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, intervalMs);
      });
    }

    restartInProgress = false;
    ensureRestartButton();
    throw new Error(t("restartTimeout"));
  };

  const requestBridgeRestart = async () => {
    if (restartInProgress) {
      return;
    }

    if (!restartAvailable) {
      throw new Error("Restart is unavailable for the current session.");
    }

    const confirmed = await confirmDestructiveAction(
      t("restartConfirmTitle"),
      t("restartConfirmDescription"),
      t("restartConfirmAction"),
      t("restartConfirmWarning")
    );
    if (!confirmed) {
      return;
    }

    restartInProgress = true;
    ensureRestartButton();
    setBridgeStatus(t("restartStarting"));

    try {
      await sendRpc("restart-app");
    } catch (error) {
      restartInProgress = false;
      ensureRestartButton();
      throw error;
    }

    await waitForBridgeRecovery();
  };

  const ensureFileManagerButton = () => {
    let button = document.getElementById("wb-bridge-file-manager-button");
    if (!button) {
      button = document.createElement("button");
      button.id = "wb-bridge-file-manager-button";
      button.type = "button";
      button.addEventListener("click", () => {
        openWorkspaceFileManager().catch((error) => {
          console.error("[bridge] file manager failed", error);
          window.alert(error instanceof Error ? error.message : String(error));
        });
      });
      document.body.appendChild(button);
    }

    const label = t("fileManager");
    if (button.textContent !== label) {
      button.textContent = label;
    }
    applyFloatingActionButtonStyle(button, 87);
  };

  const ensureRestartButton = () => {
    let button = document.getElementById("wb-bridge-restart-button");
    if (!restartAvailable) {
      button?.remove();
      return;
    }

    if (!button) {
      button = document.createElement("button");
      button.id = "wb-bridge-restart-button";
      button.type = "button";
      button.addEventListener("click", () => {
        requestBridgeRestart().catch((error) => {
          console.error("[bridge] restart failed", error);
          setBridgeStatus("");
          window.alert(error instanceof Error ? error.message : String(error));
        });
      });
      document.body.appendChild(button);
    }

    const label = t("restartProgram");
    if (button.textContent !== label) {
      button.textContent = label;
    }
    applyFloatingActionButtonStyle(
      button,
      20,
      restartInProgress,
      "rgba(110, 28, 28, 0.96)",
      "#fff2f2"
    );
  };

  const openWorkspaceFileManager = async () => {
    if (document.getElementById("wb-bridge-file-manager-overlay")) {
      return;
    }

    const roots = await fetchWorkspaceRoots();
    const detectedContext = detectCurrentWorkspaceContext();

    return new Promise((resolve, reject) => {
      let selectedDrive = "";
      let selectedWorkspacePath = "";
      let folders = [];
      let files = [];
      let queuedUploadFiles = [];
      let loadingFolders = false;
      let loadingFiles = false;

      const overlay = document.createElement("div");
      overlay.id = "wb-bridge-file-manager-overlay";
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483646",
        "background:rgba(0,0,0,0.45)",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:24px",
      ].join(";");

      const panel = document.createElement("div");
      panel.style.cssText = [
        "width:min(860px, 100%)",
        "max-height:min(820px, calc(100vh - 48px))",
        "overflow:hidden",
        "border-radius:16px",
        "background:#151823",
        "color:#eef2ff",
        "box-shadow:0 20px 60px rgba(0,0,0,0.4)",
        "display:flex",
        "flex-direction:column",
        "font:14px/1.45 'Segoe UI', sans-serif",
      ].join(";");
      overlay.appendChild(panel);

      const title = document.createElement("div");
      title.textContent = t("fileManager");
      title.style.cssText = "padding:20px 24px 8px;font-size:20px;font-weight:700;";
      panel.appendChild(title);

      const subtitle = document.createElement("div");
      subtitle.textContent = t("fileManagerSubtitle");
      subtitle.style.cssText = "padding:0 24px 16px;color:#9aa4c7;font-size:13px;";
      panel.appendChild(subtitle);

      const body = document.createElement("div");
      body.style.cssText = "padding:0 24px 20px;display:flex;flex-direction:column;gap:14px;overflow:auto;";
      panel.appendChild(body);

      const topRow = document.createElement("div");
      topRow.style.cssText =
        "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end;";
      body.appendChild(topRow);

      const driveField = document.createElement("label");
      driveField.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      topRow.appendChild(driveField);

      const driveLabel = document.createElement("span");
      driveLabel.textContent = t("drive");
      driveLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      driveField.appendChild(driveLabel);

      const driveSelect = document.createElement("select");
      driveSelect.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;";
      driveField.appendChild(driveSelect);

      const drivePlaceholder = document.createElement("option");
      drivePlaceholder.value = "";
      drivePlaceholder.textContent = t("selectDrive");
      driveSelect.appendChild(drivePlaceholder);

      for (const driveEntry of roots) {
        const option = document.createElement("option");
        option.value = driveEntry.path;
        option.textContent = driveEntry.label || driveEntry.path;
        driveSelect.appendChild(option);
      }

      const workspaceField = document.createElement("label");
      workspaceField.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      topRow.appendChild(workspaceField);

      const workspaceLabel = document.createElement("span");
      workspaceLabel.textContent = t("workspace");
      workspaceLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      workspaceField.appendChild(workspaceLabel);

      const workspaceSelect = document.createElement("select");
      workspaceSelect.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;";
      workspaceField.appendChild(workspaceSelect);

      const workspacePlaceholder = document.createElement("option");
      workspacePlaceholder.value = "";
      workspacePlaceholder.textContent = t("selectWorkspace");
      workspaceSelect.appendChild(workspacePlaceholder);

      const createWorkspaceOption = document.createElement("option");
      createWorkspaceOption.value = "__create_workspace__";
      createWorkspaceOption.textContent = t("createFolder");

      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.textContent = t("refresh");
      refreshButton.style.cssText = "height:40px;padding:0 16px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      topRow.appendChild(refreshButton);

      const workspaceHint = document.createElement("div");
      workspaceHint.style.cssText = "display:none;";
      workspaceHint.textContent = t("workspaceActionHint");
      body.appendChild(workspaceHint);

      const uploadRow = document.createElement("div");
      uploadRow.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) 76px;gap:12px;align-items:start;";
      body.appendChild(uploadRow);

      const uploadField = document.createElement("label");
      uploadField.style.cssText = "display:flex;flex-direction:column;gap:6px;";
      uploadRow.appendChild(uploadField);

      const uploadLabel = document.createElement("span");
      uploadLabel.textContent = t("uploadFiles");
      uploadLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      uploadField.appendChild(uploadLabel);

      const uploadInput = document.createElement("input");
      uploadInput.type = "file";
      uploadInput.multiple = true;
      uploadInput.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
      uploadField.appendChild(uploadInput);

      const dropZone = document.createElement("button");
      dropZone.type = "button";
      dropZone.textContent = t("dropFilesHint");
      dropZone.style.cssText = [
        "height:88px",
        "padding:14px",
        "border:1px dashed #4d5a86",
        "border-radius:12px",
        "background:#0f1320",
        "color:#cfd8ff",
        "text-align:center",
        "cursor:pointer",
        "font:13px/1.5 'Segoe UI', sans-serif",
      ].join(";");
      uploadField.appendChild(dropZone);

      const uploadHint = document.createElement("div");
      uploadHint.style.cssText = "font-size:12px;color:#7d89b4;";
      uploadHint.textContent = t("noFilesSelected");
      uploadField.appendChild(uploadHint);

      const uploadProgress = createUploadProgressControl();
      uploadField.appendChild(uploadProgress.element);

      const uploadButton = document.createElement("button");
      uploadButton.type = "button";
      uploadButton.textContent = t("upload");
      uploadButton.style.cssText = "margin-top:24px;height:88px;padding:0 8px;border:none;border-radius:12px;background:#31c48d;color:#062b1f;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.2;";
      uploadRow.appendChild(uploadButton);

      const fileList = document.createElement("div");
      fileList.style.cssText = [
        "min-height:280px",
        "max-height:420px",
        "overflow:auto",
        "border:1px solid #2c3350",
        "border-radius:12px",
        "background:#0d1120",
        "padding:8px",
        "display:flex",
        "flex-direction:column",
        "gap:8px",
      ].join(";");
      body.appendChild(fileList);

      const emptyState = document.createElement("div");
      emptyState.style.cssText = "padding:36px 12px;text-align:center;color:#7d89b4;font-size:13px;";
      fileList.appendChild(emptyState);

      const footer = document.createElement("div");
      footer.style.cssText = "padding:16px 24px 24px;display:flex;justify-content:flex-end;border-top:1px solid #232a42;";
      panel.appendChild(footer);

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.textContent = t("close");
      closeButton.style.cssText = "height:40px;padding:0 16px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      footer.appendChild(closeButton);

      const cleanup = () => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
      };

      const finish = () => {
        cleanup();
        resolve();
      };

      const fail = (error) => {
        cleanup();
        reject(error);
      };

      const renderFileList = () => {
        fileList.replaceChildren();
        if (!selectedWorkspacePath) {
          emptyState.textContent = t("selectWorkspaceFirst");
          fileList.appendChild(emptyState);
          return;
        }

        if (loadingFiles) {
          emptyState.textContent = t("loadingFiles");
          fileList.appendChild(emptyState);
          return;
        }

        if (files.length === 0) {
          emptyState.textContent = t("workspaceEmpty");
          fileList.appendChild(emptyState);
          return;
        }

        for (const entry of files) {
          const row = document.createElement("div");
          row.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid #2b3453;border-radius:10px;background:#12182b;";

          const meta = document.createElement("div");
          meta.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;";
          row.appendChild(meta);

          const name = document.createElement("span");
          name.textContent = entry.name;
          name.style.cssText = "font-weight:700;word-break:break-all;";
          meta.appendChild(name);

          const pathText = document.createElement("span");
          pathText.textContent = entry.path;
          pathText.style.cssText = "font-size:12px;line-height:1.45;color:#9aa4c7;word-break:break-all;";
          meta.appendChild(pathText);

          const extra = document.createElement("span");
          extra.textContent =
            formatFileSize(entry.size) +
            " · " +
            new Date(entry.mtimeMs || Date.now()).toLocaleString(
              getUiLanguage() === "en" ? "en-US" : "zh-CN"
            );
          extra.style.cssText = "font-size:12px;color:#7d89b4;";
          meta.appendChild(extra);

          const action = document.createElement("button");
          action.type = "button";
            action.textContent = t("delete");
          action.style.cssText = "height:34px;padding:0 12px;border:none;border-radius:8px;background:#f87171;color:#200a0a;font-weight:700;cursor:pointer;";
          action.addEventListener("click", async () => {
            const confirmed = await confirmDestructiveAction(
                  t("deleteFileTitle"),
                  t("deleteFileDescription", { name: entry.name })
            );
            if (!confirmed) {
              return;
            }
            try {
              const result = await deleteWorkspaceEntryRequest(entry.path);
              if (!result?.ok) {
                window.alert(result?.error || t("failedDeleteFile"));
                return;
              }
              await loadFilesForWorkspace(selectedWorkspacePath);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : String(error));
            }
          });
          const downloadButton = document.createElement("button");
          downloadButton.type = "button";
            downloadButton.textContent = t("download");
          downloadButton.style.cssText = "height:34px;padding:0 12px;border:none;border-radius:8px;background:#6ea8fe;color:#09111f;font-weight:700;cursor:pointer;";
          downloadButton.addEventListener("click", () => {
            triggerWorkspaceDownload(entry);
          });

          const actions = document.createElement("div");
          actions.style.cssText = "display:flex;align-items:center;gap:8px;";
          row.appendChild(actions);
          actions.appendChild(downloadButton);
          actions.appendChild(action);

          fileList.appendChild(row);
        }
      };

      const setBusy = () => {
        driveSelect.disabled = loadingFolders || loadingFiles;
        workspaceSelect.disabled = loadingFolders || loadingFiles;
        refreshButton.disabled = loadingFolders || loadingFiles;
        uploadInput.disabled = loadingFolders || loadingFiles || !selectedWorkspacePath;
        dropZone.disabled = loadingFolders || loadingFiles || !selectedWorkspacePath;
        uploadButton.disabled =
          loadingFolders ||
          loadingFiles ||
          !selectedWorkspacePath ||
          queuedUploadFiles.length === 0;
      };

      const updateQueuedUploadFiles = (nextFiles) => {
        queuedUploadFiles = Array.from(nextFiles || []);
        setUploadProgress(null);
        if (queuedUploadFiles.length === 0) {
          uploadHint.textContent = t("noFilesSelected");
          dropZone.textContent = t("dropFilesHint");
        } else {
          const names = queuedUploadFiles.slice(0, 3).map((file) => file.name).join(", ");
          const suffix =
            queuedUploadFiles.length > 3
              ? t("selectedFilesSuffix", { count: queuedUploadFiles.length })
              : "";
          uploadHint.textContent = t("selectedFiles", { names, suffix });
          dropZone.textContent = t("selectedFilesHint");
        }
        setBusy();
      };

      const setUploadProgress = uploadProgress.set;

      const loadFilesForWorkspace = async (folderPath) => {
        selectedWorkspacePath = folderPath || "";
        if (!selectedWorkspacePath) {
          files = [];
          renderFileList();
          setBusy();
          return;
        }

        loadingFiles = true;
        workspaceHint.textContent = t("currentWorkspace", { path: selectedWorkspacePath });
        renderFileList();
        setBusy();
        try {
          const payload = await withBridgeUiRecovery(
            () => fetchWorkspaceFiles(selectedWorkspacePath),
            () => {
              loadingFiles = false;
              renderFileList();
              setBusy();
            },
            {
              timeoutMs: 20000,
              timeoutMessage: "Loading workspace files timed out",
            }
          );
          files = payload?.entries || [];
        } catch (error) {
          files = [];
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          loadingFiles = false;
          renderFileList();
          setBusy();
        }
      };

      const renderWorkspaceOptions = () => {
        workspaceSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = loadingFolders ? t("loadingWorkspaces") : t("selectWorkspace");
        workspaceSelect.appendChild(placeholder);

        for (const entry of folders) {
          const option = document.createElement("option");
          option.value = entry.path;
          option.textContent = entry.name;
          workspaceSelect.appendChild(option);
        }
        workspaceSelect.appendChild(createWorkspaceOption);

        if (!folders.some((entry) => entry.path === selectedWorkspacePath)) {
          selectedWorkspacePath = folders[0]?.path || "";
        }
        workspaceSelect.value = selectedWorkspacePath;
      };

      const loadFoldersForDrive = async (drive, preferredFolderPath = "") => {
        selectedDrive = drive;
        saveLastPickedRoot(drive);
        loadingFolders = true;
        folders = [];
        selectedWorkspacePath = "";
        files = [];
        renderWorkspaceOptions();
        renderFileList();
        setBusy();
        try {
          if (!drive) {
            workspaceHint.textContent = t("selectDriveFirst");
            return;
          }
          const payload = await withBridgeUiRecovery(
            () => fetchWorkspaceFolders(drive),
            () => {
              loadingFolders = false;
              renderWorkspaceOptions();
              renderFileList();
              setBusy();
            },
            {
              timeoutMs: 20000,
              timeoutMessage: "Loading workspace folders timed out",
            }
          );
          folders = payload?.folders || [];
          selectedWorkspacePath =
            preferredFolderPath && folders.some((entry) => entry.path === preferredFolderPath)
              ? preferredFolderPath
              : folders[0]?.path || "";
          workspaceHint.textContent = payload?.workspaceRoot
            ? t("currentRoot", { path: payload.workspaceRoot })
            : t("noWorkspaceAvailable");
          renderWorkspaceOptions();
          await loadFilesForWorkspace(selectedWorkspacePath);
        } catch (error) {
          workspaceHint.textContent = t("failedLoadWorkspaces");
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          loadingFolders = false;
          renderWorkspaceOptions();
          renderFileList();
          setBusy();
        }
      };

      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish();
        }
      };

      const tryAutoSelectWorkspace = async () => {
        const autoSelection = await resolveAutoSelectedWorkspace(
          detectedContext,
          roots
        );
        selectedDrive = autoSelection.rootPath;
        driveSelect.value = autoSelection.rootPath;
        if (autoSelection.matched) {
          workspaceHint.textContent =
            t("autoSelectedWorkspace", {
              path: autoSelection.matched.folder.path,
            });
        }
        await loadFoldersForDrive(autoSelection.rootPath, autoSelection.preferredFolderPath);
      };

      driveSelect.value = "";

      driveSelect.addEventListener("change", () => {
        loadFoldersForDrive(driveSelect.value).catch(fail);
      });

      workspaceSelect.addEventListener("change", async () => {
        if (workspaceSelect.value === "__create_workspace__") {
          const folderName = window.prompt(t("promptNewFolderName"), "");
          if (folderName === null) {
            renderWorkspaceOptions();
            return;
          }

          const trimmedName = folderName.trim();
          if (!trimmedName) {
            window.alert(t("emptyNewFolderName"));
            renderWorkspaceOptions();
            return;
          }

          loadingFolders = true;
          setBusy();
          try {
            const result = await withBridgeUiRecovery(
              () => createWorkspaceFolder(selectedDrive, trimmedName),
              () => {
                loadingFolders = false;
                renderWorkspaceOptions();
                setBusy();
              },
              {
                timeoutMs: 20000,
                timeoutMessage: "Creating workspace timed out",
              }
            );
            if (!result?.ok || !result.path) {
              window.alert(result?.error || t("failedCreateWorkspace"));
              renderWorkspaceOptions();
              return;
            }
            await loadFoldersForDrive(selectedDrive);
            selectedWorkspacePath = result.path;
            renderWorkspaceOptions();
            await loadFilesForWorkspace(selectedWorkspacePath);
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
          } finally {
            loadingFolders = false;
            renderWorkspaceOptions();
            setBusy();
          }
          return;
        }

        loadFilesForWorkspace(workspaceSelect.value).catch(fail);
      });

      uploadInput.addEventListener("change", () => {
        updateQueuedUploadFiles(uploadInput.files || []);
      });

      dropZone.addEventListener("click", () => {
        if (!dropZone.disabled) {
          uploadInput.click();
        }
      });

      const setDropZoneActive = (active) => {
        dropZone.style.borderColor = active ? "#6ea8fe" : "#4d5a86";
        dropZone.style.background = active ? "#15203a" : "#0f1320";
      };

      dropZone.addEventListener("dragenter", (event) => {
        event.preventDefault();
        if (!dropZone.disabled) {
          setDropZoneActive(true);
        }
      });
      dropZone.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (!dropZone.disabled) {
          setDropZoneActive(true);
        }
      });
      dropZone.addEventListener("dragleave", (event) => {
        event.preventDefault();
        if (event.target === dropZone) {
          setDropZoneActive(false);
        }
      });
      dropZone.addEventListener("drop", (event) => {
        event.preventDefault();
        setDropZoneActive(false);
        if (dropZone.disabled) {
          return;
        }
        updateQueuedUploadFiles(event.dataTransfer?.files || []);
      });

      refreshButton.addEventListener("click", () => {
        loadFoldersForDrive(driveSelect.value, selectedWorkspacePath).catch(fail);
      });

      uploadButton.addEventListener("click", async () => {
        if (!selectedWorkspacePath) {
          window.alert(t("selectWorkspaceFirst"));
          return;
        }
        const selectedFiles = [...queuedUploadFiles];
        if (selectedFiles.length === 0) {
          window.alert(t("chooseFilesFirst"));
          return;
        }

        loadingFiles = true;
        setBusy();
        setUploadProgress({
          loadedBytes: 0,
          totalBytes: selectedFiles.reduce((sum, file) => sum + file.size, 0),
        });
        try {
          await withBridgeUiRecovery(
            () => uploadWorkspaceFiles(selectedWorkspacePath, selectedFiles, setUploadProgress),
            () => {
              loadingFiles = false;
              setBusy();
            },
            {
              timeoutMs: 0,
            }
          );
          uploadInput.value = "";
          updateQueuedUploadFiles([]);
          await loadFilesForWorkspace(selectedWorkspacePath);
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          loadingFiles = false;
          setUploadProgress(null);
          setBusy();
        }
      });

      closeButton.addEventListener("click", finish);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          finish();
        }
      });

      document.addEventListener("keydown", onKeyDown, true);
      document.body.appendChild(overlay);
      renderWorkspaceOptions();
      renderFileList();
      setBusy();
      tryAutoSelectWorkspace().catch(fail);
    });
  };

  const applyBootstrap = (bootstrap) => {
    runtimeConfig = bootstrap?.config || {};
    bridgeUiConfig = bootstrap?.bridgeUi || {};
    hostConnected = bootstrap?.hostConnected !== false;
    restartAvailable = bootstrap?.restartAvailable !== false;
    document.documentElement.lang = getUiLanguage() === "en" ? "en" : "zh-CN";
    ensureFileManagerButton();
    ensureRestartButton();
    const bootstrapAuth =
      bootstrap && Object.prototype.hasOwnProperty.call(bootstrap, "authSession")
        ? bootstrap.authSession
        : loadStoredAuthSession();
    saveAuthSession(bootstrapAuth);
    maskSensitiveModelFields();
    if (!hostConnected) {
        setBridgeStatus(t("hostDisconnected"));
    }
  };

  const openExternalUrl = (url) => {
    if (pendingExternalWindow && !pendingExternalWindow.closed) {
      try {
        pendingExternalWindow.opener = null;
      } catch {}

      try {
        pendingExternalWindow.location.replace(url);
        pendingExternalWindow.focus?.();
        pendingExternalWindow = null;
        return;
      } catch (error) {
        console.warn("[bridge] Failed to reuse pre-opened window", error);
      }
    }

    const opened = window.open(url, "_blank");
    if (!opened) {
      window.location.href = url;
      return;
    }

    try {
      opened.opener = null;
    } catch {}
  };

  const renderPendingExternalWindowMessage = (message, { isError = false } = {}) => {
    if (!pendingExternalWindow || pendingExternalWindow.closed) {
      pendingExternalWindow = null;
      return;
    }

    const title = t("loginRedirectWindowTitle");
    const body = String(message || "").replace(/[&<>"]/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return char;
      }
    });
    const accent = isError ? "#c62828" : "#1f6feb";

    try {
      pendingExternalWindow.document.open();
      pendingExternalWindow.document.write(\`<!DOCTYPE html>
<html lang="\${getUiLanguage() === "en" ? "en" : "zh-CN"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>\${title}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f6f8fb;
        color: #1f2328;
        font: 16px/1.6 "Segoe UI", system-ui, sans-serif;
      }
      main {
        width: min(560px, calc(100vw - 48px));
        padding: 24px 28px;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 20px;
      }
      p {
        margin: 0;
        white-space: pre-wrap;
        color: #475467;
      }
      .indicator {
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: \${accent};
        margin-bottom: 16px;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="indicator"></div>
      <h1>\${title}</h1>
      <p>\${body}</p>
    </main>
  </body>
</html>\`);
      pendingExternalWindow.document.close();
      pendingExternalWindow.document.title = title;
      pendingExternalWindow.opener = null;
    } catch (error) {
      console.warn("[bridge] Failed to write login status page", error);
    }
  };

  const connect = async () => {
    const bootstrapPromise = fetch("/bridge/bootstrap", { cache: "no-store" }).then((response) => {
      if (!response.ok) {
        throw new Error("Failed to load bridge bootstrap");
      }
      return response.json();
    });

    const openBridgeWs = async () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(\`\${protocol}//\${location.host}/bridge/ws\`);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("WebSocket connect failed")), {
          once: true,
        });
      });
    };

    const bootstrapResultPromise = Promise.allSettled([bootstrapPromise]);
    const wsPromise = openBridgeWs();

    try {
      await wsPromise;
    } catch (error) {
      throw error;
    }

    const [bootstrapResult] = await bootstrapResultPromise;
    if (bootstrapResult?.status === "fulfilled") {
      applyBootstrap(bootstrapResult.value);
    } else {
      throw bootstrapResult?.reason || new Error("Failed to load bridge bootstrap");
    }

    globalThis.__WB_APP_OUT_BASE_URL__ = new URL("/mirror/resources/app/out/", location.origin).href;

    if (hostConnected) {
      setBridgeStatus("");
    }

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);

      if (message.id && pending.has(message.id)) {
        const current = pending.get(message.id);
        pending.delete(message.id);
        if (message.ok === false) {
          current.reject(new Error(message.error || "Bridge call failed"));
        } else {
          current.resolve(message.result);
        }
        return;
      }

      if (message.type === "ipc-event") {
        if (message.channel === authSessionChannel) {
          saveAuthSession(message.args?.[0]);
        }
        emit(message.channel, ...(message.args || []));
        return;
      }

      if (message.type === "workspace-upload-progress") {
        pendingUploadProgress.get(message.uploadId)?.(message);
        return;
      }

      if (message.type === "open-external") {
        openExternalUrl(message.url);
        return;
      }

      if (message.type === "open-file-manager") {
        openWorkspaceFileManager().catch((error) => {
          console.error("[bridge] file manager failed", error);
          window.alert(error instanceof Error ? error.message : String(error));
        });
        return;
      }

      if (message.type === "dynamic-port-ready") {
        const acquired = acquiredPorts.get(message.nonce);
        if (!acquired) {
          return;
        }

        const previousPortId = activePortByWindow.get(acquired.windowId);
        if (previousPortId && previousPortId !== message.portId) {
          cleanupPortState(previousPortId);
        }

        const localChannel = new MessageChannel();
        localChannel.port2.start();
        localChannel.port2.onmessage = (portEvent) => {
          socket.send(
            JSON.stringify({
              type: "port-post",
              portId: message.portId,
              payload: encodePayload(portEvent.data),
            })
          );
        };

        livePorts.set(message.portId, localChannel.port2);
        activePortByWindow.set(acquired.windowId, message.portId);
        pendingPortOpenByWindow.delete(acquired.windowId);
        acquiredPorts.delete(message.nonce);
        window.postMessage(message.nonce, "*", [localChannel.port1]);
        return;
      }

      if (message.type === "dynamic-port-error") {
        const acquired = acquiredPorts.get(message.nonce);
        if (acquired?.windowId) {
          pendingPortOpenByWindow.delete(acquired.windowId);
        }
        acquiredPorts.delete(message.nonce);
        emit("codebuddy:agentManagerChannelError", {
          nonce: message.nonce,
          error: message.error,
        });
        return;
      }

      if (message.type === "port-message") {
        const port = livePorts.get(message.portId);
        if (port) {
          port.postMessage(decodePayload(message.payload));
        }
        return;
      }

      if (message.type === "port-message-error") {
        console.warn("[bridge] Remote MessagePort reported an error", message.portId);
      }
    });

    socket.addEventListener("close", () => {
      hostConnected = false;
      resetDynamicPortState();
      if (restartInProgress) {
        setBridgeStatus(t("restartStarting"));
      } else {
        setBridgeStatusWithDelay(t("hostConnectionClosed"), 10000);
      }
      for (const { reject } of pending.values()) {
        reject(new Error("Bridge WebSocket closed"));
      }
      pending.clear();
      if (!restartInProgress) {
        scheduleReconnect().catch((error) => {
          console.warn("[bridge] Auto-reconnect stopped after close", error);
        });
      }
    });

    socket.addEventListener("error", () => {
      hostConnected = false;
      resetDynamicPortState();
      if (restartInProgress) {
        setBridgeStatus(t("restartStarting"));
      } else {
        setBridgeStatusWithDelay(t("hostConnectionFailed"), 10000);
      }
      if (!restartInProgress && (!socket || socket.readyState === WebSocket.CLOSED)) {
        scheduleReconnect().catch((error) => {
          console.warn("[bridge] Auto-reconnect stopped after error", error);
        });
      }
    });
  };

  readyPromise = connect();

  const ipcRenderer = {
    send(channel, ...args) {
      waitForActiveConnection().then(() => {
        if (channel === "codebuddy:requestAgentManagerChannel") {
          const [windowId, nonce] = args;
          requestDynamicPortOpen(windowId, nonce);
          return;
        }

        socket.send(JSON.stringify({ type: "send", channel, args }));
      }).catch((error) => {
        console.error("[bridge] send failed", channel, error);
      });
    },

    invoke(channel, ...args) {
      if (channel === authSessionRequest) {
        return waitForActiveConnection()
          .then(() =>
            sendRpc("invoke", { channel, args })
              .then((result) => {
                saveAuthSession(result);
                return result;
              })
              .catch((error) => {
                if (authSessionCache !== null) {
                  console.warn("[bridge] Falling back to cached auth session", error);
                  return authSessionCache;
                }
                throw error;
              })
          )
          .catch((error) => {
            if (authSessionCache !== null) {
              console.warn("[bridge] Returning stored auth session before bridge ready", error);
              return authSessionCache;
            }
            throw error;
          });
      }

      if (channel === ${JSON.stringify(PICK_FOLDER_REQUEST)}) {
        const defaultPath = args?.[0]?.defaultPath;
        return waitForActiveConnection().then(() =>
          promptForRemoteFolderPath(defaultPath).then((result) => {
            saveLastPickedComposerFolder(result?.[0] || "");
            return result;
          })
        );
      }

      if (channel === ${JSON.stringify(AUTH_LOGIN_REQUEST)}) {
        if (!pendingExternalWindow || pendingExternalWindow.closed) {
          pendingExternalWindow = window.open("about:blank", "_blank");
          try {
            if (pendingExternalWindow) {
              pendingExternalWindow.opener = null;
              renderPendingExternalWindowMessage(t("loginRedirectPending"));
            }
          } catch {}
        }
      }

      return waitForActiveConnection()
        .then(() => sendRpc("invoke", { channel, args }))
        .catch((error) => {
          if (channel === ${JSON.stringify(AUTH_LOGIN_REQUEST)}) {
            const message = error instanceof Error && error.message ? error.message : t("loginRedirectFailed");
            setBridgeStatus(t("loginRedirectFailed"));
            renderPendingExternalWindowMessage(message, { isError: true });
          }
          throw error;
        });
    },

    on(channel, listener) {
      const handlers = ensureChannel(channel);
      const sizeBefore = handlers.size;
      handlers.add(listener);
      if (channel === authSessionChannel && authSessionCache !== null) {
        queueMicrotask(() => {
          if (handlers.has(listener)) {
            listener(makeEvent(), authSessionCache);
          }
        });
      }
      if (sizeBefore === 0) {
        waitForActiveConnection().then(() => {
          socket.send(JSON.stringify({ type: "subscribe", channel }));
        }).catch((error) => {
          console.error("[bridge] subscribe failed", channel, error);
        });
      }
    },

    once(channel, listener) {
      const wrapper = (event, ...args) => {
        ipcRenderer.removeListener(channel, wrapper);
        listener(event, ...args);
      };
      onceWrappers.set(listener, wrapper);
      ipcRenderer.on(channel, wrapper);
    },

    removeListener(channel, listener) {
      const handlers = listeners.get(channel);
      if (!handlers) {
        return;
      }

      const wrapper = onceWrappers.get(listener);
      if (wrapper) {
        handlers.delete(wrapper);
        onceWrappers.delete(listener);
      } else {
        handlers.delete(listener);
      }

      if (handlers.size === 0) {
        listeners.delete(channel);
        waitForActiveConnection().then(() => {
          socket.send(JSON.stringify({ type: "unsubscribe", channel }));
        }).catch((error) => {
          console.error("[bridge] unsubscribe failed", channel, error);
        });
      }
    },
  };

  const webFrame = {
    setZoomLevel() {},
  };

  const context = {
    configuration() {
      return runtimeConfig;
    },
    async resolveConfiguration() {
      await readyPromise;
      return runtimeConfig;
    },
  };

  const processShim = {
    platform: "win32",
    type: "renderer",
    env: {},
  };

  const ipcMessagePort = {
    acquire(channel, nonce) {
      acquiredPorts.set(nonce, { channel });
    },
  };

  const vscode = {
    ipcRenderer,
    ipcMessagePort,
    webFrame,
    webUtils: {},
    process: processShim,
    context,
  };

  window.vscode = vscode;
  globalThis.vscode = vscode;
  window.__WB_VSCODE_READY__ = readyPromise;

  const mountBridgeUi = () => {
    let observer;

    const mount = () => {
      ensureFileManagerButton();
      ensureRestartButton();
      maskSensitiveModelFields();
      enhanceComposerAttachmentButtons();
      ensureOpenFolderRedirect();
    };

    if (document.body) {
      mount();
    } else {
      window.addEventListener("DOMContentLoaded", mount, { once: true });
    }

    observer = new MutationObserver(() => {
      mount();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  mountBridgeUi();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      probeConnectionOnResume();
    }
  });
  window.addEventListener("focus", probeConnectionOnResume);
  window.addEventListener("pageshow", probeConnectionOnResume);
  window.addEventListener("online", probeConnectionOnResume);

  readyPromise
    .then(() => {
      processShim.env = runtimeConfig?.userEnv || {};
    })
    .catch((error) => {
      console.error("[bridge] Failed to initialize browser shim", error);
      document.body.innerHTML = "<pre>Bridge init failed. Check browser console.</pre>";
    });
})();`;
}

export { renderAgentManagerHtml, renderShimJs };
