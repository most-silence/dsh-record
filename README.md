# dsh-record

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A DeepSeek Harness (dsh) plugin that puts a microphone button in the composer: click to record, click again to stop, and the recording is attached to your current prompt as a conversation file attachment. The output format — **MP3** (default), **WAV**, or **WebM** — is chosen on the plugin's settings page.

[Chinese](README.zh.md)

## Features

- **Composer microphone button** — registered at the `conversation.input.right` slot, before the submit action. No floating widgets; coexists with other composer controls.
- **Format chosen on the settings page** — the plugin declares a Loader `Config` with a single `format` field (`mp3` / `wav` / `webm`, default `mp3`). Pick it in Settings → Plugins → dsh-record; the browser half reads the saved choice over `GET /dsh-record/config` at startup (falling back to `mp3` if the route is unreachable).
- **Language-aware tooltip** — hovering the mic shows **录音** on a Chinese interface and **Record** on an English one. The button registers `zh`/`en` dictionaries with the host locale service, so the tooltip, aria-label and status notices follow the interface language and update when you switch it.
- **Real-time recording** — browser `MediaRecorder`, webm/opus preferred with capability-based fallback. An elapsed timer and a live file-name preview (`rec-YYYYMMDD-HHMMSS-<n>s.mp3`) show while recording.
- **Three output formats** (transcoded in the browser after you press stop):
  - **MP3** — decoded from the native container and encoded via lamejs (128 kbps CBR). No server-side dependency.
  - **WAV** — lossless 16-bit PCM, decoded and re-wrapped.
  - **WebM** — the browser's native Opus container, no transcoding; smallest file, fastest attach.
- **Prompt attachment** — the file is registered through the host draft-attachment channel (`conversation.createDrafts` + `inputActions.addAttachments`) and shows as a composer file card with upload progress, riding the normal upload queue with your prompt.
- **Graceful fallback** — if MP3/WAV transcoding fails (e.g. `OfflineAudioContext` unavailable), the raw WebM is attached instead, so a recording is never lost.
- **Cancel discipline** — Escape, the ✕ button, or leaving the tab discards the recording; recordings under 0.5 s are dropped; a stop during an in-flight submit releases the draft cleanly.

The plugin records, optionally transcodes, and attaches the file to your prompt. It also writes recordings to the configured directory when a save folder is set. It performs no speech recognition — pair it with a speech-to-text plugin such as `dsh-stt`.

## Install

### From the marketplace (recommended)

Install it from the plugin marketplace. The listing points at the prebuilt tarball attached to the latest release, so nothing is compiled on your machine and no build toolchain is needed.

### From source

> **The `lib/` build output is not committed to this repository** (it is gitignored). A fresh clone therefore has no `main` entry, and `dsh plugin add file:<clone>` fails with a missing `lib/index.js`. **Build before installing:**

```bash
git clone https://github.com/most-silence/dsh-record
cd dsh-record
npm install
npm run build          # required: produces lib/index.js + lib/client.js
dsh plugin --profile <your-profile> add file:$PWD
```

Prefer to skip the build? Download `dsh-record.tgz` from the [latest release](https://github.com/most-silence/dsh-record/releases/latest) and install that instead — it already contains `lib/`:

```bash
dsh plugin --profile <your-profile> add file:dsh-record.tgz
```

Restart the dsh host after installing, then refresh the web page.

## Configuration

Settings → Plugins → **dsh-record** (open the plugin's own detail page) exposes:

| Field | Values | Meaning |
| --- | --- | --- |
| `format` | `mp3` (default) · `wav` · `webm` | Output container. MP3 and WAV are transcoded in the browser when you stop; WebM is attached as captured. Takes effect on the next page load. |
| `dirMode` | `workspace` (default) · `custom` | Where recordings are written: the current workspace root, or a fixed folder. |
| `customDir` | absolute path | The folder used when `dirMode` is `custom`. Recordings are written here through a same-origin-guarded host route (file name sanitized, `..` traversal rejected, 64 MB cap). |

Changing `format` or the directory takes effect on the next page load, since the browser half reads the configuration once at startup.

## Architecture

```
browser half (lib/client.js)                    host half (lib/index.js)
├─ mic button @ conversation.input.right        ├─ Config schema (volatile)
├─ settings card @ plugins.bundle.config        │    { format, dirMode, customDir }
├─ zh/en dictionaries → locale service          ├─ GET  /dsh-record/config → serves config
├─ MediaRecorder → webm/opus                    └─ POST /dsh-record/save   → writes the file
├─ decode → lamejs (mp3) / PCM wrap (wav)
└─ attach via createDrafts + addAttachments
```

Three hardening rules keep the plugin from ever blocking profile startup — all learned from real crashes:

1. **`@breezystack/lamejs` is bundled inline.** The DSH module table is frozen and does not contain lamejs, so leaving it as a build-time external makes `require("@breezystack/lamejs")` miss the table and abort the whole web boot. `tsdown` forces it inline (`noExternal`).
2. **The host `Config` schema uses `z.union([...])`, never `z.enum([...])`, and schemastery stays `external`.** The host's schemastery version has no `enum` method, and a schema built from a bundled private copy is incompatible with the host validator — either one throws during import and fails the `dsh-record` row as `required`, taking down the profile.
3. **The schema is marked `.volatile()`.** The host's settings projection only surfaces volatile fields; a plain schema renders no form at all, which is why an earlier configuration page appeared empty.

## Development

```bash
npm install
npm run build     # tsdown: lib/index.js (ESM) + lib/client.js (CJS, ModuleLoader-wrapped)
npm test          # 21 node:test cases: factory (9) + encoders (5) + settings (7)
```

Tests run with Node 24 (native TypeScript type stripping); no browser needed.

## Known limitations

- The attachment channel relies on host client contracts verified on dsh 0.2.1-rc.2 (`conversation.input.right` slot, `createDrafts` / `addAttachments`). Upstream changes may degrade to an inline error notice.
- MP3/WAV transcoding runs after you press stop (not during capture), so very long recordings add a brief encode pause.
- Recording requires a microphone-permission grant; the page must be served over HTTPS or localhost.
- The output format and directory live in the host profile config, not the browser — they are read once per page load, so a change applies after a refresh.
- The custom directory is typed by hand; an in-app folder-picker button is planned for the next minor version.

## License

[MIT](LICENSE)
