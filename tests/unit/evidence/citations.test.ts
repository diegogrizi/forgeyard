import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { sha256Text } from "../../../src/core/hash.js";
import {
  assertCitationsLive,
  checkCitations,
  type Citation,
} from "../../../src/evidence/citations.js";

const roots: string[] = [];
const INVALID = { code: "FY_CITATION_INVALID", exitCode: 2 };

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-citation-"));
  roots.push(root);
  return root;
}

async function file(root: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function citation(relativePath: string, content: string, locator?: string): Citation {
  return { path: relativePath, sha256: sha256Text(content), ...(locator === undefined ? {} : { locator }) };
}

/** Windows denies symbolic links without the right privilege; such a case proves nothing here. */
async function link(target: string, location: string, type: "file" | "junction"): Promise<boolean> {
  try {
    await symlink(target, location, type);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    return false;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("live citations", () => {
  test("calls a citation live only when the bytes still hash to the cited digest", async () => {
    const root = await fixture();
    await file(root, "docs/guide.md", "Present state\n");

    await expect(checkCitations(root, [citation("docs/guide.md", "Present state\n", "L1-L1")])).resolves.toEqual([
      { citation: citation("docs/guide.md", "Present state\n", "L1-L1"), status: "live" },
    ]);
  });

  test("calls a citation stale when the source changed, and reports the current digest", async () => {
    const root = await fixture();
    await file(root, "docs/guide.md", "Later state\n");

    const checks = await checkCitations(root, [citation("docs/guide.md", "Earlier state\n")]);

    expect(checks).toEqual([
      {
        citation: citation("docs/guide.md", "Earlier state\n"),
        status: "stale",
        currentSha256: sha256Text("Later state\n"),
      },
    ]);
  });

  test("calls a citation missing when the file, its parent, or its regularity is gone", async () => {
    const root = await fixture();
    await file(root, "docs/guide.md", "Present\n");
    await mkdir(path.join(root, "docs", "chapter"), { recursive: true });

    const checks = await checkCitations(root, [
      citation("docs/absent.md", "Present\n"),
      citation("nowhere/absent.md", "Present\n"),
      citation("docs/chapter", "Present\n"),
    ]);

    expect(checks.map((check) => check.status)).toEqual(["missing", "missing", "missing"]);
    expect(checks.every((check) => check.currentSha256 === undefined)).toBe(true);
  });

  test("calls a citation missing past the byte limit instead of reading it", async () => {
    const root = await fixture();
    const content = "x".repeat(64);
    await file(root, "docs/big.md", content);

    await expect(checkCitations(root, [citation("docs/big.md", content)], 16)).resolves.toEqual([
      { citation: citation("docs/big.md", content), status: "missing" },
    ]);
    await expect(checkCitations(root, [citation("docs/big.md", content)], 64)).resolves.toEqual([
      { citation: citation("docs/big.md", content), status: "live" },
    ]);
  });

  test("does not follow a symbolic link, even one pointing at matching bytes inside the root", async () => {
    const root = await fixture();
    await file(root, "docs/guide.md", "Present\n");
    if (!(await link(path.join(root, "docs", "guide.md"), path.join(root, "docs", "alias.md"), "file"))) return;

    await expect(checkCitations(root, [citation("docs/alias.md", "Present\n")])).resolves.toEqual([
      { citation: citation("docs/alias.md", "Present\n"), status: "missing" },
    ]);
  });

  test("does not reach a citation through a linked parent directory, nor cite the link itself", async () => {
    const root = await fixture();
    const outside = await fixture();
    await file(outside, "guide.md", "Present\n");
    if (!(await link(outside, path.join(root, "linked"), "junction"))) return;

    const checks = await checkCitations(root, [
      citation("linked/guide.md", "Present\n"),
      citation("linked", "Present\n"),
    ]);

    expect(checks.map((check) => check.status)).toEqual(["missing", "missing"]);
  });

  test("rejects an uncitable path or digest as a programming error, not as staleness", async () => {
    const root = await fixture();
    await file(root, "docs/guide.md", "Present\n");

    await expect(checkCitations(root, [citation("../outside.md", "Present\n")])).rejects.toMatchObject(INVALID);
    await expect(checkCitations(root, [citation("/etc/passwd", "Present\n")])).rejects.toMatchObject(INVALID);
    await expect(checkCitations(root, [citation("docs/../../escape.md", "Present\n")])).rejects.toMatchObject(INVALID);
    await expect(checkCitations(root, [{ path: "", sha256: "a".repeat(64) }])).rejects.toMatchObject(INVALID);
    await expect(checkCitations(root, [{ path: "docs/guide.md", sha256: "abc" }])).rejects.toMatchObject(INVALID);
    await expect(
      checkCitations(root, [{ path: "docs/guide.md", sha256: "A".repeat(64) }]),
    ).rejects.toMatchObject(INVALID);
    await expect(
      checkCitations(root, [{ path: "docs/guide.md", sha256: sha256Text("Present\n"), locator: "x".repeat(257) }]),
    ).rejects.toMatchObject(INVALID);
  });

  test("validates the whole batch before reading any byte", async () => {
    const root = await fixture();
    await file(root, "docs/guide.md", "Present\n");

    await expect(
      checkCitations(root, [citation("docs/guide.md", "Present\n"), citation("../outside.md", "Present\n")]),
    ).rejects.toMatchObject(INVALID);
  });

  test("keeps the output in the order of the input", async () => {
    const root = await fixture();
    await file(root, "a.md", "A\n");
    await file(root, "c.md", "C changed\n");

    const checks = await checkCitations(root, [
      citation("a.md", "A\n"),
      citation("b.md", "B\n"),
      citation("c.md", "C\n"),
      citation("a.md", "A\n"),
    ]);

    expect(checks.map((check) => check.citation.path)).toEqual(["a.md", "b.md", "c.md", "a.md"]);
    expect(checks.map((check) => check.status)).toEqual(["live", "missing", "stale", "live"]);
    expect(await checkCitations(root, [])).toEqual([]);
  });

  test("blocks on any citation that is not live, and lists the offending paths", async () => {
    const root = await fixture();
    await file(root, "a.md", "A\n");
    await file(root, "c.md", "C changed\n");
    const checks = await checkCitations(root, [
      citation("a.md", "A\n"),
      citation("b.md", "B\n"),
      citation("c.md", "C\n"),
    ]);

    expect(() => assertCitationsLive(checks.slice(0, 1))).not.toThrow();
    expect(() => assertCitationsLive([])).not.toThrow();
    expect(() => assertCitationsLive(checks)).toThrow(
      expect.objectContaining({ code: "FY_CITATION_STALE", exitCode: 9, paths: ["b.md", "c.md"] }),
    );
  });
});
