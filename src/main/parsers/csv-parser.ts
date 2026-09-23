/**
 * csv 解析器（Excel 友好）
 *
 * 首行为表头，字段名支持中英文别名：
 *
 *   时间,发送者,类型,内容,附件
 *   2026-09-20 21:30:15,张三,文本,你好,
 *   2026-09-20 21:31:00,我,图片,,media/IMG_001.jpg
 */
import { classifyMediaByExt, normalizeMessageType } from './common'
import { formatTimestamp, parseDateTime } from './datetime'
import type { ChatParser, ParseContext, ParseResult, ParsedMessage } from './types'

const COL_ALIASES: Record<string, string[]> = {
  time: ['time', 'timestamp', 'datetime', '时间', '日期时间', '日期'],
  sender: ['sender', 'from', 'name', 'nick', 'nickname', '发送者', '发言人', '昵称'],
  type: ['type', 'message_type', 'msg_type', '类型', '消息类型'],
  content: ['content', 'text', 'message', '内容', '消息', '正文'],
  file: ['file', 'file_path', 'attachment', 'media', '附件', '文件', '图片']
}

/** 手写 CSV 行拆分：支持双引号包裹与 "" 转义 */
function splitCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (c !== '\r') {
      cell += c
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function buildHeaderMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {}
  header.forEach((name, idx) => {
    const key = name.trim().toLowerCase()
    for (const [canonical, aliases] of Object.entries(COL_ALIASES)) {
      if (aliases.includes(key) && map[canonical] === undefined) {
        map[canonical] = idx
      }
    }
  })
  return map
}

export const csvParser: ChatParser = {
  id: 'csv',
  name: 'CSV 格式',
  extensions: ['.csv'],

  canParse(ctx: ParseContext): boolean {
    const firstLine = ctx.content.split(/\r?\n/, 1)[0] ?? ''
    if (!firstLine.includes(',')) return false
    const cols = splitCsv(firstLine)[0] ?? []
    const map = buildHeaderMap(cols)
    return map.time !== undefined && (map.sender !== undefined || map.content !== undefined)
  },

  parse(ctx: ParseContext): ParseResult {
    const warnings: string[] = []
    const rows = splitCsv(ctx.content)
    if (rows.length < 2) return { messages: [], warnings: ['CSV 行数不足'] }

    const map = buildHeaderMap(rows[0])
    if (map.time === undefined) return { messages: [], warnings: ['CSV 表头缺少时间列'] }

    const get = (row: string[], canonical: string): string => {
      const idx = map[canonical]
      return idx === undefined ? '' : (row[idx] ?? '').trim()
    }

    const messages: ParsedMessage[] = []
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (row.every((c) => c.trim() === '')) continue

      const dt = parseDateTime(get(row, 'time'))
      if (!dt) {
        warnings.push(`第 ${i + 1} 行时间无法解析：${get(row, 'time')}`)
        continue
      }
      const sender = get(row, 'sender') || '未知'
      const messageType = normalizeMessageType(get(row, 'type'))
      const content = get(row, 'content')
      const file = get(row, 'file')

      const attachments = file
        ? [{ type: classifyMediaByExt(file.slice(file.lastIndexOf('.'))), sourcePath: file }]
        : []

      messages.push({
        sender,
        messageType: attachments.length > 0 && messageType === 'text' ? 'image' : messageType,
        content,
        timestamp: formatTimestamp(dt),
        attachments
      })
    }

    if (messages.length === 0) warnings.push('未解析到有效消息')
    return { messages, warnings }
  }
}
