import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// Ogni prova di questo file esegue la CLI compilata su un progetto vero: composizione del
// registro, rendering, applicazione transazionale e doctor. Misurato su questa macchina,
// `init --profile hackathon` da solo costa 40,8 s, contro un tetto globale di 30 s tarato
// sui test unitari. Un tetto piu' stretto del lavoro che delimita segnala un difetto che
// non c'e'.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

import type {
  InitCommandResult,
  UpdateCommandResult,
  VerifyCommandResult,
} from "../../src/application/forgeyard.js";
import { getReceiptStatus, parseReceipt } from "../../src/evidence/receipts.js";
import { loadConfig, serializeConfig } from "../../src/config/config.js";
import { loadInstallManifest } from "../../src/installer/manifest.js";
import { buildCli, runBuiltCli, runProcess } from "../helpers/cli.js";

const repositoryRoot = path.resolve(".");
const answersPath = path.join(repositoryRoot, "fixtures", "answers", "hackathon.yaml");
const minimalAnswersPath = path.join(repositoryRoot, "fixtures", "answers", "minimal.yaml");
let sandboxRoot: string;
let targetRoot: string;
let initialOperationId: string;
let verificationReceiptId: string;

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function fileTree(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, ...relative.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await fileTree(root, next));
    else files.push(next);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function parseJson<T>(source: string): T {
  return JSON.parse(source) as T;
}

async function requireProcess(executable: string, args: readonly string[], cwd: string): Promise<void> {
  const result = await runProcess(executable, args, cwd);
  expect(result, `${executable} ${args.join(" ")}\n${result.stderr}`).toEqual(
    expect.objectContaining({ exitCode: 0 }),
  );
}

beforeAll(async () => {
  await buildCli(repositoryRoot);
  sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "forgeyard-cli-roundtrip-"));
  targetRoot = path.join(sandboxRoot, "generated-project");
}, 60_000);

afterAll(async () => {
  if (sandboxRoot !== undefined) await rm(sandboxRoot, { recursive: true, force: true });
});

