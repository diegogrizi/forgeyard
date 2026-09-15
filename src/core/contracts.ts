export type NonEmptyArgv = readonly [executable: string, ...args: string[]];

export interface QualityCommand {
  name: string;
  argv: NonEmptyArgv;
}

export interface ForgeyardConfig {
  schemaVersion: 1;
  project: {
    name: string;
    purpose: string;
    mode: "new" | "existing";
  };
  harnesses: readonly ["codex"];
  profile: "hackathon";
  timeboxMinutes: number;
  quality: {
    commands: readonly QualityCommand[];
  };
  paths: {
    mutableRoots: readonly string[];
    protectedPaths: readonly string[];
    presentation: string;
  };
  orchestration: {
    mode: "native" | "guided";
    maxConcurrency: number;
  };
  presentation: {
    enabled: true;
    audience: string;
    durationMinutes: number;
    offline: true;
  };
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
  | "reference";

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
  id: "hackathon";
  version: string;
  packs: readonly string[];
  defaults: Pick<ForgeyardConfig, "timeboxMinutes" | "orchestration" | "presentation">;
}

export interface ResolvedComponent extends ComponentDeclaration {
  packId: string;
  packVersion: string;
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
  profile: "hackathon";
  adapter: "codex";
  files: readonly PlannedFile[];
}

export interface HarnessAdapter {
  id: "codex";
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
  required: true;
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
}
