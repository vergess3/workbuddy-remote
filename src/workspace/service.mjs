import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { promises as fs, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { WORKSPACE_ROOT_FOLDER_NAME } from "../shared.mjs";
import { loadConfig } from "../config.mjs";

const RESERVED_WINDOWS_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

function normalizeDriveLetter(input) {
  const raw = typeof input === "string" ? input.trim().toUpperCase() : "";
  return /^[A-Z]:$/.test(raw) ? raw : null;
}

function getDriveRootPath(drive) {
  return `${drive}\\`;
}

function getDefaultWorkspaceRootPath() {
  return path.win32.join(os.homedir(), WORKSPACE_ROOT_FOLDER_NAME);
}

function normalizeWindowsPath(inputPath) {
  return typeof inputPath === "string" && inputPath.trim()
    ? path.win32.normalize(inputPath.trim())
    : null;
}

function normalizeAllowedRootPath(inputPath) {
  const normalizedPath = normalizeWindowsPath(inputPath);
  if (!normalizedPath || !/^[A-Za-z]:\\/.test(normalizedPath)) {
    return null;
  }
  return normalizedPath.length > 3 ? normalizedPath.replace(/[\\\/]+$/, "") : normalizedPath;
}

function isSubPath(parentPath, childPath) {
  const normalizedParent = path.win32.resolve(parentPath).toLowerCase();
  const normalizedChild = path.win32.resolve(childPath).toLowerCase();
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(
      normalizedParent.endsWith("\\") ? normalizedParent : `${normalizedParent}\\`
    )
  );
}

function dedupePaths(paths) {
  const seen = new Set();
  const results = [];

  for (const currentPath of paths) {
    const key = currentPath.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(currentPath);
  }

  return results;
}

async function loadConfiguredWorkspaceRoots() {
  const config = await loadConfig();
  return dedupePaths(
    config.workspaceRoots.map((item) => normalizeAllowedRootPath(item)).filter(Boolean)
  );
}

const CONFIGURED_WORKSPACE_ROOTS = await loadConfiguredWorkspaceRoots();

function buildWorkspaceRootEntry(rootPath) {
  return {
    path: rootPath,
    label: rootPath,
  };
}

async function assertDriveExistsForPath(targetPath) {
  const drive = normalizeDriveLetter(targetPath.slice(0, 2));
  if (!drive) {
    throw new Error("Invalid workspace root path.");
  }

  try {
    await fs.access(getDriveRootPath(drive));
  } catch {
    throw new Error(`Drive ${drive} does not exist on the host.`);
  }

  return drive;
}

async function listAvailableWorkspaceRoots() {
  if (CONFIGURED_WORKSPACE_ROOTS.length > 0) {
    return CONFIGURED_WORKSPACE_ROOTS.map(buildWorkspaceRootEntry);
  }

  return [buildWorkspaceRootEntry(getDefaultWorkspaceRootPath())];
}

async function findWorkspaceRootByPath(targetPath) {
  const normalizedPath = normalizeWindowsPath(targetPath);
  if (!normalizedPath) {
    throw new Error("Missing workspace path.");
  }

  const workspaceRoots = await listAvailableWorkspaceRoots();
  const matchedRoot = workspaceRoots.find((entry) => isSubPath(entry.path, normalizedPath));
  if (!matchedRoot) {
    throw new Error("Only paths inside allowed workspace roots are allowed.");
  }

  return matchedRoot;
}

async function ensureWorkspaceRoot(rootPath) {
  const normalizedRootPath = normalizeAllowedRootPath(rootPath);
  if (!normalizedRootPath) {
    throw new Error("Invalid workspace root path.");
  }

  const matchedRoot = await findWorkspaceRootByPath(normalizedRootPath);
  if (matchedRoot.path.toLowerCase() !== normalizedRootPath.toLowerCase()) {
    throw new Error("Invalid workspace root path.");
  }

  await assertDriveExistsForPath(normalizedRootPath);
  await fs.mkdir(normalizedRootPath, { recursive: true });
  return {
    workspaceRoot: normalizedRootPath,
  };
}

async function resolveWorkspaceFolderPath(folderPath) {
  const normalizedPath = normalizeWindowsPath(folderPath);
  if (!normalizedPath) {
    throw new Error("Missing workspace folder path.");
  }

  const { path: workspaceRoot } = await findWorkspaceRootByPath(normalizedPath);
  const stats = await fs.stat(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error("The selected workspace path is not a directory.");
  }

  return {
    normalizedPath,
    workspaceRoot,
  };
}

async function listWorkspaceFolders(rootPath) {
  const { workspaceRoot } = await ensureWorkspaceRoot(rootPath);
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  const folders = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const folderPath = path.win32.join(workspaceRoot, entry.name);
    let mtimeMs = 0;
    try {
      const stats = await fs.stat(folderPath);
      mtimeMs = stats.mtimeMs;
    } catch {}

    folders.push({
      name: entry.name,
      path: folderPath,
      mtimeMs,
    });
  }

  folders.sort((left, right) => {
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  });

  return {
    workspaceRoot,
    folders,
  };
}

