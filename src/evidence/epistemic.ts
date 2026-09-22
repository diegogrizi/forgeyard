import { ForgeyardError } from "../core/errors.js";
import { normalizePortablePath } from "../core/paths.js";

export type EvidenceLevel = "executed" | "observed" | "derived" | "asserted";

export interface ExecutedEvidence {
  level: "executed";
  /** Frozen gate identifier that ran. */
  gateId: string;
  /** Digest of the canonical JSON of the exact argv array. */
  argvSha256: string;
  exitCode: number;
  /** Digest of the inputs or tree as they stood at run time. */
  inputSha256: string;
  at: string;
}

export interface ObservedEvidence {
  level: "observed";
  /** Project-relative portable path of the read source. */
  path: string;
  /** Digest of the bytes that were read. */
  sha256: string;
  /** Optional human locator inside the source, such as "L10-L24". */
  locator?: string;
  at: string;
}

export interface DerivedEvidence {
  level: "derived";
  /** Claim identifiers this inference rests on. */
  from: readonly string[];
  /** Short inspectable reason for the inference. */
  rule: string;
}

export interface AssertedEvidence {
  level: "asserted";
  origin: "model-prose";
}

export type Evidence = ExecutedEvidence | ObservedEvidence | DerivedEvidence | AssertedEvidence;

export interface Claim {
  id: string;
  statement: string;
  evidence: Evidence;
}

export interface VerdictCertification {
  certifiable: boolean;
  /** Weakest effectiveLevel among supporting claims — null when supportingIds is empty. */
  weakestLevel: EvidenceLevel | null;
  /** Weakest grounding of the whole support set: what the verdict ultimately rests on. */
  weakestGrounding: "executed" | "observed" | null;
  blocking: readonly { id: string; level: EvidenceLevel; reason: string }[];
}

/** Higher rank binds harder. Prose ranks zero, so it can never carry a verdict. */
export const EVIDENCE_RANK: Readonly<Record<EvidenceLevel, number>> = Object.freeze({
  executed: 3,
  observed: 2,
  derived: 1,
  asserted: 0,
});

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const INSTANT_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAXIMUM_STATEMENT = 2000;
const MAXIMUM_RULE = 500;
const MAXIMUM_SOURCES = 16;
const MAXIMUM_DEPTH = 8;
const MAXIMUM_GATE_ID = 128;
const MAXIMUM_LOCATOR = 256;
const MAXIMUM_PATH = 1024;

