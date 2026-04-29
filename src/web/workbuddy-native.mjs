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

function renderWorkBuddyNativeShimJs({ methods = [], version = "" } = {}) {
  const methodList = methods.length > 0 ? methods : FALLBACK_BUDDY_API_METHODS;
  return `(() => {
  const apiMethods = ${JSON.stringify(methodList)};
  const workBuddyVersion = ${JSON.stringify(version || "")};
  const pending = new Map();
  const listeners = new Map();
  let socket = null;
  let readyPromise = null;
  let requestId = 0;

  const eventMethodPattern = /^(?:on[A-Z]|\\$on$)/u;

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

        if (message.type === "open-external" && typeof message.url === "string") {
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
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }
    if ((method === "readClipboard" || method === "clipboardReadText") && navigator.clipboard?.readText) {
      return navigator.clipboard.readText();
    }
    if (method === "clipboardWriteText" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(args[0] || ""));
      return true;
    }

    return request({
      type: "buddy-api-call",
      method,
      args: await encodeValue(args),
    });
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
