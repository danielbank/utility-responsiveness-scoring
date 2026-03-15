# AGENTS.md

## Cursor Cloud specific instructions

This is the **Pi coding agent** (`@mariozechner/pi-coding-agent`) — a terminal-based AI coding CLI. It is a single TypeScript package (not a monorepo at this level; sibling packages like `pi-ai`, `pi-agent-core`, `pi-tui` are consumed as npm dependencies).

### Quick reference

| Action | Command |
|--------|---------|
| Install deps | `npm install` |
| Build | `npm run build` |
| Dev (watch) | `npm run dev` |
| Run all tests | `npm test` |
| Run specific test | `npm test -- test/specific.test.ts` |
| Run CLI | `node dist/cli.js [args]` (build first) |
| CLI version | `node dist/cli.js --version` |
| CLI help | `node dist/cli.js --help` |

### Running the CLI

- The CLI requires a build step before running: `npm run build` then `node dist/cli.js`.
- Use `npm run dev` for watch mode during development (rebuilds on change).
- In non-TTY environments (like cloud agents), the CLI reads piped stdin. Always redirect stdin from `/dev/null` when running in print mode: `node dist/cli.js -p "prompt" < /dev/null`.
- The `--no-session` flag avoids writing session files to disk (useful for ephemeral testing).
- End-to-end usage requires an LLM API key (e.g. `ANTHROPIC_API_KEY`). Without one, unit tests still run but the CLI cannot generate responses.

### Testing notes

- Tests use Vitest. Most tests are unit/integration tests that do **not** require API keys.
- Some extension-related tests (`extensions-discovery`, `extensions-runner`, `extensions-input-event`, `resource-loader`) may have pre-existing failures unrelated to environment setup.
- The `docs/development.md` file references a `test.sh` script for running non-LLM tests, but this script is not present in this repository (it exists in the upstream monorepo).

### No lint config

There is no ESLint or other linter configured in this repository. TypeScript compilation (`npm run build`) serves as the primary static check.
