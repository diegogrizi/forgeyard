import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { loadCapabilityRules } from "../../../src/intake/capability-rules.js";

const ROOT = path.resolve(".");

async function curatedProfiles(): Promise<{ id: string; plugins: readonly string[] }[]> {
  const files = (await readdir(path.join(ROOT, "profiles"))).filter((name) => name.endsWith(".yaml")).sort();
  const profiles: { id: string; plugins: readonly string[] }[] = [];
  for (const file of files) {
    const source = await readFile(path.join(ROOT, "profiles", file), "utf8");
    const block = /\n\s{2}plugins:\n((?:\s{4}- .+\n)*)/.exec(source);
    profiles.push({
      id: file.replace(/\.yaml$/, ""),
      plugins: [...(block?.[1] ?? "").matchAll(/^\s{4}- (.+)$/gm)].map((match) => match[1]!.trim()),
    });
  }
  return profiles;
}

/**
 * A curated profile and the capability rules answer the same question, so they are one rule in
 * two places — and the more permissive place wins unless something holds them together. It did
 * not: the rules excluded four competing orchestrators because Forgeyard is the single primary
 * delivery workflow, and the curated profile installed all four anyway.
 */
describe("a curated profile obeys the capability rules", () => {
  test("never installs a capability the rules exclude", async () => {
    const rules = await loadCapabilityRules(ROOT);
    const excluded = new Set(rules.exclusions.map((exclusion) => exclusion.id));

    const contradictions: string[] = [];
    for (const profile of await curatedProfiles()) {
      for (const plugin of profile.plugins) {
        if (excluded.has(plugin)) contradictions.push(`${profile.id}: ${plugin}`);
      }
    }

    expect(contradictions).toEqual([]);
  });

  test("selects nothing it cannot say why it selected", async () => {
    const rules = await loadCapabilityRules(ROOT);
    const justified = new Set([
      ...rules.baseline.map((choice) => choice.id),
      ...rules.rules.flatMap((rule) => rule.include.map((choice) => choice.id)),
    ]);

    const unjustified: string[] = [];
    for (const profile of await curatedProfiles()) {
      for (const plugin of profile.plugins) {
        if (!justified.has(plugin)) unjustified.push(`${profile.id}: ${plugin}`);
      }
    }

    // A capability nobody wrote a reason for is an assertion, not a selection.
    expect(unjustified).toEqual([]);
  });
});
