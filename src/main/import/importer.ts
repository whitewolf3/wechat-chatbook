/**
 * 导入编排：解析数据文件 + 收集媒体 → 拷贝入媒体库 → 指纹去重入库 → 自动关联
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ImportOptionsDto, ImportProgress, ImportResult, SenderRole } from '../../shared/types'
import { getDb, mediaDirFor } from '../library'
import { messageFingerprint } from '../db/database'
import { classifyMediaByExt } from '../parsers/common'
import { findParserLoose } from '../parsers/registry'
import type { ParseResult, ParsedMessage } from '../parsers/types'

const MEDIA_EXTS = [
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.heic', '.gif',
  '.mp4', '.mov', '.m4v', '.avi',
  '.m4a', '.mp3', '.wav', '.aac',
  '.pdf', '.zip', '.doc', '.docx', '.xls', '.xlsx'
]

/** 递归收集媒体文件 */
function walkMedia(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkMedia(full, out)
    else if (MEDIA_EXTS.includes(path.extname(e.name).toLowerCase())) out.push(full)
  }
}

/**
 * 拷贝媒体到会话媒体目录（幂等）。同名文件的判定用内容哈希：
 * 同名同哈希 → 同一文件跳过；同名不同内容（无论大小是否相同）→ 加后缀另存，
 * 避免「同名同大小但内容不同」的不同附件被错当成同一文件复用。
 * @returns 相对媒体目录的文件名
 */
export function importMediaFile(src: string, mediaDir: string): string {
  const name = path.basename(src)
  const target = path.join(mediaDir, name)
  const hash = (f: string): string => createHash('sha1').update(fs.readFileSync(f)).digest('hex')

  if (fs.existsSync(target)) {
    if (hash(target) === hash(src)) return name
    // 同名不同内容：加源文件大小后缀
    const ext = path.extname(name)
    const srcSize = fs.statSync(src).size
    const alt = `${path.basename(name, ext)}_${srcSize}${ext}`
    const altTarget = path.join(mediaDir, alt)
    if (!fs.existsSync(altTarget)) {
      fs.copyFileSync(src, altTarget)
    } else if (hash(altTarget) !== hash(src)) {
      // 后缀名也被占了（源目录变化重导等罕见场景）：再退一级
      const alt2 = `${path.basename(name, ext)}_${srcSize}_2${ext}`
      const alt2Target = path.join(mediaDir, alt2)
      if (!fs.existsSync(alt2Target)) fs.copyFileSync(src, alt2Target)
      return alt2
    }
    return alt
  }
  fs.copyFileSync(src, target)
  return name
}

/** 从文件名推断拍摄时间：2026-09-20_213015 / 20260920213015 / IMG_xxx / mmexport<13位毫秒> */
export function inferTakenAt(fileName: string): string | null {
  const name = path.basename(fileName)

  // mmexport1695220215000.jpg 等微信另存命名（13 位毫秒时间戳）
  // 要求 13 位数字前后不是其他数字（避免误匹配 yyyyMMddHHmmss 的前 13 位）
  const epoch = /(?:^|[^\d])(\d{13})(?:[^\d]|$)/.exec(name)
  if (epoch) {
    const d = new Date(Number(epoch[1]))
    if (!isNaN(d.getTime())) return formatLocal(d)
  }

  const m =
    /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[-_ T]?(\d{2})[-_.]?(\d{2})(?:[-_.]?(\d{2}))?/.exec(name)
  if (m) {
    const d = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : 0
    )
    if (!isNaN(d.getTime())) return formatLocal(d)
  }
  return null
}

