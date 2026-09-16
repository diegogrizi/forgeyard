import { defaultDependencies, runCli } from "./program.js";

const args = process.argv.slice(2);
const native = ["mcp", "tool", "consent", "human-review", "reconcile", "connect", "disconnect"].includes(args[0] ?? "");
process.exitCode = native ? await (await import("../native/cli.js")).runNativeCli(args) : await runCli(args, defaultDependencies);
