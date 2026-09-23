/**
 * SQLite 数据层：schema、FTS5 全文索引、指纹去重、查询
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { detectPlaceholderType } from '../parsers/common'
import type {
  ConversationDTO,
  MessageDTO,
  MessageFilter,
  MessageType,
  SearchHit,
  SearchParams,
  SenderRole
} from '../../shared/types'

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS conversation (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  self_name   TEXT,
  peer_name   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS chat_message (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  sender          TEXT,
  sender_role     TEXT NOT NULL DEFAULT 'unknown',
  message_type    TEXT NOT NULL DEFAULT 'text',
  content         TEXT,
  file_path       TEXT,
  timestamp       TEXT NOT NULL,
  created_time    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  fingerprint     TEXT NOT NULL,
  extra_json      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_fingerprint ON chat_message(fingerprint);
CREATE INDEX IF NOT EXISTS idx_message_time ON chat_message(conversation_id, timestamp);

CREATE TABLE IF NOT EXISTS message_attachment (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES chat_message(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  path       TEXT NOT NULL,
  thumbnail  TEXT
);
CREATE INDEX IF NOT EXISTS idx_attachment_message ON message_attachment(message_id);

CREATE TABLE IF NOT EXISTS media_pool (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  path            TEXT NOT NULL,
  type            TEXT NOT NULL,
  taken_at        TEXT,
  message_id      INTEGER REFERENCES chat_message(id) ON DELETE SET NULL,
  UNIQUE(conversation_id, file_name)
);

CREATE TABLE IF NOT EXISTS import_batch (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL,
  source_path     TEXT NOT NULL,
  imported_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  message_count   INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'done'
);

-- Phase 3: 消息便签（message_id 为 NULL 时表示手动创建的独立便签）
CREATE TABLE IF NOT EXISTS message_bookmark (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER REFERENCES chat_message(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL DEFAULT 0,
  content         TEXT,
  category        TEXT NOT NULL DEFAULT 'general',
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(message_id)
);
CREATE INDEX IF NOT EXISTS idx_bookmark_message ON message_bookmark(message_id);

-- Phase 3: 人物画像缓存
CREATE TABLE IF NOT EXISTS contact_persona (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  analysis_data   TEXT NOT NULL,
  analyzed_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(conversation_id)
);

-- Phase 3: 对话建议
CREATE TABLE IF NOT EXISTS conversation_suggestion (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id     INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  trigger_message_id  INTEGER REFERENCES chat_message(id) ON DELETE SET NULL,
  category            TEXT NOT NULL,
  content             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_suggestion_conv ON conversation_suggestion(conversation_id, status);

-- Phase 3: 重要信息（自动总结：生日/加班/承诺/重点话等）
CREATE TABLE IF NOT EXISTS contact_fact (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  content         TEXT NOT NULL,
  evidence        TEXT,
  message_id      INTEGER REFERENCES chat_message(id) ON DELETE SET NULL,
  occurs_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_fact_conv ON contact_fact(conversation_id);

-- 全文搜索（FTS5）
-- unicode61 会把整句中文当作单个 token，无法子串搜索；因此 FTS 内容由应用层
-- 预处理（CJK 逐字加空格，见 ftsPrepareText），查询侧同样构造逐字短语（phrase），
-- 「相邻匹配 = 子串匹配」，1~2 个汉字也可命中。消息写入/删除由 ChatDatabase
-- 显式同步（全部写路径都经过 upsertMessage / deleteConversation）。
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  content, sender,
  tokenize='unicode61'
);
`

export interface InsertMessageParams {
  conversationId: number
  sender: string
  senderRole: SenderRole
  messageType: MessageType
  content: string
  timestamp: string
  filePath: string | null
  fingerprint: string
  attachments: { type: string; path: string }[]
}

export interface MediaPoolItem {
  conversationId: number
  fileName: string
  path: string
  type: string
  takenAt: string | null
}

/**
 * 消息去重指纹（增量导入核心）。
 * 注意：不含 message_type——类型由内容确定性派生（占位符识别/媒体再分类），
 * 纳入指纹会导致「类型修正 → 指纹变化 → 重新导入产生重复行」。
 */
export function messageFingerprint(
  conversationId: number,
  p: { sender: string; timestamp: string; content: string; attachments: { path: string }[] }
): string {
  const raw = [
    conversationId,
    p.sender,
    p.timestamp,
    p.content,
    p.attachments.map((a) => a.path).join(',')
  ].join('\u0001')
  return createHash('sha1').update(raw, 'utf8').digest('hex')
}

