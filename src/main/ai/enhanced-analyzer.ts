/**
 * 增强版 AI 分析引擎：LLM 深度分析 + 本地启发式 fallback
 */
import type { MessageDTO } from '../../shared/types'
import { callLLM, getLLMConfig, type LLMConfig } from './llm-client'
import { analyzeContactPersona, generateSuggestions, extractFactsLocal } from './persona-analyzer'

interface DeepPersonaAnalysis {
  personality: string          // 性格特征总结
  communicationStyle: string   // 沟通风格深度分析
  interests: string            // 兴趣爱好深度解读
  emotionalPattern: string     // 情感模式分析
  relationshipAdvice: string   // 关系维护建议
  keyInsights: string[]        // 关键洞察
}

interface DeepSuggestions {
  suggestions: Array<{
    category: string
    content: string
    priority: 'high' | 'medium' | 'low'
    reason: string
  }>
}

interface DeepFacts {
  facts: Array<{
    category: string
    content: string
    evidence: string
  }>
}

/**
 * 构建人物画像分析的 prompt
 */
function buildPersonaPrompt(messages: MessageDTO[], localAnalysis: any): string {
  const peerMessages = messages.filter((m) => m.senderRole === 'peer')
  
  // 采样最近 100 条消息作为上下文（避免 token 过多）
  const recentMessages = peerMessages.slice(-100)
  const messageSamples = recentMessages
    .slice(-50)
    .map((m) => `[${m.timestamp}] ${m.content}`)
    .join('\n')

  return `你是一位人际关系分析师。请根据以下聊天记录分析对方的性格特征和沟通风格。

## 本地分析数据
- 兴趣标签：${localAnalysis.interestTags.map((t: any) => `${t.tag}(${t.count})`).join(', ')}
- 沟通风格：平均消息长度 ${localAnalysis.communicationStyle.avgMessageLength} 字，回复速度 ${localAnalysis.communicationStyle.responseSpeed}，表情频率 ${(localAnalysis.communicationStyle.emojiFrequency * 100).toFixed(1)}%
- 情感倾向：积极 ${localAnalysis.sentimentAnalysis.positive} / 中性 ${localAnalysis.sentimentAnalysis.neutral} / 消极 ${localAnalysis.sentimentAnalysis.negative}
- 总消息数：${localAnalysis.totalMessages}

## 最近消息样本（50 条）
${messageSamples}

## 请输出 JSON 格式的分析结果
{
  "personality": "性格特征总结（100字以内）",
  "communicationStyle": "沟通风格深度分析（100字以内）",
  "interests": "兴趣爱好深度解读（100字以内）",
  "emotionalPattern": "情感模式分析（100字以内）",
  "relationshipAdvice": "关系维护建议（100字以内）",
  "keyInsights": ["关键洞察1", "关键洞察2", "关键洞察3"]
}

只输出 JSON，不要其他内容。`
}

/**
 * 构建对话建议的 prompt
 */
function buildSuggestionPrompt(messages: MessageDTO[], localAnalysis: any): string {
  const peerMessages = messages.filter((m) => m.senderRole === 'peer')
  const recentMessages = peerMessages.slice(-80)
  const messageSamples = recentMessages
    .slice(-40)
    .map((m) => `[${m.timestamp}] ${m.content}`)
    .join('\n')

  return `你是一位人际关系顾问。请根据以下聊天记录，生成 5-8 条具体的下一步行动建议。

## 本地分析数据
- 兴趣标签：${localAnalysis.interestTags.map((t: any) => `${t.tag}(${t.count})`).join(', ')}
- 情感倾向：积极 ${localAnalysis.sentimentAnalysis.positive} / 中性 ${localAnalysis.sentimentAnalysis.neutral} / 消极 ${localAnalysis.sentimentAnalysis.negative}

## 最近消息样本（40 条）
${messageSamples}

## 请输出 JSON 格式的建议
{
  "suggestions": [
    {
      "category": "类别（travel/food/care/health/activity/shopping/relationship/followup）",
      "content": "具体建议内容（50字以内，要具体可执行）",
      "priority": "high/medium/low",
      "reason": "建议理由（基于聊天内容）"
    }
  ]
}

只输出 JSON，不要其他内容。`
}

