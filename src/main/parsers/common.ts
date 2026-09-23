/**
 * 解析器公共工具：占位符映射、消息类型别名归一
 */
import type { MessageType } from '../../shared/types'

/** 微信复制文本中的占位符 → 消息类型 */
export const PLACEHOLDER_TYPES: Record<string, MessageType> = {
  '[图片]': 'image',
  '[语音]': 'voice',
  '[视频]': 'video',
  '[文件]': 'file',
  '[位置]': 'location',
  '[链接]': 'link',
  '[名片]': 'unknown',
  '[音乐]': 'unknown',
  '[动画表情]': 'sticker',
  '[表情]': 'sticker',
  '[红包]': 'unknown',
  '[转账]': 'unknown',
  '[聊天记录]': 'quote',
  '[拍一拍]': 'system'
}

/** 类型字段别名（json/csv 的 type 列、中英文）→ 统一类型 */
export const TYPE_ALIASES: Record<string, MessageType> = {
  text: 'text',
  文本: 'text',
  消息: 'text',
  image: 'image',
  图片: 'image',
  photo: 'image',
  sticker: 'sticker',
  emoji: 'emoji',
  表情: 'sticker',
  动画表情: 'sticker',
  表情包: 'sticker',
  voice: 'voice',
  语音: 'voice',
  audio: 'voice',
  video: 'video',
  视频: 'video',
  file: 'file',
  文件: 'file',
  location: 'location',
  位置: 'location',
  quote: 'quote',
  引用: 'quote',
  reply: 'quote',
  link: 'link',
  链接: 'link',
  system: 'system',
  系统: 'system'
}

/**
 * 识别内容中的媒体占位符类型：
 * 1. 整条内容恰好是占位符：「[图片]」→ image
 * 2. 占位符 + 附加文本（微信导出的媒体引用）：「[图片] 微信图片_xxx.dat」→ image
 */
export function detectPlaceholderType(content: string): MessageType | null {
  const trimmed = content.trim()
  const exact = PLACEHOLDER_TYPES[trimmed]
  if (exact) return exact
  const m = /^(\[[^[\]]{1,10}\])/.exec(trimmed)
  return m ? PLACEHOLDER_TYPES[m[1]] ?? null : null
}

/** 类型字段归一 */
export function normalizeMessageType(input: unknown): MessageType {
  if (typeof input !== 'string') return 'text'
  return TYPE_ALIASES[input.trim().toLowerCase()] ?? TYPE_ALIASES[input.trim()] ?? 'unknown'
}

/** 按扩展名分类媒体附件 */
export function classifyMediaByExt(ext: string): 'image' | 'gif' | 'video' | 'voice' | 'file' {
  const e = ext.toLowerCase()
  if (e === '.gif') return 'gif'
  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.heic'].includes(e)) return 'image'
  if (['.mp4', '.mov', '.m4v', '.avi'].includes(e)) return 'video'
  if (['.m4a', '.mp3', '.wav', '.aac', '.silk'].includes(e)) return 'voice'
  return 'file'
}
