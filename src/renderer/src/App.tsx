import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AnalysisProgress,
  ClipboardMonitorStatus,
  ConversationDTO,
  ExportResult,
  FactDTO,
  MessageFilter,
  MessageDTO,
  MonthlyTrend
} from '../../shared/types'
import ImportDialog from './ImportDialog'
import MessageList from './MessageList'
import { BookmarkWall } from '../components/BookmarkWall'
import { LLMConfigDialog } from '../components/LLMConfigDialog'
import { PersonaPanel } from '../components/PersonaPanel'
import { FactPanel } from '../components/FactPanel'
import { SuggestionList } from '../components/SuggestionList'
import ReplyAssist from '../components/ReplyAssist'

/** 分片分析阶段的中文标签 */
const STAGE_LABELS: Record<string, string> = {
  facts: '重要信息提取',
  persona: '画像分析',
  suggestions: '生成建议',
  done: '完成'
}

function stageText(p: AnalysisProgress): string {
  const label = STAGE_LABELS[p.stage] ?? p.stage
  return p.stage === 'suggestions' || p.stage === 'done' ? label : `${label} ${p.current}/${p.total}`
}

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部类型' },
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'sticker', label: '表情' },
  { value: 'voice', label: '语音' },
  { value: 'video', label: '视频' },
  { value: 'file', label: '文件' }
]

/** 媒体绝对路径 → chatbook-media:// 自定义协议 URL（http 源页面禁止 file:// 子资源） */
function toFileUrl(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const marker = '/media/'
  const idx = norm.indexOf(marker)
  const rel = idx >= 0 ? norm.slice(idx + marker.length) : norm.replace(/^\/+/, '')
  const encoded = rel.split('/').map(encodeURIComponent).join('/')
  return `chatbook-media://media/${encoded}`
}

