import type { ProjectInspection } from "./contracts.js";
import { ForgeyardError } from "../core/errors.js";

export interface ProjectNeedEvidence { path: string; sha256: string; locator?: string }
export interface ProjectNeedsProposal {
  intent: "change" | "maintenance" | "new-project";
  risk: "low" | "medium" | "high";
  needs: readonly string[];
  evidence: readonly ProjectNeedEvidence[];
}
export interface ProjectNeedsProfile extends ProjectNeedsProposal {
  schemaVersion: 1;
  analysisSha256: string;
}

function invalid(message: string): never {
  throw new ForgeyardError({ code: "FY_INTAKE_UNSAFE", message, remediation: "Provide bounded structured needs with current inspection evidence.", exitCode: 4 });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** Validates an inspected snapshot, not live filesystem freshness. The caller must reinspect before applying. */
export function validateProjectNeeds(inspection: ProjectInspection, proposal: unknown): ProjectNeedsProfile {
  if (!record(proposal) || !onlyKeys(proposal, ["intent", "risk", "needs", "evidence"])) invalid("Invalid structured needs proposal.");
  if (typeof proposal.intent !== "string" || typeof proposal.risk !== "string" || !["change", "maintenance", "new-project"].includes(proposal.intent) || !["low", "medium", "high"].includes(proposal.risk)) invalid("Explicit intent and risk are required.");
  if (!Array.isArray(proposal.needs) || proposal.needs.length > 128 || proposal.needs.some((need) => typeof need !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(need) || need.length > 128)) invalid("Needs must be at most 128 bounded capability names.");
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length > 128) invalid("Invalid evidence reference bounds.");
  const evidence: ProjectNeedEvidence[] = [];
  for (const ref of proposal.evidence) {
    if (!record(ref) || !onlyKeys(ref, ["path", "sha256", "locator"]) || typeof ref.path !== "string" || ref.path.length > 1024 || typeof ref.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256) || (ref.locator !== undefined && (typeof ref.locator !== "string" || ref.locator.length > 256))) invalid("Invalid evidence reference.");
    const match = inspection.evidenceRecords?.some((item) => item.path === ref.path && item.sha256 === ref.sha256 && (ref.locator === undefined || item.locator === ref.locator));
    if (!match) invalid("Evidence reference is nonexistent, stale, or has an unknown locator.");
    evidence.push({ path: ref.path, sha256: ref.sha256, ...(ref.locator === undefined ? {} : { locator: ref.locator as string }) });
  }
  const uniqueEvidence = [...new Map(evidence.map((ref) => [JSON.stringify(ref), ref])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
  return { schemaVersion: 1, intent: proposal.intent as ProjectNeedsProposal["intent"], risk: proposal.risk as ProjectNeedsProposal["risk"], needs: [...new Set(proposal.needs as string[])].sort(), evidence: uniqueEvidence, analysisSha256: inspection.analysisSha256 };
}
