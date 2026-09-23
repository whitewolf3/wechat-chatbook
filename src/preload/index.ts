/**
 * preload：以 contextBridge 暴露白名单 API
 * 渲染进程没有任何 Node 能力，只能调用此处声明的方法
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ChatBookApi,
  ExportResult,
  ImportOptionsDto,
  ImportProgress,
  ImportResult,
  ConversationDTO,
  FactDTO,
  AnalysisProgress,
  MonthlyTrend,
  ReplyDraft,
  ClipboardCapture,
  ClipboardMonitorStatus,
  ClipboardPeek,
  AddBookmarkInput,
  BookmarkDTO,
  MessageDTO,
  MessageFilter,
  SearchHit,
  SearchParams
} from '../shared/types'

const api: ChatBookApi = {
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  selectDataFiles: () => ipcRenderer.invoke('app:selectDataFiles'),
  selectMediaDirs: () => ipcRenderer.invoke('app:selectMediaDirs'),
  showInFolder: (p: string) => ipcRenderer.invoke('app:showInFolder', p),
  dbInfo: () => ipcRenderer.invoke('app:dbInfo'),

  listConversations: (): Promise<ConversationDTO[]> => ipcRenderer.invoke('conv:list'),
  deleteConversation: (id: number): Promise<void> => ipcRenderer.invoke('conv:delete', id),

  runImport: (opts: ImportOptionsDto): Promise<ImportResult> => ipcRenderer.invoke('import:run', opts),
  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: ImportProgress): void => cb(p)
    ipcRenderer.on('import:progress', listener)
    return () => ipcRenderer.off('import:progress', listener)
  },

  listMessages: (conversationId: number, filter?: MessageFilter): Promise<MessageDTO[]> =>
    ipcRenderer.invoke('msg:list', conversationId, filter),
  getMessageContext: (messageId: number, before = 10, after = 10): Promise<MessageDTO[]> =>
    ipcRenderer.invoke('msg:context', messageId, before, after),
  search: (params: SearchParams): Promise<SearchHit[]> => ipcRenderer.invoke('search:query', params),

  exportHtml: (conversationId: number, opts?: { embed?: boolean }): Promise<ExportResult> =>
    ipcRenderer.invoke('export:html', { conversationId, embed: opts?.embed }),
  exportMarkdown: (conversationId: number): Promise<ExportResult> =>
    ipcRenderer.invoke('export:markdown', { conversationId }),
  exportPdf: (conversationId: number): Promise<ExportResult> =>
    ipcRenderer.invoke('export:pdf', { conversationId }),

  // Phase 3
  addBookmark: (input: AddBookmarkInput): Promise<void> => ipcRenderer.invoke('bookmark:add', input),
  updateBookmark: (id: number, p: { category?: string; content?: string; note?: string | null }): Promise<void> =>
    ipcRenderer.invoke('bookmark:update', id, p),
  removeBookmark: (id: number): Promise<void> => ipcRenderer.invoke('bookmark:remove', id),
  listBookmarks: (conversationId: number): Promise<BookmarkDTO[]> =>
    ipcRenderer.invoke('bookmark:list', conversationId),
  analyzePersona: (conversationId: number): Promise<any> =>
    ipcRenderer.invoke('persona:analyze', conversationId),
  getPersona: (conversationId: number): Promise<any> =>
    ipcRenderer.invoke('persona:get', conversationId),
  listSuggestions: (conversationId: number, status: string): Promise<any[]> =>
    ipcRenderer.invoke('suggestion:list', conversationId, status),
  updateSuggestionStatus: (id: number, status: string): Promise<void> =>
    ipcRenderer.invoke('suggestion:updateStatus', id, status),
  listFacts: (conversationId: number): Promise<FactDTO[]> =>
    ipcRenderer.invoke('fact:list', conversationId),
  onAnalysisProgress: (cb: (p: AnalysisProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: AnalysisProgress): void => cb(p)
    ipcRenderer.on('analysis:progress', listener)
    return () => ipcRenderer.off('analysis:progress', listener)
  },
  getTrendStats: (conversationId: number): Promise<MonthlyTrend[]> =>
    ipcRenderer.invoke('stats:trends', conversationId),
  replyAssist: (conversationId: number, tone: string): Promise<{ ok: boolean; drafts?: ReplyDraft[]; error?: string }> =>
    ipcRenderer.invoke('reply:assist', conversationId, tone),
  startClipboardMonitor: (): Promise<ClipboardMonitorStatus> => ipcRenderer.invoke('clipboard:start'),
  stopClipboardMonitor: (): Promise<ClipboardMonitorStatus> => ipcRenderer.invoke('clipboard:stop'),
  clipboardMonitorStatus: (): Promise<ClipboardMonitorStatus> => ipcRenderer.invoke('clipboard:status'),
  onClipboardCaptured: (cb: (c: ClipboardCapture) => void): (() => void) => {
    const listener = (_e: unknown, c: ClipboardCapture): void => cb(c)
    ipcRenderer.on('clipboard:captured', listener)
    return () => ipcRenderer.off('clipboard:captured', listener)
  },
  clipboardPeek: (): Promise<ClipboardPeek> => ipcRenderer.invoke('clipboard:peek'),

  // LLM 配置
  checkLLMConfig: (): Promise<{
    configured: boolean
    maskedKey?: string
    baseUrl?: string
    model?: string
  }> => ipcRenderer.invoke('llm:checkConfig'),
  setLLMConfig: (
    apiKey: string | null,
    baseUrl?: string,
    model?: string
  ): Promise<{ success: boolean; envPath?: string }> =>
    ipcRenderer.invoke('llm:setConfig', apiKey, baseUrl, model),
  testLLMConfig: (
    apiKey: string,
    baseUrl?: string,
    model?: string
  ): Promise<{ ok: boolean; error?: string; latencyMs?: number }> =>
    ipcRenderer.invoke('llm:testConfig', apiKey, baseUrl, model)
}

contextBridge.exposeInMainWorld('chatbook', api)
