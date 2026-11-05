# dsh-record

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个 DeepSeek Harness (dsh) 插件：在输入框上加一个麦克风按钮和格式选择器，支持 **MP3**（默认）、**WAV**、**WebM** 三种格式录音，停止后自动作为会话附件挂进当前 Prompt。

[English](README.md)

## 功能

- **输入框麦克风按钮 + 格式选择器** — 注册在 `conversation.input.right` 座位（提交按钮前）。下拉菜单可选 MP3 / WAV / WebM，选择通过 localStorage 持久化，刷新页面后保持。
- **实时录音** — 浏览器 `MediaRecorder`，webm/opus 优先并按能力回退；录音中显示计时与实时文件名预览（`rec-YYYYMMDD-HHMMSS-<n>s.mp3`）。
- **三种输出格式**：
  - **MP3**（默认）— 从浏览器原生容器解码后，由 lamejs（128 kbps CBR）在浏览器端编码。无需服务端依赖。
  - **WAV** — 无损 16-bit PCM，在浏览器端解码并重新封装。
  - **WebM** — 浏览器原生 Opus 容器，不转码。文件最小、附加最快。
- **随 Prompt 发送** — 停止后，（可选转码后的）文件经宿主草稿附件通道（`conversation.createDrafts` + `inputActions.addAttachments`）登记，在输入框里显示为带上传进度的文件卡。
- **优雅降级** — 如果 MP3/WAV 转码失败（如 OfflineAudioContext 不可用），自动附加原始 WebM，录音不会丢失。
- **取消纪律** — Esc / ✕ / 切走标签页即丢弃录音；小于 0.5 秒的录音自动丢弃；提交进行中停止会安全释放草稿，不留孤儿上传。

本插件只负责录音、可选转码与附加，不写磁盘文件、不做语音识别——搭配 `dsh-stt` 之类的语音转写插件使用。

## 安装

```bash
git clone https://github.com/most-silence/dsh-record
cd dsh-record && npm install && npm run build
dsh plugin --profile <你的profile> add file:$PWD
```

安装后重启 dsh 宿主并刷新页面。

## 架构

```
浏览器半 (lib/client.js)                    宿主半 (lib/index.js)
├─ 麦克风按钮 + 格式下拉菜单                  └─ 空壳：只提供一个合法的 `main`
├─ MediaRecorder → webm/opus                     入口，不注册任何东西
├─ 解码 → lamejs (mp3) / PCM 封装 (wav)
└─ createDrafts + addAttachments 挂附件
```

宿主半刻意保持零依赖、不声明 `Config` schema。格式选择通过浏览器 localStorage（`dsh-record.format`）持久化。此设计彻底规避了早期版本因 schemastery API 不匹配导致 profile 启动失败的问题。

## 开发

```bash
npm install
npm run build     # tsdown：lib/index.js (ESM) + lib/client.js (CJS，ModuleLoader 包装)
npm test          # 12 个 node:test 用例：客户端工厂契约 (7) + 编码器 (5)
```

测试用 Node 24 直接跑（原生 TS 类型剥离），无需浏览器。

## 已知限制

- 附件通道依赖在 dsh 0.2.1-rc.2 实测的宿主契约（`conversation.input.right` 座位、`createDrafts` / `addAttachments`）；上游变更时会退化为行内错误提示。
- MP3/WAV 转码发生在停止之后（非录制中），超长录音会有一小段编码耗时。
- 录音需要授予麦克风权限；页面需通过 HTTPS 或 localhost 提供。
- 格式偏好存储在 localStorage（按 origin 隔离）；清除浏览器数据会重置为 MP3。

## 许可

[MIT](LICENSE)
