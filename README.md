# sudonotes

A lightweight, local-first notebook for **prompts** and **ideas**.

LLM prompts end up scattered across chat histories, scratch files, and half-abandoned Notion pages. They get rewritten from scratch instead of refined. sudonotes keeps them in one place, links them to the ideas that motivated them, and finds them again instantly.

- **Local-first.** Your notes are plain Markdown files in a folder you choose. No account, no sync, no lock-in.
- **Lightweight.** Built with Tauri — the installer is ~20MB and it uses your system's webview instead of shipping a browser.
- **Fast search.** SQLite FTS5 over every note. `Ctrl+K` from anywhere.
- **Linked.** Wiki-style `[[links]]` with backlinks, so prompts and the ideas behind them stay connected.
- **Open source.** MIT.

AI assistance can analyze prompt/model fit, suggest refinements, and add tags. It is on by default and needs no API key of your own — requests go through the sudonotes API, which holds the provider key. Enabling it sends the note's content to that service; turn it off in the app and tagging falls back to a local keyword pass. Note bodies are never logged.

## Vault layout

A vault is just a directory:

```
<vault>/
  prompts/**.md
  ideas/**.md
  .sudonotes/index.db        # search index — a cache, rebuilt on launch
  .sudonotes/settings.json   # whether AI is on for this vault
```

Deleting `.sudonotes/` costs you nothing but the index and that one preference,
which returns to its default of on. Your notes are the `.md` files; nothing else
in the vault is load-bearing. No credentials are ever written there.

Each note is Markdown with a small YAML frontmatter block (`id`, `title`, `tags`, `created`, `updated`). Edit them in any editor you like; sudonotes picks up external changes automatically.

## Repository

| Directory | What it is |
| --- | --- |
| `core/` | `sudonotes-core` — the note format: frontmatter, filenames, links, paste splitting. Pure Rust, no filesystem, and it compiles to WebAssembly so a browser build can share it. |
| `app/` | The desktop app. React front end in `src/`, Tauri and the filesystem in `src-tauri/`. |
| `worker/` | The Cloudflare Worker behind `sudonotes.com/api/*`, which holds the AI provider key. |
| `site/` | sudonotes.com — Astro, static. |

The split between `core/` and `app/src-tauri/` is deliberate and worth
preserving: a vault is a folder that more than one program will eventually write
into, and anything defining how a note is stored belongs in `core/` so those
programs cannot disagree.

## Development

Requires [Node.js](https://nodejs.org) and [Rust](https://rustup.rs), plus the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your platform.

```bash
cd app && npm install && npm run tauri dev
```

Run the Rust tests:

```bash
cargo test --manifest-path core/Cargo.toml && cargo test --manifest-path app/src-tauri/Cargo.toml
```

Check that the core still builds for the browser:

```bash
cargo check --manifest-path core/Cargo.toml --target wasm32-unknown-unknown
```

Build a release installer:

```bash
cd app && npm run tauri build
```

## Status

Early. The core loop — capture, link, search — is in place, along with project-folder linking, collection splitting, and per-note model assignment. A browser build that connects to the same vault, and vim keybindings, are planned.

## License

MIT
