# MiniDB

MiniDB is a VS Code extension for browsing and querying MySQL, PostgreSQL, SQLite, SQL Server, and Oracle databases without leaving the editor.

## Highlights

- Save and manage multiple database connections
- Run SQL, inspect results, and review query history inside VS Code
- Browse tables, views, indexes, constraints, triggers, and table relations
- Import and export table data
- Connect through SSH tunnels when needed
- Store passwords and SSH secrets in VS Code Secret Storage
- Switch between English and Chinese UI

## Supported Databases

- MySQL
- PostgreSQL
- SQLite
- SQL Server
- Oracle

## Requirements

- VS Code `1.85.0` or later
- Node.js `20` for local development

## Quick Start For Development

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

Launch the extension in development mode:

1. Open this folder in VS Code.
2. Run `npm run compile`.
3. Press `F5` to start an Extension Development Host.

## Packaging

Create a local `.vsix` package with:

```bash
npx @vscode/vsce package
```

## Project Notes

- SQLite connections use a local file path.
- SSH tunnels bind to `127.0.0.1` on a random local port.
- Oracle support uses the `oracledb` Node driver. Depending on your platform, Oracle connections may require extra client setup.

## Security And Privacy

- Saved connection metadata is stored in VS Code global state.
- Database passwords and SSH secrets are stored in VS Code Secret Storage.
- Do not commit local VS Code storage, exported connection data, screenshots with credentials, or test databases containing sensitive data.

## Contributing

Contributions are welcome. For setup steps, coding expectations, and pull request guidance, see [CONTRIBUTING.md](./CONTRIBUTING.md).

If you are opening an issue, please use the GitHub templates so bug reports include enough detail to reproduce the problem.

## Recommended Before Publishing

- Update the repository URL in `package.json` to your real GitHub repository.
- Update the `publisher` field in `package.json` if you plan to publish to the VS Code Marketplace.
- Add screenshots or a short demo GIF for the repository and marketplace page.
- Verify the extension on the operating systems you plan to support.

## License

[MIT](./LICENSE)
