/**
 * dsh-record — host half.
 *
 * 声明 Loader Config 并注册两条路由，让「设置 → 插件 → dsh-record」详情页
 * 能配置录音行为，且配置真正生效：
 *
 *   format   'mp3' | 'wav' | 'webm'       默认 mp3
 *   dirMode  'workspace' | 'custom'       临时目录：跟随项目空间 / 自定义
 *   customDir string                       自定义目录（dirMode=custom 时使用）
 *
 * 路由：
 *   GET  /dsh-record/config  下发解析后的配置给浏览器半
 *   POST /dsh-record/save    录音字节写入目标目录
 *
 * 让表单真正出现的硬约束（由宿主 dsh-settings 的表单投影决定）：
 *   1. schema 顶层必须标 `.volatile()`——`volatileForm()` 只投影含 volatile 的
 *      子树，普通字段整条被跳过，插件页什么也不显示；
 *   2. schemastery 保持 `external`，枚举只用 `z.union([...])`（宿主没有
 *      `z.enum`，2026-11-04 的启动失败就是它引起的）。
 */

import type { Context as CordisContext } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createRoutes, type RecordRouteConfig } from './save-route.js'

type Context = CordisContext & {
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (req: any, res: any) => Promise<void>
    }): () => void
  }
}

export const name = 'dsh-record'

export const inject = ['webServer']

export interface Config extends Record<string, unknown> {
  format: 'mp3' | 'wav' | 'webm'
  dirMode: 'workspace' | 'custom'
  customDir: string
}

export const Config: z<Config> = z.object({
  format: z.union(['mp3', 'wav', 'webm']).default('mp3'),
  dirMode: z.union(['workspace', 'custom']).default('workspace'),
  customDir: z.string().default(''),
}).volatile()

export function apply(ctx: Context, config: Config): void {
  const resolved: RecordRouteConfig = {
    format: config?.format === 'wav' || config?.format === 'webm' ? config.format : 'mp3',
    dirMode: config?.dirMode === 'custom' ? 'custom' : 'workspace',
    customDir: typeof config?.customDir === 'string' ? config.customDir : '',
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