import { describe, expect, test } from "vitest";

import { ForgeyardError } from "../../../src/core/errors.js";
import { canonicalJson, sha256Text } from "../../../src/core/hash.js";
import type { Capsule } from "../../../src/capsule/capsule.js";
import type { ProjectInspection } from "../../../src/intake/contracts.js";
import {
  currentProfileFromInspection,
  frozenProfileFromCapsule,
  scanDrift,
  type CurrentProfile,
  type FrozenProfile,
} from "../../../src/drift/scan.js";

const FROZEN_SHA = "a".repeat(64);
const CURRENT_SHA = "b".repeat(64);

function frozenProfile(overrides: Partial<FrozenProfile> = {}): FrozenProfile {
  return {
    kind: "backend",
    languages: ["typescript"],
    frameworks: ["fastify"],
    mutableRoots: ["src"],
    protectedPaths: [".git"],
    gates: [{ id: "G001", name: "test", argv: ["npm", "test"] }],
    files: [{ path: "AGENTS.md", sha256: FROZEN_SHA }],
    ...overrides,
  };
}

function currentProfile(overrides: Partial<CurrentProfile> = {}): CurrentProfile {
  return {
    kind: "backend",
    languages: ["typescript"],
    frameworks: ["fastify"],
    mutableRoots: ["src"],
    qualityCommands: [{ name: "test", argv: ["npm", "test"] }],
    presentPaths: ["AGENTS.md", ".git/config", "src/server.ts"],
    harnessDigests: { "AGENTS.md": FROZEN_SHA },
    partialScan: false,
    ...overrides,
  };
}

function projectInspection(overrides: Partial<ProjectInspection> = {}): ProjectInspection {
  return {
    schemaVersion: 1,
    root: "/workspace/demo",
    name: "demo",
    request: "Ship a bounded API.",
    mode: "existing",
    kind: "backend",
    languages: ["typescript"],
    frameworks: ["fastify"],
    packageManagers: ["npm"],
    qualityCommands: [{ name: "test", argv: ["npm", "test"] }],
    mutableRoots: ["src"],
    instructionSurfaces: ["AGENTS.md"],
    sources: [],
    evidence: [{ path: "package.json", signal: "script:test" }],
    scan: {
      status: "complete",
      visitedEntries: 12,
      hashedFiles: 4,
      limits: { maxEntries: 4096, maxDepth: 6, maxFiles: 512, maxTotalBytes: 4 * 1024 * 1024 },
      limitations: [],
    },
    questions: [],
    warnings: [],
    confidence: "high",
    analysisSha256: sha256Text("demo"),
    ...overrides,
  };
}

function capsulePayload(): Capsule["payload"] {
  return {
    compiler: { version: "1", forgeyardVersion: "0.1.0", protocolVersion: "0.2" },
    adapters: ["claude-code"],
    profile: { kind: "backend", languages: ["typescript"], frameworks: ["fastify"] },
    policy: {
      mutableRoots: ["src"],
      protectedPaths: [".git"],
      maxConcurrency: 1,
      timeboxMinutes: 60,
      maxRepairs: 3,
      autonomy: "supervised",
      maxRecordedCostUsd: null,
      externalEffects: "ask",
      automaticMerge: false,
    },
    gates: [{
      id: "G001",
      name: "test",
      argv: ["npm", "test"],
      parser: "test-summary",
      timeoutMs: 900_000,
      maxOutputBytes: 1_048_576,
      cwd: "services/api",
    }],
    method: { id: "native-cooperative", version: "1", review: "risk-proportionate" },
    files: [{ path: "AGENTS.md", sha256: FROZEN_SHA, componentId: "forgeyard.instructions" }],
    components: ["forgeyard.instructions"],
    selection: { profile: "tailored", catalog: { selection: "none", plugins: [] }, packs: [] },
    normalizedNeeds: null,
  };
}

function thrown(call: () => unknown): ForgeyardError {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(ForgeyardError);
    return error as ForgeyardError;
  }
  throw new Error("the malformed drift input was accepted");
}

