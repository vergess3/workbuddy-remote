import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const WORKSPACE_ROOT_FOLDER_NAME = "WBWorkspaces";
const NO_STORE_CACHE_CONTROL = "no-store";

const DEFAULTS = {
  cdpHost: "127.0.0.1",
  cdpPort: 9333,
  listenHost: "127.0.0.1",
  listenPort: 8780,
  passwordHash: process.env.WORKBUDDY_REMOTE_PASSWORD_HASH || "",
  userDataDir: "",
  workbuddyPid: 0,
  openBrowser: false,
  logPath: "",
  enableModelSecretProxy: false,
  modelProxyPort: 8791,
  modelSecretStorePath: "",
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    switch (current) {
      case "--cdp-host":
        options.cdpHost = next || options.cdpHost;
        i += 1;
        break;
      case "--cdp-port":
        options.cdpPort = Number(next) || options.cdpPort;
        i += 1;
        break;
      case "--host":
        options.listenHost = next || options.listenHost;
        i += 1;
        break;
      case "--port":
        options.listenPort = Number(next) || options.listenPort;
        i += 1;
        break;
      case "--password-hash":
        options.passwordHash = next || "";
        i += 1;
        break;
      case "--user-data-dir":
        options.userDataDir = next || "";
        i += 1;
        break;
      case "--workbuddy-pid":
        options.workbuddyPid = Number(next) || 0;
        i += 1;
        break;
      case "--open-browser":
        options.openBrowser = true;
        break;
      case "--log-path":
        options.logPath = next || "";
        i += 1;
        break;
      case "--model-secret-proxy":
        options.enableModelSecretProxy = true;
        break;
      case "--model-proxy-port":
        options.modelProxyPort = Number(next) || options.modelProxyPort;
        i += 1;
        break;
      case "--model-secret-store-path":
        options.modelSecretStorePath = next || "";
        i += 1;
        break;
      default:
        break;
    }
  }
  return options;
}

function resolveWorkBuddyExePath() {
  const candidates = [
    process.env.WORKBUDDY_EXE_PATH,
    path.join(process.env.LOCALAPPDATA || "", "Programs", "WorkBuddy", "WorkBuddy.exe"),
    path.join(process.env.ProgramFiles || "", "WorkBuddy", "WorkBuddy.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "WorkBuddy", "WorkBuddy.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  return "";
}

function resolveWorkBuddyAsarPath() {
  const envAsar = process.env.WORKBUDDY_APP_ASAR;
  if (envAsar && existsSync(envAsar)) {
    return path.resolve(envAsar);
  }

  const exePath = resolveWorkBuddyExePath();
  if (!exePath) {
    throw new Error("WORKBUDDY_EXE_PATH is not set and WorkBuddy.exe was not found.");
  }

  const asarPath = path.join(path.dirname(exePath), "resources", "app.asar");
  if (!existsSync(asarPath)) {
    throw new Error(`WorkBuddy app.asar was not found: ${asarPath}`);
  }
  return asarPath;
}

function loadWebSocketModule() {
  const require = createRequire(import.meta.url);
  return require("ws");
}

const { WebSocket, WebSocketServer } = loadWebSocketModule();

function json(res, statusCode, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": body.byteLength,
    ...headers,
  });
  res.end(body);
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

function text(res, statusCode, body, contentType = "text/plain; charset=utf-8", cacheControl = "no-store") {
  const buffer = Buffer.from(String(body), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Content-Length": buffer.byteLength,
  });
  res.end(buffer);
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
    case ".wasm":
      return "application/wasm";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLanUrls(port) {
  const urls = [];
  const seen = new Set();
  for (const entries of Object.values(os.networkInterfaces())) {
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

function encodePayloadForTransport(value) {
  if (value instanceof ArrayBuffer) {
    return { kind: "base64", base64: Buffer.from(value).toString("base64") };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      kind: "base64",
      base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"),
    };
  }
  return { kind: "json", value };
}

export {
  DEFAULTS,
  NO_STORE_CACHE_CONTROL,
  WebSocket,
  WebSocketServer,
  WORKSPACE_ROOT_FOLDER_NAME,
  contentTypeFor,
  delay,
  encodePayloadForTransport,
  getLanUrls,
  json,
  parseArgs,
  readJsonBody,
  resolveWorkBuddyAsarPath,
  resolveWorkBuddyExePath,
  text,
};
