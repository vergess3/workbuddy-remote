import http from "node:http";
import path from "node:path";
import { promises as fs, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

import {
  APP_ROOT,
  AUTH_LOGIN_REQUEST,
  NO_STORE_CACHE_CONTROL,
  WebSocketServer,
  contentTypeFor,
  getLanUrls,
  json,
  readJsonBody,
  text,
} from "../shared.mjs";
import { createBridgeAccessAuth } from "./access-auth.mjs";
import {
  createWorkspaceFolder,
  deleteWorkspaceEntry,
  listAvailableWorkspaceRoots,
  listWorkspaceEntries,
  listWorkspaceFolders,
  resolveWorkspaceFilePath,
  uploadWorkspaceFile,
} from "../workspace/service.mjs";
import { loadBridgeUiConfig } from "../config.mjs";
import { renderAgentManagerHtml } from "../web/render.mjs";

const HTML_CACHE_CONTROL = "no-cache";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const REVALIDATED_STATIC_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const COMPRESSIBLE_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg"]);

function isCompressibleAsset(filePath) {
  return COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function createWeakEtag(stats) {
  return `W/"${stats.size}-${Math.trunc(stats.mtimeMs)}"`;
}

function isSamePath(left, right) {
  return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
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

async function sendStaticAsset(req, res, filePath, stats, cacheControl) {
  const contentType = contentTypeFor(filePath);
  const etag = createWeakEtag(stats);
  const lastModified = stats.mtime.toUTCString();
  const baseHeaders = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ETag: etag,
    "Last-Modified": lastModified,
  };

  if (isEtagMatch(req, etag) || isModifiedSinceMatch(req, stats)) {
    writeNotModified(res, baseHeaders);
    return;
  }

  const encoding = isCompressibleAsset(filePath) ? pickContentEncoding(req) : null;
  if (!encoding) {
    res.writeHead(200, {
      ...baseHeaders,
      "Content-Length": stats.size,
    });
    await pipeline(createReadStream(filePath), res);
    return;
  }

  const compressor =
    encoding === "br"
      ? zlib.createBrotliCompress()
      : zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });

  res.writeHead(200, {
    ...baseHeaders,
    "Content-Encoding": encoding,
    Vary: "Accept-Encoding",
  });
  await pipeline(createReadStream(filePath), compressor, res);
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

  const encoding = pickContentEncoding(req);
  if (!encoding) {
    writeBuffer(res, 200, body, baseHeaders);
    return;
  }

  const encodedBody =
    encoding === "br"
      ? zlib.brotliCompressSync(body)
      : zlib.gzipSync(body, { level: zlib.constants.Z_BEST_SPEED });

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
        runtime.refreshRuntimeConfigSafe().catch(() => {});
        runtime.refreshAuthSessionSafe().catch(() => {});
        json(res, 200, {
          ...runtime.getBootstrapPayload(),
          bridgeUi: await loadBridgeUiConfig(),
        });
        return;
      }

      if (requestUrl.pathname === "/bridge/config") {
        runtime.refreshRuntimeConfigSafe().catch(() => {});
        json(res, 200, runtime.getCachedRuntimeConfig());
        return;
      }

      if (requestUrl.pathname === "/bridge/workspace-roots") {
        json(res, 200, {
          ok: true,
          roots: await listAvailableWorkspaceRoots(),
        });
        return;
      }

      if (requestUrl.pathname === "/bridge/workspace-folders") {
        if (req.method === "GET") {
          const rootPath = requestUrl.searchParams.get("rootPath");
          const result = await listWorkspaceFolders(rootPath);
          json(res, 200, {
            ok: true,
            ...result,
          });
          return;
        }

        if (req.method === "POST") {
          const payload = await readJsonBody(req);
          const result = await createWorkspaceFolder(payload?.rootPath, payload?.name);
          json(res, 200, result);
          return;
        }

        json(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      if (requestUrl.pathname === "/bridge/workspace-files") {
        if (req.method === "GET") {
          const folderPath = requestUrl.searchParams.get("folderPath");
          const result = await listWorkspaceEntries(folderPath);
          json(res, 200, result);
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
          const result = await deleteWorkspaceEntry(payload?.targetPath);
          json(res, 200, result);
          return;
        }

        json(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      if (requestUrl.pathname === "/bridge/workspace-download") {
        if (req.method !== "GET") {
          json(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        const targetPath = requestUrl.searchParams.get("targetPath");
        const { normalizedPath, stats } = await resolveWorkspaceFilePath(targetPath);
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

      if (requestUrl.pathname === "/bridge/vscode-shim.js") {
        sendVersionedScript(req, res, runtime.getShimJs(), {
          etag: `"shim-${runtime.getAssetVersion()}"`,
          cacheControl: IMMUTABLE_CACHE_CONTROL,
        });
        return;
      }

      if (requestUrl.pathname === "/bridge/agentManager.patched.js") {
        sendVersionedScript(req, res, runtime.getPatchedAgentManagerJs(), {
          etag: `"agent-manager-${runtime.getAssetVersion()}"`,
          cacheControl: IMMUTABLE_CACHE_CONTROL,
        });
        return;
      }

      if (requestUrl.pathname === "/agent-manager/" || requestUrl.pathname === "/agent-manager") {
        text(
          res,
          200,
          renderAgentManagerHtml(runtime.getAssetVersion()),
          "text/html; charset=utf-8",
          HTML_CACHE_CONTROL
        );
        return;
      }

      if (requestUrl.pathname.startsWith("/mirror/resources/app/")) {
        const relativePath = requestUrl.pathname.replace("/mirror/resources/app/", "");
        const localPath = path.join(APP_ROOT, relativePath);
        const normalized = path.normalize(localPath);

        if (!normalized.startsWith(APP_ROOT)) {
          json(res, 403, { error: "Forbidden" });
          return;
        }

        const stats = await fs.stat(normalized);
        if (!stats.isFile()) {
          json(res, 404, { error: "Not found" });
          return;
        }

        const cacheControl =
          requestUrl.searchParams.get("v") === runtime.getAssetVersion()
            ? IMMUTABLE_CACHE_CONTROL
            : REVALIDATED_STATIC_CACHE_CONTROL;

        if (isSamePath(normalized, runtime.getCodeBuddyMainJsPath())) {
          sendVersionedScript(req, res, runtime.getPatchedCodeBuddyMainJs(), {
            etag: `"codebuddy-main-${runtime.getAssetVersion()}"`,
            cacheControl,
          });
          return;
        }

        await sendStaticAsset(req, res, normalized, stats, cacheControl);
        return;
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
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    runtime.registerBrowserSocket(socket);

    socket.on("message", async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        runtime.sendToSocket(socket, {
          ok: false,
          error: "Invalid JSON",
        });
        return;
      }

      try {
        if (message.type === "invoke") {
          const result =
            message.channel === AUTH_LOGIN_REQUEST
              ? await runtime.invokeAuthLogin(socket, message.args || [])
              : await runtime.invokeIpc(message.channel, message.args || []);
          runtime.sendToSocket(socket, {
            id: message.id,
            ok: true,
            result,
          });
          return;
        }

        if (message.type === "send") {
          await runtime.sendIpc(message.channel, message.args || []);
          return;
        }

        if (message.type === "subscribe") {
          await runtime.subscribeChannel(message.channel);
          return;
        }

        if (message.type === "unsubscribe") {
          await runtime.unsubscribeChannel(message.channel);
          return;
        }

        if (message.type === "open-dynamic-port") {
          await runtime.openDynamicPort(socket, message.windowId, message.nonce, message.portId);
          return;
        }

        if (message.type === "port-post") {
          await runtime.postPortMessage(socket, message.portId, message.payload);
          return;
        }

        if (message.type === "port-close") {
          await runtime.closePort(message.portId);
          return;
        }

        if (message.type === "restart-app") {
          const result = await runtime.requestRestart();
          runtime.sendToSocket(socket, {
            id: message.id,
            ok: true,
            result,
          });
          return;
        }
      } catch (error) {
        const payload = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };

        if (message.id) {
          runtime.sendToSocket(socket, {
            id: message.id,
            ...payload,
          });
          return;
        }

        runtime.sendToSocket(socket, payload);
      }
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

  await new Promise((resolve) => {
    server.listen(options.listenPort, options.listenHost, resolve);
  });

  console.log("[bridge] CDP target:", `ws://${options.cdpHost}:${options.cdpPort}`);
  if (auth.enabled) {
    console.log("[bridge] Password protection:", "enabled");
  } else {
    console.log("[bridge] Password protection:", "disabled");
  }

  const urls = getAccessUrls(options);
  if (urls.length > 0) {
    console.log("[bridge] Browser URL:", urls[0]);
  }
  for (const url of urls.slice(1)) {
    console.log("[bridge] Additional URL:", url);
  }
  return server;
}

export { startBridgeServer };
