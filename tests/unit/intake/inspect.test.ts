import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { inspectProject } from "../../../src/intake/inspect.js";

const roots: string[] = [];

async function fixture(): Promise<{
  root: string;
  file(relativePath: string, content?: string | Uint8Array): Promise<void>;
  dir(relativePath: string): Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-inspect-"));
  roots.push(root);
  return {
    root,
    async file(relativePath, content = "") {
      const target = path.join(root, ...relativePath.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    },
    dir: async (relativePath) => {
      await mkdir(path.join(root, ...relativePath.split("/")), { recursive: true });
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project inspection", () => {
  test("recognizes an existing Next.js project and its native checks", async () => {
    const project = await fixture();
    await project.file("package.json", JSON.stringify({
      name: "shop-ui",
      scripts: { test: "vitest run", build: "next build", lint: "next lint" },
      dependencies: { next: "16.0.0", react: "19.0.0" },
      devDependencies: { typescript: "7.0.0" },
    }));
    await project.file("tsconfig.json", "{}\n");
    await project.dir("app");

    const result = await inspectProject({
      root: project.root,
      brief: "Add accessible checkout recovery.",
    });

    expect(result).toEqual(expect.objectContaining({
      schemaVersion: 1,
      name: "shop-ui",
      request: "Add accessible checkout recovery.",
      mode: "existing",
      kind: "frontend",
      languages: ["typescript"],
      frameworks: ["next.js", "react"],
      packageManagers: ["npm"],
      mutableRoots: ["app"],
      questions: [],
      confidence: "high",
    }));
    expect(result.qualityCommands).toEqual([
      { name: "test", argv: ["npm", "test"] },
      { name: "lint", argv: ["npm", "run", "lint"] },
      { name: "build", argv: ["npm", "run", "build"] },
    ]);
    expect(result.evidence).toEqual(expect.arrayContaining([
      { path: "package.json", signal: "dependency:next" },
      { path: "package.json", signal: "script:test" },
      { path: "tsconfig.json", signal: "language:typescript" },
    ]));
  });

  test("recognizes a Python API without inventing pytest", async () => {
    const project = await fixture();
    await project.file("pyproject.toml", "[project]\nname='ledger-api'\ndependencies=['fastapi']\n");
    await project.dir("src");

    const result = await inspectProject({ root: project.root, brief: "Add a balance endpoint." });

    expect(result).toEqual(expect.objectContaining({
      name: "ledger-api",
      mode: "existing",
      kind: "backend",
      languages: ["python"],
      frameworks: ["fastapi"],
      packageManagers: ["python"],
      qualityCommands: [{ name: "diff-check", argv: ["git", "diff", "--check"] }],
      mutableRoots: ["src"],
    }));
  });

  test("uses conservative facts for a blank project", async () => {
    const project = await fixture();

    const result = await inspectProject({ root: project.root, brief: "Build a local command-line timer." });

    expect(result).toEqual(expect.objectContaining({
      mode: "new",
      kind: "cli",
      languages: [],
      frameworks: [],
      packageManagers: [],
      qualityCommands: [{ name: "diff-check", argv: ["git", "diff", "--check"] }],
      mutableRoots: ["src"],
      confidence: "medium",
    }));
  });

  test.each([
    ["pnpm-lock.yaml", "pnpm", ["pnpm", "test"]],
    ["yarn.lock", "yarn", ["yarn", "test"]],
    ["bun.lock", "bun", ["bun", "test"]],
  ] as const)("uses %s as package-manager evidence", async (lock, manager, argv) => {
    const project = await fixture();
    await project.file("package.json", JSON.stringify({ name: "web", scripts: { test: "vitest run" } }));
    await project.file(lock);

    const result = await inspectProject({ root: project.root, brief: "Maintain the web package." });

    expect(result.packageManagers).toEqual([manager]);
    expect(result.qualityCommands[0]?.argv).toEqual(argv);
    expect(result.evidence).toContainEqual({ path: lock, signal: `package-manager:${manager}` });
  });

  test("recognizes full-stack and model-integration signals", async () => {
    const project = await fixture();
    await project.file("package.json", JSON.stringify({
      name: "assistant-console",
      dependencies: { react: "19.0.0", express: "5.0.0", openai: "6.0.0" },
    }));

    const result = await inspectProject({ root: project.root, brief: "Add an AI-assisted support flow." });

    expect(result.kind).toBe("full-stack");
    expect(result.frameworks).toEqual(["express", "openai", "react"]);
  });

  test("uses explicit input before specification and README purpose", async () => {
    const project = await fixture();
    await project.file("README.md", "# Readme Product\n\nREADME purpose.\n");
    await project.file("requirements.md", "# Required Product\n\nSpecification purpose.\n");

    const explicit = await inspectProject({
      root: project.root,
      brief: "Explicit purpose.",
      specificationPaths: ["requirements.md"],
    });
    const specification = await inspectProject({ root: project.root, specificationPaths: ["requirements.md"] });
    const readme = await inspectProject({ root: project.root });

    expect(explicit.request).toBe("Explicit purpose.");
    expect(specification.request).toBe("Specification purpose.");
    expect(specification.sources).toEqual(["requirements.md"]);
    expect(readme.request).toBe("README purpose.");
  });

  test("records existing host instructions without reading their bodies", async () => {
    const project = await fixture();
    await project.file("AGENTS.md", "private project instructions that must be preserved\n");
    await project.file("CLAUDE.md", "more private instructions\n");

    const result = await inspectProject({ root: project.root, brief: "Fix the existing service." });

    expect(result.instructionSurfaces).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(result.evidence).toEqual(expect.arrayContaining([
      { path: "AGENTS.md", signal: "host-instructions:codex" },
      { path: "CLAUDE.md", signal: "host-instructions:claude-code" },
    ]));
  });

  test("asks one product question when no purpose is available", async () => {
    const project = await fixture();

    const result = await inspectProject({ root: project.root });

    expect(result.request).toBe("");
    expect(result.questions).toEqual(["What outcome should this software deliver?"]);
    expect(result.confidence).toBe("low");
  });

  test("rejects escaping, binary, oversized, and symbolic-link specifications", async () => {
    const project = await fixture();
    const outside = await fixture();
    await outside.file("outside.md", "Outside\n");
    await project.file("binary.md", new Uint8Array([65, 0, 66]));
    await project.file("large.md", "x".repeat(256 * 1024 + 1));

    await expect(inspectProject({
      root: project.root,
      specificationPaths: ["../outside.md"],
    })).rejects.toEqual(expect.objectContaining({ code: "FY_INTAKE_UNSAFE", exitCode: 4 }));
    await expect(inspectProject({ root: project.root, specificationPaths: ["binary.md"] }))
      .rejects.toEqual(expect.objectContaining({ code: "FY_INTAKE_UNSAFE" }));
    await expect(inspectProject({ root: project.root, specificationPaths: ["large.md"] }))
      .rejects.toEqual(expect.objectContaining({ code: "FY_INTAKE_UNSAFE" }));

    const link = path.join(project.root, "linked.md");
    try {
      await symlink(path.join(outside.root, "outside.md"), link, "file");
      await expect(inspectProject({ root: project.root, specificationPaths: ["linked.md"] }))
        .rejects.toEqual(expect.objectContaining({ code: "FY_INTAKE_UNSAFE" }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  });

  test("computes the same fingerprint for identical projects at different roots", async () => {
    const first = await fixture();
    const second = await fixture();
    for (const project of [first, second]) {
      await project.file("package.json", JSON.stringify({ name: "same", dependencies: { react: "19.0.0" } }));
      await project.file("README.md", "# Same\n\nBuild the same thing.\n");
    }

    const left = await inspectProject({ root: first.root });
    const right = await inspectProject({ root: second.root });

    expect(left.analysisSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(left.analysisSha256).toBe(right.analysisSha256);
  });
});
