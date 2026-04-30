import http from "node:http";
import path from "node:path";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

import { AsarArchive } from "../asar.mjs";
import {
  WebSocketServer,
  contentTypeFor,
  getLanUrls,
  json,
  NO_STORE_CACHE_CONTROL,
  readJsonBody,
  resolveWorkBuddyAsarPath,
  text,
} from "../shared.mjs";
import { logger, summarizeMessage } from "../logger.mjs";
import {
  renderWorkBuddyNativeHtml,
  renderWorkBuddyNativeShimJs,
} from "../web/workbuddy-native.mjs";
import { createBridgeAccessAuth } from "./access-auth.mjs";
import { loadBridgeUiConfig, loadConfig } from "../config.mjs";
import {
  createWorkspaceFolder,
  deleteWorkspaceFolder,
  deleteWorkspaceEntry,
  listAvailableWorkspaceRoots,
  listWorkspaceEntries,
  listWorkspaceFolders,
  renameWorkspaceFolder,
  resolveWorkspaceFilePath,
  uploadWorkspaceFile,
} from "../workspace/service.mjs";

const HTML_CACHE_CONTROL = "no-cache";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const REVALIDATED_STATIC_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const COMPRESSIBLE_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg"]);
const MAX_COMPRESSED_STATIC_ASSET_BYTES = 32 * 1024 * 1024;
const BROWSER_WS_MAX_PAYLOAD_BYTES = readPositiveIntegerEnv(
  ["WORKBUDDY_REMOTE_BROWSER_WS_MAX_PAYLOAD_BYTES", "WORKBUDDY_REMOTE_MAX_PAYLOAD_BYTES"],
  512 * 1024 * 1024
);
const versionedScriptCompressionCache = new Map();
const WORKBUDDY_ASAR_PATH = resolveWorkBuddyAsarPath();
const workBuddyAsar = new AsarArchive(WORKBUDDY_ASAR_PATH);
const MODEL_SECRET_READ_METHODS = new Set([
  "configGet",
  "configGetAll",
  "configGetLocalCustomModels",
  "configSaveLocalCustomModel",
  "configDeleteLocalCustomModel",
]);
const MODEL_SECRET_WRITE_METHODS = new Set([
  "configSet",
  "configSaveLocalCustomModel",
]);
const REDACTED_MODEL_API_KEY = "workbuddy-remote-redacted-api-key";
const REDACTED_MODEL_ENDPOINT = "https://workbuddy-remote.local/redacted/chat/completions";

function readPositiveIntegerEnv(names, fallback) {
  const candidates = Array.isArray(names) ? names : [names];
  for (const name of candidates) {
    const raw = process.env[name];
    if (!raw) {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }
  return fallback;
}

async function loadFeatureFlags() {
  const config = await loadConfig();
  return {
    enableFileManager: config.enableFileManager !== false,
    enableRestart: config.enableRestart !== false,
  };
}

async function isFileManagerEnabled() {
  return (await loadFeatureFlags()).enableFileManager;
}

async function isRestartEnabled() {
  return (await loadFeatureFlags()).enableRestart;
}

function normalizeSecretFieldName(name) {
  return String(name || "").replace(/[\s_-]/g, "").toLowerCase();
}

function getModelSecretFieldType(name) {
  const normalized = normalizeSecretFieldName(name);
  if (
    normalized === "apikey" ||
    normalized === "secretkey" ||
    normalized.endsWith(".apikey") ||
    normalized.endsWith(".secretkey")
  ) {
    return "apiKey";
  }
  if (
    normalized === "endpoint" ||
    normalized === "baseurl" ||
    normalized === "apiurl" ||
    normalized.endsWith(".endpoint") ||
    normalized.endsWith(".baseurl") ||
    normalized.endsWith(".apiurl")
  ) {
    return "endpoint";
  }
  return "";
}

function isRedactedModelSecretValue(value) {
  return value === REDACTED_MODEL_API_KEY || value === REDACTED_MODEL_ENDPOINT;
}

function getModelSecretPlaceholder(fieldType) {
  return fieldType === "endpoint" ? REDACTED_MODEL_ENDPOINT : REDACTED_MODEL_API_KEY;
}

function getModelSecretIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const parts = [];
  for (const key of ["id", "modelId", "providerId", "name"]) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) {
      parts.push(`${key}:${item.trim()}`);
    }
  }
  return parts.length > 0 ? parts.join("|") : "";
}

