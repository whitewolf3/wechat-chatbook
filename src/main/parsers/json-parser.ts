/**
 * json 解析器（推荐的完整格式）
 *
 * {
 *   "conversation": { "title": "我和张三", "self": "我", "peer": "张三" },
 *   "messages": [
 *     { "time": "2026-09-20 21:30:15", "sender": "张三", "type": "text", "content": "你好" },
 *     { "time": "2026-09-20 21:31:00", "sender": "我", "type": "image", "file": "media/IMG_001.jpg" }
 *   ]
 * }
 *
 * 也接受纯消息数组。字段名支持中英文别名；file 路径相对于 json 文件所在目录。
 */
import { classifyMediaByExt, normalizeMessageType } from './common'
import { formatTimestamp, parseDateTime } from './datetime'
import type { ChatParser, ParseContext, ParseResult, ParsedMessage } from './types'

function firstField(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  }
  return undefined
}

function toStringArray(v: unknown): string[] {
  if (v === undefined || v === null) return []
  if (Array.isArray(v)) return v.map(String)
  return [String(v)]
}

export const jsonParser: ChatParser = {
  id: 'json',
  name: 'JSON 格式',
  extensions: ['.json'],

  canParse(ctx: ParseContext): boolean {
    const s = ctx.content.trim()
    if (!s.startsWith('{') && !s.startsWith('[')) return false
    try {
      JSON.parse(s)
      return true
    } catch {
      return false
    }
  },

  parse(ctx: ParseContext): ParseResult {
    const warnings: string[] = []
    let data: unknown
    try {
      data = JSON.parse(ctx.content)
    } catch (e) {
      return { messages: [], warnings: [`JSON 解析失败：${(e as Error).message}`] }
    }

    let meta: ParseResult['meta']
    let rawMessages: unknown[]
    if (Array.isArray(data)) {
      rawMessages = data
    } else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      const conv = (obj['conversation'] ?? obj['会话']) as Record<string, unknown> | undefined
      if (conv) {
        meta = {
          title: conv['title'] !== undefined ? String(conv['title']) : undefined,
          selfName: firstField(conv, ['self', 'selfName', '我', 'self_name']) as string | undefined,
          peerName: firstField(conv, ['peer', 'peerName', '对方', 'peer_name']) as string | undefined
        }
      }
      const msgs = obj['messages'] ?? obj['消息'] ?? obj['data']
      if (!Array.isArray(msgs)) {
        return { messages: [], warnings: ['JSON 中未找到 messages 数组'] }
      }
      rawMessages = msgs
    } else {
      return { messages: [], warnings: ['JSON 顶层既不是数组也不是对象'] }
    }

    const messages: ParsedMessage[] = []
    for (const item of rawMessages) {
      if (!item || typeof item !== 'object') continue
      const m = item as Record<string, unknown>

      const timeRaw = firstField(m, ['time', 'timestamp', 'datetime', '时间', '日期时间', 'date'])
      const dt = parseDateTime(String(timeRaw ?? ''))
      if (!dt) {
        warnings.push(`跳过一条时间无法解析的消息：${JSON.stringify(item).slice(0, 60)}`)
        continue
      }

      const sender = String(firstField(m, ['sender', 'from', 'nick', 'nickname', 'name', '发送者', '发言人', '昵称']) ?? '未知')
      const typeRaw = firstField(m, ['type', 'message_type', 'msg_type', '类型', '消息类型'])
      const messageType = normalizeMessageType(typeRaw)
      const content = String(firstField(m, ['content', 'text', 'message', '内容', '正文', 'msg']) ?? '')

      const attachments = toStringArray(firstField(m, ['file', 'file_path', 'attachment', 'media', '附件', '文件', '图片']))
        .filter((p) => p && p.length > 0)
        .map((p) => {
          const dot = p.lastIndexOf('.')
          const ext = dot >= 0 ? p.slice(dot) : ''
          return { type: classifyMediaByExt(ext), sourcePath: p }
        })

      messages.push({
        sender,
        messageType: attachments.length > 0 && messageType === 'text' ? 'image' : messageType,
        content,
        timestamp: formatTimestamp(dt),
        attachments
      })
    }

    if (messages.length === 0) warnings.push('未解析到有效消息')
    return { messages, warnings, meta }
  }
}