interface MessageRow {
  id: number
  conversation_id: number
  sender: string | null
  sender_role: string
  message_type: string
  content: string | null
  file_path: string | null
  timestamp: string
  created_time: string
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\u30a0-\u30ff]/

/**
 * FTS 索引文本预处理：CJK 逐字成 token，拉丁/数字连续段成 token，空白作分隔。
 * 例：「想爬山plan」→「想 爬 山 plan」
 */
export function ftsPrepareText(input: string): string {
  if (!input) return ''
  const tokens: string[] = []
  let buf = ''
  for (const ch of input) {
    if (CJK_RE.test(ch)) {
      if (buf) { tokens.push(buf); buf = '' }
      tokens.push(ch)
    } else if (/\s/.test(ch)) {
      if (buf) { tokens.push(buf); buf = '' }
    } else {
      buf += ch
    }
  }
  if (buf) tokens.push(buf)
  return tokens.join(' ')
}

/**
 * 用户输入 → 安全的 FTS5 查询串：
 * 按空白拆分为多个词，每个词内部经 ftsPrepareText 后作为引号短语（相邻匹配），
 * 词之间为 AND。引号被移除以避免 FTS 语法注入。
 */
function ftsQuery(input: string): string {
  const parts = input
    .replace(/["']/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return ''
  return parts.map((p) => `"${ftsPrepareText(p)}"`).join(' ')
}

/** 应用层生成搜索摘要（FTS 索引内容是预处理文本，不能用 snippet()） */
function buildSnippet(content: string | null, keyword: string): string {
  const text = (content ?? '').trim()
  if (!text) return ''
  const first = keyword.trim().split(/\s+/)[0] ?? ''
  const k = first.toLowerCase()
  const low = text.toLowerCase()
  const idx = k ? low.indexOf(k) : -1
  if (idx < 0) return text.slice(0, 40)
  const start = Math.max(0, idx - 12)
  const end = Math.min(text.length, idx + k.length + 20)
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, idx) +
    '【' + text.slice(idx, idx + k.length) + '】' +
    text.slice(idx + k.length, end) +
    (end < text.length ? '…' : '')
  )
}

