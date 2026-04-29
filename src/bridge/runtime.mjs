import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocket, delay } from "../shared.mjs";
import { logger, summarizeMessage, summarizeValue } from "../logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESTART_HELPER_SCRIPT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "tools",
  "workbuddy-restart-instance.ps1"
);

function resolvePowerShellExePath() {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const candidate = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(candidate) ? candidate : "powershell.exe";
}

function unwrapTransportPayload(payload) {
  if (!payload || payload.kind === "json") {
    return payload?.value;
  }

  return null;
}

function readTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return readTimestampMs(numeric);
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isWorkspacePathCandidate(value) {
  return typeof value === "string" && /^[A-Za-z]:[\\/]/u.test(value.trim());
}

function collectWorkspaceContextPaths(value, candidates, { source, priority = 0, depth = 0 } = {}) {
  if (!value || candidates.length >= 80 || depth > 5) {
    return;
  }

  if (isWorkspacePathCandidate(value)) {
    candidates.push({
      path: value.trim(),
      source,
      priority,
      lastActivityAt: 0,
    });
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 80)) {
      collectWorkspaceContextPaths(item, candidates, { source, priority, depth: depth + 1 });
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const lastActivityAt =
    readTimestampMs(value.updatedAt) ||
    readTimestampMs(value.lastUpdatedAt) ||
    readTimestampMs(value.updated_at) ||
    readTimestampMs(value.lastActivityAt);
  for (const key of ["path", "folderPath", "workspacePath", "workspaceFolder", "cwd", "fsPath", "defaultPath"]) {
    if (isWorkspacePathCandidate(value[key])) {
      candidates.push({
        path: value[key].trim(),
        source,
        priority,
        lastActivityAt,
      });
    }
  }

  for (const nestedValue of Object.values(value)) {
    collectWorkspaceContextPaths(nestedValue, candidates, { source, priority, depth: depth + 1 });
  }
}

