const FALLBACK_BUDDY_API_METHODS = [
  "createSession",
  "deleteSession",
  "listSessions",
  "loadSession",
  "prompt",
  "cancel",
  "respondToPermission",
  "getSession",
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
  return html;
}

function renderWorkBuddyNativeShimJs({
  methods = [],
  version = "",
  locale = "",
  enableFileManager = true,
  enableRestart = true,
} = {}) {
  const methodList = [...new Set([...FALLBACK_BUDDY_API_METHODS, ...methods])];
  return `(() => {
  const apiMethods = ${JSON.stringify(methodList)};
  const workBuddyVersion = ${JSON.stringify(version || "")};
  const workBuddyLocale = ${JSON.stringify(locale || "")};
  const fileManagerEnabled = ${JSON.stringify(enableFileManager !== false)};
  const restartEnabled = ${JSON.stringify(enableRestart !== false)};
  const pending = new Map();
  const listeners = new Map();
  let socket = null;
  let readyPromise = null;
  let requestId = 0;
  let statusBanner = null;
  let restartAvailable = true;
  let restartInProgress = false;
  let fileManagerOpenPromise = null;
  const pendingUploadProgress = new Map();

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
      restartConfirmTitle: "确认重启当前程序",
      restartConfirmDescription: "这会关闭当前这个 WorkBuddy 和 bridge，然后按相同参数重新拉起。",
      restartConfirmAction: "确认重启",
      restartConfirmWarning: "只会重启当前这一组实例，不会关闭其他 WorkBuddy。",
      restartStarting: "正在重启当前 WorkBuddy，稍后会自动重新连接...",
      restartTimeout: "重启已发起，但等待重新连接超时，请手动刷新页面确认。",
      drive: "根目录",
      selectDrive: "请选择根目录",
      workspace: "工作空间",
      selectWorkspace: "请选择工作空间",
      createFolder: "+ 新建文件夹...",
      refresh: "刷新",
      close: "关闭",
      cancel: "取消",
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
      promptNewFolderName: "请输入新建文件夹名称",
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
      restartConfirmTitle: "Restart current app",
      restartConfirmDescription: "This will close the current WorkBuddy and bridge, then start them again with the same parameters.",
      restartConfirmAction: "Restart",
      restartConfirmWarning: "Only this launch will be restarted. Other WorkBuddy instances will not be closed.",
      restartStarting: "Restarting the current WorkBuddy instance. The page will reconnect automatically...",
      restartTimeout: "Restart was triggered, but reconnection timed out. Refresh the page manually to check the result.",
      drive: "Root",
      selectDrive: "Select a root",
      workspace: "Workspace",
      selectWorkspace: "Select a workspace",
      createFolder: "+ Create new folder...",
      refresh: "Refresh",
      close: "Close",
      cancel: "Cancel",
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
      promptNewFolderName: "Enter a name for the new folder",
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

  function applyFloatingActionButtonStyle(button, rightPx, disabled = false, background = "rgba(24,31,53,.96)", textColor = "#eef2ff") {
    button.style.cssText = "position:fixed;top:5px;right:" + rightPx + "px;z-index:2147483645;height:26px;padding:0 8px;border:none;border-radius:999px;background:" + background + ";color:" + textColor + ";font:10px/1 'Segoe UI',sans-serif;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.25);cursor:" + (disabled ? "default" : "pointer") + ";display:flex;align-items:center;gap:6px;opacity:" + (disabled ? ".55" : ".92") + ";pointer-events:" + (disabled ? "none" : "auto") + ";";
    button.disabled = disabled;
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

  function createWorkspaceFolder(rootPath, name) {
    return fetchJson("/bridge/workspace-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath, name }),
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

  async function uploadWorkspaceFiles(folderPath, files, onProgress) {
    await connect();
    let completedBytes = 0;
    const uploaded = [];
    for (const file of files) {
      const uploadId = "upload-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      pendingUploadProgress.set(uploadId, (message) => {
        onProgress?.({
          loadedBytes: completedBytes + (message.loadedBytes || 0),
          totalBytes: files.reduce((sum, item) => sum + item.size, 0),
        });
      });
      try {
        const result = await fetchJson(
          "/bridge/workspace-files?folderPath=" + encodeURIComponent(folderPath) +
            "&fileName=" + encodeURIComponent(file.name) +
            "&uploadId=" + encodeURIComponent(uploadId),
          { method: "POST", body: file }
        );
        if (!result?.ok) {
          throw new Error(result?.error || "Upload failed");
        }
        uploaded.push(result);
      } finally {
        pendingUploadProgress.delete(uploadId);
      }
      completedBytes += file.size;
      onProgress?.({
        loadedBytes: completedBytes,
        totalBytes: files.reduce((sum, item) => sum + item.size, 0),
      });
    }
    return uploaded;
  }

  function createUploadProgressControl() {
    const element = document.createElement("div");
    element.style.cssText = "display:none;font-size:12px;color:#9aa4c7;";
    return {
      element,
      set(progress) {
        if (!progress) {
          element.style.display = "none";
          element.textContent = "";
          return;
        }
        const total = Math.max(0, Number(progress.totalBytes) || 0);
        const loaded = Math.max(0, Number(progress.loadedBytes) || 0);
        const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        element.textContent = t("uploadProgress", {
          percent,
          loaded: formatFileSize(loaded),
          total: formatFileSize(total),
        });
        element.style.display = "block";
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

  async function resolvePreferredWorkspaceSelection(roots, targetPath) {
    const preferredRoot = choosePreferredRoot(roots, targetPath);
    if (!preferredRoot) {
      return { rootPath: "", folderPath: "" };
    }
    const payload = await fetchWorkspaceFolders(preferredRoot).catch(() => null);
    return {
      rootPath: preferredRoot,
      folderPath: choosePreferredFolder(payload?.folders || [], targetPath),
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

      const renderWorkspaceOptions = () => {
        workspaceSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = loading ? t("loadingWorkspaces") : t("selectWorkspace");
        workspaceSelect.appendChild(placeholder);
        for (const folder of folders) {
          const option = document.createElement("option");
          option.value = folder.path;
          option.textContent = folder.name;
          workspaceSelect.appendChild(option);
        }
        workspaceSelect.appendChild(createWorkspaceOption);
        workspaceSelect.value = folders.some((folder) => folder.path === selectedFolderPath) ? selectedFolderPath : "";
      };

      const applyFilter = () => {
        const keyword = searchInput.value.trim().toLowerCase();
        filteredFolders = keyword
          ? folders.filter((folder) => folder.name.toLowerCase().includes(keyword))
          : [...folders];
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
          try {
            const result = await createWorkspaceFolder(selectedRootPath, trimmedName);
            if (!result?.ok || !result.path) {
              window.alert(result?.error || t("failedCreateWorkspace"));
              renderWorkspaceOptions();
              return;
            }
            await loadRootFolders(selectedRootPath, result.path);
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
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
    let folderPath = await getCurrentWorkspacePath();
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

  async function openWorkspaceFileManager(options = {}) {
    if (document.getElementById("wb-bridge-file-manager-overlay")) {
      return;
    }

    const roots = await fetchWorkspaceRoots();
    const preferredTargetPath = normalizeLocalPathInput(options?.targetPath);

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
      workspaceHint.style.cssText = "font-size:12px;color:#7d89b4;";
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
      dropZone.style.cssText = "height:88px;padding:14px;border:1px dashed #4d5a86;border-radius:12px;background:#0f1320;color:#cfd8ff;text-align:center;cursor:pointer;font:13px/1.5 'Segoe UI',sans-serif;";
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

      const renderWorkspaceOptions = () => {
        workspaceSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = loadingFolders ? t("loadingFiles") : t("selectWorkspace");
        workspaceSelect.appendChild(placeholder);
        for (const folder of folders) {
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
        refreshButton.disabled = loadingFolders || loadingFiles || !selectedRoot;
        uploadInput.disabled = loadingFolders || loadingFiles || !selectedWorkspacePath;
        dropZone.disabled = loadingFolders || loadingFiles || !selectedWorkspacePath;
        uploadButton.disabled = loadingFolders || loadingFiles || !selectedWorkspacePath || queuedUploadFiles.length === 0;
        uploadButton.style.opacity = uploadButton.disabled ? ".55" : "1";
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
          try {
            const result = await createWorkspaceFolder(selectedRoot, trimmedName);
            if (!result?.ok || !result.path) {
              window.alert(result?.error || t("failedCreateWorkspace"));
              renderWorkspaceOptions();
              return;
            }
            await loadFoldersForRoot(selectedRoot, result.path);
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        loadFilesForWorkspace(workspaceSelect.value).catch(fail);
      });
      refreshButton.addEventListener("click", () => {
        loadFoldersForRoot(rootSelect.value, selectedWorkspacePath).catch(fail);
      });
      uploadInput.addEventListener("change", () => updateQueuedUploadFiles(uploadInput.files || []));
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
        }
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
        uploadProgress.set({
          loadedBytes: 0,
          totalBytes: selectedFiles.reduce((sum, file) => sum + file.size, 0),
        });
        try {
          await uploadWorkspaceFiles(selectedWorkspacePath, selectedFiles, uploadProgress.set);
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

      const preferredRoot = choosePreferredRoot(roots, preferredTargetPath);
      rootSelect.value = preferredRoot;
      if (!preferredRoot) {
        return;
      }
      fetchWorkspaceFolders(preferredRoot)
        .then((payload) => {
          folders = payload?.folders || [];
          const preferredFolder = choosePreferredFolder(folders, preferredTargetPath);
          return loadFoldersForRoot(preferredRoot, preferredFolder);
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
    ]
      .map((value) => String(value || "").replace(/\\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ");
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
    return candidates.find((value) => isLocalPathLike(value)) || "";
  }

  async function handleDomCommand(control) {
    if (!fileManagerEnabled || !control || control.closest?.("[id^='wb-bridge-']")) {
      return false;
    }

    const label = getControlLabel(control);
    const localPath = getControlLocalPath(control);
    if (localPath && /打开.*(文件夹|目录)|在.*(文件管理器|资源管理器).*显示|open.*folder|show.*folder|reveal.*(explorer|folder)/iu.test(label)) {
      await openWorkspaceFileManagerOnce({ targetPath: localPath });
      return true;
    }

    return false;
  }

  function installDomCommandInterceptors() {
    const handler = (event) => {
      const control = getControlFromEvent(event);
      if (!control) {
        return;
      }
      if (!fileManagerEnabled) {
        return;
      }
      const label = getControlLabel(control);
      const shouldHandle =
        /打开.*(文件夹|目录)|在.*(文件管理器|资源管理器).*显示|open.*folder|show.*folder|reveal.*(explorer|folder)/iu.test(label);
      if (!shouldHandle) {
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

    for (const type of ["pointerdown", "mousedown", "click"]) {
      document.addEventListener(type, handler, true);
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
      return nativeWindowOpen(url, target, features);
    };
  }

  async function waitForBridgeRecovery({ timeoutMs = 90000, intervalMs = 1200 } = {}) {
    const startedAt = Date.now();
    let sawDisconnect = false;
    while (Date.now() - startedAt < timeoutMs) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        sawDisconnect = true;
      }
      try {
        const response = await fetch("/readyz?restart=" + Date.now(), { cache: "no-store" });
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
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    restartInProgress = false;
    ensureRestartButton();
    throw new Error(t("restartTimeout"));
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
    ensureRestartButton();
    setBridgeStatus(t("restartStarting"));
    try {
      await request({ type: "restart-app" });
    } catch (error) {
      restartInProgress = false;
      ensureRestartButton();
      throw error;
    }
    await waitForBridgeRecovery();
  }

  function ensureFileManagerButton() {
    let button = document.getElementById("wb-bridge-file-manager-button");
    if (!fileManagerEnabled) {
      button?.remove();
      return;
    }
    if (!button) {
      button = document.createElement("button");
      button.id = "wb-bridge-file-manager-button";
      button.type = "button";
      button.addEventListener("click", () => {
        openWorkspaceFileManagerOnce().catch((error) => {
          console.error("[workbuddy-remote] file manager failed", error);
          window.alert(error instanceof Error ? error.message : String(error));
        });
      });
      document.body.appendChild(button);
    }
    button.textContent = t("fileManager");
    applyFloatingActionButtonStyle(button, 87);
  }

  function ensureRestartButton() {
    let button = document.getElementById("wb-bridge-restart-button");
    if (!restartEnabled || !restartAvailable) {
      button?.remove();
      return;
    }
    if (!button) {
      button = document.createElement("button");
      button.id = "wb-bridge-restart-button";
      button.type = "button";
      button.addEventListener("click", () => {
        requestBridgeRestart().catch((error) => {
          console.error("[workbuddy-remote] restart failed", error);
          setBridgeStatus("");
          window.alert(error instanceof Error ? error.message : String(error));
        });
      });
      document.body.appendChild(button);
    }
    button.textContent = t("restartProgram");
    applyFloatingActionButtonStyle(
      button,
      20,
      restartInProgress,
      "rgba(110,28,28,.96)",
      "#fff2f2"
    );
  }

  async function initializeRemoteControls() {
    if (!fileManagerEnabled && !restartEnabled) {
      return;
    }
    try {
      const bootstrap = await fetchJson("/bridge/bootstrap");
      restartAvailable =
        restartEnabled && bootstrap?.restartAvailable !== false;
    } catch (error) {
      console.warn("[workbuddy-remote] failed to read bridge bootstrap", error);
    }
    ensureFileManagerButton();
    ensureRestartButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      installWindowControlHider();
      installDomCommandInterceptors();
      initializeRemoteControls().catch((error) => {
        console.warn("[workbuddy-remote] remote controls failed", error);
      });
    }, { once: true });
  } else {
    installWindowControlHider();
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
          const callbacks = listeners.get(key);
          if (!callbacks) {
            return;
          }
          const args = (message.args || []).map(decodeTransport);
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
          window.open(message.url, "_blank", "noopener,noreferrer");
        }
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
      socket.send(JSON.stringify(message));
    });
  }

  async function forwardBuddyApiCall(method, args) {
    return request({
      type: "buddy-api-call",
      method,
      args: await encodeValue(args),
    });
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
    if (method === "openExternal") {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url) {
        if (fileManagerEnabled && isLocalPathLike(url)) {
          await openWorkspaceFileManagerOnce({ targetPath: url });
          return true;
        }
        window.open(url, "_blank", "noopener,noreferrer");
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
    if (method === "workspaceOpenFolder" && fileManagerEnabled) {
      const targetPath = getPathCandidateFromArgs(args);
      if (isLocalPathLike(targetPath)) {
        await openWorkspaceFileManagerOnce({ targetPath });
        return true;
      }
      if (isRelativePathLike(targetPath)) {
        const workspacePath = await getCurrentWorkspacePath();
        await openWorkspaceFileManagerOnce({
          targetPath: workspacePath ? joinWindowsPath(workspacePath, targetPath) : targetPath,
        });
        return true;
      }
      return forwardBuddyApiCall(method, args);
    }
    if (method === "workspaceOpen" && fileManagerEnabled) {
      const selected = await promptForRemoteFolderPath(getPathCandidateFromArgs(args));
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
