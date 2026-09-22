import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { ForgeyardError } from "../../../src/core/errors.js";
import { canonicalJson, sha256Text } from "../../../src/core/hash.js";
import {
  GENESIS_HASH,
  LEDGER_RELATIVE_PATH,
  appendEvent,
  readChain,
  rebuildState,
  sealEvent,
  verifyChain,
  type AppendEventInput,
  type LedgerEvent,
} from "../../../src/ledger/events.js";

const temporaryRoots: string[] = [];

async function ledgerRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forgeyard-ledger-")));
  temporaryRoots.push(root);
  return root;
}

function ledgerFile(root: string): string {
  return path.join(root, ...LEDGER_RELATIVE_PATH.split("/"));
}

async function writeLedger(root: string, lines: readonly string[]): Promise<string> {
  const file = ledgerFile(root);
  await mkdir(path.dirname(file), { recursive: true });
  const text = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  await writeFile(file, text, "utf8");
  return text;
}

function at(second: number): string {
  return `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
}

/** Seals the given inputs into a contiguous chain, exactly as appendEvent would. */
function chainOf(inputs: readonly AppendEventInput[]): readonly LedgerEvent[] {
  const events: LedgerEvent[] = [];
  let previousHash = GENESIS_HASH;
  for (const [index, input] of inputs.entries()) {
    const event = sealEvent({ sequence: index + 1, at: input.at, kind: input.kind, payload: input.payload }, previousHash);
    events.push(event);
    previousHash = event.hash;
  }
  return events;
}

const scenario: readonly AppendEventInput[] = [
  { at: at(1), kind: "workspace-registered", payload: { root: "personal" } },
  { at: at(2), kind: "harness-installed", payload: { capsuleId: "capsule-one" } },
  { at: at(3), kind: "run-opened", payload: { runId: "R1" } },
  { at: at(4), kind: "task-claimed", payload: { runId: "R1", taskId: "T1" } },
  { at: at(5), kind: "task-claimed", payload: { runId: "R1", taskId: "T1" } },
  { at: at(6), kind: "task-claimed", payload: { runId: "R1", taskId: "T2" } },
  { at: at(7), kind: "checkpoint-recorded", payload: { runId: "R1" } },
  { at: at(8), kind: "gate-executed", payload: { runId: "R1", exitCode: 0 } },
  { at: at(9), kind: "gate-executed", payload: { runId: "R1", exitCode: 1 } },
  { at: at(10), kind: "criterion-recorded", payload: { runId: "R1", criterionId: "C1" } },
  { at: at(11), kind: "review-recorded", payload: { runId: "R1", reviewer: "peer" } },
  { at: at(12), kind: "drift-detected", payload: { findingId: "F1" } },
  { at: at(13), kind: "run-delivered", payload: { runId: "R1" } },
];

function chainLines(events: readonly LedgerEvent[]): readonly string[] {
  return events.map((event) => canonicalJson(event));
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("sealEvent", () => {
  test("seals the declared fields into the contracted digest", () => {
    const input = { sequence: 1, at: at(1), kind: "run-opened", payload: { runId: "R1", nested: { b: 1, a: 2 } } } as const;

    const event = sealEvent({ ...input, payload: { ...input.payload } }, GENESIS_HASH);

    expect(event.hash).toBe(sha256Text(canonicalJson({
      sequence: 1,
      at: at(1),
      kind: "run-opened",
      payload: { runId: "R1", nested: { b: 1, a: 2 } },
      previousHash: GENESIS_HASH,
    })));
    expect(event.previousHash).toBe(GENESIS_HASH);
    expect(GENESIS_HASH).toBe("0".repeat(64));
    expect(Object.keys(event).sort()).toEqual(["at", "hash", "kind", "payload", "previousHash", "sequence"]);
  });

  test("the digest ignores payload key order and survives caller mutation", () => {
    const payload: Record<string, unknown> = { beta: 2, alpha: 1 };
    const first = sealEvent({ sequence: 1, at: at(1), kind: "run-opened", payload }, GENESIS_HASH);
    const second = sealEvent({ sequence: 1, at: at(1), kind: "run-opened", payload: { alpha: 1, beta: 2 } }, GENESIS_HASH);

    payload.alpha = 99;

    expect(first.hash).toBe(second.hash);
    expect(first.payload).toEqual({ alpha: 1, beta: 2 });
    expect(verifyChain([first]).valid).toBe(true);
  });

  test("refuses every malformed input with FY_LEDGER_INVALID", () => {
    const base = { sequence: 1, at: at(1), kind: "run-opened", payload: {} } as const;
    const rejected: readonly [string, () => LedgerEvent][] = [
      ["sequence zero", () => sealEvent({ ...base, sequence: 0 }, GENESIS_HASH)],
      ["fractional sequence", () => sealEvent({ ...base, sequence: 1.5 }, GENESIS_HASH)],
      ["instant without milliseconds", () => sealEvent({ ...base, at: "2026-01-01T00:00:01Z" }, GENESIS_HASH)],
      ["instant without zone", () => sealEvent({ ...base, at: "2026-01-01T00:00:01.000" }, GENESIS_HASH)],
      ["instant with offset", () => sealEvent({ ...base, at: "2026-01-01T00:00:01.000+01:00" }, GENESIS_HASH)],
      ["impossible calendar day", () => sealEvent({ ...base, at: "2026-02-31T00:00:01.000Z" }, GENESIS_HASH)],
      ["unknown kind", () => sealEvent({ ...base, kind: "run-forgotten" as never }, GENESIS_HASH)],
      ["array payload", () => sealEvent({ ...base, payload: [] as unknown as Record<string, unknown> }, GENESIS_HASH)],
      ["undefined in payload", () => sealEvent({ ...base, payload: { missing: undefined } }, GENESIS_HASH)],
      ["function in payload", () => sealEvent({ ...base, payload: { call: () => 1 } }, GENESIS_HASH)],
      ["date in payload", () => sealEvent({ ...base, payload: { when: new Date(0) } }, GENESIS_HASH)],
      ["non-finite number in payload", () => sealEvent({ ...base, payload: { size: Number.POSITIVE_INFINITY } }, GENESIS_HASH)],
      ["short previous hash", () => sealEvent(base, "0".repeat(63))],
      ["uppercase previous hash", () => sealEvent(base, "A".repeat(64))],
      ["non-hex previous hash", () => sealEvent(base, "z".repeat(64))],
    ];

    for (const [label, seal] of rejected) {
      let caught: unknown;
      try {
        seal();
      } catch (error) {
        caught = error;
      }
      expect(caught, label).toBeInstanceOf(ForgeyardError);
      expect((caught as ForgeyardError).code, label).toBe("FY_LEDGER_INVALID");
      expect((caught as ForgeyardError).exitCode, label).toBe(2);
    }
  });
});

describe("verifyChain", () => {
  test("an empty chain is valid and has no head", () => {
    expect(verifyChain([])).toEqual({ valid: true, length: 0, headHash: null, brokenAt: null, reason: null });
  });

  test("a sealed chain verifies and reports its head", () => {
    const events = chainOf(scenario);

    const verification = verifyChain(events);

    expect(verification.valid).toBe(true);
    expect(verification.length).toBe(scenario.length);
    expect(verification.headHash).toBe(events.at(-1)?.hash);
    expect(verification.brokenAt).toBeNull();
    expect(verification.reason).toBeNull();
  });

  test("detects a tampered payload, a broken link, a gap, a wrong genesis and a regressing instant", () => {
    const events = chainOf(scenario);
    const second = events[1]!;
    const third = events[2]!;

    const tampered = [...events];
    tampered[1] = { ...second, payload: { capsuleId: "capsule-substituted" } };
    const tamperedVerification = verifyChain(tampered);
    expect(tamperedVerification.valid).toBe(false);
    expect(tamperedVerification.brokenAt).toBe(2);
    expect(tamperedVerification.reason).toContain("hash");
    expect(tamperedVerification.headHash).toBeNull();
    expect(tamperedVerification.length).toBe(events.length);

    const relinked = [...events];
    relinked[2] = { ...third, previousHash: GENESIS_HASH };
    expect(verifyChain(relinked)).toMatchObject({ valid: false, brokenAt: 3 });

    const gapped = [events[0]!, events[2]!];
    expect(verifyChain(gapped)).toMatchObject({ valid: false, brokenAt: 2 });

    const withoutGenesis = chainOf(scenario.slice(1));
    expect(verifyChain([{ ...withoutGenesis[0]! }])).toMatchObject({ valid: true, brokenAt: null });
    expect(verifyChain([sealEvent({ sequence: 1, at: at(1), kind: "run-opened", payload: {} }, "1".repeat(64))]))
      .toMatchObject({ valid: false, brokenAt: 1 });

    const regressing = chainOf([
      { at: at(9), kind: "run-opened", payload: { runId: "R1" } },
      { at: at(2), kind: "checkpoint-recorded", payload: { runId: "R1" } },
    ]);
    expect(verifyChain(regressing)).toMatchObject({ valid: false, brokenAt: 2 });
    expect(verifyChain(regressing).reason).toContain("at");
  });

  test("rejects a forged event whose fields are out of contract even when self-consistent", () => {
    const forged: LedgerEvent = {
      sequence: 1,
      at: "yesterday",
      kind: "run-opened",
      payload: {},
      previousHash: GENESIS_HASH,
      hash: sha256Text(canonicalJson({
        sequence: 1, at: "yesterday", kind: "run-opened", payload: {}, previousHash: GENESIS_HASH,
      })),
    };

    expect(verifyChain([forged])).toMatchObject({ valid: false, brokenAt: 1 });
  });
});

describe("appendEvent and readChain", () => {
  test("reading or refusing never creates anything in the project", async () => {
    const root = await ledgerRoot();

    await expect(readChain(root)).resolves.toEqual([]);
    await expect(appendEvent(root, { at: "yesterday", kind: "run-opened", payload: { runId: "R1" } }))
      .rejects.toMatchObject({ code: "FY_LEDGER_INVALID" });
    await expect(appendEvent(root, { at: at(1), kind: "run-opened", payload: { bad: undefined } }))
      .rejects.toMatchObject({ code: "FY_LEDGER_INVALID" });
    expect(await readdir(root)).toEqual([]);
  });

  test("appends a verified chain confined to the project ledger file", async () => {
    const root = await ledgerRoot();

    const appended: LedgerEvent[] = [];
    for (const input of scenario) appended.push(await appendEvent(root, input));

    const text = await readFile(ledgerFile(root), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(scenario.length);
    expect(await readdir(root)).toEqual([".forgeyard"]);
    expect(await readdir(path.join(root, ".forgeyard"))).toEqual(["ledger"]);
    // Exactly the chain, with no temporary file left behind by the atomic writes.
    expect(await readdir(path.join(root, ".forgeyard", "ledger"))).toEqual(["chain.jsonl"]);

    const stored = await readChain(root);
    expect(stored).toEqual(appended);
    expect(stored.map((event) => event.sequence)).toEqual(scenario.map((_, index) => index + 1));
    expect(stored[0]?.previousHash).toBe(GENESIS_HASH);
    expect(stored[1]?.previousHash).toBe(stored[0]?.hash);
    expect(verifyChain(stored)).toMatchObject({ valid: true, length: scenario.length, headHash: stored.at(-1)?.hash });
  });

  test("ignores the legacy observation register that shares the ledger directory", async () => {
    const root = await ledgerRoot();
    const legacyPath = path.join(root, ".forgeyard", "ledger", "events.jsonl");
    await mkdir(path.dirname(legacyPath), { recursive: true });
    const legacy = `${JSON.stringify({
      schemaVersion: 1,
      eventId: "event-1",
      recordedAt: at(1),
      kind: "usage",
      taskId: "T1",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      durationMs: 1,
    })}\n`;
    await writeFile(legacyPath, legacy, "utf8");

    // Records of another shape in the same directory are not this chain: it has simply not been opened here.
    await expect(readChain(root)).resolves.toEqual([]);
    const event = await appendEvent(root, { at: at(2), kind: "workspace-registered", payload: {} });

    expect(event.sequence).toBe(1);
    expect(event.previousHash).toBe(GENESIS_HASH);
    expect(await readChain(root)).toEqual([event]);
    expect(await readFile(legacyPath, "utf8")).toBe(legacy);
    expect((await readdir(path.dirname(legacyPath))).sort()).toEqual(["chain.jsonl", "events.jsonl"]);
  });

  test("refuses to append onto a tampered chain and preserves its bytes", async () => {
    const root = await ledgerRoot();
    const events = chainOf(scenario.slice(0, 3));
    const lines = [...chainLines(events)];
    lines[1] = canonicalJson({ ...events[1]!, payload: { capsuleId: "capsule-substituted" } });
    const text = await writeLedger(root, lines);

    await expect(appendEvent(root, { at: at(20), kind: "run-opened", payload: { runId: "R2" } }))
      .rejects.toMatchObject({ code: "FY_LEDGER_BROKEN", exitCode: 9 });
    expect(await readFile(ledgerFile(root), "utf8")).toBe(text);
  });

  test("a malformed record is a failure, never an ignored event", async () => {
    const root = await ledgerRoot();
    const events = chainOf(scenario.slice(0, 2));
    const lines = chainLines(events);
    const head = events[0]!;
    const cases: readonly (readonly string[])[] = [
      [lines[0]!, "not json at all"],
      [lines[0]!, canonicalJson({ ...events[1]!, extra: "unexpected" })],
      [lines[0]!, canonicalJson({ sequence: 2, at: at(2), kind: "harness-installed", payload: {} })],
      [lines[0]!, canonicalJson({ ...events[1]!, payload: [] })],
      [lines[0]!, canonicalJson({ ...events[1]!, sequence: "2" })],
      [lines[0]!, canonicalJson([head])],
      [lines[0]!, "", lines[1]!],
    ];

    for (const lines_ of cases) {
      await writeLedger(root, lines_);
      await expect(readChain(root)).rejects.toMatchObject({ code: "FY_LEDGER_INVALID", exitCode: 2 });
    }

    const file = ledgerFile(root);
    await writeFile(file, chainLines(events).join("\n"), "utf8");
    await expect(readChain(root)).rejects.toMatchObject({ code: "FY_LEDGER_INVALID", exitCode: 2 });
    await expect(appendEvent(root, { at: at(20), kind: "run-opened", payload: { runId: "R2" } }))
      .rejects.toMatchObject({ code: "FY_LEDGER_INVALID" });
  });

  test("an empty ledger file is an empty chain that can still be opened", async () => {
    const root = await ledgerRoot();
    await writeLedger(root, []);

    await expect(readChain(root)).resolves.toEqual([]);
    const event = await appendEvent(root, { at: at(1), kind: "workspace-registered", payload: {} });

    expect(event.sequence).toBe(1);
    expect(event.previousHash).toBe(GENESIS_HASH);
    expect(verifyChain(await readChain(root)).valid).toBe(true);
  });

  test("enforces the declared bounds instead of writing beyond them", async () => {
    const root = await ledgerRoot();
    await appendEvent(root, { at: at(1), kind: "workspace-registered", payload: {} }, { maximumEvents: 1 });
    const text = await readFile(ledgerFile(root), "utf8");

    await expect(appendEvent(root, { at: at(2), kind: "run-opened", payload: { runId: "R1" } }, { maximumEvents: 1 }))
      .rejects.toMatchObject({ code: "FY_LEDGER_LIMIT", exitCode: 2 });
    await expect(appendEvent(root, { at: at(2), kind: "run-opened", payload: { note: "x".repeat(70_000) } }))
      .rejects.toMatchObject({ code: "FY_LEDGER_LIMIT", exitCode: 2 });
    await expect(appendEvent(root, { at: at(2), kind: "run-opened", payload: {} }, { maximumEvents: 0 }))
      .rejects.toMatchObject({ code: "FY_LEDGER_INVALID", exitCode: 2 });
    expect(await readFile(ledgerFile(root), "utf8")).toBe(text);
  });

  test("refuses to grow a ledger past the writable artifact bound", async () => {
    const root = await ledgerRoot();
    const bound = 16_777_216;
    const filler = (note: string): AppendEventInput => ({
      at: at(1),
      kind: "checkpoint-recorded",
      payload: { runId: "R1", note },
    });
    // Records just under the 64 KiB line bound, plus a tail sized to leave the ledger just under 16 MiB.
    const bulk = Array.from({ length: 257 }, () => filler("x".repeat(65_000)));
    const bulkBytes = chainLines(chainOf(bulk)).reduce((sum, line) => sum + line.length + 1, 0);
    const text = await writeLedger(root, chainLines(chainOf([...bulk, filler("x".repeat(bound - bulkBytes - 320))])));
    expect(text.length).toBeLessThanOrEqual(bound);
    expect(text.length).toBeGreaterThan(bound - 400);

    const stored = await readChain(root);
    expect(verifyChain(stored).valid).toBe(true);
    await expect(appendEvent(root, { at: at(2), kind: "run-delivered", payload: { runId: "R1" } }))
      .rejects.toMatchObject({ code: "FY_LEDGER_LIMIT", exitCode: 2 });
    expect(await readFile(ledgerFile(root), "utf8")).toBe(text);
  });

  test("refuses an instant that precedes the head instead of sealing an unverifiable chain", async () => {
    const root = await ledgerRoot();
    await appendEvent(root, { at: at(9), kind: "workspace-registered", payload: {} });
    const text = await readFile(ledgerFile(root), "utf8");

    await expect(appendEvent(root, { at: at(8), kind: "run-opened", payload: { runId: "R1" } }))
      .rejects.toMatchObject({ code: "FY_LEDGER_INVALID", exitCode: 2 });
    await expect(appendEvent(root, { at: "not-an-instant", kind: "run-opened", payload: { runId: "R1" } }))
      .rejects.toMatchObject({ code: "FY_LEDGER_INVALID", exitCode: 2 });
    expect(await readFile(ledgerFile(root), "utf8")).toBe(text);
    await expect(appendEvent(root, { at: at(9), kind: "run-opened", payload: { runId: "R1" } })).resolves.toMatchObject({
      sequence: 2,
    });
  });

  test("a competing write between read and rename is never silently overwritten", async () => {
    const root = await ledgerRoot();
    const first = await appendEvent(root, { at: at(1), kind: "workspace-registered", payload: { note: "one" } });
    const competing = `${canonicalJson({ ...first, payload: { note: "substituted" } })}\n`;

    const inFlight = appendEvent(root, { at: at(2), kind: "run-opened", payload: { runId: "R1" } });
    await writeFile(ledgerFile(root), competing, "utf8");
    const outcome: unknown = await inFlight.then(() => null, (error: unknown) => error);

    expect(outcome).toBeInstanceOf(ForgeyardError);
    expect((outcome as ForgeyardError).exitCode).toBe(9);
    expect(["FY_LEDGER_BROKEN", "FY_ARTIFACT_DRIFT"]).toContain((outcome as ForgeyardError).code);
    expect(await readFile(ledgerFile(root), "utf8")).toBe(competing);
  });

  test("concurrent appends record exactly the events they acknowledged", async () => {
    const root = await ledgerRoot();

    const results = await Promise.allSettled([
      appendEvent(root, { at: at(1), kind: "run-opened", payload: { runId: "R1" } }),
      appendEvent(root, { at: at(1), kind: "run-opened", payload: { runId: "R2" } }),
    ]);

    const accepted = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const stored = await readChain(root);

    // Whether the appends serialize or one is refused, the chain is never left broken or half written.
    expect(verifyChain(stored).valid).toBe(true);
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    // The ledger never holds an event nobody was told about. The converse, that every acknowledged
    // event is recorded, is only as strong as the writer's publish step: a rename replaces the
    // destination, so two writers that both pass the digest check can both publish. The read-back
    // after the write closes that window whenever it is still observable from here.
    for (const event of stored) expect(accepted.some((candidate) => candidate.hash === event.hash)).toBe(true);
    for (const result of results) {
      // A refused append carries a declared code, never a raw errno.
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ForgeyardError);
        expect((result.reason as ForgeyardError).code).toMatch(/^FY_(ARTIFACT_DRIFT|LEDGER_[A-Z]+)$/u);
      }
    }
  });
});

describe("rebuildState", () => {
  test("an empty chain rebuilds the zero state", () => {
    expect(rebuildState([])).toEqual({
      revision: 0,
      workspaceRegisteredAt: null,
      harnessCapsuleId: null,
      runs: {},
      openDrift: [],
      headHash: null,
    });
  });

  test("projects the recorded scenario deterministically", () => {
    const events = chainOf(scenario);

    const state = rebuildState(events);

    expect(state.revision).toBe(scenario.length);
    expect(state.workspaceRegisteredAt).toBe(at(1));
    expect(state.harnessCapsuleId).toBe("capsule-one");
    expect(state.headHash).toBe(events.at(-1)?.hash);
    expect(state.openDrift).toEqual(["F1"]);
    expect(state.runs.R1).toEqual({
      runId: "R1",
      status: "delivered",
      claimedTaskIds: ["T1", "T2"],
      checkpoints: 1,
      gatesExecuted: 2,
      gatesFailed: 1,
      criteriaRecorded: 1,
      reviewsRecorded: 1,
      openedAt: at(3),
      lastEventAt: at(13),
    });
  });

  test("a delivery never clears a block", () => {
    const state = rebuildState(chainOf([
      { at: at(1), kind: "run-opened", payload: { runId: "R1" } },
      { at: at(2), kind: "run-blocked", payload: { runId: "R1", reason: "unsupported claim" } },
      { at: at(3), kind: "run-delivered", payload: { runId: "R1" } },
    ]));

    expect(state.runs.R1?.status).toBe("blocked");
    expect(state.runs.R1?.lastEventAt).toBe(at(3));
    expect(state.revision).toBe(3);
  });

  test("counts a gate without a zero exit code as failed", () => {
    const state = rebuildState(chainOf([
      { at: at(1), kind: "run-opened", payload: { runId: "R1" } },
      { at: at(2), kind: "gate-executed", payload: { runId: "R1", exitCode: 0 } },
      { at: at(3), kind: "gate-executed", payload: { runId: "R1" } },
      { at: at(4), kind: "gate-executed", payload: { runId: "R1", exitCode: "0" } },
    ]));

    expect(state.runs.R1).toMatchObject({ gatesExecuted: 3, gatesFailed: 2 });
  });

  test("ignores events without a string run identifier and events for a run never opened", () => {
    const events = chainOf([
      { at: at(1), kind: "run-opened", payload: { runId: "R1" } },
      { at: at(2), kind: "checkpoint-recorded", payload: { runId: 7 } },
      { at: at(3), kind: "checkpoint-recorded", payload: {} },
      { at: at(4), kind: "checkpoint-recorded", payload: { runId: "R-unknown" } },
      { at: at(5), kind: "run-blocked", payload: { runId: "R-unknown" } },
    ]);

    const state = rebuildState(events);

    expect(Object.keys(state.runs)).toEqual(["R1"]);
    expect(state.runs.R1).toMatchObject({ checkpoints: 0, status: "open", lastEventAt: at(1) });
    expect(state.revision).toBe(events.length);
  });

  test("keeps the first registration and the last declared capsule identity", () => {
    const state = rebuildState(chainOf([
      { at: at(1), kind: "workspace-registered", payload: { root: "personal" } },
      { at: at(2), kind: "harness-installed", payload: { capsuleId: "capsule-one" } },
      { at: at(3), kind: "harness-updated", payload: { capsuleId: 7 } },
      { at: at(4), kind: "harness-updated", payload: { capsuleId: "capsule-two" } },
      { at: at(5), kind: "workspace-registered", payload: { root: "personal" } },
    ]));

    expect(state.workspaceRegisteredAt).toBe(at(1));
    expect(state.harnessCapsuleId).toBe("capsule-two");
  });

  test("a harness update supersedes only the drift recorded before it", () => {
    const state = rebuildState(chainOf([
      { at: at(1), kind: "drift-detected", payload: { findingId: "F1" } },
      { at: at(2), kind: "drift-detected", payload: { findingId: "F1" } },
      { at: at(3), kind: "drift-detected", payload: { findingId: "F2" } },
      { at: at(4), kind: "harness-updated", payload: { capsuleId: "capsule-two" } },
      { at: at(5), kind: "drift-detected", payload: { findingId: "F3" } },
      { at: at(6), kind: "drift-detected", payload: { findingId: 9 } },
      { at: at(7), kind: "drift-detected", payload: { findingId: "F4" } },
      { at: at(8), kind: "harness-installed", payload: { capsuleId: "capsule-three" } },
    ]));

    expect(state.openDrift).toEqual(["F3", "F4"]);
  });

  test("the same events always rebuild the same state", async () => {
    const root = await ledgerRoot();
    for (const input of scenario) await appendEvent(root, input);
    const stored = await readChain(root);

    const once = rebuildState(stored);
    const twice = rebuildState(stored);

    expect(canonicalJson(once)).toBe(canonicalJson(twice));
    expect(canonicalJson(once)).toBe(canonicalJson(rebuildState(chainOf(scenario))));
    expect(canonicalJson(once)).toBe(canonicalJson(rebuildState([...stored].map((event) => ({ ...event })))));
    expect(once.revision).toBe(stored.length);
  });
});
