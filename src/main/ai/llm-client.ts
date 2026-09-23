/**
 * LLM 客户端：支持 DeepSeek / OpenAI 兼容 API
 * 用于深度人物画像分析和对话建议生成
 */
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

export interface LLMConfig {
  apiKey: string
  baseUrl: string  // 如 https://api.deepseek.com/v1
  model: string    // 如 deepseek-chat
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMResponse {
  content: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}

/**
 * 调用 LLM API（OpenAI 兼容格式）
 */
export function callLLM(config: LLMConfig, messages: LLMMessage[]): Promise<LLMResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(config.baseUrl + '/chat/completions')
    const body = JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
      stream: false
    })

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }

    const transport = url.protocol === 'https:' ? https : http
    const req = transport.request(options, (res) => {
      // 收集原始 Buffer，响应结束后统一按 UTF-8 解码。
      // 不能在 data 事件里逐 chunk 转字符串：UTF-8 多字节字符（中文 3 字节）
      // 被切在 chunk 边界时会产生 U+FFFD 替换字符（乱码）。
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode !== 200) {
          reject(new Error(`LLM API 错误 ${res.statusCode}: ${data}`))
          return
        }
        try {
          const json = JSON.parse(data)
          resolve({
            content: json.choices?.[0]?.message?.content || '',
            usage: json.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          })
        } catch (e) {
          reject(new Error(`LLM 响应解析失败: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * 从环境变量或配置文件读取 LLM 配置
 */
export function getLLMConfig(): LLMConfig | null {
  const apiKey = process.env.CHATBOOK_LLM_API_KEY || ''
  const baseUrl = process.env.CHATBOOK_LLM_BASE_URL || 'https://api.deepseek.com/v1'
  const model = process.env.CHATBOOK_LLM_MODEL || 'deepseek-chat'

  if (!apiKey) return null
  return { apiKey, baseUrl, model }
}

/**
 * 更新 .env 文本中指定变量（保留其他行与注释），返回新内容。纯函数。
 * - 已存在的 KEY 原位替换（兼容 `export KEY=` 前缀写法）；同名重复定义只保留第一处，
 *   其余删除——否则 dotenv 重载时后出现的旧值会覆盖我们写入的新值
 * - 不存在的 KEY 追加到末尾
 * - 值统一用双引号包裹（dotenv 会去引号），防 #、空格 等被截断或产生歧义
 * - 保留原文件的 CRLF/LF 行尾风格
 */
export function upsertEnvContent(content: string, updates: Record<string, string>): string {
  const keys = Object.keys(updates)
  const isCRLF = content.includes('\r\n')
  const normalized = content.replace(/\r\n/g, '\n')
  const seen = new Set<string>()
  const lines: Array<string | null> = normalized.split('\n').map((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m && keys.includes(m[1])) {
      if (seen.has(m[1])) return null // 同名重复定义：删除后面的，避免旧值覆盖新值
      seen.add(m[1])
      const value = String(updates[m[1]]).replace(/"/g, '\\"')
      return `${m[1]}="${value}"`
    }
    return line
  })
  const kept = lines.filter((l): l is string => l !== null)
  const missing = keys.filter((k) => !seen.has(k))
  let out = kept.join('\n').replace(/\s*$/, '')
  if (out) out += '\n'
  if (missing.length > 0) {
    out += missing.map((k) => `${k}="${String(updates[k]).replace(/"/g, '\\"')}"`).join('\n') + '\n'
  }
  return isCRLF ? out.replace(/\n/g, '\r\n') : out
}

/**
 * 将 LLM 配置写入 .env 文件并同步主进程环境变量。
 * getLLMConfig 每次调用都实时读 process.env，因此写完即刻生效，无需重启；
 * .env 落盘保证 electron-vite 重启后配置仍在（其启动时重新注入 .env）。
 * - apiKey：null/undefined 表示不更新 key（只更新 baseUrl/model）；'' 表示清空；
 *   非空字符串为新 key
 * - baseUrl/model：undefined 表示不更新，'' 写入空值（getLLMConfig 会落默认值）
 */
export function applyLLMConfig(
  envPath: string,
  apiKey: string | null | undefined,
  baseUrl?: string,
  model?: string
): void {
  const updates: Record<string, string> = {}
  if (apiKey !== null && apiKey !== undefined) updates.CHATBOOK_LLM_API_KEY = apiKey
  if (baseUrl !== undefined) updates.CHATBOOK_LLM_BASE_URL = baseUrl
  if (model !== undefined) updates.CHATBOOK_LLM_MODEL = model

  if (Object.keys(updates).length > 0) {
    let content = ''
    try {
      content = fs.readFileSync(envPath, 'utf8')
    } catch {
      // 文件不存在则新建
    }
    fs.mkdirSync(path.dirname(envPath), { recursive: true })
    fs.writeFileSync(envPath, upsertEnvContent(content, updates), 'utf8')

    if (updates.CHATBOOK_LLM_API_KEY !== undefined) {
      process.env.CHATBOOK_LLM_API_KEY = updates.CHATBOOK_LLM_API_KEY
    }
    if (updates.CHATBOOK_LLM_BASE_URL !== undefined) {
      process.env.CHATBOOK_LLM_BASE_URL = updates.CHATBOOK_LLM_BASE_URL
    }
    if (updates.CHATBOOK_LLM_MODEL !== undefined) {
      process.env.CHATBOOK_LLM_MODEL = updates.CHATBOOK_LLM_MODEL
    }
  }
}
