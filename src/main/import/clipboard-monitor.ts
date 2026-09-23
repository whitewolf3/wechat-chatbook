/**
 * 剪贴板监听：微信 Mac 多选消息 Cmd+C 后，自动识别「微信复制格式」并入库。
 *
 * 工作方式：主进程定时轮询剪贴板（Electron 无跨平台剪贴板变更事件），
 * 内容 hash 变化才处理；文本先经 registry 多格式嗅探（微信导出分行格式、
 * 微信复制单行头格式、结构化 txt 等都能识别），解析出的发送者昵称须命中
 * 某个会话的 selfName/peerName 才入库（双保险防误触发普通复制文本）。
 * 文本先留档到 <库根>/clipboard-inbox/ 再复用 runImport 完整链路
 * （解析 → 指纹去重 → 角色昵称兜底 → 媒体关联），重复复制同一段被指纹跳过。
 */
import { clipboard } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ParsedMessage } from '../parsers/types'
import { findParserLoose } from '../parsers/registry'
import { runImport } from './importer'
import { getDb, getLibraryRoot } from '../library'

const POLL_MS = 1500
const MAX_CLIPBOARD_CHARS = 200_000 // 剪贴板上限保护

export interface ClipboardCapture {
  conversationId: number
  inserted: number
  skipped: number
}

export interface ClipboardMonitorStatus {
  active: boolean
  capturedTotal: number
  lastCaptureAt: string | null
  lastDetail: string | null
}

let timer: NodeJS.Timeout | null = null
let lastHash: string | null = null
let importing = false // 导入执行中跳过本轮轮询，防重入
let capturedTotal = 0
let lastCaptureAt: string | null = null
let lastDetail: string | null = null
let onCaptured: ((c: ClipboardCapture) => void) | null = null

function contentHash(text: string): string {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex')
}

/**
 * 解析剪贴板文本：走 registry 多格式嗅探（含单条宽松兜底）。
 * 不像任何已知微信格式返回 null。
 */
export function parseClipboardText(text: string): ParsedMessage[] | null {
  if (!text || text.length > MAX_CLIPBOARD_CHARS) return null
  const ctx = { filePath: 'clipboard.txt', content: text }
  const parser = findParserLoose(ctx)
  if (!parser) return null
  const result = parser.parse(ctx)
  return result.messages.length > 0 ? result.messages : null
}

/**
 * 归属会话：所有发送者都落在某会话的 {selfName, peerName} 集合中。
 * 多个会话同时满足（如多个会话共用同一个本人昵称、剪贴板又只有本人消息）时
 * 属于歧义匹配，返回 null 拒绝自动入库，避免消息进错会话——用户可用「?」
 * 诊断确认后手动处理。
 */
export function resolveConversation(
  messages: ParsedMessage[]
): { id: number; title: string } | null {
  const senders = new Set(messages.map((m) => m.sender.trim()).filter(Boolean))
  if (senders.size === 0) return null
  const convs = getDb().listConversations()
  let matched: { id: number; title: string } | null = null
  for (const c of convs) {
    const names = new Set([c.selfName, c.peerName].filter((n): n is string => Boolean(n)))
    if (names.size === 0) continue
    const allIn = [...senders].every((s) => names.has(s))
    if (!allIn) continue
    if (matched) {
      // 歧义：两个会话都能装下这些发送者（典型的 self-only 消息 + 共用昵称）
      return null
    }
    matched = { id: c.id, title: c.title }
  }
  return matched
}

/** 导入剪贴板文本：留档 inbox → runImport。失败返回 null（保留文件排查）。 */
export async function importClipboardText(text: string): Promise<ClipboardCapture | null> {
  const messages = parseClipboardText(text)
  if (!messages) return null
  const conv = resolveConversation(messages)
  if (!conv) return null

  const inbox = path.join(getLibraryRoot(), 'clipboard-inbox')
  fs.mkdirSync(inbox, { recursive: true })
  // 文件名带会话 id：删除会话时可一并清理该会话的原文留档
  const file = path.join(inbox, `clipboard-${conv.id}-${Date.now()}.txt`)
  fs.writeFileSync(file, text, 'utf8')

  const result = await runImport({ files: [file], conversationId: conv.id })
  return { conversationId: conv.id, inserted: result.inserted, skipped: result.skipped }
}

export function startClipboardMonitor(cb: (c: ClipboardCapture) => void): void {
  if (timer) return
  onCaptured = cb
  const initial = clipboard.readText()
  lastHash = initial ? contentHash(initial) : null

  // 开启瞬间的既有剪贴板内容也要尝试导入一次：用户常见操作顺序是
  // 「微信 Cmd+C → 开监听」，若仅把当前内容设为基准不处理，这条复制会
  // 被轮询当作"没变"永远跳过。误触发由解析嗅探 + 会话归属双保险挡住，
  // 非本会话的微信格式文本不会入库。
  if (initial) captureAndImport(initial)

  timer = setInterval(() => {
    if (importing) return
    let text: string
    try {
      text = clipboard.readText()
    } catch {
      return
    }
    if (!text) return
    const hash = contentHash(text)
    if (hash === lastHash) return
    lastHash = hash

    captureAndImport(text)
  }, POLL_MS)
}

/** 解析 → 归属 → inbox 留档 → runImport，成功后回调推送。importing 锁防重入。 */
function captureAndImport(text: string): void {
  importing = true
  void (async () => {
    try {
      const r = await importClipboardText(text)
      if (r) {
        capturedTotal += r.inserted
        lastCaptureAt = new Date().toISOString()
        lastDetail = `+${r.inserted} 条` + (r.skipped > 0 ? `（重复跳过 ${r.skipped}）` : '')
        onCaptured?.(r)
      }
    } catch (e) {
      console.error('剪贴板导入失败:', (e as Error).message)
    } finally {
      importing = false
    }
  })()
}

export function stopClipboardMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
  onCaptured = null
}

export function clipboardMonitorStatus(): ClipboardMonitorStatus {
  return { active: timer !== null, capturedTotal, lastCaptureAt, lastDetail }
}
