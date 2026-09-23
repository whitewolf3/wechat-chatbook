/**
 * 数据目录（媒体库）管理
 * 应用唯一可写位置：~/Documents/ChatBook/
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { ChatDatabase } from './db/database'

let libraryRoot = ''
let db: ChatDatabase | null = null

export function initLibrary(): void {
  libraryRoot = path.join(app.getPath('documents'), 'ChatBook')
  fs.mkdirSync(libraryRoot, { recursive: true })
  fs.mkdirSync(path.join(libraryRoot, 'media'), { recursive: true })
}

export function getLibraryRoot(): string {
  if (!libraryRoot) initLibrary()
  return libraryRoot
}

export function getDb(): ChatDatabase {
  if (!db) {
    const root = getLibraryRoot()
    db = new ChatDatabase(path.join(root, 'chatbook.db'))
  }
  return db
}

/** 某会话的媒体目录（相对库根目录为 media/<id>） */
export function mediaDirFor(conversationId: number): string {
  const dir = path.join(getLibraryRoot(), 'media', String(conversationId))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 相对路径 → 绝对路径 */
export function resolveMediaPath(conversationId: number, rel: string): string {
  return path.join(mediaDirFor(conversationId), rel)
}

/** 会话级彻底删除：媒体文件 + 剪贴板原文留档 + 空目录 */
export function deleteConversationFiles(conversationId: number): void {
  const dir = path.join(getLibraryRoot(), 'media', String(conversationId))
  fs.rmSync(dir, { recursive: true, force: true })
  // 剪贴板监听的原文留档（文件名带会话 id：clipboard-<id>-<ts>.txt）一并清理。
  // 旧版本生成的 clipboard-<ts>.txt 无会话归属，保留不动。
  const inbox = path.join(getLibraryRoot(), 'clipboard-inbox')
  try {
    for (const f of fs.readdirSync(inbox)) {
      if (f.startsWith(`clipboard-${conversationId}-`)) {
        fs.rmSync(path.join(inbox, f), { force: true })
      }
    }
  } catch {
    // 目录不存在时忽略
  }
}
