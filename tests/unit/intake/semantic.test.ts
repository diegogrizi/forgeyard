import { describe, expect, test } from "vitest";
import { validateProjectNeeds } from "../../../src/intake/semantic.js";
import type { ProjectInspection } from "../../../src/intake/contracts.js";

const inspection: ProjectInspection = { schemaVersion: 1, root: "/project", name: "project", request: "Maintenance", mode: "existing", kind: "backend", languages: ["java"], frameworks: [], packageManagers: [], qualityCommands: [], mutableRoots: ["src"], instructionSurfaces: [], sources: [], evidence: [], questions: [], warnings: [], confidence: "medium", analysisSha256: "b".repeat(64), evidenceRecords: [{ path: "pom.xml", signal: "language:java", sha256: "a".repeat(64), locator: "file", inference: "manifest" }] };
const proposal = { intent: "maintenance", risk: "medium", needs: ["domain.java", "method.coordinate", "domain.java"], evidence: [{ path: "pom.xml", sha256: "a".repeat(64), locator: "file" }] };
describe("structured project needs", () => {
  test("normalizes explicit intent deterministically independently of prose", () => {
    expect(validateProjectNeeds(inspection, proposal)).toMatchObject({ intent: "maintenance", risk: "medium", needs: ["domain.java", "method.coordinate"], analysisSha256: "b".repeat(64) });
  });
  test("rejects missing and stale evidence", () => {
    expect(() => validateProjectNeeds(inspection, { ...proposal, evidence: [{ path: "missing", sha256: "a".repeat(64) }] })).toThrow(/evidence/i);
    expect(() => validateProjectNeeds(inspection, { ...proposal, evidence: [{ path: "pom.xml", sha256: "c".repeat(64) }] })).toThrow(/evidence/i);
    expect(() => validateProjectNeeds(inspection, { ...proposal, evidence: [{ path: "pom.xml", sha256: "a".repeat(64), locator: "invented" }] })).toThrow(/evidence/i);
  });
  test("rejects free fields, invalid intent, traversal and oversized proposals", () => {
    for (const invalid of [{ ...proposal, prompt: "arbitrary" }, { ...proposal, intent: "guess" }, { ...proposal, needs: ["../secret"] }, { ...proposal, needs: Array(129).fill("domain.java") }]) {
      expect(() => validateProjectNeeds(inspection, invalid)).toThrow();
    }
  });
  test("rejects coercible but non-string intent and risk", () => {
    expect(() => validateProjectNeeds(inspection, { ...proposal, intent: ["maintenance"] })).toThrow();
    expect(() => validateProjectNeeds(inspection, { ...proposal, risk: ["medium"] })).toThrow();
  });
});