/**
 * 构建重要信息提取的 prompt
 */
function buildFactsPrompt(messages: MessageDTO[]): string {
  // 重要信息可能出现在任何位置，采样更长的窗口（最近 200 条对话）
  const dialog = messages
    .map((m) => ({ m, text: (m.content ?? '').trim() }))
    .filter(({ text }) => text.length > 0 && !text.startsWith('['))
    .slice(-200)
    .map(({ m, text }) => {
      const who = m.senderRole === 'self' ? '我' : '对方'
      const clipped = text.length > 50 ? `${text.slice(0, 50)}…` : text
      return `[${m.timestamp.slice(0, 16)}] ${who}: ${clipped}`
    })
    .join('\n')

  return `你是一位个人信息整理助手。请从以下微信聊天记录中提取值得长期记住的重要事实。

## 类别定义
- birthday: 生日、纪念日、重要日期
- work: 工作安排、加班时间、值班规律、假期、职业信息
- health: 健康状况、伤病、过敏、就医
- promise: 双方的承诺、约定、共同计划
- preference: 喜好、禁忌、习惯
- key_quote: 说过的重点话（对关系有分量、值得记住的话）
- event: 重要事件（搬家、出游、考试、家庭变动）
- money: 财务相关（存钱、转账、AA、消费观）
- family: 家庭信息（家人、住址、家乡）

## 聊天记录（最近 200 条）
${dialog}

## 输出 JSON
{
  "facts": [
    {
      "category": "上述类别之一",
      "content": "事实描述（40字以内，保留关键细节：日期、时间、数字、原话要点）",
      "evidence": "支撑此事实的原话片段（30字以内）"
    }
  ]
}

规则：
1. 只提取聊天中明确出现的事实，不要推测或编造
2. 最多 20 条，优先信息价值高的（生日、约定、承诺、重要原话）
3. 同类信息合并为一条，不要重复
4. 只输出 JSON，不要其他内容。`
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseLLMJSON(content: string): any {
  // 尝试直接解析
  try {
    return JSON.parse(content)
  } catch {}

  // 尝试提取 JSON 块
  const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(content)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim())
    } catch {}
  }

  // 尝试找到第一个 { 和最后一个 }
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(content.slice(start, end + 1))
    } catch {}
  }

  return null
}

/**
 * 深度人物画像分析（LLM）
 */
export async function deepAnalyzePersona(messages: MessageDTO[]): Promise<DeepPersonaAnalysis | null> {
  const config = getLLMConfig()
  if (!config) return null

  const localAnalysis = analyzeContactPersona(messages)
  const prompt = buildPersonaPrompt(messages, localAnalysis)

  try {
    const response = await callLLM(config, [
      { role: 'system', content: '你是一位专业的人际关系分析师，擅长从聊天记录中分析人物性格和沟通模式。' },
      { role: 'user', content: prompt }
    ])

    const result = parseLLMJSON(response.content)
    if (!result) return null

    return {
      personality: result.personality || '',
      communicationStyle: result.communicationStyle || '',
      interests: result.interests || '',
      emotionalPattern: result.emotionalPattern || '',
      relationshipAdvice: result.relationshipAdvice || '',
      keyInsights: Array.isArray(result.keyInsights) ? result.keyInsights : []
    }
  } catch (e) {
    console.error('LLM 人物画像分析失败:', (e as Error).message)
    return null
  }
}

/**
 * 深度对话建议生成（LLM）
 */
export async function deepGenerateSuggestions(messages: MessageDTO[]): Promise<DeepSuggestions | null> {
  const config = getLLMConfig()
  if (!config) return null

  const localAnalysis = analyzeContactPersona(messages)
  const prompt = buildSuggestionPrompt(messages, localAnalysis)

  try {
    const response = await callLLM(config, [
      { role: 'system', content: '你是一位专业的人际关系顾问，擅长根据聊天内容给出具体可执行的行动建议。' },
      { role: 'user', content: prompt }
    ])

    const result = parseLLMJSON(response.content)
    if (!result || !Array.isArray(result.suggestions)) return null

    return {
      suggestions: result.suggestions.map((s: any) => ({
        category: s.category || 'general',
        content: s.content || '',
        priority: s.priority || 'medium',
        reason: s.reason || ''
      }))
    }
  } catch (e) {
    console.error('LLM 建议生成失败:', (e as Error).message)
    return null
  }
}

