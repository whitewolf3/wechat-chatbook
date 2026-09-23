/**
 * 解析器统一接口（方案C：可扩展数据源）
 * 新增合法数据来源时，实现该接口并在 registry.ts 注册即可。
 */
import type { MessageType } from '../../shared/types'

export interface ParsedAttachment {
  type: 'image' | 'gif' | 'video' | 'voice' | 'file'
  /** 绝对路径，或相对于数据文件所在目录的相对路径 */
  sourcePath: string
  displayName?: string
}

export interface ParsedMessage {
  sender: string
  /** 解析器可不判定；导入器会依据 selfName/peerName 统一判定 */
  senderRole?: 'self' | 'peer' | 'unknown'
  messageType: MessageType
  content: string
  /** 已规范为 YYYY-MM-DD HH:mm:ss（本地时间） */
  timestamp: string
  attachments: ParsedAttachment[]
  /** 预留：引用消息、位置等结构化扩展 */
  extra?: Record<string, unknown>
}

export interface ParseResult {
  messages: ParsedMessage[]
  warnings: string[]
  /** json 等格式可携带会话元信息 */
  meta?: { selfName?: string; peerName?: string; title?: string }
}

export interface ParseContext {
  filePath: string
  content: string
}

export interface ChatParser {
  id: string
  name: string
  /** 可处理的扩展名（含点，小写） */
  extensions: string[]
  /** 内容嗅探：该文件是否由本解析器处理 */
  canParse(ctx: ParseContext): boolean
  parse(ctx: ParseContext): ParseResult
}
