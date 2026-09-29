import path from "node:path";
import { execa } from "execa";

import type { HumanConfirmation, HumanDecision } from "./contracts.js";
import { nativeError } from "./store.js";
import type { ForgeyardError } from "../core/errors.js";
import { canonicalJson, sha256Text } from "../core/hash.js";

// This is a dedicated click channel, not a boolean accepted in a tool payload.
// Same-user malware can still forge UI/input: this is not a security boundary
// against another process with the user's full privileges.

/** The dialog stays open for minutes because a person is reading a whole plan. */
const DIALOG_TIMEOUT_MS = 300_000;

/** What the dialog process reported, reduced to what a decision may rest on. */
export interface DialogOutcome {
  /** `undefined` when the process never started or was killed: `execa` reports it that way. */
  exitCode: number | undefined;
  stdout: string;
  /** Set when the dialog did not run to completion: a launch error, a timeout, a signal. */
  failure?: string;
}

/** Everything needed to spawn the dialog. The payload is stdin, never an argument. */
export interface DialogCommand {
  executable: string;
  argv: readonly string[];
  /** Base64 of the UTF-8 payload. ASCII on the wire, so no console code page can alter it. */
  stdin: string;
}

export type DialogSpawn = (command: DialogCommand) => Promise<DialogOutcome>;

/**
 * The script is a constant, and the payload it renders arrives on stdin.
 *
 * Windows caps a command line at 32767 characters. `-EncodedCommand` is UTF-16 then base64,
 * which is 8/3 of whatever it carries, and the plan was itself base64 of UTF-8 inside it, so
 * the dialog text reached the cap at about 8160 characters: measured on Windows 11, 8156
 * characters produced 32680 argument characters and launched, 8191 produced 32796 and failed
 * to launch with `ENAMETOOLONG`. A plan with a dozen tasks and their criteria passes that in
 * ordinary use. Reading the payload here instead of embedding it keeps the argument vector a
 * constant that no plan can grow, and writes nothing to disk.
 *
 * `MaxLength` is set because the control's default is 32767. Measured: that default does not
 * truncate a programmatic assignment, not even once the handle is realized. It is pinned
 * anyway — the text shown must be byte for byte what the service composed, and that promise
 * should not rest on an undocumented behaviour of one Windows build.
 *
 * Three rules here exist because each was measured failing.
 *
 * `$ErrorActionPreference` and the trap: without them a payload that is not base64, or not
 * JSON, left `$dialogData` null and execution carried on — a window with an empty title, an
 * empty body and two working buttons, exiting 0. A consent grant would then bind the hash of
 * a plan the person was never shown. Exit 3 instead, which reads as unavailable.
 *
 * `realized:` written from `HandleCreated`: `ShowDialog()` was measured returning `Yes` with
 * `IsHandleCreated: False`, i.e. an approval from a modal loop that never ran. The token is
 * emitted the moment the window actually exists, so a decision word only counts alongside
 * proof that there was a window to decide in. It is written as it happens, not buffered to
 * the end, so it can be observed on stdout while the dialog is still open.
 *
 * `No` and `Cancel` named explicitly: the `else` that used to close this branch reported
 * `rejected` for every non-`Yes` value, `DialogResult::None` included — and `None` is what a
 * `ShowDialog` that never pumped returns. That is the same defect as inferring a refusal
 * from a failed launch, one layer down, on the denial side.
 */
