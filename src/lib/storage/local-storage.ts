import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider, StoredObject } from "./types";

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  private resolveKey(key: string) {
    const normalized = key.replace(/\\/g, "/");
    if (normalized.includes("..") || path.isAbsolute(normalized)) {
      throw new Error("Invalid storage key");
    }
    return path.join(this.root, normalized);
  }

  async put(input: { key: string; bytes: Uint8Array; contentType: string }) {
    const target = this.resolveKey(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.bytes);
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const bytes = await readFile(this.resolveKey(key));
      return { key, bytes, contentType: "application/octet-stream" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    await rm(this.resolveKey(key), { force: true });
  }
}
