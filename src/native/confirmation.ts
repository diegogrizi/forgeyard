import path from "node:path";
import { execa } from "execa";

import type { HumanConfirmation } from "./contracts.js";
import { nativeError } from "./store.js";
import { canonicalJson, sha256Text } from "../core/hash.js";

// This is a dedicated click channel, not a boolean accepted in a tool payload.
// Same-user malware can still forge UI/input: this is not a security boundary
// against another process with the user's full privileges.
export const localDialogConfirmation: HumanConfirmation = async (input) => {
  const message = `${input.description}\n\nRun: ${input.plan.id}\n${input.plan.request}\n` +
    `Capsule: ${input.capsule.id}\nRisk: ${input.plan.risk}\nPlan hash: ${sha256Text(canonicalJson(input.plan))}\n` +
    `Exact plan (requirements, tasks, dependencies and criteria):\n${JSON.stringify(input.plan, null, 2)}\n` +
    `Write scopes: ${[...new Set(input.plan.tasks.flatMap((task) => task.writeScopes))].join(", ")}\n` +
    `Gates (project scripts may have effects; native permissions remain authoritative):\n` +
    input.capsule.payload.gates.map((gate) => `${gate.id} cwd=${gate.cwd ?? "."} ${JSON.stringify(gate.argv)}`).join("\n") +
    `\n\nTimebox: ${input.capsule.payload.policy.timeboxMinutes} minutes\n` +
    `Recorded cost ceiling: ${input.capsule.payload.policy.maxRecordedCostUsd ?? "not set"}. ` +
    "Actual provider cost/quotas are not measurable or enforceable by Forgeyard.\n" +
    "No account settings, AI sessions or external publishing are authorized by this confirmation.";
  if (process.platform === "win32") {
    const encoded = Buffer.from(JSON.stringify({ title: input.title, message }), "utf8").toString("base64");
    const script = `Add-Type -AssemblyName System.Windows.Forms
      $dialogData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
      $dialogForm = New-Object Windows.Forms.Form
      $dialogForm.Text = $dialogData.title
      $dialogForm.Width = 760; $dialogForm.Height = 600; $dialogForm.StartPosition = 'CenterScreen'
      $dialogText = New-Object Windows.Forms.TextBox
      $dialogText.Multiline = $true; $dialogText.ReadOnly = $true; $dialogText.ScrollBars = 'Vertical'
      $dialogText.Text = $dialogData.message; $dialogText.SetBounds(12,12,720,490)
      $dialogApprove = New-Object Windows.Forms.Button
      $dialogApprove.Text = 'Approve'; $dialogApprove.SetBounds(480,515,120,32)
      $dialogApprove.DialogResult = [Windows.Forms.DialogResult]::Yes
      $dialogReject = New-Object Windows.Forms.Button
      $dialogReject.Text = 'Reject'; $dialogReject.SetBounds(612,515,120,32)
      $dialogReject.DialogResult = [Windows.Forms.DialogResult]::No
      $dialogForm.Controls.AddRange(@($dialogText,$dialogApprove,$dialogReject))
      $dialogForm.CancelButton = $dialogReject
      if ($dialogForm.ShowDialog() -eq [Windows.Forms.DialogResult]::Yes) { [Console]::Write('approved') } else { [Console]::Write('rejected') }
      $dialogForm.Dispose()`;
    const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const result = await execa(executable, ["-NoLogo", "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64")], { shell: false, stdin: "ignore", reject: false, timeout: 300000 });
    return { accepted: result.exitCode === 0 && result.stdout === "approved", channel: "local-dialog" };
  }
  throw nativeError("FY_CONFIRMATION_UNAVAILABLE", "A verified local confirmation adapter is not implemented for this OS. No terminal boolean will be promoted to human consent.");
};
