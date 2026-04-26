import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeExistingAppRoot(candidatePath) {
  if (!candidatePath || typeof candidatePath !== "string") {
    return null;
  }

  const normalized = path.resolve(candidatePath);
  if (existsSync(path.join(normalized, "package.json"))) {
    return normalized;
  }

  const nestedApp = path.join(normalized, "resources", "app");
  if (existsSync(path.join(nestedApp, "package.json"))) {
    return nestedApp;
  }

  return null;
}

function findAppRoot(startDir, maxLevels = 8) {
  const envCandidates = [
    process.env.WORKBUDDY_APP_ROOT,
    process.env.WORKBUDDY_EXE_PATH
      ? path.dirname(process.env.WORKBUDDY_EXE_PATH)
      : "",
  ];

  for (const candidate of envCandidates) {
    const resolved = normalizeExistingAppRoot(candidate);
    if (resolved) {
      return resolved;
    }
  }

  let currentDir = startDir;
  for (let level = 0; level <= maxLevels; level += 1) {
    const candidate = path.join(currentDir, "resources", "app", "package.json");
    if (existsSync(candidate)) {
      return path.join(currentDir, "resources", "app");
    }

    const parentDir = path.dirname(currentDir);
    if (!parentDir || parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error(`Failed to locate resources/app from script directory: ${startDir}`);
}

const APP_ROOT = findAppRoot(__dirname);
const AGENT_MANAGER_JS_PATH = path.join(
  APP_ROOT,
  "out",
  "vs",
  "code",
  "electron-sandbox",
  "workbench",
  "agentManager.js"
);

const requireFromApp = createRequire(pathToFileURL(path.join(APP_ROOT, "package.json")));
const { WebSocket, WebSocketServer } = requireFromApp("ws");

const DEFAULTS = {
  cdpHost: "127.0.0.1",
  cdpPort: 9333,
  listenHost: "127.0.0.1",
  listenPort: 8780,
  passwordHash: process.env.WORKBUDDY_REMOTE_PASSWORD_HASH || "",
  userDataDir: "",
  workbuddyPid: 0,
  launcherPid: 0,
  launcherParentPid: 0,
  relaunchShell: "powershell",
  logPath: "",
  showReadyWindow: false,
  openBrowser: false,
};

const AUTH_SESSION_CHANNEL = "vscode:genie:auth:sessionChanged";
const AUTH_SESSION_REQUEST = "vscode:genie:auth:getSession";
const AUTH_LOGIN_REQUEST = "vscode:genie:auth:login";
const AUTH_LOGIN_URL_REQUEST = "vscode:genie:auth:getLoginUrl";
const PICK_FOLDER_REQUEST = "codebuddy:pickFolder";
const WORKSPACE_ROOT_FOLDER_NAME = "WBWorkspaces";

function parseArgs(argv) {
  const config = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    switch (current) {
      case "--cdp-host":
        config.cdpHost = next;
        i += 1;
        break;
      case "--cdp-port":
        config.cdpPort = Number(next);
        i += 1;
        break;
      case "--host":
        config.listenHost = next;
        i += 1;
        break;
      case "--port":
        config.listenPort = Number(next);
        i += 1;
        break;
      case "--password-hash":
        config.passwordHash = next || "";
        i += 1;
        break;
      case "--user-data-dir":
        config.userDataDir = next || "";
        i += 1;
        break;
      case "--workbuddy-pid":
        config.workbuddyPid = Number(next) || 0;
        i += 1;
        break;
      case "--launcher-pid":
        config.launcherPid = Number(next) || 0;
        i += 1;
        break;
      case "--launcher-parent-pid":
        config.launcherParentPid = Number(next) || 0;
        i += 1;
        break;
      case "--relaunch-shell":
        config.relaunchShell = next || DEFAULTS.relaunchShell;
        i += 1;
        break;
      case "--log-path":
        config.logPath = next || "";
        i += 1;
        break;
      case "--show-ready-window":
        config.showReadyWindow = true;
        break;
      case "--open-browser":
        config.openBrowser = true;
        break;
      default:
        break;
    }
  }
  return config;
}

const NO_STORE_CACHE_CONTROL = "no-store";
const STATIC_CACHE_CONTROL = "public, max-age=3600";

function json(res, statusCode, payload, cacheControl = NO_STORE_CACHE_CONTROL) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function text(
  res,
  statusCode,
  payload,
  contentType = "text/plain; charset=utf-8",
  cacheControl = NO_STORE_CACHE_CONTROL
) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function normalizeDriveLetter(input) {
  const raw = typeof input === "string" ? input.trim().toUpperCase() : "";
  if (!/^[A-Z]:$/.test(raw)) {
    return null;
  }
  return raw;
}

function getDriveRootPath(drive) {
  return `${drive}\\`;
}

function getWorkspaceRootPath(drive) {
  return path.win32.join(getDriveRootPath(drive), WORKSPACE_ROOT_FOLDER_NAME);
}

function normalizeWindowsPath(inputPath) {
  return typeof inputPath === "string" && inputPath.trim()
    ? path.win32.normalize(inputPath.trim())
    : null;
}

function isSubPath(parentPath, childPath) {
  const normalizedParent = path.win32.resolve(parentPath).toLowerCase();
  const normalizedChild = path.win32.resolve(childPath).toLowerCase();
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(
      normalizedParent.endsWith("\\") ? normalizedParent : `${normalizedParent}\\`
    )
  );
}

