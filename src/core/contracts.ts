export type NonEmptyArgv = readonly [executable: string, ...args: string[]];

export const HARNESS_IDS = ["codex", "claude-code"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export interface QualityCommand {
  name: string;
  argv: NonEmptyArgv;
  cwd?: string;
}

export type ProfileId = "minimal" | "hackathon" | "tailored";
export type CatalogSelectionMode = "none" | "curated" | "all";

export type ProjectKind =
  | "frontend"
  | "backend"
  | "full-stack"
  | "mobile"
  | "data"
  | "infrastructure"
  | "library"
  | "cli"
  | "unknown";

export interface IntakeEvidence {
  path: string;
  signal: string;
  sha256?: string;
  locator?: string;
  inference?: "manifest" | "presence" | "text-pattern" | "explicit-input";
}

export interface IntakeConfig {
  strategy: "automatic" | "manual";
  request: string;
  sources: readonly string[];
  kind: ProjectKind;
  languages: readonly string[];
  frameworks: readonly string[];
  evidence: readonly IntakeEvidence[];
  confidence: "high" | "medium" | "low";
  questions: readonly string[];
  scan?: import("../intake/contracts.js").InspectionScan;
}

export interface CompositionChoice {
  id: string;
  reason: string;
}

export interface CompositionConfig {
  strategy: "automatic" | "manual";
  packs: readonly string[];
  selected: readonly CompositionChoice[];
  excluded: readonly CompositionChoice[];
  analysisSha256: string;
  normalizedNeeds?: import("../intake/semantic.js").ProjectNeedsProfile;
}

export interface AutonomyConfig {
  level: "supervised" | "balanced" | "autonomous";
  maxCostUsd?: number;
  stopOnAmbiguity: true;
  externalEffects: "ask";
}

export interface CatalogSelection {
  selection: CatalogSelectionMode;
  plugins: readonly string[];
}

export interface ForgeyardConfig {
  schemaVersion: 1;
  project: {
    name: string;
    purpose: string;
    mode: "new" | "existing";
  };
  harnesses: readonly [HarnessId];
  profile: ProfileId;
  catalog: CatalogSelection;
  timeboxMinutes: number;
  quality: {
    commands: readonly QualityCommand[];
  };
  paths: {
    mutableRoots: readonly string[];
    protectedPaths: readonly string[];
  };
  orchestration: {
    mode: "native" | "guided";
    maxConcurrency: number;
  };
  intake?: IntakeConfig;
  composition?: CompositionConfig;
  autonomy?: AutonomyConfig;
  /**
   * Reporting input, owned by a person. Deliberately not part of the capsule policy: it
   * governs nothing at execution time, and the certificate records the values it used
   * so a later edit cannot change an issued verdict.
   */
  measurement?: { humanBaseline?: import("../measure/accounting.js").HumanBaseline };
}

export interface InitRequest {
  targetRoot: string;
  config: ForgeyardConfig;
}

export type ComponentKind =
  | "instruction"
  | "skill"
  | "agent"
  | "command"
  | "workflow"
  | "hook"
  | "connector"
  | "tool-policy"
  | "template"
  | "validator"
  | "reference"
  | "catalog";

export type ComponentEntryType = "file" | "tree";

export type ComponentFormat = "portable-plugin-marketplace-v1";

export type ProvenanceMode =
  | "original"
  | "dependency"
  | "vendored-unmodified"
  | "adapted"
  | "generated-from-spec"
  | "clean-room-reimplementation"
  | "reference-only";

export interface ComponentDeclaration {
  id: string;
  kind: ComponentKind;
  entry: string;
  entryType?: ComponentEntryType;
  format?: ComponentFormat;
  slot: string;
  template: boolean;
  ownership: "managed" | "seed";
  requires: readonly string[];
  conflicts: readonly string[];
}

export interface PackManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  license: string;
  provenance: { mode: ProvenanceMode; sourceId?: string };
  components: readonly ComponentDeclaration[];
}

export interface ProfileManifest {
  schemaVersion: 1;
  id: ProfileId;
  version: string;
  packs: readonly string[];
  catalog: CatalogSelection;
  defaults: Pick<ForgeyardConfig, "timeboxMinutes" | "orchestration">;
}

export interface SourceRecord {
  id: string;
  name: string;
  url: string;
  revision: string;
  license: string;
  provenance: Exclude<ProvenanceMode, "original">;
  retrievedAt: string;
  notes: string;
}

export interface ResolvedComponent extends ComponentDeclaration {
  packId: string;
  packVersion: string;
  sourcePath: string;
  sha256: string;
  treeFiles?: readonly ComponentTreeFile[];
  catalogSelection?: readonly string[] | "all";
}

export interface ComponentTreeFile {
  relativePath: string;
  sourcePath: string;
  sha256: string;
}

export type CapabilityState = "native" | "adapted" | "emulated" | "advisory" | "unsupported";

export interface PlannedFile {
  path: string;
  content: string;
  sha256: string;
  componentId: string;
  ownership: "managed" | "seed";
}

export interface InstallPlan {
  schemaVersion: 1;
  operationId: string;
  targetRoot: string;
  profile: ProfileId;
  adapter: HarnessId;
  files: readonly PlannedFile[];
}

export interface HarnessAdapter {
  id: HarnessId;
  capabilities: Readonly<Record<string, CapabilityState>>;
  validateConfig(config: ForgeyardConfig): void;
  render(
    components: readonly ResolvedComponent[],
    config: ForgeyardConfig,
  ): Promise<readonly PlannedFile[]>;
  validateOutput(files: readonly PlannedFile[]): Promise<void>;
}

export interface CheckResult {
  id: string;
  status: "passed" | "failed" | "skipped" | "unavailable";
  required: boolean;
  message: string;
  remediation?: string;
  paths?: readonly string[];
}

export interface DoctorReport {
  schemaVersion: 1;
  ok: boolean;
  root: string;
  checks: readonly CheckResult[];
}

export interface VerificationTask {
  schemaVersion: 1;
  id: string;
  title: string;
  command: NonEmptyArgv;
  commands?: readonly QualityCommand[];
  required: true;
  objective?: string;
  acceptanceCriteria?: readonly string[];
  dependsOn?: readonly string[];
  writeScopes?: readonly string[];
  role?: string;
  capabilities?: readonly string[];
  limits?: {
    minutes: number;
    maxRetries: number;
    maxCostUsd?: number;
  };
  evidence?: {
    required: boolean;
  };
  integration?: {
    owner: string;
    target: string;
  };
}

export interface VerificationReceipt {
  schemaVersion: 1;
  receiptId: string;
  taskId: string;
  taskSha256: string;
  argvSha256: string;
  gitCommit: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  stdoutSha256: string;
  stderrSha256: string;
  status: "passed" | "failed";
  commandsSha256?: string;
  gates?: readonly { name: string; argvSha256: string; exitCode: number }[];
}