function formatTargetSummary(targets) {
  const pages = Array.isArray(targets) ? targets.filter((entry) => entry?.type === "page") : [];
  if (pages.length === 0) {
    return "No page targets were reported by CDP.";
  }

  return pages
    .slice(-6)
    .map((entry) => {
      const title = typeof entry.title === "string" && entry.title ? entry.title : "(untitled)";
      const url = typeof entry.url === "string" && entry.url ? entry.url : "(no url)";
      return `${title} -> ${url}`;
    })
    .join(" | ");
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.bindingHandlers = new Set();
    this.commandTimeoutMs = 8000;
    this.connectPromise = null;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      this.ws = new WebSocket(this.wsUrl);

      await new Promise((resolve, reject) => {
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = (error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          this.ws.off("open", onOpen);
          this.ws.off("error", onError);
        };
        this.ws.on("open", onOpen);
        this.ws.on("error", onError);
      });

      this.ws.on("message", (buffer) => this.#handleMessage(buffer.toString()));
      this.ws.on("close", () => {
        for (const { reject } of this.pending.values()) {
          reject(new Error("CDP connection closed"));
        }
        this.pending.clear();
      });

      await this.send("Runtime.enable");
      await this.send("Runtime.addBinding", {
        name: "workbuddyBridgeNotify",
      });
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  onBinding(handler) {
    this.bindingHandlers.add(handler);
    return () => {
      this.bindingHandlers.delete(handler);
    };
  }

  async send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP connection closed");
    }

    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.commandTimeoutMs}ms`));
      }, this.commandTimeoutMs);

      this.pending.set(id, {
        method,
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  async evaluate(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue,
    });

    if (response.result?.exceptionDetails) {
      const description =
        response.result.exceptionDetails.exception?.description ||
        response.result.exceptionDetails.text ||
        "Runtime.evaluate failed";
      throw new Error(description);
    }

    return response.result?.result?.value;
  }

  async ensureBridgeInjected() {
    await this.evaluate(
      `(() => {
        if (globalThis.__workbuddyBridge?.__workbuddyRemoteNativeOnly) {
          return "already";
        }

        const encode = (value) => {
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

        const decode = (value) => {
          if (Array.isArray(value)) {
            return value.map((item) => decode(item));
          }

          if (!value || typeof value !== "object") {
            return value;
          }

          if (value.__workbuddyBridgeValue === "arraybuffer") {
            const binary = atob(value.base64 || "");
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
              bytes[i] = binary.charCodeAt(i);
            }
            return bytes.buffer;
          }

          if (value.__workbuddyBridgeValue === "typedarray") {
            const binary = atob(value.base64 || "");
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
              bytes[i] = binary.charCodeAt(i);
            }
            const Constructor = globalThis[value.constructorName] || Uint8Array;
            return new Constructor(bytes.buffer);
          }

          if (value.__workbuddyBridgeValue === "blob") {
            const binary = atob(value.base64 || "");
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
              bytes[i] = binary.charCodeAt(i);
            }
            if (value.name && typeof File === "function") {
              return new File([bytes], value.name, {
                type: value.type || "",
                lastModified: value.lastModified || Date.now(),
              });
            }
            return new Blob([bytes], { type: value.type || "" });
          }

          const result = {};
          for (const [key, nestedValue] of Object.entries(value)) {
            result[key] = decode(nestedValue);
          }
          return result;
        };

        const notify = (payload) => {
          globalThis.workbuddyBridgeNotify(JSON.stringify(payload));
        };

        const buddyApiListeners = new Map();

        globalThis.__workbuddyBridge = {
          __workbuddyRemoteNativeOnly: true,

          getHostKind() {
            if (globalThis.buddyAPI && typeof globalThis.buddyAPI === "object") {
              return "buddyAPI";
            }
            return "unknown";
          },

          getBuddyApiMethods() {
            return Reflect.ownKeys(globalThis.buddyAPI || {}).map(String);
          },

          async callBuddyApi(method, args) {
            const fn = globalThis.buddyAPI?.[method];
            if (typeof fn !== "function") {
              throw new Error("WorkBuddy buddyAPI method is unavailable: " + method);
            }
            return encode(await fn(...decode(args || [])));
          },

          subscribeBuddyApi(method, key, args) {
            const subscriptionKey = key || method;
            if (buddyApiListeners.has(subscriptionKey)) {
              return true;
            }

            const fn = globalThis.buddyAPI?.[method];
            if (typeof fn !== "function") {
              throw new Error("WorkBuddy buddyAPI event method is unavailable: " + method);
            }

            const listener = (...eventArgs) => {
              notify({
                type: "buddy-api-event",
                method,
                key: subscriptionKey,
                args: eventArgs.map((arg) => encode(arg)),
              });
            };

            const decodedArgs = decode(args || []);
            const unsubscribe =
              method === "$on" ? fn(decodedArgs[0], listener) : fn(listener, ...decodedArgs);
            buddyApiListeners.set(subscriptionKey, unsubscribe || true);
            return true;
          },

          unsubscribeBuddyApi(key) {
            const subscription = buddyApiListeners.get(key);
            if (!subscription) {
              return true;
            }
            try {
              if (typeof subscription === "function") {
                subscription();
              } else if (typeof subscription.dispose === "function") {
                subscription.dispose();
              } else if (typeof subscription.remove === "function") {
                subscription.remove();
              }
            } catch {}
            buddyApiListeners.delete(key);
            return true;
          },
        };

        return "ok";
      })()`
    );
  }

  #handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(
          new Error(`${pending.method} failed: ${message.error.message || "Unknown CDP error"}`)
        );
      } else {
        pending.resolve(message);
      }

      return;
    }

    if (message.method === "Runtime.bindingCalled") {
      for (const handler of this.bindingHandlers) {
        handler(message.params);
      }
    }
  }
}

function isWorkBuddyRendererTarget(entry) {
  if (entry?.type !== "page") {
    return false;
  }

  const url = typeof entry.url === "string" ? entry.url : "";
  const title = typeof entry.title === "string" ? entry.title.toLowerCase() : "";
  return (
    url.includes("/resources/app.asar/renderer/index.html") ||
    url.includes("\\resources\\app.asar\\renderer\\index.html") ||
    title === "workbuddy"
  );
}

async function getWorkBuddyTarget({
  cdpHost,
  cdpPort,
  targetTimeoutMs = 45000,
  pollIntervalMs = 750,
}) {
  const startedAt = Date.now();
  let lastTargets = [];
  let lastError = null;

  while (Date.now() - startedAt < targetTimeoutMs) {
    try {
      const response = await fetch(`http://${cdpHost}:${cdpPort}/json/list`);
      if (!response.ok) {
        throw new Error(`Failed to fetch CDP targets: HTTP ${response.status}`);
      }

      const targets = await response.json();
      lastTargets = Array.isArray(targets) ? targets : [];
      const target = lastTargets.filter(isWorkBuddyRendererTarget).at(-1);

      if (target?.webSocketDebuggerUrl) {
        return target;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    await delay(pollIntervalMs);
  }

  const extra = lastError ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `WorkBuddy renderer target was not found within ${targetTimeoutMs}ms.` +
      " WorkBuddy may still be starting or may have opened a different window." +
      ` Visible targets: ${formatTargetSummary(lastTargets)}.${extra}`
  );
}

