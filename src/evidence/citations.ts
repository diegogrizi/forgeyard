import path from "node:path";

import { ForgeyardError } from "../core/errors.js";
import { sha256Bytes } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";
import { regularBytes } from "../native/files.js";

export interface Citation {
  /** Project-relative portable path of the cited source. */
  path: string;
  /** Digest the citing claim recorded for the bytes of that source. */
  sha256: string;
  /** Optional human locator inside the source, such as "L10-L24". */
  locator?: string;
}

export type CitationStatus = "live" | "stale" | "missing";

export interface CitationCheck {
  citation: Citation;
  status: CitationStatus;
  /** Present only when the source still exists but no longer hashes to the cited digest. */
  currentSha256?: string;
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_PATH = 1024;
const MAXIMUM_LOCATOR = 256;

/**
 * Failures that mean "this is not the bounded regular file the citation claims", whether
 * the source is gone, is a directory, exceeds the limit, or is only reachable through a
 * symbolic link. Anything else is an internal fault and stays an exception.
 */
const ABSENT_CODES: ReadonlySet<string> = new Set([
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "ELOOP",
  "EACCES",
  "EPERM",
  "ENAMETOOLONG",
  "FY_PATH_UNSAFE",
  "FY_INPUT_UNSAFE",
  "FY_INPUT_LIMIT",
]);

function uncitable(message: string, citationPath: string, cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CITATION_INVALID",
    message,
    remediation: "Cite a bounded project-relative path with the lowercase sha256 of its bytes.",
    exitCode: 2,
    paths: [citationPath],
    ...(cause === undefined ? {} : { cause }),
  });
}

function assertCitable(root: string, citation: Citation): void {
  if (citation.path.length === 0 || citation.path.length > MAXIMUM_PATH) {
    throw uncitable("A citation carries an empty or oversized path.", citation.path);
  }
  if (!DIGEST_PATTERN.test(citation.sha256)) {
    throw uncitable("A citation carries a digest that is not a lowercase sha256.", citation.path);
  }
  if (citation.locator !== undefined && (citation.locator.length === 0 || citation.locator.length > MAXIMUM_LOCATOR)) {
    throw uncitable("A citation carries an empty or oversized locator.", citation.path);
  }
  try {
    resolveInsideRoot(root, citation.path);
  } catch (error) {
    throw uncitable("A citation path is not a portable path inside the project root.", citation.path, error);
  }
}

function absent(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && ABSENT_CODES.has(code);
}

/**
 * Recomputes the liveness of every citation without re-running anything. The whole batch
 * is checked for citability first, so a programming error never hides behind a result.
 * Symbolic links are never followed and paths never leave the root. Output order follows
 * input order; duplicates are checked twice, on purpose.
 */
export async function checkCitations(
  root: string,
  citations: readonly Citation[],
  maximumBytes = 1_048_576,
): Promise<readonly CitationCheck[]> {
  const absoluteRoot = path.resolve(root);
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
    throw uncitable("The citation byte limit must be a positive integer.", absoluteRoot);
  }
  for (const citation of citations) assertCitable(absoluteRoot, citation);

  const checks: CitationCheck[] = [];
  for (const citation of citations) {
    let bytes: Uint8Array;
    try {
      bytes = await regularBytes(absoluteRoot, citation.path, maximumBytes);
    } catch (error) {
      if (!absent(error)) throw error;
      checks.push({ citation, status: "missing" });
      continue;
    }
    const currentSha256 = sha256Bytes(bytes);
    checks.push(
      currentSha256 === citation.sha256
        ? { citation, status: "live" }
        : { citation, status: "stale", currentSha256 },
    );
  }
  return checks;
}

/** Refuses to proceed while any cited source is stale or missing. */
export function assertCitationsLive(checks: readonly CitationCheck[]): void {
  const broken = checks.filter((check) => check.status !== "live");
  if (broken.length === 0) return;
  throw new ForgeyardError({
    code: "FY_CITATION_STALE",
    message: `${broken.length} cited source${broken.length === 1 ? "" : "s"} no longer match the claims that cite them.`,
    remediation: "Re-read the cited sources and restate the claims before emitting a verdict.",
    exitCode: 9,
    paths: broken.map((check) => check.citation.path),
  });
}