function createModelSecretProtector() {
  const valuesByPath = new Map();
  const valuesByIdentity = new Map();

  function remember(pathKey, identity, fieldName, value) {
    valuesByPath.set(pathKey, value);
    if (!identity) {
      return;
    }
    const current = valuesByIdentity.get(identity) || {};
    current[fieldName] = value;
    valuesByIdentity.set(identity, current);
  }

  function findCached(pathKey, identity, fieldName) {
    if (identity) {
      const current = valuesByIdentity.get(identity);
      if (current && Object.prototype.hasOwnProperty.call(current, fieldName)) {
        return current[fieldName];
      }
    }
    if (valuesByPath.has(pathKey)) {
      return valuesByPath.get(pathKey);
    }
    return undefined;
  }

  function protect(value, path = []) {
    if (Array.isArray(value)) {
      return value.map((item, index) => protect(item, [...path, String(index)]));
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const identity = getModelSecretIdentity(value);
    const result = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const fieldType = getModelSecretFieldType(key);
      const pathKey = [...path, key].join(".");
      if (fieldType && typeof nestedValue === "string" && nestedValue) {
        remember(pathKey, identity, key, nestedValue);
        result[key] = getModelSecretPlaceholder(fieldType);
      } else {
        result[key] = protect(nestedValue, [...path, key]);
      }
    }
    return result;
  }

  function restore(value, path = []) {
    if (Array.isArray(value)) {
      return value.map((item, index) => restore(item, [...path, String(index)]));
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const identity = getModelSecretIdentity(value);
    const result = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const fieldType = getModelSecretFieldType(key);
      const pathKey = [...path, key].join(".");
      if (fieldType && isRedactedModelSecretValue(nestedValue)) {
        const cached = findCached(pathKey, identity, key);
        if (cached === undefined) {
          throw new Error("A redacted model secret could not be restored. Re-enter it before saving.");
        }
        result[key] = cached;
      } else {
        result[key] = restore(nestedValue, [...path, key]);
      }
    }
    return result;
  }

  function protectConfigGetResult(args, result) {
    const configKey = typeof args?.[0] === "string" ? args[0] : "";
    const fieldType = getModelSecretFieldType(configKey);
    if (fieldType && typeof result === "string" && result) {
      remember(`config.${configKey}`, "", configKey, result);
      return getModelSecretPlaceholder(fieldType);
    }
    return protect(result);
  }

  function restoreConfigSetArgs(args) {
    if (
      Array.isArray(args) &&
      typeof args[0] === "string" &&
      getModelSecretFieldType(args[0]) &&
      isRedactedModelSecretValue(args[1])
    ) {
      const cached = findCached(`config.${args[0]}`, "", args[0]);
      if (cached === undefined) {
        throw new Error("A redacted model secret could not be restored. Re-enter it before saving.");
      }
      return [args[0], cached, ...args.slice(2)];
    }
    return restore(args);
  }

  return {
    protectResult(method, args, result) {
      if (!MODEL_SECRET_READ_METHODS.has(method)) {
        return result;
      }
      return method === "configGet" ? protectConfigGetResult(args, result) : protect(result);
    },
    restoreArgs(method, args) {
      if (!MODEL_SECRET_WRITE_METHODS.has(method)) {
        return args;
      }
      return method === "configSet" ? restoreConfigSetArgs(args) : restore(args);
    },
  };
}

function writeFeatureDisabled(res, featureName) {
  json(res, 403, {
    ok: false,
    error: `${featureName} is disabled by config.`,
  });
}

function isCompressibleAsset(filePath) {
  return COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function pickContentEncoding(req) {
  const acceptEncoding = String(req.headers["accept-encoding"] || "");
  if (acceptEncoding.includes("br")) {
    return "br";
  }
  if (acceptEncoding.includes("gzip")) {
    return "gzip";
  }
  return null;
}

function createCompressor(encoding) {
  if (encoding === "br") {
    return zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
      },
    });
  }

  return zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
}

function compressBufferSync(body, encoding) {
  if (encoding === "br") {
    return zlib.brotliCompressSync(body, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
      },
    });
  }

  return zlib.gzipSync(body, { level: zlib.constants.Z_BEST_SPEED });
}

