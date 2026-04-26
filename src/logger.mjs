import fs from "node:fs";
import path from "node:path";

const LEVELS = new Map([
  ["debug", 10],
  ["info", 20],
  ["warn", 30],
  ["error", 40],
]);
const DEFAULT_LEVEL = "debug";
const MAX_STRING_LENGTH = 180;
const MAX_ARRAY_ITEMS = 6;
const MAX_OBJECT_KEYS = 12;
const LOG_RETENTION_MAX_FILE_BYTES = 50 * 1024 * 1024;
const LOG_RETENTION_MAX_DIR_BYTES = 300 * 1024 * 1024;
const LOG_RETENTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LOG_RETENTION_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const REDACTED_KEY_PATTERN = /password|token|secret|authorization|cookie|hash|credential|session/i;

function normalizeLevel(level) {
  const value = String(level || "").trim().toLowerCase();
  return LEVELS.has(value) ? value : DEFAULT_LEVEL;
}

const activeLevel = normalizeLevel(process.env.WORKBUDDY_REMOTE_LOG_LEVEL);
const eventLogPath = process.env.WORKBUDDY_REMOTE_EVENT_LOG_PATH || "";
let lastRetentionAt = 0;

function shouldLog(level) {
  return LEVELS.get(level) >= LEVELS.get(activeLevel);
}

function isLogFileName(name) {
  return /\.log(?:\.|$)/i.test(name);
}

function rotateEventLogIfNeeded() {
  if (!eventLogPath) {
    return;
  }

  try {
    const stats = fs.statSync(eventLogPath);
    if (!stats.isFile() || stats.size < LOG_RETENTION_MAX_FILE_BYTES) {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.renameSync(eventLogPath, `${eventLogPath}.${timestamp}`);
  } catch {
    // Logging maintenance must not break the bridge.
  }
}

function enforceLogRetention() {
  if (!eventLogPath) {
    return;
  }

  const now = Date.now();
  if (now - lastRetentionAt < LOG_RETENTION_CHECK_INTERVAL_MS) {
    return;
  }
  lastRetentionAt = now;

  rotateEventLogIfNeeded();

  let dir;
  try {
    dir = path.dirname(eventLogPath);
  } catch {
    return;
  }

  let entries;
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isLogFileName(entry.name))
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        const stats = fs.statSync(filePath);
        return { filePath, size: stats.size, mtimeMs: stats.mtimeMs };
      });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (now - entry.mtimeMs > LOG_RETENTION_MAX_AGE_MS) {
      try {
        fs.rmSync(entry.filePath, { force: true });
        entry.deleted = true;
      } catch {}
    }
  }

  const remaining = entries
    .filter((entry) => !entry.deleted)
    .sort((left, right) => left.mtimeMs - right.mtimeMs);
  let totalBytes = remaining.reduce((sum, entry) => sum + entry.size, 0);

  for (const entry of remaining) {
    if (totalBytes <= LOG_RETENTION_MAX_DIR_BYTES) {
      break;
    }
    try {
      fs.rmSync(entry.filePath, { force: true });
      totalBytes -= entry.size;
    } catch {}
  }
}

function summarizeString(value) {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_STRING_LENGTH)}...<${value.length} chars>`;
}

function summarizeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ? summarizeString(error.stack) : undefined,
    };
  }

  return summarizeValue(error);
}

function summarizeValue(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    return summarizeError(value);
  }

  const valueType = typeof value;
  if (valueType === "string") {
    return summarizeString(value);
  }
  if (valueType === "number" || valueType === "boolean") {
    return value;
  }
  if (valueType === "bigint") {
    return `${value}n`;
  }
  if (valueType === "function") {
    return "[function]";
  }

  if (Buffer.isBuffer(value)) {
    return {
      type: "Buffer",
      bytes: value.byteLength,
    };
  }

  if (ArrayBuffer.isView(value)) {
    return {
      type: value.constructor?.name || "TypedArray",
      bytes: value.byteLength,
      length: value.length,
    };
  }

  if (value instanceof ArrayBuffer) {
    return {
      type: "ArrayBuffer",
      bytes: value.byteLength,
    };
  }

  if (Array.isArray(value)) {
    if (depth >= 2) {
      return {
        type: "Array",
        length: value.length,
      };
    }

    return {
      type: "Array",
      length: value.length,
      items: value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarizeValue(item, depth + 1)),
      truncated: value.length > MAX_ARRAY_ITEMS,
    };
  }

  if (valueType === "object") {
    const keys = Object.keys(value);
    if (depth >= 2) {
      return {
        type: value.constructor?.name || "Object",
        keys: keys.slice(0, MAX_OBJECT_KEYS),
        keyCount: keys.length,
      };
    }

    const result = {};
    for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
      result[key] = REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : summarizeValue(value[key], depth + 1);
    }
    if (keys.length > MAX_OBJECT_KEYS) {
      result.__truncatedKeys = keys.length - MAX_OBJECT_KEYS;
    }
    return result;
  }

  return String(value);
}

function summarizeMessage(message) {
  if (!message || typeof message !== "object") {
    return summarizeValue(message);
  }

  return {
    type: message.type,
    id: message.id,
    channel: message.channel,
    portId: message.portId,
    windowId: message.windowId,
    nonce: message.nonce ? "[present]" : undefined,
    args: Array.isArray(message.args)
      ? {
          length: message.args.length,
          items: message.args.slice(0, MAX_ARRAY_ITEMS).map((item) => summarizeValue(item, 1)),
        }
      : undefined,
    payload: message.payload ? summarizeValue(message.payload, 1) : undefined,
    result: message.result ? summarizeValue(message.result, 1) : undefined,
    ok: message.ok,
    error: message.error,
  };
}

function log(level, event, message, details = {}) {
  const normalizedLevel = normalizeLevel(level);
  if (!shouldLog(normalizedLevel)) {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    level: normalizedLevel,
    event,
    message,
    pid: process.pid,
    details: summarizeValue(details),
  };
  const line = JSON.stringify(entry);

  if (eventLogPath) {
    try {
      enforceLogRetention();
      fs.appendFileSync(eventLogPath, `${line}\n`, "utf8");
    } catch {
      // Logging must not break the bridge.
    }
  }

  if (normalizedLevel === "error") {
    console.error(line);
  } else if (normalizedLevel === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

const logger = {
  debug(event, message, details) {
    log("debug", event, message, details);
  },
  info(event, message, details) {
    log("info", event, message, details);
  },
  warn(event, message, details) {
    log("warn", event, message, details);
  },
  error(event, message, details) {
    log("error", event, message, details);
  },
};

export { logger, summarizeError, summarizeMessage, summarizeValue };
