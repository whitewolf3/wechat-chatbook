/**
 * 结构化 txt 解析器
 *
 * 支持「时间/发送者/内容」标签式格式，标签与值可分行或同行：
 *
 *   时间：
 *   2026-09-20 21:30:15
 *
 *   发送者：
 *   好友昵称
 *
 *   内容：
 *   你好，最近怎么样
 *
 * 内容支持多行，直到出现下一个「时间」标签。
 */
import { detectPlaceholderType } from './common'
import { formatTimestamp, parseDateTime } from './datetime'
import type { ChatParser, ParseContext, ParseResult, ParsedMessage } from './types'

interface PartialMessage {
  time?: Date
  sender?: string
  contentLines: string[]
}

const RE_TIME = /^时间\s*[:：]\s*(.*)$/
const RE_SENDER = /^发送者\s*[:：]\s*(.*)$/
const RE_CONTENT = /^内容\s*[:：]\s*(.*)$/

export const structuredTxtParser: ChatParser = {
  id: 'structured-txt',
  name: '结构化文本（时间/发送者/内容）',
  extensions: ['.txt', '.text'],

  canParse(ctx: ParseContext): boolean {
    return /^\s*时间\s*[:：]/m.test(ctx.content) && /^\s*发送者\s*[:：]/m.test(ctx.content)
  },

  parse(ctx: ParseContext): ParseResult {
    const messages: ParsedMessage[] = []
    const warnings: string[] = []
    const lines = ctx.content.split(/\r?\n/)

    let cur: PartialMessage | null = null
    let expect: 'time' | 'sender' | null = null

    const flush = (): void => {
      if (!cur) return
      const content = cur.contentLines.join('\n').trim()
      if (cur.time && cur.sender !== undefined) {
        const type = detectPlaceholderType(content)
        messages.push({
          sender: cur.sender.trim(),
          messageType: type ?? 'text',
          content,
          timestamp: formatTimestamp(cur.time),
          attachments: []
        })
      } else if (cur.time || content || cur.sender !== undefined) {
        warnings.push(`跳过一条不完整的消息（缺少${cur.time ? '发送者' : '时间'}）：${content.slice(0, 30)}`)
      }
      cur = null
      expect = null
    }

    for (const raw of lines) {
      const line = raw.trim()

      const mTime = RE_TIME.exec(line)
      if (mTime) {
        flush()
        cur = { contentLines: [] }
        const rest = mTime[1].trim()
        if (rest) {
          const d = parseDateTime(rest)
          if (d) cur.time = d
          else warnings.push(`无法解析时间：${rest}`)
        } else {
          expect = 'time'
        }
        continue
      }

      const mSender = RE_SENDER.exec(line)
      if (mSender && cur) {
        const rest = mSender[1].trim()
        if (rest) cur.sender = rest
        else expect = 'sender'
        continue
      }

      const mContent = RE_CONTENT.exec(line)
      if (mContent && cur) {
        const rest = mContent[1]
        if (rest) cur.contentLines.push(rest)
        continue
      }

      if (!cur) continue // 首个「时间」标签之前的内容忽略

      if (expect === 'time' && line) {
        const d = parseDateTime(line)
        if (d) cur.time = d
        else warnings.push(`无法解析时间：${line}`)
        expect = null
        continue
      }
      if (expect === 'sender' && line) {
        cur.sender = line
        expect = null
        continue
      }
      // 其余行都属于「内容」（保留内部空行结构，trim 尾部空行由 flush 处理）
      cur.contentLines.push(raw)
    }
    flush()

    if (messages.length === 0) warnings.push('未解析到任何消息，请检查格式是否符合「时间/发送者/内容」模板')
    return { messages, warnings }
  }
}
