import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { createCodexAdapter } from "../adapters/codex.js";
import { loadConfig } from "../config/config.js";
import type { CheckResult, DoctorReport, PlannedFile } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";
import { loadInstallManifest, type InstallManifest } from "../installer/manifest.js";
import { scanGeneratedContent } from "./content-audit.js";

interface LockComponent {
  id: string;
  targetPath: string;
  targetSha256: string;
}

interface LockDocument {
  schemaVersion: 1;
  forgeyardVersion: string;
  profile: { id: "hackathon"; version: string };
  adapter: "codex";
  components: LockComponent[];
}

export interface DoctorInput {
  root: string;
  denyTerms?: readonly string[];
  realClient?: boolean;
  commandLookup?: (name: string) => Promise<boolean>;
}

function passed(id: string, message: string, required = true): CheckResult {
  return { id, status: "passed", required, message };
}

function failed(id: string, message: string, paths?: readonly string[]): CheckResult {
  return {
    id,
    status: "failed",
    required: true,
    message,
    remediation: "Correct the reported installed state and run doctor again.",
    ...(paths === undefined || paths.length === 0 ? {} : { paths }),
  };
}

function errorPaths(error: unknown): readonly string[] | undefined {
  return error instanceof ForgeyardError ? error.paths : undefined;
}

function parseLock(source: string): LockDocument {
  const value: unknown = JSON.parse(source);
  if (
    typeof value !== "object" ||
    value === null ||
    (value as Record<string, unknown>).schemaVersion !== 1 ||
    typeof (value as Record<string, unknown>).forgeyardVersion !== "string" ||
    (value as Record<string, unknown>).adapter !== "codex" ||
    !Array.isArray((value as Record<string, unknown>).components)
  ) {
    throw new TypeError("Lock file has an invalid structure.");
  }
  return value as LockDocument;
}

async function defaultCommandLookup(name: string): Promise<boolean> {
  const pathValue = process.env.PATH ?? "";
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      try {
        await access(path.join(directory, `${name}${extension.toLocaleLowerCase("en-US")}`));
        return true;
      } catch {
        // Continue searching without executing the candidate.
      }
    }
  }
  return false;
}

async function checkManagedFiles(root: string, manifest: InstallManifest, lock: LockDocument): Promise<CheckResult> {
  const allowed = new Set([
    "forgeyard.config",
    "forgeyard.lock",
    "forgeyard.runtime-ignore",
    ...lock.components.map((component) => component.id),
  ]);
  const failures: string[] = [];
  for (const record of manifest.files) {
    if (!allowed.has(record.componentId)) {
      failures.push(record.path);
      continue;
    }
    const filePath = resolveInsideRoot(root, record.path);
    try {
      const source = await readFile(filePath, "utf8");
      if (record.ownership === "managed" && sha256Text(source) !== record.installedSha256) failures.push(record.path);
    } catch {
      failures.push(record.path);
    }
  }
  return failures.length === 0
    ? passed("managed-files", "Managed payload hashes and seed presence are valid.")
    : failed("managed-files", "Managed payload drift or unknown ownership was detected.", failures.sort());
}

async function checkCodexOutput(root: string, manifest: InstallManifest): Promise<CheckResult> {
  try {
    const foundation = manifest.files.filter((record) => record.componentId.startsWith("foundation."));
    const files: PlannedFile[] = await Promise.all(
      foundation.map(async (record) => {
        const content = await readFile(resolveInsideRoot(root, record.path), "utf8");
        return {
          path: record.path,
          content,
          sha256: sha256Text(content),
          componentId: record.componentId,
          ownership: record.ownership,
        };
      }),
    );
    await createCodexAdapter().validateOutput(files);
    return passed("codex-output", "Codex instructions, skill, reviewer, and task are structurally valid.");
  } catch (error) {
    return failed("codex-output", "Codex generated output is missing or structurally invalid.", errorPaths(error));
  }
}

export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  const root = path.resolve(input.root);
  const checks: CheckResult[] = [];
  let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
  let manifest: InstallManifest | undefined;
  let lock: LockDocument | undefined;

  try {
    config = await loadConfig(path.join(root, "forgeyard.yaml"));
    checks.push(passed("config", "Human-owned configuration is valid and portable."));
  } catch (error) {
    checks.push(failed("config", "Human-owned configuration is missing or invalid.", errorPaths(error)));
  }

  try {
    manifest = await loadInstallManifest(root);
    checks.push(passed("manifest", "Install manifest is valid."));
  } catch (error) {
    checks.push(failed("manifest", "Install manifest is missing or invalid.", errorPaths(error)));
  }

  try {
    lock = parseLock(await readFile(path.join(root, "forgeyard.lock"), "utf8"));
    checks.push(passed("lock", "Resolver lock is valid."));
  } catch {
    checks.push(failed("lock", "Resolver lock is missing or invalid.", ["forgeyard.lock"]));
  }

  if (config !== undefined && manifest !== undefined && lock !== undefined) {
    const agrees =
      config.profile === manifest.profile &&
      config.harnesses.includes(manifest.adapter) &&
      lock.profile.id === manifest.profile &&
      lock.adapter === manifest.adapter &&
      lock.forgeyardVersion === manifest.forgeyardVersion;
    checks.push(
      agrees
        ? passed("state-agreement", "Configuration, lock, and manifest select the same install state.")
        : failed("state-agreement", "Configuration, lock, and manifest disagree."),
    );
  } else {
    checks.push(failed("state-agreement", "State agreement cannot be established because required metadata is invalid."));
  }

  if (manifest !== undefined && lock !== undefined) {
    checks.push(await checkManagedFiles(root, manifest, lock));
    checks.push(await checkCodexOutput(root, manifest));
    const findings = await scanGeneratedContent({
      root,
      paths: manifest.files.map((record) => record.path),
      denyTerms: input.denyTerms ?? [],
    });
    checks.push(
      findings.length === 0
        ? passed("content-audit", "Generated content passed local policy checks.")
        : failed(
            "content-audit",
            "Generated content violates one or more local policy rules.",
            [...new Set(findings.map((finding) => finding.path))],
          ),
    );
  } else {
    checks.push(failed("managed-files", "Managed payload cannot be checked because install metadata is invalid."));
    checks.push(failed("codex-output", "Codex output cannot be checked because install metadata is invalid."));
    checks.push(failed("content-audit", "Generated content cannot be audited because install metadata is invalid."));
  }

  const lookup = input.commandLookup ?? defaultCommandLookup;
  const codexAvailable = await lookup("codex").catch(() => false);
  checks.push(
    codexAvailable
      ? passed("codex-executable", "Codex executable is discoverable without invoking it.", false)
      : {
          id: "codex-executable",
          status: "unavailable",
          required: false,
          message: "Codex executable is not available on this host; structural validation still ran.",
        },
  );
  checks.push({
    id: "codex-roundtrip",
    status: "skipped",
    required: false,
    message: input.realClient
      ? "Real-client roundtrip is not implemented in M1 and was not claimed."
      : "Real-client roundtrip was not requested; structural validation ran instead.",
  });

  return {
    schemaVersion: 1,
    ok: checks.filter((check) => check.required).every((check) => check.status === "passed"),
    root,
    checks,
  };
}
