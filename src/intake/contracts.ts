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
  limits?: Partial<InspectionLimits>;
}

export interface InspectionLimits {
  maxEntries: number;
  maxDepth: number;
  maxFiles: number;
  maxTotalBytes: number;
}

export interface InspectionEvidence {
  path: string;
  signal: string;
  sha256: string;
  locator: string;
  inference: "manifest" | "presence" | "text-pattern" | "explicit-input";
}

export interface InspectionScan {
  /** Complete means every eligible entry within the declared bounds was inspected, not exhaustive semantic understanding. */
  status: "complete" | "limited";
  visitedEntries: number;
  hashedFiles: number;
  limits: InspectionLimits;
  limitations: readonly string[];
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
  evidenceRecords?: readonly InspectionEvidence[];
  scan?: InspectionScan;
  questions: readonly string[];
  warnings: readonly string[];
  confidence: "high" | "medium" | "low";
  analysisSha256: string;
}

export interface ComposeProjectOptions {
  qualityCommands?: readonly QualityCommand[];
  mutableRoots?: readonly string[];
  needsProposal?: unknown;
  adapter?: HarnessId;
  timeboxMinutes?: number;
  maxConcurrency?: number;
  maxCostUsd?: number;
  autonomy?: "supervised" | "balanced" | "autonomous";
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
  autonomy: AutonomyConfig;
  analysisSha256: string;
  normalizedNeeds?: import("./semantic.js").ProjectNeedsProfile;
}
