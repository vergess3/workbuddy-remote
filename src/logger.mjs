import fs from "node:fs";
import path from "node:path";

const LEVELS = new Map([
  ["debug", 10],
  ["info", 20],
  ["warn", 30],
  ["error", 40],
]);
const DEFAULT_LEVEL = "info";
const REDACTED_KEY_PATTERN = /password|token|secret|authorization|cookie|hash|credential|session/i;

function normalizeLevel(level) {
  const value = String(level || "").trim().toLowerCase();
  return LEVELS.has(value) ? value : DEFAULT_LEVEL;
}

const activeLevel = normalizeLevel(process.env.WORKBUDDY_REMOTE_LOG_LEVEL);
const eventLogPath = process.env.WORKBUDDY_REMOTE_EVENT_LOG_PATH || "";

function shouldLog(level) {
  return LEVELS.get(level) >= LEVELS.get(activeLevel);
}

function summarizeValue(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? `${value.stack.slice(0, 800)}${value.stack.length > 800 ? "...<truncated>" : ""}` : "",
    };
  }
  if (typeof value === "string") {
    return value.length > 220 ? `${value.slice(0, 220)}...<${value.length} chars>` : value;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return { type: "Buffer", bytes: value.byteLength };
  }
  if (Array.isArray(value)) {
    return {
      type: "Array",
      length: value.length,
      items: depth >= 2 ? undefined : value.slice(0, 6).map((item) => summarizeValue(item, depth + 1)),
      truncated: value.length > 6,
    };
  }

  const result = {};
  for (const key of Object.keys(value).slice(0, 12)) {
    result[key] = REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : summarizeValue(value[key], depth + 1);
  }
  return result;
}

function summarizeMessage(message) {
  if (!message || typeof message !== "object") {
    return summarizeValue(message);
  }
  return {
    type: message.type,
    id: message.id,
    method: message.method,
    key: message.key,
    args: summarizeValue(message.args),
    ok: message.ok,
    error: message.error,
  };
}

function writeLine(line) {
  if (eventLogPath) {
    try {
      fs.mkdirSync(path.dirname(eventLogPath), { recursive: true });
      fs.appendFileSync(eventLogPath, `${line}\n`, "utf8");
      return;
    } catch {}
  }
  if (activeLevel === "debug") {
    process.stderr.write(`${line}\n`);
  }
}

function log(level, event, message, details = {}) {
  const normalizedLevel = normalizeLevel(level);
  if (!shouldLog(normalizedLevel)) {
    return;
  }
  writeLine(JSON.stringify({
    ts: new Date().toISOString(),
    level: normalizedLevel,
    event,
    message,
    pid: process.pid,
    details: summarizeValue(details),
  }));
}

const logger = {
  debug: (event, message, details) => log("debug", event, message, details),
  info: (event, message, details) => log("info", event, message, details),
  warn: (event, message, details) => log("warn", event, message, details),
  error: (event, message, details) => log("error", event, message, details),
};

export { logger, summarizeMessage, summarizeValue };
