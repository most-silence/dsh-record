# dsh-record

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A DeepSeek Harness (dsh) plugin that puts a microphone button in the composer: click to record, stop to attach the audio to your prompt — and save it to disk as MP3.

一个 DeepSeek Harness (dsh) 插件：在输入框上加一个麦克风按钮，点一下录音，再点一下停止——录音自动挂进输入框作为会话附件，同时按配置落盘保存（MP3 为主）。

## Features / 功能

- **Composer microphone button** — registered at the `conversation.input.right` slot, before the submit action. No floating widgets; coexists with `dsh-talk` / `dsh-stt` (which use the left slot).
  **输入框麦克风按钮** — 注册在 `conversation.input.right` 座位（提交按钮前），不是悬浮球；与占用左侧座位的 `dsh-talk` / `dsh-stt` 互不干扰。
- **Real-time recording** — browser `MediaRecorder`, webm/opus preferred with capability-based fallback. Elapsed timer and live file-name preview while recording (`rec-YYYYMMDD-HHMMSS-<n>s.mp3`).
  **实时录音** — 浏览器 `MediaRecorder`，webm/opus 优先并按能力回退；录音中显示计时与实时文件名预览。
- **Format selection** — MP3 (default, encoded in the browser via lamejs), WAV (lossless 16-bit PCM), or WebM (native Opus, no transcode). Configured on the plugin settings page.
  **可选格式** — MP3（默认，浏览器端用 lamejs 转码）/ WAV（16-bit PCM 无损）/ WebM（浏览器原生 Opus，不转码）。在插件配置页选择。
- **Prompt attachment** — the encoded file is registered through the host draft-attachment channel (`conversation.createDrafts` + `inputActions.addAttachments`) and shows up as a composer file card with upload progress; it rides the normal upload queue with your prompt.
  **随 Prompt 发送** — 编码后的文件走宿主草稿附件通道登记并挂进输入框，显示为带上传进度的文件卡，随 Prompt 一起进入正常上传队列。
- **Disk save** — recordings are written to `<workspace root>/recordings/` (default) or any custom absolute directory; turn it off entirely from the settings page. The host half writes files through two same-origin-guarded routes (`GET /dsh-record/config`, `POST /dsh-record/save`).
  **落盘保存** — 默认写到当前项目空间根目录的 `recordings/`，也可在配置页填任意绝对路径目录，或完全关闭落盘（仅附件）。宿主半通过两条 same-origin 守卫路由完成配置下发与写盘。
- **Cancel discipline** — Escape, the ✕ button, or leaving the tab discards the recording; recordings under 0.5 s are dropped; a stop during an in-flight submit releases the draft cleanly.
  **取消纪律** — Esc / ✕ / 切走标签页即丢弃；小于 0.5 秒的录音自动丢弃；提交进行中停止会安全释放草稿，不留孤儿上传。

## Install / 安装

```bash
# from source / 从源码
git clone https://github.com/most-silence/dsh-record
cd dsh-record && npm install && npm run build
dsh plugin --profile <your-profile> add file:$PWD

# prebuilt tarball from GitHub Releases (skips the build) / 预构建包
dsh plugin --profile <your-profile> add file:dsh-record.tgz   # asset attached to the latest release
```

Restart the dsh host after installing, then refresh the web page. / 安装后重启 dsh 宿主并刷新页面。

## Configuration / 配置

The plugin settings page exposes three fields / 插件配置页提供三项：

| Field / 字段 | Values / 取值 | Meaning / 说明 |
| --- | --- | --- |
| `format` | `mp3` (default) · `wav` · `webm` | Encoded recording format. MP3 is produced in the browser by lamejs; WebM skips transcoding. / 录音格式。MP3 由浏览器端 lamejs 编码；WebM 不转码。 |
| `saveMode` | `workspace` (default) · `custom` · `off` | Where recordings are saved: the current workspace root's `recordings/` folder, a custom directory, or nowhere (attachment only). / 保存位置：项目空间 `recordings/`、自定义目录，或仅附件不落盘。 |
| `saveDir` | any absolute path / 任意绝对路径 | Used when `saveMode` is `custom`, e.g. `D:\Recordings`. / `custom` 模式的目标目录。 |

## Architecture / 架构

```
browser half (lib/client.js)                    host half (lib/index.js)
├─ mic button @ conversation.input.right        ├─ Config schema (format/saveMode/saveDir)
├─ MediaRecorder → webm/opus                    ├─ GET  /dsh-record/config  → serves Config
├─ decode → lamejs (mp3) / PCM wrap (wav)       └─ POST /dsh-record/save    → sanitizes name/dir,
├─ attach via createDrafts + addAttachments         writes the file, returns its path
└─ POST bytes to /dsh-record/save
```

The browser encodes, the host only writes files — no native dependencies, no ffmpeg required.
浏览器负责编码，宿主只写文件——无原生依赖，不需要 ffmpeg。

## Development / 开发

```bash
npm install
npm run build     # tsdown: lib/index.js (ESM) + lib/client.js (CJS, ModuleLoader-wrapped)
npm test          # 19 node:test cases: client factory contract, encoders, save routes
```

Tests run with Node 24 (native TypeScript type stripping); no browser needed.
测试用 Node 24 直接跑（原生 TS 类型剥离），无需浏览器。

## Known limitations / 已知限制

- The attachment channel relies on host client contracts verified on dsh 0.2.1-rc.2 (`conversation.input.right` slot, `createDrafts` / `addAttachments`). Upstream changes may degrade to an inline error notice.
  附件通道依赖在 dsh 0.2.1-rc.2 实测的宿主契约；上游变更时会退化为行内错误提示，不影响页面其余部分。
- MP3 encoding runs after you press stop (not during capture), so very long recordings add a brief encode pause.
  MP3 编码发生在停止之后，超长录音会有一小段编码耗时。
- The workspace save location follows the session's current workspace; switching workspaces changes where `recordings/` lands.
  workspace 模式跟随会话当前项目空间；切换空间后 `recordings/` 位置随之变化。

## License / 许可

[MIT](LICENSE)
