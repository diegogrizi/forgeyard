import type { ProjectInspection } from "./contracts.js";
import type { ProjectNeedsProfile } from "./semantic.js";

/** The native resolver and installer must use the same mandatory backbone. */
export function projectRequirements(inspection: ProjectInspection, profile: ProjectNeedsProfile): string[] {
  return [...new Set(["method.coordinate", "quality.test", "quality.review", ...profile.needs,
    ...(inspection.frameworks.includes("react") ? ["domain.react"] : []),
    ...(inspection.frameworks.includes("spring") ? ["domain.spring"] : [])])].sort();
}