/**
 * 深度重要信息提取（LLM）
 */
export async function deepExtractFacts(messages: MessageDTO[]): Promise<DeepFacts | null> {
  const config = getLLMConfig()
  if (!config) return null

  const prompt = buildFactsPrompt(messages)

  try {
    const response = await callLLM(config, [
      { role: 'system', content: '你是一位个人信息整理助手，擅长从聊天记录中提取生日、约定、承诺等重要事实。' },
      { role: 'user', content: prompt }
    ])

    const result = parseLLMJSON(response.content)
    if (!result || !Array.isArray(result.facts)) return null

    return {
      facts: result.facts
        .filter((f: any) => f && typeof f.content === 'string' && f.content.trim())
        .map((f: any) => ({
          category: typeof f.category === 'string' && f.category ? f.category : 'event',
          content: String(f.content).trim(),
          evidence: typeof f.evidence === 'string' ? f.evidence.trim() : ''
        }))
        .slice(0, 20)
    }
  } catch (e) {
    console.error('LLM 重要信息提取失败:', (e as Error).message)
    return null
  }
}

/**
 * 增强版分析：LLM 优先，本地 fallback
 */
export async function enhancedAnalyzePersona(messages: MessageDTO[]): Promise<{
  local: ReturnType<typeof analyzeContactPersona>
  deep: DeepPersonaAnalysis | null
  hasLLM: boolean
}> {
  const local = analyzeContactPersona(messages)
  const deep = await deepAnalyzePersona(messages)
  return { local, deep, hasLLM: deep !== null }
}

/**
 * 增强版建议生成：LLM 优先，本地 fallback
 */
export async function enhancedGenerateSuggestions(messages: MessageDTO[]): Promise<{
  local: ReturnType<typeof generateSuggestions>
  deep: DeepSuggestions | null
  hasLLM: boolean
}> {
  const local = generateSuggestions(messages, 0)
  const deep = await deepGenerateSuggestions(messages)
  return { local, deep, hasLLM: deep !== null }
}

/**
 * 增强版重要信息提取：LLM 优先，本地关键词 fallback
 */
export async function enhancedExtractFacts(messages: MessageDTO[]): Promise<{
  facts: Array<{ category: string; content: string; evidence: string }>
  hasLLM: boolean
}> {
  const deep = await deepExtractFacts(messages)
  if (deep && deep.facts.length > 0) {
    return { facts: deep.facts, hasLLM: true }
  }
  return { facts: extractFactsLocal(messages), hasLLM: false }
}

// ==================================================================
// 分片全量分析管线（map-reduce）：全量消息分片并发提取，覆盖早期聊天内容
// ==================================================================

export interface AnalysisProgress {
  stage: 'facts' | 'persona' | 'suggestions' | 'done'
  current: number
  total: number
}

export interface PipelineFact {
  category: string
  content: string
  evidence: string
  messageId: number | null
  occursAt: string | null
}

export interface PipelineResult {
  local: ReturnType<typeof analyzeContactPersona>
  deep: DeepPersonaAnalysis | null
  hasLLM: boolean
  suggestions: {
    local: ReturnType<typeof generateSuggestions>
    deep: DeepSuggestions | null
    hasLLM: boolean
  }
  facts: PipelineFact[]
  factsHasLLM: boolean
  /** 全部分片的事实提取都失败（网络/鉴权/解析错误）。此时调用方应保留旧数据不覆盖。 */
  factsFailed: boolean
}

const SHARD_SIZE = 200        // 每片消息条数（双方），约 1 万字符 ≈ 5k token，安全
const SHARD_CONCURRENCY = 3   // LLM 并发数（DeepSeek 限速友好）

/** 参与分析的消息：排除空内容 */
function shardMessages(messages: MessageDTO[], size = SHARD_SIZE): MessageDTO[][] {
  const usable = messages.filter((m) => (m.content ?? '').trim())
  const shards: MessageDTO[][] = []
  for (let i = 0; i < usable.length; i += size) shards.push(usable.slice(i, i + size))
  return shards
}

