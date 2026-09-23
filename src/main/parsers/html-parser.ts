/**
 * html 解析器：支持解析本工具导出的 HTML（导出→再导入闭环）
 *
 * 依赖导出器为每条消息生成的结构化属性：
 *   <div class="msg" data-ts="..." data-sender="..." data-role="..."
 *        data-type="..." data-text="..." data-src="assets/xxx.jpg">
 */
import { classifyMediaByExt } from './common'
import { formatTimestamp, parseDateTime } from './datetime'
import type { ChatParser, ParseContext, ParseResult, ParsedMessage } from './types'

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export const htmlParser: ChatParser = {
  id: 'html',
  name: 'HTML（本工具导出格式）',
  extensions: ['.html', '.htm'],

  canParse(ctx: ParseContext): boolean {
    return /<div[^>]+data-ts=/.test(ctx.content)
  },

  parse(ctx: ParseContext): ParseResult {
    const warnings: string[] = []
    const messages: ParsedMessage[] = []

    // 提取标题
    const titleMatch = /<title>([^<]*)<\/title>/.exec(ctx.content)
    const meta = titleMatch ? { title: titleMatch[1] } : undefined

    const tagRe = /<div[^>]*class="msg[^"]*"[^>]*>/g
    const opens: Array<{ attrs: string; contentStart: number }> = []
    let m: RegExpExecArray | null
    while ((m = tagRe.exec(ctx.content)) !== null) {
      opens.push({ attrs: m[0], contentStart: m.index + m[0].length })
    }

    for (let i = 0; i < opens.length; i++) {
      const attrs: Record<string, string> = {}
      const attrRe = /data-([\w-]+)="([^"]*)"/g
      let a: RegExpExecArray | null
      while ((a = attrRe.exec(opens[i].attrs)) !== null) {
        attrs[a[1]] = unescapeHtml(a[2])
      }

      const dt = parseDateTime(attrs['ts'] ?? '')
      if (!dt) {
        warnings.push(`跳过一条时间无法解析的消息：${attrs['ts'] ?? '(空)'}`)
        continue
      }

      const messageType = (attrs['type'] || 'text') as ParsedMessage['messageType']
      const attachments = []
      if (attrs['src']) {
        const ext = attrs['src'].slice(attrs['src'].lastIndexOf('.'))
        attachments.push({ type: classifyMediaByExt(ext), sourcePath: attrs['src'] })
      }

      messages.push({
        sender: attrs['sender'] || '未知',
        senderRole: (attrs['role'] as 'self' | 'peer' | 'unknown') || 'unknown',
        messageType,
        content: attrs['text'] ?? '',
        timestamp: formatTimestamp(dt),
        attachments
      })
    }

    if (messages.length === 0) warnings.push('HTML 中未找到带 data-ts 属性的消息节点')
    return { messages, warnings, meta }
  }
}
