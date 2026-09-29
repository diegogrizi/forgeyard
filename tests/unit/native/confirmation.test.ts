import { describe, expect, test } from "vitest";

import type { Capsule, CapsulePolicy, GateDefinition } from "../../../src/capsule/capsule.js";
import type { ProductPlan } from "../../../src/native/contracts.js";
import type { DialogOutcome } from "../../../src/native/confirmation.js";
import { dialogDecision, dialogFailureCause, localDialogConfirmation, windowsDialogCommand, windowsDialogConfirmation } from "../../../src/native/confirmation.js";
import { ForgeyardError } from "../../../src/core/errors.js";
import { canonicalJson, sha256Text } from "../../../src/core/hash.js";

const policy: CapsulePolicy = {
  mutableRoots: ["src"], protectedPaths: [".git"], maxConcurrency: 2, timeboxMinutes: 300,
  maxRepairs: 3, autonomy: "supervised", maxRecordedCostUsd: 12.5,
  externalEffects: "ask", automaticMerge: false,
};
const gate: GateDefinition = { id: "G001", name: "unit", argv: ["node", "--test"],
  parser: "test-summary", timeoutMs: 900_000, maxOutputBytes: 1_048_576 };

function capsule(): Capsule {
  return { schemaVersion: 1, id: "c".repeat(64), payload: {
    compiler: { version: "1", forgeyardVersion: "0.1.0", protocolVersion: "0.2" },
    adapters: ["codex"], profile: { kind: "unknown", languages: [], frameworks: [] },
    policy, gates: [gate],
    method: { id: "native-cooperative", version: "1", review: "risk-proportionate" },
    files: [{ path: "AGENTS.md", sha256: "a".repeat(64), componentId: "forgeyard.instructions" }],
    components: ["forgeyard.instructions"],
    selection: { profile: "minimal", catalog: { selection: "none", plugins: [] }, packs: [] },
    normalizedNeeds: null,
  } };
}

function plan(text: string): ProductPlan {
  return { id: "run-0001", request: text, risk: "medium",
    requirements: [{ id: "R1", description: text }],
    tasks: [{ id: "T1", title: "Task", objective: text, role: "implementer",
      requirementIds: ["R1"], dependsOn: [], writeScopes: ["src/native"],
      criteria: [{ id: "C1", description: text, gateIds: ["G001"] }] }] };
}

function input(text: string): Parameters<typeof windowsDialogCommand>[0] {
  return { title: "Forgeyard: approve this plan", description: text, plan: plan(text), capsule: capsule() };
}

/** A clean run of the dialog that reported the given stdout, and nothing else. */
function clean(stdout: string): DialogOutcome {
  return { exitCode: 0, stdout };
}

/** The script decodes to this; the tests read the shipped argument, not a second copy. */
function shippedScript(): string {
  return Buffer.from(windowsDialogCommand(input("x")).argv[6]!, "base64").toString("utf16le");
}

/** `dialogDecision` refuses by throwing, so the thrown value is what the tests inspect. */
function thrownBy(outcome: DialogOutcome): unknown {
  try {
    dialogDecision(outcome);
  } catch (error) {
    return error;
  }
  return new Error("dialogDecision returned a decision where none was available");
}

