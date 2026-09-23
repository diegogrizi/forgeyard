import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "vitest";

const TEMPLATE = path.resolve("packs/foundation/templates/write-guard.mjs");
const roots: string[] = [];

afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/**
 * The workspace identity is stated twice by necessity: `src/native/workspace.ts` computes it for
 * the service, and the installed guard recomputes it because trusting an id handed to it by a file
 * inside the project would let a forged id select another workspace's grant. Two statements of one
 * rule diverge, so the divergence that actually happened is pinned here.
 */
describe("write guard workspace identity", () => {
  test("resolves a project root to the same string the service resolves it to", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-guard-root-"));
    roots.push(root);

    // The guard's resolver and the service's resolver must agree byte for byte: the two results
    // are hashed into the key the guard looks the project state up by. On Windows the temporary
    // directory can carry an 8.3 short component, which is the spelling that diverged.
    expect(realpathSync.native(root)).toBe(await realpath(root));
  });

  test("uses that one resolver everywhere, so no call site can reintroduce the other spelling", async () => {
    const source = await readFile(TEMPLATE, "utf8");

    // `realpathSync` keeps a short component the service's `realpath` expands. A guard that
    // resolves its root one way and its candidate paths the other denies every write, which
    // looks like a working guard and is a guard that never ran.
    expect(source.split("realpathSync(").length - 1).toBe(0);
    expect(source).toContain("realpathSync.native(");
  });
});
