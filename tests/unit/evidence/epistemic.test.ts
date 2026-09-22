import { describe, expect, test } from "vitest";

import {
  EVIDENCE_RANK,
  certifyVerdict,
  effectiveLevel,
  groundingLevel,
  summarizeEvidence,
  validateClaims,
  type AssertedEvidence,
  type Claim,
  type DerivedEvidence,
  type Evidence,
  type ExecutedEvidence,
  type ObservedEvidence,
} from "../../../src/evidence/epistemic.js";

const AT = "2026-09-15T12:00:00.000Z";
const DIGEST = `${"0".repeat(63)}1`;
const OTHER_DIGEST = "a".repeat(64);
const INVALID = expect.objectContaining({ code: "FY_CLAIM_INVALID", exitCode: 2 });

function executed(patch: Partial<ExecutedEvidence> = {}): ExecutedEvidence {
  return {
    level: "executed",
    gateId: "typecheck",
    argvSha256: DIGEST,
    exitCode: 0,
    inputSha256: OTHER_DIGEST,
    at: AT,
    ...patch,
  };
}

function observed(patch: Partial<ObservedEvidence> = {}): ObservedEvidence {
  return { level: "observed", path: "src/core/hash.ts", sha256: DIGEST, at: AT, ...patch };
}

function derived(from: readonly string[], patch: Partial<DerivedEvidence> = {}): DerivedEvidence {
  return { level: "derived", from, rule: "The gate covers the stated requirement.", ...patch };
}

function asserted(patch: Partial<AssertedEvidence> = {}): AssertedEvidence {
  return { level: "asserted", origin: "model-prose", ...patch };
}

function claim(id: string, evidence: Evidence, statement = `Statement of ${id}.`): Claim {
  return { id, statement, evidence };
}

/** An observed base plus `length` stacked derivations, each resting on the previous one. */
function chain(length: number): Claim[] {
  const claims: Claim[] = [claim("base", observed())];
  for (let index = 1; index <= length; index += 1) {
    claims.push(claim(`d${index}`, derived([index === 1 ? "base" : `d${index - 1}`])));
  }
  return claims;
}

/** One claim of every level, plus derivations over executed only and over a mixed pair. */
function mixedSet(): Claim[] {
  const claims = [
    claim("gate", executed()),
    claim("other-gate", executed({ gateId: "tests" })),
    claim("file", observed()),
    claim("prose", asserted()),
    claim("from-gates", derived(["gate", "other-gate"])),
    claim("from-mixed", derived(["gate", "file"])),
    claim("restated", derived(["from-gates"])),
  ];
  validateClaims(claims);
  return claims;
}

