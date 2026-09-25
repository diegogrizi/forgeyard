import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import { canonicalJson, sha256Bytes, sha256Text } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";
import { memberRoot, namedMember, workspacePath } from "./members.js";
import { nativeError } from "./store.js";
import { regularBytes } from "./files.js";

export interface WorkspaceIdentity { root: string; commonDirectory: string | null; id: string }
export interface MemberSnapshot {
  head: string | null; clean: boolean; sha256: string; changedPaths: readonly string[];
}
export interface WorkspaceSnapshot {
  /** One entry per touched member, keyed by its path relative to the workspace root. */
  members: ReadonlyMap<string, MemberSnapshot>;
  /** Aggregate over the touched members only, so an unrelated member cannot invalidate a run. */
  sha256: string;
  clean: boolean;
  /** Workspace-relative, member prefix included. */
  changedPaths: readonly string[];
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

async function memberSnapshot(treeRoot: string): Promise<MemberSnapshot> {
  // Four independent reads of the same working tree. Serially they cost four process spawns,
  // about 850 ms each on Windows, on every protocol call; concurrently they cost one round
  // trip. `reject: false` keeps the failure handling below exactly where it was: a repository
  // without a HEAD still answers, and its answer is still discarded.
  const [headResult, status, changed, untracked] = await Promise.all([
    git(treeRoot, ["rev-parse", "--verify", "HEAD"]),
    git(treeRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(treeRoot, ["diff", "--name-only", "-z", "HEAD", "--"]),
    git(treeRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (headResult.exitCode !== 0 || status.exitCode !== 0) return { head: null, clean: false, sha256: "", changedPaths: [] };
  const head = headResult.stdout.trim();
  if (changed.exitCode !== 0 || untracked.exitCode !== 0) throw nativeError("FY_GIT_REQUIRED", "Unable to inspect verification inputs.");
  const changedPaths = [...new Set([...changed.stdout.split("\0"), ...untracked.stdout.split("\0")].filter(Boolean))].sort();
  const hashes: { path: string; sha256: string }[] = [];
  let totalBytes = 0;
  for (const relativePath of changedPaths) {
    const absolute = resolveInsideRoot(treeRoot, relativePath);
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
    hashes.push({ path: relativePath, sha256: sha256Bytes(await regularBytes(treeRoot, relativePath, 33_554_432 - totalBytes + stats.size)) });
  }
  return { head, clean: status.stdout.trim().length === 0, changedPaths,
    sha256: sha256Text(canonicalJson({ head, status: status.stdout, hashes })) };
}

/**
 * One snapshot per touched member, composed into one digest. The members run concurrently:
 * a second repository must not cost a second round trip in a row.
 */
export async function workspaceSnapshot(
  root: string,
  members: readonly string[] = ["."],
): Promise<WorkspaceSnapshot> {
  // Over no members this would answer `clean: true` by vacuity and a constant digest, so
  // every staleness comparison against it would pass forever. A caller with nothing to
  // photograph has a bug, and the invariant belongs here rather than in each caller's prose.
  if (members.length === 0) throw nativeError("FY_INTERNAL",
    "A workspace snapshot over no members would produce a digest that can never change.");
  const ordered = [...new Set(members)].sort((left, right) => left.localeCompare(right, "en"));
  const snapshots = await Promise.all(ordered.map(async (member) =>
    [member, await memberSnapshot(memberRoot(root, member))] as const));
  return {
    members: new Map(snapshots),
    clean: snapshots.every(([, snapshot]) => snapshot.clean),
    changedPaths: snapshots.flatMap(([member, snapshot]) =>
      snapshot.changedPaths.map((changed) => workspacePath(member, changed))),
    // Sorted member entries: the digest is a property of the set, not of the request order.
    sha256: sha256Text(canonicalJson(snapshots.map(([member, snapshot]) => ({ member, sha256: snapshot.sha256 })))),
  };
}

/**
 * The unclean members a reader can be sent to, in the map's own sorted order. The workspace root
 * is not among them — see `namedMember` — so this is empty exactly when the only dirty tree is
 * the single repository the caller is already standing in.
 */
export function namedUncleanMembers(snapshot: WorkspaceSnapshot): readonly string[] {
  return [...snapshot.members].filter(([member, state]) => !state.clean && namedMember(member) !== null)
    .map(([member]) => member);
}

/**
 * One gap per unclean member, because a gap is a thing to close and committing in one member has
 * to remove exactly one: a single gap listing them all would only disappear with the last of
 * them, hiding every step in between. `.` keeps today's exact string, and a named member is
 * appended to it, so `git:dirty-inputs` stays a prefix of the qualified form and a reader who
 * knows today's gap still recognizes tomorrow's.
 */
export function dirtyInputGaps(snapshot: WorkspaceSnapshot): readonly string[] {
  return [...snapshot.members].filter(([, state]) => !state.clean)
    .map(([member]) => namedMember(member) === null ? "git:dirty-inputs" : `git:dirty-inputs:${member}`);
}

/**
 * What a cleanliness refusal appends to say WHERE. Empty for a single-repository workspace: the
 * message already says where, because there is one place it can be. The wording follows the
 * refusal that names members with no commit, so the two read as one voice.
 */
export function uncleanMemberClause(snapshot: WorkspaceSnapshot): string {
  const named = namedUncleanMembers(snapshot);
  return named.length === 0 ? "" : ` These member repositories have uncommitted changes: ${named.join(", ")}.`;
}

/**
 * Paths changed since each member's own baseline, returned workspace-relative so a caller can
 * match them against write scopes without knowing which member they came from.
 */
export async function changedSince(
  root: string,
  baselines: Readonly<Record<string, string>>,
): Promise<readonly string[]> {
  const members = Object.keys(baselines).sort((left, right) => left.localeCompare(right, "en"));
  const current = await workspaceSnapshot(root, members);
  const perMember = await Promise.all(members.map(async (member) => {
    const committed = await git(memberRoot(root, member), ["diff", "--name-only", "-z", baselines[member]!, "HEAD", "--"]);
    if (committed.exitCode !== 0) throw nativeError("FY_GIT_REQUIRED", `The approved baseline for member '${member}' is unavailable.`);
    return committed.stdout.split("\0").filter(Boolean).map((changed) => workspacePath(member, changed));
  }));
  return [...new Set([...perMember.flat(), ...current.changedPaths])]
    .sort((left, right) => left.localeCompare(right, "en"));
}
