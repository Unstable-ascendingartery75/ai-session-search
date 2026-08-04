import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { createInterface } from "node:readline";

export const FILE_IO_CONCURRENCY = 16;

export const mapWithConcurrency = async <Input, Output>(
  items: readonly Input[],
  concurrency: number,
  task: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> => {
  if (items.length === 0) return [];
  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await task(item, index);
    }
  };
  const workers = Array.from(
    { length: Math.min(Math.max(Math.trunc(concurrency), 1), items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
};

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const discoverMatchingFiles = async (
  roots: readonly string[],
  include: (path: string) => boolean,
): Promise<Array<{ path: string; mtimeMs: number; size: number }>> => {
  let directories = [...roots].sort();
  const paths: string[] = [];
  while (directories.length > 0) {
    const directoryEntries = await mapWithConcurrency(
      directories,
      FILE_IO_CONCURRENCY,
      async (directory) => {
        try {
          return { directory, entries: await readdir(directory, { withFileTypes: true }) };
        } catch {
          return { directory, entries: [] };
        }
      },
    );
    const nextDirectories: string[] = [];
    for (const { directory, entries } of directoryEntries) {
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink()) continue;
        const child = join(directory, entry.name);
        if (entry.isDirectory()) nextDirectories.push(child);
        else if (entry.isFile() && include(child)) paths.push(child);
      }
    }
    directories = nextDirectories.sort();
  }

  const files = await mapWithConcurrency(paths.sort(), FILE_IO_CONCURRENCY, async (path) => {
    try {
      const fileStat = await stat(path);
      return { path, mtimeMs: fileStat.mtimeMs, size: fileStat.size };
    } catch {
      return null;
    }
  });
  return files.filter((file) => file !== null);
};

export const discoverJsonlFiles = async (
  roots: readonly string[],
  include: (path: string) => boolean = () => true,
): Promise<Array<{ path: string; mtimeMs: number; size: number }>> =>
  discoverMatchingFiles(roots, (path) => extname(path) === ".jsonl" && include(path));

export const discoverFiles = async (
  roots: readonly string[],
  include: (path: string) => boolean,
): Promise<Array<{ path: string; mtimeMs: number; size: number }>> =>
  discoverMatchingFiles(roots, include);

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

export const readFirstJsonlRecord = async (path: string): Promise<unknown | null> => {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) {
      if (line.trim() === "") continue;
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    lines.close();
    input.destroy();
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
