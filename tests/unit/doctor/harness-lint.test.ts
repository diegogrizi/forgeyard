import { describe, expect, test } from "vitest";

import type { PlannedFile } from "../../../src/core/contracts.js";
import { canonicalJson, sha256Text } from "../../../src/core/hash.js";
import {
  assertHarnessAccepted,
  lintHarness,
  type HarnessLintFinding,
} from "../../../src/doctor/harness-lint.js";

const BODY = "Run the quality gates before you report anything.";
const INCOHERENT = expect.objectContaining({ code: "FY_HARNESS_INCOHERENT", exitCode: 9 });

function planned(filePath: string, content: string, componentId = "foundation.test"): PlannedFile {
  return {
    path: filePath,
    content,
    sha256: sha256Text(content),
    componentId,
    ownership: "managed",
  };
}

/** A file whose bytes come from the pinned third-party catalog snapshot. */
function vendored(filePath: string, content: string): PlannedFile {
  return planned(filePath, content, "ecosystem.catalog.portable");
}

/** A generated Markdown component with closed YAML frontmatter, as both adapters emit. */
function doc(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: A generated component.\n---\n\n${body}\n`;
}

function shapes(findings: readonly HarnessLintFinding[]): Array<[string, string, string]> {
  return findings.map((finding) => [finding.severity, finding.rule, finding.path]);
}

function owned(findings: readonly HarnessLintFinding[]): Array<[string, string, string, string]> {
  return findings.map((finding) => [finding.severity, finding.ownership, finding.rule, finding.path]);
}

describe("harness lint", () => {
  test("accepts a coherent plan and still reports the largest instruction file", () => {
    const files = [
      planned("CLAUDE.md", doc("project", `${BODY}\n\nSee [the workflow](.claude/skills/x/SKILL.md).\n`)),
      planned(".claude/skills/x/SKILL.md", doc("x", `${BODY}\n\nRead [the note](references/y.md).\n`)),
      planned(".claude/skills/x/references/y.md", doc("y", BODY)),
    ];

    const report = lintHarness(files);

    expect(report.findings).toEqual([]);
    expect(report.status).toBe("clean");
    expect(report.counts).toEqual({ blocking: 0, important: 0, informational: 0 });
    expect(report.generatedBlocking).toBe(0);
    expect(report.budget).toEqual({
      largestPath: "CLAUDE.md",
      largestBytes: Buffer.byteLength(files[0]!.content, "utf8"),
      rootCeilingBytes: 32_768,
      fileCeilingBytes: 16_384,
    });
  });

  test("resolves a parent reference and rejects one that leaves the project root", () => {
    const files = [
      planned(
        ".claude/skills/x/SKILL.md",
        doc("x", `${BODY}\n\nSee [sibling](../y/SKILL.md) and [outside](../../../../secrets.md).\n`),
      ),
      planned(".claude/skills/y/SKILL.md", doc("y", BODY)),
    ];

    const report = lintHarness(files);

    expect(report.findings).toEqual([
      {
        rule: "dangling-reference",
        severity: "blocking",
        ownership: "generated",
        path: ".claude/skills/x/SKILL.md",
        detail: expect.stringContaining("../../../../secrets.md"),
        subject: "../../../../secrets.md",
      },
    ]);
    expect(report.findings[0]?.detail).toContain("project root");
    expect(report.status).toBe("rejected");
  });

  test("treats a harness-rooted reference as project-relative even inside a nested file", () => {
    const files = [
      planned(
        ".claude/skills/x/SKILL.md",
        doc("x", `${BODY}\n\nSee [the reviewer](.claude/agents/forgeyard-reviewer.md) and .agents/skills/y/SKILL.md.\n`),
      ),
      planned(".claude/agents/forgeyard-reviewer.md", doc("forgeyard-reviewer", BODY)),
      planned(".agents/skills/y/SKILL.md", doc("y", BODY)),
    ];

    expect(lintHarness(files).findings).toEqual([]);
  });

  test("reports a bare harness path mention that the plan never installs", () => {
    const files = [planned("CLAUDE.md", doc("project", `${BODY}\n\nThe capsule lives in .forgeyard/capsule.json.\n`))];

    const report = lintHarness(files);

    expect(report.findings).toEqual([
      {
        rule: "dangling-reference",
        severity: "blocking",
        ownership: "generated",
        path: "CLAUDE.md",
        detail: expect.stringContaining(".forgeyard/capsule.json"),
        subject: ".forgeyard/capsule.json",
      },
    ]);
    expect(lintHarness(files, { externalPaths: [".forgeyard/capsule.json"] }).findings).toEqual([]);
  });

  test("ignores web links, mail links, other schemes and pure anchors", () => {
    const body = [
      BODY,
      "",
      "Read [the guide](https://example.invalid/guide.md) or [the mirror](http://example.invalid/m.md).",
      "Write to [the author](mailto:someone@example.invalid) or jump to [the section](#quality-gates).",
      "Open [the editor](vscode://file/x.md) if you prefer.",
    ].join("\n");

    expect(lintHarness([planned("CLAUDE.md", doc("project", body))]).findings).toEqual([]);
  });

  test("reports an unresolved wiki-link and accepts one that matches an installed file", () => {
    const files = [
      planned(".claude/skills/x/SKILL.md", doc("x", `${BODY}\n\nSee [[y]] and [[ghost]].\n`)),
      planned(".claude/skills/x/y.md", doc("y", BODY)),
    ];

    const report = lintHarness(files);

    expect(report.findings).toEqual([
      {
        rule: "dangling-reference",
        severity: "blocking",
        ownership: "generated",
        path: ".claude/skills/x/SKILL.md",
        detail: expect.stringContaining("[[ghost]]"),
        subject: "ghost",
      },
    ]);
  });

  test("reports an unreferenced reference file and leaves other installed files alone", () => {
    const files = [
      planned("CLAUDE.md", doc("project", BODY)),
      planned(".claude/skills/x/SKILL.md", doc("x", BODY)),
      planned(".claude/skills/x/references/lonely.md", doc("lonely", BODY)),
    ];

    const report = lintHarness(files);

    expect(report.findings).toEqual([
      {
        rule: "orphan-reference",
        severity: "important",
        ownership: "generated",
        path: ".claude/skills/x/references/lonely.md",
        detail: expect.stringContaining("lonely.md"),
      },
    ]);
    expect(report.status).toBe("warned");
    expect(report.counts).toEqual({ blocking: 0, important: 1, informational: 0 });
  });

  test("does not consider a reference file orphaned when only itself points at it", () => {
    const files = [
      planned("CLAUDE.md", doc("project", `${BODY}\n\nSee [notes](.claude/skills/x/references/notes.md).\n`)),
      planned(
        ".claude/skills/x/references/notes.md",
        doc("notes", `${BODY}\n\nBack to [these notes](notes.md).\n`),
      ),
      planned(
        ".claude/skills/x/references/alone.md",
        doc("alone", `${BODY}\n\nBack to [itself](alone.md).\n`),
      ),
    ];

    expect(shapes(lintHarness(files).findings)).toEqual([
      ["important", "orphan-reference", ".claude/skills/x/references/alone.md"],
    ]);
  });

  test("reports machine-absolute paths without flagging URL routes or remote paths", () => {
    const body = [
      BODY,
      "",
      "Generated from C:\\Users\\nome\\Documents\\forgeyard and /Users/nome/Documents/spec.md.",
      "The route /api/v1/users stays stable, and /home is never a bare route here.",
      "Mirrored at https://example.invalid/home/index.html for the public docs.",
    ].join("\n");

    const report = lintHarness([planned("CLAUDE.md", doc("project", body))]);

    expect(report.findings).toEqual([
      {
        rule: "absolute-path-leak",
        severity: "blocking",
        ownership: "generated",
        path: "CLAUDE.md",
        detail: expect.stringContaining("/Users/nome/Documents/spec.md"),
        subject: "/Users/nome/Documents/spec.md",
      },
      {
        rule: "absolute-path-leak",
        severity: "blocking",
        ownership: "generated",
        path: "CLAUDE.md",
        detail: expect.stringContaining("C:\\Users\\nome\\Documents\\forgeyard"),
        subject: "C:\\Users\\nome\\Documents\\forgeyard",
      },
    ]);
    expect(canonicalJson(report.findings)).not.toContain("/api/v1/users");
    expect(canonicalJson(report.findings)).not.toContain("example.invalid");
  });

  test("reports a leak in a generated file that is not Markdown", () => {
    const settings = `${JSON.stringify({ command: "node /home/nome/.forgeyard/bin/write-guard.mjs" }, null, 2)}\n`;

    expect(shapes(lintHarness([planned(".claude/settings.json", settings)]).findings)).toEqual([
      ["blocking", "absolute-path-leak", ".claude/settings.json"],
    ]);
  });

  test("reports a template marker that survived rendering", () => {
    const report = lintHarness([planned("CLAUDE.md", doc("project", `${BODY}\n\nOwner: {{project.name}}\n`))]);

    expect(report.findings).toEqual([
      {
        rule: "unresolved-placeholder",
        severity: "blocking",
        ownership: "generated",
        path: "CLAUDE.md",
        detail: expect.stringContaining("{{project.name}}"),
        subject: "{{project.name}}",
      },
    ]);
  });

  test("reports every file that claims an authority name already taken", () => {
    const files = [
      planned(".claude/skills/second/SKILL.md", doc("forgeyard-workflow", BODY)),
      planned(".claude/skills/first/SKILL.md", doc("forgeyard-workflow", BODY)),
      planned(".claude/skills/third/SKILL.md", doc("third-party-skill", BODY)),
    ];

    const report = lintHarness(files);

    expect(report.findings).toEqual([
      {
        rule: "duplicate-authority",
        severity: "blocking",
        ownership: "generated",
        path: ".claude/skills/first/SKILL.md",
        detail: expect.stringContaining("forgeyard-workflow"),
        subject: "forgeyard-workflow",
      },
      {
        rule: "duplicate-authority",
        severity: "blocking",
        ownership: "generated",
        path: ".claude/skills/second/SKILL.md",
        detail: expect.stringContaining("forgeyard-workflow"),
        subject: "forgeyard-workflow",
      },
    ]);
  });

  test("applies the root ceiling to root instructions and the file ceiling to the rest", () => {
    const long = "x".repeat(20_000);
    const files = [
      planned("CLAUDE.md", doc("project", long)),
      planned(".claude/skills/x/SKILL.md", doc("x", long)),
    ];

    const defaults = lintHarness(files);

    expect(shapes(defaults.findings)).toEqual([
      ["important", "context-budget-exceeded", ".claude/skills/x/SKILL.md"],
    ]);
    expect(defaults.findings[0]?.subject).toBe(String(Buffer.byteLength(files[1]!.content, "utf8")));
    expect(defaults.budget.largestPath).toBe("CLAUDE.md");
    expect(defaults.status).toBe("warned");

    const swapped = lintHarness(files, { rootCeilingBytes: 1_000, fileCeilingBytes: 30_000 });

    expect(shapes(swapped.findings)).toEqual([["important", "context-budget-exceeded", "CLAUDE.md"]]);
    expect(swapped.budget.rootCeilingBytes).toBe(1_000);
    expect(swapped.budget.fileCeilingBytes).toBe(30_000);
  });

  test("measures the budget in UTF-8 bytes rather than code units", () => {
    const body = "e\u0301".repeat(40);
    const file = planned("CLAUDE.md", doc("project", body));

    const report = lintHarness([file]);

    expect(report.budget.largestBytes).toBe(Buffer.byteLength(file.content, "utf8"));
    expect(report.budget.largestBytes).toBeGreaterThan(file.content.length);
    expect(lintHarness([file], { rootCeilingBytes: file.content.length }).findings).toEqual([
      {
        rule: "context-budget-exceeded",
        severity: "important",
        ownership: "generated",
        path: "CLAUDE.md",
        detail: expect.stringContaining("byte"),
        subject: String(Buffer.byteLength(file.content, "utf8")),
      },
    ]);
  });

  test("reports a budget of zero markdown files without inventing a largest path", () => {
    const report = lintHarness([planned(".forgeyard/bin/write-guard.mjs", "process.exit(0);\n")]);

    expect(report.budget).toEqual({
      largestPath: null,
      largestBytes: 0,
      rootCeilingBytes: 32_768,
      fileCeilingBytes: 16_384,
    });
    expect(report.status).toBe("clean");
  });

  test("reports an instruction file with nothing actionable left after the frontmatter", () => {
    const files = [
      planned(".claude/skills/blank/SKILL.md", "---\nname: blank\ndescription: d\n---\n\n<!-- TODO: write this -->\n\n"),
      planned(".claude/skills/thin/SKILL.md", doc("thin", "abcdefghij abcdefghij abcdefghij")),
      planned(".claude/skills/full/SKILL.md", doc("full", "abcdefghij abcdefghij abcdefghijkl")),
    ];

    expect(shapes(lintHarness(files).findings)).toEqual([
      ["important", "empty-instruction", ".claude/skills/blank/SKILL.md"],
      ["important", "empty-instruction", ".claude/skills/thin/SKILL.md"],
    ]);
  });

  test("reports a commit SHA and a line reference as references that will not survive", () => {
    const body = [
      BODY,
      "",
      "The decision landed in commit 4f0ab12 and the check lives at src/core/hash.ts:42.",
      "See docs/DIREZIONE.md#L10-L24 for the wording.",
    ].join("\n");

    const report = lintHarness([planned("CLAUDE.md", doc("project", body))]);

    expect(report.findings).toEqual([
      {
        rule: "volatile-reference",
        severity: "important",
        ownership: "generated",
        path: "CLAUDE.md",
        detail: expect.stringContaining("4f0ab12"),
        subject: "4f0ab12",
      },
      {
        rule: "volatile-reference",
        severity: "important",
        ownership: "generated",
        path: "CLAUDE.md",
        detail: expect.stringContaining("docs/DIREZIONE.md#L10-L24"),
        subject: "docs/DIREZIONE.md#L10-L24",
      },
      {
        rule: "volatile-reference",
        severity: "important",
        ownership: "generated",
        path: "CLAUDE.md",
        detail: expect.stringContaining("src/core/hash.ts:42"),
        subject: "src/core/hash.ts:42",
      },
    ]);
    expect(report.findings[0]?.detail).toMatch(/file path|symbol name|section title/);
    expect(report.status).toBe("warned");
  });

  test("leaves an evidence digest, an all-hex english word and a fenced example alone", () => {
    const digest = `${"a".repeat(63)}1`;
    const body = [
      BODY,
      "",
      `The receipt digest is ${digest}.`,
      "A decade of facade work defaced the cabbage patch.",
      "",
      "```bash",
      "git show 4f0ab12 -- src/core/hash.ts",
      'src/core/hash.ts:42: return createHash("sha256");',
      "```",
    ].join("\n");

    expect(lintHarness([planned("CLAUDE.md", doc("project", body))]).findings).toEqual([]);
  });

  test("tells an abbreviated commit SHA apart from a deliberate byte constant", () => {
    const body = [
      BODY,
      "",
      "The ceiling is 1048576 bytes and the hard cap is 16777216 bytes.",
      "Recorded at a3f9c1b and reverted in deadbeef1234.",
    ].join("\n");

    const report = lintHarness([planned("CLAUDE.md", doc("project", body))]);

    expect(shapes(report.findings)).toEqual([
      ["important", "volatile-reference", "CLAUDE.md"],
      ["important", "volatile-reference", "CLAUDE.md"],
    ]);
    expect(report.findings.map((finding) => finding.subject)).toEqual(["a3f9c1b", "deadbeef1234"]);
  });

  test("orders findings by severity, then rule, then path, then subject", () => {
    const files = [
      planned(
        "CLAUDE.md",
        doc(
          "project",
          `${BODY}\n\nFrom C:\\Users\\nome\\x at 4f0ab12 and {{project.name}} see [gone](missing.md).\n`,
        ),
      ),
      planned(".claude/skills/dup/SKILL.md", doc("twin", BODY)),
      planned(".claude/skills/other/SKILL.md", doc("twin", BODY)),
      planned(".claude/skills/other/references/lonely.md", "---\nname: lonely\n---\n"),
    ];

    expect(shapes(lintHarness(files).findings)).toEqual([
      ["blocking", "absolute-path-leak", "CLAUDE.md"],
      ["blocking", "dangling-reference", "CLAUDE.md"],
      ["blocking", "duplicate-authority", ".claude/skills/dup/SKILL.md"],
      ["blocking", "duplicate-authority", ".claude/skills/other/SKILL.md"],
      ["blocking", "unresolved-placeholder", "CLAUDE.md"],
      ["important", "empty-instruction", ".claude/skills/other/references/lonely.md"],
      ["important", "orphan-reference", ".claude/skills/other/references/lonely.md"],
      ["important", "volatile-reference", "CLAUDE.md"],
    ]);
  });

  test("reports a repeated broken reference once", () => {
    const body = `${BODY}\n\nSee [gone](missing.md), then [gone again](missing.md).\n`;

    expect(lintHarness([planned("CLAUDE.md", doc("project", body))]).findings).toHaveLength(1);
  });

  test("discloses a blocking finding on vendored bytes without rejecting the plan", () => {
    const files = [
      planned("CLAUDE.md", doc("project", BODY)),
      vendored(
        ".claude/skills/upstream/SKILL.md",
        doc("upstream", `${BODY}\n\nSee [the guide](references/guide.md) and {{catalog.marker}}.\n`),
      ),
    ];

    const report = lintHarness(files);

    expect(owned(report.findings)).toEqual([
      ["blocking", "vendored", "dangling-reference", ".claude/skills/upstream/SKILL.md"],
      ["blocking", "vendored", "unresolved-placeholder", ".claude/skills/upstream/SKILL.md"],
    ]);
    expect(report.counts.blocking).toBe(2);
    expect(report.generatedBlocking).toBe(0);
    expect(report.status).toBe("warned");
    expect(() => assertHarnessAccepted(report)).not.toThrow();
  });

  test("rejects a mixed plan only for the generated bytes it can repair", () => {
    const files = [
      planned("CLAUDE.md", doc("project", `${BODY}\n\nSee [gone](missing.md).\n`)),
      vendored(
        ".claude/skills/upstream/SKILL.md",
        doc("upstream", `${BODY}\n\nSee [absent](elsewhere.md).\n`),
      ),
    ];

    const report = lintHarness(files);

    expect(owned(report.findings)).toEqual([
      ["blocking", "generated", "dangling-reference", "CLAUDE.md"],
      ["blocking", "vendored", "dangling-reference", ".claude/skills/upstream/SKILL.md"],
    ]);
    expect(report.counts.blocking).toBe(2);
    expect(report.generatedBlocking).toBe(1);
    expect(report.status).toBe("rejected");

    let thrown: unknown;
    try {
      assertHarnessAccepted(report);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as { paths?: readonly string[] }).paths).toEqual(["CLAUDE.md"]);
  });

  test("replaces the default vendored prefix list with a caller supplied one", () => {
    const broken = `${BODY}\n\nSee [gone](missing.md).\n`;
    const upstream = [planned("CLAUDE.md", doc("project", broken), "upstream.pack")];

    expect(lintHarness(upstream).status).toBe("rejected");

    const report = lintHarness(upstream, { vendoredComponentPrefixes: ["upstream."] });

    expect(report.status).toBe("warned");
    expect(report.generatedBlocking).toBe(0);
    expect(report.findings[0]?.ownership).toBe("vendored");
    expect(
      lintHarness([vendored(".claude/skills/u/SKILL.md", doc("u", broken))], {
        vendoredComponentPrefixes: ["upstream."],
      }).status,
    ).toBe("rejected");
  });

  test("refuses to install a rejected harness and names the blocking paths", () => {
    const report = lintHarness([
      planned("CLAUDE.md", doc("project", `${BODY}\n\nOwner: {{project.name}}\n`)),
      planned(".claude/skills/x/SKILL.md", doc("x", `${BODY}\n\nSee [gone](missing.md).\n`)),
    ]);

    expect(report.status).toBe("rejected");
    expect(() => assertHarnessAccepted(report)).toThrow(INCOHERENT);
    expect(() => assertHarnessAccepted(report)).toThrow(/not been installed|was not installed/i);

    let thrown: unknown;
    try {
      assertHarnessAccepted(report);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as { paths?: readonly string[] }).paths).toEqual([".claude/skills/x/SKILL.md", "CLAUDE.md"]);
  });

  test("accepts a warned or clean harness without throwing", () => {
    const warned = lintHarness([
      planned("CLAUDE.md", doc("project", BODY)),
      planned(".claude/skills/x/references/lonely.md", doc("lonely", BODY)),
    ]);

    expect(warned.status).toBe("warned");
    expect(warned.generatedBlocking).toBe(0);
    expect(() => assertHarnessAccepted(warned)).not.toThrow();
    expect(() => assertHarnessAccepted(lintHarness([]))).not.toThrow();
    expect(lintHarness([]).status).toBe("clean");
    expect(lintHarness([]).generatedBlocking).toBe(0);
  });

  test("produces an identical report for identical input", () => {
    const files = [
      planned(
        "CLAUDE.md",
        doc(
          "project",
          `${BODY}\n\nFrom /Users/nome/x at 9fe1a0b and {{owner}} see [gone](missing.md) plus [[ghost]].\n`,
        ),
      ),
      planned(".claude/skills/dup/SKILL.md", doc("twin", BODY)),
      planned(".claude/skills/other/SKILL.md", doc("twin", BODY)),
      planned(".claude/skills/other/references/lonely.md", doc("lonely", BODY)),
      planned("AGENTS.md", doc("agents", "x".repeat(40_000))),
      vendored(
        ".claude/skills/upstream/SKILL.md",
        doc("upstream", `${BODY}\n\nSee [absent](elsewhere.md) and {{catalog.marker}}.\n`),
      ),
    ];

    const first = lintHarness(files);
    const second = lintHarness([...files]);

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.findings.length).toBeGreaterThan(5);
    expect(first.generatedBlocking).toBeLessThan(first.counts.blocking);
    expect(first.counts.blocking + first.counts.important + first.counts.informational).toBe(
      first.findings.length,
    );
  });
});
