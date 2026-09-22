import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { sha256Text } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";
import { nativeError } from "./store.js";

export async function assertDirectoryChain(directory: string, create = false): Promise<void> {
  const absolute = path.resolve(directory); const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const segment of path.relative(parsed.root, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stats = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined; throw error;
    });
    if (!stats && create) {
      // A concurrent creator winning the race is success, not a failure to report.
      await mkdir(cursor, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      stats = await lstat(cursor);
    }
    if (!stats || stats.isSymbolicLink() || !stats.isDirectory())
      throw nativeError("FY_PATH_UNSAFE", "An authorized directory is missing, non-regular or traverses a symbolic link.");
  }
}

export async function regularBytes(root: string, relative: string, maximum: number): Promise<Buffer> {
  const target = resolveInsideRoot(root, relative);
  await assertDirectoryChain(path.dirname(target));
  const stats = await lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > maximum)
    throw nativeError("FY_INPUT_UNSAFE", "The requested input is not a bounded regular file.");
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > maximum) throw nativeError("FY_INPUT_LIMIT", "The input exceeds its bounded size.");
    const buffer = Buffer.alloc(Math.min(maximum + 1, opened.size + 1)); let bytes = 0;
    while (bytes < buffer.length) {
      const result = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (result.bytesRead === 0) break; bytes += result.bytesRead;
    }
    if (bytes > maximum || bytes > opened.size) throw nativeError("FY_INPUT_LIMIT", "The input grew beyond its bounded size.");
    return buffer.subarray(0, bytes);
  } finally { await file.close(); }
}

export async function optionalText(target: string): Promise<string | null> {
  await assertDirectoryChain(path.dirname(target), true);
  const stats = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined; throw error;
  });
  if (!stats) return null;
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > 16_777_216)
    throw nativeError("FY_PATH_UNSAFE", "An owned artifact is not a bounded regular file.");
  return readFile(target, "utf8");
}

/** Compare, exclusive temporary creation, fsync, then rename. No overwrite on drift. */
export async function atomicText(target: string, content: string, expectedSha256: string | null): Promise<void> {
  const check = async () => {
    const current = await optionalText(target);
    if ((current === null ? null : sha256Text(current)) !== expectedSha256)
      throw nativeError("FY_ARTIFACT_DRIFT", "An artifact changed while preparing a local write; its bytes are preserved.");
  };
  await check(); const temporary = `${target}.tmp-${randomUUID()}`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
  try {
    await check();
    // On Windows a rename onto an existing path fails with EPERM/EACCES while another
    // process still holds a handle on it — an indexer or antivirus is enough, with no
    // concurrency of ours. Retrying is safe because every attempt re-checks the digest
    // of the bytes it would replace, so a drifted target still refuses the write.
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(temporary, target); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 4 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        await check();
      }
    }
  }
  finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
}
