# Contributing To MiniDB

Thanks for helping improve MiniDB.

## Before You Start

- Check existing issues and pull requests before starting similar work.
- Keep changes focused. Small, reviewable pull requests are easier to merge.
- Never commit real database credentials, SSH keys, exported connection data, or private datasets.

## Local Setup

Requirements:

- VS Code `1.85.0` or later
- Node.js `20`

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run compile
```

Run lint and tests:

```bash
npm run lint
npm test
```

Run the extension locally:

1. Open the repository in VS Code.
2. Run `npm run compile`.
3. Press `F5` to launch an Extension Development Host.

## Project Conventions

- Put source code in `src/`.
- Keep tests in `tests/`.
- Prefer focused fixes over broad refactors unless the refactor is required.
- Keep user-facing behavior consistent across supported databases when practical.
- When adding or changing user-visible text, update localization files where needed.
  For command and package metadata text, check `package.nls.json` and `package.nls.zh.json`.
  For in-extension localized strings, check `src/i18n/index.ts`.

## Pull Requests

Please include:

- A short summary of what changed and why
- Testing notes
- Screenshots or short recordings for UI changes when useful
- Any database-specific limitations or follow-up work

Before opening a pull request, make sure:

- `npm run lint` passes
- `npm test` passes
- New behavior is covered by tests when practical
- No generated packages, logs, or temporary files are included by accident

## Bug Reports

The best bug reports include:

- Database type and version
- Operating system
- VS Code version
- Extension version or commit
- Clear reproduction steps
- Expected behavior
- Actual behavior
- Error messages, logs, and screenshots when available

## Feature Requests

Feature requests are most useful when they explain:

- The workflow problem being solved
- Why current behavior is insufficient
- A proposed solution or UX direction
- Any database-specific constraints

## Security

If you discover a security issue, please avoid posting sensitive details publicly in an issue. Contact the repository maintainer privately first if possible.
