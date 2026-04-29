import http from "node:http";
import https from "node:https";
import { pipeline } from "node:stream/promises";

import { json } from "../shared.mjs";
import { logger } from "../logger.mjs";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function createProxyModelUrl({ port, token, modelId }) {
  return `http://127.0.0.1:${port}/proxy/${encodeURIComponent(token)}/${encodeURIComponent(modelId)}/v1/chat/completions`;
}

function parseProxyPath(pathname) {
  const match = /^\/proxy\/([^/]+)\/([^/]+)(?:\/.*)?$/u.exec(pathname);
  if (!match) {
    return null;
  }
  return {
    token: decodeURIComponent(match[1]),
    modelId: decodeURIComponent(match[2]),
  };
}

function copyRequestHeaders(req, upstreamUrl, apiKey) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === "host") {
      continue;
    }
    headers[key] = value;
  }
  headers.host = upstreamUrl.host;
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  } else {
    delete headers.authorization;
  }
  return headers;
}

function copyResponseHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

async function forwardModelRequest(req, res, upstreamEndpoint, apiKey) {
  const upstreamUrl = new URL(upstreamEndpoint);
  const transport = upstreamUrl.protocol === "https:" ? https : http;
  const headers = copyRequestHeaders(req, upstreamUrl, apiKey);

  await new Promise((resolve, reject) => {
    const upstreamReq = transport.request(
      upstreamUrl,
      {
        method: req.method,
        headers,
      },
      async (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, copyResponseHeaders(upstreamRes.headers));
        try {
          await pipeline(upstreamRes, res);
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    );

    upstreamReq.on("error", reject);
    pipeline(req, upstreamReq).catch(reject);
  });
}

function createModelProxyHandler(secretStore) {
  return async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      const proxyTarget = parseProxyPath(requestUrl.pathname);
      if (!proxyTarget) {
        json(res, 404, { ok: false, error: "Model proxy target not found." });
        return;
      }

      const secret = await secretStore.getByToken(proxyTarget.modelId, proxyTarget.token);
      if (!secret?.endpoint) {
        json(res, 404, { ok: false, error: "Model proxy secret not found." });
        return;
      }

      await forwardModelRequest(req, res, secret.endpoint, secret.apiKey || "");
    } catch (error) {
      logger.error("model_proxy.error", "Model proxy request failed", { error });
      if (!res.headersSent) {
        json(res, 502, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        res.destroy(error);
      }
    }
  };
}

async function startModelProxyServer(secretStore, options) {
  const host = "127.0.0.1";
  const port = Number(options.modelProxyPort) || 8791;
  const server = http.createServer(createModelProxyHandler(secretStore));
  server.requestTimeout = 0;
  server.setTimeout(0);

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
    server.listen(port, host);
  });

  logger.info("model_proxy.started", "Model secret proxy started", { host, port });
  return server;
}

export { createProxyModelUrl, startModelProxyServer };