/** 简单并发池：limit 个 worker 依次领取任务 */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 分片重要信息提取 prompt：样本带 #消息ID，要求返回证据来源 msg_id；
 * birthday/event/promise 类要求返回 occurs_at（YYYY-MM-DD 具体日 或 MM-DD 每年循环）
 */
function buildShardFactsPrompt(shard: MessageDTO[]): string {
  const first = shard[0]?.timestamp.slice(0, 10) ?? ''
  const last = shard[shard.length - 1]?.timestamp.slice(0, 10) ?? ''
  const dialog = shard
    .map((m) => {
      const who = m.senderRole === 'self' ? '我' : '对方'
      const text = (m.content ?? '').trim()
      const clipped = text.length > 60 ? `${text.slice(0, 60)}…` : text
      return `#${m.id} [${m.timestamp.slice(0, 16)}] ${who}: ${clipped}`
    })
    .join('\n')

  return `你是一位个人信息整理助手。请从以下微信聊天记录片段（${first} 至 ${last}）中提取值得长期记住的重要事实。

## 类别定义
- birthday: 生日、纪念日、重要日期
- work: 工作安排、加班时间、值班规律、假期、职业信息
- health: 健康状况、伤病、过敏、就医
- promise: 双方的承诺、约定、共同计划
- preference: 喜好、禁忌、习惯
- key_quote: 说过的重点话（对关系有分量、值得记住的话）
- event: 重要事件（搬家、出游、考试、家庭变动）
- money: 财务相关（存钱、转账、AA、消费观）
- family: 家庭信息（家人、住址、家乡）

## 聊天记录
${dialog}

## 输出 JSON
{
  "facts": [
    {
      "category": "上述类别之一",
      "content": "事实描述（40字以内，保留关键细节：日期、时间、数字、原话要点）",
      "evidence": "支撑此事实的原话片段（30字以内）",
      "msg_id": 证据所在行的消息编号（上面 # 后的数字，必须是真实存在的行）,
      "occurs_at": "日期：明确的未来事件给 YYYY-MM-DD；每年循环的生日/纪念日给 MM-DD；无法确定给 null"
    }
  ]
}

规则：
1. 只提取聊天中明确出现的事实，不要推测或编造
2. 最多 8 条，优先信息价值高的（生日、约定、承诺、重要原话）
3. 同类信息只保留最重要的一条
4. occurs_at 按本片段的时间范围推算绝对日期（如"下周三"要换算成具体日期）
5. msg_id 必须是上面列出的编号，不能杜撰
6. 只输出 JSON，不要其他内容。`
}

/** 规范化文本用于去重：剥离标点空白，忽略大小写 */
function normalizeFactText(s: string): string {
  return s.replace(/[\s，。！？、：；·…""''“”‘’（）()《》〈〉「」『』\[\]【】]/g, '').toLowerCase()
}

/** 本地去重：同类别完全重复只留一条；同类别一条包含另一条时保留较长的 */
function dedupeFacts(facts: PipelineFact[]): PipelineFact[] {
  const out: PipelineFact[] = []
  for (const f of facts) {
    const key = normalizeFactText(f.content)
    if (!key) continue
    const dup = out.findIndex(
      (o) => o.category === f.category && (normalizeFactText(o.content) === key || key.includes(normalizeFactText(o.content)) || normalizeFactText(o.content).includes(key))
    )
    if (dup === -1) {
      out.push(f)
    } else {
      // 保留信息更完整的一条（较长 content），且优先有 occursAt 的
      const old = out[dup]
      if (f.content.length > old.content.length || (!old.occursAt && f.occursAt)) {
        out[dup] = { ...f, messageId: f.messageId ?? old.messageId, occursAt: f.occursAt ?? old.occursAt }
      } else {
        out[dup] = { ...old, messageId: old.messageId ?? f.messageId, occursAt: old.occursAt ?? f.occursAt }
      }
    }
  }
  return out.slice(0, 60)
}