export default function App(): JSX.Element {
  const [conversations, setConversations] = useState<ConversationDTO[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<MessageDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<MessageFilter>({ keyword: '', senderRole: '', messageType: '' })
  const [contextAnchor, setContextAnchor] = useState<number | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [toast, setToast] = useState<{ text: string; path?: string } | null>(null)
  const [exporting, setExporting] = useState(false)
  
  // Phase 3: AI 增强功能状态
  const [activeTab, setActiveTab] = useState<'messages' | 'persona' | 'facts' | 'bookmarks' | 'suggestions'>('messages')
  const [persona, setPersona] = useState<any>(null)
  const [facts, setFacts] = useState<FactDTO[]>([])
  const [bookmarks, setBookmarks] = useState<any[]>([])
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  const [trends, setTrends] = useState<MonthlyTrend[] | null>(null)
  const [clipMonitor, setClipMonitor] = useState<ClipboardMonitorStatus | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [showLLMConfig, setShowLLMConfig] = useState(false)
  const activeIdRef = useRef<number | null>(null)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const refreshConversations = useCallback(async (): Promise<void> => {
    const list = await window.chatbook.listConversations()
    setConversations(list)
    setActiveId((prev) => (prev && list.some((c) => c.id === prev) ? prev : (list[0]?.id ?? null)))
  }, [])

  useEffect(() => {
    void refreshConversations()
  }, [refreshConversations])

  // 消息加载（筛选条件变化时防抖刷新）
  useEffect(() => {
    if (activeId == null) {
      setMessages([])
      return
    }
    if (contextAnchor != null) return // 上下文模式下不自动刷新
    setLoading(true)
    const timer = setTimeout(async () => {
      const list = await window.chatbook.listMessages(activeId, {
        ...filter,
        limit: 5000,
        recent: true // 浏览窗口取「最近 5000 条」，而非最早的 5000 条
      })
      setMessages(list)
      setLoading(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [activeId, filter, contextAnchor, refreshTick])

  // ---------- 剪贴板监听 ----------
  // 恢复持久化的监听状态（应用重启后自动继续监听）
  useEffect(() => {
    void (async () => {
      try {
        const saved = localStorage.getItem('chatbook.clipboard-monitor')
        const status =
          saved === 'on'
            ? await window.chatbook.startClipboardMonitor()
            : await window.chatbook.clipboardMonitorStatus()
        setClipMonitor(status)
      } catch {
        // 主进程未就绪时忽略，状态保持关闭
      }
    })()
  }, [])

  // 捕获推送：toast + 刷新侧边栏消息数 + 若正在看该会话则刷新列表
  useEffect(() => {
    return window.chatbook.onClipboardCaptured((c) => {
      setToast({
        text: `📋 捕获 ${c.inserted} 条新消息` + (c.skipped > 0 ? `（重复跳过 ${c.skipped}）` : '')
      })
      void refreshConversations()
      if (c.conversationId === activeIdRef.current) setRefreshTick((t) => t + 1)
    })
  }, [refreshConversations])

  const toggleClipboardMonitor = useCallback(async (): Promise<void> => {
    try {
      if (!clipMonitor?.active) {
        const s = await window.chatbook.startClipboardMonitor()
        setClipMonitor(s)
        localStorage.setItem('chatbook.clipboard-monitor', 'on')
        setToast({ text: '📋 监听已开启：在微信多选消息 Cmd+C，约 2 秒内自动入库' })
      } else {
        const s = await window.chatbook.stopClipboardMonitor()
        setClipMonitor(s)
        localStorage.setItem('chatbook.clipboard-monitor', 'off')
        setToast({ text: '📋 剪贴板监听已关闭' })
      }
    } catch (e) {
      setToast({ text: `操作失败：${(e as Error).message}` })
    }
  }, [clipMonitor])

  /** 诊断：测试当前剪贴板能否被识别并归属到会话 */
  const peekClipboard = useCallback(async (): Promise<void> => {
    const r = await window.chatbook.clipboardPeek()
    if (!r.text) {
      setToast({ text: '📋 剪贴板是空的：先在微信里多选消息 Cmd+C，再点测试' })
    } else if (r.messages > 0 && r.conversationTitle) {
      setToast({ text: `✅ 识别成功：${r.messages} 条消息 → 将导入「${r.conversationTitle}」` })
    } else if (r.messages > 0) {
      setToast({ text: `⚠️ 解析出 ${r.messages} 条，但未匹配到已知会话昵称，请检查发送者昵称` })
    } else {
      setToast({ text: `❌ 不是微信聊天格式（剪贴板开头：${r.text.slice(0, 40)}…）` })
    }
  }, [])

  const loadContext = useCallback(async (messageId: number): Promise<void> => {
    setContextAnchor(messageId)
    setLoading(true)
    const list = await window.chatbook.getMessageContext(messageId, 15, 15)
    setMessages(list)
    setLoading(false)
  }, [])

  const exitContext = useCallback((): void => {
    setContextAnchor(null)
  }, [])

  const handleExport = useCallback(
    async (kind: 'html' | 'markdown' | 'pdf', embed = false): Promise<void> => {
      if (activeId == null) return
      setExporting(true)
      try {
        let result: ExportResult
        if (kind === 'html') result = await window.chatbook.exportHtml(activeId, { embed })
        else if (kind === 'markdown') result = await window.chatbook.exportMarkdown(activeId)
        else result = await window.chatbook.exportPdf(activeId)
        if (!result.canceled && result.path) {
          setToast({ text: `导出成功：${result.path}`, path: result.path })
        }
      } catch (e) {
        setToast({ text: `导出失败：${(e as Error).message}` })
      } finally {
        setExporting(false)
      }
    },
    [activeId]
  )

  const handleDelete = useCallback(
    async (conv: ConversationDTO): Promise<void> => {
      if (!window.confirm(`确定彻底删除「${conv.title}」吗？\n将删除全部 ${conv.messageCount} 条消息及所有媒体文件，不可恢复。`)) return
      await window.chatbook.deleteConversation(conv.id)
      await refreshConversations()
      setToast({ text: `已删除「${conv.title}」及其全部本地数据` })
    },
    [refreshConversations]
  )

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(timer)
  }, [toast])

  // Phase 3: 加载 AI 数据
  // 各 loader 完成后校验会话未切换（activeIdRef），防止 A 会话的慢请求覆盖 B 会话的页面状态
  const loadPersona = useCallback(async () => {
    if (activeId == null) return
    const data = await window.chatbook.getPersona(activeId)
    if (activeIdRef.current === activeId) setPersona(data)
  }, [activeId])

  const loadBookmarks = useCallback(async () => {
    if (activeId == null) return
    const list = await window.chatbook.listBookmarks(activeId)
    if (activeIdRef.current === activeId) setBookmarks(list)
  }, [activeId])

  const loadSuggestions = useCallback(async () => {
    if (activeId == null) return
    const list = await window.chatbook.listSuggestions(activeId, 'pending')
    if (activeIdRef.current === activeId) setSuggestions(list)
  }, [activeId])

  const loadFacts = useCallback(async () => {
    if (activeId == null) return
    const list = await window.chatbook.listFacts(activeId)
    if (activeIdRef.current === activeId) setFacts(list)
  }, [activeId])

  const loadTrends = useCallback(async () => {
    if (activeId == null) {
      setTrends(null)
      return
    }
    const list = await window.chatbook.getTrendStats(activeId)
    if (activeIdRef.current === activeId) setTrends(list)
  }, [activeId])

  // 订阅分片分析进度推送（一次订阅，组件卸载时退订）
  useEffect(() => {
    const unsubscribe = window.chatbook.onAnalysisProgress((p) => setAnalysisProgress(p))
    return unsubscribe
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (activeId == null) return
    setAnalyzing(true)
    setAnalysisProgress(null)
    try {
      const result = await window.chatbook.analyzePersona(activeId)
      // 分析期间切换了会话：结果已写库，切回该会话时会自动加载，这里不覆盖当前页面
      if (activeIdRef.current !== activeId) return
      setPersona(result)
      await loadBookmarks()
      await loadSuggestions()
      await loadFacts()
      await loadTrends()
      setToast({
        text: result.factsFailed
          ? '分析完成，但重要信息提取失败（网络/Key 问题），已保留上次结果'
          : '✅ 分析完成：画像、建议、重要信息已更新'
      })
    } catch (e) {
      setToast({ text: `分析失败：${(e as Error).message}` })
    } finally {
      setAnalyzing(false)
      setAnalysisProgress(null)
    }
  }, [activeId, loadBookmarks, loadSuggestions, loadFacts, loadTrends])

  /** 定位到事实的聊天上下文：加载上下文并切到消息页 */
  const handleLocateFact = useCallback(
    (messageId: number) => {
      setActiveTab('messages')
      void loadContext(messageId)
    },
    [loadContext]
  )

  useEffect(() => {
    if (activeId != null) {
      void loadPersona()
      void loadBookmarks()
      void loadSuggestions()
      void loadFacts()
      void loadTrends()
    }
  }, [activeId, loadPersona, loadBookmarks, loadSuggestions, loadFacts, loadTrends])

  const active = conversations.find((c) => c.id === activeId) ?? null

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="logo">ChatBook</span>
          <span className="badge">本地 · 离线</span>
        </div>
        <button className="btn primary import-btn" onClick={() => setShowImport(true)}>
          ＋ 导入聊天记录
        </button>
        <div className="conv-list">
          {conversations.length === 0 && (
            <div className="empty-tip">
              还没有会话。
              <br />
              点击上方按钮，拖入你整理好的聊天数据开始。
            </div>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => {
                setActiveId(c.id)
                setContextAnchor(null)
                setFilter({ keyword: '', senderRole: '', messageType: '' })
              }}
            >
              <div className="conv-title">{c.title}</div>
              <div className="conv-sub">
                {c.messageCount} 条{c.lastTime ? ` · 至 ${c.lastTime.slice(0, 10)}` : ''}
              </div>
              <button
                className="icon-btn delete"
                title="彻底删除该会话及本地数据"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDelete(c)
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">数据保存在本机 ~/Documents/ChatBook</div>
      </aside>

      <main className="content">
        {/* Tab 导航 */}
        <div className="tab-nav">
          <button
            className={`tab-btn ${activeTab === 'messages' ? 'active' : ''}`}
            onClick={() => setActiveTab('messages')}
          >
            💬 聊天记录
          </button>
          <button
            className={`tab-btn ${activeTab === 'persona' ? 'active' : ''}`}
            onClick={() => setActiveTab('persona')}
          >
            🧠 人物画像
          </button>
          <button
            className={`tab-btn ${activeTab === 'facts' ? 'active' : ''}`}
            onClick={() => setActiveTab('facts')}
          >
            📌 重要信息
            {facts.length > 0 && <span className="badge">{facts.length}</span>}
          </button>
          <button
            className={`tab-btn ${activeTab === 'bookmarks' ? 'active' : ''}`}
            onClick={() => setActiveTab('bookmarks')}
          >
            📝 便签墙
            {bookmarks.length > 0 && <span className="badge">{bookmarks.length}</span>}
          </button>
          <button
            className={`tab-btn ${activeTab === 'suggestions' ? 'active' : ''}`}
            onClick={() => setActiveTab('suggestions')}
          >
            💡 建议
            {suggestions.length > 0 && <span className="badge">{suggestions.length}</span>}
          </button>
          <div className="spacer" />
          {analyzing && analysisProgress && (
            <div className="analysis-status" title="分片全量分析进行中">
              <span className="as-text">{stageText(analysisProgress)}</span>
              <div className="as-bar">
                <div
                  className="as-fill"
                  style={{
                    width: `${Math.round(
                      (analysisProgress.current / Math.max(1, analysisProgress.total)) * 100
                    )}%`
                  }}
                />
              </div>
            </div>
          )}
          <button
            className="btn primary"
            disabled={!active || analyzing}
            onClick={() => void handleAnalyze()}
          >
            {analyzing ? '分析中...' : '✨ 分析人物画像'}
          </button>
        </div>

        {/* Tab 内容 */}
        {activeTab === 'messages' && (
          <>
            <div className="toolbar">
              <input
                className="search"
                type="search"
                placeholder="搜索聊天内容…"
                value={filter.keyword ?? ''}
                onChange={(e) => {
                  setContextAnchor(null)
                  setFilter((f) => ({ ...f, keyword: e.target.value }))
                }}
              />
              <select
                value={filter.senderRole ?? ''}
                onChange={(e) => {
                  setContextAnchor(null)
                  setFilter((f) => ({ ...f, senderRole: e.target.value as MessageFilter['senderRole'] }))
                }}
              >
                <option value="">全部发送人</option>
                <option value="self">我</option>
                <option value="peer">对方</option>
              </select>
              <select
                value={filter.messageType ?? ''}
                onChange={(e) => {
                  setContextAnchor(null)
                  setFilter((f) => ({ ...f, messageType: e.target.value as MessageFilter['messageType'] }))
                }}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="spacer" />
              <button
                className={`btn${clipMonitor?.active ? ' monitor-on' : ''}`}
                onClick={() => void toggleClipboardMonitor()}
                title="开启后：在微信中多选消息 Cmd+C，自动识别入库到昵称匹配的会话；旁边 ? 可测试当前剪贴板"
              >
                {clipMonitor?.active ? '📋 监听中' : '📋 监听剪贴板'}
              </button>
              <button className="btn" onClick={() => void peekClipboard()} title="测试当前剪贴板内容能否被识别并归属到会话">
                ?
              </button>
              <button
                className="btn"
                onClick={() => setShowLLMConfig(true)}
                title="配置 AI 功能的 LLM API Key（DeepSeek / OpenAI 等），保存到 .env 并立即生效"
              >
                🔑 LLM
              </button>
              <button className="btn" disabled={!active || exporting} onClick={() => void handleExport('html')}>
                导出 HTML
              </button>
              <button
                className="btn"
                disabled={!active || exporting}
                onClick={() => void handleExport('html', true)}
                title="图片内嵌为单文件，适合长期归档"
              >
                导出单文件
              </button>
              <button className="btn" disabled={!active || exporting} onClick={() => void handleExport('markdown')}>
                Markdown
              </button>
              <button className="btn" disabled={!active || exporting} onClick={() => void handleExport('pdf')}>
                PDF
              </button>
            </div>

            {contextAnchor != null && (
              <div className="context-banner">
                正在显示该消息前后 15 条的上下文片段
                <button className="btn small" onClick={exitContext}>
                  返回完整记录
                </button>
              </div>
            )}

            {contextAnchor == null &&
              active != null &&
              active.messageCount > messages.length &&
              !filter.keyword &&
              !filter.senderRole &&
              !filter.messageType &&
              messages.length > 0 && (
                <div className="trunc-banner">
                  ⚠️ 为提高浏览性能，当前仅加载最近 {messages.length} 条消息（本会话共{' '}
                  {active.messageCount} 条）；搜索与导出不受影响，涵盖全部记录
                </div>
              )}

            <MessageList
              messages={messages}
              selfName={active?.selfName ?? undefined}
              conversationId={active?.id}
              bookmarkedIds={new Set(
                bookmarks.map((b) => b.messageId).filter((x): x is number => x != null)
              )}
              onBookmarked={() => void loadBookmarks()}
              loading={loading}
              keyword={filter.keyword ?? ''}
              onContext={loadContext}
              toFileUrl={toFileUrl}
            />
            {activeId != null && (
              // key 绑定会话：切换会话时面板整体重建，旧会话的回复草案不会残留到新会话
              <ReplyAssist key={activeId} conversationId={activeId} onToast={(text) => setToast({ text })} />
            )}
          </>
        )}

        {activeTab === 'persona' && <PersonaPanel persona={persona} trends={trends} />}

        {activeTab === 'facts' && (
          <FactPanel
            facts={facts}
            analyzing={analyzing}
            onAnalyze={() => void handleAnalyze()}
            onLocate={handleLocateFact}
          />
        )}

        {activeTab === 'bookmarks' && (
          <BookmarkWall
            conversationId={activeId ?? 0}
            bookmarks={bookmarks}
            onRefresh={() => void loadBookmarks()}
          />
        )}

        {activeTab === 'suggestions' && (
          <SuggestionList
            conversationId={activeId ?? 0}
            suggestions={suggestions}
            onRefresh={() => void loadSuggestions()}
          />
        )}
      </main>

      {showImport && (
        <ImportDialog
          conversations={conversations}
          onClose={() => setShowImport(false)}
          onImported={() => void refreshConversations()}
        />
      )}

      {showLLMConfig && (
        <LLMConfigDialog
          onClose={() => setShowLLMConfig(false)}
          onToast={(text) => setToast({ text })}
        />
      )}

      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          <div className="toast-text">{toast.text}</div>
          {toast.path && (
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation()
                void window.chatbook.showInFolder(toast.path as string)
              }}
            >
              在访达中显示
            </button>
          )}
        </div>
      )}
    </div>
  )
}