export class ChatDatabase {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
    this.migrateBookmarkColumns()
    this.migrateFactColumns()
  }

  /** 幂等迁移：contact_fact 增加 message_id（回溯来源消息）与 occurs_at（到期日/循环月日） */
  private migrateFactColumns(): void {
    const cols = this.db.prepare('PRAGMA table_info(contact_fact)').all() as Array<{ name: string }>
    const names = new Set(cols.map((c) => c.name))
    if (!names.has('message_id')) {
      this.db.exec(
        'ALTER TABLE contact_fact ADD COLUMN message_id INTEGER REFERENCES chat_message(id) ON DELETE SET NULL'
      )
    }
    if (!names.has('occurs_at')) {
      this.db.exec('ALTER TABLE contact_fact ADD COLUMN occurs_at TEXT')
    }
  }

  /** 幂等迁移：message_bookmark 支持手动便签（message_id 可空 + conversation_id/content 列） */
  private migrateBookmarkColumns(): void {
    const cols = this.db.prepare('PRAGMA table_info(message_bookmark)').all() as Array<{ name: string; notnull: number }>
    const msgCol = cols.find((c) => c.name === 'message_id')
    // 旧库 message_id 带 NOT NULL 约束，SQLite 无法 ALTER 去除，需重建表
    if (msgCol && msgCol.notnull === 1) {
      this.db.exec(`
        CREATE TABLE message_bookmark_new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id      INTEGER REFERENCES chat_message(id) ON DELETE CASCADE,
          conversation_id INTEGER NOT NULL DEFAULT 0,
          content         TEXT,
          category        TEXT NOT NULL DEFAULT 'general',
          note            TEXT,
          created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          UNIQUE(message_id)
        );
        INSERT INTO message_bookmark_new (id, message_id, conversation_id, content, category, note, created_at)
          SELECT b.id, b.message_id, COALESCE(m.conversation_id, 0), NULL, b.category, b.note, b.created_at
          FROM message_bookmark b LEFT JOIN chat_message m ON m.id = b.message_id;
        DROP TABLE message_bookmark;
        ALTER TABLE message_bookmark_new RENAME TO message_bookmark;
        CREATE INDEX IF NOT EXISTS idx_bookmark_message ON message_bookmark(message_id);
        CREATE INDEX IF NOT EXISTS idx_bookmark_conv ON message_bookmark(conversation_id);
      `)
      return
    }
    const names = new Set(cols.map((c) => c.name))
    if (!names.has('conversation_id')) {
      this.db.exec('ALTER TABLE message_bookmark ADD COLUMN conversation_id INTEGER NOT NULL DEFAULT 0')
      this.db.exec(
        `UPDATE message_bookmark SET conversation_id =
           (SELECT m.conversation_id FROM chat_message m WHERE m.id = message_bookmark.message_id)
         WHERE conversation_id = 0`
      )
    }
    if (!names.has('content')) {
      this.db.exec('ALTER TABLE message_bookmark ADD COLUMN content TEXT')
    }
    // 新列就绪后补建会话索引（不能放在 SCHEMA 里：旧表迁移前尚无该列）
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bookmark_conv ON message_bookmark(conversation_id)')
  }

  close(): void {
    this.db.close()
  }

  // ---------- 会话 ----------

  createConversation(p: { title: string; selfName?: string; peerName?: string }): number {
    const info = this.db
      .prepare('INSERT INTO conversation (title, self_name, peer_name) VALUES (?, ?, ?)')
      .run(p.title, p.selfName ?? null, p.peerName ?? null)
    return Number(info.lastInsertRowid)
  }

  listConversations(): ConversationDTO[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.title, c.self_name, c.peer_name,
                COUNT(m.id) AS message_count,
                MIN(m.timestamp) AS first_time, MAX(m.timestamp) AS last_time
         FROM conversation c
         LEFT JOIN chat_message m ON m.conversation_id = c.id
         GROUP BY c.id ORDER BY c.updated_at DESC`
      )
      .all() as Array<{
      id: number
      title: string
      self_name: string | null
      peer_name: string | null
      message_count: number
      first_time: string | null
      last_time: string | null
    }>
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      selfName: r.self_name,
      peerName: r.peer_name,
      messageCount: r.message_count,
      firstTime: r.first_time,
      lastTime: r.last_time
    }))
  }

  getConversation(id: number): {
    id: number
    title: string
    selfName: string | null
    peerName: string | null
    messageCount: number
    firstTime: string | null
    lastTime: string | null
  } | null {
    const row = this.db
      .prepare(
        `SELECT c.id, c.title, c.self_name, c.peer_name,
                COUNT(m.id) AS message_count,
                MIN(m.timestamp) AS first_time, MAX(m.timestamp) AS last_time
         FROM conversation c
         LEFT JOIN chat_message m ON m.conversation_id = c.id
         WHERE c.id = ? GROUP BY c.id`
      )
      .get(id) as
      | {
          id: number
          title: string
          self_name: string | null
          peer_name: string | null
          message_count: number
          first_time: string | null
          last_time: string | null
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      selfName: row.self_name,
      peerName: row.peer_name,
      messageCount: row.message_count,
      firstTime: row.first_time,
      lastTime: row.last_time
    }
  }

  deleteConversation(id: number): void {
    const tx = this.db.transaction(() => {
      // 手动便签的 message_id 为空、conversation_id 无外键，不随会话级联删除，需显式清理
      // （消息便签冗余存了 conversation_id，一并覆盖）
      this.db.prepare('DELETE FROM message_bookmark WHERE conversation_id = ?').run(id)
      // FTS 表不受外键级联，需先显式清理
      this.db
        .prepare('DELETE FROM message_fts WHERE rowid IN (SELECT id FROM chat_message WHERE conversation_id = ?)')
        .run(id)
      this.db.prepare('DELETE FROM conversation WHERE id = ?').run(id)
    })
    tx()
  }

  touchConversation(id: number): void {
    this.db
      .prepare("UPDATE conversation SET updated_at = datetime('now','localtime') WHERE id = ?")
      .run(id)
  }

  // ---------- 消息 ----------

  /**
   * 插入消息（指纹去重）。返回新消息 id；重复返回 null。
   * 两级去重：先完整指纹（含附件路径）；未命中再按「发送者+时间+内容」裸匹配，
   * 命中且旧记录无附件而本次有 → 回填附件（修复「先导文字后补媒体」被当成新消息
   * 重复插入的问题；也覆盖导出回导时附件改名的场景）。
   */
  upsertMessage(p: InsertMessageParams): number | null {
    const tx = this.db.transaction((params: InsertMessageParams): number | null => {
      // 两级查重必须都在插入之前：裸字段级不能后置——「先导文字后补媒体」
      // 的指纹不同，若先 INSERT 会被当成新消息直接插进去，重复即由此产生
      let existing = this.db
        .prepare('SELECT id FROM chat_message WHERE fingerprint = ?')
        .get(params.fingerprint) as { id: number } | undefined
      if (!existing) {
        // 裸字段匹配（附件路径变化导致指纹不同，如后补媒体/导出回导改名）
        existing = this.db
          .prepare(
            `SELECT id FROM chat_message
             WHERE conversation_id = ? AND sender = ? AND timestamp = ? AND content IS ?
             LIMIT 1`
          )
          .get(params.conversationId, params.sender, params.timestamp, params.content) as
          | { id: number }
          | undefined
      }
      if (existing) {
        // 已存在：若旧记录无附件而本次有，则补齐
        if (params.attachments.length > 0) {
          const has = this.db
            .prepare('SELECT COUNT(*) AS n FROM message_attachment WHERE message_id = ?')
            .get(existing.id) as { n: number }
          if (has.n === 0) {
            this.db
              .prepare('UPDATE chat_message SET file_path = ? WHERE id = ?')
              .run(params.filePath, existing.id)
            for (const a of params.attachments) this.insertAttachment(existing.id, a.type, a.path)
          }
        }
        return null
      }

      const info = this.db
        .prepare(
          `INSERT OR IGNORE INTO chat_message
             (conversation_id, sender, sender_role, message_type, content, file_path, timestamp, created_time, fingerprint)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)`
        )
        .run(
          params.conversationId,
          params.sender,
          params.senderRole,
          params.messageType,
          params.content,
          params.filePath,
          params.timestamp,
          params.fingerprint
        )
      if (info.changes === 1) {
        const id = Number(info.lastInsertRowid)
        for (const a of params.attachments) this.insertAttachment(id, a.type, a.path)
        this.db
          .prepare('INSERT INTO message_fts (rowid, content, sender) VALUES (?, ?, ?)')
          .run(id, ftsPrepareText(params.content), params.sender)
        return id
      }
      // 理论不可达（查重未命中但插入撞唯一索引，并发同指纹）——按重复处理
      return null
    })
    return tx(p)
  }

  private insertAttachment(messageId: number, type: string, path: string): void {
    this.db
      .prepare('INSERT INTO message_attachment (message_id, type, path) VALUES (?, ?, ?)')
      .run(messageId, type, path)
  }

  private toDTO(row: MessageRow): MessageDTO {
    const atts = this.db
      .prepare('SELECT type, path FROM message_attachment WHERE message_id = ? ORDER BY id')
      .all(row.id) as Array<{ type: string; path: string }>
    return {
      id: row.id,
      conversationId: row.conversation_id,
      sender: row.sender ?? '',
      senderRole: row.sender_role as SenderRole,
      messageType: row.message_type as MessageType,
      content: row.content,
      filePath: row.file_path,
      timestamp: row.timestamp,
      createdTime: row.created_time,
      attachments: atts
    }
  }

  listMessages(conversationId: number, filter: MessageFilter = {}): MessageDTO[] {
    const where: string[] = ['m.conversation_id = @conversationId']
    if (filter.senderRole) where.push('m.sender_role = @senderRole')
    if (filter.messageType) where.push('m.message_type = @messageType')
    if (filter.from) where.push('m.timestamp >= @from')
    if (filter.to) where.push('m.timestamp <= @to')

    const params: Record<string, unknown> = {
      conversationId,
      senderRole: filter.senderRole || null,
      messageType: filter.messageType || null,
      from: filter.from || null,
      to: filter.to || null,
      limit: filter.limit ?? 2000,
      offset: filter.offset ?? 0
    }

    let sql: string
    // recent 模式：limit 截「最近 N 条」（DESC 取数后反转为升序），用于浏览窗口；
    // 默认模式：limit 截「最早 N 条」+ offset 分页（历史行为，翻页语义）
    const order = filter.recent ? 'DESC' : 'ASC'
    const keyword = (filter.keyword ?? '').trim()
    const query = keyword ? ftsQuery(keyword) : ''
    if (keyword && !query) return [] // 关键词仅含引号等无效字符
    if (query) {
      params.keyword = query
      sql = `SELECT m.* FROM chat_message m
             JOIN message_fts fts ON fts.rowid = m.id
             WHERE ${where.join(' AND ')} AND message_fts MATCH @keyword
             ORDER BY m.timestamp ${order}, m.id ${order} LIMIT @limit OFFSET @offset`
    } else {
      sql = `SELECT m.* FROM chat_message m
             WHERE ${where.join(' AND ')}
             ORDER BY m.timestamp ${order}, m.id ${order} LIMIT @limit OFFSET @offset`
    }
    const rows = this.db.prepare(sql).all(params) as MessageRow[]
    return (filter.recent ? rows.reverse() : rows).map((r) => this.toDTO(r))
  }

  /** 某条消息前后的上下文 */
  messageContext(messageId: number, before = 10, after = 10): MessageDTO[] {
    const anchor = this.db
      .prepare('SELECT id, conversation_id FROM chat_message WHERE id = ?')
      .get(messageId) as { id: number; conversation_id: number } | undefined
    if (!anchor) return []
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM chat_message
           WHERE conversation_id = @cid
             AND timestamp <= (SELECT timestamp FROM chat_message WHERE id = @mid)
             AND id != @mid
           ORDER BY timestamp DESC, id DESC LIMIT @before
         )
         UNION ALL
         SELECT * FROM chat_message WHERE id = @mid
         UNION ALL
         SELECT * FROM (
           SELECT * FROM chat_message
           WHERE conversation_id = @cid AND timestamp > (SELECT timestamp FROM chat_message WHERE id = @mid)
           ORDER BY timestamp ASC, id ASC LIMIT @after
         )
         ORDER BY timestamp, id`
      )
      .all({ cid: anchor.conversation_id, mid: messageId, before, after }) as MessageRow[]
    return rows.map((r) => this.toDTO(r))
  }

  /**
   * 取最近 n 条消息（时间升序返回）。
   * 注意与 listMessages 的区别：listMessages 是 LIMIT 截断"最早"的 n 条，
   * 本方法按时间倒序取末尾再翻转，用于回复助手等需要"最新对话"的场景。
   */
  getRecentMessages(conversationId: number, n: number): MessageDTO[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM chat_message m
         WHERE m.conversation_id = ?
         ORDER BY m.timestamp DESC, m.id DESC LIMIT ?`
      )
      .all(conversationId, n) as MessageRow[]
    return rows.reverse().map((r) => this.toDTO(r))
  }

  // ---------- 搜索 ----------

  search(params: SearchParams): SearchHit[] {
    const keyword = (params.keyword ?? '').trim()
    if (!keyword) return []
    const query = ftsQuery(keyword)
    if (!query) return []
    const where: string[] = ['message_fts MATCH @keyword']
    if (params.conversationId) where.push('m.conversation_id = @conversationId')
    if (params.senderRole) where.push('m.sender_role = @senderRole')
    if (params.messageType) where.push('m.message_type = @messageType')
    if (params.from) where.push('m.timestamp >= @from')
    if (params.to) where.push('m.timestamp <= @to')

    const rows = this.db
      .prepare(
        `SELECT m.id, m.conversation_id, m.sender, m.sender_role, m.message_type, m.timestamp,
                m.content AS raw_content,
                c.title AS conversation_title
         FROM message_fts
         JOIN chat_message m ON m.id = message_fts.rowid
         JOIN conversation c ON c.id = m.conversation_id
         WHERE ${where.join(' AND ')}
         ORDER BY m.timestamp DESC LIMIT @limit`
      )
      .all({
        keyword: query,
        conversationId: params.conversationId ?? null,
        senderRole: params.senderRole || null,
        messageType: params.messageType || null,
        from: params.from || null,
        to: params.to || null,
        limit: params.limit ?? 100
      }) as Array<{
      id: number
      conversation_id: number
      conversation_title: string
      sender: string | null
      sender_role: string
      message_type: string
      raw_content: string | null
      timestamp: string
    }>
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      conversationTitle: r.conversation_title,
      sender: r.sender ?? '',
      senderRole: r.sender_role as SenderRole,
      messageType: r.message_type as MessageType,
      snippet: buildSnippet(r.raw_content, keyword),
      timestamp: r.timestamp
    }))
  }

  // ---------- 媒体池与自动关联 ----------

  addMediaItem(item: MediaPoolItem): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO media_pool (conversation_id, file_name, path, type, taken_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(item.conversationId, item.fileName, item.path, item.type, item.takenAt)
  }

  /**
   * 修正存量数据的媒体占位符类型：
   * 解析器升级前「[图片] 微信图片_xxx.dat」等带后缀的引用曾被记为 text，按前缀规则归一。
   * @returns 修正条数
   */
  reclassifyMediaMessages(conversationId: number): number {
    const rules: Array<[string, MessageType]> = [
      ['[图片]', 'image'],
      ['[视频]', 'video'],
      ['[文件]', 'file'],
      ['[语音]', 'voice'],
      ['[位置]', 'location'],
      ['[链接]', 'link']
    ]
    const stmt = this.db.prepare(
      `UPDATE chat_message SET message_type = ?
       WHERE conversation_id = ? AND message_type IN ('text', 'unknown') AND content LIKE ?`
    )
    let fixed = 0
    for (const [ph, type] of rules) {
      fixed += stmt.run(type, conversationId, `${ph}%`).changes
    }
    return fixed
  }

  /** 从消息内容提取媒体引用文件名（去扩展名）：「[图片] 微信图片_xxx.dat」→「微信图片_xxx」 */
  private extractMediaRef(content: string | null): string | null {
    if (!content) return null
    const m = /^\[(?:图片|视频|文件|语音)\]\s*([^\s]+)/.exec(content.trim())
    return m ? m[1].replace(/\.[^.]+$/, '') : null
  }

  /**
   * 自动关联媒体（两级策略）：
   *  1) 文件名匹配：消息引用「[图片] 微信图片_xxx.dat」→ 媒体池「微信图片_xxx_1.jpg」
   *  2) 时间窗兜底：媒体 taken_at 与消息时间相差 windowSeconds 内取最近者
   * 关联成功后回写 chat_message.file_path / message_type 与 message_attachment。
   * @returns 关联成功条数
   */
  autoLinkMedia(conversationId: number, windowSeconds = 120): number {
    const needs = this.db
      .prepare(
        `SELECT id, message_type, timestamp, content FROM chat_message
         WHERE conversation_id = ?
           AND (message_type IN ('image', 'sticker', 'video', 'file')
                OR content LIKE '[图片]%' OR content LIKE '[视频]%'
                OR content LIKE '[文件]%' OR content LIKE '[语音]%')
           AND id NOT IN (SELECT message_id FROM message_attachment WHERE message_id IS NOT NULL)
         ORDER BY timestamp ASC`
      )
      .all(conversationId) as Array<{
        id: number
        message_type: string
        timestamp: string
        content: string | null
      }>

    const pool = this.db
      .prepare(
        `SELECT id, type, taken_at, file_name FROM media_pool
         WHERE conversation_id = ? AND message_id IS NULL
         ORDER BY COALESCE(taken_at, '') ASC`
      )
      .all(conversationId) as Array<{
        id: number
        type: string
        taken_at: string | null
        file_name: string
      }>

    let linked = 0
    const link = this.db.prepare('UPDATE media_pool SET message_id = ? WHERE id = ?')
    const setFile = this.db.prepare('UPDATE chat_message SET file_path = ? WHERE id = ?')
    const setType = this.db.prepare('UPDATE chat_message SET message_type = ? WHERE id = ?')
    const attachPath = this.db.prepare('SELECT path FROM media_pool WHERE id = ?')
    const insertAtt = this.db.prepare(
      'INSERT INTO message_attachment (message_id, type, path) VALUES (?, ?, ?)'
    )

    const toSec = (ts: string): number => Math.floor(new Date(ts.replace(' ', 'T')).getTime() / 1000)
    const baseName = (f: string): string => f.replace(/\.[^.]+$/, '')

    type PoolItem = (typeof pool)[number]
    const byName = new Map<string, PoolItem>()
    for (const item of pool) byName.set(baseName(item.file_name), item)

    const consume = (item: PoolItem): void => {
      const idx = pool.indexOf(item)
      if (idx >= 0) pool.splice(idx, 1)
      byName.delete(baseName(item.file_name))
    }

    for (const msg of needs) {
      let best: PoolItem | null = null

      // 策略 1：文件名匹配（媒体名允许带 _1/_2 等后缀：微信图片_xxx_1.jpg ↔ 微信图片_xxx.dat）
      const ref = this.extractMediaRef(msg.content)
      if (ref) {
        best = byName.get(ref) ?? null
        if (!best) {
          for (const [name, item] of byName) {
            if (name.startsWith(`${ref}_`)) {
              best = item
              break
            }
          }
        }
      }

      // 策略 2：时间窗兜底（仅对有拍摄时间的媒体）
      if (!best && msg.timestamp) {
        const msgSec = toSec(msg.timestamp)
        let bestDiff = Number.POSITIVE_INFINITY
        for (const item of pool) {
          if (!item.taken_at) continue
          const diff = Math.abs(toSec(item.taken_at) - msgSec)
          if (diff <= windowSeconds && diff < bestDiff) {
            bestDiff = diff
            best = item
          }
        }
      }

      if (!best) continue

      const pathRow = attachPath.get(best.id) as { path: string }
      link.run(msg.id, best.id)
      setFile.run(pathRow.path, msg.id)
      insertAtt.run(msg.id, best.type, pathRow.path)
      // 内容确认为媒体引用但类型未归一时（旧数据），回写正确类型
      const refType = detectPlaceholderType(msg.content ?? '')
      if (refType && msg.message_type !== refType) setType.run(refType, msg.id)
      linked++
      consume(best)
    }
    return linked
  }

  // ---------- 导入批次 ----------

  recordImportBatch(p: {
    conversationId: number
    sourceType: string
    sourcePath: string
    messageCount: number
    skippedCount: number
  }): void {
    this.db
      .prepare(
        `INSERT INTO import_batch (conversation_id, source_type, source_path, message_count, skipped_count)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(p.conversationId, p.sourceType, p.sourcePath, p.messageCount, p.skippedCount)
  }

  // ---------- Phase 3: 消息便签（message_id 为 NULL 时表示手动便签）----------

  /**
   * 添加便签。messageId 非空时为消息便签（同消息重复添加=更新分类/备注）；
   * messageId 为 NULL 时为手动便签，content 为用户输入的正文。
   */
  addBookmark(p: {
    messageId: number | null
    conversationId: number
    category?: string
    content?: string
    note?: string
  }): void {
    if (p.messageId != null) {
      this.db
        .prepare(
          `INSERT INTO message_bookmark (message_id, conversation_id, content, category, note)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(message_id) DO UPDATE SET category = excluded.category, note = excluded.note`
        )
        .run(p.messageId, p.conversationId, p.content ?? null, p.category ?? 'general', p.note ?? null)
    } else {
      this.db
        .prepare(
          `INSERT INTO message_bookmark (message_id, conversation_id, content, category, note)
           VALUES (NULL, ?, ?, ?, ?)`
        )
        .run(p.conversationId, p.content ?? null, p.category ?? 'general', p.note ?? null)
    }
  }

  /** 更新便签（编辑正文/分类/备注；note 传 null 表示清空备注） */
  updateBookmark(id: number, p: { category?: string; content?: string; note?: string | null }): void {
    if (p.category !== undefined) {
      this.db.prepare('UPDATE message_bookmark SET category = ? WHERE id = ?').run(p.category, id)
    }
    if (p.content !== undefined) {
      this.db.prepare('UPDATE message_bookmark SET content = ? WHERE id = ?').run(p.content, id)
    }
    if (p.note !== undefined) {
      this.db.prepare('UPDATE message_bookmark SET note = ? WHERE id = ?').run(p.note, id)
    }
  }

  /** 按便签 id 删除（手动便签与消息便签统一入口） */
  removeBookmark(id: number): void {
    this.db.prepare('DELETE FROM message_bookmark WHERE id = ?').run(id)
  }

  listBookmarks(conversationId: number): Array<{
    id: number
    messageId: number | null
    category: string
    note: string | null
    createdAt: string
    content: string | null
    sender: string | null
    timestamp: string | null
  }> {
    return this.db
      .prepare(
        `SELECT b.id, b.message_id as messageId, b.category, b.note, b.created_at as createdAt,
                COALESCE(b.content, m.content) as content,
                m.sender, m.timestamp
         FROM message_bookmark b
         LEFT JOIN chat_message m ON b.message_id = m.id
         WHERE b.conversation_id = ?
         ORDER BY b.created_at DESC`
      )
      .all(conversationId) as any
  }

  // ---------- Phase 3: 人物画像 ----------

  savePersona(conversationId: number, analysisData: any): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO contact_persona (conversation_id, analysis_data, analyzed_at)
         VALUES (?, ?, datetime('now','localtime'))`
      )
      .run(conversationId, JSON.stringify(analysisData))
  }

  getPersona(conversationId: number): any | null {
    const row = this.db
      .prepare('SELECT analysis_data FROM contact_persona WHERE conversation_id = ?')
      .get(conversationId) as { analysis_data: string } | undefined
    return row ? JSON.parse(row.analysis_data) : null
  }

  // ---------- Phase 3: 对话建议 ----------

  addSuggestion(
    conversationId: number,
    category: string,
    content: string,
    triggerMessageId?: number
  ): void {
    this.db
      .prepare(
        `INSERT INTO conversation_suggestion (conversation_id, trigger_message_id, category, content)
         VALUES (?, ?, ?, ?)`
      )
      .run(conversationId, triggerMessageId ?? null, category, content)
  }

  listSuggestions(conversationId: number, status: string = 'pending'): Array<{
    id: number
    category: string
    content: string
    createdAt: string
  }> {
    return this.db
      .prepare(
        `SELECT id, category, content, created_at as createdAt
         FROM conversation_suggestion
         WHERE conversation_id = ? AND status = ?
         ORDER BY created_at DESC`
      )
      .all(conversationId, status) as any
  }

  updateSuggestionStatus(id: number, status: string): void {
    this.db.prepare('UPDATE conversation_suggestion SET status = ? WHERE id = ?').run(status, id)
  }

  // ---------- Phase 3: 重要信息（自动总结） ----------

  /** 清空会话的全部重要信息（重新分析时替换） */
  clearFacts(conversationId: number): void {
    this.db.prepare('DELETE FROM contact_fact WHERE conversation_id = ?').run(conversationId)
  }

  addFact(params: {
    conversationId: number
    category: string
    content: string
    evidence?: string
    messageId?: number | null
    occursAt?: string | null
  }): void {
    this.db
      .prepare(
        `INSERT INTO contact_fact (conversation_id, category, content, evidence, message_id, occurs_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.conversationId,
        params.category,
        params.content,
        params.evidence ?? null,
        params.messageId ?? null,
        params.occursAt ?? null
      )
  }

  listFacts(conversationId: number): Array<{
    id: number
    category: string
    content: string
    evidence: string | null
    messageId: number | null
    occursAt: string | null
    createdAt: string
  }> {
    return this.db
      .prepare(
        `SELECT id, category, content, evidence, message_id as messageId, occurs_at as occursAt,
                created_at as createdAt
         FROM contact_fact
         WHERE conversation_id = ?
         ORDER BY category, id`
      )
      .all(conversationId) as any
  }

  // ---------- 关系趋势（纯本地统计，无 LLM） ----------

  /**
   * 按月统计消息量、主动开启次数、平均回复时长。
   * 主动开启：间隔 ≥ 2 小时的静默期后（或会话首条）先开口的一方——
   * 普通一来一回的换人发言不算（否则双方交替天然各占 50%，失去参考意义）。
   * 回复时长：一条消息与其下一条异侧消息的时间差（分钟），超过 24 小时的间隔
   * （睡一觉再回）视为非即时回复，不计入平均，避免拉爆均值。
   */
  getTrendStats(conversationId: number): Array<{
    month: string
    selfCount: number
    peerCount: number
    selfInitiated: number
    peerInitiated: number
    selfReplyMin: number | null
    peerReplyMin: number | null
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, sender_role as senderRole, timestamp
         FROM chat_message
         WHERE conversation_id = ? AND sender_role IN ('self','peer')
         ORDER BY timestamp ASC, id ASC`
      )
      .all(conversationId) as Array<{ id: number; senderRole: string; timestamp: string }>

    type Bucket = {
      selfCount: number
      peerCount: number
      selfInitiated: number
      peerInitiated: number
      selfReplyTotal: number
      selfReplyN: number
      peerReplyTotal: number
      peerReplyN: number
    }
    const buckets = new Map<string, Bucket>()
    const bucketOf = (month: string): Bucket => {
      let b = buckets.get(month)
      if (!b) {
        b = {
          selfCount: 0,
          peerCount: 0,
          selfInitiated: 0,
          peerInitiated: 0,
          selfReplyTotal: 0,
          selfReplyN: 0,
          peerReplyTotal: 0,
          peerReplyN: 0
        }
        buckets.set(month, b)
      }
      return b
    }
    const monthOf = (ts: string): string => (ts.length >= 7 ? ts.slice(0, 7) : ts)
    const toMin = (ts: string): number => Math.floor(new Date(ts.replace(' ', 'T')).getTime() / 60000)
    /** 静默阈值（分钟）：超过此间隔后的首条消息算「主动开启话题」 */
    const INITIATION_GAP_MIN = 120

    let prev: { senderRole: string; timestamp: string } | null = null
    for (const m of rows) {
      const b = bucketOf(monthOf(m.timestamp))
      if (m.senderRole === 'self') b.selfCount++
      else b.peerCount++

      // 主动判定：会话首条，或距上一条 ≥2 小时静默后先开口的一方
      if (!prev || toMin(m.timestamp) - toMin(prev.timestamp) >= INITIATION_GAP_MIN) {
        if (m.senderRole === 'self') b.selfInitiated++
        else b.peerInitiated++
      }
      // 回复时长：上一条是异侧 → 本条是对侧的回复
      if (prev && prev.senderRole !== m.senderRole) {
        const gapMin = toMin(m.timestamp) - toMin(prev.timestamp)
        if (gapMin >= 0 && gapMin <= 24 * 60) {
          const pb = bucketOf(monthOf(m.timestamp))
          if (m.senderRole === 'self') {
            pb.selfReplyTotal += gapMin
            pb.selfReplyN++
          } else {
            pb.peerReplyTotal += gapMin
            pb.peerReplyN++
          }
        }
      }
      prev = m
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, b]) => ({
        month,
        selfCount: b.selfCount,
        peerCount: b.peerCount,
        selfInitiated: b.selfInitiated,
        peerInitiated: b.peerInitiated,
        selfReplyMin: b.selfReplyN > 0 ? Math.round(b.selfReplyTotal / b.selfReplyN) : null,
        peerReplyMin: b.peerReplyN > 0 ? Math.round(b.peerReplyTotal / b.peerReplyN) : null
      }))
  }
}
