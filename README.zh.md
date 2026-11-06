# dsh-record

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个 DeepSeek Harness (dsh) 插件：在输入框上加一个麦克风按钮，点一下开始录音，再点一下停止——录音自动作为会话附件挂进当前 Prompt。输出格式 **MP3**（默认）、**WAV**、**WebM** 在插件设置页选择。

[English](README.md)

## 功能

- **输入框麦克风按钮** — 注册在 `conversation.input.right` 座位（提交按钮前）。不悬浮、不遮挡，与输入框其他控件共存。
- **格式在设置页选择** — 插件声明了一个 Loader `Config`，只有 `format` 一个字段（`mp3` / `wav` / `webm`，默认 `mp3`）。在「设置 → 插件 → dsh-record」里挑选；浏览器半在启动时通过 `GET /dsh-record/config` 读取已保存的选择（路由不可达时回退 `mp3`）。
- **跟随界面语言的悬停提示** — 鼠标移到麦克风上，中文界面显示 **录音**，英文界面显示 **Record**。按钮向宿主 locale 服务注册 `zh`/`en` 词典，悬停提示、aria-label 和状态提示都会跟随界面语言，切换语言后即时更新。
- **实时录音** — 浏览器 `MediaRecorder`，webm/opus 优先并按能力回退；录音中显示计时与实时文件名预览（`rec-YYYYMMDD-HHMMSS-<n>s.mp3`）。
- **三种输出格式**（停止后在浏览器端转码）：
  - **MP3** — 从原生容器解码后由 lamejs 编码（128 kbps CBR）。无需服务端依赖。
  - **WAV** — 无损 16-bit PCM，解码并重新封装。
  - **WebM** — 浏览器原生 Opus 容器，不转码；文件最小、附加最快。
- **随 Prompt 发送** — 文件经宿主草稿附件通道（`conversation.createDrafts` + `inputActions.addAttachments`）登记，在输入框里显示为带上传进度的文件卡，与你的 Prompt 一起走正常上传队列。
- **优雅降级** — 如果 MP3/WAV 转码失败（如 `OfflineAudioContext` 不可用），自动附加原始 WebM，录音不会丢失。
- **取消纪律** — Esc / ✕ / 切走标签页即丢弃录音；小于 0.5 秒的录音自动丢弃；提交进行中停止会安全释放草稿，不留孤儿上传。

本插件只负责录音、可选转码与附加，不写磁盘文件、不做语音识别——搭配 `dsh-stt` 之类的语音转写插件使用。

## 安装

```bash
git clone https://github.com/most-silence/dsh-record
cd dsh-record && npm install && npm run build
dsh plugin --profile <你的profile> add file:$PWD
```

安装后重启 dsh 宿主并刷新页面。

## 配置

「设置 → 插件 → dsh-record」只有一个字段：

| 字段 | 可选值 | 含义 |
| --- | --- | --- |
| `format` | `mp3`（默认）· `wav` · `webm` | 输出容器。MP3 与 WAV 在停止时于浏览器端转码；WebM 按采集原样附加。改完需要刷新页面生效（浏览器半在启动时读一次配置）。 |

## 架构

```
浏览器半 (lib/client.js)                    宿主半 (lib/index.js)
├─ 麦克风按钮 @ conversation.input.right      ├─ Config schema { format: mp3 | wav | webm }
├─ zh/en 词典 → locale 服务                   └─ GET /dsh-record/config → 下发已解析配置
├─ MediaRecorder → webm/opus                     （same-origin 守卫）
├─ 解码 → lamejs (mp3) / PCM 封装 (wav)
└─ createDrafts + addAttachments 挂附件
```

两条加固规则确保插件永远不会拖垮 profile 启动——都是真实事故换来的：

1. **`@breezystack/lamejs` 强制内联打包。** DSH 的模块表是冻结的，不含 lamejs；若留作构建期 external，运行时 `require("@breezystack/lamejs")` 会找不到模块表条目，导致整个 web boot 失败。`tsdown` 用 `noExternal` 强制内联。
2. **宿主 `Config` 只用 `z.union([...])`，绝不用 `z.enum([...])`，且 schemastery 保持 `external`。** 宿主那版 schemastery 没有 `enum` 方法；而用打包进来的私有副本构造 schema 会与宿主校验器不兼容——两者任一情况都会在 import 阶段抛错，`dsh-record` 这一行因 `required` 失败，连带整个 profile 起不来。

## 开发

```bash
npm install
npm run build     # tsdown：lib/index.js (ESM) + lib/client.js (CJS，ModuleLoader 包装)
npm test          # 14 个 node:test 用例：客户端工厂契约 (9) + 编码器 (5)
```

测试用 Node 24 直接跑（原生 TS 类型剥离），无需浏览器。

## 已知限制

- 附件通道依赖在 dsh 0.2.1-rc.2 实测的宿主契约（`conversation.input.right` 座位、`createDrafts` / `addAttachments`）；上游变更时会退化为行内错误提示。
- MP3/WAV 转码发生在停止之后（非录制中），超长录音会有一小段编码耗时。
- 录音需要授予麦克风权限；页面需通过 HTTPS 或 localhost 提供。
- 输出格式存在宿主 profile 配置里（不在浏览器），每次页面加载读取一次，所以在设置页改完需刷新页面生效。

## 许可

[MIT](LICENSE)
