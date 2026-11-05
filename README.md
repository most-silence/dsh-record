# dsh-record

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A DeepSeek Harness (dsh) plugin that puts a microphone button in the composer: click to record, stop to attach the audio to your prompt — and save it to disk as MP3.

[中文文档](README.zh.md)

## Features

- **Composer microphone button** — registered at the `conversation.input.right` slot, before the submit action. No floating widgets; coexists with `dsh-talk` / `dsh-stt` (which use the left slot).
- **Real-time recording** — browser `MediaRecorder`, webm/opus preferred with capability-based fallback. Elapsed timer and live file-name preview while recording (`rec-YYYYMMDD-HHMMSS-<n>s.mp3`).
- **Format selection** — MP3 (default, encoded in the browser via lamejs), WAV (lossless 16-bit PCM), or WebM (native Opus, no transcode). Configured on the plugin settings page.
- **Prompt attachment** — the encoded file is registered through the host draft-attachment channel (`conversation.createDrafts` + `inputActions.addAttachments`) and shows up as a composer file card with upload progress; it rides the normal upload queue with your prompt.
- **Disk save** — recordings are written to `<workspace root>/recordings/` (default) or any custom absolute directory; turn it off entirely from the settings page. The host half writes files through two same-origin-guarded routes (`GET /dsh-record/config`, `POST /dsh-record/save`).
- **Cancel discipline** — Escape, the ✕ button, or leaving the tab discards the recording; recordings under 0.5 s are dropped; a stop during an in-flight submit releases the draft cleanly.

## Install

```bash
# from source
git clone https://github.com/most-silence/dsh-record
cd dsh-record && npm install && npm run build
dsh plugin --profile <your-profile> add file:$PWD

# prebuilt tarball from GitHub Releases (skips the build)
dsh plugin --profile <your-profile> add file:dsh-record.tgz   # asset attached to the latest release
```

Restart the dsh host after installing, then refresh the web page.

## Configuration

The plugin settings page exposes three fields:

| Field | Values | Meaning |
| --- | --- | --- |
| `format` | `mp3` (default) · `wav` · `webm` | Encoded recording format. MP3 is produced in the browser by lamejs; WebM skips transcoding. |
| `saveMode` | `workspace` (default) · `custom` · `off` | Where recordings are saved: the current workspace root's `recordings/` folder, a custom directory, or nowhere (attachment only). |
| `saveDir` | any absolute path | Used when `saveMode` is `custom`, e.g. `D:\Recordings` or `/home/me/Recordings`. |

## Architecture

```
browser half (lib/client.js)                    host half (lib/index.js)
├─ mic button @ conversation.input.right        ├─ Config schema (format/saveMode/saveDir)
├─ MediaRecorder → webm/opus                    ├─ GET  /dsh-record/config  → serves Config
├─ decode → lamejs (mp3) / PCM wrap (wav)       └─ POST /dsh-record/save    → sanitizes name/dir,
├─ attach via createDrafts + addAttachments         writes the file, returns its path
└─ POST bytes to /dsh-record/save
```

The browser encodes, the host only writes files — no native dependencies, no ffmpeg required.

## Development

```bash
npm install
npm run build     # tsdown: lib/index.js (ESM) + lib/client.js (CJS, ModuleLoader-wrapped)
npm test          # 19 node:test cases: client factory contract, encoders, save routes
```

Tests run with Node 24 (native TypeScript type stripping); no browser needed.

## Known limitations

- The attachment channel relies on host client contracts verified on dsh 0.2.1-rc.2 (`conversation.input.right` slot, `createDrafts` / `addAttachments`). Upstream changes may degrade to an inline error notice.
- MP3 encoding runs after you press stop (not during capture), so very long recordings add a brief encode pause.
- The workspace save location follows the session's current workspace; switching workspaces changes where `recordings/` lands.
- Recording requires a microphone-permission grant; the page must be served over HTTPS or localhost.

## License

[MIT](LICENSE)
