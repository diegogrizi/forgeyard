import { Buffer } from "node:buffer";

import { canonicalJson, sha256Text } from "../core/hash.js";
import type { LockPackageRecord, ProvenanceWorkspace } from "./validate.js";
import { validateProvenance } from "./validate.js";

interface SpdxChecksum {
  algorithm: "SHA1" | "SHA256" | "SHA384" | "SHA512";
  checksumValue: string;
}

interface SpdxPackage {
  SPDXID: string;
  name: string;
  versionInfo: string;
  downloadLocation: string;
  filesAnalyzed: false;
  licenseConcluded: string;
  licenseDeclared: string;
  copyrightText: "NOASSERTION";
  checksums?: readonly SpdxChecksum[];
  homepage?: string;
  externalRefs: readonly [{
    referenceCategory: "PACKAGE-MANAGER";
    referenceType: "purl";
    referenceLocator: string;
  }];
}

interface SpdxRelationship {
  spdxElementId: string;
  relationshipType: "DESCRIBES" | "DEPENDS_ON";
  relatedSpdxElement: string;
}

function packageSpdxId(name: string, lockPath: string): string {
  if (lockPath === "") return "SPDXRef-Package-forgeyard";
  const safeName = name.replaceAll(/[^A-Za-z0-9.-]+/g, "-").replace(/^-|-$/g, "");
  return `SPDXRef-Package-${safeName}-${sha256Text(lockPath).slice(0, 12)}`;
}

function checksum(integrity: string | undefined): readonly SpdxChecksum[] | undefined {
  if (integrity === undefined) return undefined;
  for (const token of integrity.split(/\s+/)) {
    const match = token.match(/^(sha(?:1|256|384|512))-(.+)$/i);
    if (match === null) continue;
    const algorithm = match[1]!.toLocaleUpperCase("en-US") as SpdxChecksum["algorithm"];
    return [{ algorithm, checksumValue: Buffer.from(match[2]!, "base64").toString("hex") }];
  }
  return undefined;
}

function purl(name: string, version: string): string {
  const encodedName = encodeURIComponent(name).replaceAll("%2F", "/");
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function parentPackagePath(lockPath: string): string {
  const index = lockPath.lastIndexOf("/node_modules/");
  return index < 0 ? "" : lockPath.slice(0, index);
}

function resolvedDependencyPath(
  packages: Readonly<Record<string, LockPackageRecord>>,
  fromPath: string,
  dependency: string,
): string | undefined {
  let cursor = fromPath;
  while (cursor.length > 0) {
    const candidate = `${cursor}/node_modules/${dependency}`;
    if (packages[candidate] !== undefined) return candidate;
    cursor = parentPackagePath(cursor);
  }
  const rootCandidate = `node_modules/${dependency}`;
  return packages[rootCandidate] === undefined ? undefined : rootCandidate;
}

function dependencyNames(locked: LockPackageRecord): readonly string[] {
  return [...new Set([
    ...Object.keys(locked.dependencies ?? {}),
    ...Object.keys(locked.devDependencies ?? {}),
    ...Object.keys(locked.optionalDependencies ?? {}),
    ...Object.keys(locked.peerDependencies ?? {}),
  ])].sort((left, right) => left.localeCompare(right, "en"));
}

function creationDate(workspace: ProvenanceWorkspace): string {
  const latest = workspace.catalog.sources
    .map((source) => source.retrievedAt)
    .sort((left, right) => right.localeCompare(left, "en"))[0] ?? "1970-01-01";
  return `${latest}T00:00:00Z`;
}

export function renderSpdxSbom(workspace: ProvenanceWorkspace): string {
  validateProvenance(workspace);
  const entries = Object.entries(workspace.packageLock.packages)
    .sort(([left], [right]) => left.localeCompare(right, "en"));
  const ids = new Map(entries.map(([lockPath, locked]) => [lockPath, packageSpdxId(locked.name!, lockPath)]));
  const packages: SpdxPackage[] = entries.map(([lockPath, locked]) => {
    const installed = workspace.installedByPath.get(lockPath);
    const name = locked.name ?? installed?.name ?? lockPath;
    const license = locked.license ?? installed?.license ?? "NOASSERTION";
    const checksums = checksum(locked.integrity);
    return {
      SPDXID: ids.get(lockPath)!,
      name,
      versionInfo: locked.version,
      downloadLocation: locked.resolved ?? "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: license,
      licenseDeclared: license,
      copyrightText: "NOASSERTION",
      ...(checksums === undefined ? {} : { checksums }),
      ...(installed?.homepage === undefined ? {} : { homepage: installed.homepage }),
      externalRefs: [{
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: purl(name, locked.version),
      }],
    };
  });
  const relationships: SpdxRelationship[] = [{
    spdxElementId: "SPDXRef-DOCUMENT",
    relationshipType: "DESCRIBES",
    relatedSpdxElement: ids.get("")!,
  }];
  for (const [lockPath, locked] of entries) {
    for (const dependency of dependencyNames(locked)) {
      const dependencyPath = resolvedDependencyPath(workspace.packageLock.packages, lockPath, dependency);
      if (dependencyPath === undefined) continue;
      relationships.push({
        spdxElementId: ids.get(lockPath)!,
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: ids.get(dependencyPath)!,
      });
    }
  }
  const uniqueRelationships = [...new Map(relationships.map((entry) => [JSON.stringify(entry), entry])).values()]
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  const lockDigest = sha256Text(canonicalJson(workspace.packageLock));
  const document = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${workspace.packageManifest.name}-${workspace.packageManifest.version}`,
    documentNamespace: `https://forgeyard.dev/spdx/${workspace.packageManifest.name}-${workspace.packageManifest.version}-${lockDigest}`,
    creationInfo: {
      created: creationDate(workspace),
      creators: ["Tool: Forgeyard provenance generator"],
    },
    packages,
    relationships: uniqueRelationships,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
