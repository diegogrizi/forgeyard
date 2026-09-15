import type {
  AutonomyConfig,
  CatalogSelection,
  CompositionChoice,
  HarnessId,
  ProjectKind,
  QualityCommand,
} from "../core/contracts.js";

export interface InspectProjectInput {
  root: string;
  brief?: string;
  specificationPaths?: readonly string[];
}

export interface ProjectInspection {
  schemaVersion: 1;
  root: string;
  name: string;
  request: string;
  mode: "new" | "existing";
  kind: ProjectKind;
  languages: readonly string[];
  frameworks: readonly string[];
  packageManagers: readonly string[];
  qualityCommands: readonly QualityCommand[];
  mutableRoots: readonly string[];
  instructionSurfaces: readonly string[];
  sources: readonly string[];
  evidence: readonly { path: string; signal: string }[];
  questions: readonly string[];
  warnings: readonly string[];
  confidence: "high" | "medium" | "low";
  analysisSha256: string;
}

export interface ComposeProjectOptions {
  adapter?: HarnessId;
  timeboxMinutes?: number;
  maxConcurrency?: number;
  maxCostUsd?: number;
  autonomy?: "supervised" | "balanced" | "autonomous";
  presentation?: boolean;
  harnessAvailability?: Partial<Record<HarnessId, boolean>>;
}

export interface CapabilityRule {
  id: string;
  when: {
    kinds?: readonly ProjectKind[];
    languages?: readonly string[];
    frameworks?: readonly string[];
    requestPatterns?: readonly string[];
  };
  include: readonly CompositionChoice[];
}

export interface CapabilityRules {
  schemaVersion: 1;
  baseline: readonly CompositionChoice[];
  rules: readonly CapabilityRule[];
  exclusions: readonly CompositionChoice[];
}

export interface PreparationDecision {
  schemaVersion: 1;
  profile: "tailored";
  adapter: HarnessId;
  adapterReason: string;
  catalog: CatalogSelection;
  packs: readonly string[];
  selected: readonly CompositionChoice[];
  excluded: readonly CompositionChoice[];
  timeboxMinutes: number;
  orchestration: {
    mode: "guided" | "native";
    maxConcurrency: number;
  };
  presentation: {
    enabled: boolean;
    audience: string;
    durationMinutes: number;
    offline: true;
  };
  autonomy: AutonomyConfig;
  analysisSha256: string;
}
