/**
 * 解析器注册表（方案C 扩展点）
 * 新数据源：实现 ChatParser 并加入 PARSERS 数组即可。
 */
import path from 'node:path'
import { csvParser } from './csv-parser'
import { htmlParser } from './html-parser'
import { jsonParser } from './json-parser'
import { structuredTxtParser } from './structured-txt-parser'
import type { ChatParser, ParseContext } from './types'
import { wechatCopyParser } from './wechat-copy-parser'
import { wechatExportParser } from './wechat-export-parser'

/** 注册顺序即优先级（同扩展名时靠前优先） */
const PARSERS: ChatParser[] = [
  jsonParser,
  csvParser,
  htmlParser,
  structuredTxtParser,
  wechatExportParser,
  wechatCopyParser
]

export function findParser(ctx: ParseContext): ChatParser | null {
  const ext = path.extname(ctx.filePath).toLowerCase()
  for (const parser of PARSERS) {
    if (parser.extensions.includes(ext) && parser.canParse(ctx)) {
      return parser
    }
  }
  // 扩展名不符时仍尝试嗅探（例如 .log 改名的微信复制文本）
  for (const parser of PARSERS) {
    if (parser.canParse(ctx)) return parser
  }
  return null
}

/**
 * 宽松匹配：严格嗅探全部失败后再试。直接试跑 wechat-export 解析，
 * 产出 ≥1 条结构完整（发送者/内容/时间齐备）的消息即接受。
 *
 * 适用场景：剪贴板单条消息复制、或只有一条消息的导出片段——
 * 各 parser 的 canParse 普遍要求 ≥2 个消息头组合，单条会漏。
 * 误判风险低：「昵称行 + YYYY年MM月DD日 HH:mm 行」精确配对几乎不可能
 * 从普通文本凑出。importer 与 clipboard-monitor 共用此兜底。
 */
export function findParserLoose(ctx: ParseContext): ChatParser | null {
  const strict = findParser(ctx)
  if (strict) return strict
  const result = wechatExportParser.parse(ctx)
  if (result.messages.length === 0) return null
  const wellFormed = result.messages.every(
    (m) => m.sender.trim() && m.content.trim() && m.timestamp
  )
  return wellFormed ? wechatExportParser : null
}

export function listParsers(): Array<{ id: string; name: string; extensions: string[] }> {
  return PARSERS.map((p) => ({ id: p.id, name: p.name, extensions: p.extensions }))
}
