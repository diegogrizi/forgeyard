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
}

export function renderThirdPartyNotices(workspace: ProvenanceWorkspace): string {
  const validated = validateProvenance(workspace);
  const directByKey = new Map(validated.directDependencies.map((source) => [`${source.name}\0${source.revision}`, source]));
  const entries: NoticeEntry[] = Object.entries(workspace.packageLock.packages)
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
    .sort((left, right) => left.heading.localeCompare(right.heading, "en"));
  const sections = entries.map((entry) => [
    `## ${entry.heading}`,
    "",
    `- License: ${entry.license}`,
    ...(entry.projectUrl === undefined ? [] : [`- Project source: ${entry.projectUrl}`]),
    ...(entry.resolved === undefined ? [] : [`- Locked package: ${entry.resolved}`]),
    ...(entry.notes === undefined ? [] : [`- Forgeyard use: ${entry.notes}`]),
  ].join("\n"));

  return `${[
    "# Third-Party Notices",
    "",
    "This file is generated from `package-lock.json`, installed package metadata, and `sources/catalog.yaml`.",
    "Lockfile versions remain authoritative. Each package remains subject to its own license terms.",
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n").trimEnd()}\n`;
}