/** 校验并归一化分片 facts：msg_id 必须真实存在，occurs_at 必须符合格式 */
function sanitizeShardFacts(raw: any[], shard: MessageDTO[]): PipelineFact[] {
  const idSet = new Set(shard.map((m) => m.id))
  const facts: PipelineFact[] = []
  for (const f of raw) {
    if (!f || typeof f.content !== 'string' || !f.content.trim()) continue
    let msgId: number | null = null
    if (Number.isInteger(f.msg_id) && idSet.has(f.msg_id as number)) msgId = f.msg_id as number
    let occursAt: string | null = null
    if (typeof f.occurs_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.occurs_at)) occursAt = f.occurs_at
    else if (typeof f.occurs_at === 'string' && /^\d{2}-\d{2}$/.test(f.occurs_at)) occursAt = f.occurs_at
    facts.push({
      category: typeof f.category === 'string' && f.category ? f.category : 'event',
      content: String(f.content).trim(),
      evidence: typeof f.evidence === 'string' ? f.evidence.trim() : '',
      messageId: msgId,
      occursAt
    })
  }
  return facts
}

/** 单个分片的事实提取。failed=true 表示该片调用失败（区别于"成功但无事实"），供上层判断是否保留旧数据 */
async function extractShardFacts(
  config: LLMConfig,
  shard: MessageDTO[]
): Promise<{ facts: PipelineFact[]; failed: boolean }> {
  try {
    const response = await callLLM(config, [
      { role: 'system', content: '你是一位个人信息整理助手，擅长从聊天记录中提取生日、约定、承诺等重要事实，并严格输出 JSON。' },
      { role: 'user', content: buildShardFactsPrompt(shard) }
    ])
    const result = parseLLMJSON(response.content)
    if (!result || !Array.isArray(result.facts)) return { facts: [], failed: true }
    return { facts: sanitizeShardFacts(result.facts, shard), failed: false }
  } catch (e) {
    console.error(`分片事实提取失败（${shard[0]?.timestamp.slice(0, 10)}）:`, (e as Error).message)
    return { facts: [], failed: true }
  }
}

/**
 * 分片画像观察 prompt：只提炼观察要点，不做最终结论（ reduce 阶段统一合并）
 */
function buildShardPersonaPrompt(shard: MessageDTO[]): string {
  const first = shard[0]?.timestamp.slice(0, 10) ?? ''
  const last = shard[shard.length - 1]?.timestamp.slice(0, 10) ?? ''
  const dialog = shard
    .map((m) => {
      const who = m.senderRole === 'self' ? '我' : '对方'
      const text = (m.content ?? '').trim()
      const clipped = text.length > 60 ? `${text.slice(0, 60)}…` : text
      return `[${m.timestamp.slice(0, 16)}] ${who}: ${clipped}`
    })
    .join('\n')

  return `你是一位人际关系分析师。以下是 ${first} 至 ${last} 的微信聊天记录片段。请提炼关于"对方"（发送者为"对方"的消息）的观察要点。

## 聊天记录
${dialog}

## 输出 JSON
{
  "observations": [
    { "aspect": "personality|communication|interests|emotional 之一", "note": "观察要点（40字以内，附具体例子，如提到的话题/表达方式/情绪反应）" }
  ]
}

规则：
1. 只基于片段中真实出现的内容，不要编造
2. 最多 6 条，挑最有信息量的（新话题、情绪波动、习惯表达）
3. 没有任何值得注意的观察时返回 {"observations": []}，不要硬凑
4. 只输出 JSON，不要其他内容。`
}

interface PersonaObservation {
  aspect: string
  note: string
}

async function observeShardPersona(config: LLMConfig, shard: MessageDTO[]): Promise<PersonaObservation[]> {
  try {
    const response = await callLLM(config, [
      { role: 'system', content: '你是一位专业的人际关系分析师，擅长从聊天片段中提炼人物观察，并严格输出 JSON。' },
      { role: 'user', content: buildShardPersonaPrompt(shard) }
    ])
    const result = parseLLMJSON(response.content)
    if (!result || !Array.isArray(result.observations)) return []
    return result.observations
      .filter((o: any) => o && typeof o.note === 'string' && o.note.trim())
      .map((o: any) => ({ aspect: String(o.aspect || 'personality'), note: String(o.note).trim() }))
  } catch (e) {
    console.error(`分片画像观察失败（${shard[0]?.timestamp.slice(0, 10)}）:`, (e as Error).message)
    return []
  }
}

