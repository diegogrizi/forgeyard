import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Original, deliberately small test data. This is an HTTP boundary fixture, not a
// snapshot of the third-party catalog: acquisition, caching and rendering stay real.
const reference = JSON.parse(readFileSync(new URL("../../packs/ecosystem/source.json", import.meta.url), "utf8"));
const files = new Map([
  ["LICENSE", [
    "MIT License",
    "",
    "Copyright (c) 2026 Forgeyard test fixture authors",
    "",
    "Permission is hereby granted, free of charge, to any person obtaining a copy",
    'of this software and associated documentation files (the "Software"), to deal',
    "in the Software without restriction, including without limitation the rights",
    "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
    "copies of the Software, and to permit persons to whom the Software is",
    "furnished to do so, subject to the following conditions:",
    "",
    "The above copyright notice and this permission notice shall be included in all",
    "copies or substantial portions of the Software.",
    "",
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
    "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
    "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
    "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
    "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
    "SOFTWARE.",
    "",
  ].join("\n")],
]);

for (const plugin of [...reference.plugins].sort()) {
  const root = `plugins/${plugin}`;
  files.set(`${root}/.claude-plugin/plugin.json`, `${JSON.stringify({
    name: plugin,
    version: "1.0.0",
    description: `Controlled ${plugin} fixture for offline tests.`,
    license: "MIT",
  })}\n`);
  files.set(`${root}/agents/reviewer.md`, [
    "---",
    "name: reviewer",
    `description: Review the ${plugin} fixture without modifying the project.`,
    "model: inherit",
    "tools: Read, Glob, Grep",
    "---",
    "",
    `# ${plugin} reviewer`,
    "",
    "Inspect the supplied project files and report one finding with a source path.",
    "",
  ].join("\n"));
  files.set(`${root}/skills/practice/SKILL.md`, [
    "---",
    "name: practice",
    `description: Apply the controlled ${plugin} practice to an explicit project requirement.`,
    "---",
    "",
    `# ${plugin} practice`,
    "",
    "Read [the checklist](references/checklist.md), inspect the requirement, and record the observed result.",
    "",
  ].join("\n"));
  files.set(`${root}/skills/practice/references/checklist.md`, [
    `# ${plugin} checklist`,
    "",
    "1. Identify the relevant project requirement.",
    "2. Run the smallest applicable check.",
    "3. Record the result and the evidence path.",
    "",
  ].join("\n"));
  files.set(`${root}/commands/check.md`, [
    "---",
    "name: check",
    `description: Inspect the ${plugin} requirement supplied by the user.`,
    'argument-hint: "[requirement]"',
    "---",
    "",
    "Identify the requested check from $ARGUMENTS, inspect its inputs, and report the observed result.",
    "",
  ].join("\n"));
}

// Content-derived and outside the upstream history: stale fixture caches cannot
// survive a change to these bytes, and real catalog caches cannot satisfy tests.
const revision = createHash("sha256").update("forgeyard-original-catalog-fixture-v1\n")
  .update(JSON.stringify([...files])).digest("hex").slice(0, 40);
const apiRoot = "https://api.github.com/repos/wshobson/agents";
const rawRoot = `https://raw.githubusercontent.com/wshobson/agents/${revision}/`;

globalThis.fetch = async function offlineCatalogFetch(input, options = {}) {
  const url = input instanceof Request ? input.url : String(input);
  const method = options.method ?? (input instanceof Request ? input.method : "GET");
  if (method !== "GET") throw new Error(`Offline catalog fixture rejects ${method} ${url}`);
  if (url === `${apiRoot}/commits/HEAD`) return Response.json({ sha: revision });
  if (url === `${apiRoot}/git/trees/${revision}?recursive=1`) {
    return Response.json({
      truncated: false,
      tree: [...files].map(([filePath, content]) => ({
        path: filePath, type: "blob", mode: "100644", size: Buffer.byteLength(content),
      })),
    });
  }
  if (url.startsWith(rawRoot)) {
    const filePath = url.slice(rawRoot.length).split("/").map(decodeURIComponent).join("/");
    if (files.has(filePath)) return new Response(files.get(filePath));
  }
  throw new Error(`Unexpected network request in offline tests: ${url}`);
};