describe("built Forgeyard CLI round trip", () => {
  test("dry-run resolves and validates without creating the target", async () => {
    const result = await runBuiltCli(
      repositoryRoot,
      [
        "init",
        targetRoot,
        "--profile",
        "hackathon",
        "--adapter",
        "codex",
        "--answers",
        answersPath,
        "--dry-run",
        "--json",
      ],
      sandboxRoot,
    );
    const output = parseJson<InitCommandResult>(result.stdout);

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output).toEqual(expect.objectContaining({ command: "init", applied: false, status: "preview" }));
    expect(output.changes.created).toHaveLength(345);
    expect(output.changes.created).toContain(".forgeyard/capsule.json");
    expect(await exists(targetRoot)).toBe(false);
  });

  test("applied init produces the exact generic factory tree", async () => {
    const result = await runBuiltCli(
      repositoryRoot,
      [
        "init",
        targetRoot,
        "--profile",
        "hackathon",
        "--adapter",
        "codex",
        "--answers",
        answersPath,
        "--yes",
        "--json",
      ],
      sandboxRoot,
    );
    const output = parseJson<InitCommandResult>(result.stdout);
    initialOperationId = output.operationId;

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output).toEqual(expect.objectContaining({ command: "init", applied: true, status: "applied" }));
    expect(output.doctor).toEqual(expect.objectContaining({ failed: 0 }));
    const installedTree = await fileTree(targetRoot);
    expect(installedTree).toEqual(expect.arrayContaining([
      ".agents/skills/forgeyard-showcase/SKILL.md",
      ".agents/skills/forgeyard-workflow/SKILL.md",
      ".codex/agents/reviewer.toml",
      ".forgeyard/.gitignore",
      ".forgeyard/manifest.json",
      `.forgeyard/state/operations/${initialOperationId}.json`,
      ".forgeyard/tasks/T001.yaml",
      ".forgeyard/tasks/T002.yaml",
      ".forgeyard/tasks/T003.yaml",
      ".forgeyard/tasks/T004.yaml",
      ".forgeyard/COMPOSITION.md",
      ".forgeyard/knowledge/README.md",
      ".forgeyard/decisions/0000-template.md",
      ".forgeyard/handoffs/CURRENT.md",
      ".forgeyard/reports/RUN_REPORT.md",
      ".forgeyard/usage/README.md",
      "AGENTS.md",
      "PROJECT.md",
      "forgeyard.lock",
      "forgeyard.yaml",
      "presentation/app.js",
      "presentation/index.html",
      "presentation/README.md",
      "presentation/styles.css",
      ".forgeyard/catalog/ecosystem.json",
      ".forgeyard/licenses/wshobson-agents.LICENSE",
    ]));
    expect(installedTree).toHaveLength(347);
    const manifest = await loadInstallManifest(targetRoot);
    expect(manifest.files).toHaveLength(345);
    expect(manifest.files.filter((file) => file.path.startsWith(".codex/agents/")).length).toBe(52);
    expect(manifest.files.filter((file) => file.path.endsWith("/SKILL.md")).length).toBe(119);

    for (const relativePath of [
      "AGENTS.md",
      "presentation/app.js",
      "presentation/index.html",
      "presentation/README.md",
      "presentation/styles.css",
    ]) {
      expect(await readFile(path.join(targetRoot, ...relativePath.split("/")), "utf8")).toBe(
        await readFile(path.join(repositoryRoot, "fixtures", "golden", "codex-hackathon", ...relativePath.split("/")), "utf8"),
      );
    }
  });

  test("minimal profile preserves the small kernel without catalog or presentation payloads", async () => {
    const minimalTargetRoot = path.join(sandboxRoot, "minimal-project");
    const result = await runBuiltCli(
      repositoryRoot,
      [
        "init",
        minimalTargetRoot,
        "--profile",
        "minimal",
        "--adapter",
        "codex",
        "--answers",
        minimalAnswersPath,
        "--yes",
        "--json",
      ],
      sandboxRoot,
    );
    const output = parseJson<InitCommandResult>(result.stdout);
    const manifest = await loadInstallManifest(minimalTargetRoot);

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output.doctor).toEqual(expect.objectContaining({ failed: 0 }));
    expect(manifest.profile).toBe("minimal");
    expect(manifest.files).toHaveLength(10);
    expect(manifest.files.filter((file) => file.path.startsWith(".codex/agents/"))).toHaveLength(1);
    expect(manifest.files.filter((file) => file.path.endsWith("/SKILL.md"))).toHaveLength(1);
    expect(manifest.files.some((file) => file.path.startsWith("presentation/"))).toBe(false);
    expect(manifest.files.some((file) => file.componentId.startsWith("ecosystem."))).toBe(false);
  }, 30_000);

  test("doctor reports the installed factory in plain and JSON modes", async () => {
    const plain = await runBuiltCli(repositoryRoot, ["doctor", targetRoot], sandboxRoot);
    const json = await runBuiltCli(repositoryRoot, ["doctor", targetRoot, "--json"], sandboxRoot);

    expect(plain).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(plain.stdout).toContain("Forgeyard doctor: passed");
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({ schemaVersion: 1, ok: true, command: "doctor" }));
  });

  test("verification writes current revision-bound evidence without output bodies", async () => {
    await writeFile(path.join(targetRoot, "sentinel.txt"), "unrelated\n", "utf8");
    await requireProcess("git", ["init"], targetRoot);
    await requireProcess("git", ["add", "--all"], targetRoot);
    await requireProcess(
      "git",
      [
        "-c",
        "user.name=Forgeyard Roundtrip",
        "-c",
        "user.email=forgeyard-roundtrip@example.invalid",
        "commit",
        "-m",
        "roundtrip fixture",
      ],
      targetRoot,
    );

    const result = await runBuiltCli(repositoryRoot, ["verify", "T001", "--root", targetRoot, "--json"], sandboxRoot);
    const output = parseJson<VerifyCommandResult>(result.stdout);
    const receiptSource = await readFile(path.join(targetRoot, ...output.receiptPath.split("/")), "utf8");
    const receipt = parseReceipt(receiptSource, output.receiptPath);
    verificationReceiptId = receipt.receiptId;

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output).toEqual(expect.objectContaining({ command: "verify", taskId: "T001", current: true }));
    expect(output.stdoutBytes).toBe(0);
    expect(output.stderrBytes).toBe(0);
    expect(receipt).not.toHaveProperty("stdout");
    expect(receipt).not.toHaveProperty("stderr");
    expect(await getReceiptStatus(targetRoot, receipt)).toBe("current");
  });

  test("dry-run and applied update are deterministic no-ops", async () => {
    const before = await fileTree(targetRoot);
    const dryRun = await runBuiltCli(repositoryRoot, ["update", targetRoot, "--dry-run", "--json"], sandboxRoot);
    const applied = await runBuiltCli(repositoryRoot, ["update", targetRoot, "--yes", "--json"], sandboxRoot);
    const dryOutput = parseJson<UpdateCommandResult>(dryRun.stdout);
    const appliedOutput = parseJson<UpdateCommandResult>(applied.stdout);

    expect(dryRun.exitCode).toBe(0);
    expect(applied.exitCode).toBe(0);
    expect(dryOutput).toEqual(expect.objectContaining({ applied: false, status: "no-op" }));
    expect(appliedOutput).toEqual(expect.objectContaining({ applied: false, status: "no-op" }));
    expect(dryOutput.changes).toEqual(appliedOutput.changes);
    expect(await fileTree(targetRoot)).toEqual(before);
  });

  test("doctor rejects an in-memory generic term without echoing it", async () => {
    const denyTerm = "trustworthy";
    const result = await runBuiltCli(
      repositoryRoot,
      ["doctor", targetRoot, "--deny-term", denyTerm, "--json"],
      sandboxRoot,
    );

    expect(result.exitCode).toBe(6);
    expect(parseJson<{ ok: false; error: { code: string } }>(result.stdout).error.code).toBe("FY_DOCTOR_FAILED");
    expect(`${result.stdout}\n${result.stderr}`.toLocaleLowerCase("en-US")).not.toContain(denyTerm);
  });

  test("rollback removes managed files and preserves the seed and unrelated files", async () => {
    const result = await runBuiltCli(
      repositoryRoot,
      ["rollback", initialOperationId, "--root", targetRoot, "--yes", "--json"],
      sandboxRoot,
    );
    const output = parseJson<{ applied: boolean; changes: { removed: string[] } }>(result.stdout);
    const manifest = await loadInstallManifest(targetRoot);

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output.applied).toBe(true);
    expect(await readFile(path.join(targetRoot, "forgeyard.yaml"), "utf8")).toBe(
      serializeConfig(await loadConfig(answersPath)),
    );
    expect(await readFile(path.join(targetRoot, "sentinel.txt"), "utf8")).toBe("unrelated\n");
    expect(manifest.files.map((file) => file.path)).toEqual([
      "forgeyard.yaml",
      ".forgeyard/.gitignore",
      "PROJECT.md",
      ".forgeyard/handoffs/CURRENT.md",
      ".forgeyard/reports/RUN_REPORT.md",
    ]);
    for (const relativePath of output.changes.removed) {
      expect(await exists(path.join(targetRoot, ...relativePath.split("/"))), relativePath).toBe(false);
    }
  });
});
