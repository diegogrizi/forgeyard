import { lstat } from "node:fs/promises";
import path from "node:path";

import { normalizePortablePath, resolveInsideRoot } from "../core/paths.js";
import { nativeError } from "./store.js";

/** True for a directory `.git` and for the `.git` file a linked worktree uses. */
async function isWorkingTree(directory: string): Promise<boolean> {
  try {
    await lstat(path.join(directory, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Which member repository owns this write scope. The service never runs discovery, so it does
 * not ask anyone: it observes. The walk starts at the nearest ancestor that exists on disk,
 * because a write scope may name a directory the work is about to create, and it stops at the
 * nearest working tree, because whoever owns a path is the tree containing it — and it is that
 * tree's HEAD that says whether the path changed.
 */
export async function memberForScope(root: string, scope: string): Promise<string> {
  const absoluteRoot = path.resolve(root);
  let cursor = resolveInsideRoot(absoluteRoot, scope);
  for (;;) {
    if (await isWorkingTree(cursor)) {
      const relative = path.relative(absoluteRoot, cursor);
      return relative.length === 0 ? "." : normalizePortablePath(relative);
    }
    if (cursor === absoluteRoot) {
      throw nativeError("FY_GIT_REQUIRED",
        `Write scope '${scope}' is not inside a Git working tree. A governed run binds its evidence to a revision, and this path has none.`);
    }
    cursor = path.dirname(cursor);
  }
}

/**
 * Where a member's working tree lives. The workspace root is itself the member ".", and that
 * equivalence is stated once: it is the rule two call sites in this codebase already drifted
 * apart on, each resolving the same path its own way.
 */
export function memberRoot(root: string, member: string): string {
  return member === "." ? root : path.join(root, member);
}

/** The mirror of `memberRoot` for paths: a member-relative path stated from the workspace. */
export function workspacePath(member: string, relativePath: string): string {
  return member === "." ? relativePath : `${member}/${relativePath}`;
}

/**
 * The member's name when it has one a reader needs, and `null` for the workspace root. Every gap
 * and every refusal message that names a member asks this first, because a single-repository
 * project must not learn a second grammar: there `.` is the only member there can be, so naming
 * it would add a word without adding an answer. Stated once, because it is the rule two grammars
 * — the gate gap's and the dirty-tree gap's — would otherwise each restate in their own way.
 */
export function namedMember(member: string | undefined): string | null {
  return member === undefined || member === "." ? null : member;
}

/** Ordered and deduplicated, so two reads of one plan produce one set. */
export async function touchedMembers(root: string, scopes: readonly string[]): Promise<readonly string[]> {
  const members = new Set<string>();
  for (const scope of scopes) members.add(await memberForScope(root, scope));
  return [...members].sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * The workspace-relative scopes that live in `member`, rewritten relative to that member's own
 * root so they can be used as pathspecs with its working tree as `cwd`. The root member owns
 * every scope: a nested member's tree does not show its own contents in the outer `git diff`
 * anyway, so keeping them costs nothing and losing them would widen the diff to the whole tree.
 */
export function scopesInMember(member: string, scopes: readonly string[]): readonly string[] {
  if (member === ".") return [...scopes];
  return scopes.filter((scope) => scope === member || scope.startsWith(`${member}/`))
    // Git rejects an empty pathspec, so a scope that is the member itself becomes ".".
    .map((scope) => scope === member ? "." : scope.slice(member.length + 1));
}
