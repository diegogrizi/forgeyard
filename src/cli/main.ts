import { defaultDependencies, runCli } from "./program.js";

const args = process.argv.slice(2);
const native = ["mcp", "tool", "consent", "human-review", "reconcile", "connect", "disconnect"].includes(args[0] ?? "");
// L'ingresso ordinario non richiede all'utente di scegliere una sequenza di comandi.
if (args.length === 0) {
  process.exitCode = await (await import("../workspace/entry.js")).runPersonalEntry();
} else if (args[0] === "analizza") {
  process.exitCode = await (await import("../workspace/cli.js")).runWorkspaceCli(args.slice(1));
} else {
  process.exitCode = native ? await (await import("../native/cli.js")).runNativeCli(args) : await runCli(args, defaultDependencies);
}
