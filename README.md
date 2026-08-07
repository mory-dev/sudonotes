# sudonotes

A lightweight, local-first notebook for **prompts** and **ideas**.

LLM prompts end up scattered across chat histories, scratch files, and half-abandoned Notion pages. They get rewritten from scratch instead of refined. sudonotes keeps them in one place, links them to the ideas that motivated them, and finds them again instantly.

- **Local-first.** Your notes are plain Markdown files in a folder you choose. No account, no sync, no lock-in.
- **Lightweight.** Built with Tauri — the installer is ~20MB and it uses your system's webview instead of shipping a browser.
- **Fast search.** SQLite FTS5 over every note. `Ctrl+K` from anywhere.
- **Linked.** Wiki-style `[[links]]` with backlinks, so prompts and the ideas behind them stay connected.
- **Open source.** MIT.

Optional DeepSeek assistance can analyze prompt/model fit, suggest refinements, and add tags. It is disabled from network use until configured in the app; local tagging remains available without a key.

## Vault layout

A vault is just a directory:

```
<vault>/
  prompts/**.md
  ideas/**.md
  .sudonotes/index.db     # search index — safe to delete, rebuilds on launch
```

Each note is Markdown with a small YAML frontmatter block (`id`, `title`, `tags`, `created`, `updated`). Edit them in any editor you like; sudonotes picks up external changes automatically.

## Development

Requires [Node.js](https://nodejs.org) and [Rust](https://rustup.rs), plus the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your platform.

```bash
cd app && npm install && npm run tauri dev
```

Run the Rust tests:

```bash
cd app/src-tauri && cargo test
```

Build a release installer:

```bash
cd app && npm run tauri build
```

## Status

Early. The current milestone covers the core loop: capture, link, and search. Project-folder linking, AI-assisted prompt refinement, and vim keybindings are planned.

## License

MIT