describe("epistemic scale", () => {
  test("ranks the levels so prose can never outrank an execution", () => {
    expect(EVIDENCE_RANK).toEqual({ executed: 3, observed: 2, derived: 1, asserted: 0 });
    expect(EVIDENCE_RANK.asserted).toBeLessThan(EVIDENCE_RANK.derived);
    expect(EVIDENCE_RANK.derived).toBeLessThan(EVIDENCE_RANK.observed);
    expect(EVIDENCE_RANK.observed).toBeLessThan(EVIDENCE_RANK.executed);
  });

  test("accepts a claim set whose derivations terminate on observed or executed evidence", () => {
    expect(() =>
      validateClaims([
        claim("gate-1", executed()),
        claim("file-1", observed({ locator: "L10-L24" })),
        claim("inference-1", derived(["gate-1", "file-1"])),
        claim("prose-1", asserted()),
      ]),
    ).not.toThrow();
  });

  test("rejects malformed identifiers, duplicates, and unusable statements", () => {
    expect(() => validateClaims([claim("-lead", observed())])).toThrow(INVALID);
    expect(() => validateClaims([claim("dotted.id", observed())])).toThrow(INVALID);
    expect(() => validateClaims([claim("", observed())])).toThrow(INVALID);
    expect(() => validateClaims([claim("a".repeat(65), observed())])).toThrow(INVALID);
    expect(() => validateClaims([claim("ok_id-1", observed())])).not.toThrow();
    expect(() => validateClaims([claim("twin", observed()), claim("twin", executed())])).toThrow(INVALID);
    expect(() => validateClaims([claim("blank", observed(), "   ")])).toThrow(INVALID);
    expect(() => validateClaims([claim("long", observed(), "x".repeat(2001))])).toThrow(INVALID);
    expect(() => validateClaims([claim("limit", observed(), "x".repeat(2000))])).not.toThrow();
  });

  test("rejects digests, timestamps, and exit codes that cannot be re-checked", () => {
    expect(() => validateClaims([claim("g", executed({ argvSha256: "ABC" }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("g", executed({ argvSha256: OTHER_DIGEST.toUpperCase() }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("g", executed({ inputSha256: "0".repeat(63) }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("g", executed({ exitCode: 1.5 }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("g", executed({ gateId: "" }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("g", executed({ at: "2026-09-15T12:00:00Z" }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("g", executed({ at: "2026-09-15T12:00:00.000+02:00" }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("g", executed({ at: "2026-13-15T12:00:00.000Z" }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("o", observed({ sha256: "zz" }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("o", observed({ path: "../outside.ts" }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("o", observed({ path: "/etc/passwd" }))])).toThrow(INVALID);
    expect(() => validateClaims([claim("o", observed({ locator: "x".repeat(257) }))])).toThrow(INVALID);
  });

  test("refuses an inference that rests on model prose", () => {
    expect(() =>
      validateClaims([claim("prose", asserted()), claim("inference", derived(["prose"]))]),
    ).toThrow(INVALID);
  });

  test("refuses an inference chain that reaches prose through another inference", () => {
    expect(() =>
      validateClaims([
        claim("prose", asserted()),
        claim("near", derived(["prose"])),
        claim("far", derived(["near"])),
      ]),
    ).toThrow(INVALID);
  });

  test("refuses an inference that cites a claim nobody declared", () => {
    expect(() => validateClaims([claim("inference", derived(["ghost"]))])).toThrow(INVALID);
  });

  test("bounds the citation list of an inference", () => {
    expect(() => validateClaims([claim("base", observed()), claim("d", derived([]))])).toThrow(INVALID);
    expect(() =>
      validateClaims([claim("base", observed()), claim("d", derived(["base", "base"]))]),
    ).toThrow(INVALID);
    const wide = Array.from({ length: 17 }, (_, index) => claim(`o${index}`, observed()));
    expect(() =>
      validateClaims([...wide, claim("d", derived(wide.map((source) => source.id)))]),
    ).toThrow(INVALID);
    expect(() =>
      validateClaims([...wide.slice(0, 16), claim("d", derived(wide.slice(0, 16).map((source) => source.id)))]),
    ).not.toThrow();
    expect(() => validateClaims([claim("base", observed()), claim("d", derived(["base"], { rule: "" }))])).toThrow(
      INVALID,
    );
    expect(() =>
      validateClaims([claim("base", observed()), claim("d", derived(["base"], { rule: "x".repeat(501) }))]),
    ).toThrow(INVALID);
  });

  test("refuses a circular derivation instead of recursing forever", () => {
    expect(() =>
      validateClaims([claim("left", derived(["right"])), claim("right", derived(["left"]))]),
    ).toThrow(INVALID);
    expect(() => validateClaims([claim("self", derived(["self"]))])).toThrow(INVALID);
  });

  test("refuses a derivation chain deeper than eight links", () => {
    expect(() => validateClaims(chain(8))).not.toThrow();
    expect(() => validateClaims(chain(9))).toThrow(INVALID);
  });

  test("never promotes a derivation to the level of its sources", () => {
    const claims = mixedSet();

    expect(effectiveLevel(claims, "gate")).toBe("executed");
    expect(effectiveLevel(claims, "file")).toBe("observed");
    expect(effectiveLevel(claims, "prose")).toBe("asserted");
    expect(effectiveLevel(claims, "from-gates")).toBe("derived");
    expect(effectiveLevel(claims, "from-mixed")).toBe("derived");
    expect(effectiveLevel(claims, "restated")).toBe("derived");
    expect(() => effectiveLevel(claims, "ghost")).toThrow(INVALID);
  });

  test("grounds a claim on the weakest link of its chain", () => {
    const claims = mixedSet();

    expect(groundingLevel(claims, "gate")).toBe("executed");
    expect(groundingLevel(claims, "file")).toBe("observed");
    expect(groundingLevel(claims, "from-gates")).toBe("executed");
    expect(groundingLevel(claims, "from-mixed")).toBe("observed");
    expect(groundingLevel(claims, "restated")).toBe("executed");
    expect(groundingLevel(chain(8), "d8")).toBe("observed");
  });

  test("refuses to ground model prose, which rests on nothing", () => {
    const claims = mixedSet();

    expect(() => groundingLevel(claims, "prose")).toThrow(INVALID);
    expect(() => groundingLevel(claims, "ghost")).toThrow(INVALID);
  });

  test("certifies a verdict supported only by grounded derivations", () => {
    const claims = mixedSet();

    expect(certifyVerdict(claims, ["from-gates"])).toEqual({
      certifiable: true,
      weakestLevel: "derived",
      weakestGrounding: "executed",
      blocking: [],
    });
    expect(certifyVerdict(claims, ["from-mixed"])).toEqual({
      certifiable: true,
      weakestLevel: "derived",
      weakestGrounding: "observed",
      blocking: [],
    });
    expect(certifyVerdict(claims, ["gate", "from-gates", "restated"])).toEqual({
      certifiable: true,
      weakestLevel: "derived",
      weakestGrounding: "executed",
      blocking: [],
    });
  });

  test("reports the grounding a stricter caller needs to demand an executed command", () => {
    const claims = mixedSet();

    expect(certifyVerdict(claims, ["gate", "other-gate"])).toEqual({
      certifiable: true,
      weakestLevel: "executed",
      weakestGrounding: "executed",
      blocking: [],
    });
    expect(certifyVerdict(claims, ["gate", "file"]).weakestGrounding).toBe("observed");
    expect(certifyVerdict(claims, ["gate", "from-mixed"]).weakestGrounding).toBe("observed");
  });

  test("blocks a verdict that leans on prose, and reports no grounding for it", () => {
    const claims = mixedSet();

    const certification = certifyVerdict(claims, ["gate", "from-gates", "prose"]);

    expect(certification.certifiable).toBe(false);
    expect(certification.weakestLevel).toBe("asserted");
    expect(certification.weakestGrounding).toBeNull();
    expect(certification.blocking).toEqual([
      { id: "prose", level: "asserted", reason: expect.any(String) },
    ]);
    expect(certification.blocking[0]?.reason.length).toBeGreaterThan(0);
  });

  test("treats an empty support set as uncertifiable, because absence of proof is not proof", () => {
    const claims = mixedSet();

    expect(certifyVerdict(claims, [])).toEqual({
      certifiable: false,
      weakestLevel: null,
      weakestGrounding: null,
      blocking: [],
    });
  });

  test("reports a repeated support once and rejects a support nobody declared", () => {
    const claims = mixedSet();

    expect(certifyVerdict(claims, ["prose", "prose"]).blocking).toHaveLength(1);
    expect(certifyVerdict(claims, ["gate", "gate"]).certifiable).toBe(true);
    expect(() => certifyVerdict(claims, ["ghost"])).toThrow(INVALID);
  });

  test("summarizes the claim set by effective level, counting grounded inferences as inferences", () => {
    const summary = summarizeEvidence(mixedSet());

    expect(summary).toEqual({ executed: 2, observed: 1, derived: 3, asserted: 1 });
    expect(summary.derived).toBeGreaterThan(0);
    expect(summarizeEvidence([])).toEqual({ executed: 0, observed: 0, derived: 0, asserted: 0 });
  });
});
