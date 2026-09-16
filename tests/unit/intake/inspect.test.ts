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
  test("recursively recognizes Spring Gradle and suggests a wrapper without executing it", async () => {
    const project = await fixture();
    await project.file("services/api/build.gradle.kts", 'plugins { id("org.springframework.boot") version "3.5.0" }');
    await project.file("services/api/gradlew", "throw new Error('never execute');");
    await project.file("node_modules/hidden/pom.xml", "<project>org.springframework</project>");
    const result = await inspectProject({ root: project.root, brief: "Maintain service." });
    expect(result.languages).toEqual(["java"]);
    expect(result.frameworks).toEqual(["spring"]);
    expect(result.qualityCommands).toContainEqual({ name: "test", argv: ["./gradlew", "test"], cwd: "services/api" });
    expect(result.evidenceRecords).toContainEqual(expect.objectContaining({ path: "services/api/build.gradle.kts", sha256: expect.stringMatching(/^[a-f0-9]{64}$/), locator: "file", inference: "manifest" }));
    expect(result.evidenceRecords?.some((item) => item.path.startsWith("node_modules/"))).toBe(false);
    expect(result.scan?.status).toBe("complete");
  });

  test("hashes observed source files and records inference separately from manifest facts", async () => {
    const project = await fixture();
    await project.file("src/main/java/Service.java", "class Service {}\n");
    const result = await inspectProject({ root: project.root });
    expect(result.evidenceRecords).toContainEqual(expect.objectContaining({ path: "src/main/java/Service.java", signal: "file:observed", locator: "file", inference: "presence", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });

  test("recognizes Maven Spring with a Windows wrapper as a suggestion only", async () => {
    const project = await fixture();
    await project.file("pom.xml", "<project><groupId>org.springframework.boot</groupId></project>");
    await project.file("mvnw.cmd", "never execute");
    const result = await inspectProject({ root: project.root });
    expect(result.frameworks).toEqual(["spring"]);
    expect(result.qualityCommands).toContainEqual({ name: "test", argv: ["./mvnw.cmd", "test"] });
    expect(result.evidenceRecords).toContainEqual(expect.objectContaining({ path: "pom.xml", signal: "dependency:spring", inference: "text-pattern" }));
  });

  test("reports bounded incomplete scanning instead of claiming complete evidence", async () => {
    const project = await fixture();
    await project.file("a/pom.xml", "<project/>");
    await project.file("b/pom.xml", "<project/>");
    const result = await inspectProject({ root: project.root, limits: { maxEntries: 1 } });
    expect(result.scan?.status).toBe("limited");
    expect(result.scan?.limitations).toContain("entry-limit");
    expect(result.scan?.visitedEntries).toBe(1);
  });

  test("excludes credential stores from evidence", async () => {
    const project = await fixture();
    await project.file(".npmrc", "//registry.example/:_authToken=private");
    await project.file(".ssh/config", "private");
    const result = await inspectProject({ root: project.root });
    expect(result.scan?.hashedFiles).toBe(0);
  });

  test("bounds explicit input counts and brief length", async () => {
    const project = await fixture();
    await project.file("spec.md", "Specification");
    await expect(inspectProject({ root: project.root, specificationPaths: Array(129).fill("spec.md") })).rejects.toMatchObject({ code: "FY_INTAKE_UNSAFE" });
    await expect(inspectProject({ root: project.root, brief: "x".repeat(20_001) })).rejects.toMatchObject({ code: "FY_INTAKE_UNSAFE" });
  });

  test("rejects secret and symlink-parent specifications", async () => {
    const project = await fixture();
    const outside = await fixture();
    await project.file(".env", "TOKEN=private");
    await expect(inspectProject({ root: project.root, specificationPaths: [".env"] })).rejects.toMatchObject({ code: "FY_INTAKE_UNSAFE" });
    await outside.file("spec.md", "Outside");
    try {
      await symlink(outside.root, path.join(project.root, "linked"), "junction");
      await expect(inspectProject({ root: project.root, specificationPaths: ["linked/spec.md"] })).rejects.toMatchObject({ code: "FY_INTAKE_UNSAFE" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  });

  test("does not infer a language from a symbolic-link manifest", async () => {
    const project = await fixture();
    const outside = await fixture();
    await outside.file("go.mod", "module example\n");
    try {
      await symlink(path.join(outside.root, "go.mod"), path.join(project.root, "go.mod"), "file");
      const result = await inspectProject({ root: project.root });
      expect(result.languages).toEqual([]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  });

  test("does not infer language or checks from a directory named like a manifest", async () => {
    const project = await fixture();
    await project.dir("go.mod");
    const result = await inspectProject({ root: project.root });
    expect(result.languages).toEqual([]);
    expect(result.qualityCommands).toEqual([{ name: "diff-check", argv: ["git", "diff", "--check"] }]);
  });
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
