import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { normalizePortablePath } from "../core/paths.js";

export type WriteGuardReason =
  | "allowed"
  | "invalid-path"
  | "outside-project"
  | "symlink-escape"
  | "protected-path"
  | "outside-write-scope";

export interface WriteGuardInput {
  root: string;
  cwd: string;
  candidate: string;
  writeScopes: readonly string[];
  protectedPaths: readonly string[];
}

export interface WriteGuardDecision {
  allowed: boolean;
  relativePath?: string;
  reason: WriteGuardReason;
}

function key(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function containsPath(parent: string, candidate: string): boolean {
  const normalizedParent = key(parent);
  const normalizedCandidate = key(candidate);
  return normalizedParent === "." || normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

function relativeInside(root: string, candidate: string): string | undefined {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return normalizePortablePath(relative.length === 0 ? "." : relative);
}

async function nearestRealTarget(candidate: string): Promise<string> {
  let cursor = candidate;
  const missing: string[] = [];
  while (true) {
    try {
      await lstat(cursor);
      const resolved = await realpath(cursor);
      return path.resolve(resolved, ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

export async function evaluateWritePath(input: WriteGuardInput): Promise<WriteGuardDecision> {
  if (typeof input.candidate !== "string" || input.candidate.length === 0 || input.candidate.includes("\0")) {
    return { allowed: false, reason: "invalid-path" };
  }
  const lexicalRoot = path.resolve(input.root);
  const lexicalCandidate = path.isAbsolute(input.candidate)
    ? path.resolve(input.candidate)
    : path.resolve(input.cwd, input.candidate);
  const lexicalRelative = relativeInside(lexicalRoot, lexicalCandidate);
  if (lexicalRelative === undefined) return { allowed: false, reason: "outside-project" };

  try {
    const [resolvedRoot, resolvedCandidate] = await Promise.all([realpath(lexicalRoot), nearestRealTarget(lexicalCandidate)]);
    if (relativeInside(resolvedRoot, resolvedCandidate) === undefined) {
      return { allowed: false, relativePath: lexicalRelative, reason: "symlink-escape" };
    }
  } catch {
    return { allowed: false, relativePath: lexicalRelative, reason: "invalid-path" };
  }

  const writeScopes = input.writeScopes.map(normalizePortablePath);
  const protectedPaths = input.protectedPaths.map(normalizePortablePath);
  if (protectedPaths.some((protectedPath) => containsPath(protectedPath, lexicalRelative))) {
    return { allowed: false, relativePath: lexicalRelative, reason: "protected-path" };
  }
  if (!writeScopes.some((scope) => containsPath(scope, lexicalRelative))) {
    return { allowed: false, relativePath: lexicalRelative, reason: "outside-write-scope" };
  }
  return { allowed: true, relativePath: lexicalRelative, reason: "allowed" };
}
