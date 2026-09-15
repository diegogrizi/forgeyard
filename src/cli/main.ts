import { defaultDependencies, runCli } from "./program.js";

process.exitCode = await runCli(process.argv.slice(2), defaultDependencies);