function invalid(message: string, claimIds?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CLAIM_INVALID",
    message,
    remediation: "Restate the claim so its evidence cites executed gates or observed bytes.",
    exitCode: 2,
    ...(claimIds === undefined ? {} : { components: claimIds }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function assertDigest(value: string, subject: string, id: string): void {
  if (!DIGEST_PATTERN.test(value)) {
    throw invalid(`Claim "${id}" carries a ${subject} that is not a lowercase sha256 digest.`, [id]);
  }
}

function assertInstant(value: string, id: string): void {
  if (!INSTANT_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw invalid(`Claim "${id}" carries a timestamp that is not an ISO-8601 UTC instant with milliseconds.`, [id]);
  }
}

function assertBounded(value: string, maximum: number, subject: string, id: string): void {
  if (value.length === 0 || value.length > maximum) {
    throw invalid(`Claim "${id}" carries an empty or oversized ${subject}.`, [id]);
  }
}

function assertObservedPath(candidate: string, id: string): void {
  assertBounded(candidate, MAXIMUM_PATH, "observed path", id);
  try {
    normalizePortablePath(candidate);
  } catch (error) {
    throw invalid(`Claim "${id}" observes a path that is not a portable project path.`, [id], error);
  }
}

function assertEvidence(claim: Claim): void {
  const { id, evidence } = claim;
  if (evidence.level === "executed") {
    assertBounded(evidence.gateId, MAXIMUM_GATE_ID, "gate identifier", id);
    assertDigest(evidence.argvSha256, "argv digest", id);
    assertDigest(evidence.inputSha256, "input digest", id);
    if (!Number.isInteger(evidence.exitCode)) {
      throw invalid(`Claim "${id}" carries an exit code that is not an integer.`, [id]);
    }
    assertInstant(evidence.at, id);
    return;
  }
  if (evidence.level === "observed") {
    assertObservedPath(evidence.path, id);
    assertDigest(evidence.sha256, "content digest", id);
    if (evidence.locator !== undefined) assertBounded(evidence.locator, MAXIMUM_LOCATOR, "locator", id);
    assertInstant(evidence.at, id);
    return;
  }
  if (evidence.level === "derived") {
    assertBounded(evidence.rule, MAXIMUM_RULE, "inference rule", id);
    if (evidence.from.length === 0 || evidence.from.length > MAXIMUM_SOURCES) {
      throw invalid(`Claim "${id}" derives from no source, or from more than ${MAXIMUM_SOURCES}.`, [id]);
    }
    if (new Set(evidence.from).size !== evidence.from.length) {
      throw invalid(`Claim "${id}" cites the same source twice.`, [id]);
    }
  }
}

/**
 * Depth counts the derived links above the nearest executed or observed base: a claim
 * derived straight from an observation has depth one. Non-derived claims have depth zero.
 */
function assertChains(byId: ReadonlyMap<string, Claim>): void {
  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) throw invalid(`Claim "${id}" takes part in a circular derivation.`, [id]);
    const evidence = byId.get(id)!.evidence;
    if (evidence.level !== "derived") {
      depths.set(id, 0);
      return 0;
    }
    visiting.add(id);
    let deepest = 0;
    for (const source of evidence.from) deepest = Math.max(deepest, depthOf(source));
    visiting.delete(id);
    const depth = deepest + 1;
    if (depth > MAXIMUM_DEPTH) {
      throw invalid(`Claim "${id}" sits on a derivation chain deeper than ${MAXIMUM_DEPTH} links.`, [id]);
    }
    depths.set(id, depth);
    return depth;
  };

  for (const id of byId.keys()) depthOf(id);
}

/**
 * Rejects a claim set that cannot be audited. A surviving set has unique bounded
 * identifiers, re-checkable digests and timestamps, and derivation chains that are
 * acyclic, bounded in depth, and grounded on observed or executed evidence, because
 * asserted prose is never citable. Failures carry FY_CLAIM_INVALID.
 */
export function validateClaims(claims: readonly Claim[]): void {
  const byId = new Map<string, Claim>();
  for (const claim of claims) {
    if (!ID_PATTERN.test(claim.id)) {
      throw invalid(`Claim identifier "${claim.id}" is not a bounded alphanumeric token.`);
    }
    if (byId.has(claim.id)) throw invalid(`Claim identifier "${claim.id}" is declared twice.`, [claim.id]);
    if (claim.statement.trim().length === 0 || claim.statement.length > MAXIMUM_STATEMENT) {
      throw invalid(`Claim "${claim.id}" carries an empty or oversized statement.`, [claim.id]);
    }
    assertEvidence(claim);
    byId.set(claim.id, claim);
  }

  for (const claim of claims) {
    if (claim.evidence.level !== "derived") continue;
    for (const source of claim.evidence.from) {
      const cited = byId.get(source);
      if (cited === undefined) {
        throw invalid(`Claim "${claim.id}" derives from undeclared claim "${source}".`, [claim.id, source]);
      }
      if (EVIDENCE_RANK[cited.evidence.level] === EVIDENCE_RANK.asserted) {
        throw invalid(`Claim "${claim.id}" derives from model prose in claim "${source}".`, [claim.id, source]);
      }
    }
  }

  assertChains(byId);
}

/** Claim lookup that fails closed: an identifier outside the set is a programming error. */
function index(claims: readonly Claim[]): (id: string) => Claim {
  const byId = new Map(claims.map((claim) => [claim.id, claim] as const));
  return (id) => {
    const claim = byId.get(id);
    if (claim === undefined) throw invalid(`Claim "${id}" is not part of the evaluated claim set.`, [id]);
    return claim;
  };
}

