import { execa } from "execa";
import { describe, expect, test, vi } from "vitest";

import type { Capsule, CapsulePolicy, GateDefinition } from "../../../src/capsule/capsule.js";
import type { ProductPlan } from "../../../src/native/contracts.js";
import type { DialogOutcome } from "../../../src/native/confirmation.js";
import { dialogDecision, dialogFailureCause, localDialogConfirmation, windowsDialogCommand, windowsDialogConfirmation } from "../../../src/native/confirmation.js";
import { ForgeyardError } from "../../../src/core/errors.js";
import { canonicalJson, sha256Text } from "../../../src/core/hash.js";

// Replace only process creation: unit tests must never display a consent dialog.
vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ failed: false, exitCode: 0, stdout: "realized:rejected" })),
}));

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
  return { title: "Forgeyard: approva il piano", description: text, plan: plan(text), capsule: capsule(),
    kind: "plan", projectRoot: "C:/Projects/my-app", membersByTask: { T1: "." } };
}

function payload(composed = input("Correggere gli spazi nei nomi")): {
  title: string; message: string;
  view: { heading: string; intro: string; projectRoot: string; goal: string;
    scopeLabel: string; paths: string[]; commandLabel: string; commands: string[];
    limits: string[]; boundary: string; approveLabel: string; deadlineAt: string | null };
} {
  return JSON.parse(Buffer.from(windowsDialogCommand(composed).stdin, "base64").toString("utf8"));
}

describe("a person can understand what the click authorizes", () => {
  test("puts the real project, requested change, paths and commands before technical identifiers", () => {
    const { view, message } = payload();

    expect(view).toMatchObject({ projectRoot: "C:/Projects/my-app", goal: "Correggere gli spazi nei nomi",
      paths: ["src/native"], commands: ["node --test\nCartella: C:/Projects/my-app"], approveLabel: "Autorizza il piano" });
    expect(view.boundary).toContain("non autorizza");
    expect(view.boundary).toContain("push");
    expect(view.limits.join("\n")).toContain("non misurati");
    expect(view.goal).not.toContain("Capsule:");
    expect(message).toContain(JSON.stringify(plan("Correggere gli spazi nei nomi"), null, 2));
    expect(message).toContain(JSON.stringify(policy, null, 2));
  });

  test("recovery explains the ownership transfer instead of presenting a new implementation approval", () => {
    const composed = { ...input("Riprendere la correzione"), kind: "resume" as const,
      deadlineAt: "2026-10-22T18:00:00.000Z" };
    const { view } = payload(composed);

    expect(view.approveLabel).toBe("Riprendi il lavoro");
    expect(view.intro).toContain("non sta più scrivendo");
    expect(view.intro).toContain("non azzera");
    expect(view.deadlineAt).toBe("2026-10-22T18:00:00.000Z");
  });

  test("installation shows actual harness creations, not the product's mutable roots", () => {
    const composed = { ...input("Preparare il progetto"), kind: "install" as const,
      paths: [".agents/skills/forgeyard-workflow/SKILL.md", ".codex/config.toml"] };
    const { view } = payload(composed);

    expect(view.paths).toEqual(composed.paths);
    expect(view.commandLabel).toContain("non eseguiti");
    expect(view.approveLabel).toBe("Prepara l'ambiente");
  });

  test("idle-writer recovery never labels test commands as approved to run", () => {
    const { view } = payload({ ...input("Recover an idle cooperative writer"), kind: "recover-writer" });

    expect(view.commandLabel).toContain("non eseguiti");
    expect(view.intro).toContain("Nessuna modifica al prodotto");
    expect(view.goal).toBe("Passare il controllo del progetto alla sessione attuale, senza avviare lo sviluppo.");
  });

  test("untrusted project text is carried as data without losing symbols or original details", () => {
    const text = 'Èlia & <script> $(not-a-command) 日本語';
    const { view, message } = payload(input(text));

    expect(view.goal).toBe(text);
    expect(message).toContain(text);
    expect(windowsDialogCommand(input(text)).argv).toEqual(windowsDialogCommand(input("x")).argv);
  });

  test("shows the actual member and gate subdirectory instead of implying the aggregate project root", () => {
    const root = process.platform === "win32" ? "C:/Workspace" : "/workspace";
    const composed = { ...input("Verificare due repository"), projectRoot: root,
      membersByTask: { T1: "services/api", T2: "apps/web" } };
    composed.plan = { ...composed.plan, tasks: [composed.plan.tasks[0]!, { ...composed.plan.tasks[0]!, id: "T2" }] };
    composed.capsule = { ...composed.capsule, payload: { ...composed.capsule.payload,
      gates: [{ ...gate, cwd: "checks" }] } };

    expect(payload(composed).view.commands).toEqual([
      `node --test\nCartella: ${root}/services/api/checks`,
      `node --test\nCartella: ${root}/apps/web/checks`,
    ]);
  });

  test("never rounds a small nonzero recorded spending limit down to zero", () => {
    const composed = input("Verificare il limite");
    composed.capsule = { ...composed.capsule, payload: { ...composed.capsule.payload,
      policy: { ...policy, maxRecordedCostUsd: 0.0004 } } };
    expect(payload(composed).view.limits).toContain("Tetto di spesa registrata: 0,0004 USD.");
  });
});

