import { describe, expect, test } from "vitest";

import type { Capsule, CapsulePolicy, GateDefinition } from "../../../src/capsule/capsule.js";
import { capsuleDifference } from "../../../src/native/recovery.js";

const basePolicy: CapsulePolicy = {
  mutableRoots: ["src"], protectedPaths: [".git"], maxConcurrency: 2, timeboxMinutes: 300,
  maxRepairs: 3, autonomy: "supervised", maxRecordedCostUsd: null,
  externalEffects: "ask", automaticMerge: false,
};
const baseGate: GateDefinition = { id: "G001", name: "unit", argv: ["node", "--test"],
  parser: "test-summary", timeoutMs: 900_000, maxOutputBytes: 1_048_576 };

function capsule(overrides: { policy?: Partial<CapsulePolicy>; gates?: readonly GateDefinition[];
  files?: readonly { path: string; sha256: string; componentId: string }[] } = {}): Capsule {
  return { schemaVersion: 1, id: "0".repeat(64), payload: {
    compiler: { version: "1", forgeyardVersion: "0.1.0", protocolVersion: "0.2" },
    adapters: ["codex"], profile: { kind: "unknown", languages: [], frameworks: [] },
    policy: { ...basePolicy, ...overrides.policy },
    gates: overrides.gates ?? [baseGate],
    method: { id: "native-cooperative", version: "1", review: "risk-proportionate" },
    files: overrides.files ?? [{ path: "AGENTS.md", sha256: "a".repeat(64), componentId: "forgeyard.instructions" }],
    components: ["forgeyard.instructions"],
    selection: { profile: "minimal", catalog: { selection: "none", plugins: [] }, packs: [] },
    normalizedNeeds: null,
  } };
}

describe("what a human is shown before accepting a changed capsule", () => {
  test("a policy field that moved is named with both values", () => {
    expect(capsuleDifference(capsule(), capsule({ policy: { timeboxMinutes: 240 } })))
      .toContain("policy.timeboxMinutes: 300 -> 240");
  });

  test("a changed gate is named with the command that would run", () => {
    const difference = capsuleDifference(capsule(),
      capsule({ gates: [{ ...baseGate, argv: ["node", "--test", "--experimental"] }] }));

    expect(difference.join("\n")).toContain("gates.G001:");
    expect(difference.join("\n")).toContain("--experimental");
  });

  /** Un cambiamento in un campo che la resa non stampa direbbe «X -> X»: non si chiede a una
   *  persona di accettare una differenza che non può leggere. */
  test("a gate field the readable form omits still shows two different sides", () => {
    const difference = capsuleDifference(capsule(),
      capsule({ gates: [{ ...baseGate, maxOutputBytes: 4096 }] })).join("\n");

    expect(difference).toContain("gates.G001:");
    const [left, right] = difference.slice(difference.indexOf("gates.G001:")).split(" -> ");
    expect(left).not.toBe(right);
    expect(difference).toContain("4096");
  });

  test("an added and a removed gate are both declared", () => {
    const difference = capsuleDifference(capsule(),
      capsule({ gates: [{ ...baseGate, id: "G002", name: "lint" }] })).join("\n");

    expect(difference).toContain("gates.G001:");
    expect(difference).toContain("gates.G002:");
    expect(difference).toContain("absent");
  });

  // Il conteggio, non l'elenco: un aggiornamento ne cambia decine, e una conferma che scorre
  // per tre schermate non viene letta. Che siano cambiati va detto comunque.
  test("frozen harness files are counted rather than listed", () => {
    expect(capsuleDifference(capsule(),
      capsule({ files: [{ path: "AGENTS.md", sha256: "b".repeat(64), componentId: "forgeyard.instructions" },
        { path: "CLAUDE.md", sha256: "c".repeat(64), componentId: "forgeyard.instructions" }] })).join("\n"))
      .toContain("frozen harness files: 1 changed, 1 added, 0 removed");
  });

  /** Una differenza vuota e una differenza non disponibile non sono la stessa affermazione. */
  test("a previous capsule that is no longer on disk is declared absent, never as no difference", () => {
    const unavailable = capsuleDifference(null, capsule()).join("\n");

    expect(unavailable).toContain("unavailable");
    expect(unavailable).not.toContain("identical");
  });

  test("two capsules that agree on policy, gates and files say so", () => {
    expect(capsuleDifference(capsule(), capsule()).join("\n")).toContain("identical");
  });
});
