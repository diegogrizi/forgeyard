import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

const GUARD = path.resolve("packs/foundation/templates/write-guard.mjs");
const GUIDE = path.resolve("docs/guide/problemi.md");
const HEADING = "#### L'assistente dice che una modifica è stata negata da Forgeyard";

/** Every reason the installed guard can print, taken from the guard itself. */
function refusalReasons(source: string): readonly string[] {
  return [...source.matchAll(/deny\("([^"]+)"\)/g)].map((match) => match[1] ?? "").sort();
}

/** The reasons the troubleshooting guide claims to explain, taken from its own table. */
function documentedReasons(guide: string): readonly string[] {
  const start = guide.indexOf(HEADING);
  if (start < 0) throw new Error(`The troubleshooting guide no longer has the section '${HEADING}'.`);
  const rest = guide.slice(start + HEADING.length);
  const end = rest.search(/\n#{2,4} /);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1] ?? "").sort();
}

/**
 * A refusal the user reads in their client and cannot look up is indistinguishable from a bug.
 * The guide restates the guard's reasons by necessity — a document cannot import a template — so
 * the two are held together here rather than by whoever remembers to edit both.
 */
describe("write guard refusals", () => {
  test("are documented, one for one, by the troubleshooting guide", async () => {
    const [guard, guide] = await Promise.all([readFile(GUARD, "utf8"), readFile(GUIDE, "utf8")]);

    const reasons = refusalReasons(guard);
    expect(reasons.length).toBeGreaterThan(0);
    // Set equality in both directions: an undocumented refusal leaves a user stuck, and a
    // documented one the guard can no longer print sends them looking for the wrong thing.
    expect(documentedReasons(guide)).toEqual(reasons);
  });
});
