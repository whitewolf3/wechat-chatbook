/**
 * 微信导出格式解析器（发送者-时间-内容分行）
 *
 * 格式示例：
 *   阿白
 *   2026年07月03日 20:22
 *   周末有空吗？
 *
 *   小雨
 *   2026年07月03日 20:23
 *   周六要加班，周日下午可以
 *
 * 特点：
 * - 发送者独占一行（无时间）
 * - 时间在下一行（格式：YYYY年MM月DD日 HH:mm）
 * - 内容在时间之后（可多行）
 * - 空行分隔消息
 */
import { detectPlaceholderType } from './common'
import { formatTimestamp, parseDateTime } from './datetime'
import type { ChatParser, ParseContext, ParseResult, ParsedMessage } from './types'

const DATE_RE = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/

function parseChineseDate(s: string): Date | null {
  const m = DATE_RE.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), se ? Number(se) : 0)
  return isNaN(dt.getTime()) ? null : dt
}

/** 检查一行是否像发送者名（非日期、非空、长度合理） */
function looksLikeSender(line: string): boolean {
  if (!line || line.length > 30) return false
  if (DATE_RE.test(line)) return false
  if (/^\d+$/.test(line)) return false
  return true
}

export const wechatExportParser: ChatParser = {
  id: 'wechat-export',
  name: '微信导出格式（发送者/时间/内容分行）',
  extensions: ['.txt', '.text'],

  canParse(ctx: ParseContext): boolean {
    const lines = ctx.content.split(/\r?\n/)
    // 至少找到 2 个「发送者行 + 日期行」的组合
    let matches = 0
    for (let i = 0; i < lines.length - 1; i++) {
      if (looksLikeSender(lines[i]) && parseChineseDate(lines[i + 1])) {
        matches++
        if (matches >= 2) return true
      }
    }
    return false
  },

  parse(ctx: ParseContext): ParseResult {
    const messages: ParsedMessage[] = []
    const warnings: string[] = []
    const lines = ctx.content.split(/\r?\n/)

    let i = 0
    while (i < lines.length) {
      // 跳过空行
      if (!lines[i].trim()) {
        i++
        continue
      }

      // 尝试匹配：发送者 + 日期
      const senderLine = lines[i].trim()
      if (!looksLikeSender(senderLine)) {
        i++
        continue
      }

      const dateLine = lines[i + 1]?.trim()
      if (!dateLine) {
        i++
        continue
      }
      const dt = parseChineseDate(dateLine)
      if (!dt) {
        i++
        continue
      }

      // 收集内容行（直到空行或下一个发送者+日期组合）
      const contentLines: string[] = []
      i += 2 // 跳过发送者和日期
      while (i < lines.length) {
        const line = lines[i]
        if (!line.trim()) break // 空行结束

        // 检查是否是下一条消息的开始（发送者+日期）
        if (
          i + 1 < lines.length &&
          looksLikeSender(line.trim()) &&
          parseChineseDate(lines[i + 1].trim())
        ) {
          break
        }

        contentLines.push(line)
        i++
      }

      const content = contentLines.join('\n').trim()
      if (content) {
        const type = detectPlaceholderType(content)
        messages.push({
          sender: senderLine,
          messageType: type ?? 'text',
          content,
          timestamp: formatTimestamp(dt),
          attachments: []
        })
      }
    }

    if (messages.length === 0) {
      warnings.push('未解析到任何消息，请检查格式是否为「发送者/时间/内容」分行格式')
    }
    return { messages, warnings }
  }
}
