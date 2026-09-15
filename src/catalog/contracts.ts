import type { ComponentTreeFile } from "../core/contracts.js";

export interface PortableDocument {
  name: string;
  description: string;
  frontmatter: Readonly<Record<string, unknown>>;
  body: string;
  source: ComponentTreeFile;
}

export interface PortableAgent extends PortableDocument {
  model: string | undefined;
  tools: readonly string[];
}

export interface PortableCommand extends PortableDocument {
  argumentHint: string | undefined;
}

export interface PortableSupportingFile extends ComponentTreeFile {
  relativeToSkill: string;
}

export interface PortableSkill extends PortableDocument {
  supportingFiles: readonly PortableSupportingFile[];
}

export interface PortablePlugin {
  name: string;
  version: string;
  description: string;
  license: string;
  directory: string;
  manifests: readonly ComponentTreeFile[];
  agents: readonly PortableAgent[];
  skills: readonly PortableSkill[];
  commands: readonly PortableCommand[];
  otherFiles: readonly ComponentTreeFile[];
}

export interface PortableMarketplaceCounts {
  plugins: number;
  agents: number;
  skills: number;
  commands: number;
  supportingFiles: number;
  manifestFiles: number;
  otherFiles: number;
}

export interface PortableMarketplace {
  plugins: readonly PortablePlugin[];
  counts: PortableMarketplaceCounts;
}
