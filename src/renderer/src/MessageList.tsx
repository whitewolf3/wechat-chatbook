import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { MessageDTO } from '../../shared/types'
import { formatDateLabel } from './date-utils'

const TYPE_LABEL: Record<string, string> = {
  image: '图片',
  sticker: '表情',
  voice: '语音',
  video: '视频',
  file: '文件',
  location: '位置',
  quote: '聊天记录',
  link: '链接',
  system: '系统消息',
  unknown: '其他'
}

/** 有媒体属性但未关联到文件时的占位图标 */
const MEDIA_ICON: Record<string, string> = {
  image: '📷',
  sticker: '😀',
  video: '🎬',
  voice: '🎤',
  file: '📄'
}

const MEDIA_TYPES = new Set(Object.keys(MEDIA_ICON))

interface Props {
  messages: MessageDTO[]
  selfName?: string
  conversationId?: number
  bookmarkedIds?: Set<number>
  onBookmarked?: () => void
  loading: boolean
  keyword: string
  onContext: (messageId: number) => void
  toFileUrl: (p: string) => string
}

/** 虚拟列表行：日期分隔行或消息行 */
type Row =
  | { kind: 'day'; day: string; key: string }
  | { kind: 'msg'; m: MessageDTO; key: string }

function renderText(text: string, keyword: string): JSX.Element {
  if (!keyword.trim()) return <>{text}</>
  const k = keyword.trim().toLowerCase()
  const low = text.toLowerCase()
  const parts: JSX.Element[] = []
  let last = 0
  let i = low.indexOf(k)
  let key = 0
  while (i >= 0) {
    if (i > last) parts.push(<span key={key++}>{text.slice(last, i)}</span>)
    parts.push(<mark key={key++}>{text.slice(i, i + k.length)}</mark>)
    last = i + k.length
    i = low.indexOf(k, last)
  }
  parts.push(<span key={key++}>{text.slice(last)}</span>)
  return <>{parts}</>
}

/** 去掉内容里已带的 [图片] 等占位前缀 */
function stripPlaceholder(content: string): string {
  return content.replace(/^\[[^[\]]{1,10}\]\s*/, '')
}

export default function MessageList(props: Props): JSX.Element {
  const { messages, loading, keyword, onContext, toFileUrl } = props
  const [lightbox, setLightbox] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 打平为「日期分隔行 + 消息行」序列，供虚拟列表使用
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    let lastDay = ''
    for (const m of messages) {
      const day = m.timestamp.slice(0, 10)
      if (day !== lastDay) {
        out.push({ kind: 'day', day, key: `day-${day}` })
        lastDay = day
      }
      out.push({ kind: 'msg', m, key: `m-${m.id}` })
    }
    return out
  }, [messages])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // 日期行约 56px，普通消息行约 76px；实际高度由 measureElement 动态校正
    estimateSize: (i) => (rows[i].kind === 'day' ? 56 : 76),
    overscan: 12,
    getItemKey: (i) => rows[i].key
  })

  // 消息更新后滚动到底部（聊天视图习惯）
  useEffect(() => {
    if (rows.length === 0) return
    const raf = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  if (loading) return <div className="msg-page-hint">加载中…</div>
  if (messages.length === 0) {
    return (
      <div className="msg-page-hint">
        暂无消息。点击左侧「导入聊天记录」，支持 txt / json / csv / html 与媒体文件夹。
      </div>
    )
  }

  return (
    <div className="chat-view" ref={scrollRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`
              }}
            >
              {row.kind === 'day' ? (
                <div className="date-header">
                  <span>{formatDateLabel(row.day)}</span>
                </div>
              ) : (
                <MessageRow
                  m={row.m}
                  keyword={keyword}
                  onContext={onContext}
                  toFileUrl={toFileUrl}
                  onZoom={setLightbox}
                  conversationId={props.conversationId}
                  bookmarkedIds={props.bookmarkedIds}
                  onBookmarked={props.onBookmarked}
                />
              )}
            </div>
          )
        })}
      </div>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={toFileUrl(lightbox)} alt="原图" />
        </div>
      )}
    </div>
  )
}

function MessageRow(props: {
  m: MessageDTO
  keyword: string
  onContext: (messageId: number) => void
  toFileUrl: (p: string) => string
  onZoom: (absPath: string) => void
  conversationId?: number
  bookmarkedIds?: Set<number>
  onBookmarked?: () => void
}): JSX.Element {
  const { m, keyword, onContext, toFileUrl, onZoom, conversationId, bookmarkedIds, onBookmarked } = props
  const [justAdded, setJustAdded] = useState(false)
  const att = m.attachments[0]
  const mediaUrl = m.absPath || att?.absPath
  const isGif = att?.type === 'gif' || (mediaUrl ?? '').toLowerCase().endsWith('.gif')
  const isImg = m.messageType === 'image' || m.messageType === 'sticker'
  const showImg = isImg && mediaUrl
  const isText = m.messageType === 'text' || m.messageType === 'emoji'
  const isMediaMissing = MEDIA_TYPES.has(m.messageType) && !mediaUrl
  const stripped = stripPlaceholder(m.content ?? '')
  const fileName = stripped || null
  const who = m.sender || (m.senderRole === 'self' ? '我' : '对方')
  const time = m.timestamp.slice(11, 16)
  const isBookmarked = justAdded || (bookmarkedIds?.has(m.id) ?? false)

  const handleBookmark = async (): Promise<void> => {
    if (isBookmarked || conversationId == null) return
    await window.chatbook.addBookmark({
      messageId: m.id,
      conversationId,
      category: 'general',
      content: m.content ?? undefined
    })
    setJustAdded(true)
    onBookmarked?.()
  }

  return (
    <div className={`msg-row ${m.senderRole}`}>
      <div className="avatar">{(who[0] ?? '?').toUpperCase()}</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span>{who}</span>
          <span>{time}</span>
          <button
            className={`icon-btn ctx bm ${isBookmarked ? 'on' : ''}`}
            title={isBookmarked ? '已加入便签墙' : '加入便签墙'}
            onClick={() => void handleBookmark()}
            disabled={isBookmarked}
          >
            🔖
          </button>
          <button className="icon-btn ctx" title="查看上下文" onClick={() => onContext(m.id)}>
            上下文
          </button>
        </div>
        <div className={`bubble ${m.messageType === 'sticker' ? 'sticker' : ''}`}>
          {showImg ? (
            <img
              src={toFileUrl(mediaUrl as string)}
              alt={TYPE_LABEL[m.messageType] ?? '图片'}
              loading="lazy"
              onClick={() => onZoom(mediaUrl as string)}
            />
          ) : isText ? (
            <div className="bubble-text">{renderText(m.content ?? '', keyword)}</div>
          ) : isMediaMissing ? (
            <div className="media-missing" title={m.content ?? ''}>
              <span className="mm-icon">{MEDIA_ICON[m.messageType]}</span>
              <div className="mm-body">
                <div className="mm-title">{TYPE_LABEL[m.messageType]}文件未导出</div>
                {fileName ? <div className="mm-name">{fileName}</div> : null}
              </div>
            </div>
          ) : (
            <div className="chip">
              [{TYPE_LABEL[m.messageType] ?? '消息'}]
              {stripped ? <span className="chip-text">{stripped}</span> : null}
            </div>
          )}
          {isGif && showImg ? <div className="gif-tip">GIF 动图</div> : null}
        </div>
      </div>
    </div>
  )
}
