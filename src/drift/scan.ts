import type { Capsule } from "../capsule/capsule.js";
import type { ProjectInspection } from "../intake/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { canonicalJson, sha256Text } from "../core/hash.js";

/** What the frozen harness asserts about the project. Shaped from Capsule["payload"]. */
export interface FrozenProfile {
  kind: string;
  languages: readonly string[];
  frameworks: readonly string[];
  mutableRoots: readonly string[];
  protectedPaths: readonly string[];
  gates: readonly { id: string; name: string; argv: readonly string[]; cwd?: string }[];
  files: readonly { path: string; sha256: string }[];
}

/** What the project shows now. Shaped from a fresh read-only inspection. */
export interface CurrentProfile {
  kind: string;
  languages: readonly string[];
  frameworks: readonly string[];
  mutableRoots: readonly string[];
  qualityCommands: readonly { name: string; argv: readonly string[]; cwd?: string }[];
  /** Existing project-relative paths, from the bounded inspection. */
  presentPaths: readonly string[];
  /** Harness files whose current digest was computed; absent entries mean unreadable. */
  harnessDigests: Readonly<Record<string, string | null>>;
  /** True when the inspection was bounded/partial: findings must be reported as inconclusive. */
  partialScan: boolean;
}

export type DriftSeverity = "blocking" | "important" | "informational";

export type DriftKind =
  | "gate-command-missing"
  | "gate-cwd-missing"
  | "harness-file-changed"
  | "harness-file-unreadable"
  | "framework-appeared"
  | "framework-disappeared"
  | "language-appeared"
  | "language-disappeared"
  | "kind-changed";

export interface DriftFinding {
  kind: DriftKind;
  severity: DriftSeverity;
  /** English, one sentence, names the exact frozen assertion and what contradicts it. */
  summary: string;
  /** Identifier of the frozen element: gate id, project-relative path, framework name... */
  subject: string;
  frozen?: string;
  current?: string;
  /** True when the bounded scan could not confirm the finding. */
  inconclusive: boolean;
}

export interface DriftReport {
  status: "aligned" | "drifted" | "inconclusive";
  findings: readonly DriftFinding[];
  counts: Readonly<Record<DriftSeverity, number>>;
  /** sha256Text(canonicalJson(...)) of the two compared profiles: makes a report quotable. */
  comparisonSha256: string;
}

const SEVERITIES: Readonly<Record<DriftKind, DriftSeverity>> = {
  "gate-command-missing": "blocking",
  "gate-cwd-missing": "blocking",
  "harness-file-changed": "blocking",
  "harness-file-unreadable": "blocking",
  "framework-disappeared": "important",
  "language-disappeared": "important",
  "kind-changed": "important",
  "framework-appeared": "informational",
  "language-appeared": "informational",
};

const SEVERITY_RANKS: Readonly<Record<DriftSeverity, number>> = { blocking: 0, important: 1, informational: 2 };

/**
 * Findings a bounded scan cannot confirm: not having seen a thing does not prove its absence.
 * The same holds for an observation drawn from a vocabulary the inspection does not share with
 * the frozen declaration it is being compared against.
 * A changed digest and an appeared capability rest on what was observed, so they stay conclusive.
 * An unreadable harness file rests on the supplied digest map, not on the bounded walk, so it
 * stays conclusive too.
 */
const BOUNDED_BY_SCAN: ReadonlySet<DriftKind> = new Set<DriftKind>([
  "gate-command-missing",
  "gate-cwd-missing",
  "framework-disappeared",
  "language-disappeared",
  "kind-changed",
]);

function driftError(message: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_DRIFT_INVALID",
    message,
    remediation: "Compare a frozen capsule payload with a fresh bounded inspection of the same project.",
    exitCode: 2,
  });
}

function objectRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw driftError(`Drift input '${field}' must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw driftError(`Drift input '${field}' must be a string.`);
  return value;
}

function rows(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw driftError(`Drift input '${field}' must be an array.`);
  return value;
}

function strings(value: unknown, field: string): readonly string[] {
  return rows(value, field).map((item, index) => text(item, `${field}[${index}]`));
}

/** Set-like declarations are compared as sets: sorted and deduplicated before any comparison. */
function labels(value: unknown, field: string): readonly string[] {
  return [...new Set(strings(value, field))].sort((left, right) => left.localeCompare(right, "en"));
}

function argv(value: unknown, field: string): readonly string[] {
  const items = strings(value, field);
  if (items.length === 0) throw driftError(`Drift input '${field}' must declare at least one argument.`);
  return items;
}

function argvKey(items: readonly string[]): string {
  return canonicalJson([...items]);
}

function argvText(items: readonly string[]): string {
  return items.join(" ");
}

/** Comparison key for a project-relative path: portable separators, no drive-case surprises. */
function pathKey(value: string): string {
  const segments = value.normalize("NFKC").replaceAll("\\", "/").split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  return segments.length === 0 ? "." : segments.join("/").toLocaleLowerCase("en-US");
}

function labelKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function digestKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

/** Every observed path plus its ancestors: a file inside a directory proves the directory. */
function observedPaths(paths: readonly string[]): ReadonlySet<string> {
  const observed = new Set<string>(["."]);
  for (const candidate of paths) {
    const portable = pathKey(candidate);
    if (portable === ".") continue;
    let cursor = "";
    for (const segment of portable.split("/")) {
      cursor = cursor === "" ? segment : `${cursor}/${segment}`;
      observed.add(cursor);
    }
  }
  return observed;
}

function validFrozen(value: FrozenProfile): FrozenProfile {
  const source = objectRecord(value, "frozen");
  const gates = rows(source.gates, "frozen.gates").map((item, index) => {
    const gate = objectRecord(item, `frozen.gates[${index}]`);
    return {
      id: text(gate.id, `frozen.gates[${index}].id`),
      name: text(gate.name, `frozen.gates[${index}].name`),
      argv: argv(gate.argv, `frozen.gates[${index}].argv`),
      ...(gate.cwd === undefined ? {} : { cwd: text(gate.cwd, `frozen.gates[${index}].cwd`) }),
    };
  }).sort((left, right) => left.id.localeCompare(right.id, "en") || argvKey(left.argv).localeCompare(argvKey(right.argv), "en"));
  const files = rows(source.files, "frozen.files").map((item, index) => {
    const file = objectRecord(item, `frozen.files[${index}]`);
    return {
      path: text(file.path, `frozen.files[${index}].path`),
      sha256: text(file.sha256, `frozen.files[${index}].sha256`),
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en") || left.sha256.localeCompare(right.sha256, "en"));
  return {
    kind: text(source.kind, "frozen.kind"),
    languages: labels(source.languages, "frozen.languages"),
    frameworks: labels(source.frameworks, "frozen.frameworks"),
    mutableRoots: labels(source.mutableRoots, "frozen.mutableRoots"),
    protectedPaths: labels(source.protectedPaths, "frozen.protectedPaths"),
    gates,
    files,
  };
}

function validCurrent(value: CurrentProfile): CurrentProfile {
  const source = objectRecord(value, "current");
  if (typeof source.partialScan !== "boolean") throw driftError("Drift input 'current.partialScan' must be a boolean.");
  const qualityCommands = rows(source.qualityCommands, "current.qualityCommands").map((item, index) => {
    const command = objectRecord(item, `current.qualityCommands[${index}]`);
    return {
      name: text(command.name, `current.qualityCommands[${index}].name`),
      argv: argv(command.argv, `current.qualityCommands[${index}].argv`),
      ...(command.cwd === undefined ? {} : { cwd: text(command.cwd, `current.qualityCommands[${index}].cwd`) }),
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "en") || argvKey(left.argv).localeCompare(argvKey(right.argv), "en"));
  const digests = objectRecord(source.harnessDigests, "current.harnessDigests");
  const harnessDigests: Record<string, string | null> = {};
  for (const [key, digest] of Object.entries(digests)) {
    harnessDigests[key] = digest === null ? null : text(digest, `current.harnessDigests['${key}']`);
  }
  return {
    kind: text(source.kind, "current.kind"),
    languages: labels(source.languages, "current.languages"),
    frameworks: labels(source.frameworks, "current.frameworks"),
    mutableRoots: labels(source.mutableRoots, "current.mutableRoots"),
    qualityCommands,
    presentPaths: labels(source.presentPaths, "current.presentPaths"),
    harnessDigests,
    partialScan: source.partialScan,
  };
}

function finding(
  kind: DriftKind,
  subject: string,
  summary: string,
  values: { frozen?: string; current?: string },
  /** True when the observation that would have contradicted this finding was never made. */
  unobserved: boolean,
): DriftFinding {
  const inconclusive = unobserved && BOUNDED_BY_SCAN.has(kind);
  return {
    kind,
    severity: SEVERITIES[kind],
    // A finding the scan could not confirm says so in its own sentence. The `inconclusive`
    // flag is for a caller; whoever reads the summary alone must not be handed an absence of
    // evidence phrased as evidence of absence.
    summary: inconclusive ? `${summary} This inspection could not confirm it.` : summary,
    subject,
    ...(values.frozen === undefined ? {} : { frozen: values.frozen }),
    ...(values.current === undefined ? {} : { current: values.current }),
    inconclusive,
  };
}

function compareLabels(
  subjectKind: "framework" | "language",
  frozenLabels: readonly string[],
  currentLabels: readonly string[],
  partialScan: boolean,
): readonly DriftFinding[] {
  const frozenIndex = new Map(frozenLabels.map((label) => [labelKey(label), label]));
  const currentIndex = new Map(currentLabels.map((label) => [labelKey(label), label]));
  const findings: DriftFinding[] = [];
  for (const [key, label] of frozenIndex) {
    if (currentIndex.has(key)) continue;
    findings.push(finding(
      `${subjectKind}-disappeared`,
      label,
      `The frozen harness assumed ${subjectKind} '${label}', which the project no longer shows.`,
      { frozen: label },
      partialScan,
    ));
  }
  for (const [key, label] of currentIndex) {
    if (frozenIndex.has(key)) continue;
    findings.push(finding(
      `${subjectKind}-appeared`,
      label,
      `The project now shows ${subjectKind} '${label}', which the frozen harness never saw.`,
      { current: label },
      partialScan,
    ));
  }
  return findings;
}

/**
 * Compare what the frozen harness asserts with what the project shows now. Pure: no I/O, no clock.
 * A bounded scan can report contradictions but never alignment.
 */
export function scanDrift(frozen: FrozenProfile, current: CurrentProfile): DriftReport {
  const asserted = validFrozen(frozen);
  const shown = validCurrent(current);
  const partialScan = shown.partialScan;
  const observed = observedPaths(shown.presentPaths);
  const offeredCommands = new Set(shown.qualityCommands.map((command) => argvKey(command.argv)));
  // A frozen gate is a declaration; the inspection's command list is a discovery. A gate may
  // legitimately run a program the inspection never enumerates, so the two are comparable only
  // where they share a vocabulary, and the program is the observable proxy for one. Found no
  // command invoking the gate's program, the silence is ignorance rather than absence; found
  // others invoking it, the exact command's disappearance is a real contradiction.
  const offeredPrograms = new Set(shown.qualityCommands.flatMap((command) => {
    const program = command.argv[0];
    return program === undefined ? [] : [labelKey(program)];
  }));
  const measuredDigests = new Map(Object.entries(shown.harnessDigests).map(([key, digest]) => [pathKey(key), digest]));
  const findings: DriftFinding[] = [];

  for (const gate of asserted.gates) {
    const gateProgram = gate.argv[0];
    if (!offeredCommands.has(argvKey(gate.argv))) {
      findings.push(finding(
        "gate-command-missing",
        gate.id,
        `Frozen gate '${gate.id}' verifies '${argvText(gate.argv)}', a command the project no longer offers.`,
        { frozen: argvText(gate.argv) },
        partialScan || gateProgram === undefined || !offeredPrograms.has(labelKey(gateProgram)),
      ));
    }
    if (gate.cwd !== undefined && !observed.has(pathKey(gate.cwd))) {
      findings.push(finding(
        "gate-cwd-missing",
        gate.id,
        `Frozen gate '${gate.id}' runs in '${gate.cwd}', a directory the project no longer shows.`,
        { frozen: gate.cwd },
        partialScan,
      ));
    }
  }

  for (const file of asserted.files) {
    const measured = measuredDigests.get(pathKey(file.path)) ?? null;
    if (measured === null) {
      findings.push(finding(
        "harness-file-unreadable",
        file.path,
        `Frozen harness file '${file.path}' could not be read as a regular file.`,
        { frozen: file.sha256 },
        partialScan,
      ));
      continue;
    }
    if (digestKey(measured) !== digestKey(file.sha256)) {
      findings.push(finding(
        "harness-file-changed",
        file.path,
        `Frozen harness file '${file.path}' no longer matches the approved bytes.`,
        { frozen: file.sha256, current: measured },
        partialScan,
      ));
    }
  }

  // Neither the frozen protected paths nor the frozen mutable roots are compared against what
  // the project shows. Both are policy, not observation: the harness refuses writes to '.env'
  // so they are refused if it ever appears, and grants writes under 'presentation' so they are
  // allowed if it is ever created. An absent path stops neither, and the capsule froze a rule
  // rather than a sighting, so a path that disappeared cannot be told from one that was never
  // there. Comparing them measured every correctly prepared project as drifted, which is a
  // check nobody reads.

  findings.push(...compareLabels("framework", asserted.frameworks, shown.frameworks, partialScan));
  findings.push(...compareLabels("language", asserted.languages, shown.languages, partialScan));

  if (labelKey(asserted.kind) !== labelKey(shown.kind)) {
    findings.push(finding(
      "kind-changed",
      "kind",
      `The frozen harness classified the project as '${asserted.kind}', but it now shows as '${shown.kind}'.`,
      { frozen: asserted.kind, current: shown.kind },
      partialScan,
    ));
  }

  const ordered = [...new Map(findings.map((item) => [canonicalJson(item), item])).values()].sort((left, right) =>
    SEVERITY_RANKS[left.severity] - SEVERITY_RANKS[right.severity] ||
    left.kind.localeCompare(right.kind, "en") ||
    left.subject.localeCompare(right.subject, "en"));
  const counts: Record<DriftSeverity, number> = { blocking: 0, important: 0, informational: 0 };
  for (const item of ordered) counts[item.severity] += 1;
  const conclusive = ordered.some((item) => !item.inconclusive);
  // A bounded scan can contradict the harness, but it can never certify alignment.
  const status: DriftReport["status"] = conclusive
    ? "drifted"
    : partialScan || ordered.length > 0 ? "inconclusive" : "aligned";

  return {
    status,
    findings: ordered,
    counts,
    comparisonSha256: sha256Text(canonicalJson({ current: shown, frozen: asserted })),
  };
}

export function frozenProfileFromCapsule(payload: Capsule["payload"]): FrozenProfile {
  const source = objectRecord(payload, "capsule.payload");
  const profile = objectRecord(source.profile, "capsule.payload.profile");
  const policy = objectRecord(source.policy, "capsule.payload.policy");
  return validFrozen({
    kind: text(profile.kind, "capsule.payload.profile.kind"),
    languages: strings(profile.languages, "capsule.payload.profile.languages"),
    frameworks: strings(profile.frameworks, "capsule.payload.profile.frameworks"),
    mutableRoots: strings(policy.mutableRoots, "capsule.payload.policy.mutableRoots"),
    protectedPaths: strings(policy.protectedPaths, "capsule.payload.policy.protectedPaths"),
    gates: rows(source.gates, "capsule.payload.gates").map((item, index) => {
      const gate = objectRecord(item, `capsule.payload.gates[${index}]`);
      return {
        id: text(gate.id, `capsule.payload.gates[${index}].id`),
        name: text(gate.name, `capsule.payload.gates[${index}].name`),
        argv: argv(gate.argv, `capsule.payload.gates[${index}].argv`),
        ...(gate.cwd === undefined ? {} : { cwd: text(gate.cwd, `capsule.payload.gates[${index}].cwd`) }),
      };
    }),
    files: rows(source.files, "capsule.payload.files").map((item, index) => {
      const file = objectRecord(item, `capsule.payload.files[${index}]`);
      return {
        path: text(file.path, `capsule.payload.files[${index}].path`),
        sha256: text(file.sha256, `capsule.payload.files[${index}].sha256`),
      };
    }),
  });
}

export function currentProfileFromInspection(
  inspection: ProjectInspection,
  harnessDigests: Readonly<Record<string, string | null>>,
  presentPaths: readonly string[],
): CurrentProfile {
  const source = objectRecord(inspection, "inspection");
  const scan = source.scan === undefined ? undefined : objectRecord(source.scan, "inspection.scan");
  return validCurrent({
    kind: text(source.kind, "inspection.kind"),
    languages: strings(source.languages, "inspection.languages"),
    frameworks: strings(source.frameworks, "inspection.frameworks"),
    mutableRoots: strings(source.mutableRoots, "inspection.mutableRoots"),
    qualityCommands: rows(source.qualityCommands, "inspection.qualityCommands").map((item, index) => {
      const command = objectRecord(item, `inspection.qualityCommands[${index}]`);
      return {
        name: text(command.name, `inspection.qualityCommands[${index}].name`),
        argv: argv(command.argv, `inspection.qualityCommands[${index}].argv`),
        ...(command.cwd === undefined ? {} : { cwd: text(command.cwd, `inspection.qualityCommands[${index}].cwd`) }),
      };
    }),
    presentPaths,
    harnessDigests,
    // An absent scan record is treated as partial: an unknown boundary is not a complete one.
    partialScan: scan?.status !== "complete",
  });
}
