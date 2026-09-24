import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import { canonicalJson, sha256Bytes, sha256Text } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";
import { nativeError } from "./store.js";
import { regularBytes } from "./files.js";

export interface WorkspaceIdentity { root: string; commonDirectory: string | null; id: string }
export interface WorkspaceSnapshot {
  head: string | null; clean: boolean; sha256: string; changedPaths: readonly string[];
}

async function git(root: string, args: readonly string[]) {
  return execa("git", [...args], { cwd: root, shell: false, reject: false, stdin: "ignore",
    timeout: 10000, maxBuffer: 1_048_576, env: { GIT_OPTIONAL_LOCKS: "0" } });
}

export async function workspaceIdentity(input: string): Promise<WorkspaceIdentity> {
  const rootStats = await lstat(path.resolve(input));
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw nativeError("FY_ROOT_UNSAFE", "The authorized root must be a regular directory.");
  const root = await realpath(path.resolve(input));
  // One spawn, not two: on Windows a `git` process costs about 850 ms, and this runs on every
  // protocol call. `rev-parse` answers both questions at once, in the order they are asked.
  const probe = await git(root, ["rev-parse", "--show-toplevel",
    "--path-format=absolute", "--git-common-dir"]);
  let commonDirectory: string | null = null;
  if (probe.exitCode === 0) {
    const lines = probe.stdout.split(String.fromCharCode(10)).map((line) => line.trim()).filter((line) => line.length > 0);
    // A working tree that answers one question and not the other is not a tree we can bind to.
    if (lines.length < 2) throw nativeError("FY_GIT_REQUIRED", "Unable to resolve this working tree's Git identity.");
    const [topLevel, common] = await Promise.all([realpath(lines[0]!), realpath(lines[1]!)]);
    const comparison = (value: string) => process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
    if (comparison(topLevel) !== comparison(root))
      throw nativeError("FY_ROOT_MISMATCH", "Select the actual Git working-tree root, not a nested folder.");
    commonDirectory = common;
  }
  return { root, commonDirectory, id: sha256Text(canonicalJson({ root, commonDirectory })) };
}

export async function workspaceSnapshot(root: string): Promise<WorkspaceSnapshot> {
  // Four independent reads of the same working tree. Serially they cost four process spawns,
  // about 850 ms each on Windows, on every protocol call; concurrently they cost one round
  // trip. `reject: false` keeps the failure handling below exactly where it was: a repository
  // without a HEAD still answers, and its answer is still discarded.
  const [headResult, status, changed, untracked] = await Promise.all([
    git(root, ["rev-parse", "--verify", "HEAD"]),
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(root, ["diff", "--name-only", "-z", "HEAD", "--"]),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (headResult.exitCode !== 0 || status.exitCode !== 0) return { head: null, clean: false, sha256: "", changedPaths: [] };
  const head = headResult.stdout.trim();
  if (changed.exitCode !== 0 || untracked.exitCode !== 0) throw nativeError("FY_GIT_REQUIRED", "Unable to inspect verification inputs.");
  const changedPaths = [...new Set([...changed.stdout.split("\0"), ...untracked.stdout.split("\0")].filter(Boolean))].sort();
  const hashes: { path: string; sha256: string }[] = [];
  let totalBytes = 0;
  for (const relativePath of changedPaths) {
    const absolute = resolveInsideRoot(root, relativePath);
    const stats = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stats) { hashes.push({ path: relativePath, sha256: "deleted" }); continue; }
    if (stats.isSymbolicLink() || !stats.isFile()) throw nativeError("FY_INPUT_UNSAFE", "Changed inputs include a non-regular path.");
    if (/(^|\/)(\.env(?:\..*)?|credentials[^/]*|auth\.json|.*\.(?:pem|key))$/i.test(relativePath))
      throw nativeError("FY_INPUT_UNSAFE", "Commit or remove unrelated private inputs before creating a governed run.");
    totalBytes += stats.size;
    if (totalBytes > 33_554_432 || changedPaths.length > 20000) throw nativeError("FY_INPUT_LIMIT", "Changed inputs exceed the bounded snapshot limit.");
    hashes.push({ path: relativePath, sha256: sha256Bytes(await regularBytes(root, relativePath, 33_554_432 - totalBytes + stats.size)) });
  }
  return { head, clean: status.stdout.trim().length === 0, changedPaths,
    sha256: sha256Text(canonicalJson({ head, status: status.stdout, hashes })) };
}

export async function changedSince(root: string, baseline: string): Promise<readonly string[]> {
  const committed = await git(root, ["diff", "--name-only", "-z", baseline, "HEAD", "--"]);
  const current = await workspaceSnapshot(root);
  if (committed.exitCode !== 0) throw nativeError("FY_GIT_REQUIRED", "The approved baseline is unavailable.");
  return [...new Set([...committed.stdout.split("\0").filter(Boolean), ...current.changedPaths])].sort();
}
