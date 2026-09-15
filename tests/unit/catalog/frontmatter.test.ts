import { describe, expect, test } from "vitest";

import { parsePortableDocument } from "../../../src/catalog/frontmatter.js";

describe("portable catalog frontmatter", () => {
  test("parses folded descriptions and inline or block tool lists", () => {
    const document = parsePortableDocument(
      [
        "---",
        "name: example-agent",
        "description: >-",
        "  Reviews changes and",
        "  reports evidence.",
        "tools: [Read, Grep]",
        "tags:",
        "  - review",
        "  - evidence",
        "---",
        "# Example",
        "",
        "Follow the contract.",
        "",
      ].join("\n"),
      "agents/example-agent.md",
    );

    expect(document.frontmatter).toEqual({
      name: "example-agent",
      description: "Reviews changes and reports evidence.",
      tools: ["Read", "Grep"],
      tags: ["review", "evidence"],
    });
    expect(document.body).toBe("# Example\n\nFollow the contract.\n");
  });

  test("preserves a document without frontmatter", () => {
    expect(parsePortableDocument("# Plain\r\n\r\nBody\r\n", "plain.md")).toEqual({
      frontmatter: {},
      body: "# Plain\n\nBody\n",
    });
  });

  test("rejects malformed or non-object YAML frontmatter with its source path", () => {
    expect(() => parsePortableDocument("---\nname: [\n---\nBody\n", "broken.md")).toThrow(
      expect.objectContaining({ code: "FY_CATALOG_INVALID", paths: ["broken.md"] }),
    );
    expect(() => parsePortableDocument("---\n- one\n- two\n---\nBody\n", "list.md")).toThrow(
      expect.objectContaining({ code: "FY_CATALOG_INVALID", paths: ["list.md"] }),
    );
  });
});
