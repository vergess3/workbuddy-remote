import path from "node:path";
import { promises as fs } from "node:fs";
import util from "node:util";

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatFileTimestamp(date = new Date()) {
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(
    date.getMinutes()
  )}${pad(date.getSeconds())}`;
}

function formatValue(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "undefined";
  }

  try {
    return util.inspect(value, {
      depth: 8,
      colors: false,
      compact: false,
      breakLength: 120,
      maxArrayLength: 100,
      maxStringLength: 20_000,
    });
  } catch {
    return String(value);
  }
}

function createConsoleStyleLine(scope, parts, timestamp = new Date()) {
  const rendered = parts.map((part) => formatValue(part)).join(" ");
  const lines = rendered.split(/\r?\n/);
  if (lines.length === 1) {
    return `[main ${timestamp.toISOString()}] [${scope}] ${rendered}`;
  }

  return [
    `[main ${timestamp.toISOString()}] [${scope}] ${lines[0]}`,
    ...lines.slice(1).map((line) => `    ${line}`),
  ].join("\n");
}

class ConnectionLogSession {
  constructor(filePath, label, metadata = {}) {
    this.filePath = filePath;
    this.label = label;
    this.metadata = metadata;
    this.queue = Promise.resolve();
  }

  async write(scope, ...parts) {
    const line = createConsoleStyleLine(scope, parts);
    this.queue = this.queue
      .catch(() => {})
      .then(() => fs.appendFile(this.filePath, `${line}\n`, "utf8"));
    return this.queue;
  }

  async close(summary = null) {
    if (summary) {
      await this.write("ConnectionSession", summary);
    }
    await this.queue.catch(() => {});
  }
}

class ConnectionLogger {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.logDir = path.join(rootDir, "connections");
    this.sequence = 0;
  }

  async ensureReady() {
    await fs.mkdir(this.logDir, { recursive: true });
  }

  async createSession(label, metadata = {}) {
    await this.ensureReady();
    this.sequence += 1;
    const suffix = this.sequence === 1 ? "" : `-${this.sequence}`;
    const fileName = `${formatFileTimestamp()}${suffix}.log`;
    const filePath = path.join(this.logDir, fileName);
    const session = new ConnectionLogSession(filePath, label, metadata);
    await session.write(
      "ConnectionSession",
      `New ${label} connection established.`,
      {
        fileName,
        ...metadata,
      }
    );
    return session;
  }
}

export { ConnectionLogger, createConsoleStyleLine };