class BridgeRuntime {
  constructor(options) {
    this.options = options;
    this.cdp = null;
    this.reconnectPromise = null;
    this.targetUrl = null;
    this.hostBridgeKind = "";
    this.lastTargetCheckAt = 0;
    this.targetCheckIntervalMs = 1500;
    this.browserSockets = new Set();
    this.browserSocketIds = new Map();
    this.browserSocketSeq = 0;
    this.browserSocketSubscriptions = new Map();
    this.buddyApiSubscriptionRefCounts = new Map();
    this.warmupPromise = null;
  }

  async initialize() {
    await this.warmup();
  }

  async warmup() {
    if (this.warmupPromise) {
      return this.warmupPromise;
    }

    this.warmupPromise = this.ensureCdpReady({ forceRefresh: true });
    try {
      await this.warmupPromise;
    } finally {
      this.warmupPromise = null;
    }
  }

  isHostConnected() {
    return this.cdp?.ws?.readyState === WebSocket.OPEN && Boolean(this.targetUrl);
  }

  async getWorkspaceContextCandidates() {
    const candidates = [];
    const collectFromApi = async (method, args, priority) => {
      try {
        const result = await this.invokeBuddyApi(method, args);
        collectWorkspaceContextPaths(result, candidates, { source: method, priority });
      } catch (error) {
        logger.debug("workspace.context.api_unavailable", "Workspace context API was unavailable", {
          method,
          error,
        });
      }
    };

    await collectFromApi("workspaceGetCurrent", [], 100);
    await collectFromApi("workspaceGenerateDefaultCwd", [], 90);
    await collectFromApi("listSessions", [], 60);
    await collectFromApi("storageGetSessions", [], 50);
    await collectFromApi("storageGetWorkspaces", [], 40);

    candidates.sort(
      (left, right) =>
        right.priority - left.priority ||
        right.lastActivityAt - left.lastActivityAt
    );

    const seen = new Set();
    return candidates.filter((candidate) => {
      const key = String(candidate.path || "").trim().toLowerCase();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async ensureCdpReady({ forceRefresh = false } = {}) {
    if (this.reconnectPromise) {
      await this.reconnectPromise;
      return;
    }

    const alreadyOpen = this.cdp?.ws?.readyState === WebSocket.OPEN;
    const shouldSkipRefresh =
      alreadyOpen &&
      !forceRefresh &&
      Date.now() - this.lastTargetCheckAt < this.targetCheckIntervalMs;
    if (shouldSkipRefresh) {
      return;
    }

    this.reconnectPromise = (async () => {
      const target = await getWorkBuddyTarget(this.options);
      const previousTargetUrl = this.targetUrl;
      const shouldReplaceClient =
        forceRefresh ||
        !this.cdp ||
        this.cdp.wsUrl !== target.webSocketDebuggerUrl ||
        this.cdp.ws?.readyState === WebSocket.CLOSED ||
        this.cdp.ws?.readyState === WebSocket.CLOSING;

      if (shouldReplaceClient) {
        const previousCdp = this.cdp;
        this.cdp = new CdpClient(target.webSocketDebuggerUrl);
        this.cdp.onBinding((params) => this.handleBridgeNotification(params));
        if (previousCdp && previousCdp !== this.cdp) {
          previousCdp.close();
        }
      }

      await this.cdp.connect();
      await this.cdp.ensureBridgeInjected();
      this.hostBridgeKind = await this.cdp.evaluate(`globalThis.__workbuddyBridge.getHostKind()`);
      this.lastTargetCheckAt = Date.now();
      this.targetUrl = target.url;
      await this.restoreBuddyApiSubscriptions();

      if (forceRefresh || shouldReplaceClient || previousTargetUrl !== target.url) {
        logger.info("cdp.target.attached", "Attached WorkBuddy renderer target", {
          url: target.url,
          hostApi: this.hostBridgeKind,
          webSocketDebuggerUrl: target.webSocketDebuggerUrl,
        });
      }
    })();

    try {
      await this.reconnectPromise;
    } finally {
      this.reconnectPromise = null;
    }
  }

  isRecoverableCdpError(error) {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message || "";
    return (
      message.includes("CDP connection closed") ||
      message.includes("Target closed") ||
      message.includes("Session closed") ||
      message.includes("timed out after") ||
      message.includes("Cannot find context with specified id") ||
      message.includes("Inspected target navigated or closed") ||
      message.includes("No web contents for the given target id") ||
      message.includes("Execution context was destroyed")
    );
  }

  async withCdpRecovery(operation) {
    await this.ensureCdpReady();
    try {
      return await operation();
    } catch (error) {
      if (!this.isRecoverableCdpError(error)) {
        throw error;
      }

      logger.warn("cdp.recovering", "Recovering from CDP error", { error });
      await this.ensureCdpReady({ forceRefresh: true });
      return operation();
    }
  }

  getBrowserSocketId(socket) {
    if (!this.browserSocketIds.has(socket)) {
      this.browserSocketIds.set(socket, ++this.browserSocketSeq);
    }
    return this.browserSocketIds.get(socket);
  }

  registerBrowserSocket(socket) {
    const socketId = this.getBrowserSocketId(socket);
    this.browserSockets.add(socket);
    this.browserSocketSubscriptions.set(socket, new Map());
    logger.info("runtime.browser_socket.registered", "Registered browser socket", {
      socketId,
      browserSocketCount: this.browserSockets.size,
    });

    socket.on("close", () => {
      this.browserSockets.delete(socket);
      this.releaseSocketSubscriptions(socket).catch((error) => {
        logger.warn("buddy_api.subscription.cleanup_error", "Failed to clean up browser subscriptions", {
          socketId,
          error,
        });
      });
      this.browserSocketIds.delete(socket);
      logger.info("runtime.browser_socket.closed", "Browser socket removed", {
        socketId,
        browserSocketCount: this.browserSockets.size,
      });
    });
  }

  sendToSocket(socket, message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  }

  broadcast(message) {
    for (const socket of this.browserSockets) {
      this.sendToSocket(socket, message);
    }
  }

  async getBuddyApiMethods() {
    try {
      const methods = await this.withCdpRecovery(() =>
        this.cdp.evaluate(`globalThis.__workbuddyBridge.getBuddyApiMethods()`)
      );
      return Array.isArray(methods) ? methods.filter((method) => typeof method === "string") : [];
    } catch (error) {
      logger.warn("buddy_api.methods.error", "Failed to read WorkBuddy buddyAPI methods", { error });
      return [];
    }
  }

  async getWorkBuddyVersion() {
    try {
      const version = await this.withCdpRecovery(() =>
        this.cdp.evaluate(`String(globalThis.__WORKBUDDY_VERSION__ || "")`)
      );
      return typeof version === "string" ? version : "";
    } catch (error) {
      logger.warn("buddy_api.version.error", "Failed to read WorkBuddy version", { error });
      return "";
    }
  }

  async getWorkBuddyLocale() {
    try {
      const result = await this.withCdpRecovery(() =>
        this.cdp.evaluate(
          `(() => {
            const readLocale = async () => {
              const candidates = [
                globalThis.__WORKBUDDY_LOCALE__,
                globalThis.__WB_APP_LOCALE__,
                globalThis.__locale,
                globalThis.buddyAPI?.getAppLocale ? await globalThis.buddyAPI.getAppLocale() : "",
              ];
              for (const candidate of candidates) {
                if (typeof candidate === "string" && candidate.trim()) {
                  return candidate.trim();
                }
                if (candidate && typeof candidate === "object") {
                  for (const key of ["language", "locale", "current", "value"]) {
                    if (typeof candidate[key] === "string" && candidate[key].trim()) {
                      return candidate[key].trim();
                    }
                  }
                }
              }
              return "";
            };
            return readLocale();
          })()`
        )
      );
      return typeof result === "string" ? result : "";
    } catch (error) {
      logger.warn("buddy_api.locale.error", "Failed to read WorkBuddy locale", { error });
      return "";
    }
  }

  isMissingBuddyApiHandlerError(error) {
    if (!(error instanceof Error)) {
      return false;
    }
    return /No handler for|method is unavailable/iu.test(error.message || "");
  }

  async getBuddyApiFallbackResult(method, args, error) {
    if (!this.isMissingBuddyApiHandlerError(error)) {
      return { handled: false };
    }

    switch (method) {
      case "devEnvGet":
        return { handled: true, value: { enabled: false, env: "prod" } };
      case "connectorGetUserConnector":
      case "connectorGetTaskConnector":
        return { handled: true, value: { connectors: [] } };
      case "connectorAddTask":
      case "connectorModifyTaskActiveStatus":
      case "connectorModifyTaskRepo":
        return { handled: true, value: { ok: true, skipped: true } };
      case "connectorGetConfigs":
        return { handled: true, value: [] };
      case "connectorGetStates":
        return { handled: true, value: {} };
      case "connectorHasOAuthToken":
        return { handled: true, value: false };
      case "getUserInfo":
        return { handled: true, value: await this.invokeBuddyApi("getAccount", []) };
      case "authGetAccountUsage":
      case "growthGetBuddy":
        return { handled: true, value: null };
      default:
        return { handled: false };
    }
  }

  async invokeBuddyApi(method, args) {
    logger.debug("buddy_api.invoke", "Invoking WorkBuddy buddyAPI method", {
      method,
      args: summarizeValue(args),
    });
    const expression = `globalThis.__workbuddyBridge.callBuddyApi(${JSON.stringify(
      method
    )}, ${JSON.stringify(args || [])})`;
    try {
      const result = await this.withCdpRecovery(() => this.cdp.evaluate(expression));
      logger.debug("buddy_api.invoke.result", "WorkBuddy buddyAPI invoke completed", {
        method,
        result: summarizeValue(result),
      });
      return unwrapTransportPayload(result);
    } catch (error) {
      const fallback = await this.getBuddyApiFallbackResult(method, args, error);
      if (fallback.handled) {
        logger.debug("buddy_api.invoke.fallback", "Returned fallback for missing WorkBuddy buddyAPI handler", {
          method,
          args: summarizeValue(args),
          error,
          result: summarizeValue(fallback.value),
        });
        return fallback.value;
      }

      logger.error("buddy_api.invoke.error", "WorkBuddy buddyAPI invoke failed", {
        method,
        args: summarizeValue(args),
        error,
      });
      throw error;
    }
  }

  async restoreBuddyApiSubscriptions() {
    for (const [key, entry] of this.buddyApiSubscriptionRefCounts.entries()) {
      if (!entry || entry.count <= 0) {
        continue;
      }
      await this.cdp.evaluate(
        `globalThis.__workbuddyBridge.subscribeBuddyApi(${JSON.stringify(
          entry.method
        )}, ${JSON.stringify(key)}, ${JSON.stringify(entry.args || [])})`
      );
    }
  }

  trackSocketSubscription(socket, key, method, args) {
    if (!socket) {
      return;
    }

    const subscriptions = this.browserSocketSubscriptions.get(socket);
    if (!subscriptions) {
      return;
    }

    const current = subscriptions.get(key) || {
      method,
      args,
      count: 0,
    };
    current.count += 1;
    subscriptions.set(key, current);
  }

  untrackSocketSubscription(socket, key) {
    if (!socket) {
      return true;
    }

    const subscriptions = this.browserSocketSubscriptions.get(socket);
    const current = subscriptions?.get(key);
    if (!current) {
      return false;
    }

    if (current.count <= 1) {
      subscriptions.delete(key);
    } else {
      current.count -= 1;
    }
    return true;
  }

  async incrementGlobalSubscription(method, key, args) {
    const current = this.buddyApiSubscriptionRefCounts.get(key);
    if (!current || current.count <= 0) {
      await this.withCdpRecovery(() =>
        this.cdp.evaluate(
          `globalThis.__workbuddyBridge.subscribeBuddyApi(${JSON.stringify(
            method
          )}, ${JSON.stringify(key)}, ${JSON.stringify(args || [])})`
        )
      );
      this.buddyApiSubscriptionRefCounts.set(key, {
        method,
        args: args || [],
        count: 1,
      });
      return;
    }

    current.count += 1;
  }

  async decrementGlobalSubscription(key, count = 1) {
    const current = this.buddyApiSubscriptionRefCounts.get(key);
    if (!current) {
      return;
    }

    current.count -= count;
    if (current.count > 0) {
      return;
    }

    this.buddyApiSubscriptionRefCounts.delete(key);
    await this.withCdpRecovery(() =>
      this.cdp.evaluate(`globalThis.__workbuddyBridge.unsubscribeBuddyApi(${JSON.stringify(key)})`)
    );
  }

  async subscribeBuddyApi(method, key, args = [], socket = null) {
    const subscriptionKey = key || method;
    await this.incrementGlobalSubscription(method, subscriptionKey, args);
    this.trackSocketSubscription(socket, subscriptionKey, method, args);
  }

  async unsubscribeBuddyApi(key, socket = null) {
    if (!key) {
      return;
    }

    if (socket && !this.untrackSocketSubscription(socket, key)) {
      return;
    }
    await this.decrementGlobalSubscription(key, 1);
  }

  async releaseSocketSubscriptions(socket) {
    const subscriptions = this.browserSocketSubscriptions.get(socket);
    this.browserSocketSubscriptions.delete(socket);
    if (!subscriptions || subscriptions.size === 0) {
      return;
    }

    for (const [key, entry] of subscriptions.entries()) {
      await this.decrementGlobalSubscription(key, entry.count);
    }
  }

  canRestartCurrentApp() {
    return process.platform === "win32" && existsSync(RESTART_HELPER_SCRIPT_PATH);
  }

  async requestRestart() {
    if (!this.canRestartCurrentApp()) {
      throw new Error("Restart is unavailable for the current bridge session.");
    }

    const helperArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      RESTART_HELPER_SCRIPT_PATH,
      "-CurrentBridgePid",
      String(process.pid),
      "-CdpPort",
      String(this.options.cdpPort),
      "-BridgePort",
      String(this.options.listenPort),
      "-UserDataDir",
      this.options.userDataDir || "",
      "-ListenHost",
      this.options.listenHost || "127.0.0.1",
      "-WorkBuddyPid",
      String(this.options.workbuddyPid || 0),
      "-RelaunchShell",
      "hidden",
    ];

    if (this.options.logPath) {
      helperArgs.push("-LogPath", this.options.logPath);
    }
    if (this.options.passwordHash) {
      helperArgs.push("-PasswordHash", this.options.passwordHash);
    }
    if (this.options.openBrowser) {
      helperArgs.push("-OpenBrowser");
    }

    logger.info("process.restart_helper.starting", "Starting restart helper", {
      currentBridgePid: process.pid,
      workbuddyPid: this.options.workbuddyPid,
      cdpPort: this.options.cdpPort,
      bridgePort: this.options.listenPort,
    });

    const child = spawn(resolvePowerShellExePath(), helperArgs, {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });

    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();

    logger.info("process.restart_helper.started", "Restart helper process spawned", {
      helperPid: child.pid,
    });

    return {
      ok: true,
      restarting: true,
      helperPid: child.pid,
    };
  }

  handleBridgeNotification(params) {
    let payload;
    try {
      payload = JSON.parse(params.payload);
    } catch (error) {
      logger.error("cdp.binding_payload.parse_error", "Failed to parse binding payload", {
        error,
        raw: params?.payload,
      });
      return;
    }

    logger.debug("cdp.workbuddy_to_bridge", "WorkBuddy sent bridge notification", {
      payload: summarizeMessage(payload),
    });

    if (payload.type === "buddy-api-event") {
      this.broadcast(payload);
    }
  }
}

export { CdpClient, BridgeRuntime, getWorkBuddyTarget, isWorkBuddyRendererTarget };