describe.skipIf(process.platform !== "win32")("the real Windows controls, without showing or approving a dialog", () => {
  async function inspectWindow(removeView = false, compact = false) {
    const { execa: run } = await vi.importActual<typeof import("execa")>("execa");
    const composed = input('Èlia & <test> $(not-a-command) 日本語');
    if (compact) composed.projectRoot = "C:/Projects/a-very-long-project-directory-with-many-subfolders/customer-facing-services/source/backend";
    const command = windowsDialogCommand(composed);
    if (removeView) {
      const data = JSON.parse(Buffer.from(command.stdin, "base64").toString("utf8"));
      delete data.view;
      command.stdin = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
    }
    const inspect = `
      ${compact ? "$dialogForm.Size = New-Object Drawing.Size(660,600); $dialogForm.PerformLayout(); & $resize" : ""}
      $projectBox = $dialogForm.Controls.Find('project-root', $true)[0]
      $probe = @{ project = [string]($dialogForm.Controls.Find('project-root', $true).Text);
        goal = [string]($dialogForm.Controls.Find('requested-change', $true).Text);
        commands = [string]($dialogForm.Controls.Find('verification-commands', $true).Text);
        projectScrollBars = $dialogForm.Controls.Find('project-root', $true).ScrollBars.ToString();
        approve = $dialogApprove.Text; reject = $dialogReject.Text;
        details = $dialogForm.Controls.Find('technical-details', $true).Count;
        automaticAccept = ($null -ne $dialogForm.AcceptButton);
        projectHeight = $projectBox.Height; projectFontHeight = $projectBox.Font.Height;
        projectLines = 1 + $projectBox.GetLineFromCharIndex($projectBox.TextLength-1) }
      [Console]::Error.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($probe | ConvertTo-Json -Compress))))
      $dialogForm.Dispose(); exit 0`;
    const script = Buffer.from(command.argv[6]!, "base64").toString("utf16le")
      .replace("trap { exit 3 }", "trap { [Console]::Error.WriteLine($_.ToString() + $_.InvocationInfo.PositionMessage); exit 3 }")
      .replace("$dialogOutcome = $dialogForm.ShowDialog()", inspect);
    const argv = [...command.argv]; argv[6] = Buffer.from(script, "utf16le").toString("base64");
    return run(command.executable, argv, { input: command.stdin, shell: false, windowsHide: false,
      reject: false, timeout: 15000 });
  }

  test("shows readable project and action fields, preserves literal text, and never accepts Enter by default", async () => {
    const result = await inspectWindow();
    expect(result.exitCode, result.stderr).toBe(0);
    const controls = JSON.parse(Buffer.from(result.stderr, "base64").toString("utf8"));
    expect(controls).toMatchObject({ project: "C:/Projects/my-app", goal: 'Èlia & <test> $(not-a-command) 日本語',
      commands: "node --test\r\nCartella: C:/Projects/my-app", projectScrollBars: "None",
      approve: "Autorizza il piano", reject: "Annulla", details: 1, automaticAccept: false });
  });

  test("a wrapped project path fits its field at the minimum window width", async () => {
    const result = await inspectWindow(false, true);
    expect(result.exitCode, result.stderr).toBe(0);
    const controls = JSON.parse(Buffer.from(result.stderr, "base64").toString("utf8"));
    expect(controls.projectLines).toBeGreaterThan(1);
    expect(controls.projectHeight).toBeGreaterThanOrEqual(controls.projectLines * controls.projectFontHeight);
  });

  test("refuses a missing readable summary instead of showing an incomplete consent", async () => {
    const result = await inspectWindow(true);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).not.toContain("approved");
  });
});

