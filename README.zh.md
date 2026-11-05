# dsh-record

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个 DeepSeek Harness (dsh) 插件：在输入框上加一个麦克风按钮，点一下录音，再点一下停止——录音自动挂进输入框作为会话附件，同时按配置落盘保存（MP3 为主）。

[English](README.md)

## 功能

- **输入框麦克风按钮** — 注册在 `conversation.input.right` 座位（提交按钮前），不是悬浮球；与占用左侧座位的 `dsh-talk` / `dsh-stt` 互不干扰。
- **实时录音** — 浏览器 `MediaRecorder`，webm/opus 优先并按能力回退；录音中显示计时与实时文件名预览（`rec-YYYYMMDD-HHMMSS-<n>s.mp3`）。
- **可选格式** — MP3（默认，浏览器端用 lamejs 转码）/ WAV（16-bit PCM 无损）/ WebM（浏览器原生 Opus，不转码）。在插件配置页选择。
- **随 Prompt 发送** — 编码后的文件走宿主草稿附件通道（`conversation.createDrafts` + `inputActions.addAttachments`）登记并挂进输入框，显示为带上传进度的文件卡，随 Prompt 一起进入正常上传队列。
- **落盘保存** — 默认写到当前项目空间根目录的 `recordings/`，也可在配置页填任意绝对路径目录，或完全关闭落盘（仅附件）。宿主半通过两条 same-origin 守卫路由完成配置下发与写盘（`GET /dsh-record/config`、`POST /dsh-record/save`）。
- **取消纪律** — Esc / ✕ / 切走标签页即丢弃；小于 0.5 秒的录音自动丢弃；提交进行中停止会安全释放草稿，不留孤儿上传。

## 安装

```bash
# 从源码
git clone https://github.com/most-silence/dsh-record
cd dsh-record && npm install && npm run build
dsh plugin --profile <你的profile> add file:$PWD

# GitHub Releases 预构建包（免构建）
dsh plugin --profile <你的profile> add file:dsh-record.tgz   # 最新 release 附带的资产
```

安装后重启 dsh 宿主并刷新页面。

## 配置

插件配置页提供三项：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `format` | `mp3`（默认）· `wav` · `webm` | 录音格式。MP3 由浏览器端 lamejs 编码；WebM 不转码。 |
| `saveMode` | `workspace`（默认）· `custom` · `off` | 保存位置：当前项目空间根目录的 `recordings/`、自定义目录，或仅附件不落盘。 |
| `saveDir` | 任意绝对路径 | `custom` 模式的目标目录，例如 `D:\Recordings` 或 `/home/me/Recordings`。 |

## 架构

```
浏览器半 (lib/client.js)                        宿主半 (lib/index.js)
├─ 麦克风按钮 @ conversation.input.right        ├─ Config schema (format/saveMode/saveDir)
├─ MediaRecorder → webm/opus                    ├─ GET  /dsh-record/config  → 下发 Config
├─ 解码 → lamejs (mp3) / PCM 封装 (wav)         └─ POST /dsh-record/save    → 清洗文件名/目录，
├─ createDrafts + addAttachments 挂附件             写入文件并返回路径
└─ POST 字节到 /dsh-record/save
```

浏览器负责编码，宿主只写文件——无原生依赖，不需要 ffmpeg。

## 开发

```bash
npm install
npm run build     # tsdown：lib/index.js (ESM) + lib/client.js (CJS，ModuleLoader 包装)
npm test          # 19 个 node:test 用例：客户端工厂契约、编码器、落盘路由
```

测试用 Node 24 直接跑（原生 TS 类型剥离），无需浏览器。

## 已知限制

- 附件通道依赖在 dsh 0.2.1-rc.2 实测的宿主契约（`conversation.input.right` 座位、`createDrafts` / `addAttachments`）；上游变更时会退化为行内错误提示，不影响页面其余部分。
- MP3 编码发生在停止之后（非录制中），超长录音会有一小段编码耗时。
- workspace 模式跟随会话当前项目空间；切换空间后 `recordings/` 位置随之变化。
- 录音需要授予麦克风权限；页面需通过 HTTPS 或 localhost 提供。

## 许可

[MIT](LICENSE)
