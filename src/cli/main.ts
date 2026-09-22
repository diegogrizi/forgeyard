import { NATIVE_COMMANDS } from "../native/cli.js";
import { defaultDependencies, runCli } from "./program.js";

const args = process.argv.slice(2);
const first = args[0] ?? "";
// L'ingresso ordinario non richiede all'utente di scegliere una sequenza di comandi.
if (args.length === 0) {
  process.exitCode = await (await import("../workspace/entry.js")).runPersonalEntry();
} else if (first === "analizza") {
  process.exitCode = await (await import("../workspace/cli.js")).runWorkspaceCli(args.slice(1));
} else if (NATIVE_COMMANDS.includes(first)) {
  process.exitCode = await (await import("../native/cli.js")).runNativeCli(args);
} else {
  process.exitCode = await runCli(args, defaultDependencies);
}