/** A clean run of the dialog that reported the given stdout, and nothing else. */
function clean(stdout: string): DialogOutcome {
  return { exitCode: 0, stdout };
}

/**
 * The script decodes to this, with PowerShell's line comments removed.
 *
 * Stripping is the point, not tidiness. Assertions that read the raw text are blind to a
 * commented-out line, so `# [Console]::Write('realized:')` left behind mid-debugging passed
 * every structural check while the token was never emitted — and a token never emitted turns
 * every genuine approval into `FY_CONFIRMATION_UNAVAILABLE`. The assertions have to see what
 * PowerShell sees.
 *
 * The scan tracks quoting, so a `#` inside a string is text and not the start of a comment.
 * There is none in the script today; doing it by construction means there is nothing to
 * re-check when there is.
 */
function shippedScript(): string {
  return withoutPowerShellComments(
    Buffer.from(windowsDialogCommand(input("x")).argv[6]!, "base64").toString("utf16le"));
}

function withoutPowerShellComments(raw: string): string {
  let stripped = "";
  let quote: "'" | '"' | null = null;
  for (let at = 0; at < raw.length; at += 1) {
    const character = raw[at]!;
    if (quote !== null) {
      stripped += character;
      // PowerShell escapes a quote by doubling it, which keeps the string open.
      if (character === quote) {
        if (raw[at + 1] === quote) { stripped += quote; at += 1; } else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') { quote = character; stripped += character; continue; }
    if (character === "#") {
      while (at < raw.length && raw[at] !== "\n") at += 1;
      stripped += "\n";
      continue;
    }
    stripped += character;
  }
  return stripped;
}

/**
 * The body of `.Add_<Event>({ ... })`, delimited by its own braces.
 *
 * A fixed proximity window was doing this job, and a constant like that drifts the moment the
 * handler grows: too small and a legitimate edit reds the suite, too large and the assertion
 * stops meaning "inside the handler".
 */
function handlerBody(script: string, event: string): string {
  const marker = `Add_${event}({`;
  const start = script.indexOf(marker);
  expect(start, `the script has no ${marker}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let at = start + marker.length - 1; at < script.length; at += 1) {
    if (script[at] === "{") depth += 1;
    else if (script[at] === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start + marker.length, at);
    }
  }
  throw new Error(`braces never balance after ${marker}`);
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
  test("the launcher leaves the consent window visible while PowerShell hides its console", async () => {
    // Measured on Windows: execa's windowsHide default suppresses the first WinForms
    // window too. Form.Visible was true, but Win32 IsWindowVisible was false.
    await expect(windowsDialogConfirmation(input("x")))
      .resolves.toEqual({ accepted: false, channel: "local-dialog" });

    expect(execa).toHaveBeenCalledWith(expect.any(String),
      expect.arrayContaining(["-WindowStyle", "Hidden"]),
      expect.objectContaining({ shell: false, windowsHide: false }));
  });

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
    // nothing would fail. The write site has to be one, live, and inside `HandleCreated`.
    const script = shippedScript();

    expect(script.split("[Console]::Write('realized:')").length - 1).toBe(1);
    expect(handlerBody(script, "HandleCreated")).toContain("[Console]::Write('realized:')");
  });

  test("a hash inside a string is text, not the start of a comment", () => {
    // The stripper is load-bearing for three guards now. If it ever ate a `#` that belonged
    // to a string, it would quietly change what those guards read, so its one failure mode
    // gets a red of its own rather than a note saying the script happens not to contain one.
    expect(withoutPowerShellComments("$a = 'x#y' # gone")).toContain("'x#y'");
    expect(withoutPowerShellComments("$a = 'x#y' # gone")).not.toContain("gone");
    expect(withoutPowerShellComments("$a = 'it''s #1' # gone")).toContain("'it''s #1'");
    expect(withoutPowerShellComments("[Console]::Write('a') # b")).toContain("[Console]::Write('a')");
  });

  test("the handler is subscribed before anything could create the handle", () => {
    // The layout measures wrapped lines through native TextBox handles. Subscribe on the
    // Form immediately after construction, before that layout can realize its handle.
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

    // Leave room for the executable/quoting below Windows' 32 767 character cap.
    // The native layout is constant; no project text is embedded in these arguments.
    expect(width(huge.argv)).toBeLessThan(30000);
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