function isEtagMatch(req, etag) {
  const header = req.headers["if-none-match"];
  if (!header) {
    return false;
  }
  return String(header)
    .split(",")
    .map((value) => value.trim())
    .includes(etag);
}

function isModifiedSinceMatch(req, stats) {
  const header = req.headers["if-modified-since"];
  if (!header) {
    return false;
  }

  const parsed = Date.parse(String(header));
  if (Number.isNaN(parsed)) {
    return false;
  }

  return Math.trunc(stats.mtimeMs / 1000) <= Math.trunc(parsed / 1000);
}

function writeNotModified(res, headers = {}) {
  res.writeHead(304, headers);
  res.end();
}

function writeBuffer(res, statusCode, body, headers) {
  res.writeHead(statusCode, {
    ...headers,
    "Content-Length": body.byteLength,
  });
  res.end(body);
}

async function sendAsarAsset(req, res, archive, relativePath, cacheControl) {
  const info = await archive.statFile(relativePath);
  if (!info) {
    json(res, 404, { error: "Not found" });
    return;
  }

  const contentType = contentTypeFor(relativePath);
  const lastModified = info.mtime.toUTCString();
  const baseHeaders = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ETag: info.etag,
    "Last-Modified": lastModified,
  };

  if (isEtagMatch(req, info.etag) || isModifiedSinceMatch(req, info)) {
    writeNotModified(res, baseHeaders);
    return;
  }

  const encoding =
    info.size <= MAX_COMPRESSED_STATIC_ASSET_BYTES && isCompressibleAsset(relativePath)
      ? pickContentEncoding(req)
      : null;
  const stream = archive.createReadStream(info);
  if (!encoding) {
    res.writeHead(200, {
      ...baseHeaders,
      "Content-Length": info.size,
    });
    await pipeline(stream, res);
    return;
  }

  res.writeHead(200, {
    ...baseHeaders,
    "Content-Encoding": encoding,
    Vary: "Accept-Encoding",
  });
  await pipeline(stream, createCompressor(encoding), res);
}

