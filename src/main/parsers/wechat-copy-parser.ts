/**
 * 微信复制格式 txt 解析器
 *
 * 微信 PC/Mac 端多选消息后「复制」得到的格式：
 *
 *   张三 2026-09-20 21:30:15
 *   你好，最近怎么样
 *
 *   我 2026-09-20 21:30:40
 *   还不错，你呢？
 *
 * 行头 = 「昵称 + 日期 时间」，其后非空行拼接为消息内容（支持多行）。
 * 兼容 [图片] [动画表情] [语音] 等占位符。
 */
import { detectPlaceholderType } from './common'
import { formatTimestamp, parseDateTime } from './datetime'
import type { ChatParser, ParseContext, ParseResult, ParsedMessage } from './types'

const HEADER =
  /^(.{1,40}?)\s+(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[\sT]+\d{1,2}:\d{2}(?::\d{2})?)\s*$/

/** 统计内容中疑似「昵称 日期 时间」行头的数量，用于嗅探 */
function countHeaders(content: string): number {
  let n = 0
  for (const line of content.split(/\r?\n/)) {
    const m = HEADER.exec(line.trim())
    if (m && parseDateTime(m[2])) n++
  }
  return n
}

export const wechatCopyParser: ChatParser = {
  id: 'wechat-copy',
  name: '微信复制格式',
  extensions: ['.txt', '.text'],

  canParse(ctx: ParseContext): boolean {
    return countHeaders(ctx.content) >= 2
  },

  parse(ctx: ParseContext): ParseResult {
    const messages: ParsedMessage[] = []
    const warnings: string[] = []
    const lines = ctx.content.split(/\r?\n/)

    let cur: { sender: string; time: Date; contentLines: string[] } | null = null
    const flush = (): void => {
      if (!cur) return
      const content = cur.contentLines.join('\n').trim()
      const type = detectPlaceholderType(content)
      messages.push({
        sender: cur.sender.trim(),
        messageType: type ?? 'text',
        content,
        timestamp: formatTimestamp(cur.time),
        attachments: []
      })
      cur = null
    }

    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue // 空行是消息分隔，不进入内容

      const m = HEADER.exec(line)
      if (m) {
        const d = parseDateTime(m[2])
        if (d) {
          flush()
          cur = { sender: m[1], time: d, contentLines: [] }
          continue
        }
      }
      if (cur) cur.contentLines.push(line)
      else warnings.push(`忽略消息头之前的行：${line.slice(0, 30)}`)
    }
    flush()

    if (messages.length === 0) warnings.push('未解析到任何消息')
    return { messages, warnings }
  }
}
