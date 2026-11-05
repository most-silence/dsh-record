# dsh-record

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A DeepSeek Harness (dsh) plugin that puts a microphone button in the composer with a format selector: record audio in **MP3** (default), **WAV**, or **WebM**, and attach it to your current prompt as a conversation file attachment.

[中文文档](README.zh.md)

## Features

- **Composer microphone button + format selector** — registered at the `conversation.input.right` slot, before the submit action. A dropdown lets you pick MP3 / WAV / WebM; the choice persists across page reloads via localStorage.
- **Real-time recording** — browser `MediaRecorder`, webm/opus preferred with capability-based fallback. Elapsed timer and live file-name preview while recording (`rec-YYYYMMDD-HHMMSS-<n>s.mp3`).
- **Three output formats**:
  - **MP3** (default) — decoded from the browser's native container, then encoded via lamejs (128 kbps CBR) entirely in the browser. No server-side dependencies.
  - **WAV** — lossless 16-bit PCM, decoded and re-wrapped in the browser.
  - **WebM** — the browser's native Opus container, no transcoding needed. Smallest file, fastest attach.
- **Prompt attachment** — on stop, the (optionally transcoded) file is registered through the host draft-attachment channel (`conversation.createDrafts` + `inputActions.addAttachments`) and appears as a composer file card with upload progress.
- **Graceful fallback** — if MP3/WAV transcoding fails (e.g. OfflineAudioContext unavailable), the raw WebM is attached instead so the recording is never lost.
- **Cancel discipline** — Escape, the ✕ button, or leaving the tab discards the recording; recordings under 0.5 s are dropped; a stop during an in-flight submit releases the draft cleanly.

The plugin records, optionally transcodes, and attaches. It does not write files to disk or perform speech recognition — pair it with `dsh-stt` for transcription.

## Install

```bash
git clone https://github.com/most-silence/dsh-record
cd dsh-record && npm install && npm run build
dsh plugin --profile <your-profile> add file:$PWD
```

Restart the dsh host after installing, then refresh the web page.

## Architecture

```
browser half (lib/client.js)               host half (lib/index.js)
├─ mic button + format dropdown            └─ no-op shell: a valid `main`
├─ MediaRecorder → webm/opus                  entry that registers nothing
├─ decode → lamejs (mp3) / PCM wrap (wav)
└─ attach via createDrafts + addAttachments
```

The host half is deliberately dependency-free and declares no `Config` schema. Format selection is persisted in the browser via localStorage (`dsh-record.format`). This design avoids the schemastery API mismatch that caused profile startup failures in earlier versions.

## Development

```bash
npm install
npm run build     # tsdown: lib/index.js (ESM) + lib/client.js (CJS, ModuleLoader-wrapped)
npm test          # 12 node:test cases: client factory contract (7) + encoders (5)
```

Tests run with Node 24 (native TypeScript type stripping); no browser needed.

## Known limitations

- The attachment channel relies on host client contracts verified on dsh 0.2.1-rc.2 (`conversation.input.right` slot, `createDrafts` / `addAttachments`). Upstream changes may degrade to an inline error notice.
- MP3/WAV transcoding runs after you press stop (not during capture), so very long recordings add a brief encode pause.
- Recording requires a microphone-permission grant; the page must be served over HTTPS or localhost.
- Format preference is stored in localStorage per-origin; clearing browser data resets it to MP3.

## License

[MIT](LICENSE)