async function sendMaybePatchedWorkBuddyAsset(req, res, archive, relativePath, cacheControl) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const fileName = path.posix.basename(normalizedPath);
  const shouldPatchGrowthBuddy =
    /^setting-[\w-]+\.js$/u.test(fileName) &&
    normalizedPath.startsWith("renderer/assets/");
  const shouldPatchMainIndex =
    /^index-[\w-]+\.js$/u.test(fileName) &&
    normalizedPath.startsWith("renderer/assets/");

  if (!shouldPatchGrowthBuddy && !shouldPatchMainIndex) {
    await sendAsarAsset(req, res, archive, relativePath, cacheControl);
    return;
  }

  const source = await archive.readFile(relativePath);
  if (!source) {
    json(res, 404, { error: "Not found" });
    return;
  }

  const original = source.toString("utf8");
  const growthBuddyMissingFrom =
    'console.warn("[useGrowthBuddy] adapter.getGrowthBuddy is not available");\n\t\t\tsetError("Growth buddy feature is not available");';
  const growthBuddyMissingTo =
    'console.info("[useGrowthBuddy] growth buddy feature is unavailable in this remote bridge");\n\t\t\tfetchedRef.current = true;\n\t\t\tsetError(null);\n\t\t\treturn;';
  const wecomStatusUnhandledFrom =
    'if (event.startsWith("memory-") || event.includes("memory")) return;\n\t\tif (event === "sandbox-intercept-request") {';
  const wecomStatusUnhandledTo =
    'if (event === "wecom-status") return;\n\t\tif (event.startsWith("memory-") || event.includes("memory")) return;\n\t\tif (event === "sandbox-intercept-request") {';
  let patched = original;
  if (shouldPatchGrowthBuddy && patched.includes(growthBuddyMissingFrom)) {
    patched = patched.replace(growthBuddyMissingFrom, growthBuddyMissingTo);
  }
  if (shouldPatchMainIndex && patched.includes(wecomStatusUnhandledFrom)) {
    patched = patched.replace(wecomStatusUnhandledFrom, wecomStatusUnhandledTo);
  }
  if (shouldPatchMainIndex) {
    const sidebarToggleExposeFrom =
      'const applySmartSpaceLayout = (0, import_react.useCallback)((options) => {';
    const sidebarToggleExposeTo = `try {
      const __workbuddyRemoteAnimateSidebar = () => {
        const gridEl = gridRef.current?.element ?? document.querySelector(".teams-container");
        if (gridEl) {
          gridEl.classList.add("sidebar-animating");
          setTimeout(() => gridEl.classList.remove("sidebar-animating"), 300);
        }
      };
      const __workbuddyRemoteDrawerConfig = () => ({
        placement: "left",
        size: SIDEBAR_SIZE.EXPANDED_WIDTH,
        showBackdrop: true,
        animationDuration: 300
      });
      globalThis.__workbuddyRemoteSetSidebarOpen = (open) => {
        const nextOpen = Boolean(open);
        const grid = gridRef.current;
        const view = sidebarGridViewRef.current;
        if (!grid || !view) return false;
        const viewportWidth = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
        const runtimeNarrowForSidebar = Boolean(isNarrowForSidebar || (viewportWidth > 0 && viewportWidth <= 820));
        const runtimeNarrowForDetail = Boolean(isNarrowForDetail || (viewportWidth > 0 && viewportWidth <= 980));
        if (isLocalMode) {
          __workbuddyRemoteAnimateSidebar();
          if (nextOpen) {
            view.minimumWidth = SIDEBAR_SIZE.EXPANDED_WIDTH;
            view.maximumWidth = SIDEBAR_SIZE.EXPANDED_WIDTH;
            grid.setViewVisible(view, true);
            setSidebarExpanded(true);
            setWorkbuddyHidden(false);
          } else {
            grid.setViewVisible(view, false);
            setWorkbuddyHidden(true);
          }
          try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextOpen)); } catch {}
          return true;
        }
        if (runtimeNarrowForSidebar) {
          if (nextOpen) {
            if (runtimeNarrowForDetail && detailPanelViewRef.current) {
              try {
                if (grid.isDrawerOpen?.(detailPanelViewRef.current)) grid.closeDrawer(detailPanelViewRef.current);
              } catch {}
            }
            if (typeof grid.openDrawer === "function") {
              grid.openDrawer(view, __workbuddyRemoteDrawerConfig());
            } else if (typeof grid.toggleDrawer === "function" && !grid.isDrawerOpen?.(view)) {
              grid.toggleDrawer(view, __workbuddyRemoteDrawerConfig());
            }
          } else if (typeof grid.closeDrawer === "function") {
            try { grid.closeDrawer(view); } catch {}
          }
          return true;
        }
        __workbuddyRemoteAnimateSidebar();
        if (nextOpen && !canExpandSidebar()) return false;
        userWantsSidebarExpandedRef.current = nextOpen;
        isAutoCollapsedRef.current = false;
        try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextOpen)); } catch {}
        setSidebarExpanded(nextOpen);
        return true;
      };
      globalThis.__workbuddyRemoteOpenSidebar = () => globalThis.__workbuddyRemoteSetSidebarOpen(true);
      globalThis.__workbuddyRemoteCloseSidebar = () => globalThis.__workbuddyRemoteSetSidebarOpen(false);
      globalThis.__workbuddyRemoteToggleSidebar = handleToggleSidebar;
      globalThis.__workbuddyRemoteGetSidebarState = () => {
        let drawerOpen = false;
        try { drawerOpen = Boolean(gridRef.current?.isDrawerOpen?.(sidebarGridViewRef.current)); } catch {}
        const viewportWidth = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
        const runtimeNarrowForSidebar = Boolean(isNarrowForSidebar || (viewportWidth > 0 && viewportWidth <= 820));
        return {
          open: isLocalMode ? !workbuddyHidden : runtimeNarrowForSidebar ? drawerOpen : sidebarExpanded,
          collapsed: isLocalMode ? workbuddyHidden : !sidebarExpanded,
          narrow: runtimeNarrowForSidebar,
          local: isLocalMode
        };
      };
    } catch {} const applySmartSpaceLayout = (0, import_react.useCallback)((options) => {`;
    if (patched.includes(sidebarToggleExposeFrom) && !patched.includes("__workbuddyRemoteToggleSidebar")) {
      patched = patched.replace(sidebarToggleExposeFrom, sidebarToggleExposeTo);
    }
  }

  sendVersionedScript(req, res, patched, {
    etag: `"workbuddy-asset-${fileName}-${patched.length}"`,
    cacheControl,
  });
}

