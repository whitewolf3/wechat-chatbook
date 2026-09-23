/**
 * IPC 通道注册（渲染进程可调用能力的白名单）
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AddBookmarkInput, ImportOptionsDto, MessageFilter, SearchParams } from '../shared/types'
import { exportConversationHtml } from './export/html-exporter'
import { exportConversationMarkdown } from './export/markdown-exporter'
import { exportConversationPdf } from './export/pdf-exporter'
import { runImport } from './import/importer'
import {
  clipboardMonitorStatus,
  parseClipboardText,
  resolveConversation,
  startClipboardMonitor,
  stopClipboardMonitor
} from './import/clipboard-monitor'
import { deleteConversationFiles, getDb, getLibraryRoot, initLibrary } from './library'
import { runAnalysisPipeline, generateReplyDrafts } from './ai/enhanced-analyzer'
import { applyLLMConfig, callLLM, getLLMConfig } from './ai/llm-client'

function parentWindow(e: Electron.IpcMainInvokeEvent): BrowserWindow {
  // IPC 事件必然来自某个窗口，这里仅做类型收窄
  return BrowserWindow.fromWebContents(e.sender) as BrowserWindow
}

/** 选择导出目录 */
async function pickOutDir(e: Electron.IpcMainInvokeEvent): Promise<string | null> {
  const r = await dialog.showOpenDialog(parentWindow(e), {
    title: '选择导出位置',
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
  })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
}

