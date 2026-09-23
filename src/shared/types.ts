/**
 * 主进程 / 渲染进程共享的类型定义
 * 仅类型，无运行时代码，保证两端契约一致
 */

export type SenderRole = 'self' | 'peer' | 'unknown'

export type MessageType =
  | 'text'
  | 'image'
  | 'sticker'
  | 'emoji'
  | 'voice'
  | 'video'
  | 'file'
  | 'location'
  | 'quote'
  | 'link'
  | 'system'
  | 'unknown'

export interface AttachmentDTO {
  type: string
  /** 相对媒体库的路径 */
  path: string
  /** 绝对路径（仅主进程填充，用于界面展示） */
  absPath?: string
}

export interface MessageDTO {
  id: number
  conversationId: number
  sender: string
  senderRole: SenderRole
  messageType: MessageType
  content: string | null
  /** 首个附件的相对路径（兼容原始设计字段） */
  filePath: string | null
  absPath?: string | null
  /** 本地时间 YYYY-MM-DD HH:mm:ss */
  timestamp: string
  createdTime: string
  attachments: AttachmentDTO[]
}

export interface ConversationDTO {
  id: number
  title: string
  selfName: string | null
  peerName: string | null
  messageCount: number
  firstTime: string | null
  lastTime: string | null
}

export interface MessageFilter {
  keyword?: string
  senderRole?: SenderRole | ''
  messageType?: MessageType | ''
  /** YYYY-MM-DD HH:mm:ss */
  from?: string
  to?: string
  limit?: number
  offset?: number
  /** true：limit 取「最近 N 条」（DESC 取数后反转为时间升序），用于浏览窗口；默认取最早 N 条（分页语义） */
  recent?: boolean
}

export interface SearchParams {
  keyword: string
  conversationId?: number
  senderRole?: SenderRole | ''
  messageType?: MessageType | ''
  from?: string
  to?: string
  limit?: number
}

export interface SearchHit {
  id: number
  conversationId: number
  conversationTitle: string
  sender: string
  senderRole: SenderRole
  messageType: MessageType
  snippet: string
  timestamp: string
}

export type ImportStage = 'prepare' | 'media' | 'parse' | 'link' | 'done'

export interface ImportProgress {
  stage: ImportStage
  current?: number
  total?: number
  detail?: string
}

export interface ImportOptionsDto {
  /** 导入到已有会话；缺省则新建 */
  conversationId?: number
  title?: string
  selfName?: string
  peerName?: string
  /** 聊天数据文件（txt/json/csv/html） */
  files: string[]
  /** 媒体文件夹（递归收集图片/表情/视频等） */
  mediaDirs?: string[]
  /** 单独拖入的媒体文件 */
  mediaFiles?: string[]
  /** 是否按时间自动关联媒体，默认 true */
  autoLinkMedia?: boolean
}

export interface ImportResult {
  conversationId: number
  inserted: number
  skipped: number
  warnings: string[]
}

export interface ExportResult {
  canceled: boolean
  path?: string
}

/** 自动提取的重要信息（生日/加班/承诺/重点话等） */
export interface FactDTO {
  id: number
  category: string
  content: string
  evidence: string | null
  /** 来源消息 id（点击可回溯到聊天上下文），分片提取失败时为 null */
  messageId: number | null
  /** 到期日：YYYY-MM-DD 具体事件，或 MM-DD 每年循环（生日/纪念日） */
  occursAt: string | null
  createdAt: string
}

/** 分析进度推送（分片全量分析管线） */
export interface AnalysisProgress {
  stage: 'facts' | 'persona' | 'suggestions' | 'done'
  current: number
  total: number
}

/** 按月关系趋势统计（纯本地） */
export interface MonthlyTrend {
  month: string
  selfCount: number
  peerCount: number
  selfInitiated: number
  peerInitiated: number
  /** 平均回复时长（分钟），样本不足为 null */
  selfReplyMin: number | null
  peerReplyMin: number | null
}

/** 回复助手草案 */
export interface ReplyDraft {
  text: string
  intent: string
}

/** 剪贴板捕获结果（clipboard:captured 推送） */
export interface ClipboardCapture {
  conversationId: number
  inserted: number
  skipped: number
}