async function resolveWorkspaceFolderPath(folderPath) {
  const normalizedPath = normalizeWindowsPath(folderPath);
  if (!normalizedPath) {
    throw new Error("Missing workspace folder path.");
  }

  const driveMatch = normalizedPath.match(/^[A-Za-z]:/);
  if (!driveMatch) {
    throw new Error("Invalid workspace folder path.");
  }

  const { workspaceRoot } = await ensureWorkspaceRootForDrive(driveMatch[0].toUpperCase());
  if (!isSubPath(workspaceRoot, normalizedPath)) {
    throw new Error("Only paths inside WBWorkspaces are allowed.");
  }

  const stats = await fs.stat(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error("The selected workspace path is not a directory.");
  }

  return {
    normalizedPath,
    workspaceRoot,
  };
}

async function listAvailableDrives() {
  const drives = [];
  for (let code = 67; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:`;
    const rootPath = getDriveRootPath(drive);
    try {
      await fs.access(rootPath);
      drives.push({
        drive,
        rootPath,
        workspaceRoot: getWorkspaceRootPath(drive),
      });
    } catch {}
  }
  return drives;
}

async function ensureWorkspaceRootForDrive(inputDrive) {
  const drive = normalizeDriveLetter(inputDrive);
  if (!drive) {
    throw new Error("Invalid drive.");
  }

  const rootPath = getDriveRootPath(drive);
  try {
    await fs.access(rootPath);
  } catch {
  throw new Error(`Drive ${drive} does not exist on the host.`);
  }

  const workspaceRoot = getWorkspaceRootPath(drive);
  await fs.mkdir(workspaceRoot, { recursive: true });
  return {
    drive,
    rootPath,
    workspaceRoot,
  };
}

async function listWorkspaceFoldersForDrive(inputDrive) {
  const { drive, workspaceRoot } = await ensureWorkspaceRootForDrive(inputDrive);
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  const folders = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const folderPath = path.win32.join(workspaceRoot, entry.name);
    let mtimeMs = 0;
    try {
      const stats = await fs.stat(folderPath);
      mtimeMs = stats.mtimeMs;
    } catch {}

    folders.push({
      name: entry.name,
      path: folderPath,
      mtimeMs,
    });
  }

  folders.sort((left, right) => {
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  });

  return {
    drive,
    workspaceRoot,
    folders,
  };
}

function validateWorkspaceFolderName(inputName) {
  const folderName = typeof inputName === "string" ? inputName.trim() : "";
  if (!folderName) {
    return {
      ok: false,
      error: "Please enter a new workspace folder name.",
    };
  }

  if (/[<>:"/\\|?*\x00-\x1F]/.test(folderName)) {
    return {
      ok: false,
      error: "Workspace folder names cannot contain <>:\"/\\|?* or control characters.",
    };
  }

  if (folderName === "." || folderName === "..") {
    return {
      ok: false,
      error: "Workspace folder name is invalid.",
    };
  }

  if (/[. ]$/.test(folderName)) {
    return {
      ok: false,
      error: "Workspace folder names cannot end with a space or period.",
    };
  }

  const upper = folderName.toUpperCase();
  const reserved = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ]);
  if (reserved.has(upper)) {
    return {
      ok: false,
      error: "Workspace folder name cannot use a reserved Windows name.",
    };
  }

  return {
    ok: true,
    folderName,
  };
}

async function createWorkspaceFolderForDrive(inputDrive, inputName) {
  const { workspaceRoot } = await ensureWorkspaceRootForDrive(inputDrive);
  const validation = validateWorkspaceFolderName(inputName);
  if (!validation.ok) {
    return validation;
  }

  const folderPath = path.win32.join(workspaceRoot, validation.folderName);
  try {
    await fs.mkdir(folderPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return {
        ok: false,
          error: "That workspace folder already exists.",
      };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    name: validation.folderName,
    path: folderPath,
  };
}

function validateWorkspaceFileName(inputName) {
  const fileName = typeof inputName === "string" ? inputName.trim() : "";
  if (!fileName) {
    return {
      ok: false,
      error: "File name cannot be empty.",
    };
  }

  if (/[<>:"/\\|?*\x00-\x1F]/.test(fileName)) {
    return {
      ok: false,
      error: "File names cannot contain <>:\"/\\|?* or control characters.",
    };
  }

  if (/[. ]$/.test(fileName)) {
    return {
      ok: false,
      error: "File names cannot end with a space or period.",
    };
  }

  const stem = fileName.split(".")[0].toUpperCase();
  const reserved = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ]);
  if (reserved.has(stem)) {
    return {
      ok: false,
      error: "File name cannot use a reserved Windows name.",
    };
  }

  return {
    ok: true,
    fileName,
  };
}

async function listWorkspaceEntries(folderPath) {
  const { normalizedPath } = await resolveWorkspaceFolderPath(folderPath);
  const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const entryPath = path.win32.join(normalizedPath, entry.name);
    let stats = null;
    try {
      stats = await fs.stat(entryPath);
    } catch {}

    results.push({
      name: entry.name,
      path: entryPath,
      kind: "file",
      size: stats?.size ?? 0,
      mtimeMs: stats?.mtimeMs ?? 0,
    });
  }

  results.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  return {
    ok: true,
    folderPath: normalizedPath,
    entries: results,
  };
}

async function deleteWorkspaceEntry(targetPath) {
  const normalizedPath = normalizeWindowsPath(targetPath);
  if (!normalizedPath) {
    return {
      ok: false,
      error: "Missing path to delete.",
    };
  }

  const driveMatch = normalizedPath.match(/^[A-Za-z]:/);
  if (!driveMatch) {
    return {
      ok: false,
      error: "Invalid path to delete.",
    };
  }

  const { workspaceRoot } = await ensureWorkspaceRootForDrive(driveMatch[0].toUpperCase());
  if (!isSubPath(workspaceRoot, normalizedPath) || normalizedPath === workspaceRoot) {
    return {
      ok: false,
        error: "Only files inside WBWorkspaces can be deleted.",
    };
  }

  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) {
    return {
      ok: false,
      error: "Only files can be deleted from the file manager right now.",
    };
  }

  await fs.rm(normalizedPath, { force: false });
  return {
    ok: true,
    path: normalizedPath,
  };
}

async function resolveWorkspaceFilePath(targetPath) {
  const normalizedPath = normalizeWindowsPath(targetPath);
  if (!normalizedPath) {
    throw new Error("Missing target file path.");
  }

  const driveMatch = normalizedPath.match(/^[A-Za-z]:/);
  if (!driveMatch) {
    throw new Error("Invalid target file path.");
  }

  const { workspaceRoot } = await ensureWorkspaceRootForDrive(driveMatch[0].toUpperCase());
  if (!isSubPath(workspaceRoot, normalizedPath) || normalizedPath === workspaceRoot) {
    throw new Error("Only files inside WBWorkspaces can be downloaded.");
  }

  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) {
    throw new Error("The selected path is not a file.");
  }

  return {
    normalizedPath,
    stats,
  };
}

function encodePayloadForTransport(value) {
  if (value instanceof ArrayBuffer) {
    return {
      kind: "base64",
      base64: Buffer.from(value).toString("base64"),
    };
  }

  if (ArrayBuffer.isView(value)) {
    return {
      kind: "base64",
      base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"),
    };
  }

  return {
    kind: "json",
    value,
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getLanUrls(port) {
  const urls = [];
  const seen = new Set();
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }

      const url = `http://${entry.address}:${port}/agent-manager/`;
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}


export {
  APP_ROOT,
  AGENT_MANAGER_JS_PATH,
  WebSocket,
  WebSocketServer,
  DEFAULTS,
  AUTH_SESSION_CHANNEL,
  AUTH_SESSION_REQUEST,
  AUTH_LOGIN_REQUEST,
  AUTH_LOGIN_URL_REQUEST,
  PICK_FOLDER_REQUEST,
  WORKSPACE_ROOT_FOLDER_NAME,
  NO_STORE_CACHE_CONTROL,
  STATIC_CACHE_CONTROL,
  parseArgs,
  json,
  text,
  readJsonBody,
  contentTypeFor,
  delay,
  getLanUrls,
};

