import { CommanderError, Command } from "commander";
import { readRegularProjectFile } from "../capsule/capsule.js";
import { sha256Text } from "../core/hash.js";
import { ForgeyardError } from "../core/errors.js";
import { serveNativeMcp } from "./mcp.js";
import { createProjectService, type ProjectService } from "./service.js";
import { nativeError } from "./store.js";
import { connectNativeClient, disconnectNativeClient, type NativeClient } from "./bindings.js";

export const NATIVE_COMMANDS = ["mcp", "tool", "consent", "human-review", "reconcile", "reconcile-install", "reconcile-writer", "reconcile-operation", "connect", "disconnect"];

async function readEnvelope(): Promise<unknown> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk as Uint8Array); bytes += buffer.length;
    if (bytes > 1_048_576) throw nativeError("FY_PROTOCOL_LIMIT", "JSON stdin exceeds one MiB.");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw nativeError("FY_PROTOCOL_INVALID", "Provide one complete strict JSON envelope on stdin."); }
}

export async function runNativeCli(args: readonly string[]): Promise<number> {
  let service: ProjectService | undefined;
  let serving = false;
  let server: Awaited<ReturnType<typeof serveNativeMcp>> | undefined;
  const stop = () => { void (async () => { await server?.close(); await service?.shutdown(); })(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const program = new Command().name("forgeyard").exitOverride().configureOutput({
    writeOut: (value) => process.stdout.write(value), writeErr: (value) => process.stderr.write(value),
  });
  const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const rootCommand = (name: string, description: string) => program.command(name).description(description).option("--root <path>", "Authorized project root", ".");
  for (const name of ["connect", "disconnect"] as const) rootCommand(name, name === "connect" ?
    "Connect this project to native Codex/Claude MCP without global settings, accounts or automatic trust." :
    "Remove only unchanged owned native binding blocks; retain the project harness.")
    .requiredOption("--client <client>", "codex or claude-code", (value: string): NativeClient => {
      if (value !== "codex" && value !== "claude-code") throw nativeError("FY_CLIENT_UNSUPPORTED", "Native MCP binding supports codex and claude-code only; other adapters remain descriptor-only.");
      return value;
    }).action(async (options: { root: string; client: NativeClient }) => {
      output(await (name === "connect" ? connectNativeClient(options) : disconnectNativeClient(options)));
    });
  rootCommand("mcp", "Serve project-bound MCP on stdio; stdout is protocol only.").option("--client <client>", "Bound native client: codex or claude-code")
    .action(async (options: { root: string; client?: string }) => {
    if (options.client !== undefined && options.client !== "codex" && options.client !== "claude-code")
      throw nativeError("FY_CLIENT_UNSUPPORTED", "Unknown native client.");
    service = await createProjectService({ root: options.root, ...(options.client ? { client: options.client } : {}) });
    server = await serveNativeMcp(service); serving = true;
  });
  rootCommand("tool", "Execute one protocol 0.2 JSON envelope; finite gate jobs finish before this fallback exits.").option("--json", "JSON output (always enabled)")
    .action(async (options: { root: string }) => {
      const envelope = await readEnvelope(); service = await createProjectService({ root: options.root });
      const response = await service.execute(envelope);
      await service.waitForOperations(); output(response);
    });
  for (const [name, description] of [["consent", "Display local human confirmation for the exact plan; no --yes."],
    ["reconcile", "Explicitly resume/transfer a cooperative writer after local confirmation; uncertainty blocks."]] as const) {
    rootCommand(name, description).requiredOption("--run <id>", "Stored product run ID").requiredOption("--session <id>", "Cooperative writer session")
      .action(async (options: { root: string; run: string; session: string }) => {
        service = await createProjectService({ root: options.root });
        output(name === "consent" ? await service.consent(options.run, options.session) : await service.reconcile(options.run, options.session));
      });
  }
  rootCommand("human-review", "Show the exact product diff, artifact and findings for a human review; no model approval flag.")
    .requiredOption("--run <id>", "Stored run ID").requiredOption("--session <id>", "Writer session").requiredOption("--artifact <path>", "Project-relative review artifact")
    .action(async (options: { root: string; run: string; session: string; artifact: string }) => {
      service = await createProjectService({ root: options.root });
      const content = await readRegularProjectFile(options.root, options.artifact, 131072);
      output(await service.humanReview(options.run, options.session, { path: options.artifact, sha256: sha256Text(content) }));
    });
  rootCommand("reconcile-install", "Resolve only a ceased exact installer after journal/capsule checks and local human confirmation; no replay.")
    .action(async (options: { root: string }) => { service = await createProjectService({ root: options.root }); output(await service.reconcileInstallation()); });
  rootCommand("reconcile-writer", "Recover an idle writer only when no product run exists; local confirmation, not expiry takeover.")
    .requiredOption("--session <id>", "New cooperative writer session")
    .action(async (options: { root: string; session: string }) => { service = await createProjectService({ root: options.root }); output(await service.reconcileWriter(options.session)); });
  rootCommand("reconcile-operation", "Mark a ceased HF gate unverified after known-process checks and human inspection; never kill native/foreign processes.")
    .requiredOption("--operation <id>", "Recorded HF gate operation ID")
    .action(async (options: { root: string; operation: string }) => { service = await createProjectService({ root: options.root }); output(await service.reconcileOperation(options.operation)); });
  try {
    await program.parseAsync([...args], { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    const failure = error instanceof ForgeyardError ? { code: error.code, message: error.message, remediation: error.remediation } :
      { code: "FY_NATIVE_FAILED", message: "The local native command failed; no raw error is disclosed." };
    process.stderr.write(`${JSON.stringify({ protocolVersion: "0.2", ok: false, error: failure })}\n`);
    return error instanceof ForgeyardError ? error.exitCode : 2;
  } finally {
    if (!serving) { await service?.close(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
  }
}
