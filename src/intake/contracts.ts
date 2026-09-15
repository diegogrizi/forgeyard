import type { HarnessId, ProjectKind, QualityCommand } from "../core/contracts.js";

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