/** 剪贴板监听状态 */
export interface ClipboardMonitorStatus {
  active: boolean
  capturedTotal: number
  lastCaptureAt: string | null
  lastDetail: string | null
}

/** 剪贴板诊断（clipboard:peek） */
export interface ClipboardPeek {
  text: string
  messages: number
  conversationTitle: string | null
}

/** 便签：messageId 为 null 表示手动创建的独立便签 */
export interface BookmarkDTO {
  id: number
  messageId: number | null
  category: string
  content: string | null
  note: string | null
  createdAt: string
  sender: string | null
  timestamp: string | null
}

/** 新建便签入参（messageId 传 null/省略 即手动便签） */
export interface AddBookmarkInput {
  messageId?: number | null
  conversationId: number
  category?: string
  content?: string
  note?: string
}

/** preload 暴露给渲染进程的 API 契约 */
export interface ChatBookApi {
  pathForFile(file: File): string
  selectDataFiles(): Promise<string[] | null>
  selectMediaDirs(): Promise<string[] | null>
  showInFolder(p: string): Promise<void>
  dbInfo(): Promise<{ dbPath: string; libraryRoot: string }>
  listConversations(): Promise<ConversationDTO[]>
  deleteConversation(id: number): Promise<void>
  runImport(opts: ImportOptionsDto): Promise<ImportResult>
  onImportProgress(cb: (p: ImportProgress) => void): () => void
  listMessages(conversationId: number, filter?: MessageFilter): Promise<MessageDTO[]>
  getMessageContext(messageId: number, before?: number, after?: number): Promise<MessageDTO[]>
  search(params: SearchParams): Promise<SearchHit[]>
  exportHtml(conversationId: number, opts?: { embed?: boolean }): Promise<ExportResult>
  exportMarkdown(conversationId: number): Promise<ExportResult>
  exportPdf(conversationId: number): Promise<ExportResult>
  // Phase 3
  addBookmark(input: AddBookmarkInput): Promise<void>
  updateBookmark(
    id: number,
    p: { category?: string; content?: string; note?: string | null }
  ): Promise<void>
  removeBookmark(id: number): Promise<void>
  listBookmarks(conversationId: number): Promise<BookmarkDTO[]>
  analyzePersona(conversationId: number): Promise<any>
  getPersona(conversationId: number): Promise<any>
  listSuggestions(conversationId: number, status: string): Promise<any[]>
  updateSuggestionStatus(id: number, status: string): Promise<void>
  listFacts(conversationId: number): Promise<FactDTO[]>
  onAnalysisProgress(cb: (p: AnalysisProgress) => void): () => void
  // 关系趋势（纯本地按月统计）
  getTrendStats(conversationId: number): Promise<MonthlyTrend[]>
  // 回复助手（需 LLM；ok=false 时 error 为 'no-llm' | 'no-conversation'）
  replyAssist(
    conversationId: number,
    tone: string
  ): Promise<{ ok: boolean; drafts?: ReplyDraft[]; error?: string }>
  // 剪贴板监听（微信多选消息 Cmd+C 自动入库）
  startClipboardMonitor(): Promise<ClipboardMonitorStatus>
  stopClipboardMonitor(): Promise<ClipboardMonitorStatus>
  clipboardMonitorStatus(): Promise<ClipboardMonitorStatus>
  onClipboardCaptured(cb: (c: ClipboardCapture) => void): () => void
  clipboardPeek(): Promise<ClipboardPeek>
  // LLM 配置（保存写入 .env 并立即生效；key 只回脱敏标识，完整值不进渲染进程）
  checkLLMConfig(): Promise<{
    configured: boolean
    maskedKey?: string
    baseUrl?: string
    model?: string
  }>
  /** apiKey 传 null/undefined=保持不变，''=清空，非空=更新 */
  setLLMConfig(
    apiKey: string | null,
    baseUrl?: string,
    model?: string
  ): Promise<{ success: boolean; envPath?: string }>
  testLLMConfig(
    apiKey: string,
    baseUrl?: string,
    model?: string
  ): Promise<{ ok: boolean; error?: string; latencyMs?: number }>
}