describe("a dialog nobody saw is not a person who said no", () => {
  test("a launch failure is declared unavailable instead of counted as a refusal", async () => {
    // `execa` runs with `reject: false`, so a dialog that never started arrives here as a
    // resolved value with no exit code. Reading that as `accepted: false` makes the caller
    // say `FY_APPROVAL_DENIED — the local human confirmation was rejected`, which names a
    // person who was never asked. The transport that produced this shape in practice was
    // `ENAMETOOLONG`: the plan travelled on the command line and crossed the Windows cap.
    const launchFailed = async (): Promise<DialogOutcome> =>
      ({ exitCode: undefined, stdout: "", failure: "spawn failed with ENAMETOOLONG" });

    await expect(windowsDialogConfirmation(input("x"), launchFailed))
      .rejects.toMatchObject({ code: "FY_CONFIRMATION_UNAVAILABLE" });
  });

  test("a spawn that throws is declared unavailable too", async () => {
    const threw = async (): Promise<DialogOutcome> => { throw new Error("EPERM"); };

    await expect(windowsDialogConfirmation(input("x"), threw))
      .rejects.toMatchObject({ code: "FY_CONFIRMATION_UNAVAILABLE" });
  });

  const neverAsked: readonly (readonly [string, DialogOutcome])[] = [
    ["a non-zero exit", { exitCode: 1, stdout: "" }],
    ["a timeout", { exitCode: undefined, stdout: "", failure: "timed out after 300000 ms" }],
    ["stdout that is neither word", { exitCode: 0, stdout: "realized:approved\r\nwhoops" }],
    ["silence", { exitCode: 0, stdout: "" }],
    // The script exits 3 when it cannot decode its own payload, so it never reaches a form.
    ["a payload the script could not decode", { exitCode: 3, stdout: "" }],
  ];
  for (const [name, outcome] of neverAsked) {
    test(`${name} means the question was never put`, () => {
      expect(thrownBy(outcome)).toMatchObject({ code: "FY_CONFIRMATION_UNAVAILABLE" });
    });
  }

  test("the message says the dialog could not be shown, and carries the cause", () => {
    const error = thrownBy({ exitCode: undefined, stdout: "", failure: "ENOENT" });

    expect(error).toBeInstanceOf(ForgeyardError);
    expect((error as ForgeyardError).message).toContain("could not be shown");
    expect((error as ForgeyardError).message).toContain("ENOENT");
  });

  test("the cause is one clause, not the command line it came from", () => {
    // Observed live: `execa`'s own `shortMessage` quotes the command, whose last argument is
    // the base64 of the script, so the refusal reached the reader with about four kilobytes
    // of base64 attached. The cause has to name the failure and stop.
    const cause = dialogFailureCause({ exitCode: undefined, timedOut: false, isTerminated: false, code: "ENAMETOOLONG" });

    expect(cause).toContain("ENAMETOOLONG");
    expect(cause.length).toBeLessThan(120);
    expect(cause).not.toContain("EncodedCommand");
  });

  test("each way of failing is named as itself", () => {
    expect(dialogFailureCause({ exitCode: undefined, timedOut: true, isTerminated: true })).toContain("within 300 seconds");
    expect(dialogFailureCause({ exitCode: undefined, timedOut: false, isTerminated: true, signal: "SIGTERM" })).toContain("terminated");
    expect(dialogFailureCause({ exitCode: 1, timedOut: false, isTerminated: false })).toContain("exited with code 1");
  });

  test("a decision that arrives with a failing exit code is not trusted", () => {
    // Without this, deleting the exit-code guard leaves every other test green: no case
    // paired a bad exit with a well-formed decision, so the guard had no red to lose.
    expect(thrownBy({ exitCode: 1, stdout: "realized:approved" })).toMatchObject({ code: "FY_CONFIRMATION_UNAVAILABLE" });
    expect(thrownBy({ exitCode: 1, stdout: "realized:rejected" })).toMatchObject({ code: "FY_CONFIRMATION_UNAVAILABLE" });
  });
});