function validateWorkspaceFolderName(inputName) {
  const folderName = typeof inputName === "string" ? inputName.trim() : "";
  if (!folderName) {
    return {
      ok: false,
      error: "Please enter a new workspace folder name.",
    };
  }

  if (/[<>:"/\\|?*\x00-\x1F]/.test(folderName)) {
    return {
      ok: false,
      error: 'Workspace folder names cannot contain <>:"/\\|?* or control characters.',
    };
  }

  if (folderName === "." || folderName === "..") {
    return {
      ok: false,
      error: "Workspace folder name is invalid.",
    };
  }

  if (/[. ]$/.test(folderName)) {
    return {
      ok: false,
      error: "Workspace folder names cannot end with a space or period.",
    };
  }

  if (RESERVED_WINDOWS_NAMES.has(folderName.toUpperCase())) {
    return {
      ok: false,
      error: "Workspace folder name cannot use a reserved Windows name.",
    };
  }

  return {
    ok: true,
    folderName,
  };
}

async function createWorkspaceFolder(rootPath, inputName) {
  const { workspaceRoot } = await ensureWorkspaceRoot(rootPath);
  const validation = validateWorkspaceFolderName(inputName);
  if (!validation.ok) {
    return validation;
  }

  const folderPath = path.win32.join(workspaceRoot, validation.folderName);
  try {
    await fs.mkdir(folderPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return {
        ok: false,
        error: "That workspace folder already exists.",
      };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    name: validation.folderName,
    path: folderPath,
  };
}

function validateWorkspaceFileName(inputName) {
  const fileName = typeof inputName === "string" ? inputName.trim() : "";
  if (!fileName) {
    return {
      ok: false,
      error: "File name cannot be empty.",
    };
  }

  if (/[<>:"/\\|?*\x00-\x1F]/.test(fileName)) {
    return {
      ok: false,
      error: 'File names cannot contain <>:"/\\|?* or control characters.',
    };
  }

  if (/[. ]$/.test(fileName)) {
    return {
      ok: false,
      error: "File names cannot end with a space or period.",
    };
  }

  if (RESERVED_WINDOWS_NAMES.has(fileName.split(".")[0].toUpperCase())) {
    return {
      ok: false,
      error: "File name cannot use a reserved Windows name.",
    };
  }

  return {
    ok: true,
    fileName,
  };
}

async function listWorkspaceEntries(folderPath) {
  const { normalizedPath } = await resolveWorkspaceFolderPath(folderPath);
  const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const entryPath = path.win32.join(normalizedPath, entry.name);
    let stats = null;
    try {
      stats = await fs.stat(entryPath);
    } catch {}

    results.push({
      name: entry.name,
      path: entryPath,
      kind: "file",
      size: stats?.size ?? 0,
      mtimeMs: stats?.mtimeMs ?? 0,
    });
  }

  results.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  return {
    ok: true,
    folderPath: normalizedPath,
    entries: results,
  };
}

async function uploadWorkspaceFile(folderPath, fileName, readable) {
  const { normalizedPath } = await resolveWorkspaceFolderPath(folderPath);
  const validation = validateWorkspaceFileName(fileName);
  if (!validation.ok) {
    return validation;
  }

  const targetPath = path.win32.join(normalizedPath, validation.fileName);
  const tempDir = path.win32.join(normalizedPath, `.workbuddy-upload-${randomUUID()}`);
  const tempPath = path.win32.join(tempDir, "payload");

  await fs.mkdir(tempDir);
  try {
    await pipeline(readable, createWriteStream(tempPath, { flags: "wx" }));
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  await fs.rmdir(tempDir).catch(() => {});
  return {
    ok: true,
    path: targetPath,
    name: validation.fileName,
  };
}

async function deleteWorkspaceEntry(targetPath) {
  const normalizedPath = normalizeWindowsPath(targetPath);
  if (!normalizedPath) {
    return {
      ok: false,
      error: "Missing path to delete.",
    };
  }

  const { path: workspaceRoot } = await findWorkspaceRootByPath(normalizedPath);
  if (normalizedPath.toLowerCase() === workspaceRoot.toLowerCase()) {
    return {
      ok: false,
      error: "Only files inside allowed workspace roots can be deleted.",
    };
  }

  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) {
    return {
      ok: false,
      error: "Only files can be deleted from the file manager right now.",
    };
  }

  await fs.rm(normalizedPath, { force: false });
  return {
    ok: true,
    path: normalizedPath,
  };
}

async function resolveWorkspaceFilePath(targetPath) {
  const normalizedPath = normalizeWindowsPath(targetPath);
  if (!normalizedPath) {
    throw new Error("Missing target file path.");
  }

  const { path: workspaceRoot } = await findWorkspaceRootByPath(normalizedPath);
  if (normalizedPath.toLowerCase() === workspaceRoot.toLowerCase()) {
    throw new Error("Only files inside allowed workspace roots can be downloaded.");
  }

  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) {
    throw new Error("The selected path is not a file.");
  }

  return {
    normalizedPath,
    stats,
  };
}

export {
  listAvailableWorkspaceRoots,
  listWorkspaceFolders,
  createWorkspaceFolder,
  listWorkspaceEntries,
  uploadWorkspaceFile,
  deleteWorkspaceEntry,
  resolveWorkspaceFilePath,
};
