import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { createInterface } from "node:readline";

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const discoverJsonlFiles = async (
  roots: readonly string[],
  include: (path: string) => boolean = () => true,
): Promise<Array<{ path: string; mtimeMs: number; size: number }>> => {
  const files: Array<{ path: string; mtimeMs: number; size: number }> = [];
  const pending = [...roots];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(child);
      } else if (entry.isFile() && extname(entry.name) === ".jsonl" && include(child)) {
        const fileStat = await stat(child);
        files.push({ path: child, mtimeMs: fileStat.mtimeMs, size: fileStat.size });
      }
    }
  }

  return files;
};

export const discoverFiles = async (
  roots: readonly string[],
  include: (path: string) => boolean,
): Promise<Array<{ path: string; mtimeMs: number; size: number }>> => {
  const files: Array<{ path: string; mtimeMs: number; size: number }> = [];
  const pending = [...roots];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile() && include(child)) {
        const fileStat = await stat(child);
        files.push({ path: child, mtimeMs: fileStat.mtimeMs, size: fileStat.size });
      }
    }
  }
  return files;
};

export const readJsonl = async (
  path: string,
  onRecord: (record: unknown, lineIndex: number) => void,
): Promise<void> => {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let lineIndex = 0;

  for await (const line of lines) {
    if (line.trim() === "") continue;
    try {
      onRecord(JSON.parse(line), lineIndex);
    } catch {
      // A partially-written or newer unsupported record must not hide the rest of the session.
    }
    lineIndex += 1;
  }
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const stringValue = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const compactTitle = (value: string, maxLength = 100): string => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
};
