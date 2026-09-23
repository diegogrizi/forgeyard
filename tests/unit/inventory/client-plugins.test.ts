import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  parseInstalledPlugins,
  partitionForProject,
  type ClientInventory,
} from "../../../src/inventory/client-plugins.js";

const HERE = path.resolve("C:/work/checkout");
const ELSEWHERE = path.resolve("C:/work/other");

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: "user",
    installPath: "/cache/x",
    version: "abc123",
    installedAt: "2026-01-01T00:00:00.000Z",
    lastUpdated: "2026-01-02T00:00:00.000Z",
    gitCommitSha: "a".repeat(40),
    ...overrides,
  };
}

function registry(plugins: Record<string, unknown[]>): unknown {
  return { version: 2, plugins };
}

describe("client plugin inventory", () => {
  test("reads id, marketplace, scope and version from the client's own registry", () => {
    const inventory = parseInstalledPlugins(registry({
      "code-review@claude-plugins-official": [entry()],
    }));

    expect(inventory.observed).toBe(true);
    expect(inventory.limitations).toEqual([]);
    expect(inventory.plugins).toEqual([{
      id: "code-review",
      marketplace: "claude-plugins-official",
      scope: "user",
      projectPath: null,
      version: "abc123",
      gitCommitSha: "a".repeat(40),
    }]);
  });

  test("an unreadable registry is unobserved, never an empty inventory", () => {
    // Absence of observation is not observation of absence: a client that stores its
    // plugins elsewhere must not be reported as a client with no plugins.
    for (const source of [undefined, null, "", 42, { version: 2 }, { version: 2, plugins: [] }]) {
      const inventory = parseInstalledPlugins(source);
      expect(inventory.observed, JSON.stringify(source ?? null)).toBe(false);
      expect(inventory.plugins).toEqual([]);
      expect(inventory.limitations.length).toBeGreaterThan(0);
    }
  });

  test("skips an entry it cannot read without discarding the ones it can", () => {
    const inventory = parseInstalledPlugins(registry({
      "good@market": [entry()],
      "no-marketplace": [entry()],
      "bad-scope@market": [entry({ scope: "wandering" })],
      "missing-sha@market": [entry({ gitCommitSha: 7 })],
    }));

    expect(inventory.observed).toBe(true);
    expect(inventory.plugins.map((plugin) => plugin.id)).toEqual(["good"]);
    expect(inventory.limitations).toEqual([
      "bad-scope@market: unreadable installation entry",
      "missing-sha@market: unreadable installation entry",
      "no-marketplace: not a '<plugin>@<marketplace>' key",
    ]);
  });

  test("a plugin installed for another project is not available here", () => {
    const inventory = parseInstalledPlugins(registry({
      "mine@market": [entry({ scope: "local", projectPath: HERE })],
      "theirs@market": [entry({ scope: "local", projectPath: ELSEWHERE })],
      "everywhere@market": [entry({ scope: "user" })],
      "committed@market": [entry({ scope: "project", projectPath: HERE })],
    }));

    const split = partitionForProject(inventory, HERE);

    // Reusing a plugin bound to someone else's project would be an inference dressed as
    // an observation: the registry says plainly which project it belongs to.
    expect(split.available.map((plugin) => plugin.id).sort()).toEqual(["committed", "everywhere", "mine"]);
    expect(split.boundElsewhere.map((plugin) => plugin.id)).toEqual(["theirs"]);
  });

  test("a project-scoped entry without a project path binds to nothing", () => {
    const inventory = parseInstalledPlugins(registry({
      "orphan@market": [entry({ scope: "local" })],
    }));

    const split = partitionForProject(inventory, HERE);

    expect(split.available).toEqual([]);
    expect(split.boundElsewhere.map((plugin) => plugin.id)).toEqual(["orphan"]);
  });

  test("the same plugin installed twice is reported once per distinct installation", () => {
    const inventory = parseInstalledPlugins(registry({
      "dual@market": [entry({ scope: "user" }), entry({ scope: "local", projectPath: ELSEWHERE })],
    }));

    expect(inventory.plugins).toHaveLength(2);
    expect(partitionForProject(inventory, HERE).available.map((plugin) => plugin.scope)).toEqual(["user"]);
  });

  test("an inventory is ordered and comparable, so two reads of one machine agree", () => {
    const first = parseInstalledPlugins(registry({ "b@m": [entry()], "a@m": [entry()] }));
    const second = parseInstalledPlugins(registry({ "a@m": [entry()], "b@m": [entry()] }));

    expect(first.plugins.map((plugin) => plugin.id)).toEqual(["a", "b"]);
    expect(first).toEqual<ClientInventory>(second);
  });
});