describe("drift scanner", () => {
  test("declares alignment only when a complete scan contradicts nothing", () => {
    const report = scanDrift(frozenProfile(), currentProfile());

    expect(report.status).toBe("aligned");
    expect(report.findings).toEqual([]);
    expect(report.counts).toEqual({ blocking: 0, important: 0, informational: 0 });
    expect(report.comparisonSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("reports a frozen gate whose command the project no longer offers as blocking", () => {
    const report = scanDrift(
      frozenProfile(),
      currentProfile({ qualityCommands: [{ name: "test", argv: ["npm", "run", "test:unit"] }] }),
    );

    expect(report.status).toBe("drifted");
    expect(report.counts).toEqual({ blocking: 1, important: 0, informational: 0 });
    expect(report.findings[0]).toMatchObject({
      kind: "gate-command-missing",
      severity: "blocking",
      subject: "G001",
      frozen: "npm test",
      inconclusive: false,
    });
    expect(report.findings[0]?.summary).toContain("G001");
  });

  test("accepts a renamed gate whose argv is unchanged", () => {
    const report = scanDrift(
      frozenProfile(),
      currentProfile({ qualityCommands: [{ name: "unit-suite", argv: ["npm", "test"] }] }),
    );

    expect(report.findings).toEqual([]);
    expect(report.status).toBe("aligned");
  });

  test("distinguishes a present gate directory from a disappeared one", () => {
    const gates = [{ id: "G001", name: "test", argv: ["./gradlew", "test"], cwd: "services/api" }];
    const qualityCommands = [{ name: "test", argv: ["./gradlew", "test"], cwd: "services/api" }];

    expect(scanDrift(
      frozenProfile({ gates }),
      currentProfile({ qualityCommands, presentPaths: ["AGENTS.md", ".git/config", "src/server.ts", "services/api/build.gradle"] }),
    ).findings).toEqual([]);

    const drifted = scanDrift(frozenProfile({ gates }), currentProfile({ qualityCommands }));
    expect(drifted.status).toBe("drifted");
    expect(drifted.findings[0]).toMatchObject({
      kind: "gate-cwd-missing",
      severity: "blocking",
      subject: "G001",
      frozen: "services/api",
      inconclusive: false,
    });
  });

  test("keeps a changed harness digest conclusive even under a partial scan", () => {
    const report = scanDrift(
      frozenProfile(),
      currentProfile({ harnessDigests: { "AGENTS.md": CURRENT_SHA }, partialScan: true }),
    );

    expect(report.status).toBe("drifted");
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      kind: "harness-file-changed",
      severity: "blocking",
      subject: "AGENTS.md",
      frozen: FROZEN_SHA,
      current: CURRENT_SHA,
      inconclusive: false,
    });
  });

  test.each([
    ["an explicitly unreadable digest", { "AGENTS.md": null }],
    ["an absent digest entry", {}],
  ])("reports %s as an unreadable harness file", (_label, harnessDigests) => {
    const report = scanDrift(frozenProfile(), currentProfile({ harnessDigests }));

    expect(report.status).toBe("drifted");
    expect(report.findings[0]).toMatchObject({
      kind: "harness-file-unreadable",
      severity: "blocking",
      subject: "AGENTS.md",
      frozen: FROZEN_SHA,
      inconclusive: false,
    });
  });

  test("marks absence-driven findings inconclusive when the scan was partial", () => {
    const report = scanDrift(
      frozenProfile(),
      currentProfile({
        mutableRoots: [],
        frameworks: [],
        presentPaths: ["AGENTS.md", ".git/config"],
        partialScan: true,
      }),
    );

    expect(report.findings.map((finding) => finding.kind)).toEqual(["mutable-root-missing", "framework-disappeared"]);
    expect(report.findings.every((finding) => finding.inconclusive)).toBe(true);
    expect(report.status).toBe("inconclusive");
  });

  test("never declares alignment from a partial scan", () => {
    expect(scanDrift(frozenProfile(), currentProfile({ partialScan: true }))).toMatchObject({
      status: "inconclusive",
      findings: [],
    });
  });

  test("treats an appeared framework as informational and conclusive under a partial scan", () => {
    const report = scanDrift(
      frozenProfile(),
      currentProfile({ frameworks: ["fastify", "react"], partialScan: true }),
    );

    expect(report.status).toBe("drifted");
    expect(report.counts).toEqual({ blocking: 0, important: 0, informational: 1 });
    expect(report.findings[0]).toMatchObject({
      kind: "framework-appeared",
      severity: "informational",
      subject: "react",
      current: "react",
      inconclusive: false,
    });
  });

  test("separates a disappeared framework from an appeared one by severity", () => {
    const report = scanDrift(
      frozenProfile({ frameworks: ["fastify", "vue"] }),
      currentProfile({ frameworks: ["fastify", "react"] }),
    );

    expect(report.findings.map((finding) => [finding.kind, finding.severity, finding.subject])).toEqual([
      ["framework-disappeared", "important", "vue"],
      ["framework-appeared", "informational", "react"],
    ]);
  });

  test("separates a disappeared language from an appeared one by severity", () => {
    const report = scanDrift(
      frozenProfile({ languages: ["go", "typescript"] }),
      currentProfile({ languages: ["python", "typescript"] }),
    );

    expect(report.findings.map((finding) => [finding.kind, finding.severity, finding.subject])).toEqual([
      ["language-disappeared", "important", "go"],
      ["language-appeared", "informational", "python"],
    ]);
  });

  test("reports a changed project class, inconclusive only under a partial scan", () => {
    const report = scanDrift(frozenProfile(), currentProfile({ kind: "full-stack" }));
    expect(report.findings[0]).toMatchObject({
      kind: "kind-changed",
      severity: "important",
      frozen: "backend",
      current: "full-stack",
      inconclusive: false,
    });
    expect(report.status).toBe("drifted");

    const bounded = scanDrift(frozenProfile(), currentProfile({ kind: "full-stack", partialScan: true }));
    expect(bounded.findings[0]?.inconclusive).toBe(true);
    expect(bounded.status).toBe("inconclusive");
  });

  test("accepts a declared writable root the inspection still reports without listing its files", () => {
    expect(scanDrift(
      frozenProfile({ mutableRoots: ["packages"] }),
      currentProfile({ mutableRoots: ["packages"], presentPaths: ["AGENTS.md", ".git/config"] }),
    ).findings).toEqual([]);
  });

  test("accepts a writable root proven by a file inside it", () => {
    expect(scanDrift(
      frozenProfile(),
      currentProfile({ mutableRoots: [], presentPaths: ["AGENTS.md", ".git/config", "src/server.ts"] }),
    ).findings).toEqual([]);
  });

  // A protection is a policy, not an observation: the harness protects a path so that writes
  // are refused if it ever appears. Comparing it against what the project shows measured every
  // correctly prepared project as drifted.
  test("does not measure a frozen protection against what the project shows", () => {
    const report = scanDrift(
      frozenProfile({ protectedPaths: [".env", ".git"] }),
      currentProfile(),
    );

    expect(report.findings).toEqual([]);
    expect(report.status).toBe("aligned");
  });

  test("orders mixed findings by severity, then kind, then subject", () => {
    const report = scanDrift(
      frozenProfile({
        languages: ["go", "typescript"],
        frameworks: ["fastify", "vue"],
        mutableRoots: ["lib", "src"],
        protectedPaths: [".env", ".git"],
      }),
      currentProfile({
        kind: "frontend",
        languages: ["python", "typescript"],
        frameworks: ["fastify"],
        qualityCommands: [],
        harnessDigests: {},
      }),
    );

    expect(report.findings.map((finding) => `${finding.kind}:${finding.subject}`)).toEqual([
      "gate-command-missing:G001",
      "harness-file-unreadable:AGENTS.md",
      "mutable-root-missing:lib",
      "framework-disappeared:vue",
      "kind-changed:kind",
      "language-disappeared:go",
      "language-appeared:python",
    ]);
    expect(report.counts).toEqual({ blocking: 3, important: 3, informational: 1 });
    expect(report.status).toBe("drifted");
  });

  test("produces an identical report, digest included, for identical input", () => {
    const frozen = frozenProfile({ frameworks: ["fastify", "vue"] });
    const current = currentProfile({ kind: "frontend", harnessDigests: { "AGENTS.md": CURRENT_SHA } });

    const first = scanDrift(frozen, current);
    const second = scanDrift(frozen, current);

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.comparisonSha256).toBe(second.comparisonSha256);
    expect(scanDrift(frozen, currentProfile()).comparisonSha256).not.toBe(first.comparisonSha256);
  });

  test.each([
    ["a frozen gate without a command", (): unknown => scanDrift(frozenProfile({ gates: [{ id: "G001", name: "test", argv: [] }] }), currentProfile())],
    ["non-array frozen languages", (): unknown => scanDrift({ ...frozenProfile(), languages: "typescript" as unknown as readonly string[] }, currentProfile())],
    ["a non-boolean scan completeness flag", (): unknown => scanDrift(frozenProfile(), { ...currentProfile(), partialScan: "yes" as unknown as boolean })],
    ["a non-string harness digest", (): unknown => scanDrift(frozenProfile(), currentProfile({ harnessDigests: { "AGENTS.md": 7 as unknown as string } }))],
    ["a missing frozen file digest", (): unknown => scanDrift(frozenProfile({ files: [{ path: "AGENTS.md" } as unknown as { path: string; sha256: string }] }), currentProfile())],
  ])("rejects %s", (_label, call) => {
    const error = thrown(call);

    expect(error.code).toBe("FY_DRIFT_INVALID");
    expect(error.exitCode).toBe(2);
  });
});