function sendVersionedScript(req, res, payload, { etag, cacheControl }) {
  const body = Buffer.from(payload, "utf8");
  const contentType = "application/javascript; charset=utf-8";
  const baseHeaders = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ETag: etag,
  };

  if (isEtagMatch(req, etag)) {
    writeNotModified(res, baseHeaders);
    return;
  }

  const encoding = body.byteLength <= MAX_COMPRESSED_STATIC_ASSET_BYTES ? pickContentEncoding(req) : null;
  if (!encoding) {
    writeBuffer(res, 200, body, baseHeaders);
    return;
  }

  const cacheKey = `${etag}:${encoding}:${body.byteLength}`;
  let encodedBody = versionedScriptCompressionCache.get(cacheKey);
  if (!encodedBody) {
    encodedBody = compressBufferSync(body, encoding);
    versionedScriptCompressionCache.set(cacheKey, encodedBody);
  }

  writeBuffer(res, 200, encodedBody, {
    ...baseHeaders,
    "Content-Encoding": encoding,
    Vary: "Accept-Encoding",
  });
}

function isLoopbackHost(host) {
  const value = String(host || "").trim().toLowerCase();
  return value === "127.0.0.1" || value === "::1" || value === "localhost";
}

function getAccessUrls(options) {
  if (isLoopbackHost(options.listenHost)) {
    return [`http://127.0.0.1:${options.listenPort}/agent-manager/`];
  }

  if (options.listenHost === "0.0.0.0" || options.listenHost === "::") {
    return [
      `http://127.0.0.1:${options.listenPort}/agent-manager/`,
      ...getLanUrls(options.listenPort),
    ];
  }

  return [`http://${options.listenHost}:${options.listenPort}/agent-manager/`];
}

