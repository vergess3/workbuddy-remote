import path from "node:path";
import { createReadStream, promises as fs } from "node:fs";

const PICKLE_HEADER_BYTES = 16;

function normalizeArchivePath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid archive path");
  }
  return parts.join("/");
}

class AsarArchive {
  constructor(archivePath) {
    this.archivePath = archivePath;
    this.unpackedRoot = `${archivePath}.unpacked`;
    this.header = null;
    this.dataOffset = 0;
    this.archiveStats = null;
  }

  async load() {
    const stats = await fs.stat(this.archivePath);
    if (
      this.header &&
      this.archiveStats?.size === stats.size &&
      this.archiveStats?.mtimeMs === stats.mtimeMs
    ) {
      return;
    }

    const handle = await fs.open(this.archivePath, "r");
    try {
      const prefix = Buffer.alloc(PICKLE_HEADER_BYTES);
      await handle.read(prefix, 0, prefix.length, 0);
      const headerSize = prefix.readUInt32LE(4);
      const stringLength = prefix.readUInt32LE(12);
      const headerBuffer = Buffer.alloc(stringLength);
      await handle.read(headerBuffer, 0, headerBuffer.length, PICKLE_HEADER_BYTES);
      this.header = JSON.parse(headerBuffer.toString("utf8"));
      this.dataOffset = 8 + headerSize;
      this.archiveStats = stats;
    } finally {
      await handle.close();
    }
  }

  async getNode(relativePath) {
    await this.load();
    const normalized = normalizeArchivePath(relativePath);
    let node = this.header;
    for (const part of normalized.split("/").filter(Boolean)) {
      node = node?.files?.[part];
      if (!node) {
        return null;
      }
    }
    return node;
  }

  async statFile(relativePath) {
    const normalized = normalizeArchivePath(relativePath);
    const node = await this.getNode(normalized);
    if (!node || node.files || typeof node.size !== "number") {
      return null;
    }

    return {
      relativePath: normalized,
      unpackedPath: node.unpacked ? path.join(this.unpackedRoot, normalized) : "",
      offset: node.offset ? this.dataOffset + Number(node.offset) : 0,
      size: node.size,
      mtime: this.archiveStats.mtime,
      mtimeMs: this.archiveStats.mtimeMs,
      etag: `W/"asar-${this.archiveStats.size}-${Math.trunc(this.archiveStats.mtimeMs)}-${normalized}-${node.size}"`,
    };
  }

  async readFile(relativePath) {
    const info = await this.statFile(relativePath);
    if (!info) {
      return null;
    }
    if (info.unpackedPath) {
      return fs.readFile(info.unpackedPath);
    }

    const handle = await fs.open(this.archivePath, "r");
    try {
      const buffer = Buffer.alloc(info.size);
      await handle.read(buffer, 0, buffer.length, info.offset);
      return buffer;
    } finally {
      await handle.close();
    }
  }

  createReadStream(info) {
    if (info.unpackedPath) {
      return createReadStream(info.unpackedPath);
    }
    return createReadStream(this.archivePath, {
      start: info.offset,
      end: info.offset + info.size - 1,
    });
  }
}

export { AsarArchive, normalizeArchivePath };