const DIALOG_SCRIPT = `$ProgressPreference = 'SilentlyContinue'
      $ErrorActionPreference = 'Stop'
      trap { exit 3 }
      Add-Type -AssemblyName System.Windows.Forms
      $dialogData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())) | ConvertFrom-Json
      if ($null -eq $dialogData -or $null -eq $dialogData.message -or $null -eq $dialogData.title) { exit 3 }
      $dialogForm = New-Object Windows.Forms.Form
      $dialogForm.Text = $dialogData.title
      $dialogForm.Width = 760; $dialogForm.Height = 600; $dialogForm.StartPosition = 'CenterScreen'
      $dialogText = New-Object Windows.Forms.TextBox
      $dialogText.Multiline = $true; $dialogText.ReadOnly = $true; $dialogText.ScrollBars = 'Vertical'
      $dialogText.MaxLength = 0
      $dialogText.Text = $dialogData.message; $dialogText.SetBounds(12,12,720,490)
      $dialogApprove = New-Object Windows.Forms.Button
      $dialogApprove.Text = 'Approve'; $dialogApprove.SetBounds(480,515,120,32)
      $dialogApprove.DialogResult = [Windows.Forms.DialogResult]::Yes
      $dialogReject = New-Object Windows.Forms.Button
      $dialogReject.Text = 'Reject'; $dialogReject.SetBounds(612,515,120,32)
      $dialogReject.DialogResult = [Windows.Forms.DialogResult]::No
      $dialogForm.Controls.AddRange(@($dialogText,$dialogApprove,$dialogReject))
      $dialogForm.CancelButton = $dialogReject
      $dialogForm.Add_HandleCreated({ [Console]::Write('realized:') })
      $dialogOutcome = $dialogForm.ShowDialog()
      if ($dialogOutcome -eq [Windows.Forms.DialogResult]::Yes) { [Console]::Write('approved') } elseif ($dialogOutcome -eq [Windows.Forms.DialogResult]::No -or $dialogOutcome -eq [Windows.Forms.DialogResult]::Cancel) { [Console]::Write('rejected') }
      $dialogForm.Dispose()`;

/** Exactly what the service composed. Never shortened: the transport adapts to the text. */
function dialogMessage(input: Parameters<HumanConfirmation>[0]): string {
  return `${input.description}\n\nRun: ${input.plan.id}\n${input.plan.request}\n` +
    `Capsule: ${input.capsule.id}\nRisk: ${input.plan.risk}\nPlan hash: ${sha256Text(canonicalJson(input.plan))}\n` +
    `Exact plan (requirements, tasks, dependencies and criteria):\n${JSON.stringify(input.plan, null, 2)}\n` +
    `Write scopes: ${[...new Set(input.plan.tasks.flatMap((task) => task.writeScopes))].join(", ")}\n` +
    `Gates (project scripts may have effects; native permissions remain authoritative):\n` +
    input.capsule.payload.gates.map((gate) => `${gate.id} cwd=${gate.cwd ?? "."} ${JSON.stringify(gate.argv)}`).join("\n") +
    `\n\nTimebox: ${input.capsule.payload.policy.timeboxMinutes} minutes\n` +
    `Recorded cost ceiling: ${input.capsule.payload.policy.maxRecordedCostUsd ?? "not set"}. ` +
    "Actual provider cost/quotas are not measurable or enforceable by Forgeyard.\n" +
    "No account settings, AI sessions or external publishing are authorized by this confirmation.";
}

/** Pure: the spawn is elsewhere, so the size of what this builds can be asserted by a test. */
export function windowsDialogCommand(input: Parameters<HumanConfirmation>[0]): DialogCommand {
  const payload = JSON.stringify({ title: input.title, message: dialogMessage(input) });
  return {
    executable: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
    argv: ["-NoLogo", "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand",
      Buffer.from(DIALOG_SCRIPT, "utf16le").toString("base64")],
    stdin: Buffer.from(payload, "utf8").toString("base64"),
  };
}

function unavailable(detail: string): ForgeyardError {
  return nativeError("FY_CONFIRMATION_UNAVAILABLE",
    `The local confirmation dialog could not be shown, so nobody was asked and nothing was rejected: ${detail}. ` +
    "No terminal boolean will be promoted to human consent. Check that Windows PowerShell can start " +
    "(powershell.exe on PATH, execution of an encoded command allowed, an interactive desktop session), then ask again.");
}

