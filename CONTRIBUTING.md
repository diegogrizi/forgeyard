# Contributing to Forgeyard

Forgeyard accepts focused changes that preserve deterministic installation, explicit ownership, local evidence, and honest capability claims.

## Development setup

Use Node.js 24.19 and the lockfile:

```sh
npm ci
npm run verify
```

Write a failing test before changing behavior. Keep domain functions independent of Commander and process globals. Add adversarial tests for filesystem, ownership, parsing, command-execution, or recovery boundaries. A change is not complete because a generated file looks plausible; the relevant structural, integration, and round-trip checks must pass.

## Packs and provenance

- Contribute original material or material whose license permits the intended redistribution and modification.
- Mark original pack bodies as `original`. For every other provenance mode, add one complete source record and the required `sourceId` before adding the content.
- Pin direct package versions exactly and update `sources/catalog.yaml` with the matching project URL, version, SPDX license, retrieval date, and usage note.
- Run `npm run provenance:generate`, inspect both generated artifacts, and commit them with the dependency or pack change.
- Do not translate, lightly rewrite, or rebrand unlicensed material.

## Generated artifacts and presentation changes

Update the canonical pack source first. Regenerate or deliberately update golden fixtures, then review the exact bytes and run the presentation content audit. Presentation contributions must remain offline and accessible and must not contain event-specific logos, organizer names, team identities, tracking, remote fonts, or unlicensed media.

## Pull-request checklist

- The change has a narrow, user-visible purpose.
- New behavior has a test that failed before the implementation.
- `npm run verify` passes from the lockfile installation.
- Managed and seed ownership semantics remain explicit.
- Generated examples contain no fake metrics or unsupported success claims.
- New external material has compatible license and provenance records.
- Documentation and `CHANGELOG.md` describe only implemented behavior.

Security reports do not belong in public issues. Follow [SECURITY.md](SECURITY.md).