describe("a window that was never realized cannot have been answered", () => {
  // A decision word counts only alongside `realized:`, which the script writes from
  // `HandleCreated` the moment the window exists.
  //
  // What this does NOT rest on: an earlier report read `IsHandleCreated: False` after
  // `ShowDialog` returned and called it proof that the loop never ran. `ShowDialog`
  // destroys the handle on its way out, so that reading is `False` for a healthy
  // interactive dialog too — it never discriminated anything, and it is withdrawn.
  //
  // So no instance of "decided without a window" has actually been measured. The one
  // candidate turned out to realize its handle and now reports `realized:approved`: that
  // case is still open. These tests pin the rule, not a reproduction of it.
  for (const bare of ["approved", "rejected"]) {
    test(`a bare ${bare} is not a decision`, () => {
      expect(thrownBy(clean(bare))).toMatchObject({ code: "FY_CONFIRMATION_UNAVAILABLE" });
    });
  }

  test("the refusal says the window was never realized, so nobody reads it as a denial", () => {
    const error = thrownBy(clean("approved"));

    expect((error as ForgeyardError).message).toContain("never realized");
  });

  test("a realized approval is an approval", () => {
    expect(dialogDecision(clean("realized:approved"))).toEqual({ accepted: true, channel: "local-dialog" });
  });

  test("a realized refusal is a refusal, and does not throw", () => {
    expect(dialogDecision(clean("realized:rejected"))).toEqual({ accepted: false, channel: "local-dialog" });
  });

  test("the script cannot turn a non-decision into a decision", () => {
    // Structural, because the branch lives in PowerShell and cannot be imported. `else`
    // swallowed `DialogResult::None` — which is exactly what a `ShowDialog` that never
    // pumped returns — and reported it as a refusal. Same pathology, one layer down.
    const script = shippedScript();

    expect(script).toContain("[Windows.Forms.DialogResult]::No");
    expect(script).toContain("[Windows.Forms.DialogResult]::Cancel");
    expect(script).not.toMatch(/else\s*\{\s*\[Console\]::Write/);
  });

  test("the realization token can only be written from inside the handler", () => {
    // Two independent `toContain`s let the token move to the top of the script and stay
    // green: it would then be written unconditionally, the guard would be decorative, and
    // nothing would fail. The write site has to be one, and inside `HandleCreated`.
    const script = shippedScript();

    expect(script.split("[Console]::Write('realized:')").length - 1).toBe(1);
    expect(script).toMatch(/Add_HandleCreated\(\{[\s\S]{0,160}\[Console\]::Write\('realized:'\)/);
  });

  test("the handler is subscribed before anything could create the handle", () => {
    // Nothing before `ShowDialog` realizes a handle today — `Controls.AddRange`,
    // `SetBounds`, `Width`/`Height`/`StartPosition` and `CancelButton` are all handle-free.
    // A later edit that touches `.Handle`, calls `Show()`, or sets a recreating property
    // earlier would make `realized:` never appear, and then every genuine approval becomes
    // `FY_CONFIRMATION_UNAVAILABLE` — the consent channel silently dead, with no red.
    const script = shippedScript();

    expect(script.indexOf("Add_HandleCreated")).toBeGreaterThan(0);
    expect(script.indexOf("Add_HandleCreated")).toBeLessThan(script.indexOf("ShowDialog()"));
  });

  test("a handle created twice does not spoil the token", () => {
    // WinForms can recreate a handle, and a second unguarded write would produce
    // `realized:realized:approved` — which exact matching sends to "ended without
    // reporting a decision", a wrong sentence for a decision that was in fact reported.
    const script = shippedScript();

    expect(script).toMatch(/Add_HandleCreated\(\{\s*if \(-not \$dialogRealized\.written\)/);
    expect(script).toContain("$dialogRealized = @{ written = $false }");
  });

  test("the script stops instead of drawing an empty window it cannot fill", () => {
    // Measured: with no `$ErrorActionPreference`, a payload that is not base64 or not JSON
    // left `$dialogData` null and the script carried on — empty title, empty body, two
    // working buttons, exit 0. A grant would then bind a plan nobody was shown.
    const script = shippedScript();

    expect(script).toContain("$ErrorActionPreference = 'Stop'");
    expect(script).toMatch(/trap\s*\{[^}]*exit 3/);
    expect(script).toMatch(/\$null -eq \$dialogData/);
  });
});

describe("the branch that has no dialog at all", () => {
  test("a platform with no adapter refuses, and says so as itself", async () => {
    // The branch CI actually runs, and the one that had no coverage.
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      await expect(localDialogConfirmation(input("x"))).rejects.toMatchObject({
        code: "FY_CONFIRMATION_UNAVAILABLE",
        message: expect.stringContaining("not implemented for this OS"),
      });
    } finally {
      Object.defineProperty(process, "platform", { value: real, configurable: true });
    }
  });
});

describe("a real refusal still reads as a refusal", () => {
  test("a clean run that reported rejected returns accepted false and does not throw", async () => {
    // The script reports `rejected` for the Reject button and for closing the window alike,
    // because `CancelButton` is Reject. That is a person declining, and it must not be
    // promoted into an error.
    await expect(windowsDialogConfirmation(input("x"), async () => clean("realized:rejected")))
      .resolves.toEqual({ accepted: false, channel: "local-dialog" });
  });

  test("a clean run that reported approved returns accepted true", async () => {
    await expect(windowsDialogConfirmation(input("x"), async () => clean("realized:approved")))
      .resolves.toEqual({ accepted: true, channel: "local-dialog" });
  });
});

describe("the argument vector is bounded, so any plan can be confirmed", () => {
  test("it does not grow with the message", () => {
    // Measured before the fix, with the payload embedded in `-EncodedCommand`: a dialog text
    // of 8156 characters produced 32680 argument characters and launched, 8191 produced 32796
    // and failed with ENAMETOOLONG. A plan of a dozen tasks passes that in ordinary use, so
    // the property that matters is not a bigger budget but no dependence on size at all.
    const tiny = windowsDialogCommand(input("x"));
    const huge = windowsDialogCommand(input("x".repeat(200_000)));
    const width = (argv: readonly string[]): number => argv.join(" ").length;

    // Independence of the message is carried entirely by this one line, which is strictly
    // stronger than comparing the two lengths.
    expect(huge.argv).toEqual(tiny.argv);

    // The numeric bound has a different job, and it is not about the message: it catches
    // the *constant script* growing toward the Windows cap. A script edited up to 25 000
    // characters would keep the equality above green while making every dialog fail to
    // launch on every machine. It is 4828 today; the cap is 32 767.
    expect(width(huge.argv)).toBeLessThan(8192);
  });

  test("and the whole text still reaches the person, byte for byte", () => {
    // The length problem is a transport bug. Fixing it by showing less would answer a
    // question about plumbing by weakening the consent the plumbing carries.
    const composed = input("Approve this exact plan?");
    const command = windowsDialogCommand(composed);
    const payload = JSON.parse(Buffer.from(command.stdin, "base64").toString("utf8")) as
      { title: string; message: string };

    expect(payload.title).toBe(composed.title);
    for (const fragment of [composed.description, composed.plan.id, composed.plan.request,
      composed.capsule.id, composed.plan.risk, sha256Text(canonicalJson(composed.plan)),
      JSON.stringify(composed.plan, null, 2), "src/native", `${gate.id} cwd=.`,
      `${policy.timeboxMinutes} minutes`, String(policy.maxRecordedCostUsd)]) {
      expect(payload.message).toContain(fragment);
    }
  });

  test("a message with characters outside ASCII survives the payload encoding", () => {
    const command = windowsDialogCommand(input("perché — 日本語"));
    const payload = JSON.parse(Buffer.from(command.stdin, "base64").toString("utf8")) as { message: string };

    expect(payload.message).toContain("perché — 日本語");
    expect(command.stdin).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});