/**
 * The declared level of a claim. An inference is never promoted to the level of its
 * sources: a derivation from two executed gates is still a derivation, not an execution.
 * What the chain rests on is reported by groundingLevel instead.
 */
export function effectiveLevel(claims: readonly Claim[], id: string): EvidenceLevel {
  return index(claims)(id).evidence.level;
}

/** Memoized grounding resolver: a chain is only as strong as its weakest link. */
function groundings(at: (id: string) => Claim): (id: string) => "executed" | "observed" {
  const resolved = new Map<string, "executed" | "observed">();
  const visiting = new Set<string>();

  const resolve = (id: string): "executed" | "observed" => {
    const known = resolved.get(id);
    if (known !== undefined) return known;
    const evidence = at(id).evidence;
    if (evidence.level === "executed" || evidence.level === "observed") {
      resolved.set(id, evidence.level);
      return evidence.level;
    }
    if (evidence.level === "asserted") {
      throw invalid(`Claim "${id}" is model prose, which rests on no evidence at all.`, [id]);
    }
    if (visiting.has(id)) throw invalid(`Claim "${id}" takes part in a circular derivation.`, [id]);
    if (evidence.from.length === 0) throw invalid(`Claim "${id}" derives from no source.`, [id]);
    visiting.add(id);
    let weakest: "executed" | "observed" = "executed";
    for (const source of evidence.from) {
      const grounding = resolve(source);
      if (EVIDENCE_RANK[grounding] < EVIDENCE_RANK[weakest]) weakest = grounding;
    }
    visiting.delete(id);
    resolved.set(id, weakest);
    return weakest;
  };

  return resolve;
}

/**
 * The strongest evidence a claim ultimately rests on: for a derivation, the weakest link
 * of its chain. Asking it of asserted prose is a programming error, because prose has no
 * grounding. Assumes a claim set that already passed validateClaims.
 */
export function groundingLevel(claims: readonly Claim[], id: string): "executed" | "observed" {
  return groundings(index(claims))(id);
}

/**
 * Decides whether a delivery verdict may be emitted. Prose cannot support a verdict; a
 * grounded inference can. Support that is absent is not support: an empty set is never
 * certifiable, and it has no grounding to report.
 */
export function certifyVerdict(
  claims: readonly Claim[],
  supportingIds: readonly string[],
): VerdictCertification {
  const at = index(claims);
  const groundOf = groundings(at);
  const supports = [...new Set(supportingIds)];
  const blocking: { id: string; level: EvidenceLevel; reason: string }[] = [];
  let weakestLevel: EvidenceLevel | null = null;

  for (const id of supports) {
    const level = at(id).evidence.level;
    if (weakestLevel === null || EVIDENCE_RANK[level] < EVIDENCE_RANK[weakestLevel]) weakestLevel = level;
    if (EVIDENCE_RANK[level] === EVIDENCE_RANK.asserted) {
      blocking.push({ id, level, reason: "Asserted model prose cannot support a delivery verdict." });
    }
  }

  const certifiable = supports.length > 0 && blocking.length === 0;
  let weakestGrounding: "executed" | "observed" | null = null;
  if (certifiable) {
    for (const id of supports) {
      const grounding = groundOf(id);
      if (weakestGrounding === null || EVIDENCE_RANK[grounding] < EVIDENCE_RANK[weakestGrounding]) {
        weakestGrounding = grounding;
      }
    }
  }

  return { certifiable, weakestLevel, weakestGrounding, blocking };
}

/** Counts the claim set by effective level. */
export function summarizeEvidence(claims: readonly Claim[]): Readonly<Record<EvidenceLevel, number>> {
  const totals: Record<EvidenceLevel, number> = { executed: 0, observed: 0, derived: 0, asserted: 0 };
  for (const claim of claims) totals[claim.evidence.level] += 1;
  return Object.freeze(totals);
}
