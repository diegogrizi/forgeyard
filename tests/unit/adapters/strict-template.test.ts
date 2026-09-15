import { describe, expect, test } from "vitest";

import {
  escapeHtmlText,
  escapeMarkdownInline,
  quoteTomlMultiline,
  quoteYamlString,
  renderStrictTemplate,
} from "../../../src/adapters/strict-template.js";

describe("strict template rendering", () => {
  test("substitutes dotted tokens deterministically and normalizes line endings", () => {
    expect(
      renderStrictTemplate("Name: {{project.name}}\r\nPurpose: {{project.purpose}}\r\n", {
        "project.purpose": "A concise purpose",
        "project.name": "Signal Garden",
      }),
    ).toBe("Name: Signal Garden\nPurpose: A concise purpose\n");
  });

  test("rejects a missing variable", () => {
    expect(() => renderStrictTemplate("{{project.name}} {{project.purpose}}", { "project.name": "Name" })).toThrowError(
      expect.objectContaining({ code: "FY_REGISTRY_INVALID" }),
    );
  });

  test("rejects an unused supplied variable", () => {
    expect(() =>
      renderStrictTemplate("{{project.name}}", {
        "project.name": "Name",
        "project.purpose": "Unused",
      }),
    ).toThrowError(expect.objectContaining({ code: "FY_REGISTRY_INVALID" }));
  });

  test("rejects unsupported template expressions left in output", () => {
    expect(() => renderStrictTemplate("{{project.name()}}", {})).toThrowError(
      expect.objectContaining({ code: "FY_REGISTRY_INVALID" }),
    );
  });

  test("escapes values for each supported textual context", () => {
    expect(escapeMarkdownInline("A_[x]<y>\\")).toBe("A\\_\\[x\\]\\<y\\>\\\\");
    expect(quoteYamlString('line\n"quoted"')).toBe('"line\\n\\"quoted\\""');
    expect(quoteTomlMultiline('line\n"quoted"\\path')).toBe('"""line\n\\"quoted\\"\\\\path"""');
    expect(escapeHtmlText('<strong title="x">A & B</strong>')).toBe(
      "&lt;strong title=&quot;x&quot;&gt;A &amp; B&lt;/strong&gt;",
    );
  });
});