export function registerIpc(): void {
  initLibrary()

  // ---------- 系统交互 ----------
  ipcMain.handle('app:selectDataFiles', async (e) => {
    const r = await dialog.showOpenDialog(parentWindow(e), {
      title: '选择聊天数据文件（txt / json / csv / html）',
      filters: [
        { name: '聊天数据', extensions: ['txt', 'text', 'json', 'csv', 'html', 'htm', 'log'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    return r.canceled ? null : r.filePaths
  })

  ipcMain.handle('app:selectMediaDirs', async (e) => {
    const r = await dialog.showOpenDialog(parentWindow(e), {
      title: '选择媒体文件夹（图片 / 表情 / 视频）',
      properties: ['openDirectory', 'multiSelections']
    })
    return r.canceled ? null : r.filePaths
  })

  ipcMain.handle('app:showInFolder', (_e, p: string) => {
    shell.showItemInFolder(p)
  })

  ipcMain.handle('app:dbInfo', () => ({
    dbPath: path.join(getLibraryRoot(), 'chatbook.db'),
    libraryRoot: getLibraryRoot()
  }))

  // ---------- 会话 ----------
  ipcMain.handle('conv:list', () => getDb().listConversations())

  ipcMain.handle('conv:delete', (_e, id: number) => {
    getDb().deleteConversation(id)
    deleteConversationFiles(id)
  })

  // ---------- 导入 ----------
  ipcMain.handle('import:run', (e, opts: ImportOptionsDto) => {
    if (!opts.conversationId && !opts.title?.trim()) {
      throw new Error('请填写会话标题，或选择导入到已有会话')
    }
    if (opts.files.length === 0 && (opts.mediaDirs?.length ?? 0) === 0 && (opts.mediaFiles?.length ?? 0) === 0) {
      throw new Error('请至少提供一个数据文件或媒体文件夹')
    }
    // 校验文件存在性，尽早失败
    for (const f of opts.files) {
      if (!fs.existsSync(f)) throw new Error(`文件不存在：${f}`)
    }
    return runImport(opts, (p) => e.sender.send('import:progress', p))
  })

  // ---------- 剪贴板监听（微信多选消息 Cmd+C 自动入库） ----------
  ipcMain.handle('clipboard:start', (e) => {
    startClipboardMonitor((c) => {
      try {
        e.sender.send('clipboard:captured', c)
      } catch {}
    })
    return clipboardMonitorStatus()
  })

  ipcMain.handle('clipboard:stop', () => {
    stopClipboardMonitor()
    return clipboardMonitorStatus()
  })

  ipcMain.handle('clipboard:status', () => {
    return clipboardMonitorStatus()
  })

  /** 诊断：读取当前剪贴板并给出解析/归属结果，帮助用户确认复制格式是否匹配 */
  ipcMain.handle('clipboard:peek', () => {
    let text = ''
    try {
      text = clipboard.readText()
    } catch {
      return { text: '', messages: 0, conversationTitle: null as string | null }
    }
    if (!text) return { text: '', messages: 0, conversationTitle: null }
    const messages = parseClipboardText(text)
    const conv = messages ? resolveConversation(messages) : null
    return {
      text: text.slice(0, 400),
      messages: messages?.length ?? 0,
      conversationTitle: conv?.title ?? null
    }
  })

  // ---------- 消息与搜索 ----------
  ipcMain.handle('msg:list', (_e, conversationId: number, filter?: MessageFilter) => {
    const messages = getDb().listMessages(conversationId, filter ?? {})
    return messages.map((m) => ({
      ...m,
      absPath: m.filePath ? path.join(getLibraryRoot(), 'media', String(m.conversationId), m.filePath) : null,
      attachments: m.attachments.map((a) => ({
        ...a,
        absPath: path.join(getLibraryRoot(), 'media', String(m.conversationId), a.path)
      }))
    }))
  })

  ipcMain.handle(
    'msg:context',
    (_e, messageId: number, before = 10, after = 10) => getDb().messageContext(messageId, before, after)
  )

  ipcMain.handle('search:query', (_e, params: SearchParams) => getDb().search(params))

  // ---------- 导出 ----------
  ipcMain.handle('export:html', async (e, { conversationId, embed }: { conversationId: number; embed?: boolean }) => {
    const dir = await pickOutDir(e)
    if (!dir) return { canceled: true }
    const p = await exportConversationHtml(conversationId, dir, { embed: !!embed })
    return { canceled: false, path: p }
  })

  ipcMain.handle('export:markdown', async (e, { conversationId }: { conversationId: number }) => {
    const dir = await pickOutDir(e)
    if (!dir) return { canceled: true }
    const p = await exportConversationMarkdown(conversationId, dir)
    return { canceled: false, path: p }
  })

  ipcMain.handle('export:pdf', async (e, { conversationId }: { conversationId: number }) => {
    const dir = await pickOutDir(e)
    if (!dir) return { canceled: true }
    const p = await exportConversationPdf(conversationId, dir)
    return { canceled: false, path: p }
  })

  // ---------- Phase 3: 消息便签（含手动独立便签） ----------
  ipcMain.handle('bookmark:add', (_e, input: AddBookmarkInput) => {
    getDb().addBookmark({
      messageId: input.messageId ?? null,
      conversationId: input.conversationId,
      category: input.category,
      content: input.content,
      note: input.note
    })
  })

  ipcMain.handle(
    'bookmark:update',
    (_e, id: number, p: { category?: string; content?: string; note?: string | null }) => {
      getDb().updateBookmark(id, p)
    }
  )

  ipcMain.handle('bookmark:remove', (_e, id: number) => {
    getDb().removeBookmark(id)
  })

  ipcMain.handle('bookmark:list', (_e, conversationId: number) => {
    return getDb().listBookmarks(conversationId)
  })

  // ---------- Phase 3: 人物画像（分片全量分析管线） ----------
  ipcMain.handle('persona:analyze', async (event, conversationId: number) => {
    const db = getDb()
    // 取全量消息参与分析（默认 limit 2000 会截断，导致最近消息未纳入分析）
    const messages = db.listMessages(conversationId, { limit: 100000 })

    // 分片并发分析（事实提取 → 画像合并 → 建议），进度实时推给渲染进程
    const result = await runAnalysisPipeline(messages, (p) => {
      try {
        event.sender.send('analysis:progress', p)
      } catch {}
    })

    // 保存本地分析结果
    db.savePersona(conversationId, {
      ...result.local,
      deep: result.deep,
      hasLLM: result.hasLLM
    })

    // 重新分析前先归档旧的 pending 建议，避免重复堆叠（已处理的建议不受影响）
    for (const old of db.listSuggestions(conversationId, 'pending')) {
      db.updateSuggestionStatus(old.id, 'dismissed')
    }

    // 保存建议到数据库
    if (result.suggestions.hasLLM && result.suggestions.deep) {
      for (const s of result.suggestions.deep.suggestions) {
        db.addSuggestion(conversationId, s.category, `[${s.priority.toUpperCase()}] ${s.content}\n理由：${s.reason}`)
      }
    } else {
      for (const s of result.suggestions.local) {
        db.addSuggestion(conversationId, s.category, s.content, s.triggerMessageId)
      }
    }

    // 提取重要信息（全量分片，含来源消息与到期日），替换旧数据。
    // 全部分片失败（key 失效/断网）时保留旧事实，避免一次失败清空已有数据
    if (result.factsFailed) {
      console.error('persona:analyze 事实提取失败，保留旧数据')
    } else {
      db.clearFacts(conversationId)
      for (const f of result.facts) {
        db.addFact({
          conversationId,
          category: f.category,
          content: f.content,
          evidence: f.evidence,
          messageId: f.messageId,
          occursAt: f.occursAt
        })
      }
    }

    return {
      ...result.local,
      deep: result.deep,
      hasLLM: result.hasLLM,
      factsFailed: result.factsFailed
    }
  })

  ipcMain.handle('persona:get', (_e, conversationId: number) => {
    return getDb().getPersona(conversationId)
  })

  // ---------- Phase 3: 重要信息（自动总结） ----------
  ipcMain.handle('fact:list', (_e, conversationId: number) => {
    return getDb().listFacts(conversationId)
  })

  // ---------- 关系趋势（纯本地按月统计） ----------
  ipcMain.handle('stats:trends', (_e, conversationId: number) => {
    return getDb().getTrendStats(conversationId)
  })

  // ---------- 回复助手（基于最近对话生成回复草案，需 LLM） ----------
  ipcMain.handle('reply:assist', async (_e, conversationId: number, tone: string) => {
    const db = getDb()
    const conv = db.getConversation(conversationId)
    if (!conv) return { ok: false, error: 'no-conversation' }
    // 必须取"最近"消息（getRecentMessages），listMessages 的 LIMIT 是"最早"语义
    const messages = db.getRecentMessages(conversationId, 100)
    const drafts = await generateReplyDrafts(
      messages,
      tone,
      conv.selfName || '我',
      conv.peerName || '对方'
    )
    if (!drafts) return { ok: false, error: 'no-llm' }
    return { ok: true, drafts }
  })

  // ---------- LLM 配置 ----------
  /** 脱敏显示：sk-abcd****wxyz（不足 12 位只露尾 2 位） */
  function maskKey(key: string): string {
    if (!key) return ''
    if (key.length <= 8) return '****' + key.slice(-2)
    return `${key.slice(0, 6)}****${key.slice(-4)}`
  }

  ipcMain.handle('llm:checkConfig', () => {
    const config = getLLMConfig()
    const raw = config?.apiKey ?? process.env.CHATBOOK_LLM_API_KEY ?? ''
    // 只回脱敏标识，完整 key 不进渲染进程（防截屏/录屏泄露）
    return {
      configured: config !== null,
      maskedKey: maskKey(raw),
      baseUrl: config?.baseUrl,
      model: config?.model
    }
  })

  /**
   * .env 文件位置——与 index.ts 启动加载顺序保持一致（Documents 优先）：
   * 1. ~/Documents/ChatBook/.env 存在则读写它（index.ts 第一优先加载，且打包后唯一可写）
   * 2. dev 模式：项目根 .env（electron-vite 启动 cwd 即项目根）
   * 3. 打包模式：~/Documents/ChatBook/.env（用户目录必定可写，cwd/appPath 不可靠）
   */
  function resolveEnvPath(): string {
    const userEnv = path.join(app.getPath('documents'), 'ChatBook', '.env')
    if (fs.existsSync(userEnv)) return userEnv
    return app.isPackaged ? userEnv : path.join(process.cwd(), '.env')
  }

  // apiKey：null/undefined=保持不变（如只改 baseUrl），''=清空，非空=更新
  ipcMain.handle(
    'llm:setConfig',
    (_e, apiKey: string | null, baseUrl?: string, model?: string) => {
      // 写 .env 落盘（重启后仍生效）+ 同步 process.env（立即生效）
      const resolved = resolveEnvPath()
      applyLLMConfig(resolved, apiKey, baseUrl, model)
      return { success: true, envPath: resolved }
    }
  )

  // 用表单当前值真实调一次 LLM（极小请求）。key 留空时用当前已保存的 key 测试。
  ipcMain.handle(
    'llm:testConfig',
    async (_e, apiKey: string, baseUrl?: string, model?: string) => {
      const key = apiKey?.trim() || getLLMConfig()?.apiKey || ''
      if (!key) return { ok: false, error: 'API Key 为空且未保存过配置' }
      const config = {
        apiKey: key,
        baseUrl: baseUrl || 'https://api.deepseek.com/v1',
        model: model || 'deepseek-chat'
      }
      const start = Date.now()
      try {
        await callLLM(config, [{ role: 'user', content: '请只回复：ok' }])
        return { ok: true, latencyMs: Date.now() - start }
      } catch (e) {
        return { ok: false, error: String((e as Error).message).slice(0, 160) }
      }
    }
  )

  // ---------- Phase 3: 对话建议 ----------
  ipcMain.handle('suggestion:list', (_e, conversationId: number, status: string) => {
    return getDb().listSuggestions(conversationId, status)
  })

  ipcMain.handle('suggestion:updateStatus', (_e, id: number, status: string) => {
    getDb().updateSuggestionStatus(id, status)
  })
}