/** 合并画像：本地统计 + 各片观察 → 一次 LLM 输出最终画像 */
async function mergePersonaObservations(
  config: LLMConfig,
  localAnalysis: ReturnType<typeof analyzeContactPersona>,
  observations: PersonaObservation[]
): Promise<DeepPersonaAnalysis | null> {
  const byAspect: Record<string, string[]> = {}
  for (const o of observations) {
    ;(byAspect[o.aspect] ??= []).push(`- ${o.note}`)
  }
  const obsText = Object.entries(byAspect)
    .map(([aspect, notes]) => `### ${aspect}\n${notes.join('\n')}`)
    .join('\n\n')

  const prompt = `你是一位人际关系分析师。以下是对同一段长期聊天记录分时段提炼的观察要点，以及基础统计数据。请综合这些材料，输出对"对方"的完整画像分析。

## 基础统计
- 兴趣标签：${localAnalysis.interestTags.map((t: any) => `${t.tag}(${t.count})`).join(', ')}
- 沟通风格：平均消息长度 ${localAnalysis.communicationStyle.avgMessageLength} 字，表情频率 ${(localAnalysis.communicationStyle.emojiFrequency * 100).toFixed(1)}%
- 情感倾向：积极 ${localAnalysis.sentimentAnalysis.positive} / 中性 ${localAnalysis.sentimentAnalysis.neutral} / 消极 ${localAnalysis.sentimentAnalysis.negative}
- 总消息数：${localAnalysis.totalMessages}

## 各时段观察要点
${obsText}

## 请输出 JSON 格式的分析结果
{
  "personality": "性格特征总结（100字以内）",
  "communicationStyle": "沟通风格深度分析（100字以内）",
  "interests": "兴趣爱好深度解读（100字以内）",
  "emotionalPattern": "情感模式分析（100字以内）",
  "relationshipAdvice": "关系维护建议（100字以内）",
  "keyInsights": ["关键洞察1", "关键洞察2", "关键洞察3"]
}

要求：综合所有时段的观察，冲突的以近期观察为准；结论要有观察材料支撑。只输出 JSON，不要其他内容。`

  try {
    const response = await callLLM(config, [
      { role: 'system', content: '你是一位专业的人际关系分析师，擅长综合多来源材料形成完整人物画像。' },
      { role: 'user', content: prompt }
    ])
    const result = parseLLMJSON(response.content)
    if (!result) return null
    return {
      personality: result.personality || '',
      communicationStyle: result.communicationStyle || '',
      interests: result.interests || '',
      emotionalPattern: result.emotionalPattern || '',
      relationshipAdvice: result.relationshipAdvice || '',
      keyInsights: Array.isArray(result.keyInsights) ? result.keyInsights : []
    }
  } catch (e) {
    console.error('画像合并失败:', (e as Error).message)
    return null
  }
}

/**
 * 分片全量分析管线：
 * 1. facts：全量消息分片并发提取（带 msgId/occursAt），本地去重
 * 2. persona：分片观察 → LLM 合并成最终画像
 * 3. suggestions：保持原有单窗口逻辑
 * 无 LLM 配置时全部走本地兜底。进度通过 onProgress 上报。
 */
