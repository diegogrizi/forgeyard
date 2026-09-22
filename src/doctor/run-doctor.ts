import { access, lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { createHarnessAdapter } from "../adapters/create.js";
import { loadConfig } from "../config/config.js";
import {
  HARNESS_IDS,
  type CheckResult,
  type DoctorReport,
  type HarnessId,
  type PlannedFile,
  type ProfileId,
} from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { normalizePortablePath, resolveInsideRoot } from "../core/paths.js";
import { loadInstallManifest, type InstallManifest } from "../installer/manifest.js";
import { scanGeneratedContent } from "./content-audit.js";
import { auditPresentationBundle } from "./presentation-audit.js";
import { readCapsule, readRegularProjectFile, type Capsule } from "../capsule/capsule.js";
import {
  currentProfileFromInspection,
  frozenProfileFromCapsule,
  scanDrift,
  type DriftKind,
  type DriftReport,
  type FrozenProfile,
} from "../drift/scan.js";
import { inspectProject } from "../intake/inspect.js";

interface LockComponent {
  id: string;
  sourceComponentId?: string;
  targetPath: string;
  targetSha256: string;
}

interface LockDocument {
  schemaVersion: 1;
  forgeyardVersion: string;
  profile: { id: ProfileId; version: string };
  adapter: HarnessId;
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
    !HARNESS_IDS.includes((value as Record<string, unknown>).adapter as HarnessId) ||
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
    "forgeyard.capsule",
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

async function checkHarnessOutput(root: string, manifest: InstallManifest): Promise<CheckResult> {
  const label = manifest.adapter === "claude-code" ? "Claude Code" : "Codex";
  try {
    const adapterFiles = manifest.files.filter(
      (record) =>
        record.componentId.startsWith("foundation.") ||
        record.componentId.startsWith("presentation.") ||
        record.componentId.startsWith("ecosystem."),
    );
    const files: PlannedFile[] = await Promise.all(
      adapterFiles.map(async (record) => {
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
    await createHarnessAdapter(manifest.adapter).validateOutput(files);
    return passed(`${manifest.adapter}-output`, `${label} instructions, capabilities, task, and presentation are structurally valid.`);
  } catch (error) {
    return failed(`${manifest.adapter}-output`, `${label} generated output is missing or structurally invalid.`, errorPaths(error));
  }
}

async function checkPresentationOutput(
  root: string,
  directory: string,
  denyTerms: readonly string[],
): Promise<CheckResult> {
  try {
    const findings = await auditPresentationBundle({ root, directory, denyTerms });
    return findings.length === 0
      ? passed("presentation-output", "Presentation output is offline, accessible, responsive, and identity-neutral.")
      : failed(
          "presentation-output",
          "Presentation output violates one or more bundle rules.",
          [...new Set(findings.map((finding) => finding.path))].sort(),
        );
  } catch {
    return failed("presentation-output", "Presentation output could not be audited safely.", [directory]);
  }
}

const DRIFT_CHECK_ID = "harness-drift";
const DRIFT_FINDINGS_IN_MESSAGE = 3;

/** Finding kinds whose subject is a project-relative path, and only those, are reported as paths. */
const DRIFT_PATH_SUBJECTS: ReadonlySet<DriftKind> = new Set<DriftKind>([
  "harness-file-changed",
  "harness-file-unreadable",
  "mutable-root-missing",
]);

/**
 * Root-confined presence probe that refuses to traverse a symbolic link, exactly like the capsule
 * reader. The bounded inspection never walks `.git`, `node_modules` or `vendor`, which are exactly
 * the paths a capsule protects, so protected paths and mutable roots need their own confirmation or
 * every capsule would report a missing protected path. A path that cannot be confirmed is left out:
 * presence is never invented for the scan.
 */
export async function presentHarnessPaths(root: string, candidates: readonly string[]): Promise<readonly string[]> {
  const present: string[] = [];
  for (const candidate of candidates) {
    try {
      const portable = normalizePortablePath(candidate);
      let traversed = false;
      let cursor = "";
      for (const segment of portable === "." ? [] : portable.split("/")) {
        cursor = cursor === "" ? segment : `${cursor}/${segment}`;
        if ((await lstat(resolveInsideRoot(root, cursor))).isSymbolicLink()) {
          traversed = true;
          break;
        }
      }
      if (!traversed) present.push(portable);
    } catch {
      // Absent, unreadable or outside the root: report nothing rather than claim it exists.
    }
  }
  return present;
}

/**
 * Current digests of the harness files the capsule froze, read bounded and root-confined. An absent,
 * irregular or symlinked file is `null`, which the scan reports as `harness-file-unreadable`: a
 * read-only diagnostic never throws because a project file went missing.
 */
export async function harnessFileDigests(
  root: string,
  files: FrozenProfile["files"],
): Promise<Record<string, string | null>> {
  const digests: Record<string, string | null> = {};
  for (const file of files) {
    try {
      digests[file.path] = sha256Text(await readRegularProjectFile(root, file.path));
    } catch {
      digests[file.path] = null;
    }
  }
  return digests;
}

function driftCounts(report: DriftReport): string {
  return `${report.counts.blocking} blocking, ${report.counts.important} important, ` +
    `${report.counts.informational} informational`;
}

/** The first findings only: a check message has to stay readable, the report carries the rest. */
function driftHeadline(report: DriftReport): string {
  const shown = report.findings
    .slice(0, DRIFT_FINDINGS_IN_MESSAGE)
    .map((finding) => `${finding.kind} '${finding.subject}'`);
  const remaining = report.findings.length - shown.length;
  return remaining > 0 ? `${shown.join("; ")}; and ${remaining} more` : shown.join("; ");
}

function driftPaths(report: DriftReport): readonly string[] {
  return [...new Set(
    report.findings.filter((finding) => DRIFT_PATH_SUBJECTS.has(finding.kind)).map((finding) => finding.subject),
  )].sort((left, right) => left.localeCompare(right, "en"));
}

async function compareHarnessDrift(
  root: string,
  capsule: Capsule,
): Promise<{ report: DriftReport; limitations: readonly string[] } | undefined> {
  try {
    const frozen = frozenProfileFromCapsule(capsule.payload);
    const inspection = await inspectProject({ root });
    const walked = (inspection.evidenceRecords ?? [])
      .filter((record) => record.signal === "file:observed")
      .map((record) => record.path);
    const confirmed = await presentHarnessPaths(root, [...frozen.protectedPaths, ...frozen.mutableRoots,
      ...frozen.gates.flatMap((gate) => (gate.cwd === undefined ? [] : [gate.cwd]))]);
    const current = currentProfileFromInspection(
      inspection,
      await harnessFileDigests(root, frozen.files),
      [...walked, ...inspection.instructionSurfaces, ...confirmed],
    );
    return { report: scanDrift(frozen, current), limitations: inspection.scan?.limitations ?? [] };
  } catch {
    return undefined;
  }
}

/**
 * Compare what the frozen harness asserts about the project with what the project shows now. Drift
 * is information about a project that grew, not a broken installation, so this check is never
 * required and no verdict of it sinks the doctor report.
 *
 * A failed check means the installed state needs correcting, and the product counts it as a
 * failure, so only drift that stops the approved harness from operating earns it: a gate whose
 * command is gone, harness bytes that are not the approved ones, a writable root that disappeared.
 * A difference below blocking severity is reported without a verdict, because the capsule froze a
 * policy rather than an observation: a protected path the project never had cannot be told from one
 * it lost, and a freshly installed, entirely correct project would otherwise report a failure.
 */
async function checkHarnessDrift(root: string, capsule: Capsule | undefined): Promise<CheckResult> {
  const comparison = capsule === undefined ? undefined : await compareHarnessDrift(root, capsule);
  if (comparison === undefined) {
    return {
      id: DRIFT_CHECK_ID,
      status: "unavailable",
      required: false,
      message: capsule === undefined
        ? "No readable frozen capsule is available, so the project cannot be compared with an approved harness."
        : "The project could not be inspected read-only, so drift against the frozen harness was not compared.",
    };
  }
  const { report, limitations } = comparison;
  if (report.status === "aligned") {
    return passed(DRIFT_CHECK_ID, "The project still shows what the frozen harness asserts about it.", false);
  }
  if (report.status === "inconclusive") {
    const unconfirmed = report.findings.filter((finding) => finding.inconclusive).length;
    return {
      id: DRIFT_CHECK_ID,
      status: "skipped",
      required: false,
      message: `The bounded project inspection was partial (${limitations.join(", ") || "undeclared bounds"}), ` +
        "so alignment with the frozen harness cannot be declared" +
        (unconfirmed === 0 ? "." : `; ${unconfirmed} finding(s) could not be confirmed within those bounds.`),
    };
  }
  const paths = driftPaths(report);
  const reported = { ...(paths.length === 0 ? {} : { paths }) };
  if (report.counts.blocking === 0) {
    return {
      id: DRIFT_CHECK_ID,
      status: "skipped",
      required: false,
      message: "The project differs from the frozen harness without contradicting what it needs to " +
        `operate (${driftCounts(report)}): ${driftHeadline(report)}. No verdict is claimed on a ` +
        "difference below blocking severity; it is reported so it can be reviewed.",
      ...reported,
    };
  }
  return {
    id: DRIFT_CHECK_ID,
    status: "failed",
    required: false,
    message: "The frozen harness no longer operates as approved against this project " +
      `(${driftCounts(report)}): ${driftHeadline(report)}. Drift is reported without failing the ` +
      "installation verdict: a project that grew is not a broken install.",
    remediation: "Review the drift, then update the harness explicitly or restore what the frozen harness assumes.",
    ...reported,
  };
}

export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  const root = path.resolve(input.root);
  const checks: CheckResult[] = [];
  let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
  let manifest: InstallManifest | undefined;
  let lock: LockDocument | undefined;
  let capsule: Capsule | undefined;

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
    if (manifest.files.some((record) => record.componentId === "forgeyard.capsule")) {
      try { capsule = await readCapsule(root); checks.push(passed("capsule", "Frozen native capsule, policy, provenance and gates agree.")); }
      catch (error) { checks.push(failed("capsule", "Frozen native capsule integrity could not be established.", errorPaths(error))); }
    } else checks.push({ id: "capsule", status: "skipped", required: false,
      message: "Legacy installation has no native capsule; its task receipts are not native certificates." });
    checks.push(await checkManagedFiles(root, manifest, lock));
    checks.push(await checkHarnessOutput(root, manifest));
    checks.push(
      config === undefined
        ? failed("presentation-output", "Presentation output cannot be located because configuration is invalid.")
        : config.presentation.enabled
          ? await checkPresentationOutput(root, config.paths.presentation, input.denyTerms ?? [])
          : {
              id: "presentation-output",
              status: "skipped",
              required: false,
              message: "The selected profile does not install a presentation bundle.",
            },
    );
    const importedPaths = manifest.files
      .filter((record) => record.componentId.startsWith("ecosystem."))
      .map((record) => record.path);
    const findings = await scanGeneratedContent({
      root,
      paths: manifest.files.map((record) => record.path),
      denyTerms: input.denyTerms ?? [],
      importedPaths,
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
    const adapterId = manifest?.adapter ?? lock?.adapter ?? config?.harnesses[0] ?? "codex";
    checks.push(failed(`${adapterId}-output`, "Harness output cannot be checked because install metadata is invalid."));
    checks.push(failed("presentation-output", "Presentation output cannot be audited because install metadata is invalid."));
    checks.push(failed("content-audit", "Generated content cannot be audited because install metadata is invalid."));
  }

  checks.push(await checkHarnessDrift(root, capsule));

  const lookup = input.commandLookup ?? defaultCommandLookup;
  const adapterId = manifest?.adapter ?? lock?.adapter ?? config?.harnesses[0] ?? "codex";
  const executable = adapterId === "claude-code" ? "claude" : "codex";
  const label = adapterId === "claude-code" ? "Claude Code" : "Codex";
  const executableAvailable = await lookup(executable).catch(() => false);
  checks.push(
    executableAvailable
      ? passed(`${adapterId}-executable`, `${label} executable is discoverable without invoking it.`, false)
      : {
          id: `${adapterId}-executable`,
          status: "unavailable",
          required: false,
          message: `${label} executable is not available on this host; structural validation still ran.`,
        },
  );
  checks.push({
    id: `${adapterId}-roundtrip`,
    status: "skipped",
    required: false,
    message: input.realClient
      ? "Real-client roundtrip is not implemented for this adapter and was not claimed."
      : "Real-client roundtrip was not requested; structural validation ran instead.",
  });

  return {
    schemaVersion: 1,
    ok: checks.filter((check) => check.required).every((check) => check.status === "passed"),
    root,
    checks,
  };
}
