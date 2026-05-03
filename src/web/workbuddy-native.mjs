const FALLBACK_BUDDY_API_METHODS = [
  "createSession",
  "deleteSession",
  "listSessions",
  "loadSession",
  "prompt",
  "cancel",
  "respondToPermission",
  "getSession",
  "workbuddyRemoteGetSessionMessagesPage",
  "onSessionUpserted",
  "onSessionDeleted",
  "onSessionEvent",
  "onSessionNavigate",
  "login",
  "logout",
  "getAccount",
  "getUserInfo",
  "openExternal",
  "openPath",
  "pickFile",
  "pickFolder",
  "selectFile",
  "selectDirectory",
  "getAppVersion",
  "getAppPlatform",
  "getAppLocale",
  "configGet",
  "configSet",
  "configGetAll",
  "workspaceGetCurrent",
  "workspaceGenerateDefaultCwd",
  "workspaceOpen",
  "workspaceOpenFolder",
  "workspaceSearchFile",
  "workspaceCheckPathExists",
  "storageGetSessions",
  "storageGetWorkspaces",
  "$on",
];

function renderWorkBuddyNativeHtml(sourceHtml) {
  const shimTag = '  <script src="/bridge/workbuddy-native-shim.js"></script>\n';
  let html = sourceHtml;
  if (!html.includes("/bridge/workbuddy-native-shim.js")) {
    html = html.replace(/(<script\s+type="module"\s+crossorigin\s+src=)/u, `${shimTag}$1`);
  }
  html = html.replace(
    /\b(src|href)=(["']\.\/assets\/(?:index|setting)-[\w-]+\.js)(["'])/gu,
    '$1=$2?wb-remote-patch=10$3'
  );
  return html;
}

function renderWorkBuddyNativeShimJs({
  methods = [],
  version = "",
  locale = "",
  enableFileManager = true,
  enableRestart = true,
  maskBridgeModelSecrets = false,
} = {}) {
  const methodList = [...new Set([...FALLBACK_BUDDY_API_METHODS, ...methods])];
  return `(() => {
  const apiMethods = ${JSON.stringify(methodList)};
  const workBuddyVersion = ${JSON.stringify(version || "")};
  const workBuddyLocale = ${JSON.stringify(locale || "")};
  const fileManagerEnabled = ${JSON.stringify(enableFileManager !== false)};
  const restartEnabled = ${JSON.stringify(enableRestart !== false)};
  const maskBridgeModelSecrets = ${JSON.stringify(maskBridgeModelSecrets === true)};
  const pending = new Map();
  const listeners = new Map();
  const incomingChunkedMessages = new Map();
  let outgoingChunkSeq = 0;
  const wsChunkChars = 4 * 1024 * 1024;
  const remoteHistoryPageMessages = 120;
  const inFlightBuddyApiCalls = new Map();
  let lastRemoteHistoryLoadAt = 0;
  let socket = null;
  let readyPromise = null;
  let requestId = 0;
  let statusBanner = null;
  let restartAvailable = true;
  let restartInProgress = false;
  let fileManagerOpenPromise = null;
  const pendingUploadProgress = new Map();
  let lastWorkspaceNameHint = "";
  let nativeNewWorkspaceIntentAt = 0;
  let nativeNewWorkspaceCanceledAt = 0;
  let pendingNativeNewWorkspacePath = "";
  let pendingLoginPopup = null;
  let pendingLoginPopupNavigated = false;
  let loginAuthUrlCaptureDepth = 0;
  let lastLoginAuthUrl = "";
  let lastLoginAuthUrlOpenedAt = 0;

  const eventMethodPattern = /^(?:on[A-Z]|\\$on$)/u;
  const messages = {
    zhCN: {
      fileManager: "文件管理",
      chooseWorkspaceOnHost: "选择服务器端上的工作空间",
      chooseWorkspaceSubtitle: "先选可操作根目录，再选择一个工作空间；也可以在下拉菜单中直接新建文件夹。",
      searchWorkspaces: "搜索工作空间",
      searchWorkspacePlaceholder: "输入名字过滤列表",
      chooseThisFolder: "选择此文件夹",
      loadingWorkspaces: "正在加载工作空间...",
      scanningWorkspaceRoot: "正在扫描根目录...",
      noWorkspaceOnDrive: "这个根目录下还没有工作空间。",
      noMatchingWorkspace: "没有匹配的工作空间。",
      workspaceRootMissing: "未找到工作空间根目录。",
      failedLoadDriveContents: "加载根目录内容失败。",
      restartProgram: "重启程序",
      restartConfirmTitle: "确认重启程序",
      restartConfirmDescription: "这会关闭当前用户正在运行的所有 WorkBuddy 进程和当前 bridge，然后重新启动一次。",
      restartConfirmAction: "确认重启",
      restartConfirmWarning: "会结束当前用户下的所有 WorkBuddy 进程，请确认没有其他正在进行的任务。",
      restartStarting: "正在重启 WorkBuddy。完成后请手动刷新页面。",
      drive: "根目录",
      selectDrive: "请选择根目录",
      workspace: "工作空间",
      selectWorkspace: "请选择工作空间",
      createFolder: "+ 新建文件夹...",
      manageWorkspaces: "管理工作空间",
      manageWorkspacesTitle: "管理工作空间",
      newWorkspace: "新建工作空间",
      workspaceName: "工作空间名称",
      renameWorkspace: "改名",
      renameWorkspaceTitle: "重命名工作空间",
      deleteWorkspaceTitle: "删除工作空间",
      deleteWorkspaceDescription: "确定要永久删除工作空间“{name}”及其中所有文件吗？删除后无法恢复。",
      failedRenameWorkspace: "重命名工作空间失败。",
      failedDeleteWorkspace: "删除工作空间失败。",
      refresh: "刷新",
      close: "关闭",
      cancel: "取消",
      confirm: "确定",
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
      upload: "确认上传",
      delete: "删除",
      deleteFileTitle: "确认删除文件",
      deleteFileDescription: "确定要永久删除文件“{name}”吗？删除后无法恢复。",
      failedDeleteFile: "删除文件失败。",
      download: "下载",
      selectedFilesSuffix: " 等 {count} 个文件",
      selectedFiles: "已选择：{names}{suffix}",
      selectedFilesHint: "已选择文件，点击这里可重新选择，或直接继续拖拽替换。",
      uploadProgress: "正在上传：{percent}% ({loaded} / {total})",
      uploadComplete: "已上传 {names} 到 {workspace}",
      currentWorkspace: "当前工作空间：{path}",
      currentRoot: "当前根目录：{path}",
      noWorkspaceAvailable: "还没有可用的工作空间。",
      selectDriveFirst: "请先选择一个根目录。",
      failedLoadWorkspaces: "加载工作空间失败。",
      emptyNewFolderName: "新建文件夹名称不能为空。",
      failedCreateWorkspace: "创建工作空间失败。",
      chooseFilesFirst: "请先选择要上传的文件。",
      hostConnectionClosed: "与服务器端上的 WorkBuddy 连接已断开。请稍后刷新重试。",
    },
    en: {
      fileManager: "File Manager",
      chooseWorkspaceOnHost: "Choose a workspace on the host",
      chooseWorkspaceSubtitle: "Select an allowed root first, then choose a workspace. You can also create a new folder directly from the dropdown.",
      searchWorkspaces: "Search workspaces",
      searchWorkspacePlaceholder: "Type a name to filter the list",
      chooseThisFolder: "Use this folder",
      loadingWorkspaces: "Loading workspaces...",
      scanningWorkspaceRoot: "Scanning workspace root...",
      noWorkspaceOnDrive: "No workspace exists in this root yet.",
      noMatchingWorkspace: "No matching workspace was found.",
      workspaceRootMissing: "Workspace root was not found.",
      failedLoadDriveContents: "Failed to load root contents.",
      restartProgram: "Restart",
      restartConfirmTitle: "Restart app",
      restartConfirmDescription: "This will close every WorkBuddy process for the current user and the current bridge, then start one instance again.",
      restartConfirmAction: "Restart",
      restartConfirmWarning: "All WorkBuddy processes owned by the current user will be stopped. Make sure no other task is still running.",
      restartStarting: "Restarting WorkBuddy. Refresh this page manually after it starts again.",
      drive: "Root",
      selectDrive: "Select a root",
      workspace: "Workspace",
      selectWorkspace: "Select a workspace",
      createFolder: "+ Create new folder...",
      manageWorkspaces: "Manage workspaces",
      manageWorkspacesTitle: "Manage workspaces",
      newWorkspace: "New workspace",
      workspaceName: "Workspace name",
      renameWorkspace: "Rename",
      renameWorkspaceTitle: "Rename workspace",
      deleteWorkspaceTitle: "Delete workspace",
      deleteWorkspaceDescription: "Permanently delete workspace \\"{name}\\" and all files inside it? This cannot be undone.",
      failedRenameWorkspace: "Failed to rename workspace.",
      failedDeleteWorkspace: "Failed to delete workspace.",
      refresh: "Refresh",
      close: "Close",
      cancel: "Cancel",
      confirm: "OK",
      deleteConfirm: "Delete",
      deleteWarning: "This will delete the file directly from the host machine and cannot be undone.",
      fileManagerSubtitle: "Only files inside the allowed workspace roots on the host machine can be managed here.",
      workspaceActionHint: "After you select a workspace, you can upload files or delete files inside it.",
      uploadFiles: "Upload files",
      dropFilesHint: "Drag files here, or click to choose files",
      noFilesSelected: "No files selected.",
      selectWorkspaceFirst: "Select a workspace first.",
      loadingFiles: "Loading files...",
      workspaceEmpty: "This workspace does not contain any files yet.",
      upload: "Upload",
      delete: "Delete",
      deleteFileTitle: "Delete file",
      deleteFileDescription: "Are you sure you want to permanently delete \\"{name}\\"? This action cannot be undone.",
      failedDeleteFile: "Failed to delete the file.",
      download: "Download",
      selectedFilesSuffix: ", {count} files total",
      selectedFiles: "Selected: {names}{suffix}",
      selectedFilesHint: "Files selected. Click here to choose again, or drag more files here to replace them.",
      uploadProgress: "Uploading: {percent}% ({loaded} / {total})",
      uploadComplete: "Uploaded {names} to {workspace}",
      currentWorkspace: "Current workspace: {path}",
      currentRoot: "Current root: {path}",
      noWorkspaceAvailable: "No workspace is available yet.",
      selectDriveFirst: "Select a root first.",
      failedLoadWorkspaces: "Failed to load workspaces.",
      emptyNewFolderName: "The new folder name cannot be empty.",
      failedCreateWorkspace: "Failed to create the workspace.",
      chooseFilesFirst: "Choose files to upload first.",
      hostConnectionClosed: "The connection to WorkBuddy on the host machine was lost. Refresh and try again.",
    },
  };

  function getUiLanguage() {
    return /^en(?:[-_]|$)/i.test(String(workBuddyLocale || "").trim()) ? "en" : "zhCN";
  }

  function t(key, values = {}) {
    const template = messages[getUiLanguage()]?.[key] || messages.zhCN[key] || key;
    return String(template).replace(/\\{(\\w+)\\}/g, (_match, name) => values?.[name] ?? "");
  }

  const sensitiveFieldLabels = {
    apiKey: ["API KEY", "APIKEY", "API KEY:", "API KEY：", "API 密钥", "密钥"],
    endpoint: ["接口地址", "API 地址", "BASE URL", "BASEURL", "ENDPOINT", "API URL"],
  };

  function normalizeLabelText(value) {
    return String(value || "")
      .replace(/\\s+/g, " ")
      .trim()
      .replace(/[：:*]+$/u, "")
      .trim()
      .toUpperCase();
  }

  function getFieldTypeFromLabel(value) {
    const normalized = normalizeLabelText(value);
    for (const [fieldType, labels] of Object.entries(sensitiveFieldLabels)) {
      if (labels.includes(normalized)) {
        return fieldType;
      }
    }
    return null;
  }

  function findSensitiveFieldContainer(labelElement) {
    let current = labelElement;
    for (let depth = 0; current && depth < 6; depth += 1) {
      const parent = current.parentElement;
      if (!parent || parent === document.body) {
        break;
      }

      if (parent.querySelectorAll("input:not([type='hidden']), textarea").length > 0) {
        return parent;
      }
      current = parent;
    }
    return null;
  }

  function hideSensitiveFieldRevealControls(fieldContainer) {
    if (!fieldContainer) {
      return;
    }

    for (const button of fieldContainer.querySelectorAll("button")) {
      if (normalizeLabelText(button.textContent)) {
        continue;
      }
      if (button.dataset.wbSensitiveButtonMasked === "true") {
        continue;
      }
      button.dataset.wbSensitiveButtonMasked = "true";
      button.style.display = "none";
    }
  }

  function maskSensitiveInput(input, fieldType) {
    if (!input || input.dataset.wbSensitiveMasked === "true") {
      return;
    }

    input.dataset.wbSensitiveMasked = "true";
    input.dataset.wbSensitiveType = fieldType;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.style.webkitTextSecurity = "disc";
  }

  function maskSensitiveModelFields() {
    if (!maskBridgeModelSecrets) {
      return;
    }

    for (const element of document.querySelectorAll("label, span, div, p")) {
      const fieldType = getFieldTypeFromLabel(element.textContent);
      if (!fieldType) {
        continue;
      }

      const fieldContainer = findSensitiveFieldContainer(element);
      const input = fieldContainer?.querySelector("input:not([type='hidden']), textarea");
      if (!input) {
        continue;
      }

      maskSensitiveInput(input, fieldType);
      if (fieldType === "apiKey") {
        hideSensitiveFieldRevealControls(fieldContainer);
      }
    }
  }

  function formatFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) {
      return value + " B";
    }
    if (value < 1024 * 1024) {
      return (value / 1024).toFixed(1) + " KB";
    }
    if (value < 1024 * 1024 * 1024) {
      return (value / 1024 / 1024).toFixed(1) + " MB";
    }
    return (value / 1024 / 1024 / 1024).toFixed(1) + " GB";
  }

  function ensureStatusBanner() {
    if (statusBanner) {
      return statusBanner;
    }
    statusBanner = document.createElement("div");
    statusBanner.style.cssText = "position:fixed;top:36px;right:12px;z-index:2147483647;max-width:360px;padding:10px 12px;border-radius:10px;font:12px/1.5 sans-serif;color:#fff;background:rgba(179,66,66,.92);box-shadow:0 8px 24px rgba(0,0,0,.28);display:none;";
    document.body.appendChild(statusBanner);
    return statusBanner;
  }

  function setBridgeStatus(message) {
    const banner = ensureStatusBanner();
    if (!message) {
      banner.style.display = "none";
      banner.textContent = "";
      return;
    }
    banner.textContent = message;
    banner.style.display = "block";
  }

  function showBridgeToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:420px;padding:10px 12px;border-radius:10px;background:rgba(17,24,39,.96);color:#eef2ff;font:12px/1.5 'Segoe UI',sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.32);";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  function fetchJson(url, options = {}) {
    return fetch(url, { cache: "no-store", ...options }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "HTTP " + response.status);
      }
      return payload;
    });
  }

  function fetchWorkspaceRoots() {
    return fetchJson("/bridge/workspace-roots").then((payload) => payload.roots || []);
  }

  function fetchWorkspaceFolders(rootPath) {
    return fetchJson("/bridge/workspace-folders?rootPath=" + encodeURIComponent(rootPath || ""));
  }

  function fetchWorkspaceContextCandidates() {
    return fetchJson("/bridge/workspace-context")
      .then((payload) => Array.isArray(payload?.paths) ? payload.paths : [])
      .catch(() => []);
  }

  function createWorkspaceFolder(rootPath, name) {
    return fetchJson("/bridge/workspace-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath, name }),
    });
  }

  function renameWorkspaceFolder(folderPath, name) {
    return fetchJson("/bridge/workspace-folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath, name }),
    });
  }

  function deleteWorkspaceFolder(folderPath) {
    return fetchJson("/bridge/workspace-folders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath }),
    });
  }

  function fetchWorkspaceFiles(folderPath) {
    return fetchJson("/bridge/workspace-files?folderPath=" + encodeURIComponent(folderPath || ""));
  }

  function deleteWorkspaceEntryRequest(targetPath) {
    return fetchJson("/bridge/workspace-files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPath }),
    });
  }

  function uploadWorkspaceFile(folderPath, file, onProgress) {
    return new Promise((resolve, reject) => {
      const uploadId = "upload-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      const request = new XMLHttpRequest();
      const params = new URLSearchParams({
        folderPath,
        fileName: file.name,
        uploadId,
      });
      const cleanup = () => pendingUploadProgress.delete(uploadId);

      pendingUploadProgress.set(uploadId, (message) => {
        onProgress?.(Math.min(file.size, Number(message.loadedBytes) || 0));
      });
      request.open("POST", "/bridge/workspace-files?" + params.toString());
      request.responseType = "json";
      request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      request.upload.onprogress = (event) => {
        onProgress?.(Math.min(file.size, Number(event.loaded) || 0));
      };
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
  }

  async function uploadWorkspaceFiles(folderPath, files, onProgress) {
    await connect();
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let completedBytes = 0;
    const uploaded = [];
    for (const file of files) {
      const result = await uploadWorkspaceFile(folderPath, file, (loadedBytes) => {
        onProgress?.({
          loadedBytes: completedBytes + loadedBytes,
          totalBytes,
        });
      });
      uploaded.push(result);
      completedBytes += file.size;
      onProgress?.({
        loadedBytes: completedBytes,
        totalBytes,
      });
    }
    return uploaded;
  }

  function createUploadProgressControl() {
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
          text.textContent = "";
          bar.style.width = "0%";
          return;
        }
        const total = Math.max(0, Number(progress.totalBytes) || 0);
        const loaded = Math.max(0, Number(progress.loadedBytes) || 0);
        const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        element.style.display = "flex";
        text.textContent = t("uploadProgress", {
          percent,
          loaded: formatFileSize(loaded),
          total: formatFileSize(total),
        });
        bar.style.width = percent + "%";
      },
    };
  }

  function normalizeLocalPathInput(value) {
    const input = String(value || "").trim();
    if (!input) {
      return "";
    }
    if (/^(?:file|vscode-file):/iu.test(input)) {
      try {
        const parsed = new URL(input);
        let pathname = decodeURIComponent(parsed.pathname || "");
        if (/^\\/[A-Za-z]:\\//u.test(pathname)) {
          pathname = pathname.slice(1);
        }
        return pathname.replace(/\\//g, "\\\\");
      } catch {
        return input;
      }
    }
    return input.replace(/\\//g, "\\\\");
  }

  function normalizeComparablePath(value) {
    const normalized = normalizeLocalPathInput(value);
    return normalized ? normalized.replace(/[\\\\]+$/g, "").toLowerCase() : "";
  }

  function isSameOrChildPath(parentPath, childPath) {
    const parent = normalizeComparablePath(parentPath);
    const child = normalizeComparablePath(childPath);
    return Boolean(parent && child && (child === parent || child.startsWith(parent + "\\\\")));
  }

  function isLocalPathLike(value) {
    const input = String(value || "").trim();
    return /^(?:file|vscode-file):/iu.test(input) || /^[A-Za-z]:[\\\\/]/u.test(input);
  }

  function isRelativePathLike(value) {
    const input = String(value || "").trim();
    return Boolean(input && !isLocalPathLike(input) && !/^[a-z][a-z0-9+.-]*:/iu.test(input));
  }

  function loopbackUrlOriginForBridge(url) {
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      return "";
    }

    const hostname = String(url.hostname || "").toLowerCase().replace(/^\\[|\\]$/g, "");
    if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
      return "";
    }

    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return window.location.origin + "/bridge/loopback/" + url.protocol.replace(/:$/u, "") + "/" + port;
  }

  function rewriteLoopbackHttpUrlForBridge(value) {
    const input = String(value || "").trim();
    if (!input) {
      return "";
    }

    try {
      const url = new URL(input);
      const bridgeOrigin = loopbackUrlOriginForBridge(url);
      return bridgeOrigin ? bridgeOrigin + url.pathname + url.search + url.hash : "";
    } catch {
      return "";
    }
  }

  function rewriteLoopbackUrlStringForBridge(value) {
    const direct = rewriteLoopbackHttpUrlForBridge(value);
    const input = direct || String(value || "")
      .replace(/\\bhttps?:\\/\\/(?:127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d{1,5})?/giu, (match) => {
        try {
          const url = new URL(match);
          return loopbackUrlOriginForBridge(url) || match;
        } catch {
          return match;
        }
      });

    return input
      .replace(/\\bhttps?%3A%2F%2F(?:localhost|127(?:\\.|%2E)0(?:\\.|%2E)0(?:\\.|%2E)1|%5B%3A%3A1%5D)(?:%3A\\d{1,5})?/giu, (match) => {
        try {
          const url = new URL(decodeURIComponent(match));
          const bridgeOrigin = loopbackUrlOriginForBridge(url);
          return bridgeOrigin ? encodeURIComponent(bridgeOrigin) : match;
        } catch {
          return match;
        }
      });
  }

  function rewriteLoopbackUrlsInValue(value, depth = 0) {
    if (depth > 8) {
      return value;
    }
    if (typeof value === "string") {
      return rewriteLoopbackUrlStringForBridge(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => rewriteLoopbackUrlsInValue(item, depth + 1));
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    const result = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = rewriteLoopbackUrlsInValue(nestedValue, depth + 1);
    }
    return result;
  }

  function shouldRewriteLoopbackBuddyApiResult(method) {
    return (
      method === "getDocumentPreviewUrl" ||
      method === "tdocGetPreviewUrl" ||
      method === "getSessionArtifacts"
    );
  }

  function joinWindowsPath(parent, child) {
    const cleanParent = String(parent || "").replace(/[\\\\/]+$/g, "");
    const cleanChild = String(child || "").replace(/^[\\\\/]+/g, "");
    return cleanParent && cleanChild ? cleanParent + "\\\\" + cleanChild.replace(/\\//g, "\\\\") : cleanParent || cleanChild;
  }

  function choosePreferredRoot(roots, targetPath) {
    const normalizedTarget = normalizeLocalPathInput(targetPath).toLowerCase();
    if (normalizedTarget) {
      const match = roots.find((entry) => normalizedTarget === String(entry.path).toLowerCase() || normalizedTarget.startsWith(String(entry.path).toLowerCase() + "\\\\"));
      if (match) {
        return match.path;
      }
    }
    try {
      return localStorage.getItem("__workbuddy_remote_last_workspace_root__") || roots[0]?.path || "";
    } catch {
      return roots[0]?.path || "";
    }
  }

  function choosePreferredFolder(folders, targetPath) {
    const normalizedTarget = normalizeLocalPathInput(targetPath).toLowerCase();
    if (!normalizedTarget) {
      return "";
    }
    const matches = folders
      .filter((entry) => normalizedTarget === String(entry.path).toLowerCase() || normalizedTarget.startsWith(String(entry.path).toLowerCase() + "\\\\"))
      .sort((left, right) => String(right.path).length - String(left.path).length);
    return matches[0]?.path || "";
  }

  const workspaceFolderLookupCache = new Map();

  async function fetchWorkspaceFoldersForLookup(rootPath) {
    if (!workspaceFolderLookupCache.has(rootPath)) {
      workspaceFolderLookupCache.set(rootPath, fetchWorkspaceFolders(rootPath));
    }
    return workspaceFolderLookupCache.get(rootPath);
  }

  async function findWorkspaceFolderByPath(targetPath, roots) {
    const root = (roots || []).find((entry) => isSameOrChildPath(entry.path, targetPath));
    if (!root) {
      return null;
    }

    const payload = await fetchWorkspaceFoldersForLookup(root.path);
    const folder = (payload?.folders || [])
      .filter((entry) => isSameOrChildPath(entry.path, targetPath))
      .sort((left, right) => String(right.path || "").length - String(left.path || "").length)[0];
    return folder ? { rootPath: root.path, folder } : null;
  }

  function getPathBasename(targetPath) {
    return String(targetPath || "").replace(/[\\\\/]+$/g, "").split(/[\\\\/]/u).filter(Boolean).pop() || "";
  }

  function normalizeWorkspaceName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function readWorkspaceNameFromElement(element) {
    const workspaceItem = element?.closest?.(".workspace-drag-item");
    const text = workspaceItem?.innerText || workspaceItem?.textContent || "";
    return String(text).split(/\\r?\\n/u).map((line) => line.trim()).find(Boolean) || "";
  }

  function rememberWorkspaceHintFromElement(element) {
    const workspaceName = readWorkspaceNameFromElement(element);
    if (workspaceName) {
      lastWorkspaceNameHint = workspaceName;
    }
  }

  function isNativeNewWorkspaceText(text) {
    const normalized = String(text || "").replace(/[✓✔]/gu, "").replace(/\s+/g, " ").trim();
    return /^(?:从新工作空间开始|Start from a new workspace)$/iu.test(normalized);
  }

  function getNativeNewWorkspaceElementFromEvent(event) {
    for (const item of event.composedPath?.() || []) {
      if (!item || item.nodeType !== 1 || item === document.body || item === document.documentElement) {
        continue;
      }
      const text = [
        item.getAttribute?.("aria-label"),
        item.getAttribute?.("title"),
        item.textContent,
      ]
        .filter(Boolean)
        .join(" ");
      if (text.length <= 80 && isNativeNewWorkspaceText(text)) {
        return item;
      }
    }
    return null;
  }

  function rememberNativeNewWorkspaceIntentFromEvent(event) {
    if (getNativeNewWorkspaceElementFromEvent(event)) {
      nativeNewWorkspaceIntentAt = Date.now();
    }
  }

  function hasRecentNativeNewWorkspaceIntent() {
    return nativeNewWorkspaceIntentAt > 0 && Date.now() - nativeNewWorkspaceIntentAt < 5000;
  }

  function getWorkspaceNameHintFromPage() {
    const focusedName = readWorkspaceNameFromElement(document.activeElement);
    if (focusedName) {
      return focusedName;
    }
    for (const selector of [".workspace-drag-item:focus-within", ".workspace-drag-item .conversation-agent-card:focus"]) {
      const name = readWorkspaceNameFromElement(document.querySelector(selector));
      if (name) {
        return name;
      }
    }
    return lastWorkspaceNameHint;
  }

  async function findWorkspaceFolderByName(workspaceName, roots) {
    const wantedName = normalizeWorkspaceName(workspaceName);
    if (!wantedName) {
      return null;
    }

    for (const root of roots || []) {
      const payload = await fetchWorkspaceFoldersForLookup(root.path);
      const folder = (payload?.folders || []).find((entry) => {
        return normalizeWorkspaceName(entry.name) === wantedName || normalizeWorkspaceName(getPathBasename(entry.path)) === wantedName;
      });
      if (folder) {
        return { rootPath: root.path, folder };
      }
    }
    return null;
  }

  function collectWorkspacePathHintsFromPage() {
    const paths = [];
    const seen = new Set();
    const add = (value) => {
      const pathValue = normalizeLocalPathInput(value);
      const key = pathValue.toLowerCase();
      if (!isLocalPathLike(pathValue) || seen.has(key)) {
        return;
      }
      seen.add(key);
      paths.push({ path: pathValue });
    };
    const collectMatches = (text) => {
      const matches = String(text || "").match(/[A-Za-z]:[\\/][^<>"'|?\\r\\n]+/gu) || [];
      for (const match of matches) {
        add(match.trim());
      }
    };

    collectMatches(location.href);
    collectMatches(document.title);
    collectMatches(document.body?.innerText?.slice(0, 160000));
    for (const storage of [localStorage, sessionStorage]) {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index) || "";
          if (/(workspace|session|cwd|path|folder)/iu.test(key)) {
            collectMatches(storage.getItem(key)?.slice(0, 30000));
          }
        }
      } catch {}
    }

    return paths;
  }

  async function getWorkspaceContextPaths() {
    const paths = [];
    const add = (value) => {
      const pathValue = normalizeLocalPathInput(typeof value === "string" ? value : value?.path);
      if (isLocalPathLike(pathValue)) {
        paths.push({ path: pathValue });
      }
    };

    add(await getCurrentWorkspacePath());
    for (const entry of await fetchWorkspaceContextCandidates()) {
      add(entry);
    }
    for (const entry of collectWorkspacePathHintsFromPage()) {
      add(entry);
    }
    return paths;
  }

  async function resolvePreferredWorkspaceSelection(roots, targetPath) {
    const matchedTarget = targetPath ? await findWorkspaceFolderByPath(targetPath, roots) : null;
    if (matchedTarget) {
      return { rootPath: matchedTarget.rootPath, folderPath: matchedTarget.folder.path };
    }

    const matchedWorkspaceHint = await findWorkspaceFolderByName(getWorkspaceNameHintFromPage(), roots);
    if (matchedWorkspaceHint) {
      return { rootPath: matchedWorkspaceHint.rootPath, folderPath: matchedWorkspaceHint.folder.path };
    }

    for (const entry of await getWorkspaceContextPaths()) {
      const matched = await findWorkspaceFolderByPath(entry.path, roots);
      if (matched) {
        return { rootPath: matched.rootPath, folderPath: matched.folder.path };
      }
    }

    return {
      rootPath: choosePreferredRoot(roots, ""),
      folderPath: "",
    };
  }

  function getPathCandidateFromArgs(args) {
    const first = args?.[0];
    if (typeof first === "string") {
      return first;
    }
    if (first && typeof first === "object") {
      for (const key of ["path", "folderPath", "workspacePath", "cwd", "defaultPath"]) {
        if (typeof first[key] === "string" && first[key]) {
          return first[key];
        }
      }
    }
    return "";
  }

  function readWorkspacePath(value) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (!value || typeof value !== "object") {
      return "";
    }
    for (const key of ["path", "folderPath", "workspacePath", "cwd", "fsPath"]) {
      if (typeof value[key] === "string" && value[key].trim()) {
        return value[key].trim();
      }
    }
    return "";
  }

  async function getCurrentWorkspacePath() {
    try {
      const current = await forwardBuddyApiCall("workspaceGetCurrent", []);
      return readWorkspacePath(current);
    } catch {
      return "";
    }
  }

  async function resolveCurrentWorkspaceFolderPath(targetPath = "") {
    const roots = await fetchWorkspaceRoots();
    const normalizedTargetPath = normalizeLocalPathInput(targetPath);
    const matchedTarget = normalizedTargetPath ? await findWorkspaceFolderByPath(normalizedTargetPath, roots) : null;
    if (matchedTarget) {
      return matchedTarget.folder.path;
    }

    const matchedWorkspaceHint = await findWorkspaceFolderByName(getWorkspaceNameHintFromPage(), roots);
    if (matchedWorkspaceHint) {
      return matchedWorkspaceHint.folder.path;
    }

    const currentWorkspacePath = normalizeLocalPathInput(await getCurrentWorkspacePath());
    const matchedCurrent = currentWorkspacePath ? await findWorkspaceFolderByPath(currentWorkspacePath, roots) : null;
    return matchedCurrent?.folder?.path || "";
  }

  async function resolveFileManagerTargetPath(targetPath = "") {
    const normalizedTargetPath = normalizeLocalPathInput(targetPath);
    if (normalizedTargetPath && isLocalPathLike(normalizedTargetPath)) {
      return normalizedTargetPath;
    }
    if (!normalizedTargetPath) {
      return "";
    }

    const currentWorkspacePath =
      normalizeLocalPathInput(await resolveCurrentWorkspaceFolderPath()) ||
      normalizeLocalPathInput(await getCurrentWorkspacePath());
    if (normalizedTargetPath && currentWorkspacePath && isRelativePathLike(normalizedTargetPath)) {
      return joinWindowsPath(currentWorkspacePath, normalizedTargetPath);
    }

    return normalizedTargetPath;
  }

  function replacePathCandidateInArgs(args, folderPath) {
    const list = Array.isArray(args) ? [...args] : [];
    const first = list[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      list[0] = {
        ...first,
        path: folderPath,
        folderPath,
        workspacePath: folderPath,
        cwd: folderPath,
        defaultPath: folderPath,
      };
      return list;
    }
    if (typeof first === "string") {
      list[0] = folderPath;
      return list;
    }
    return [folderPath, ...list];
  }

  async function promptForRemoteFolderPath(defaultPath = "") {
    if (!fileManagerEnabled) {
      return undefined;
    }

    const roots = await fetchWorkspaceRoots();
    const preferred = await resolvePreferredWorkspaceSelection(roots, defaultPath);

    return new Promise((resolve, reject) => {
      let selectedRootPath = preferred.rootPath;
      let selectedFolderPath = preferred.folderPath;
      let folders = [];
      let filteredFolders = [];
      let loading = false;

      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;";

      const panel = document.createElement("div");
      panel.style.cssText = "width:min(860px,100%);max-height:min(820px,calc(100vh - 48px));overflow:hidden;border-radius:16px;background:#151823;color:#eef2ff;box-shadow:0 20px 60px rgba(0,0,0,.4);display:flex;flex-direction:column;font:14px/1.45 'Segoe UI',sans-serif;";
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
      body.style.cssText = "padding:0 24px 20px;display:flex;flex-direction:column;gap:14px;overflow:auto;";
      panel.appendChild(body);

      const topRow = document.createElement("div");
      topRow.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end;";
      body.appendChild(topRow);

      const rootField = document.createElement("label");
      rootField.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      topRow.appendChild(rootField);
      const rootLabel = document.createElement("span");
      rootLabel.textContent = t("drive");
      rootLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      rootField.appendChild(rootLabel);
      const rootSelect = document.createElement("select");
      rootSelect.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;";
      rootField.appendChild(rootSelect);
      const rootPlaceholder = document.createElement("option");
      rootPlaceholder.value = "";
      rootPlaceholder.textContent = t("selectDrive");
      rootSelect.appendChild(rootPlaceholder);
      for (const root of roots) {
        const option = document.createElement("option");
        option.value = root.path;
        option.textContent = root.label || root.path;
        rootSelect.appendChild(option);
      }
      rootSelect.value = selectedRootPath;

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
      refreshButton.style.cssText = "height:40px;padding:0 16px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      topRow.appendChild(refreshButton);

      const workspaceHint = document.createElement("div");
      workspaceHint.style.cssText = "padding:10px 14px;border:1px solid #2c3350;border-radius:10px;background:#11162a;color:#9aa4c7;";
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
      searchInput.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;outline:none;";
      searchField.appendChild(searchInput);

      const listWrapper = document.createElement("div");
      listWrapper.style.cssText = "min-height:260px;max-height:360px;overflow:auto;border:1px solid #2c3350;border-radius:12px;background:#0d1120;padding:8px;display:flex;flex-direction:column;gap:8px;";
      body.appendChild(listWrapper);
      const emptyState = document.createElement("div");
      emptyState.style.cssText = "padding:36px 12px;text-align:center;color:#7d89b4;font-size:13px;";

      const footer = document.createElement("div");
      footer.style.cssText = "padding:16px 24px 24px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #232a42;";
      panel.appendChild(footer);
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.textContent = t("cancel");
      cancelButton.style.cssText = "height:40px;padding:0 16px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      footer.appendChild(cancelButton);
      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.textContent = t("chooseThisFolder");
      confirmButton.style.cssText = "height:40px;padding:0 16px;border:none;border-radius:10px;background:#6ea8fe;color:#09111f;font-weight:700;cursor:pointer;";
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

      const getFilteredFolders = () => {
        const keyword = searchInput.value.trim().toLowerCase();
        return keyword
          ? folders.filter((folder) => folder.name.toLowerCase().includes(keyword))
          : [...folders];
      };

      const renderWorkspaceOptions = () => {
        workspaceSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = loading ? t("loadingWorkspaces") : t("selectWorkspace");
        workspaceSelect.appendChild(placeholder);
        for (const folder of getFilteredFolders()) {
          const option = document.createElement("option");
          option.value = folder.path;
          option.textContent = folder.name;
          workspaceSelect.appendChild(option);
        }
        workspaceSelect.appendChild(createWorkspaceOption);
        workspaceSelect.value = folders.some((folder) => folder.path === selectedFolderPath) ? selectedFolderPath : "";
      };

      const applyFilter = () => {
        filteredFolders = getFilteredFolders();
        renderWorkspaceOptions();
        listWrapper.replaceChildren();
        if (!selectedRootPath) {
          emptyState.textContent = t("selectDriveFirst");
          listWrapper.appendChild(emptyState);
        } else if (loading) {
          emptyState.textContent = t("scanningWorkspaceRoot");
          listWrapper.appendChild(emptyState);
        } else if (filteredFolders.length === 0) {
          emptyState.textContent = folders.length === 0 ? t("noWorkspaceOnDrive") : t("noMatchingWorkspace");
          listWrapper.appendChild(emptyState);
        } else {
          for (const folder of filteredFolders) {
            const item = document.createElement("button");
            item.type = "button";
            item.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:6px;width:100%;padding:12px 14px;border:1px solid " + (folder.path === selectedFolderPath ? "#6ea8fe" : "#2b3453") + ";border-radius:10px;background:" + (folder.path === selectedFolderPath ? "#18253d" : "#12182b") + ";color:#eef2ff;cursor:pointer;text-align:left;";
            const name = document.createElement("span");
            name.textContent = folder.name;
            name.style.cssText = "display:block;font-weight:700;font-size:15px;line-height:1.35;";
            item.appendChild(name);
            const folderPath = document.createElement("span");
            folderPath.textContent = folder.path;
            folderPath.style.cssText = "display:block;font-size:12px;line-height:1.45;color:#9aa4c7;word-break:break-all;";
            item.appendChild(folderPath);
            item.addEventListener("click", () => {
              selectedFolderPath = folder.path;
              renderWorkspaceOptions();
              applyFilter();
            });
            item.addEventListener("dblclick", () => finish([folder.path]));
            listWrapper.appendChild(item);
          }
        }
        confirmButton.disabled = loading || !selectedFolderPath;
        workspaceHint.textContent = selectedFolderPath
          ? t("currentWorkspace", { path: selectedFolderPath })
          : selectedRootPath
            ? t("noWorkspaceAvailable")
            : t("workspaceActionHint");
      };

      const setBusy = (busy) => {
        loading = busy;
        rootSelect.disabled = busy;
        workspaceSelect.disabled = busy;
        searchInput.disabled = busy;
        refreshButton.disabled = busy || !selectedRootPath;
        cancelButton.disabled = busy;
        confirmButton.disabled = busy || !selectedFolderPath;
      };

      const loadRootFolders = async (rootPath, preferredFolderPath = "") => {
        selectedRootPath = rootPath || "";
        selectedFolderPath = "";
        searchInput.value = "";
        if (!selectedRootPath) {
          folders = [];
          renderWorkspaceOptions();
          applyFilter();
          return;
        }
        try {
          localStorage.setItem("__workbuddy_remote_last_workspace_root__", selectedRootPath);
        } catch {}
        setBusy(true);
        folders = [];
        renderWorkspaceOptions();
        applyFilter();
        try {
          const payload = await fetchWorkspaceFolders(selectedRootPath);
          folders = payload?.folders || [];
          selectedFolderPath = preferredFolderPath && folders.some((folder) => folder.path === preferredFolderPath)
            ? preferredFolderPath
            : "";
          workspaceHint.textContent = payload?.workspaceRoot ? t("currentRoot", { path: payload.workspaceRoot }) : t("workspaceRootMissing");
        } catch (error) {
          folders = [];
          workspaceHint.textContent = t("failedLoadDriveContents");
          window.alert(error instanceof Error ? error.message : String(error));
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

      rootSelect.addEventListener("change", () => loadRootFolders(rootSelect.value).catch(fail));
      workspaceSelect.addEventListener("change", async () => {
        if (workspaceSelect.value === "__create_workspace__") {
          try {
            const result = await promptAndCreateWorkspace(selectedRootPath);
            if (result?.path) {
              await loadRootFolders(selectedRootPath, result.path);
            }
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
          } finally {
            renderWorkspaceOptions();
          }
          return;
        }
        selectedFolderPath = workspaceSelect.value;
        applyFilter();
      });
      refreshButton.addEventListener("click", () => loadRootFolders(rootSelect.value, selectedFolderPath).catch(fail));
      searchInput.addEventListener("input", applyFilter);
      cancelButton.addEventListener("click", () => finish(undefined));
      confirmButton.addEventListener("click", () => {
        if (selectedFolderPath) {
          finish([selectedFolderPath]);
        }
      });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          finish(undefined);
        }
      });

      document.addEventListener("keydown", onKeyDown, true);
      document.body.appendChild(overlay);
      renderWorkspaceOptions();
      applyFilter();
      loadRootFolders(selectedRootPath, selectedFolderPath).catch(fail);
    });
  }

  function pickFileAccept(options = {}) {
    const filters = Array.isArray(options.filters) ? options.filters : [];
    return filters
      .flatMap((filter) => Array.isArray(filter?.extensions) ? filter.extensions : [])
      .map((extension) => String(extension || "").trim())
      .filter(Boolean)
      .map((extension) => extension === "*" ? "" : extension.startsWith(".") ? extension : "." + extension)
      .filter(Boolean)
      .join(",");
  }

  async function pickBrowserFiles(options = {}) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = Boolean(options.canSelectMany || options.multiple);
      const accept = pickFileAccept(options);
      if (accept) {
        input.accept = accept;
      }
      input.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;";
      const cleanup = () => input.remove();
      input.addEventListener("change", () => {
        const files = Array.from(input.files || []);
        cleanup();
        resolve(files);
      }, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function pickAndUploadFiles(options = {}) {
    const files = await pickBrowserFiles(options);
    if (files.length === 0) {
      return {
        canceled: true,
        files: [],
      };
    }
    let folderPath = await resolveCurrentWorkspaceFolderPath(getPathCandidateFromArgs([options]));
    if (!folderPath) {
      const selected = await promptForRemoteFolderPath(getPathCandidateFromArgs([options]));
      folderPath = selected?.[0] || "";
    }
    if (!folderPath) {
      return {
        canceled: true,
        files: [],
      };
    }
    const uploaded = await uploadWorkspaceFiles(folderPath, files);
    const names = files.map((file) => file.name).join(", ");
    showBridgeToast(t("uploadComplete", { names, workspace: folderPath }));
    return {
      canceled: false,
      files: uploaded.map((entry) => entry.path).filter(Boolean),
    };
  }

  function confirmDestructiveAction(title, description, confirmLabel = t("deleteConfirm"), warningText = t("deleteWarning")) {
    return new Promise((resolveConfirm) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:24px;";
      const panel = document.createElement("div");
      panel.style.cssText = "width:min(480px,100%);border-radius:16px;background:#141824;color:#eef2ff;box-shadow:0 24px 64px rgba(0,0,0,.42);border:1px solid #3b2940;overflow:hidden;";
      overlay.appendChild(panel);
      const header = document.createElement("div");
      header.style.cssText = "padding:18px 20px 10px;font-size:18px;font-weight:700;color:#ffd5dc;";
      header.textContent = title;
      panel.appendChild(header);
      const body = document.createElement("div");
      body.style.cssText = "padding:0 20px 18px;color:#d6dcef;line-height:1.6;";
      body.textContent = description;
      panel.appendChild(body);
      if (warningText) {
        const warning = document.createElement("div");
        warning.style.cssText = "margin:0 20px 20px;padding:12px 14px;border-radius:12px;background:#341922;color:#ffd0d7;font-size:13px;font-weight:700;";
        warning.textContent = warningText;
        panel.appendChild(warning);
      }
      const footer = document.createElement("div");
      footer.style.cssText = "padding:0 20px 20px;display:flex;justify-content:flex-end;gap:10px;";
      panel.appendChild(footer);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = t("cancel");
      cancel.style.cssText = "height:38px;padding:0 14px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      footer.appendChild(cancel);
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.textContent = confirmLabel;
      confirm.style.cssText = "height:38px;padding:0 14px;border:none;border-radius:10px;background:#f87171;color:#230909;font-weight:800;cursor:pointer;";
      footer.appendChild(confirm);
      const cleanup = (value) => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        resolveConfirm(value);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(false);
        }
      };
      cancel.addEventListener("click", () => cleanup(false));
      confirm.addEventListener("click", () => cleanup(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          cleanup(false);
        }
      });
      document.addEventListener("keydown", onKeyDown, true);
      document.body.appendChild(overlay);
    });
  }

  function promptTextInput(title, label, defaultValue = "") {
    return new Promise((resolveInput) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:24px;";
      const panel = document.createElement("div");
      panel.style.cssText = "width:min(440px,100%);border-radius:16px;background:#141824;color:#eef2ff;box-shadow:0 24px 64px rgba(0,0,0,.42);border:1px solid #2c3350;overflow:hidden;";
      overlay.appendChild(panel);
      const header = document.createElement("div");
      header.style.cssText = "padding:18px 20px 12px;font-size:18px;font-weight:700;";
      header.textContent = title;
      panel.appendChild(header);
      const body = document.createElement("label");
      body.style.cssText = "padding:0 20px 18px;display:flex;flex-direction:column;gap:8px;color:#9aa4c7;font-size:12px;";
      body.textContent = label;
      panel.appendChild(body);
      const input = document.createElement("input");
      input.type = "text";
      input.value = defaultValue || "";
      input.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;outline:none;font:14px/1.4 'Segoe UI',sans-serif;";
      body.appendChild(input);
      const footer = document.createElement("div");
      footer.style.cssText = "padding:0 20px 20px;display:flex;justify-content:flex-end;gap:10px;";
      panel.appendChild(footer);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = t("cancel");
      cancel.style.cssText = "height:38px;padding:0 14px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      footer.appendChild(cancel);
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.textContent = t("confirm");
      confirm.style.cssText = "height:38px;padding:0 14px;border:none;border-radius:10px;background:#6ea8fe;color:#09111f;font-weight:800;cursor:pointer;";
      footer.appendChild(confirm);
      const cleanup = (value) => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        resolveInput(value);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(null);
        }
        if (event.key === "Enter") {
          event.preventDefault();
          cleanup(input.value);
        }
      };
      cancel.addEventListener("click", () => cleanup(null));
      confirm.addEventListener("click", () => cleanup(input.value));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          cleanup(null);
        }
      });
      document.addEventListener("keydown", onKeyDown, true);
      document.body.appendChild(overlay);
      input.focus();
      input.select();
    });
  }

  async function promptAndCreateWorkspace(rootPath) {
    if (!rootPath) {
      window.alert(t("selectDriveFirst"));
      return null;
    }
    const folderName = await promptTextInput(t("newWorkspace"), t("workspaceName"), "");
    if (folderName === null) {
      return null;
    }
    const trimmedName = folderName.trim();
    if (!trimmedName) {
      window.alert(t("emptyNewFolderName"));
      return null;
    }
    const result = await createWorkspaceFolder(rootPath, trimmedName);
    if (!result?.ok || !result.path) {
      window.alert(result?.error || t("failedCreateWorkspace"));
      return null;
    }
    workspaceFolderLookupCache.clear();
    return result;
  }

  async function promptAndCreateNativeWorkspace() {
    const roots = await fetchWorkspaceRoots();
    const preferred = await resolvePreferredWorkspaceSelection(roots, "");
    const rootPath = preferred.rootPath || roots[0]?.path || "";
    pendingNativeNewWorkspacePath = "";
    const result = await promptAndCreateWorkspace(rootPath);
    if (!result?.path) {
      pendingNativeNewWorkspacePath = "";
      nativeNewWorkspaceCanceledAt = Date.now();
      return "";
    }
    pendingNativeNewWorkspacePath = result.path;
    return result.path;
  }

  async function promptAndOpenNativeWorkspace() {
    nativeNewWorkspaceIntentAt = 0;
    const folderPath = await promptAndCreateNativeWorkspace();
    if (!folderPath) {
      return false;
    }
    pendingNativeNewWorkspacePath = "";
    await forwardBuddyApiCall("workspaceOpen", replacePathCandidateInArgs([], folderPath));
    return true;
  }

  async function resolveKnownWorkspaceFolderPath(targetPath) {
    const normalizedTargetPath = normalizeLocalPathInput(targetPath);
    if (!normalizedTargetPath || !isLocalPathLike(normalizedTargetPath)) {
      return "";
    }
    const roots = await fetchWorkspaceRoots();
    const matched = await findWorkspaceFolderByPath(normalizedTargetPath, roots);
    return matched?.folder?.path || "";
  }

  async function openWorkspaceManager({ roots = [], rootPath = "", folderPath = "" } = {}) {
    if (document.getElementById("wb-bridge-workspace-manager-overlay")) {
      return null;
    }

    return new Promise((resolve, reject) => {
      let selectedRootPath = rootPath || roots[0]?.path || "";
      let selectedFolderPath = folderPath || "";
      let folders = [];
      let filteredFolders = [];
      let loading = false;

      const overlay = document.createElement("div");
      overlay.id = "wb-bridge-workspace-manager-overlay";
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:24px;";
      const panel = document.createElement("div");
      panel.style.cssText = "width:min(820px,100%);max-height:min(760px,calc(100vh - 48px));overflow:hidden;border-radius:16px;background:#151823;color:#eef2ff;box-shadow:0 24px 64px rgba(0,0,0,.42);display:flex;flex-direction:column;font:14px/1.45 'Segoe UI',sans-serif;";
      overlay.appendChild(panel);

      const title = document.createElement("div");
      title.textContent = t("manageWorkspacesTitle");
      title.style.cssText = "padding:20px 24px 8px;font-size:20px;font-weight:700;";
      panel.appendChild(title);

      const body = document.createElement("div");
      body.style.cssText = "padding:0 24px 20px;display:flex;flex-direction:column;gap:14px;overflow:auto;";
      panel.appendChild(body);

      const topRow = document.createElement("div");
      topRow.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;";
      body.appendChild(topRow);

      const rootField = document.createElement("label");
      rootField.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      topRow.appendChild(rootField);
      const rootLabel = document.createElement("span");
      rootLabel.textContent = t("drive");
      rootLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      rootField.appendChild(rootLabel);
      const rootSelect = document.createElement("select");
      rootSelect.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;";
      rootField.appendChild(rootSelect);
      for (const root of roots) {
        const option = document.createElement("option");
        option.value = root.path;
        option.textContent = root.label || root.path;
        rootSelect.appendChild(option);
      }
      rootSelect.value = selectedRootPath;

      const createButton = document.createElement("button");
      createButton.type = "button";
      createButton.textContent = t("newWorkspace");
      createButton.style.cssText = "height:40px;padding:0 16px;border:none;border-radius:10px;background:#6ea8fe;color:#09111f;font-weight:700;cursor:pointer;";
      topRow.appendChild(createButton);

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
      searchInput.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;outline:none;";
      searchField.appendChild(searchInput);

      const listWrapper = document.createElement("div");
      listWrapper.style.cssText = "min-height:320px;max-height:420px;overflow:auto;border:1px solid #2c3350;border-radius:12px;background:#0d1120;padding:8px;display:flex;flex-direction:column;gap:8px;";
      body.appendChild(listWrapper);
      const emptyState = document.createElement("div");
      emptyState.style.cssText = "padding:36px 12px;text-align:center;color:#7d89b4;font-size:13px;";

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
        resolve({ rootPath: selectedRootPath, folderPath: selectedFolderPath });
      };
      const fail = (error) => {
        cleanup();
        reject(error);
      };
      const getFilteredFolders = () => {
        const keyword = searchInput.value.trim().toLowerCase();
        return keyword
          ? folders.filter((folder) => folder.name.toLowerCase().includes(keyword))
          : [...folders];
      };
      const setBusy = () => {
        rootSelect.disabled = loading;
        searchInput.disabled = loading;
        createButton.disabled = loading || !selectedRootPath;
        createButton.style.opacity = createButton.disabled ? ".55" : "1";
      };
      const renderList = () => {
        filteredFolders = getFilteredFolders();
        listWrapper.replaceChildren();
        if (!selectedRootPath) {
          emptyState.textContent = t("selectDriveFirst");
          listWrapper.appendChild(emptyState);
          return;
        }
        if (loading) {
          emptyState.textContent = t("scanningWorkspaceRoot");
          listWrapper.appendChild(emptyState);
          return;
        }
        if (filteredFolders.length === 0) {
          emptyState.textContent = folders.length === 0 ? t("noWorkspaceOnDrive") : t("noMatchingWorkspace");
          listWrapper.appendChild(emptyState);
          return;
        }
        for (const folder of filteredFolders) {
          const row = document.createElement("div");
          row.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid " + (folder.path === selectedFolderPath ? "#6ea8fe" : "#2b3453") + ";border-radius:10px;background:" + (folder.path === selectedFolderPath ? "#18253d" : "#12182b") + ";";
          const meta = document.createElement("button");
          meta.type = "button";
          meta.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0;border:none;background:transparent;color:#eef2ff;text-align:left;cursor:pointer;padding:0;";
          row.appendChild(meta);
          const name = document.createElement("span");
          name.textContent = folder.name;
          name.style.cssText = "display:block;font-weight:700;font-size:15px;line-height:1.35;";
          meta.appendChild(name);
          const folderPath = document.createElement("span");
          folderPath.textContent = folder.path;
          folderPath.style.cssText = "display:block;font-size:12px;line-height:1.45;color:#9aa4c7;word-break:break-all;";
          meta.appendChild(folderPath);
          meta.addEventListener("click", () => {
            selectedFolderPath = folder.path;
            renderList();
          });
          const actions = document.createElement("div");
          actions.style.cssText = "display:flex;gap:8px;align-items:center;";
          row.appendChild(actions);
          const renameButton = document.createElement("button");
          renameButton.type = "button";
          renameButton.textContent = t("renameWorkspace");
          renameButton.style.cssText = "height:34px;padding:0 12px;border:1px solid #39415d;border-radius:8px;background:#101528;color:#d9e0ff;font-weight:700;cursor:pointer;";
          renameButton.addEventListener("click", async () => {
            const nextName = await promptTextInput(t("renameWorkspaceTitle"), t("workspaceName"), folder.name);
            if (nextName === null) {
              return;
            }
            const trimmedName = nextName.trim();
            if (!trimmedName) {
              window.alert(t("emptyNewFolderName"));
              return;
            }
            const result = await renameWorkspaceFolder(folder.path, trimmedName);
            if (!result?.ok || !result.path) {
              window.alert(result?.error || t("failedRenameWorkspace"));
              return;
            }
            workspaceFolderLookupCache.clear();
            selectedFolderPath = folder.path === selectedFolderPath ? result.path : selectedFolderPath;
            await loadFolders(selectedRootPath, selectedFolderPath);
          });
          actions.appendChild(renameButton);
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.textContent = t("delete");
          deleteButton.style.cssText = "height:34px;padding:0 12px;border:none;border-radius:8px;background:#f87171;color:#200a0a;font-weight:700;cursor:pointer;";
          deleteButton.addEventListener("click", async () => {
            const confirmed = await confirmDestructiveAction(
              t("deleteWorkspaceTitle"),
              t("deleteWorkspaceDescription", { name: folder.name })
            );
            if (!confirmed) {
              return;
            }
            const result = await deleteWorkspaceFolder(folder.path);
            if (!result?.ok) {
              window.alert(result?.error || t("failedDeleteWorkspace"));
              return;
            }
            workspaceFolderLookupCache.clear();
            selectedFolderPath = folder.path === selectedFolderPath ? "" : selectedFolderPath;
            await loadFolders(selectedRootPath, selectedFolderPath);
          });
          actions.appendChild(deleteButton);
          listWrapper.appendChild(row);
        }
      };
      const loadFolders = async (nextRootPath, preferredFolderPath = "") => {
        selectedRootPath = nextRootPath || "";
        rootSelect.value = selectedRootPath;
        loading = true;
        folders = [];
        renderList();
        setBusy();
        try {
          if (!selectedRootPath) {
            return;
          }
          const payload = await fetchWorkspaceFolders(selectedRootPath);
          folders = payload?.folders || [];
          selectedFolderPath = preferredFolderPath && folders.some((folder) => folder.path === preferredFolderPath) ? preferredFolderPath : "";
        } finally {
          loading = false;
          renderList();
          setBusy();
        }
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish();
        }
      };

      rootSelect.addEventListener("change", () => loadFolders(rootSelect.value, "").catch(fail));
      searchInput.addEventListener("input", renderList);
      createButton.addEventListener("click", async () => {
        try {
          const result = await promptAndCreateWorkspace(selectedRootPath);
          if (result?.path) {
            await loadFolders(selectedRootPath, result.path);
          }
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
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
      renderList();
      setBusy();
      loadFolders(selectedRootPath, selectedFolderPath).catch(fail);
    });
  }

  async function openWorkspaceFileManager(options = {}) {
    if (document.getElementById("wb-bridge-file-manager-overlay")) {
      return;
    }

    const roots = await fetchWorkspaceRoots();
    const preferredTargetPath = await resolveFileManagerTargetPath(options?.targetPath);

    return new Promise((resolve, reject) => {
      let selectedRoot = "";
      let selectedWorkspacePath = "";
      let folders = [];
      let files = [];
      let queuedUploadFiles = [];
      let loadingFolders = false;
      let loadingFiles = false;

      const overlay = document.createElement("div");
      overlay.id = "wb-bridge-file-manager-overlay";
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;";
      const panel = document.createElement("div");
      panel.style.cssText = "width:min(860px,100%);max-height:min(820px,calc(100vh - 48px));overflow:hidden;border-radius:16px;background:#151823;color:#eef2ff;box-shadow:0 20px 60px rgba(0,0,0,.4);display:flex;flex-direction:column;font:14px/1.45 'Segoe UI',sans-serif;";
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
      topRow.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto auto;gap:12px;align-items:end;";
      body.appendChild(topRow);

      const rootField = document.createElement("label");
      rootField.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      topRow.appendChild(rootField);
      const rootLabel = document.createElement("span");
      rootLabel.textContent = t("drive");
      rootLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      rootField.appendChild(rootLabel);
      const rootSelect = document.createElement("select");
      rootSelect.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;";
      rootField.appendChild(rootSelect);
      const rootPlaceholder = document.createElement("option");
      rootPlaceholder.value = "";
      rootPlaceholder.textContent = t("selectDrive");
      rootSelect.appendChild(rootPlaceholder);
      for (const root of roots) {
        const option = document.createElement("option");
        option.value = root.path;
        option.textContent = root.label || root.path;
        rootSelect.appendChild(option);
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
      const createWorkspaceOption = document.createElement("option");
      createWorkspaceOption.value = "__create_workspace__";
      createWorkspaceOption.textContent = t("createFolder");

      const refreshButton = document.createElement("button");
      refreshButton.type = "button";
      refreshButton.textContent = t("refresh");
      refreshButton.style.cssText = "height:40px;padding:0 16px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      topRow.appendChild(refreshButton);

      const manageWorkspacesButton = document.createElement("button");
      manageWorkspacesButton.type = "button";
      manageWorkspacesButton.textContent = t("manageWorkspaces");
      manageWorkspacesButton.style.cssText = "height:40px;padding:0 16px;border:1px solid #39415d;border-radius:10px;background:#101528;color:#d9e0ff;cursor:pointer;";
      topRow.appendChild(manageWorkspacesButton);

      const workspaceHint = document.createElement("div");
      workspaceHint.style.cssText = "font-size:12px;color:#7d89b4;";
      workspaceHint.textContent = t("workspaceActionHint");
      body.appendChild(workspaceHint);

      const workspaceSearchField = document.createElement("label");
      workspaceSearchField.style.cssText = "display:flex;flex-direction:column;gap:6px;";
      body.appendChild(workspaceSearchField);
      const workspaceSearchLabel = document.createElement("span");
      workspaceSearchLabel.textContent = t("searchWorkspaces");
      workspaceSearchLabel.style.cssText = "font-size:12px;color:#9aa4c7;";
      workspaceSearchField.appendChild(workspaceSearchLabel);
      const workspaceSearchInput = document.createElement("input");
      workspaceSearchInput.type = "search";
      workspaceSearchInput.placeholder = t("searchWorkspacePlaceholder");
      workspaceSearchInput.style.cssText = "height:40px;border:1px solid #39415d;border-radius:10px;background:#0f1320;color:#eef2ff;padding:0 12px;outline:none;";
      workspaceSearchField.appendChild(workspaceSearchInput);

      const uploadRow = document.createElement("div");
      uploadRow.style.cssText = "display:block;";
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
      dropZone.style.cssText = "height:88px;padding:14px;border:1px dashed #4d5a86;border-radius:12px;background:#0f1320;color:#cfd8ff;text-align:center;cursor:pointer;font:13px/1.5 'Segoe UI',sans-serif;";
      uploadField.appendChild(dropZone);
      const uploadHint = document.createElement("div");
      uploadHint.style.cssText = "font-size:12px;color:#7d89b4;";
      uploadHint.textContent = t("noFilesSelected");
      uploadField.appendChild(uploadHint);
      const uploadProgress = createUploadProgressControl();
      uploadField.appendChild(uploadProgress.element);

      const fileList = document.createElement("div");
      fileList.style.cssText = "min-height:280px;max-height:420px;overflow:auto;border:1px solid #2c3350;border-radius:12px;background:#0d1120;padding:8px;display:flex;flex-direction:column;gap:8px;";
      body.appendChild(fileList);
      const emptyState = document.createElement("div");
      emptyState.style.cssText = "padding:36px 12px;text-align:center;color:#7d89b4;font-size:13px;";

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

      const getFilteredWorkspaceFolders = () => {
        const keyword = workspaceSearchInput.value.trim().toLowerCase();
        return keyword
          ? folders.filter((folder) => folder.name.toLowerCase().includes(keyword))
          : [...folders];
      };

      const renderWorkspaceOptions = () => {
        workspaceSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = loadingFolders ? t("loadingFiles") : t("selectWorkspace");
        workspaceSelect.appendChild(placeholder);
        for (const folder of getFilteredWorkspaceFolders()) {
          const option = document.createElement("option");
          option.value = folder.path;
          option.textContent = folder.name;
          workspaceSelect.appendChild(option);
        }
        workspaceSelect.appendChild(createWorkspaceOption);
        workspaceSelect.value = selectedWorkspacePath;
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
          extra.textContent = formatFileSize(entry.size) + " · " + new Date(entry.mtimeMs || Date.now()).toLocaleString(getUiLanguage() === "en" ? "en-US" : "zh-CN");
          extra.style.cssText = "font-size:12px;color:#7d89b4;";
          meta.appendChild(extra);
          const actions = document.createElement("div");
          actions.style.cssText = "display:flex;gap:8px;align-items:center;";
          row.appendChild(actions);
          const downloadButton = document.createElement("button");
          downloadButton.type = "button";
          downloadButton.textContent = t("download");
          downloadButton.style.cssText = "height:34px;padding:0 12px;border:none;border-radius:8px;background:#6ea8fe;color:#09111f;font-weight:700;cursor:pointer;";
          downloadButton.addEventListener("click", () => {
            window.location.href = "/bridge/workspace-download?targetPath=" + encodeURIComponent(entry.path);
          });
          actions.appendChild(downloadButton);
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.textContent = t("delete");
          deleteButton.style.cssText = "height:34px;padding:0 12px;border:none;border-radius:8px;background:#f87171;color:#200a0a;font-weight:700;cursor:pointer;";
          deleteButton.addEventListener("click", async () => {
            const confirmed = await confirmDestructiveAction(t("deleteFileTitle"), t("deleteFileDescription", { name: entry.name }));
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
          actions.appendChild(deleteButton);
          fileList.appendChild(row);
        }
      };

      const setBusy = () => {
        rootSelect.disabled = loadingFolders || loadingFiles;
        workspaceSelect.disabled = loadingFolders || loadingFiles;
        workspaceSearchInput.disabled = loadingFolders || loadingFiles;
        refreshButton.disabled = loadingFolders || loadingFiles || !selectedRoot;
        manageWorkspacesButton.disabled = loadingFolders || loadingFiles || roots.length === 0;
        uploadInput.disabled = loadingFolders || loadingFiles || !selectedWorkspacePath;
        dropZone.disabled = loadingFolders || loadingFiles || !selectedWorkspacePath;
        manageWorkspacesButton.style.opacity = manageWorkspacesButton.disabled ? ".55" : "1";
        dropZone.style.opacity = dropZone.disabled ? ".55" : "1";
      };

      const updateQueuedUploadFiles = (nextFiles) => {
        queuedUploadFiles = Array.from(nextFiles || []);
        uploadProgress.set(null);
        if (queuedUploadFiles.length === 0) {
          uploadHint.textContent = t("noFilesSelected");
          dropZone.textContent = t("dropFilesHint");
        } else {
          const names = queuedUploadFiles.slice(0, 3).map((file) => file.name).join(", ");
          const suffix = queuedUploadFiles.length > 3 ? t("selectedFilesSuffix", { count: queuedUploadFiles.length }) : "";
          uploadHint.textContent = t("selectedFiles", { names, suffix });
          dropZone.textContent = t("selectedFilesHint");
        }
        setBusy();
      };

      const uploadQueuedFiles = async () => {
        if (!selectedWorkspacePath) {
          window.alert(t("selectWorkspaceFirst"));
          return;
        }
        const selectedFiles = [...queuedUploadFiles];
        if (selectedFiles.length === 0) {
          return;
        }
        loadingFiles = true;
        setBusy();
        uploadProgress.set({
          loadedBytes: 0,
          totalBytes: selectedFiles.reduce((sum, file) => sum + file.size, 0),
        });
        try {
          await uploadWorkspaceFiles(selectedWorkspacePath, selectedFiles, uploadProgress.set);
          const names = selectedFiles.map((file) => file.name).join(", ");
          showBridgeToast(t("uploadComplete", { names, workspace: selectedWorkspacePath }));
          uploadInput.value = "";
          updateQueuedUploadFiles([]);
          await loadFilesForWorkspace(selectedWorkspacePath);
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          loadingFiles = false;
          uploadProgress.set(null);
          setBusy();
        }
      };

      const loadFilesForWorkspace = async (folderPath) => {
        selectedWorkspacePath = folderPath || "";
        workspaceSelect.value = selectedWorkspacePath;
        files = [];
        if (!selectedWorkspacePath) {
          renderFileList();
          setBusy();
          return;
        }
        loadingFiles = true;
        workspaceHint.textContent = t("currentWorkspace", { path: selectedWorkspacePath });
        renderFileList();
        setBusy();
        try {
          const payload = await fetchWorkspaceFiles(selectedWorkspacePath);
          files = payload?.entries || [];
        } finally {
          loadingFiles = false;
          renderFileList();
          setBusy();
        }
      };

      const loadFoldersForRoot = async (rootPath, preferredFolderPath = "") => {
        selectedRoot = rootPath || "";
        try {
          if (selectedRoot) {
            localStorage.setItem("__workbuddy_remote_last_workspace_root__", selectedRoot);
          }
        } catch {}
        loadingFolders = true;
        folders = [];
        selectedWorkspacePath = "";
        files = [];
        renderWorkspaceOptions();
        renderFileList();
        setBusy();
        try {
          if (!selectedRoot) {
            workspaceHint.textContent = t("selectDriveFirst");
            return;
          }
          const payload = await fetchWorkspaceFolders(selectedRoot);
          folders = payload?.folders || [];
          selectedWorkspacePath = preferredFolderPath && folders.some((entry) => entry.path === preferredFolderPath) ? preferredFolderPath : "";
          workspaceHint.textContent = payload?.workspaceRoot ? t("currentRoot", { path: payload.workspaceRoot }) : t("noWorkspaceAvailable");
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

      rootSelect.addEventListener("change", () => {
        loadFoldersForRoot(rootSelect.value).catch(fail);
      });
      workspaceSelect.addEventListener("change", async () => {
        if (workspaceSelect.value === "__create_workspace__") {
          try {
            const result = await promptAndCreateWorkspace(selectedRoot);
            if (result?.path) {
              await loadFoldersForRoot(selectedRoot, result.path);
            }
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
          } finally {
            renderWorkspaceOptions();
          }
          return;
        }
        loadFilesForWorkspace(workspaceSelect.value).catch(fail);
      });
      refreshButton.addEventListener("click", () => {
        loadFoldersForRoot(rootSelect.value, selectedWorkspacePath).catch(fail);
      });
      manageWorkspacesButton.addEventListener("click", async () => {
        try {
          const result = await openWorkspaceManager({
            roots,
            rootPath: selectedRoot || rootSelect.value,
            folderPath: selectedWorkspacePath,
          });
          if (result?.rootPath) {
            await loadFoldersForRoot(result.rootPath, result.folderPath);
          }
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
        }
      });
      workspaceSearchInput.addEventListener("input", renderWorkspaceOptions);
      uploadInput.addEventListener("change", () => {
        updateQueuedUploadFiles(uploadInput.files || []);
        uploadQueuedFiles();
      });
      dropZone.addEventListener("click", () => {
        if (!dropZone.disabled) {
          uploadInput.click();
        }
      });
      const setDropActive = (active) => {
        dropZone.style.borderColor = active ? "#6ea8fe" : "#4d5a86";
        dropZone.style.background = active ? "#15203a" : "#0f1320";
      };
      for (const eventName of ["dragenter", "dragover"]) {
        dropZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          if (!dropZone.disabled) {
            setDropActive(true);
          }
        });
      }
      dropZone.addEventListener("dragleave", (event) => {
        event.preventDefault();
        if (event.target === dropZone) {
          setDropActive(false);
        }
      });
      dropZone.addEventListener("drop", (event) => {
        event.preventDefault();
        setDropActive(false);
        if (!dropZone.disabled) {
          updateQueuedUploadFiles(event.dataTransfer?.files || []);
          uploadQueuedFiles();
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

      resolvePreferredWorkspaceSelection(roots, preferredTargetPath)
        .then(({ rootPath, folderPath }) => {
          rootSelect.value = rootPath;
          return rootPath ? loadFoldersForRoot(rootPath, folderPath) : null;
        })
        .catch(fail);
    });
  }

  function openWorkspaceFileManagerOnce(options = {}) {
    if (!fileManagerEnabled) {
      return Promise.resolve();
    }
    if (!fileManagerOpenPromise) {
      fileManagerOpenPromise = openWorkspaceFileManager(options).finally(() => {
        fileManagerOpenPromise = null;
      });
    }
    return fileManagerOpenPromise;
  }

  let workBuddyMenuBarObserver = null;
  const workBuddyMenuBarHiderCss = \`
      #workbuddy-menubar-container,
      .codebuddy-menubar,
      #workbuddy-window-controls-container,
      .workbuddy-window-controls {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
      }
      #root {
        margin-top: 0 !important;
        height: 100vh !important;
        min-height: 100vh !important;
      }
      .teams-container,
      #root > .teams-container {
        height: 100vh !important;
        min-height: 100vh !important;
      }
    \`;

  function injectWorkBuddyMenuBarHiderStyle() {
    let style = document.getElementById("wb-bridge-hide-menubar-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "wb-bridge-hide-menubar-style";
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== workBuddyMenuBarHiderCss) {
      style.textContent = workBuddyMenuBarHiderCss;
    }
  }

  function hideWorkBuddyMenuBar() {
    injectWorkBuddyMenuBarHiderStyle();
    const root = document.getElementById("root");
    if (root) {
      root.style.setProperty("margin-top", "0", "important");
      root.style.setProperty("height", "100vh", "important");
      root.style.setProperty("min-height", "100vh", "important");
    }
    for (const element of document.querySelectorAll(".teams-container")) {
      element.style.setProperty("height", "100vh", "important");
      element.style.setProperty("min-height", "100vh", "important");
    }
    for (const element of document.querySelectorAll("#workbuddy-menubar-container,.codebuddy-menubar,#workbuddy-window-controls-container,.workbuddy-window-controls")) {
      element.dataset.workbuddyRemoteMenuBarHidden = "true";
      element.style.setProperty("display", "none", "important");
      element.style.setProperty("visibility", "hidden", "important");
      element.style.setProperty("height", "0", "important");
      element.style.setProperty("pointer-events", "none", "important");
    }
  }

  function installWorkBuddyMenuBarHider() {
    hideWorkBuddyMenuBar();
    if (workBuddyMenuBarObserver || !document.documentElement) {
      return;
    }
    workBuddyMenuBarObserver = new MutationObserver(() => hideWorkBuddyMenuBar());
    workBuddyMenuBarObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["id", "class"],
    });
  }

  function isWindowControlCandidate(element) {
    if (!element || element.id === "wb-bridge-file-manager-button" || element.id === "wb-bridge-restart-button") {
      return false;
    }
    if (element.closest?.("#wb-bridge-file-manager-overlay")) {
      return false;
    }
    const label = [
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
    if (!/(minimi[sz]e|maximi[sz]e|restore|close|最小化|最大化|还原|关闭)/u.test(label)) {
      return false;
    }
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    return rect.top <= 72 && window.innerWidth - rect.right <= 220;
  }

  function hideBrowserWindowControls() {
    for (const element of document.querySelectorAll("button,[role='button'],a")) {
      if (isWindowControlCandidate(element)) {
        element.dataset.workbuddyRemoteWindowControlHidden = "true";
        element.style.setProperty("display", "none", "important");
      }
    }
  }

  function installWindowControlHider() {
    hideBrowserWindowControls();
    const observer = new MutationObserver(() => hideBrowserWindowControls());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "style", "class"],
    });
  }

  function getControlFromEvent(event) {
    for (const item of event.composedPath?.() || []) {
      if (item?.nodeType === 1 && typeof item.matches === "function" && item.matches("button,a,[role='button'],[role='menuitem']")) {
        return item;
      }
    }
    return event.target?.closest?.("button,a,[role='button'],[role='menuitem']") || null;
  }

  function getControlLabel(control) {
    return [
      control?.textContent,
      control?.getAttribute?.("aria-label"),
      control?.getAttribute?.("title"),
      control?.getAttribute?.("data-testid"),
      control?.getAttribute?.("data-action"),
      control?.getAttribute?.("data-addition-id"),
      control?.className,
    ]
      .map((value) => String(value || "").replace(/\\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ");
  }

  const mobileNavigationAssist = {
    installed: false,
    hitTarget: null,
    lastToggle: null,
    lastKnownOpen: false,
    lastKnownOpenAt: 0,
    lastActivationAt: 0,
    gesture: null,
    topBarTap: null,
    detailHitTarget: null,
    detailObserver: null,
    detailRefreshScheduled: false,
    detailLastActivationAt: 0,
    refreshScheduled: false,
  };

  function isMobileTouchViewport() {
    return Boolean(
      window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches ||
      window.innerWidth <= 820
    );
  }

  function isEditableTarget(element) {
    return Boolean(element?.closest?.(
      "input,textarea,select,[contenteditable='true'],[role='textbox']"
    ));
  }

  function getEventClientPoint(event) {
    const touch = event.changedTouches?.[0] || event.touches?.[0];
    const clientX = Number.isFinite(touch?.clientX) ? touch.clientX : event.clientX;
    const clientY = Number.isFinite(touch?.clientY) ? touch.clientY : event.clientY;
    return {
      x: Number.isFinite(clientX) ? clientX : 0,
      y: Number.isFinite(clientY) ? clientY : 0,
    };
  }

  function isTopBarInteractiveControl(control) {
    if (!control || control.closest?.("[id^='wb-bridge-']")) {
      return false;
    }
    const rect = control.getBoundingClientRect?.();
    return Boolean(
      rect &&
      rect.width >= 12 &&
      rect.height >= 12 &&
      rect.top >= -8 &&
      rect.top <= 112 &&
      rect.bottom <= 156 &&
      rect.height <= 112
    );
  }

  function withMobileHitTargetPassthrough(callback) {
    const hitTarget = mobileNavigationAssist.hitTarget;
    const previousPointerEvents = hitTarget?.style?.pointerEvents;
    if (hitTarget) {
      hitTarget.style.setProperty("pointer-events", "none", "important");
    }
    try {
      return callback();
    } finally {
      if (hitTarget) {
        hitTarget.style.setProperty("pointer-events", previousPointerEvents || "auto", "important");
      }
    }
  }

  function getClickableControlAtPoint(x, y) {
    return withMobileHitTargetPassthrough(() => {
      const element = document.elementFromPoint?.(x, y);
      if (!element?.closest) {
        return null;
      }
      const control = element.closest("button,a,[role='button'],[role='menuitem'],[tabindex]");
      if (!control || control.closest?.("[id^='wb-bridge-']")) {
        return null;
      }
      return control;
    });
  }

  function dispatchSyntheticPointerMouseClick(control, clientX, clientY) {
    if (!control) {
      return false;
    }
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      screenX: window.screenX + clientX,
      screenY: window.screenY + clientY,
      button: 0,
      buttons: 1,
    };
    const dispatch = (type, EventConstructor, init = eventInit) => {
      try {
        control.dispatchEvent(new EventConstructor(type, init));
      } catch {
        control.dispatchEvent(new MouseEvent(type, eventInit));
      }
    };
    if (typeof PointerEvent !== "undefined") {
      dispatch("pointerdown", PointerEvent, { ...eventInit, pointerId: 1, pointerType: "touch", isPrimary: true });
    }
    dispatch("mousedown", MouseEvent);
    if (typeof PointerEvent !== "undefined") {
      dispatch("pointerup", PointerEvent, { ...eventInit, buttons: 0, pointerId: 1, pointerType: "touch", isPrimary: true });
    }
    dispatch("mouseup", MouseEvent, { ...eventInit, buttons: 0 });
    dispatch("click", MouseEvent, { ...eventInit, buttons: 0, detail: 1 });
    return true;
  }

  function hideMobileNavigationHitTarget() {
    const hitTarget = mobileNavigationAssist.hitTarget;
    if (!hitTarget?.style) {
      return;
    }
    hitTarget.style.setProperty("display", "none", "important");
    hitTarget.style.setProperty("pointer-events", "none", "important");
  }

  function hideMobileDetailHitTarget() {
    const hitTarget = mobileNavigationAssist.detailHitTarget;
    if (!hitTarget?.style) {
      return;
    }
    hitTarget.style.setProperty("display", "none", "important");
    hitTarget.style.setProperty("pointer-events", "none", "important");
  }

  function findMobileDetailPanelControl() {
    const selectors = [
      ".teams-top-bar .top-bar-actions button",
      ".workbuddy-topbar .workbuddy-topbar-actions button",
    ];
    const buttons = document.querySelectorAll(selectors.join(","));
    for (const button of buttons) {
      if (button.closest?.("[id^='wb-bridge-']")) {
        continue;
      }
      const label = getControlLabel(button).toLowerCase();
      if (
        button.querySelector?.(".top-bar-detail-toggle-icon") ||
        /(detail|panel|详情|面板)/u.test(label)
      ) {
        const rect = button.getBoundingClientRect?.();
        if (rect && rect.width > 0 && rect.height > 0) {
          return button;
        }
      }
    }
    return null;
  }

  function ensureMobileDetailHitTarget() {
    let hitTarget = mobileNavigationAssist.detailHitTarget;
    if (hitTarget?.isConnected) {
      applyMobileNavigationTouchHandling(hitTarget);
      return hitTarget;
    }
    hitTarget = document.createElement("button");
    hitTarget.id = "wb-bridge-mobile-detail-hit-target";
    hitTarget.type = "button";
    hitTarget.tabIndex = -1;
    hitTarget.setAttribute("aria-label", "Toggle detail panel");
    hitTarget.style.cssText = "position:fixed;z-index:2147483647;left:0;top:0;width:44px;height:44px;min-width:44px!important;min-height:44px!important;box-sizing:border-box;border:0;margin:0;padding:0;background:transparent;color:transparent;opacity:.01;display:none;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;-webkit-appearance:none;appearance:none;border-radius:0;";
    applyMobileNavigationTouchHandling(hitTarget);
    hitTarget.addEventListener("touchend", activateMobileDetailPanelFromHitTarget, { passive: false });
    hitTarget.addEventListener("click", activateMobileDetailPanelFromHitTarget, true);
    document.body.appendChild(hitTarget);
    mobileNavigationAssist.detailHitTarget = hitTarget;
    return hitTarget;
  }

  function refreshMobileDetailHitTarget() {
    mobileNavigationAssist.detailRefreshScheduled = false;
    if (!isMobileTouchViewport() || !document.body) {
      hideMobileDetailHitTarget();
      return;
    }
    const control = findMobileDetailPanelControl();
    if (!control) {
      hideMobileDetailHitTarget();
      return;
    }
    ensureMobileNavigationStyleSheet();
    const hitTarget = ensureMobileDetailHitTarget();
    const rect = control.getBoundingClientRect();
    const width = Math.max(44, Math.ceil(rect.width));
    const height = Math.max(44, Math.ceil(rect.height));
    const left = Math.max(0, Math.round(rect.left - Math.max(0, (width - rect.width) / 2)));
    const top = Math.max(0, Math.round(rect.top - Math.max(0, (height - rect.height) / 2)));
    const nextStyle = {
      left: left + "px",
      top: top + "px",
      width: width + "px",
      height: height + "px",
      minWidth: width + "px",
      minHeight: height + "px",
      maxWidth: width + "px",
      maxHeight: height + "px",
      display: "block",
      pointerEvents: "auto",
    };
    for (const [name, value] of Object.entries(nextStyle)) {
      if (hitTarget.style[name] !== value) {
        hitTarget.style.setProperty(name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()), value, "important");
      }
    }
  }

  function scheduleMobileDetailHitTargetRefresh() {
    if (mobileNavigationAssist.detailRefreshScheduled) {
      return;
    }
    mobileNavigationAssist.detailRefreshScheduled = true;
    requestAnimationFrame(refreshMobileDetailHitTarget);
  }

  function activateMobileDetailPanelFromHitTarget(event) {
    if (!isMobileTouchViewport()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const now = Date.now();
    if (now - mobileNavigationAssist.detailLastActivationAt < 650) {
      return;
    }
    mobileNavigationAssist.detailLastActivationAt = now;
    const toggle = globalThis.__workbuddyRemoteToggleDetailPanel;
    if (typeof toggle === "function") {
      try {
        if (toggle() !== false) {
          scheduleMobileDetailHitTargetRefresh();
          return;
        }
      } catch (error) {
        console.warn("[workbuddy-remote] Failed to toggle WorkBuddy detail panel:", error);
      }
    }

    const control = findMobileDetailPanelControl();
    if (control) {
      const rect = control.getBoundingClientRect();
      dispatchSyntheticPointerMouseClick(control, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    scheduleMobileDetailHitTargetRefresh();
  }

  function isPointInMobileNavigationHitBand(x, y) {
    const band = getMobileNavigationHitBand();
    return x >= band.left && x <= band.right && y >= band.top && y <= band.bottom;
  }

  function isMobileNavigationTapIntent(x, y, control) {
    if (x > Math.min(124, Math.max(84, window.innerWidth * 0.28)) || y > 176) {
      return false;
    }
    if (isPointInMobileNavigationHitBand(x, y)) {
      return true;
    }
    if (!control) {
      return y <= 128;
    }
    const rect = control.getBoundingClientRect?.();
    if (!rect || rect.left > 116 || rect.top > 144 || rect.width > 148 || rect.height > 120) {
      return false;
    }
    const label = getControlLabel(control).toLowerCase();
    const text = String(control.textContent || "");
    const className = String(control.className || "").toLowerCase();
    const hasNavigationCue = /(menu|sidebar|history|session|conversation|task|nav|drawer|菜单|侧栏|历史|会话|对话|任务|展开|折叠)/u.test(label + " " + className);
    const hasMenuGlyph = /[☰≡]/u.test(text);
    const hasSvg = Boolean(control.matches?.("svg") || control.querySelector?.("svg"));
    const compact = rect.width <= 96 && rect.height <= 96;
    return hasNavigationCue || hasMenuGlyph || (compact && hasSvg) || rect.left <= 72;
  }

  function rememberMobileSidebarState(isOpen) {
    mobileNavigationAssist.lastKnownOpen = Boolean(isOpen);
    mobileNavigationAssist.lastKnownOpenAt = Date.now();
  }

  function getRememberedMobileSidebarState(maxAgeMs = 300000) {
    if (Date.now() - mobileNavigationAssist.lastKnownOpenAt > maxAgeMs) {
      return null;
    }
    return Boolean(mobileNavigationAssist.lastKnownOpen);
  }

  function readNativeMobileSidebarState() {
    const getter = globalThis.__workbuddyRemoteGetSidebarState;
    if (typeof getter !== "function") {
      return null;
    }
    try {
      const state = getter();
      if (!state || typeof state !== "object" || typeof state.open !== "boolean") {
        return null;
      }
      return state;
    } catch {
      return null;
    }
  }

  function callWorkBuddyRemoteSidebarToggle(nextOpenState = null) {
    const desiredOpen = nextOpenState === null ? !getMobileSidebarOpenState() : Boolean(nextOpenState);
    if (nextOpenState !== null && typeof globalThis.__workbuddyRemoteSetSidebarOpen === "function") {
      try {
        if (globalThis.__workbuddyRemoteSetSidebarOpen(desiredOpen) !== false) {
          rememberMobileSidebarState(desiredOpen);
          mobileNavigationAssist.lastActivationAt = Date.now();
          return true;
        }
      } catch (error) {
        console.warn("[workbuddy-remote] Failed to set WorkBuddy sidebar state:", error);
      }
    }
    const direct = desiredOpen ? globalThis.__workbuddyRemoteOpenSidebar : globalThis.__workbuddyRemoteCloseSidebar;
    if (typeof direct === "function") {
      try {
        if (direct() !== false) {
          rememberMobileSidebarState(desiredOpen);
          mobileNavigationAssist.lastActivationAt = Date.now();
          return true;
        }
      } catch (error) {
        console.warn("[workbuddy-remote] Failed to set WorkBuddy sidebar state:", error);
      }
    }
    const toggle = globalThis.__workbuddyRemoteToggleSidebar;
    if (typeof toggle !== "function") {
      return false;
    }
    if (getMobileSidebarOpenState() === desiredOpen) {
      return true;
    }
    try {
      toggle();
      rememberMobileSidebarState(desiredOpen);
      mobileNavigationAssist.lastActivationAt = Date.now();
      return true;
    } catch (error) {
      console.warn("[workbuddy-remote] Failed to toggle WorkBuddy sidebar:", error);
      return false;
    }
  }

  function getMobileSidebarOpenState() {
    const nativeState = readNativeMobileSidebarState();
    if (nativeState) {
      rememberMobileSidebarState(nativeState.open);
      return nativeState.open;
    }
    const rememberedState = getRememberedMobileSidebarState();
    if (rememberedState !== null) {
      return rememberedState;
    }
    return false;
  }

  function activateMobileNavigation(nextOpenState = null) {
    return callWorkBuddyRemoteSidebarToggle(nextOpenState);
  }

  function ensureMobileNavigationStyleSheet() {
    const styleId = "wb-bridge-mobile-navigation-style";
    if (document.getElementById(styleId)) {
      return;
    }
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = "@media (hover: none) and (pointer: coarse), (max-width: 820px) { html, body { overscroll-behavior-x: contain; } input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']):not([type='hidden']), textarea, select, [contenteditable='true'], [role='textbox'] { font-size: 16px !important; line-height: 1.35 !important; } input::placeholder, textarea::placeholder { font-size: inherit !important; } }";
    (document.head || document.documentElement || document.body)?.appendChild(style);
  }

  function applyMobileNavigationTouchHandling(element) {
    if (!element?.style) {
      return;
    }
    element.dataset.workbuddyRemoteMobileNavigationTouch = "true";
    element.setAttribute?.("draggable", "false");
    const declarations = [
      ["touch-action", "manipulation"],
      ["-webkit-tap-highlight-color", "transparent"],
      ["-webkit-user-drag", "none"],
      ["-webkit-user-select", "none"],
      ["user-select", "none"],
      ["-webkit-app-region", "no-drag"],
      ["app-region", "no-drag"],
    ];
    for (const [property, value] of declarations) {
      element.style.setProperty(property, value, "important");
    }
  }

  function ensureMobileNavigationHitTarget() {
    let hitTarget = mobileNavigationAssist.hitTarget;
    if (hitTarget?.isConnected) {
      applyMobileNavigationTouchHandling(hitTarget);
      return hitTarget;
    }
    hitTarget = document.createElement("button");
    hitTarget.id = "wb-bridge-mobile-menu-hit-target";
    hitTarget.type = "button";
    hitTarget.tabIndex = -1;
    hitTarget.setAttribute("aria-label", "Toggle navigation");
    hitTarget.style.cssText = "position:fixed;z-index:2147483647;left:0;top:0;width:76px;height:64px;min-width:0!important;min-height:0!important;max-width:76px!important;max-height:64px!important;box-sizing:border-box;border:0;margin:0;padding:0;background:transparent;color:transparent;opacity:.01;display:none;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;-webkit-appearance:none;appearance:none;border-radius:0;";
    applyMobileNavigationTouchHandling(hitTarget);
    document.body.appendChild(hitTarget);
    mobileNavigationAssist.hitTarget = hitTarget;
    return hitTarget;
  }

  function refreshMobileNavigationHitTarget() {
    mobileNavigationAssist.refreshScheduled = false;
    if (!isMobileTouchViewport() || !document.body) {
      hideMobileNavigationHitTarget();
      return;
    }
    ensureMobileNavigationStyleSheet();
    const hitTarget = ensureMobileNavigationHitTarget();
    const band = getMobileNavigationHitBand();
    const nextStyle = {
      left: band.left + "px",
      top: band.top + "px",
      width: band.width + "px",
      height: band.height + "px",
      minWidth: "0",
      minHeight: "0",
      maxWidth: band.width + "px",
      maxHeight: band.height + "px",
      display: "block",
      pointerEvents: "auto",
    };
    for (const [name, value] of Object.entries(nextStyle)) {
      if (hitTarget.style[name] !== value) {
        hitTarget.style.setProperty(name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()), value, "important");
      }
    }
  }

  function scheduleMobileNavigationRefresh() {
    if (mobileNavigationAssist.refreshScheduled) {
      return;
    }
    mobileNavigationAssist.refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshMobileNavigationHitTarget();
      scheduleMobileDetailHitTargetRefresh();
    });
  }

  function getMobileNavigationOpenSwipeEdge() {
    return Math.min(220, Math.max(128, (window.innerWidth || 0) * 0.46));
  }

  function getMobileNavigationHitBand() {
    const width = 76;
    const height = 64;
    const top = Math.max(0, Math.min(96, window.innerHeight - height));
    return {
      left: 0,
      right: width,
      top,
      bottom: top + height,
      width,
      height,
    };
  }

  function startMobileNavigationGesture(x, y, target) {
    if (!isMobileTouchViewport() || isEditableTarget(target)) {
      mobileNavigationAssist.gesture = null;
      return;
    }
    if (y <= 40) {
      mobileNavigationAssist.gesture = null;
      return;
    }
    const openEdge = getMobileNavigationOpenSwipeEdge();
    const closeEdge = Math.min(420, Math.max(220, window.innerWidth * 0.82));
    const canOpen = x <= openEdge;
    const canClose = x <= closeEdge;
    mobileNavigationAssist.gesture = canOpen || canClose
      ? {
          x,
          y,
          time: Date.now(),
          canOpen,
          canClose,
          triggered: false,
        }
      : null;
  }

  function moveMobileNavigationGesture(x, y, event) {
    const gesture = mobileNavigationAssist.gesture;
    if (!gesture || gesture.triggered) {
      return;
    }
    const dx = x - gesture.x;
    const dy = y - gesture.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const minSwipeDistance = gesture.canOpen ? 58 : 76;
    const minHorizontalRatio = gesture.canOpen ? 1.18 : 1.35;
    const maxVerticalTravel = gesture.canOpen ? 92 : 76;
    if (absY > 48 && absY > absX * 1.05) {
      mobileNavigationAssist.gesture = null;
      return;
    }
    if (absX < minSwipeDistance || absX < absY * minHorizontalRatio || absY > maxVerticalTravel) {
      return;
    }
    const elapsed = Math.max(1, Date.now() - gesture.time);
    if (absX / elapsed < 0.14 && absX < (gesture.canOpen ? 88 : 104)) {
      return;
    }

    if (dx > 0 && gesture.canOpen) {
      gesture.triggered = true;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      activateMobileNavigation(true);
      return;
    }
    if (dx < 0 && gesture.canClose) {
      gesture.triggered = true;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      activateMobileNavigation(false);
    }
  }

  function endMobileNavigationGesture(event) {
    if (mobileNavigationAssist.gesture?.triggered) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
    }
    mobileNavigationAssist.gesture = null;
  }

  function startTopBarTapRescue(event) {
    if (!isMobileTouchViewport() || event.touches.length !== 1) {
      mobileNavigationAssist.topBarTap = null;
      return;
    }
    const point = getEventClientPoint(event);
    const control = getClickableControlAtPoint(point.x, point.y);
    if (!isTopBarInteractiveControl(control) && !isMobileNavigationTapIntent(point.x, point.y, control)) {
      mobileNavigationAssist.topBarTap = null;
      return;
    }
    mobileNavigationAssist.topBarTap = {
      x: point.x,
      y: point.y,
      control,
      time: Date.now(),
    };
  }

  function endTopBarTapRescue(event) {
    const tap = mobileNavigationAssist.topBarTap;
    mobileNavigationAssist.topBarTap = null;
    if (!tap || !isMobileTouchViewport()) {
      return;
    }
    const point = getEventClientPoint(event);
    const dx = point.x - tap.x;
    const dy = point.y - tap.y;
    if (Math.hypot(dx, dy) > 12 || Date.now() - tap.time > 1200) {
      return;
    }
    const control = tap.control?.isConnected ? tap.control : getClickableControlAtPoint(point.x, point.y);
    if (isMobileNavigationTapIntent(point.x, point.y, control) && Date.now() - mobileNavigationAssist.lastActivationAt >= 250) {
      mobileNavigationAssist.gesture = null;
      if (activateMobileNavigation(true)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        return;
      }
    }
    if (isTopBarInteractiveControl(control)) {
      mobileNavigationAssist.gesture = null;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      dispatchSyntheticPointerMouseClick(control, point.x, point.y);
      return;
    }
    if (isPointInMobileNavigationHitBand(point.x, point.y) && Date.now() - mobileNavigationAssist.lastActivationAt >= 750) {
      if (activateMobileNavigation(true)) {
        mobileNavigationAssist.gesture = null;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }
    }
  }

  function installMobileNavigationAssist() {
    if (mobileNavigationAssist.installed) {
      return;
    }
    mobileNavigationAssist.installed = true;
    ensureMobileNavigationStyleSheet();
    scheduleMobileNavigationRefresh();

    document.addEventListener("touchstart", startTopBarTapRescue, { capture: true, passive: true });
    document.addEventListener("touchend", endTopBarTapRescue, { capture: true, passive: false });
    document.addEventListener("touchcancel", () => {
      mobileNavigationAssist.topBarTap = null;
    }, { capture: true, passive: true });

    document.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" || event.isPrimary === false) {
        return;
      }
      startMobileNavigationGesture(event.clientX, event.clientY, event.target);
    }, true);
    document.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse" || event.isPrimary === false) {
        return;
      }
      moveMobileNavigationGesture(event.clientX, event.clientY, event);
    }, true);
    document.addEventListener("pointerup", endMobileNavigationGesture, true);
    document.addEventListener("pointercancel", endMobileNavigationGesture, true);

    document.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 1) {
        mobileNavigationAssist.gesture = null;
        return;
      }
      const touch = event.touches[0];
      startMobileNavigationGesture(touch.clientX, touch.clientY, event.target);
    }, { capture: true, passive: false });
    document.addEventListener("touchmove", (event) => {
      if (!mobileNavigationAssist.gesture || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      moveMobileNavigationGesture(touch.clientX, touch.clientY, event);
    }, { capture: true, passive: false });
    document.addEventListener("touchend", endMobileNavigationGesture, { capture: true, passive: false });
    document.addEventListener("touchcancel", endMobileNavigationGesture, { capture: true, passive: false });

    window.addEventListener("resize", scheduleMobileNavigationRefresh, { passive: true });
    window.addEventListener("orientationchange", scheduleMobileNavigationRefresh, { passive: true });
    if (!mobileNavigationAssist.detailObserver) {
      mobileNavigationAssist.detailObserver = new MutationObserver(scheduleMobileDetailHitTargetRefresh);
      mobileNavigationAssist.detailObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "title", "style", "aria-label"],
      });
    }
    scheduleMobileDetailHitTargetRefresh();
  }

  function isOpenFileManagerControlLabel(label, localPath = "") {
    if (/(本地文件|上传|附件|添加文件|upload|attach|add.*file|local.*file)/iu.test(label)) {
      return false;
    }
    if (localPath && /打开.*文件|open.*file|file.*open/iu.test(label)) {
      return true;
    }
    return /打开.*(文件夹|目录)|在.*(文件管理器|资源管理器).*显示|文件管理器中显示|资源管理器中显示|open.*folder|show.*(folder|file)|reveal.*(explorer|folder|file)|folder.*open/iu.test(label);
  }

  function getControlLocalPath(control) {
    const candidates = [
      control?.getAttribute?.("href"),
      control?.href,
      control?.getAttribute?.("data-path"),
      control?.getAttribute?.("data-file-path"),
      control?.getAttribute?.("data-target-path"),
      control?.getAttribute?.("data-uri"),
    ];
    const localPath = candidates.find((value) => isLocalPathLike(value));
    if (localPath) {
      return localPath;
    }
    return [
      control?.getAttribute?.("data-path"),
      control?.getAttribute?.("data-file-path"),
      control?.getAttribute?.("data-target-path"),
      control?.getAttribute?.("data-uri"),
    ].find((value) => isRelativePathLike(value)) || "";
  }

  async function handleDomCommand(control) {
    if (!fileManagerEnabled || !control || control.closest?.("[id^='wb-bridge-']")) {
      return false;
    }

    const label = getControlLabel(control);
    const localPath = getControlLocalPath(control);
    if (isOpenFileManagerControlLabel(label, localPath)) {
      await openWorkspaceFileManagerOnce({ targetPath: localPath });
      return true;
    }

    return false;
  }

  const domCommandDocuments = new WeakSet();
  let domCommandObserver = null;
  let workspaceHintTrackerInstalled = false;

  function installWorkspaceHintTracker() {
    if (workspaceHintTrackerInstalled) {
      return;
    }
    workspaceHintTrackerInstalled = true;
    const handler = (event) => {
      rememberWorkspaceHintFromElement(event.target);
      rememberNativeNewWorkspaceIntentFromEvent(event);
    };
    for (const type of ["pointerdown", "click", "focusin"]) {
      document.addEventListener(type, handler, true);
    }
  }

  function installDomCommandInterceptors() {
    const handler = (event) => {
      const nativeNewWorkspaceElement = fileManagerEnabled ? getNativeNewWorkspaceElementFromEvent(event) : null;
      if (event.type === "click" && nativeNewWorkspaceElement && !nativeNewWorkspaceElement.closest?.("[id^='wb-bridge-']")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        promptAndOpenNativeWorkspace().catch((error) => {
          console.error("[workbuddy-remote] native new workspace failed", error);
          window.alert(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      const control = getControlFromEvent(event);
      if (!control) {
        return;
      }
      rememberWorkspaceHintFromElement(control);
      if (!fileManagerEnabled) {
        return;
      }
      const label = getControlLabel(control);
      const localPath = getControlLocalPath(control);
      if (!isOpenFileManagerControlLabel(label, localPath)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handleDomCommand(control).catch((error) => {
        console.error("[workbuddy-remote] command intercept failed", error);
        window.alert(error instanceof Error ? error.message : String(error));
      });
    };

    const installForDocument = (targetDocument) => {
      if (!targetDocument || domCommandDocuments.has(targetDocument)) {
        return;
      }
      domCommandDocuments.add(targetDocument);
      for (const type of ["pointerdown", "mousedown", "click"]) {
        targetDocument.addEventListener(type, handler, true);
      }
    };

    const installForKnownDocuments = () => {
      installForDocument(document);
      for (const frame of document.querySelectorAll("iframe")) {
        try {
          installForDocument(frame.contentDocument);
        } catch {}
      }
    };

    installForKnownDocuments();
    if (!domCommandObserver) {
      domCommandObserver = new MutationObserver(installForKnownDocuments);
      domCommandObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    const nativeWindowOpen = window.open.bind(window);
    window.open = (url, target, features) => {
      if (fileManagerEnabled && isLocalPathLike(url)) {
        openWorkspaceFileManagerOnce({ targetPath: url }).catch((error) => {
          console.error("[workbuddy-remote] file manager failed", error);
          window.alert(error instanceof Error ? error.message : String(error));
        });
        return null;
      }
      return nativeWindowOpen(
        typeof url === "string" ? rewriteLoopbackUrlStringForBridge(url) : url,
        target,
        features
      );
    };
  }

  async function requestBridgeRestart() {
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
    scheduleIntegratedRemoteControlsSync();
    setBridgeStatus(t("restartStarting"));
    try {
      await request({ type: "restart-app" });
      setBridgeStatus(t("restartStarting"));
    } catch (error) {
      restartInProgress = false;
      scheduleIntegratedRemoteControlsSync();
      throw error;
    }
  }

  let integratedRemoteControlsObserver = null;
  let integratedRemoteControlsSyncScheduled = false;

  function removeBridgeFloatingControls() {
    document.getElementById("wb-bridge-file-manager-button")?.remove();
    document.getElementById("wb-bridge-restart-button")?.remove();
  }

  function getCompactText(element) {
    return String(element?.textContent || "").replace(/\\s+/g, " ").trim();
  }

  function setIntegratedMenuItemLabel(item, label) {
    const textLeaves = [...item.querySelectorAll("*")]
      .filter((element) => element.children.length === 0 && getCompactText(element));
    const target =
      item.querySelector(".user-menu-item-label") ||
      item.querySelector("[class*='_label_']") ||
      textLeaves.at(-1);
    if (target) {
      if (target.textContent !== label) {
        target.textContent = label;
      }
    } else {
      if (item.textContent !== label) {
        item.textContent = label;
      }
    }
  }

  const fileManagerMenuIconSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2c.7 0 1.36.3 1.82.82L12 7.5h6.5A2.5 2.5 0 0 1 21 10v7.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"></path><path d="M3 10h18"></path><path d="M15.5 15.5h3"></path><path d="M17 14v3"></path></svg>';

  function setFileManagerMenuItemIcon(item) {
    const icon = item.querySelector("._icon_2lapt_1,[class*='_icon_']");
    if (!icon) {
      return;
    }
    if (icon.dataset.wbBridgeFileManagerIcon !== "true") {
      icon.innerHTML = fileManagerMenuIconSvg;
      icon.dataset.wbBridgeFileManagerIcon = "true";
    }
  }

  function scrubClonedMenuItemIds(item) {
    item.removeAttribute("id");
    for (const element of item.querySelectorAll("[id]")) {
      element.removeAttribute("id");
    }
  }

  function stopIntegratedMenuEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function closeNativeTransientMenus() {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }));
  }

  function handleIntegratedFileManagerClick(event) {
    stopIntegratedMenuEvent(event);
    closeNativeTransientMenus();
    openWorkspaceFileManagerOnce().catch((error) => {
      console.error("[workbuddy-remote] file manager failed", error);
      window.alert(error instanceof Error ? error.message : String(error));
    });
  }

  function getDirectMenuItems(container) {
    return [...(container?.children || [])].filter((element) => element.nodeType === 1);
  }

  function findDirectMenuItem(container, pattern) {
    return getDirectMenuItems(container).find((item) => pattern.test(getCompactText(item)));
  }

  function syncFileManagerAttachmentEntries() {
    if (!fileManagerEnabled) {
      for (const entry of document.querySelectorAll("[data-wb-bridge-file-manager-entry='true']")) {
        entry.remove();
      }
      return;
    }

    for (const container of document.querySelectorAll("[role='listbox'],[class*='_popover_']")) {
      const localFileItem = findDirectMenuItem(container, /^(?:本地文件|Local Files?|Local File)$/iu);
      const tencentDocsItem = findDirectMenuItem(container, /^(?:腾讯文档|Tencent Docs?)$/iu);
      if (!localFileItem || !tencentDocsItem) {
        continue;
      }

      let entry = getDirectMenuItems(container)
        .find((item) => item.dataset.wbBridgeFileManagerEntry === "true");
      if (!entry) {
        entry = localFileItem.cloneNode(true);
        scrubClonedMenuItemIds(entry);
        entry.dataset.wbBridgeFileManagerEntry = "true";
        entry.setAttribute("role", localFileItem.getAttribute("role") || "button");
        entry.tabIndex = localFileItem.tabIndex >= 0 ? localFileItem.tabIndex : 0;
        entry.addEventListener("pointerdown", stopIntegratedMenuEvent, true);
        entry.addEventListener("mousedown", stopIntegratedMenuEvent, true);
        entry.addEventListener("click", handleIntegratedFileManagerClick, true);
      }
      setIntegratedMenuItemLabel(entry, t("fileManager"));
      setFileManagerMenuItemIcon(entry);
      entry.style.removeProperty("display");
      entry.style.removeProperty("visibility");
      if (entry.nextElementSibling !== tencentDocsItem) {
        container.insertBefore(entry, tencentDocsItem);
      }
    }
  }

  function handleIntegratedRestartClick(event) {
    stopIntegratedMenuEvent(event);
    if (restartInProgress) {
      return;
    }
    closeNativeTransientMenus();
    requestBridgeRestart().catch((error) => {
      console.error("[workbuddy-remote] restart failed", error);
      setBridgeStatus("");
      window.alert(error instanceof Error ? error.message : String(error));
    });
  }

  function syncRestartUserMenuEntry() {
    const existingEntries = [...document.querySelectorAll("[data-wb-bridge-restart-menu-entry='true']")];
    if (!restartEnabled || !restartAvailable) {
      for (const entry of existingEntries) {
        entry.remove();
      }
      return;
    }

    const footer = document.querySelector(".user-menu-popover .user-menu-footer");
    const logoutItem =
      footer?.querySelector(".user-menu-item--logout:not([data-wb-bridge-restart-menu-entry='true'])") ||
      [...(footer?.querySelectorAll("[role='button'],.user-menu-item") || [])]
        .find((item) => item.dataset.wbBridgeRestartMenuEntry !== "true" && /退出登录|退出登陆|Logout|Sign out/iu.test(getCompactText(item)));
    if (!footer || !logoutItem) {
      return;
    }

    let entry = footer.querySelector("[data-wb-bridge-restart-menu-entry='true']");
    if (!entry) {
      entry = logoutItem.cloneNode(true);
      scrubClonedMenuItemIds(entry);
      entry.dataset.wbBridgeRestartMenuEntry = "true";
      entry.setAttribute("role", logoutItem.getAttribute("role") || "button");
      entry.tabIndex = logoutItem.tabIndex >= 0 ? logoutItem.tabIndex : 0;
      entry.addEventListener("pointerdown", stopIntegratedMenuEvent, true);
      entry.addEventListener("mousedown", stopIntegratedMenuEvent, true);
      entry.addEventListener("click", handleIntegratedRestartClick, true);
    }

    entry.classList.add("user-menu-item--logout");
    setIntegratedMenuItemLabel(entry, restartInProgress ? t("restartStarting") : t("restartProgram"));
    const label = entry.querySelector(".user-menu-item-label");
    if (label) {
      label.style.setProperty("justify-content", "center");
      label.style.setProperty("text-align", "center");
      label.style.setProperty("width", "100%");
    }
    entry.setAttribute("aria-disabled", restartInProgress ? "true" : "false");
    entry.style.cursor = restartInProgress ? "default" : "pointer";
    entry.style.opacity = restartInProgress ? ".6" : "";
    if (entry !== logoutItem && entry.nextElementSibling !== logoutItem) {
      footer.insertBefore(entry, logoutItem);
    }
  }

  function syncIntegratedRemoteControls() {
    integratedRemoteControlsSyncScheduled = false;
    removeBridgeFloatingControls();
    syncFileManagerAttachmentEntries();
    syncRestartUserMenuEntry();
  }

  function scheduleIntegratedRemoteControlsSync() {
    if (integratedRemoteControlsSyncScheduled) {
      return;
    }
    integratedRemoteControlsSyncScheduled = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(syncIntegratedRemoteControls);
    } else {
      setTimeout(syncIntegratedRemoteControls, 0);
    }
  }

  function installIntegratedRemoteControls() {
    syncIntegratedRemoteControls();
    if (integratedRemoteControlsObserver || !document.documentElement) {
      return;
    }
    integratedRemoteControlsObserver = new MutationObserver(scheduleIntegratedRemoteControlsSync);
    integratedRemoteControlsObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  async function initializeRemoteControls() {
    try {
      if (restartEnabled || fileManagerEnabled) {
        const bootstrap = await fetchJson("/bridge/bootstrap");
        restartAvailable =
          restartEnabled && bootstrap?.restartAvailable !== false;
      }
    } catch (error) {
      console.warn("[workbuddy-remote] failed to read bridge bootstrap", error);
    }
    installIntegratedRemoteControls();
  }

  let sensitiveFieldMaskObserver = null;
  let sensitiveFieldMaskScheduled = false;

  function runSensitiveFieldMaskScheduled() {
    sensitiveFieldMaskScheduled = false;
    maskSensitiveModelFields();
  }

  function scheduleSensitiveFieldMask() {
    if (!maskBridgeModelSecrets || sensitiveFieldMaskScheduled) {
      return;
    }
    sensitiveFieldMaskScheduled = true;
    queueMicrotask(runSensitiveFieldMaskScheduled);
  }

  function installSensitiveFieldMasker() {
    if (!maskBridgeModelSecrets || sensitiveFieldMaskObserver || !document.documentElement) {
      return;
    }
    maskSensitiveModelFields();
    sensitiveFieldMaskObserver = new MutationObserver(scheduleSensitiveFieldMask);
    sensitiveFieldMaskObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "style", "class", "value"],
    });
  }

  installSensitiveFieldMasker();
  installWorkBuddyMenuBarHider();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      installWorkBuddyMenuBarHider();
      installWindowControlHider();
      installSensitiveFieldMasker();
      installMobileNavigationAssist();
      installWorkspaceHintTracker();
      installDomCommandInterceptors();
      initializeRemoteControls().catch((error) => {
        console.warn("[workbuddy-remote] remote controls failed", error);
      });
    }, { once: true });
  } else {
    installWorkBuddyMenuBarHider();
    installWindowControlHider();
    installSensitiveFieldMasker();
    installMobileNavigationAssist();
    installWorkspaceHintTracker();
    installDomCommandInterceptors();
    initializeRemoteControls().catch((error) => {
      console.warn("[workbuddy-remote] remote controls failed", error);
    });
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function encodeValue(value) {
    if (value instanceof ArrayBuffer) {
      return {
        __workbuddyBridgeValue: "arraybuffer",
        base64: bytesToBase64(new Uint8Array(value)),
      };
    }

    if (ArrayBuffer.isView(value)) {
      return {
        __workbuddyBridgeValue: "typedarray",
        constructorName: value.constructor?.name || "Uint8Array",
        base64: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
      };
    }

    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return {
        __workbuddyBridgeValue: "blob",
        name: typeof File !== "undefined" && value instanceof File ? value.name : "",
        type: value.type || "",
        lastModified: typeof File !== "undefined" && value instanceof File ? value.lastModified : 0,
        base64: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
      };
    }

    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => encodeValue(item)));
    }

    if (value && typeof value === "object") {
      const result = {};
      for (const [key, nestedValue] of Object.entries(value)) {
        if (typeof nestedValue !== "function") {
          result[key] = await encodeValue(nestedValue);
        }
      }
      return result;
    }

    return value;
  }

  function decodeTransport(payload) {
    if (!payload || typeof payload !== "object" || !("kind" in payload)) {
      return payload;
    }

    if (payload.kind === "json") {
      return payload.value;
    }

    if (payload.kind === "base64") {
      return base64ToBytes(payload.base64).buffer;
    }

    return payload;
  }

  function normalizeHttpUrl(value) {
    const input = String(value || "").trim();
    if (!input) {
      return "";
    }
    try {
      const parsed = new URL(input);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function findAuthUrl(value, depth = 0) {
    if (!value || depth > 4) {
      return "";
    }
    if (typeof value === "string") {
      return normalizeHttpUrl(value);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const nestedUrl = findAuthUrl(item, depth + 1);
        if (nestedUrl) {
          return nestedUrl;
        }
      }
      return "";
    }
    if (typeof value !== "object") {
      return "";
    }

    for (const key of ["authUrl", "authorizationUrl", "loginUrl", "url", "href"]) {
      const directUrl = findAuthUrl(value[key], depth + 1);
      if (directUrl) {
        return directUrl;
      }
    }

    for (const nestedValue of Object.values(value)) {
      const nestedUrl = findAuthUrl(nestedValue, depth + 1);
      if (nestedUrl) {
        return nestedUrl;
      }
    }
    return "";
  }

  function isAuthUrlEvent(message) {
    const key = String(message?.key || "");
    const method = String(message?.method || "");
    return (
      key === "authUrlChanged" ||
      key === "$on:authUrlChanged" ||
      method === "authUrlChanged" ||
      (method === "$on" && key.endsWith(":authUrlChanged"))
    );
  }

  function shouldOpenAuthUrl(url) {
    const now = Date.now();
    if (lastLoginAuthUrl === url && now - lastLoginAuthUrlOpenedAt < 5000) {
      return false;
    }
    lastLoginAuthUrl = url;
    lastLoginAuthUrlOpenedAt = now;
    return true;
  }

  function closePendingLoginPopupIfUnused(expectedPopup = pendingLoginPopup) {
    if (!expectedPopup || expectedPopup !== pendingLoginPopup || pendingLoginPopupNavigated) {
      return;
    }
    pendingLoginPopup = null;
    try {
      if (!expectedPopup.closed) {
        expectedPopup.close();
      }
    } catch {}
  }

  function prepareLoginPopup() {
    closePendingLoginPopupIfUnused();
    pendingLoginPopup = null;
    pendingLoginPopupNavigated = false;
    try {
      pendingLoginPopup = window.open("about:blank", "_blank");
      if (pendingLoginPopup) {
        try {
          pendingLoginPopup.opener = null;
          pendingLoginPopup.document.title = "WorkBuddy Login";
        } catch {}
      }
    } catch {
      pendingLoginPopup = null;
    }
    return pendingLoginPopup;
  }

  function openAuthUrlInUserBrowser(value) {
    if (loginAuthUrlCaptureDepth <= 0) {
      return false;
    }

    const url = findAuthUrl(value);
    if (!url || !shouldOpenAuthUrl(url)) {
      return false;
    }

    const popup = pendingLoginPopup;
    pendingLoginPopup = null;
    if (popup && !popup.closed) {
      try {
        popup.location.href = url;
        pendingLoginPopupNavigated = true;
        popup.focus?.();
        return true;
      } catch {
        try {
          popup.close();
        } catch {}
      }
    }

    pendingLoginPopupNavigated = false;
    try {
      return Boolean(window.open(url, "_blank", "noopener,noreferrer"));
    } catch {
      return false;
    }
  }

  function beginLoginAuthUrlCapture() {
    loginAuthUrlCaptureDepth += 1;
  }

  function endLoginAuthUrlCapture() {
    loginAuthUrlCaptureDepth = Math.max(0, loginAuthUrlCaptureDepth - 1);
  }

  async function subscribeLoginAuthUrl() {
    try {
      await request({
        type: "buddy-api-subscribe",
        method: "$on",
        key: "$on:authUrlChanged",
        args: ["authUrlChanged"],
      });
      return true;
    } catch (error) {
      console.warn("[workbuddy-remote] auth URL subscription failed", error);
      return false;
    }
  }

  function unsubscribeLoginAuthUrl() {
    request({
      type: "buddy-api-unsubscribe",
      method: "$on",
      key: "$on:authUrlChanged",
    }).catch(() => {});
  }

  function handleBridgeMessage(message) {
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.ok === false) {
        entry.reject(new Error(message.error || "WorkBuddy bridge request failed"));
      } else {
        entry.resolve(decodeTransport(message.result));
      }
      return;
    }

    if (message.type === "buddy-api-event") {
      const key = message.key || message.method;
      const args = (message.args || []).map(decodeTransport);
      if (isAuthUrlEvent(message)) {
        openAuthUrlInUserBrowser(args);
      }
      const callbacks = listeners.get(key);
      if (!callbacks) {
        return;
      }
      for (const callback of [...callbacks]) {
        try {
          callback(...args);
        } catch (error) {
          console.error("[workbuddy-remote] listener failed", error);
        }
      }
      return;
    }

    if (message.type === "workspace-upload-progress") {
      pendingUploadProgress.get(message.uploadId)?.(message);
      return;
    }

    if (message.type === "open-file-manager") {
      openWorkspaceFileManagerOnce({ targetPath: message.targetPath || message.url }).catch((error) => {
        console.error("[workbuddy-remote] file manager failed", error);
        window.alert(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    if (message.type === "open-external" && typeof message.url === "string") {
      if (fileManagerEnabled && isLocalPathLike(message.url)) {
        openWorkspaceFileManagerOnce({ targetPath: message.url }).catch((error) => {
          console.error("[workbuddy-remote] file manager failed", error);
          window.alert(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      window.open(rewriteLoopbackUrlStringForBridge(message.url), "_blank", "noopener,noreferrer");
    }
  }

  function handleIncomingChunkFrame(message) {
    if (message.type === "bridge-message-chunk-start") {
      incomingChunkedMessages.set(message.transferId, {
        chunks: [],
        totalChunks: Math.max(0, Math.trunc(Number(message.totalChunks) || 0)),
        totalLength: Math.max(0, Math.trunc(Number(message.totalLength) || 0)),
      });
      return true;
    }

    if (message.type === "bridge-message-chunk") {
      const entry = incomingChunkedMessages.get(message.transferId);
      if (!entry) {
        console.warn("[workbuddy-remote] chunk frame without start", message.transferId);
        return true;
      }
      const index = Math.trunc(Number(message.index) || 0);
      entry.chunks[index] = typeof message.data === "string" ? message.data : "";
      return true;
    }

    if (message.type !== "bridge-message-chunk-end") {
      return false;
    }

    const entry = incomingChunkedMessages.get(message.transferId);
    incomingChunkedMessages.delete(message.transferId);
    if (!entry) {
      console.warn("[workbuddy-remote] chunk end without start", message.transferId);
      return true;
    }

    const raw = entry.chunks.join("");
    if (entry.totalLength && raw.length !== entry.totalLength) {
      console.warn("[workbuddy-remote] chunked message length mismatch", {
        transferId: message.transferId,
        expected: entry.totalLength,
        actual: raw.length,
      });
    }

    try {
      handleBridgeMessage(JSON.parse(raw));
    } catch (error) {
      console.error("[workbuddy-remote] failed to parse chunked bridge message", error);
    }
    return true;
  }

  function sendRawBridgeMessage(raw) {
    if (raw.length <= wsChunkChars) {
      socket.send(raw);
      return;
    }

    const transferId = "client-" + Date.now().toString(36) + "-" + (++outgoingChunkSeq).toString(36);
    const totalChunks = Math.ceil(raw.length / wsChunkChars);
    socket.send(JSON.stringify({
      type: "bridge-client-message-chunk-start",
      transferId,
      totalChunks,
      totalLength: raw.length,
    }));
    for (let offset = 0, index = 0; offset < raw.length; offset += wsChunkChars, index += 1) {
      socket.send(JSON.stringify({
        type: "bridge-client-message-chunk",
        transferId,
        index,
        data: raw.slice(offset, offset + wsChunkChars),
      }));
    }
    socket.send(JSON.stringify({
      type: "bridge-client-message-chunk-end",
      transferId,
    }));
  }

  function connect() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (readyPromise) {
      return readyPromise;
    }

    readyPromise = new Promise((resolve, reject) => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(protocol + "//" + location.host + "/bridge/ws");

      socket.addEventListener("open", () => {
        readyPromise = null;
        resolve();
      });

      socket.addEventListener("error", () => {
        const error = new Error("WorkBuddy bridge WebSocket failed");
        readyPromise = null;
        reject(error);
      });

      socket.addEventListener("close", () => {
        for (const entry of pending.values()) {
          entry.reject(new Error("WorkBuddy bridge WebSocket closed"));
        }
        pending.clear();
        incomingChunkedMessages.clear();
        socket = null;
        readyPromise = null;
      });

      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (handleIncomingChunkFrame(message)) {
          return;
        }

        handleBridgeMessage(message);
      });
    });

    return readyPromise;
  }

  async function request(payload) {
    await connect();
    const id = ++requestId;
    const message = { ...payload, id };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        sendRawBridgeMessage(JSON.stringify(message));
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  function createInFlightBuddyApiKey(method, args) {
    if (method !== "getSession" && method !== "loadSession") {
      return "";
    }
    try {
      return method + ":" + JSON.stringify(args || []);
    } catch {
      return method;
    }
  }

  async function forwardBuddyApiCall(method, args) {
    const inFlightKey = createInFlightBuddyApiKey(method, args);
    if (inFlightKey && inFlightBuddyApiCalls.has(inFlightKey)) {
      return inFlightBuddyApiCalls.get(inFlightKey);
    }

    const promise = (async () => {
      if (method === "workbuddyRemoteGetSessionMessagesPage") {
        return request({
          type: "workbuddy-remote-session-messages-page",
          sessionId: args?.[0] || "",
          before: args?.[1]?.before,
          limit: args?.[1]?.limit || remoteHistoryPageMessages,
        });
      }

      if (method === "loadSession") {
        await request({
          type: "buddy-api-call-discard-result",
          method,
          args: await encodeValue(args),
        });
        return true;
      }

      const result = await request({
        type: method === "getSession" ? "buddy-api-call-session-page" : "buddy-api-call",
        method,
        args: await encodeValue(args),
        limit: method === "getSession" ? remoteHistoryPageMessages : undefined,
      });
      return shouldRewriteLoopbackBuddyApiResult(method)
        ? rewriteLoopbackUrlsInValue(result)
        : result;
    })();

    if (!inFlightKey) {
      return promise;
    }

    inFlightBuddyApiCalls.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      inFlightBuddyApiCalls.delete(inFlightKey);
    }
  }

  async function callBuddyApi(method, args) {
    if (method === "isWindowMaximized") {
      return false;
    }
    if (
      method === "minimizeWindow" ||
      method === "maximizeWindow" ||
      method === "closeWindow" ||
      method === "windowCancelPendingClose" ||
      method === "windowConfirmClose" ||
      method === "windowSetTrafficLightsVisible"
    ) {
      return true;
    }
    if (method === "windowReload") {
      location.reload();
      return true;
    }
    if (method === "login") {
      const loginPopup = prepareLoginPopup();
      beginLoginAuthUrlCapture();
      const authUrlSubscribed = await subscribeLoginAuthUrl();
      try {
        return await forwardBuddyApiCall(method, args);
      } finally {
        if (authUrlSubscribed) {
          unsubscribeLoginAuthUrl();
        }
        endLoginAuthUrlCapture();
        closePendingLoginPopupIfUnused(loginPopup);
      }
    }
    if (method === "openExternal") {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url) {
        if (fileManagerEnabled && isLocalPathLike(url)) {
          await openWorkspaceFileManagerOnce({ targetPath: url });
          return true;
        }
        window.open(rewriteLoopbackUrlStringForBridge(url), "_blank", "noopener,noreferrer");
        return true;
      }
    }
    if (method === "openPath") {
      const targetPath = typeof args[0] === "string" ? args[0] : args[0]?.path;
      if (fileManagerEnabled && isLocalPathLike(targetPath)) {
        await openWorkspaceFileManagerOnce({ targetPath });
        return true;
      }
    }
    if ((method === "pickFolder" || method === "selectDirectory") && fileManagerEnabled) {
      const selected = await promptForRemoteFolderPath(getPathCandidateFromArgs(args));
      return {
        canceled: !selected?.[0],
        folderPaths: selected?.[0] ? selected : [],
      };
    }
    if (method === "workspaceGenerateDefaultCwd" && fileManagerEnabled && hasRecentNativeNewWorkspaceIntent()) {
      nativeNewWorkspaceIntentAt = 0;
      return promptAndCreateNativeWorkspace();
    }
    if (method === "workspaceOpenFolder" && fileManagerEnabled) {
      const targetPath = getPathCandidateFromArgs(args);
      if (isLocalPathLike(targetPath)) {
        await openWorkspaceFileManagerOnce({ targetPath });
        return true;
      }
      if (isRelativePathLike(targetPath)) {
        await openWorkspaceFileManagerOnce({ targetPath });
        return true;
      }
      return forwardBuddyApiCall(method, args);
    }
    if (method === "workspaceOpen" && fileManagerEnabled) {
      const targetPath = getPathCandidateFromArgs(args);
      const normalizedTargetPath = normalizeLocalPathInput(targetPath);
      if (!normalizedTargetPath && Date.now() - nativeNewWorkspaceCanceledAt < 5000) {
        return false;
      }
      const pendingWorkspacePath =
        pendingNativeNewWorkspacePath && (!normalizedTargetPath || isSameOrChildPath(pendingNativeNewWorkspacePath, normalizedTargetPath))
          ? pendingNativeNewWorkspacePath
          : "";
      if (pendingWorkspacePath) {
        pendingNativeNewWorkspacePath = "";
        return forwardBuddyApiCall(method, replacePathCandidateInArgs(args, pendingWorkspacePath));
      }
      const knownWorkspacePath = await resolveKnownWorkspaceFolderPath(normalizedTargetPath);
      if (knownWorkspacePath) {
        return forwardBuddyApiCall(method, replacePathCandidateInArgs(args, knownWorkspacePath));
      }
      const selected = await promptForRemoteFolderPath(targetPath);
      const folderPath = selected?.[0];
      if (!folderPath) {
        return false;
      }
      return forwardBuddyApiCall(method, replacePathCandidateInArgs(args, folderPath));
    }
    if (method === "pickFile" || method === "selectFile") {
      const options = args?.[0] && typeof args[0] === "object" ? args[0] : {};
      return pickAndUploadFiles({
        ...options,
        canSelectMany: method === "selectFile" ? false : options.canSelectMany,
      });
    }
    if ((method === "readClipboard" || method === "clipboardReadText") && navigator.clipboard?.readText) {
      return navigator.clipboard.readText();
    }
    if (method === "clipboardWriteText" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(args[0] || ""));
      return true;
    }

    return forwardBuddyApiCall(method, args);
  }

  function subscribeBuddyApi(method, args) {
    const callback = method === "$on" ? args[1] : args[0];
    if (typeof callback !== "function") {
      return () => {};
    }

    const subscribeArgs = method === "$on" ? [args[0]] : [];
    const key = method === "$on" ? "$on:" + String(args[0] || "") : method;
    let callbacks = listeners.get(key);
    if (!callbacks) {
      callbacks = new Set();
      listeners.set(key, callbacks);
      request({
        type: "buddy-api-subscribe",
        method,
        key,
        args: subscribeArgs,
      }).catch((error) => {
        console.error("[workbuddy-remote] subscribe failed", method, error);
      });
    }

    callbacks.add(callback);
    return () => {
      const current = listeners.get(key);
      if (!current) {
        return;
      }
      current.delete(callback);
      if (current.size === 0) {
        listeners.delete(key);
        request({
          type: "buddy-api-unsubscribe",
          method,
          key,
        }).catch(() => {});
      }
    };
  }

  function installRemoteHistoryPagerScrollWatcher() {
    if (globalThis.__workbuddyRemoteHistoryPagerScrollWatcherInstalled) {
      return;
    }
    globalThis.__workbuddyRemoteHistoryPagerScrollWatcherInstalled = true;
    document.addEventListener("scroll", (event) => {
      const target = event.target;
      if (!target || target === document || target === document.body || target === document.documentElement) {
        return;
      }
      const scrollTop = Number(target.scrollTop);
      if (!Number.isFinite(scrollTop) || scrollTop > 96) {
        return;
      }
      const isChatScroller =
        target?.dataset?.virtuosoScroller === "true" ||
        String(target?.className || "").includes("chat") ||
        Boolean(target?.closest?.(".chat-container,[data-message-request-id]"));
      if (!isChatScroller) {
        return;
      }
      const loadOlder = globalThis.__workbuddyRemoteLoadOlderHistory;
      const now = Date.now();
      if (typeof loadOlder !== "function" || now - lastRemoteHistoryLoadAt < 1200) {
        return;
      }
      lastRemoteHistoryLoadAt = now;
      Promise.resolve(loadOlder()).catch((error) => {
        console.warn("[workbuddy-remote] failed to load older history page", error);
      });
    }, true);
  }

  const buddyApiTarget = {};
  for (const method of apiMethods) {
    buddyApiTarget[method] = (...args) => {
      if (eventMethodPattern.test(method)) {
        return subscribeBuddyApi(method, args);
      }
      return callBuddyApi(method, args);
    };
  }

  const buddyApi = new Proxy(buddyApiTarget, {
    get(target, property) {
      if (property in target) {
        return target[property];
      }
      return undefined;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      if (property in target) {
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: target[property],
        };
      }
      return undefined;
    },
  });

  globalThis.buddyAPI = buddyApi;
  installRemoteHistoryPagerScrollWatcher();
  globalThis.__WORKBUDDY_VERSION__ = workBuddyVersion;
  globalThis.__electronLog = globalThis.__electronLog || {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    sendToMain() {
      return true;
    },
  };
  globalThis.vscode = globalThis.vscode || {};
  globalThis.vscode.webUtils = globalThis.vscode.webUtils || {
    getPathForFile(file) {
      return file?.path || file?.name || "";
    },
  };
})();`;
}

export { renderWorkBuddyNativeHtml, renderWorkBuddyNativeShimJs };