/**
 * A dialog that never appeared is not a person saying no.
 *
 * `execa` runs with `reject: false`, so a failure to launch, a timeout and a crash all arrive
 * as ordinary resolved values. Folding them into `accepted: false` made the caller answer
 * `FY_APPROVAL_DENIED — the local human confirmation was rejected`, naming a refusal by
 * somebody who was never asked. Only a clean run whose window existed and was answered is a
 * decision; every other outcome is declared unavailable instead of inferred to be one.
 */
export function dialogDecision(outcome: DialogOutcome): HumanDecision {
  if (outcome.failure !== undefined) throw unavailable(outcome.failure);
  if (outcome.exitCode !== 0) throw unavailable(`the dialog exited with code ${outcome.exitCode ?? "none"}`);
  // `realized:` comes from `HandleCreated`, so it is present only if a window existed to be
  // answered. The script reports `rejected` for the Reject button and for closing the window
  // alike, so that branch is a decision and must stay a returned value, not an error.
  if (outcome.stdout === "realized:rejected") return { accepted: false, channel: "local-dialog" };
  if (outcome.stdout === "realized:approved") return { accepted: true, channel: "local-dialog" };
  // Measured: `ShowDialog()` can return `Yes` having never created a handle. A decision word
  // without the realization token is that case, and it is the one outcome that must never be
  // mistaken for consent, so it is named rather than folded into the generic refusal.
  if (outcome.stdout === "approved" || outcome.stdout === "rejected") {
    throw unavailable("the dialog reported a decision from a window that was never realized");
  }
  throw unavailable("the dialog ended without reporting a decision");
}

/** What `execa` reports about a failed run, reduced to what naming the cause needs. */
export interface DialogProcessReport {
  exitCode?: number | undefined;
  timedOut: boolean;
  isTerminated: boolean;
  code?: string | undefined;
  signal?: string | undefined;
}

/**
 * Names the cause in one short clause.
 *
 * Not `execa`'s own `shortMessage`: that quotes the whole command line, and the command line
 * ends in the base64 of the script, so the refusal a person reads arrived with about four
 * kilobytes of base64 glued to it. A cause is an identifier plus an action, not a transcript.
 */
export function dialogFailureCause(report: DialogProcessReport): string {
  if (report.code !== undefined) return `the dialog process could not be started (${report.code})`;
  if (report.timedOut) return `no decision arrived within ${DIALOG_TIMEOUT_MS / 1000} seconds`;
  if (report.isTerminated) return `the dialog process was terminated (${report.signal ?? "no signal reported"})`;
  return `the dialog process exited with code ${report.exitCode ?? "none"}`;
}

const powershellDialogSpawn: DialogSpawn = async (command) => {
  const result = await execa(command.executable, [...command.argv],
    { shell: false, input: command.stdin, reject: false, timeout: DIALOG_TIMEOUT_MS });
  if (!result.failed) return { exitCode: result.exitCode, stdout: result.stdout };
  return { exitCode: result.exitCode, stdout: result.stdout, failure: dialogFailureCause(result) };
};

/** Platform-free so the decision rules can be exercised where no dialog can be shown. */
export async function windowsDialogConfirmation(
  input: Parameters<HumanConfirmation>[0],
  spawn: DialogSpawn = powershellDialogSpawn,
): Promise<HumanDecision> {
  let outcome: DialogOutcome;
  try {
    outcome = await spawn(windowsDialogCommand(input));
  } catch (error) {
    throw unavailable(error instanceof Error ? error.message : String(error));
  }
  return dialogDecision(outcome);
}

export const localDialogConfirmation: HumanConfirmation = async (input) => {
  if (process.platform === "win32") return windowsDialogConfirmation(input);
  throw nativeError("FY_CONFIRMATION_UNAVAILABLE", "A verified local confirmation adapter is not implemented for this OS. No terminal boolean will be promoted to human consent.");
};
