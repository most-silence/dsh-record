# dsh-record

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A DeepSeek Harness (dsh) plugin that puts a microphone button in the composer: click to record, click again to stop, and the recording is attached to your current prompt as a conversation file attachment.

[中文文档](README.zh.md)

## Features

- **Composer microphone button** — registered at the `conversation.input.right` slot, before the submit action. No floating widgets; coexists with `dsh-talk` / `dsh-stt` (which use the left slot).
- **Real-time recording** — browser `MediaRecorder`, webm/opus preferred with capability-based fallback. Elapsed timer and live file-name preview while recording (`rec-YYYYMMDD-HHMMSS-<n>s.webm`).
- **Prompt attachment** — on stop, the recording is registered through the host draft-attachment channel (`conversation.createDrafts` + `inputActions.addAttachments`) and appears as a composer file card with upload progress. It then rides the normal upload queue with your prompt.
- **Cancel discipline** — Escape, the ✕ button, or leaving the tab discards the recording; recordings under 0.5 s are dropped; a stop during an in-flight submit releases the draft cleanly.

The plugin records and attaches. It does not transcribe, transcode, or write files to disk — send the attachment to your model, or pair it with a speech-to-text plugin such as `dsh-stt`.

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
├─ mic button @ conversation.input.right   └─ no-op shell: a valid `main`
├─ MediaRecorder → webm/opus                  entry that registers nothing
└─ attach via createDrafts + addAttachments
```

The host half is deliberately dependency-free and declares no `Config` schema: an earlier mp3/disk-save iteration added a schemastery schema whose API mismatch aborted the whole profile at startup. Keeping the node half empty means the plugin can never block boot.

## Development

```bash
npm install
npm run build     # tsdown: lib/index.js (ESM) + lib/client.js (CJS, ModuleLoader-wrapped)
npm test          # 7 node:test cases: client factory contract + attachment flow
```

Tests run with Node 24 (native TypeScript type stripping); no browser needed.

## Known limitations

- The attachment channel relies on host client contracts verified on dsh 0.2.1-rc.2 (`conversation.input.right` slot, `createDrafts` / `addAttachments`). Upstream changes may degrade to an inline error notice.
- Recording requires a microphone-permission grant; the page must be served over HTTPS or localhost.
- Audio is attached in the browser's native container (usually WebM/Opus). Transcoding to MP3 or WAV is not part of this version.

## License

[MIT](LICENSE)