import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  APP_ROOT,
  AGENT_MANAGER_JS_PATH,
  AUTH_LOGIN_REQUEST,
  AUTH_LOGIN_URL_REQUEST,
  AUTH_SESSION_CHANNEL,
  AUTH_SESSION_REQUEST,
  WebSocket,
  delay,
} from "../shared.mjs";
import { logger, summarizeMessage, summarizeValue } from "../logger.mjs";
import { renderShimJs } from "../web/render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESTART_HELPER_SCRIPT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "tools",
  "workbuddy-restart-instance.ps1"
);
const MAIN_CSS_PATH = path.join(APP_ROOT, "out", "codebuddy", "main.css");
const CODEBUDDY_MAIN_JS_PATH = path.join(APP_ROOT, "out", "codebuddy", "main.js");
const TARGET_CACHE_FILE_NAME = "workbuddy-remote-target-cache.json";
const PREVIOUS_WINDOW_CLEANUP_DELAY_MS = 4_000;

function createHashVersion(parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.bindingHandlers = new Set();
    this.commandTimeoutMs = 8000;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

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
    const payload = JSON.stringify({ id, method, params });
    this.ws.send(payload);
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
        if (globalThis.__workbuddyBridge) {
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

        const notify = (payload) => {
          globalThis.workbuddyBridgeNotify(JSON.stringify(payload));
        };

        const ipcListeners = new Map();
        const ports = new Map();

        globalThis.__workbuddyBridge = {
          subscribeIpc(channel) {
            if (ipcListeners.has(channel)) {
              return true;
            }

            const listener = (_event, ...args) => {
              notify({ type: "ipc-event", channel, args });
            };

            globalThis.vscode.ipcRenderer.on(channel, listener);
            ipcListeners.set(channel, listener);
            return true;
          },

          unsubscribeIpc(channel) {
            const listener = ipcListeners.get(channel);
            if (!listener) {
              return true;
            }

            globalThis.vscode.ipcRenderer.removeListener(channel, listener);
            ipcListeners.delete(channel);
            return true;
          },

          openDynamicPort(windowId, nonce, portId) {
            const readyChannel = "codebuddy:agentManagerChannelReady";
            const errorChannel = "codebuddy:agentManagerChannelError";

            const cleanup = (messageListener, errorListener) => {
              window.removeEventListener("message", messageListener);
              globalThis.vscode.ipcRenderer.removeListener(errorChannel, errorListener);
            };

            const errorListener = (_event, payload) => {
              if (payload?.nonce !== nonce) {
                return;
              }

              cleanup(messageListener, errorListener);
              notify({
                type: "dynamic-port-error",
                portId,
                nonce,
                error: payload?.error || "Unknown error",
              });
            };

            const messageListener = (event) => {
              if (event.data !== nonce) {
                return;
              }

              cleanup(messageListener, errorListener);

              const port = event.ports?.[0];
              if (!port) {
                notify({
                  type: "dynamic-port-error",
                  portId,
                  nonce,
                  error: "No port received",
                });
                return;
              }

              port.start?.();
              port.onmessage = (messageEvent) => {
                notify({
                  type: "port-message",
                  portId,
                  payload: encode(messageEvent.data),
                });
              };
              port.onmessageerror = () => {
                notify({
                  type: "port-message-error",
                  portId,
                });
              };

              ports.set(portId, port);
              notify({
                type: "dynamic-port-ready",
                portId,
                nonce,
              });
            };

            window.addEventListener("message", messageListener);
            globalThis.vscode.ipcMessagePort.acquire(readyChannel, nonce);
            globalThis.vscode.ipcRenderer.on(errorChannel, errorListener);
            globalThis.vscode.ipcRenderer.send("codebuddy:requestAgentManagerChannel", windowId, nonce);
            return true;
          },

          postPortMessage(portId, payload) {
            const port = ports.get(portId);
            if (!port) {
              return false;
            }

            let data = payload?.value;
            if (payload?.kind === "base64") {
              const binary = atob(payload.base64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i += 1) {
                bytes[i] = binary.charCodeAt(i);
              }

              data = bytes.buffer;
            }

            port.postMessage(data);
            return true;
          },

          closePort(portId) {
            const port = ports.get(portId);
            if (!port) {
              return true;
            }

            try {
              port.close?.();
            } catch {}

            ports.delete(portId);
            return true;
          },
        };

        return "ok";
      })()`
    );
  }

  #handleMessage(raw) {
    const message = JSON.parse(raw);

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

function isAgentManagerTarget(entry) {
  if (entry?.type !== "page") {
    return false;
  }

  const url = typeof entry.url === "string" ? entry.url : "";
  const title = typeof entry.title === "string" ? entry.title.toLowerCase() : "";
  return (
    url.includes("agentManager.html") ||
    title.includes("agent manager") ||
    title.includes("agentmanager")
  );
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

async function getAgentManagerTarget({
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
      const target = lastTargets.filter(isAgentManagerTarget).at(-1);

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
    `Agent Manager target was not found within ${targetTimeoutMs}ms.` +
      ` WorkBuddy may still be starting or may have opened a different window.` +
      ` Visible targets: ${formatTargetSummary(lastTargets)}.${extra}`
  );
}

class BridgeRuntime {
  constructor(options) {
    this.options = options;
    this.cdp = null;
    this.configCache = null;
    this.authSessionCache = null;
    this.patchedAgentManagerJs = null;
    this.browserSockets = new Set();
    this.browserSocketWindows = new Map();
    this.pendingManagedWindowIds = new Set();
    this.pendingManagedWindowCleanupTimer = null;
    this.channelRefCounts = new Map();
    this.portClients = new Map();
    this.reconnectPromise = null;
    this.targetUrl = null;
    this.lastTargetCheckAt = 0;
    this.targetCheckIntervalMs = 1500;
    this.systemChannels = new Set([AUTH_SESSION_CHANNEL]);
    this.warmupPromise = null;
    this.shimJs = null;
    this.patchedCodeBuddyMainJs = null;
    this.assetVersion = "";
  }

  async initialize() {
    await this.prepareWebAssets();
    await this.warmup();
  }

  async prepareWebAssets() {
    if (
      this.patchedAgentManagerJs &&
      this.patchedCodeBuddyMainJs &&
      this.shimJs &&
      this.assetVersion
    ) {
      return;
    }

    const [patchedAgentManagerJs, patchedCodeBuddyMainJs, mainCss, shimJs] = await Promise.all([
      this.buildPatchedAgentManagerJs(),
      this.buildPatchedCodeBuddyMainJs(),
      fs.readFile(MAIN_CSS_PATH, "utf8"),
      Promise.resolve(renderShimJs()),
    ]);

    this.patchedAgentManagerJs = patchedAgentManagerJs;
    this.patchedCodeBuddyMainJs = patchedCodeBuddyMainJs;
    this.shimJs = shimJs;
    this.assetVersion = createHashVersion([
      mainCss,
      shimJs,
      patchedAgentManagerJs,
      patchedCodeBuddyMainJs,
    ]);
  }

  async warmup() {
    if (this.warmupPromise) {
      return this.warmupPromise;
    }

    this.warmupPromise = (async () => {
      await this.ensureCdpReady({ forceRefresh: true });
      await this.refreshRuntimeConfigSafe();
      await this.refreshAuthSessionSafe();
    })();

    try {
      await this.warmupPromise;
    } finally {
      this.warmupPromise = null;
    }
  }

  getAssetVersion() {
    return this.assetVersion;
  }

  getShimJs() {
    return this.shimJs || "";
  }

  getPatchedAgentManagerJs() {
    return this.patchedAgentManagerJs || "";
  }

  getPatchedCodeBuddyMainJs() {
    return this.patchedCodeBuddyMainJs || "";
  }

  getCodeBuddyMainJsPath() {
    return CODEBUDDY_MAIN_JS_PATH;
  }

  getTargetCachePath() {
    if (!this.options?.userDataDir) {
      return null;
    }
    return path.join(this.options.userDataDir, TARGET_CACHE_FILE_NAME);
  }

  async loadCachedTarget() {
    const cachePath = this.getTargetCachePath();
    if (!cachePath) {
      return null;
    }

    try {
      const raw = await fs.readFile(cachePath, "utf8");
      const cached = JSON.parse(raw);
      if (
        !cached ||
        typeof cached.webSocketDebuggerUrl !== "string" ||
        !cached.webSocketDebuggerUrl ||
        cached.cdpPort !== this.options?.cdpPort ||
        cached.cdpHost !== this.options?.cdpHost
      ) {
        return null;
      }
      return cached;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      logger.warn("cdp.target_cache.read_error", "Failed to read cached Agent Manager target", {
        cachePath,
        error,
      });
      return null;
    }
  }

  async saveCachedTarget(target) {
    const cachePath = this.getTargetCachePath();
    if (!cachePath || !target?.webSocketDebuggerUrl) {
      return;
    }

    const payload = {
      cdpHost: this.options?.cdpHost,
      cdpPort: this.options?.cdpPort,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      url: target.url || "",
      title: target.title || "",
      savedAt: new Date().toISOString(),
    };

    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), "utf8");
    } catch (error) {
      logger.warn("cdp.target_cache.write_error", "Failed to persist cached Agent Manager target", {
        cachePath,
        error,
      });
    }
  }

  async resolveAgentManagerTarget() {
    const cachedTarget = await this.loadCachedTarget();
    if (cachedTarget) {
      try {
        const cachedClient = new CdpClient(cachedTarget.webSocketDebuggerUrl);
        await cachedClient.connect();
        return {
          target: cachedTarget,
          client: cachedClient,
          fromCache: true,
        };
      } catch (error) {
        logger.warn("cdp.target_cache.stale", "Cached Agent Manager target is no longer usable", {
          target: cachedTarget,
          error,
        });
      }
    }

    return {
      target: await getAgentManagerTarget(this.options),
      client: null,
      fromCache: false,
    };
  }

  async ensureCdpReady({ forceRefresh = false } = {}) {
    if (this.reconnectPromise) {
      await this.reconnectPromise;
      return;
    }

    const currentReadyState = this.cdp?.ws?.readyState;
    const alreadyOpen = currentReadyState === WebSocket.OPEN;
    const shouldSkipRefresh =
      alreadyOpen &&
      !forceRefresh &&
      Date.now() - this.lastTargetCheckAt < this.targetCheckIntervalMs;
    if (shouldSkipRefresh) {
      return;
    }

    this.reconnectPromise = (async () => {
      const { target, client, fromCache } = await this.resolveAgentManagerTarget();
      const previousTargetUrl = this.targetUrl;
      const shouldReplaceClient =
        forceRefresh ||
        !this.cdp ||
        this.cdp.wsUrl !== target.webSocketDebuggerUrl ||
        this.cdp.ws?.readyState === WebSocket.CLOSED ||
        this.cdp.ws?.readyState === WebSocket.CLOSING;

      if (shouldReplaceClient) {
        this.cdp = client || new CdpClient(target.webSocketDebuggerUrl);
        this.cdp.onBinding((params) => this.handleBridgeNotification(params));
      } else if (client?.ws && client.ws.readyState === WebSocket.OPEN) {
        client.ws.close();
      }

      await this.cdp.connect();
      await this.cdp.ensureBridgeInjected();
      await this.restoreSystemSubscriptions();
      this.configCache = await this.cdp.evaluate(
        `window.vscode.context.resolveConfiguration().then((cfg) => cfg)`
      );
      this.lastTargetCheckAt = Date.now();
      this.targetUrl = target.url;
      await this.saveCachedTarget(target);
      if (forceRefresh || shouldReplaceClient || previousTargetUrl !== target.url) {
        const sourceLabel = fromCache ? "cached target" : "discovered target";
        logger.info("cdp.target.attached", "Attached Agent Manager target", {
          url: target.url,
          source: sourceLabel,
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

  async restoreSystemSubscriptions() {
    for (const channel of this.systemChannels) {
      await this.cdp.evaluate(
        `globalThis.__workbuddyBridge.subscribeIpc(${JSON.stringify(channel)})`
      );
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

  getCachedRuntimeConfig() {
    return this.configCache || {};
  }

  getCachedAuthSession() {
    return this.authSessionCache;
  }

  cacheAuthSession(session) {
    this.authSessionCache = session ?? null;
    return this.authSessionCache;
  }

  isHostConnected() {
    return this.cdp?.ws?.readyState === WebSocket.OPEN && Boolean(this.targetUrl);
  }

  getBootstrapPayload() {
    return {
      config: this.getCachedRuntimeConfig(),
      authSession: this.getCachedAuthSession(),
      hostConnected: this.isHostConnected(),
      restartAvailable: this.canRestartCurrentApp(),
    };
  }

  canRestartCurrentApp() {
    return (
      process.platform === "win32" &&
      Boolean(this.options?.userDataDir) &&
      Number.isInteger(this.options?.workbuddyPid) &&
      this.options.workbuddyPid > 0 &&
      Number.isInteger(this.options?.launcherPid) &&
      this.options.launcherPid > 0
    );
  }

  async refreshRuntimeConfig() {
    const config = await this.withCdpRecovery(() =>
      this.cdp.evaluate(`window.vscode.context.resolveConfiguration().then((cfg) => cfg)`)
    );
    this.configCache = config || {};
    return this.configCache;
  }

  async refreshRuntimeConfigSafe() {
    try {
      return await this.refreshRuntimeConfig();
    } catch (error) {
      logger.warn("runtime.config.refresh_error", "Failed to refresh runtime config", { error });
      return this.getCachedRuntimeConfig();
    }
  }

  async refreshAuthSession() {
    const session = await this.invokeIpc(AUTH_SESSION_REQUEST, []);
    return this.cacheAuthSession(session);
  }

  async refreshAuthSessionSafe() {
    try {
      return await this.refreshAuthSession();
    } catch (error) {
      logger.warn("auth.session.refresh_error", "Failed to refresh auth session", { error });
      return this.getCachedAuthSession();
    }
  }

  async buildPatchedAgentManagerJs() {
    const source = await fs.readFile(AGENT_MANAGER_JS_PATH, "utf8");
    const from =
      'const d=new URL(`${h(o.appRoot,{isWindows:u.platform==="win32",scheme:"vscode-file",fallbackAuthority:"vscode-app"})}/out/`);';
    const to =
      'const d=globalThis.__WB_APP_OUT_BASE_URL__?new URL(globalThis.__WB_APP_OUT_BASE_URL__):new URL(`${h(o.appRoot,{isWindows:u.platform==="win32",scheme:"vscode-file",fallbackAuthority:"vscode-app"})}/out/`);';

    if (!source.includes(from)) {
      throw new Error("Unable to patch agentManager.js: bootstrap anchor not found");
    }

    return source.replace(from, to);
  }

  async buildPatchedCodeBuddyMainJs() {
    const source = await fs.readFile(CODEBUDDY_MAIN_JS_PATH, "utf8");
    const exposeLocalAttachHookFrom =
      '},[n,a,t,s]),E=(0,L.useCallback)(async()=>{if(!t?.pickFile||!n)return;let B=t.environmentType==="cloud",';
    const exposeLocalAttachHookTo =
      '},[n,a,t,s]),_=(0,L.useCallback)(async(B,w=Date.now())=>{if(t?.environmentType==="cloud"||typeof B!="string"||!B)return!1;await C(B,w);return!0},[t,C]),E=(typeof globalThis!="undefined"&&(globalThis.__WB_REMOTE_ATTACH_LOCAL_FILE__=_),(0,L.useCallback)(async()=>{if(!t?.pickFile||!n)return;let B=t.environmentType==="cloud",';
    const closeLocalAttachHookFrom = '},[t,n,m,C,i,d,g]),b=(0,L.useMemo)';
    const closeLocalAttachHookTo = '},[t,n,m,C,i,d,g])),b=(0,L.useMemo)';

    if (
      !source.includes(exposeLocalAttachHookFrom) ||
      !source.includes(closeLocalAttachHookFrom)
    ) {
      throw new Error("Unable to patch codebuddy/main.js: attachment hook anchor not found");
    }

    return source
      .replace(exposeLocalAttachHookFrom, exposeLocalAttachHookTo)
      .replace(closeLocalAttachHookFrom, closeLocalAttachHookTo);
  }

  registerBrowserSocket(socket) {
    this.browserSockets.add(socket);
    this.browserSocketWindows.set(socket, new Set());
    logger.info("runtime.browser_socket.registered", "Registered browser socket", {
      browserSocketCount: this.browserSockets.size,
      pendingManagedWindows: this.pendingManagedWindowIds.size,
    });
    this.schedulePendingManagedWindowCleanup();
    socket.on("close", () => {
      this.browserSockets.delete(socket);
      const sessionWindows = this.browserSocketWindows.get(socket);
      if (sessionWindows) {
        for (const windowId of sessionWindows) {
          this.pendingManagedWindowIds.add(windowId);
        }
      }
      this.browserSocketWindows.delete(socket);
      logger.info("runtime.browser_socket.closed", "Browser socket removed", {
        trackedWindowIds: sessionWindows ? [...sessionWindows] : [],
        pendingManagedWindows: this.pendingManagedWindowIds.size,
        browserSocketCount: this.browserSockets.size,
      });
      for (const [portId, client] of this.portClients.entries()) {
        if (client === socket) {
          this.portClients.delete(portId);
          logger.debug("runtime.port_client.removed", "Removed port client for closed socket", {
            portId,
          });
        }
      }
    });
  }

  trackSocketWindow(socket, windowId) {
    const windows = this.browserSocketWindows.get(socket);
    if (!windows || !Number.isInteger(windowId) || windowId <= 0) {
      return;
    }

    windows.add(windowId);
  }

  schedulePendingManagedWindowCleanup() {
    if (this.pendingManagedWindowIds.size === 0 || this.pendingManagedWindowCleanupTimer) {
      return;
    }

    logger.info("runtime.managed_window_cleanup.scheduled", "Scheduled delayed managed window cleanup", {
      delayMs: PREVIOUS_WINDOW_CLEANUP_DELAY_MS,
      windowIds: [...this.pendingManagedWindowIds],
    });
    this.pendingManagedWindowCleanupTimer = setTimeout(() => {
      this.pendingManagedWindowCleanupTimer = null;
      this.closePendingManagedWindows().catch((error) => {
        logger.warn("runtime.managed_window_cleanup.error", "Failed to cleanup previous managed windows", {
          error,
        });
      });
    }, PREVIOUS_WINDOW_CLEANUP_DELAY_MS);
  }

  async closePendingManagedWindows() {
    if (this.pendingManagedWindowIds.size === 0) {
      return;
    }

    const windowIds = [...this.pendingManagedWindowIds];
    this.pendingManagedWindowIds.clear();
    logger.info("runtime.managed_window_cleanup.started", "Closing previous managed windows", {
      windowIds,
    });

    for (const windowId of windowIds) {
      try {
        const result = await this.invokeIpc("codebuddy:closeManagedWindow", [{ windowId }]);
        if (result?.closed || result?.alreadyClosed) {
          logger.info("runtime.managed_window_cleanup.closed", "Closed previous managed window", {
            windowId,
            result,
          });
          continue;
        }

        if (result?.reason) {
          logger.info("runtime.managed_window_cleanup.skipped", "Skipped previous managed window cleanup", {
            windowId,
            reason: result.reason,
            result,
          });
        }
      } catch (error) {
        logger.warn("runtime.managed_window_cleanup.close_error", "Failed to close previous managed window", {
          windowId,
          error,
        });
      }
    }
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    logger.debug("websocket.bridge_to_browser.broadcast", "Broadcasting bridge message", {
      browserSocketCount: this.browserSockets.size,
      message: summarizeMessage(message),
      bytes: Buffer.byteLength(payload),
    });
    for (const socket of this.browserSockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  sendToSocket(socket, message) {
    if (socket.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(message);
      logger.debug("websocket.bridge_to_browser", "Bridge sent browser message", {
        message: summarizeMessage(message),
        bytes: Buffer.byteLength(payload),
      });
      socket.send(payload);
    }
  }

  async invokeIpc(channel, args) {
    logger.debug("ipc.invoke", "Invoking WorkBuddy IPC channel", {
      channel,
      args: summarizeValue(args),
    });
    const expression = `globalThis.vscode.ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(
      args
    )})`;
    try {
      const result = await this.withCdpRecovery(() => this.cdp.evaluate(expression));
      logger.debug("ipc.invoke.result", "WorkBuddy IPC invoke completed", {
        channel,
        result: summarizeValue(result),
      });
      return result;
    } catch (error) {
      logger.error("ipc.invoke.error", "WorkBuddy IPC invoke failed", {
        channel,
        args: summarizeValue(args),
        error,
      });
      throw error;
    }
  }

  normalizeAuthLoginUrl(loginUrlResponse) {
    return typeof loginUrlResponse === "string" ? loginUrlResponse : loginUrlResponse?.url;
  }

  async triggerNativeAuthLogin(args) {
    const expression = `(() => {
      const invokeArgs = ${JSON.stringify(args || [])};
      globalThis.vscode.ipcRenderer
        .invoke(${JSON.stringify(AUTH_LOGIN_REQUEST)}, ...invokeArgs)
        .then((result) => {
          console.info("[workbuddy-bridge] Native auth login finished", result);
        })
        .catch((error) => {
          console.error("[workbuddy-bridge] Native auth login failed", error);
        });
      return true;
    })()`;

    await this.withCdpRecovery(() => this.cdp.evaluate(expression));
  }

  async waitForAuthLoginUrl(
    args,
    { timeoutMs = 8000, pollIntervalMs = 200, initialDelayMs = 1200 } = {}
  ) {
    if (initialDelayMs > 0) {
      await delay(initialDelayMs);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const loginUrlResponse = await this.invokeIpc(AUTH_LOGIN_URL_REQUEST, args || []);
      const url = this.normalizeAuthLoginUrl(loginUrlResponse);
      if (url && typeof url === "string") {
        return url;
      }

      await delay(pollIntervalMs);
    }

    return null;
  }

  async invokeAuthLogin(socket, args) {
    await this.triggerNativeAuthLogin(args || []);
    const url = await this.waitForAuthLoginUrl(args || []);

    if (!url || typeof url !== "string") {
      throw new Error("Auth login URL was not returned by WorkBuddy");
    }

    logger.info("auth.native_login.started", "Started native auth login and forwarded URL to browser", {
      url,
    });
    this.sendToSocket(socket, {
      type: "open-external",
      url,
    });

    return {
      success: true,
      startedNativeLogin: true,
      openedInBrowser: true,
      url,
    };
  }

  async requestRestart() {
    if (!this.canRestartCurrentApp()) {
      throw new Error("Restart is unavailable for the current bridge session.");
    }

    const psArgs = [
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
      this.options.userDataDir,
      "-ListenHost",
      this.options.listenHost || "127.0.0.1",
      "-WorkBuddyPid",
      String(this.options.workbuddyPid),
      "-LauncherPid",
      String(this.options.launcherPid),
      "-LauncherParentPid",
      String(this.options.launcherParentPid || 0),
      "-RelaunchShell",
      this.options.relaunchShell || "powershell",
    ];

    if (this.options.logPath) {
      psArgs.push("-LogPath", this.options.logPath);
    }
    if (this.options.passwordHash) {
      psArgs.push("-PasswordHash", this.options.passwordHash);
    }
    if (this.options.showReadyWindow) {
      psArgs.push("-ShowReadyWindow");
    }
    if (this.options.openBrowser) {
      psArgs.push("-OpenBrowser");
    }

    const quotedPsArgs = psArgs.map((arg) => `'${String(arg).replace(/'/g, "''")}'`).join(", ");
    const bootstrapArgs = [
      "-NoProfile",
      "-WindowStyle",
      "Hidden",
      "-Command",
      `Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList @(${quotedPsArgs})`,
    ];

    logger.info("process.restart_helper.starting", "Starting restart helper", {
      currentBridgePid: process.pid,
      workbuddyPid: this.options.workbuddyPid,
      launcherPid: this.options.launcherPid,
      launcherParentPid: this.options.launcherParentPid,
      cdpPort: this.options.cdpPort,
      bridgePort: this.options.listenPort,
      relaunchShell: this.options.relaunchShell,
    });

    spawn("powershell.exe", bootstrapArgs, {
      stdio: "ignore",
      windowsHide: true,
    });

    return {
      ok: true,
      restarting: true,
    };
  }

  async sendIpc(channel, args) {
    logger.debug("ipc.send", "Sending WorkBuddy IPC channel", {
      channel,
      args: summarizeValue(args),
    });
    const expression = `(() => { globalThis.vscode.ipcRenderer.send(${JSON.stringify(
      channel
    )}, ...${JSON.stringify(args)}); return true; })()`;
    try {
      return await this.withCdpRecovery(() => this.cdp.evaluate(expression));
    } catch (error) {
      logger.error("ipc.send.error", "WorkBuddy IPC send failed", {
        channel,
        args: summarizeValue(args),
        error,
      });
      throw error;
    }
  }

  async subscribeChannel(channel) {
    const current = this.channelRefCounts.get(channel) || 0;
    if (current === 0) {
      await this.withCdpRecovery(() =>
        this.cdp.evaluate(`globalThis.__workbuddyBridge.subscribeIpc(${JSON.stringify(channel)})`)
      );
    }
    this.channelRefCounts.set(channel, current + 1);
  }

  async unsubscribeChannel(channel) {
    const current = this.channelRefCounts.get(channel) || 0;
    if (current <= 1) {
      this.channelRefCounts.delete(channel);
      await this.withCdpRecovery(() =>
        this.cdp.evaluate(
          `globalThis.__workbuddyBridge.unsubscribeIpc(${JSON.stringify(channel)})`
        )
      );
      return;
    }

    this.channelRefCounts.set(channel, current - 1);
  }

  async openDynamicPort(socket, windowId, nonce, portId) {
    this.trackSocketWindow(socket, windowId);
    this.portClients.set(portId, socket);
    logger.info("dynamic_port.open", "Opening dynamic port", {
      windowId,
      portId,
      noncePresent: Boolean(nonce),
    });
    await this.withCdpRecovery(() =>
      this.cdp.evaluate(
        `globalThis.__workbuddyBridge.openDynamicPort(${JSON.stringify(
          windowId
        )}, ${JSON.stringify(nonce)}, ${JSON.stringify(portId)})`
      )
    );
  }

  async postPortMessage(socket, portId, payload) {
    if (socket) {
      this.portClients.set(portId, socket);
    }

    logger.debug("dynamic_port.browser_to_workbuddy", "Browser posted dynamic port message", {
      portId,
      payload: summarizeValue(payload),
    });

    const openExternalRequest = this.extractOpenExternalRequest(payload);
    if (openExternalRequest) {
      this.forwardOpenExternal(portId, openExternalRequest);
      return;
    }

    await this.withCdpRecovery(() =>
      this.cdp.evaluate(
        `globalThis.__workbuddyBridge.postPortMessage(${JSON.stringify(
          portId
        )}, ${JSON.stringify(payload)})`
      )
    );
  }

  async closePort(portId) {
    this.portClients.delete(portId);
    logger.info("dynamic_port.close", "Closing dynamic port", { portId });
    await this.withCdpRecovery(() =>
      this.cdp.evaluate(`globalThis.__workbuddyBridge.closePort(${JSON.stringify(portId)})`)
    );
  }

  extractOpenExternalRequest(payload) {
    if (payload?.kind !== "json") {
      return null;
    }

    return this.findOpenExternalRequest(payload.value);
  }

  findOpenExternalRequest(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const directMatch = this.tryParseOpenExternalRequest(value);
    if (directMatch) {
      return directMatch;
    }

    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
      const nestedMatch = this.findOpenExternalRequest(child);
      if (nestedMatch) {
        return nestedMatch;
      }
    }

    return null;
  }

  tryParseOpenExternalRequest(value) {
    const rpcPayload =
      value?.type === "acp-rpc" && value?.payload && typeof value.payload === "object"
        ? value.payload
        : value;

    if (rpcPayload?.method === "__backend__") {
      const backendMatch = this.extractBackendOpenExternal(rpcPayload.params);
      if (backendMatch) {
        return {
          ...backendMatch,
          rpcId: rpcPayload.id,
        };
      }
    }

    return this.extractBackendOpenExternal(value);
  }

  extractBackendOpenExternal(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (value.type === "backend:open-external") {
      const url = value.params?.url ?? value.url;
      if (typeof url === "string" && url) {
        return {
          url,
          backendRequestId: value.requestId,
        };
      }
    }

    if (value.type === "backend" && value.params && typeof value.params === "object") {
      const nested = value.params;
      if (nested.type === "backend:open-external") {
        const url = nested.params?.url ?? nested.url;
        if (typeof url === "string" && url) {
          return {
            url,
            backendRequestId: value.requestId ?? nested.requestId,
          };
        }
      }
    }

    return null;
  }

  buildOpenExternalResult(request) {
    if (request?.rpcId !== undefined) {
      return {
        type: "acp-rpc",
        payload: {
          jsonrpc: "2.0",
          id: request.rpcId,
          result: {
            success: true,
          },
        },
      };
    }

    return {
      success: true,
      requestId: request?.backendRequestId,
    };
  }

  forwardOpenExternal(portId, request) {
    const socket = this.portClients.get(portId);
    if (!socket) {
      return;
    }

    logger.info("open_external.forward", "Forwarding openExternal request to browser", {
      portId,
      url: request.url,
      rpcId: request.rpcId,
      backendRequestId: request.backendRequestId,
    });
    this.sendToSocket(socket, {
      type: "open-external",
      url: request.url,
    });
    this.sendToSocket(socket, {
      type: "port-message",
      portId,
      payload: encodePayloadForTransport(this.buildOpenExternalResult(request)),
    });
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

    if (payload.type === "dynamic-port-ready") {
      const socket = this.portClients.get(payload.portId);
      if (socket) {
        this.sendToSocket(socket, payload);
      }
      return;
    }

    if (payload.type === "dynamic-port-error") {
      const socket = this.portClients.get(payload.portId);
      if (socket) {
        this.sendToSocket(socket, payload);
      }
      return;
    }

    if (payload.type === "port-message" || payload.type === "port-message-error") {
      const socket = this.portClients.get(payload.portId);
      if (socket) {
        this.sendToSocket(socket, payload);
      }
      return;
    }

    if (payload.type === "ipc-event") {
      if (payload.channel === AUTH_SESSION_CHANNEL) {
        this.cacheAuthSession(payload.args?.[0]);
      }
      this.broadcast(payload);
    }
  }
}

export { CdpClient, BridgeRuntime, getAgentManagerTarget };
