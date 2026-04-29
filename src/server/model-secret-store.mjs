import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";

const STORE_VERSION = 1;
const DPAPI_ENTROPY = "workbuddy-remote:model-secret-store:v1";

function createEmptyStore() {
  return {
    version: STORE_VERSION,
    models: {},
  };
}

function findPowerShellExe() {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function runPowerShell(script, input) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      findPowerShellExe(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `PowerShell exited with code ${code}`));
    });
    child.stdin.end(input, "utf8");
  });
}

async function protectText(plainText) {
  if (process.platform !== "win32") {
    throw new Error("Model secret store requires Windows DPAPI.");
  }

  return (
    await runPowerShell(
      `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($plain)
$entropy = [System.Text.Encoding]::UTF8.GetBytes(${JSON.stringify(DPAPI_ENTROPY)})
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`,
      plainText
    )
  ).trim();
}

async function unprotectText(protectedText) {
  if (process.platform !== "win32") {
    throw new Error("Model secret store requires Windows DPAPI.");
  }

  return runPowerShell(
    `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$cipher = [Console]::In.ReadToEnd().Trim()
if (-not $cipher) {
  [Console]::Out.Write("{}")
  exit 0
}
$bytes = [Convert]::FromBase64String($cipher)
$entropy = [System.Text.Encoding]::UTF8.GetBytes(${JSON.stringify(DPAPI_ENTROPY)})
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))
`,
    protectedText
  );
}

class ModelSecretStore {
  constructor(storePath) {
    this.storePath = path.resolve(storePath);
    this.data = createEmptyStore();
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.loaded) {
      return;
    }

    try {
      const protectedText = await fs.readFile(this.storePath, "utf8");
      const plainText = await unprotectText(protectedText);
      const parsed = JSON.parse(plainText || "{}");
      this.data = {
        ...createEmptyStore(),
        ...parsed,
        models: parsed?.models && typeof parsed.models === "object" ? parsed.models : {},
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        this.data = createEmptyStore();
      } else {
        throw error;
      }
    }
    this.loaded = true;
  }

  async save() {
    await this.load();
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.storePath), { recursive: true });
      const protectedText = await protectText(JSON.stringify(this.data, null, 2));
      await fs.writeFile(this.storePath, `${protectedText}\n`, { encoding: "utf8", mode: 0o600 });
    });
    return this.writeQueue;
  }

  async get(modelId) {
    await this.load();
    const id = String(modelId || "").trim();
    return id ? this.data.models[id] || null : null;
  }

  async getByToken(modelId, token) {
    const secret = await this.get(modelId);
    return secret && secret.token === token ? secret : null;
  }

  async upsert(modelId, values = {}) {
    await this.load();
    const id = String(modelId || "").trim();
    if (!id) {
      throw new Error("Model id is required for secret storage.");
    }

    const previous = this.data.models[id] || {};
    const next = {
      token: previous.token || randomBytes(24).toString("base64url"),
      endpoint: values.endpoint ?? previous.endpoint ?? "",
      apiKey: values.apiKey ?? previous.apiKey ?? "",
      updatedAt: new Date().toISOString(),
    };
    if (
      previous.token === next.token &&
      previous.endpoint === next.endpoint &&
      previous.apiKey === next.apiKey
    ) {
      return previous;
    }

    this.data.models[id] = next;
    await this.save();
    return this.data.models[id];
  }

  async rename(previousId, nextId) {
    await this.load();
    const from = String(previousId || "").trim();
    const to = String(nextId || "").trim();
    if (!from || !to || from === to || !this.data.models[from]) {
      return;
    }
    this.data.models[to] = this.data.models[to] || this.data.models[from];
    delete this.data.models[from];
    await this.save();
  }

  async delete(modelId) {
    await this.load();
    const id = String(modelId || "").trim();
    if (!id || !this.data.models[id]) {
      return;
    }
    delete this.data.models[id];
    await this.save();
  }
}

export { ModelSecretStore };