function createRequestHandler(runtime, auth) {
  return async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", "http://bridge.local");

      if (await auth.handleRequest(req, res, requestUrl)) {
        return;
      }

      if (requestUrl.pathname === "/") {
        res.writeHead(302, { Location: "/agent-manager/" });
        res.end();
        return;
      }

      if (requestUrl.pathname === "/healthz") {
        json(res, 200, { ok: true });
        return;
      }

      if (requestUrl.pathname === "/readyz") {
        const ready = runtime.isHostConnected();
        json(res, ready ? 200 : 503, {
          ok: ready,
          hostConnected: ready,
        });
        return;
      }

      if (requestUrl.pathname === "/bridge/bootstrap") {
        const features = await loadFeatureFlags();
        json(res, 200, {
          ok: true,
          hostConnected: runtime.isHostConnected(),
          enableFileManager: features.enableFileManager,
          restartAvailable: features.enableRestart && runtime.canRestartCurrentApp(),
        });
        return;
      }

      if (requestUrl.pathname === "/bridge/workspace-roots") {
        if (!(await isFileManagerEnabled())) {
          writeFeatureDisabled(res, "File manager");
          return;
        }
        json(res, 200, {
          ok: true,
          roots: await listAvailableWorkspaceRoots(),
        });
        return;
      }

      if (requestUrl.pathname === "/bridge/workspace-context") {
        if (!(await isFileManagerEnabled())) {
          writeFeatureDisabled(res, "File manager");
          return;
        }
        json(res, 200, {
          ok: true,
          paths: await runtime.getWorkspaceContextCandidates(),
        });
        return;
      }

      if (requestUrl.pathname === "/bridge/workspace-folders") {
        if (!(await isFileManagerEnabled())) {
          writeFeatureDisabled(res, "File manager");
          return;
        }
        if (req.method === "GET") {
          const result = await listWorkspaceFolders(requestUrl.searchParams.get("rootPath"));
          json(res, 200, {
            ok: true,
            ...result,
          });
          return;
        }

        if (req.method === "POST") {
          const payload = await readJsonBody(req);
          json(res, 200, await createWorkspaceFolder(payload?.rootPath, payload?.name));
          return;
        }

        if (req.method === "PATCH") {
          const payload = await readJsonBody(req);
          json(res, 200, await renameWorkspaceFolder(payload?.folderPath, payload?.name));
          return;
        }

        if (req.method === "DELETE") {
          const payload = await readJsonBody(req);
          json(res, 200, await deleteWorkspaceFolder(payload?.folderPath));
          return;
        }

        json(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      if (requestUrl.pathname === "/bridge/workspace-files") {
        if (!(await isFileManagerEnabled())) {
          writeFeatureDisabled(res, "File manager");
          return;
        }
        if (req.method === "GET") {
          json(res, 200, await listWorkspaceEntries(requestUrl.searchParams.get("folderPath")));
          return;
        }

        if (req.method === "POST") {
          const uploadId = requestUrl.searchParams.get("uploadId");
          const totalBytes = Number(req.headers["content-length"] || 0);
          let lastProgressAt = 0;
          const onProgress = uploadId
            ? (loadedBytes) => {
                const now = Date.now();
                if (loadedBytes < totalBytes && now - lastProgressAt < 150) {
                  return;
                }
                lastProgressAt = now;
                runtime.broadcast({
                  type: "workspace-upload-progress",
                  uploadId,
                  loadedBytes,
                  totalBytes,
                });
              }
            : undefined;

          const result = await uploadWorkspaceFile(
            requestUrl.searchParams.get("folderPath"),
            requestUrl.searchParams.get("fileName"),
            req,
            onProgress
          );
          onProgress?.(totalBytes);
          json(res, 200, result);
          return;
        }

        if (req.method === "DELETE") {
          const payload = await readJsonBody(req);
          json(res, 200, await deleteWorkspaceEntry(payload?.targetPath));
          return;
        }

        json(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      if (requestUrl.pathname === "/bridge/workspace-download") {
        if (!(await isFileManagerEnabled())) {
          writeFeatureDisabled(res, "File manager");
          return;
        }
        if (req.method !== "GET") {
          json(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        const { normalizedPath, stats } = await resolveWorkspaceFilePath(
          requestUrl.searchParams.get("targetPath")
        );
        const fileName = path.win32.basename(normalizedPath);
        res.writeHead(200, {
          "Content-Type": contentTypeFor(normalizedPath),
          "Cache-Control": NO_STORE_CACHE_CONTROL,
          "Content-Length": stats.size,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        });
        await pipeline(createReadStream(normalizedPath), res);
        return;
      }

      if (requestUrl.pathname === "/favicon.ico") {
        await sendAsarAsset(req, res, workBuddyAsar, "resources/icon.png", IMMUTABLE_CACHE_CONTROL);
        return;
      }

      if (requestUrl.pathname === "/agent-manager") {
        res.writeHead(302, { Location: "/agent-manager/" });
        res.end();
        return;
      }

      if (requestUrl.pathname === "/agent-manager/") {
        const html = await workBuddyAsar.readFile("renderer/index.html");
        if (!html) {
          throw new Error(`WorkBuddy renderer/index.html was not found in ${WORKBUDDY_ASAR_PATH}`);
        }
        text(
          res,
          200,
          renderWorkBuddyNativeHtml(html.toString("utf8")),
          "text/html; charset=utf-8",
          HTML_CACHE_CONTROL
        );
        return;
      }

      if (requestUrl.pathname === "/bridge/workbuddy-native-shim.js") {
        const [methods, version, locale, features, bridgeUiConfig] = await Promise.all([
          runtime.getBuddyApiMethods(),
          runtime.getWorkBuddyVersion(),
          runtime.getWorkBuddyLocale(),
          loadFeatureFlags(),
          loadBridgeUiConfig(),
        ]);
        const shim = renderWorkBuddyNativeShimJs({
          methods,
          version,
          locale,
          ...features,
          ...bridgeUiConfig,
        });
        sendVersionedScript(
          req,
          res,
          shim,
          {
            etag: `"workbuddy-native-shim-${version || "unknown"}-${locale || "unknown"}-${methods.length}-${shim.length}-${features.enableFileManager ? "files-on" : "files-off"}-${features.enableRestart ? "restart-on" : "restart-off"}-${bridgeUiConfig.maskBridgeModelSecrets ? "secrets-masked" : "secrets-visible"}"`,
            cacheControl: REVALIDATED_STATIC_CACHE_CONTROL,
          }
        );
        return;
      }

      if (requestUrl.pathname.startsWith("/agent-manager/assets/")) {
        const relativePath = decodeURIComponent(
          requestUrl.pathname.replace("/agent-manager/", "renderer/")
        );
        await sendMaybePatchedWorkBuddyAsset(
          req,
          res,
          workBuddyAsar,
          relativePath,
          IMMUTABLE_CACHE_CONTROL
        );
        return;
      }

      if (requestUrl.pathname.startsWith("/agent-manager/")) {
        const relativePath = decodeURIComponent(
          requestUrl.pathname.replace("/agent-manager/", "renderer/")
        );
        const info = await workBuddyAsar.statFile(relativePath);
        if (info) {
          await sendMaybePatchedWorkBuddyAsset(
            req,
            res,
            workBuddyAsar,
            relativePath,
            IMMUTABLE_CACHE_CONTROL
          );
          return;
        }
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }

      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function attachWebSocketServer(server, runtime, auth) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: BROWSER_WS_MAX_PAYLOAD_BYTES,
  });
  const modelSecretProtector = createModelSecretProtector();

  wss.on("connection", (socket) => {
    logger.info("websocket.connection", "Browser WebSocket connected", {
      remoteAddress: socket?._socket?.remoteAddress,
      remotePort: socket?._socket?.remotePort,
    });
    runtime.registerBrowserSocket(socket);

    socket.on("close", (code, reason) => {
      incomingChunks.clear();
      logger.info("websocket.close", "Browser WebSocket closed", {
        code,
        reason: reason ? reason.toString() : "",
      });
    });

    socket.on("error", (error) => {
      logger.warn("websocket.error", "Browser WebSocket reported an error", { error });
    });

    const incomingChunks = new Map();

    const handleBrowserMessage = async (message) => {
      logger.debug("websocket.browser_to_bridge", "Browser sent bridge message", {
        message: summarizeMessage(message),
      });

      try {
        if (message.type === "buddy-api-call") {
          const bridgeUiConfig = await loadBridgeUiConfig();
          const shouldProtectModelSecrets = bridgeUiConfig.maskBridgeModelSecrets === true;
          const args = shouldProtectModelSecrets
            ? modelSecretProtector.restoreArgs(message.method, message.args || [])
            : message.args || [];
          const rawResult = await runtime.invokeBuddyApi(message.method, args);
          const result = shouldProtectModelSecrets
            ? modelSecretProtector.protectResult(message.method, args, rawResult)
            : rawResult;
          runtime.sendToSocket(socket, {
            id: message.id,
            ok: true,
            result,
          });
          return;
        }

        if (message.type === "buddy-api-subscribe") {
          await runtime.subscribeBuddyApi(
            message.method,
            message.key || message.method,
            message.args || [],
            socket
          );
          runtime.sendToSocket(socket, {
            id: message.id,
            ok: true,
            result: true,
          });
          return;
        }

        if (message.type === "buddy-api-unsubscribe") {
          await runtime.unsubscribeBuddyApi(message.key || message.method, socket);
          runtime.sendToSocket(socket, {
            id: message.id,
            ok: true,
            result: true,
          });
          return;
        }

        if (message.type === "restart-app") {
          if (!(await isRestartEnabled())) {
            throw new Error("Restart is disabled by config.");
          }
          const result = await runtime.requestRestart();
          runtime.sendToSocket(socket, {
            id: message.id,
            ok: true,
            result,
          });
          return;
        }

        runtime.sendToSocket(socket, {
          id: message.id,
          ok: false,
          error: `Unsupported bridge message type: ${message.type || "(missing)"}`,
        });
      } catch (error) {
        logger.error("websocket.message.error", "Failed to handle browser bridge message", {
          message: summarizeMessage(message),
          error,
        });
        runtime.sendToSocket(socket, {
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const handleChunkFrame = (message) => {
      if (message.type === "bridge-client-message-chunk-start") {
        incomingChunks.set(message.transferId, {
          chunks: [],
          totalChunks: Math.max(0, Math.trunc(Number(message.totalChunks) || 0)),
          totalLength: Math.max(0, Math.trunc(Number(message.totalLength) || 0)),
          received: 0,
        });
        return true;
      }

      if (message.type === "bridge-client-message-chunk") {
        const entry = incomingChunks.get(message.transferId);
        if (!entry) {
          logger.warn("websocket.browser_to_bridge.chunk_missing", "Browser WebSocket chunk had no start frame", {
            transferId: message.transferId,
            index: message.index,
          });
          return true;
        }
        const index = Math.trunc(Number(message.index) || 0);
        const data = typeof message.data === "string" ? message.data : "";
        entry.chunks[index] = data;
        entry.received += 1;
        return true;
      }

      if (message.type !== "bridge-client-message-chunk-end") {
        return false;
      }

      const entry = incomingChunks.get(message.transferId);
      incomingChunks.delete(message.transferId);
      if (!entry) {
        logger.warn("websocket.browser_to_bridge.chunk_end_missing", "Browser WebSocket chunk end had no start frame", {
          transferId: message.transferId,
        });
        return true;
      }

      const raw = entry.chunks.join("");
      if (entry.totalLength && raw.length !== entry.totalLength) {
        logger.warn("websocket.browser_to_bridge.chunk_length_mismatch", "Browser WebSocket chunked message length differed", {
          transferId: message.transferId,
          expected: entry.totalLength,
          actual: raw.length,
        });
      }

      let completed;
      try {
        completed = JSON.parse(raw);
      } catch {
        logger.warn("websocket.browser_to_bridge.invalid_chunked_json", "Invalid chunked browser WebSocket payload", {
          transferId: message.transferId,
          bytes: raw.length,
        });
        runtime.sendToSocket(socket, {
          ok: false,
          error: "Invalid chunked JSON",
        });
        return true;
      }

      logger.info("websocket.browser_to_bridge.chunked_receive", "Received chunked browser WebSocket message", {
        transferId: message.transferId,
        totalLength: raw.length,
        totalChunks: entry.totalChunks,
        receivedChunks: entry.received,
        message: summarizeMessage(completed),
      });
      handleBrowserMessage(completed).catch((error) => {
        logger.error("websocket.browser_to_bridge.chunked_handle_error", "Failed to handle chunked browser WebSocket message", {
          transferId: message.transferId,
          error,
        });
      });
      return true;
    };

    socket.on("message", async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        logger.warn("websocket.browser_to_bridge.invalid_json", "Invalid browser WebSocket payload", {
          bytes: raw?.byteLength ?? raw?.length,
        });
        runtime.sendToSocket(socket, {
          ok: false,
          error: "Invalid JSON",
        });
        return;
      }

      if (handleChunkFrame(message)) {
        return;
      }

      await handleBrowserMessage(message);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url || "/", "http://bridge.local");
    if (requestUrl.pathname !== "/bridge/ws") {
      socket.destroy();
      return;
    }

    if (!auth.handleUpgrade(req, socket)) {
      return;
    }

    wss.handleUpgrade(req, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, req);
    });
  });

  return wss;
}

async function startBridgeServer(runtime, options) {
  const auth = createBridgeAccessAuth(options.passwordHash);
  if (!auth.enabled && !isLoopbackHost(options.listenHost)) {
    throw new Error(
      "A password hash is required when the bridge listens beyond localhost. Set --password-hash or WORKBUDDY_REMOTE_PASSWORD_HASH first."
    );
  }

  const server = http.createServer(createRequestHandler(runtime, auth));
  server.requestTimeout = 0;
  server.setTimeout(0);
  attachWebSocketServer(server, runtime, auth);

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.listenPort, options.listenHost);
  });

  logger.info("bridge.server.started", "Bridge HTTP/WebSocket server started", {
    cdpTarget: `ws://${options.cdpHost}:${options.cdpPort}`,
    listenHost: options.listenHost,
    listenPort: options.listenPort,
    workbuddyPid: options.workbuddyPid,
    logPath: options.logPath,
    asarPath: WORKBUDDY_ASAR_PATH,
  });
  if (auth.enabled) {
    logger.info("bridge.auth", "Password protection enabled");
  } else {
    logger.info("bridge.auth", "Password protection disabled");
  }

  const urls = getAccessUrls(options);
  if (urls.length > 0) {
    logger.info("bridge.url.primary", "Primary browser URL available", { url: urls[0] });
  }
  for (const url of urls.slice(1)) {
    logger.info("bridge.url.additional", "Additional browser URL available", { url });
  }
  return server;
}

export { startBridgeServer };
