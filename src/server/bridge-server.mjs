import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

import { AsarArchive } from "../asar.mjs";
import {
  WebSocketServer,
  contentTypeFor,
  getLanUrls,
  json,
  resolveWorkBuddyAsarPath,
  text,
} from "../shared.mjs";
import { logger, summarizeMessage } from "../logger.mjs";
import {
  renderWorkBuddyNativeHtml,
  renderWorkBuddyNativeShimJs,
} from "../web/workbuddy-native.mjs";
import { createBridgeAccessAuth } from "./access-auth.mjs";

const HTML_CACHE_CONTROL = "no-cache";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const REVALIDATED_STATIC_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const COMPRESSIBLE_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg"]);
const MAX_COMPRESSED_STATIC_ASSET_BYTES = 32 * 1024 * 1024;
const versionedScriptCompressionCache = new Map();
const WORKBUDDY_ASAR_PATH = resolveWorkBuddyAsarPath();
const workBuddyAsar = new AsarArchive(WORKBUDDY_ASAR_PATH);

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
        const [methods, version] = await Promise.all([
          runtime.getBuddyApiMethods(),
          runtime.getWorkBuddyVersion(),
        ]);
        sendVersionedScript(req, res, renderWorkBuddyNativeShimJs({ methods, version }), {
          etag: `"workbuddy-native-shim-${version || "unknown"}-${methods.length}"`,
          cacheControl: REVALIDATED_STATIC_CACHE_CONTROL,
        });
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
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    logger.info("websocket.connection", "Browser WebSocket connected", {
      remoteAddress: socket?._socket?.remoteAddress,
      remotePort: socket?._socket?.remotePort,
    });
    runtime.registerBrowserSocket(socket);

    socket.on("close", (code, reason) => {
      logger.info("websocket.close", "Browser WebSocket closed", {
        code,
        reason: reason ? reason.toString() : "",
      });
    });

    socket.on("error", (error) => {
      logger.warn("websocket.error", "Browser WebSocket reported an error", { error });
    });

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

      logger.debug("websocket.browser_to_bridge", "Browser sent bridge message", {
        message: summarizeMessage(message),
      });

      try {
        if (message.type === "buddy-api-call") {
          const result = await runtime.invokeBuddyApi(message.method, message.args || []);
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
