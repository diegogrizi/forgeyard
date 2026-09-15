import { describe, expect, test } from "vitest";

import type {
  ComponentDeclaration,
  PackManifest,
  ProfileManifest,
} from "../../../src/core/contracts.js";
import type { LoadedPack, RegistrySnapshot } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

function component(
  id: string,
  slot: string,
  requires: readonly string[] = [],
  conflicts: readonly string[] = [],
): ComponentDeclaration {
  return {
    id,
    kind: "skill",
    entry: `${id}.md`,
    slot,
    template: false,
    ownership: "managed",
    requires,
    conflicts,
  };
}

function pack(id: string, components: readonly ComponentDeclaration[]): LoadedPack {
  const manifest: PackManifest = {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    license: "Apache-2.0",
    provenance: { mode: "original" },
    components,
  };
  return {
    directory: `C:/registry/packs/${id}`,
    manifest,
    entries: new Map(
      components.map((item) => [
        item.id,
        {
          sourcePath: `C:/registry/packs/${id}/${item.entry}`,
          sha256: item.id.padEnd(64, "0").slice(0, 64),
        },
      ]),
    ),
  };
}

function snapshot(packs: readonly LoadedPack[]): RegistrySnapshot {
  const profile: ProfileManifest = {
    schemaVersion: 1,
    id: "hackathon",
    version: "1.0.0",
    packs: packs.map((item) => item.manifest.id),
    defaults: {
      timeboxMinutes: 300,
      orchestration: { mode: "guided", maxConcurrency: 4 },
      presentation: {
        enabled: true,
        audience: "Reviewers",
        durationMinutes: 7,
        offline: true,
      },
    },
  };
  return {
    root: "C:/registry",
    profiles: new Map([[profile.id, profile]]),
    packs: new Map(packs.map((item) => [item.manifest.id, item])),
    sources: new Map(),
  };
}

describe("profile resolver", () => {
  test("orders dependencies before consumers with a stable tie-break", () => {
    const registry = snapshot([
      pack("z-pack", [component("feature.entry", "feature.entry", ["shared.base"])]),
      pack("a-pack", [component("shared.base", "shared.base"), component("shared.peer", "shared.peer")]),
    ]);

    const resolved = resolveProfile(registry, "hackathon", "codex");

    expect(resolved.components.map((item) => item.id)).toEqual([
      "shared.base",
      "shared.peer",
      "feature.entry",
    ]);
  });

  test("returns identical output when map insertion order changes", () => {
    const first = snapshot([
      pack("second", [component("b.item", "b.item")]),
      pack("first", [component("a.item", "a.item")]),
    ]);
    const second = snapshot([...first.packs.values()].reverse());

    expect(resolveProfile(first, "hackathon", "codex")).toEqual(
      resolveProfile(second, "hackathon", "codex"),
    );
  });

  test.each([
    {
      name: "duplicate component IDs",
      registry: snapshot([
        pack("one", [component("shared.item", "one.slot")]),
        pack("two", [component("shared.item", "two.slot")]),
      ]),
    },
    {
      name: "case-folded duplicate slots",
      registry: snapshot([
        pack("one", [component("one.item", "Workflow.Primary")]),
        pack("two", [component("two.item", "workflow.primary")]),
      ]),
    },
    {
      name: "missing requirements",
      registry: snapshot([pack("one", [component("one.item", "one.item", ["missing.item"])])]),
    },
    {
      name: "dependency cycles",
      registry: snapshot([
        pack("one", [
          component("one.a", "one.a", ["one.b"]),
          component("one.b", "one.b", ["one.a"]),
        ]),
      ]),
    },
    {
      name: "active conflicts",
      registry: snapshot([
        pack("one", [
          component("one.a", "one.a", [], ["one.b"]),
          component("one.b", "one.b"),
        ]),
      ]),
    },
  ])("rejects $name", ({ registry }) => {
    expect(() => resolveProfile(registry, "hackathon", "codex")).toThrowError(
      expect.objectContaining({ code: "FY_COMPONENT_CONFLICT", exitCode: 3 }),
    );
  });

  test("rejects unsupported profile and adapter selections", () => {
    const registry = snapshot([pack("one", [component("one.item", "one.item")])]);

    expect(() => resolveProfile(registry, "full", "codex")).toThrowError(
      expect.objectContaining({ code: "FY_UNSUPPORTED_SELECTION" }),
    );
    expect(() => resolveProfile(registry, "hackathon", "cursor")).toThrowError(
      expect.objectContaining({ code: "FY_UNSUPPORTED_SELECTION" }),
    );
  });
});
