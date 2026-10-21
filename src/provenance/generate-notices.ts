import type { ProvenanceWorkspace } from "./validate.js";
import { validateProvenance } from "./validate.js";

interface NoticeEntry {
  heading: string;
  name: string;
  version: string;
  license: string;
  lockPath: string;
  resolved?: string;
  projectUrl?: string;
  notes?: string;
  extraLines?: readonly string[];
}

export function renderThirdPartyNotices(workspace: ProvenanceWorkspace): string {
  const validated = validateProvenance(workspace);
  const directByKey = new Map(validated.directDependencies.map((source) => [`${source.name}\0${source.revision}`, source]));
  const packageEntries: NoticeEntry[] = Object.entries(workspace.packageLock.packages)
    .filter(([lockPath]) => lockPath !== "")
    .map(([lockPath, locked]) => {
      const name = locked.name!;
      const direct = directByKey.get(`${name}\0${locked.version}`);
      return {
        heading: `${name} ${locked.version} (${lockPath})`,
        name,
        version: locked.version,
        license: locked.license ?? workspace.installedByPath.get(lockPath)?.license ?? "NOASSERTION",
        lockPath,
        ...(locked.resolved === undefined ? {} : { resolved: locked.resolved }),
        ...(direct === undefined ? {} : { projectUrl: direct.url, notes: direct.notes }),
      };
    })
  const sourceById = new Map(workspace.catalog.sources.map((source) => [source.id, source]));
  const vendorEntries: NoticeEntry[] = validated.vendoredSources.map((vendor) => {
    const source = sourceById.get(vendor.sourceId)!;
    return {
      heading: `${source.name} ${vendor.attestation.revision} (vendored catalog)`,
      name: source.name,
      version: vendor.attestation.revision,
      license: vendor.attestation.license,
      lockPath: vendor.licenseRelativePath,
      projectUrl: source.url,
      notes: source.notes,
      extraLines: [
        `- Verified content: ${vendor.summary.fileCount.toLocaleString("en-US")} files and ${vendor.summary.physicalLines.toLocaleString("en-US")} physical lines (${vendor.summary.bytes.toLocaleString("en-US")} bytes)`,
        `- Pinned revision: ${vendor.attestation.revision}`,
        `- Tree SHA-256: ${vendor.summary.treeSha256}`,
        `- Preserved license notice: ${vendor.licenseRelativePath}`,
      ],
    };
  });
  const externalEntries: NoticeEntry[] = validated.externalSources.map((external) => {
    const source = sourceById.get(external.sourceId)!;
    return {
      heading: `${source.name} ${external.reference.revision} (external catalog reference)`,
      name: source.name,
      version: external.reference.revision,
      license: external.reference.license,
      lockPath: external.referenceRelativePath,
      projectUrl: external.reference.repository,
      notes: source.notes,
      extraLines: [
        `- Source reference: ${external.referenceRelativePath}`,
        `- Requested revision for new preparations: ${external.reference.revision}`,
        "- Catalog payload is not distributed with Forgeyard.",
        "- Each acquired installation preserves its exact upstream revision, license notice and file hashes.",
      ],
    };
  });
  const entries = [...packageEntries, ...vendorEntries, ...externalEntries]
    .sort((left, right) => left.heading.localeCompare(right.heading, "en"));
  const sections = entries.map((entry) => [
    `## ${entry.heading}`,
    "",
    `- License: ${entry.license}`,
    ...(entry.projectUrl === undefined ? [] : [`- Project source: ${entry.projectUrl}`]),
    ...(entry.resolved === undefined ? [] : [`- Locked package: ${entry.resolved}`]),
    ...(entry.notes === undefined ? [] : [`- Forgeyard use: ${entry.notes}`]),
    ...(entry.extraLines ?? []),
  ].join("\n"));

  return `${[
    "# Third-Party Notices",
    "",
    "This file is generated from `package-lock.json`, installed package metadata, `sources/catalog.yaml`, verified vendor attestations and external catalog references.",
    "Lockfile versions remain authoritative. Each package remains subject to its own license terms.",
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n").trimEnd()}\n`;
}
