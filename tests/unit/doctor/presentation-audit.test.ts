import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { auditPresentationBundle } from "../../../src/doctor/presentation-audit.js";

const temporaryRoots: string[] = [];

const validHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signal Garden presentation</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header><span>Signal Garden</span></header>
  <main id="deck">
    <section id="opening" data-slide><h1>Signal Garden</h1></section>
    <section id="problem" data-slide><h2>Problem</h2></section>
    <section id="audience" data-slide><h2>Audience</h2></section>
    <section id="insight" data-slide><h2>Insight</h2></section>
    <section id="solution" data-slide><h2>Solution</h2></section>
    <section id="demo" data-slide><h2>Demo</h2></section>
    <section id="evidence" data-slide><h2>Evidence</h2></section>
    <section id="architecture" data-slide><h2>Architecture</h2></section>
    <section id="value" data-slide><h2>Value</h2></section>
    <section id="ask" data-slide><h2>Ask</h2></section>
  </main>
  <nav aria-label="Slide navigation">
    <button id="previous-slide" type="button">Previous</button>
    <p id="slide-status" aria-live="polite">01 / 10</p>
    <button id="next-slide" type="button">Next</button>
  </nav>
  <script src="app.js"></script>
</body>
</html>
`;

const validCss = `
:root { color-scheme: dark; }
body { margin: 0; font-family: system-ui, sans-serif; }
h1 { font-size: clamp(2rem, 8vw, 7rem); }
[data-slide] { min-height: 100vh; }
button:focus-visible { outline: 3px solid currentColor; outline-offset: 4px; }
@media (max-width: 42rem) { h1 { font-size: 12vw; } }
@media (max-height: 32rem) and (orientation: landscape) { [data-slide] { min-height: auto; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
@media print { [data-slide] { break-after: page; } nav { display: none; } }
`;

const validJs = `
(() => {
  const previous = document.querySelector("#previous-slide");
  const next = document.querySelector("#next-slide");
  const status = document.querySelector("#slide-status");
  const show = (index) => { location.hash = String(index); status.textContent = String(index); };
  previous.addEventListener("click", () => show(0));
  next.addEventListener("click", () => show(1));
  addEventListener("hashchange", () => show(Number(location.hash.slice(1))));
  addEventListener("keydown", (event) => {
    if (["ArrowRight", "PageDown", "End"].includes(event.key)) show(1);
    if (["ArrowLeft", "PageUp", "Home"].includes(event.key)) show(0);
  });
})();
`;

async function bundle(files: Partial<Record<"index.html" | "styles.css" | "app.js", string>> = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-presentation-audit-"));
  temporaryRoots.push(root);
  const directory = path.join(root, "presentation");
  await mkdir(directory, { recursive: true });
  const sources = { "index.html": validHtml, "styles.css": validCss, "app.js": validJs, ...files };
  await Promise.all(
    Object.entries(sources).map(([name, source]) => writeFile(path.join(directory, name), source, "utf8")),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("presentation bundle audit", () => {
  test("accepts a complete offline, semantic, keyboard and pointer-operable bundle", async () => {
    const root = await bundle();

    await expect(auditPresentationBundle({ root, directory: "presentation" })).resolves.toEqual([]);
  });

  test("reports document, slide, control, script, and responsive-style contract failures", async () => {
    const root = await bundle({
      "index.html": validHtml
        .replace('<meta charset="utf-8">', "")
        .replace('<meta name="viewport" content="width=device-width, initial-scale=1">', "")
        .replace('<section id="problem" data-slide><h2>Problem</h2></section>', '<section id="opening" data-slide><h2>Problem</h2></section>')
        .replace('<button id="previous-slide" type="button">Previous</button>', "")
        .replace('<p id="slide-status" aria-live="polite">01 / 10</p>', '<p id="slide-status">01 / 10</p>'),
      "styles.css": "body { margin: 0; }\n",
      "app.js": 'document.querySelector("#next-slide");\n',
    });

    const findings = await auditPresentationBundle({ root, directory: "presentation" });

    expect(findings).toEqual(expect.arrayContaining([
      { ruleId: "presentation.document-structure", path: "presentation/index.html" },
      { ruleId: "presentation.slide-structure", path: "presentation/index.html" },
      { ruleId: "presentation.control-structure", path: "presentation/index.html" },
      { ruleId: "presentation.script-behavior", path: "presentation/app.js" },
      { ruleId: "presentation.style-behavior", path: "presentation/styles.css" },
    ]));
  });
});
