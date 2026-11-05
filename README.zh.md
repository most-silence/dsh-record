# dsh-record

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个 DeepSeek Harness (dsh) 插件：在输入框上加一个麦克风按钮，点一下开始录音，再点一下停止——录音自动作为会话附件挂进当前 Prompt。

[English](README.md)

## 功能

- **输入框麦克风按钮** — 注册在 `conversation.input.right` 座位（提交按钮前），不是悬浮球；与占用左侧座位的 `dsh-talk` / `dsh-stt` 互不干扰。
- **实时录音** — 浏览器 `MediaRecorder`，webm/opus 优先并按能力回退；录音中显示计时与实时文件名预览（`rec-YYYYMMDD-HHMMSS-<n>s.webm`）。
- **随 Prompt 发送** — 停止后，录音经宿主草稿附件通道（`conversation.createDrafts` + `inputActions.addAttachments`）登记，在输入框里显示为带上传进度的文件卡，随后随 Prompt 进入正常上传队列。
- **取消纪律** — Esc / ✕ / 切走标签页即丢弃录音；小于 0.5 秒的录音自动丢弃；提交进行中停止会安全释放草稿，不留孤儿上传。

本插件只负责录音与附加，不做语音识别、不做转码、不写磁盘文件——把附件交给模型，或搭配 `dsh-stt` 之类的语音转写插件使用。

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
├─ 麦克风按钮 @ conversation.input.right     └─ 空壳：只提供一个合法的 `main`
├─ MediaRecorder → webm/opus                    入口，不注册任何东西
└─ createDrafts + addAttachments 挂附件
```

宿主半刻意保持零依赖、不声明 `Config` schema：早期加过 MP3/落盘的那一版引入了 schemastery schema，其 API 不匹配导致整个 profile 启动失败。把宿主半保持为空，插件就永远不可能阻塞启动。

## 开发

```bash
npm install
npm run build     # tsdown：lib/index.js (ESM) + lib/client.js (CJS，ModuleLoader 包装)
npm test          # 7 个 node:test 用例：客户端工厂契约 + 附件流程
```

测试用 Node 24 直接跑（原生 TS 类型剥离），无需浏览器。

## 已知限制

- 附件通道依赖在 dsh 0.2.1-rc.2 实测的宿主契约（`conversation.input.right` 座位、`createDrafts` / `addAttachments`）；上游变更时会退化为行内错误提示。
- 录音需要授予麦克风权限；页面需通过 HTTPS 或 localhost 提供。
- 音频以浏览器原生容器（通常是 WebM/Opus）附加；本版本不做 MP3 或 WAV 转码。

## 许可

[MIT](LICENSE)