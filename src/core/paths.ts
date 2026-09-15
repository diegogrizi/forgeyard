import path from "node:path";

import { ForgeyardError } from "./errors.js";

function unsafe(candidate: string, message: string): never {
  throw new ForgeyardError({
    code: "FY_PATH_UNSAFE",
    message,
    remediation: "Use a project-relative path without traversal or aliases.",
    exitCode: 4,
    paths: [candidate],
  });
}

export function normalizePortablePath(candidate: string): string {
  if (candidate.length === 0 || candidate.includes("\0")) {
    return unsafe(candidate, "The path is empty or contains a NUL character.");
  }

  const slashPath = candidate.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(slashPath) ||
    path.win32.isAbsolute(candidate) ||
    /^[A-Za-z]:/.test(slashPath) ||
    slashPath.startsWith("//")
  ) {
    return unsafe(candidate, "Absolute and network paths are not portable project paths.");
  }

  const segments = slashPath.split("/");
  if (segments.some((segment) => segment === "..")) {
    return unsafe(candidate, "Parent traversal is not allowed in project paths.");
  }
  if (segments.some((segment, index) => segment.length === 0 && index !== segments.length - 1)) {
    return unsafe(candidate, "Empty path segments are not allowed.");
  }

  const normalized = segments.filter((segment) => segment !== "." && segment !== "").join("/");
  return normalized.length === 0 ? "." : normalized;
}

export function resolveInsideRoot(root: string, candidate: string): string {
  const absoluteRoot = path.resolve(root);
  const portable = normalizePortablePath(candidate);
  const resolved = portable === "." ? absoluteRoot : path.resolve(absoluteRoot, ...portable.split("/"));
  const relative = path.relative(absoluteRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return unsafe(candidate, "The resolved path escapes the selected project root.");
  }

  return resolved;
}

export function assertNoCaseCollisions(candidates: readonly string[]): void {
  const seen = new Map<string, string>();
  for (const candidate of candidates) {
    const portable = normalizePortablePath(candidate);
    const key = portable.normalize("NFKC").toLocaleLowerCase("en-US");
    const prior = seen.get(key);
    if (prior !== undefined && prior !== portable) {
      throw new ForgeyardError({
        code: "FY_PATH_UNSAFE",
        message: "Two paths collide on a case-insensitive filesystem.",
        remediation: "Choose target paths that differ by more than letter case.",
        exitCode: 4,
        paths: [prior, portable],
      });
    }
    seen.set(key, portable);
  }
}
