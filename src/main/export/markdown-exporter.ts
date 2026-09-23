/**
 * Markdown 导出器
 * 目录结构：聊天记录-<标题>.md + assets/
 */
import fs from 'node:fs'
import path from 'node:path'
import type { MessageDTO } from '../../shared/types'
import { getDb, resolveMediaPath } from '../library'
import { formatDateLabel } from '../parsers/datetime'

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

function sanitizeFileName(name: string): string {
  return name.replace(/[\s\\/:*?"<>|]+/g, '-').slice(0, 80) || '聊天记录'
}

/** 解析消息全部可展示媒体（附件全量；无附件时回退 file_path） */
function resolveAllMediaPaths(m: MessageDTO): string[] {
  const rels = m.attachments.length
    ? m.attachments.map((a) => a.path)
    : m.filePath
      ? [m.filePath]
      : []
  const out: string[] = []
  for (const rel of rels) {
    const abs = resolveMediaPath(m.conversationId, rel)
    if (fs.existsSync(abs)) out.push(abs)
  }
  return out
}

const INLINE_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.heic', '.gif']

export async function exportConversationMarkdown(
  conversationId: number,
  outDir: string
): Promise<string> {
  const db = getDb()
  const conv = db.getConversation(conversationId)
  if (!conv) throw new Error(`会话不存在：${conversationId}`)
  const messages = db.listMessages(conversationId, { limit: 100_000_000 })

  fs.mkdirSync(outDir, { recursive: true })
  const assetsDir = path.join(outDir, 'assets')
  if (messages.some((m) => resolveAllMediaPaths(m).length > 0)) fs.mkdirSync(assetsDir, { recursive: true })

  const lines: string[] = []
  lines.push(`# ${conv.title}聊天记录`)
  lines.push('')
  lines.push(
    `> 共 ${conv.messageCount} 条消息 · ${conv.firstTime ?? ''} ~ ${conv.lastTime ?? ''} · 由 ChatBook 在本机离线生成`
  )
  lines.push('')

  let currentDay = ''
  for (const m of messages) {
    const day = m.timestamp.slice(0, 10)
    if (day !== currentDay) {
      currentDay = day
      lines.push(`## ${formatDateLabel(day)}`)
      lines.push('')
    }

    const time = m.timestamp.slice(11, 16)
    const who = m.sender || (m.senderRole === 'self' ? '我' : '对方')
    lines.push(`### ${time} · ${who}`)
    lines.push('')

    // 全部附件逐一导出：图片内联展示，音视频/文件输出链接
    const mediaAbsList = resolveAllMediaPaths(m)
    for (const [idx, mediaAbs] of mediaAbsList.entries()) {
      const name = `${m.messageType}-${m.id}-${idx}${path.extname(mediaAbs).toLowerCase()}`
      fs.copyFileSync(mediaAbs, path.join(assetsDir, name))
      const label = TYPE_LABEL[m.messageType] ?? '附件'
      if (INLINE_IMAGE_EXTS.includes(path.extname(mediaAbs).toLowerCase())) {
        lines.push(`![${label}](assets/${name})`)
      } else {
        lines.push(`[${label}](${encodeURI(`assets/${name}`)})`)
      }
      lines.push('')
    }
    if (m.content && m.content.trim()) {
      lines.push(m.content)
      lines.push('')
    } else if (mediaAbsList.length === 0 && m.messageType !== 'text') {
      lines.push(`[${TYPE_LABEL[m.messageType] ?? '消息'}]`)
      lines.push('')
    }
  }

  const outPath = path.join(outDir, `聊天记录-${sanitizeFileName(conv.title)}.md`)
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8')
  return outPath
}
