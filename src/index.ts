/**
 * dsh-record — host half.
 *
 * 职责：
 *   1. 让 Loader 挂载本插件（浏览器半经 dsh.client 扫描进 boot graph）；
 *   2. 声明 Config（音频格式 / 落盘位置），由插件配置页编辑；
 *   3. 注册两条 same-origin 路由：`GET /dsh-record/config`（把配置交给
 *      浏览器半）与 `POST /dsh-record/save`（录音字节落盘）。
 *
 * 编码不在宿主做：mp3/wav 由浏览器半用 lamejs 转码后 POST 过来，宿主只写
 * 文件（单一职责，也避免把编码器塞进宿主进程）。
 */

import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createRoutes } from './save-route.js'

type Context = CordisContext & {
  webServer: WebServer
}

export const name = 'dsh-record'

export const inject = ['webServer']

export interface Config extends Record<string, unknown> {
  format: 'mp3' | 'wav' | 'webm'
  saveMode: 'workspace' | 'custom' | 'off'
  saveDir: string
}

export const Config: z<Config> = z.object({
  format: z.enum(['mp3', 'wav', 'webm']).default('mp3')
    .description('录音文件格式：mp3（默认，浏览器端用 lamejs 转码）/ wav（无损）/ webm（浏览器原生 Opus，不转码）。'),
  saveMode: z.enum(['workspace', 'custom', 'off']).default('workspace')
    .description('录音保存位置：workspace = 当前项目空间根目录下的 recordings/；custom = 使用下方自定义目录；off = 不落盘，只作为会话附件。'),
  saveDir: z.string().default('')
    .description('自定义保存目录（saveMode = custom 时生效），需为绝对路径，例如 D:\\Recordings。'),
})

export function apply(ctx: Context, config: Config): void {
  const resolved: Config = {
    format: config.format ?? 'mp3',
    saveMode: config.saveMode ?? 'workspace',
    saveDir: config.saveDir ?? '',
  }
  const routes = createRoutes(resolved)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-record/config',
    handler: routes.configHandler,
  }), 'dsh-record: config route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-record/save',
    handler: routes.saveHandler,
  }), 'dsh-record: save route')
}