describe("drift profile adapters", () => {
  test("shapes a frozen profile from a capsule payload and drops runtime-only gate fields", () => {
    expect(frozenProfileFromCapsule(capsulePayload())).toEqual({
      kind: "backend",
      languages: ["typescript"],
      frameworks: ["fastify"],
      mutableRoots: ["src"],
      protectedPaths: [".git"],
      gates: [{ id: "G001", name: "test", argv: ["npm", "test"], cwd: "services/api" }],
      files: [{ path: "AGENTS.md", sha256: FROZEN_SHA }],
    });
  });

  test("shapes a current profile from an inspection plus measured harness digests", () => {
    expect(currentProfileFromInspection(projectInspection(), { "AGENTS.md": FROZEN_SHA }, ["src/server.ts"])).toEqual({
      kind: "backend",
      languages: ["typescript"],
      frameworks: ["fastify"],
      mutableRoots: ["src"],
      qualityCommands: [{ name: "test", argv: ["npm", "test"] }],
      presentPaths: ["src/server.ts"],
      harnessDigests: { "AGENTS.md": FROZEN_SHA },
      partialScan: false,
    });
  });

  test.each([
    ["a limited scan", projectInspection({
      scan: {
        status: "limited",
        visitedEntries: 4096,
        hashedFiles: 512,
        limits: { maxEntries: 4096, maxDepth: 6, maxFiles: 512, maxTotalBytes: 4 * 1024 * 1024 },
        limitations: ["entry-limit"],
      },
    })],
    ["an absent scan record", ((): ProjectInspection => {
      const { scan: _scan, ...withoutScan } = projectInspection();
      return withoutScan;
    })()],
  ])("treats %s as a partial scan", (_label, inspection) => {
    expect(currentProfileFromInspection(inspection, {}, []).partialScan).toBe(true);
  });

  test("keeps a capsule payload comparable with its own inspection", () => {
    const report = scanDrift(
      frozenProfileFromCapsule(capsulePayload()),
      currentProfileFromInspection(projectInspection(), { "AGENTS.md": FROZEN_SHA }, [
        "AGENTS.md",
        ".git/config",
        "services/api/build.gradle",
        "src/server.ts",
      ]),
    );

    expect(report).toMatchObject({ status: "aligned", findings: [] });
  });
});