function formatLocal(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function decideRole(sender: string, selfName?: string, peerName?: string): SenderRole {
  if (selfName && sender === selfName) return 'self'
  if (peerName && sender === peerName) return 'peer'
  return 'unknown'
}

export async function runImport(
  opts: ImportOptionsDto,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportResult> {
  const db = getDb()
  const warnings: string[] = []
  let inserted = 0
  let skipped = 0

  // ---------- 会话 ----------
  onProgress?.({ stage: 'prepare', detail: '准备会话…' })
  const convId =
    opts.conversationId ??
    db.createConversation({
      title: opts.title?.trim() || '未命名会话',
      selfName: opts.selfName?.trim() || undefined,
      peerName: opts.peerName?.trim() || undefined
    })
  // 增量导入（已有会话）未填昵称时，用会话已存昵称兜底判定角色，
  // 否则 decideRole 收到 undefined 会把所有消息标成 unknown
  let roleSelf = opts.selfName?.trim()
  let rolePeer = opts.peerName?.trim()
  if (opts.conversationId != null && (!roleSelf || !rolePeer)) {
    const conv = db.getConversation(opts.conversationId)
    if (conv) {
      roleSelf = roleSelf || conv.selfName || undefined
      rolePeer = rolePeer || conv.peerName || undefined
    }
  }
  const mediaDir = mediaDirFor(convId)

  // ---------- 媒体文件夹 / 媒体文件 ----------
  const mediaSources: string[] = []
  for (const dir of opts.mediaDirs ?? []) walkMedia(dir, mediaSources)
  for (const f of opts.mediaFiles ?? []) {
    if (fs.existsSync(f) && fs.statSync(f).isFile()) mediaSources.push(f)
  }

  onProgress?.({ stage: 'media', current: 0, total: mediaSources.length })
  for (let i = 0; i < mediaSources.length; i++) {
    const src = mediaSources[i]
    try {
      const rel = importMediaFile(src, mediaDir)
      db.addMediaItem({
        conversationId: convId,
        fileName: rel,
        path: rel,
        type: classifyMediaByExt(path.extname(rel)),
        takenAt: inferTakenAt(rel)
      })
    } catch (e) {
      warnings.push(`媒体入库失败 ${path.basename(src)}：${(e as Error).message}`)
    }
    onProgress?.({ stage: 'media', current: i + 1, total: mediaSources.length, detail: path.basename(src) })
  }

  // ---------- 数据文件解析 ----------
  for (const file of opts.files) {
    onProgress?.({ stage: 'parse', detail: `解析 ${path.basename(file)}…` })
    let content: string
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch (e) {
      warnings.push(`无法读取文件 ${file}：${(e as Error).message}`)
      continue
    }

    // 宽松匹配兜底：单条消息的导出片段严格嗅探过不了（canParse 普遍要求 ≥2 消息头）
    const parser = findParserLoose({ filePath: file, content })
    if (!parser) {
      warnings.push(`未识别的数据格式（支持的格式：结构化txt / 微信复制txt / 微信导出行格式 / json / csv / html）：${path.basename(file)}`)
      continue
    }

    let result: ParseResult
    try {
      result = parser.parse({ filePath: file, content })
    } catch (e) {
      warnings.push(`解析失败 ${path.basename(file)}：${(e as Error).message}`)
      continue
    }
    warnings.push(...result.warnings.map((w) => `[${path.basename(file)}] ${w}`))

    const baseDir = path.dirname(file)
    for (const msg of result.messages) {
      const role = decideRole(msg.sender, roleSelf, rolePeer)

      // 附件：解析相对路径 → 拷贝入媒体库
      const attachments: Array<{ type: string; path: string }> = []
      for (const att of msg.attachments) {
        const src = path.isAbsolute(att.sourcePath)
          ? att.sourcePath
          : path.join(baseDir, att.sourcePath)
        if (!fs.existsSync(src)) {
          warnings.push(`附件缺失：${att.sourcePath}`)
          continue
        }
        try {
          const rel = importMediaFile(src, mediaDir)
          attachments.push({ type: att.type, path: rel })
        } catch (e) {
          warnings.push(`附件拷贝失败 ${att.sourcePath}：${(e as Error).message}`)
        }
      }

      const ok = upsert(db, convId, msg, role, attachments)
      if (ok) inserted++
      else skipped++
    }
  }

  // ---------- 自动关联 ----------
  if (opts.autoLinkMedia !== false) {
    onProgress?.({ stage: 'link', detail: '按时间自动关联媒体…' })
    db.reclassifyMediaMessages(convId)
    db.autoLinkMedia(convId, 120)
  }

  db.recordImportBatch({
    conversationId: convId,
    sourceType: opts.files.length > 0 ? path.extname(opts.files[0]).replace('.', '') || 'txt' : 'media',
    sourcePath: opts.files.join('; ').slice(0, 500),
    messageCount: inserted,
    skippedCount: skipped
  })
  db.touchConversation(convId)

  onProgress?.({ stage: 'done' })
  return { conversationId: convId, inserted, skipped, warnings }
}

function upsert(
  db: ReturnType<typeof getDb>,
  convId: number,
  msg: ParsedMessage,
  role: SenderRole,
  attachments: Array<{ type: string; path: string }>
): boolean {
  const fp = messageFingerprint(convId, {
    sender: msg.sender,
    timestamp: msg.timestamp,
    content: msg.content,
    attachments
  })
  const id = db.upsertMessage({
    conversationId: convId,
    sender: msg.sender,
    senderRole: role,
    messageType: msg.messageType,
    content: msg.content,
    timestamp: msg.timestamp,
    filePath: attachments[0]?.path ?? null,
    fingerprint: fp,
    attachments
  })
  return id !== null
}