export async function runAnalysisPipeline(
  messages: MessageDTO[],
  onProgress?: (p: AnalysisProgress) => void
): Promise<PipelineResult> {
  const local = analyzeContactPersona(messages)
  const config = getLLMConfig()
  const shards = shardMessages(messages)
  const push = (p: AnalysisProgress) => {
    try {
      onProgress?.(p)
    } catch {}
  }

  // ---- 阶段 1：分片事实提取 ----
  let facts: PipelineFact[]
  let factsHasLLM = false
  let factsFailed = false
  if (config && shards.length > 0) {
    const shardResults = await runPool(shards, SHARD_CONCURRENCY, async (shard, i) => {
      const r = await extractShardFacts(config, shard)
      push({ stage: 'facts', current: i + 1, total: shards.length })
      return r
    })
    // 全部分片都失败（如 key 失效/断网）时结果不可信，调用方应保留旧事实而不是清空
    factsFailed = shardResults.length > 0 && shardResults.every((r) => r.failed)
    facts = dedupeFacts(shardResults.flatMap((r) => r.facts))
    factsHasLLM = true
    if (factsFailed) console.error('事实提取全部分片失败，本次不替换已有事实')
  } else {
    facts = extractFactsLocal(messages).map((f) => ({
      category: f.category,
      content: f.content,
      evidence: f.evidence,
      messageId: null,
      occursAt: null
    }))
    push({ stage: 'facts', current: 1, total: 1 })
  }

  // ---- 阶段 2：画像（分片观察 + 合并） ----
  let deep: DeepPersonaAnalysis | null = null
  if (config && shards.length > 0) {
    const observationGroups = await runPool(shards, SHARD_CONCURRENCY, async (shard, i) => {
      const r = await observeShardPersona(config, shard)
      push({ stage: 'persona', current: i + 1, total: shards.length })
      return r
    })
    deep = await mergePersonaObservations(config, local, observationGroups.flat())
  } else {
    push({ stage: 'persona', current: 1, total: 1 })
  }

  // ---- 阶段 3：建议（沿用原有窗口逻辑） ----
  const suggestions = await enhancedGenerateSuggestions(messages)
  push({ stage: 'suggestions', current: 1, total: 1 })

  return {
    local,
    deep,
    hasLLM: config !== null && deep !== null,
    suggestions,
    facts,
    factsHasLLM,
    factsFailed
  }
}

// ==================================================================
// 回复助手：基于最近对话 + 语气，生成可直接发送的回复草案
// ==================================================================

export interface ReplyDraft {
  text: string
  intent: string
}

const REPLY_TONE_HINTS: Record<string, string> = {
  natural: '自然真诚，像平时一样聊天，不刻意',
  humor: '幽默风趣，可以适当开玩笑、玩梗',
  gentle: '温柔体贴，表达关心和在意',
  serious: '认真正经，适合谈正事'
}

/**
 * 生成回复草案。返回 null 表示无 LLM 配置或调用失败。
 */
export async function generateReplyDrafts(
  messages: MessageDTO[],
  tone: string,
  selfName: string,
  peerName: string
): Promise<ReplyDraft[] | null> {
  const config = getLLMConfig()
  if (!config) return null

  // 保留所有非空内容（含 [动画表情]/[视频] 等媒体占位，LLM 能识别），
  // 确保取到的是真实最近的 20 个对话轮次；调用方须传入时间升序的消息
  const dialog = messages
    .filter((m) => (m.content ?? '').trim())
    .slice(-20)
    .map((m) => {
      const who = m.senderRole === 'self' ? selfName : m.senderRole === 'peer' ? peerName : m.sender
      const text = (m.content ?? '').trim()
      const clipped = text.length > 80 ? `${text.slice(0, 80)}…` : text
      return `[${who}] ${clipped}`
    })
    .join('\n')

  const toneHint = REPLY_TONE_HINTS[tone] ?? REPLY_TONE_HINTS.natural
  const prompt = `你是一位聊天回复助手。以下是"${selfName}"和"${peerName}"的最近对话（方括号内是说话人）。请替"${selfName}"起草 3 条回复对方最新消息的消息。

## 最近对话
${dialog}

## 语气要求
${toneHint}。要符合"${selfName}"在对话中的说话习惯，承接对方最后的话。

## 输出 JSON
{
  "drafts": [
    { "text": "回复内容（60字以内，口语化，可直接发送，不要称呼对方名字开头）", "intent": "这条回复的意图（10字以内）" }
  ]
}

规则：3 条草案角度要有差异（如：顺着说 / 抛新话题 / 表达关心）；不要使用列表序号；只输出 JSON。`

  try {
    const response = await callLLM(config, [
      { role: 'system', content: `你是"${selfName}"的聊天回复助手，帮TA起草给"${peerName}"的回复。` },
      { role: 'user', content: prompt }
    ])
    const result = parseLLMJSON(response.content)
    if (!result || !Array.isArray(result.drafts)) return null
    return result.drafts
      .filter((d: any) => d && typeof d.text === 'string' && d.text.trim())
      .map((d: any) => ({ text: String(d.text).trim(), intent: String(d.intent || '').trim() }))
      .slice(0, 3)
  } catch (e) {
    console.error('回复草案生成失败:', (e as Error).message)
    return null
  }
}
