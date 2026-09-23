/**
 * AI 人物画像分析引擎（本地启发式分析）
 * 基于聊天记录分析对方的性格特征、兴趣爱好、沟通风格
 */
import type { MessageDTO } from '../../shared/types'

// 兴趣领域关键词词典
const INTEREST_KEYWORDS: Record<string, string[]> = {
  '旅行': ['旅行', '旅游', '出去玩', '景点', '酒店', '机票', '度假', '高铁', '飞机'],
  '美食': ['吃', '美食', '餐厅', '饭店', '菜', '火锅', '烧烤', '奶茶', '咖啡', '好吃'],
  '工作': ['工作', '上班', '加班', '开会', '项目', '客户', '领导', '同事', '加班'],
  '运动': ['运动', '健身', '跑步', '游泳', '篮球', '足球', '瑜伽', '锻炼'],
  '影视': ['电影', '电视', '剧', '综艺', '动漫', '导演', '演员', '剧情'],
  '音乐': ['音乐', '歌', '演唱会', '乐队', '歌手', '专辑'],
  '阅读': ['书', '阅读', '小说', '文章', '作者', '出版社'],
  '游戏': ['游戏', '打游戏', '王者', '吃鸡', 'LOL', '副本'],
  '家庭': ['家', '父母', '爸爸', '妈妈', '孩子', '家人', '家里'],
  '宠物': ['猫', '狗', '宠物', '猫咪', '狗狗'],
  '购物': ['买', '购物', '淘宝', '京东', '衣服', '鞋', '包'],
  '学习': ['学习', '考试', '课程', '培训', '证书', '技能']
}

// 情感词库
const POSITIVE_WORDS = ['开心', '高兴', '快乐', '喜欢', '爱', '棒', '好', '赞', '哈哈', '嘻嘻', '期待', '兴奋']
const NEGATIVE_WORDS = ['难过', '伤心', '生气', '烦', '累', '痛', '哭', '郁闷', '郁闷', '不开心', '焦虑', '压力']

// 建议触发模式（更精准的正则，避免误匹配）
const SUGGESTION_PATTERNS: Array<{ pattern: RegExp; category: string; template: string }> = [
  { pattern: /(想去|打算去|计划去|准备去)(.{2,8})(旅行|旅游|玩|出差)/, category: 'travel', template: '对方提到想去$2，可以开始规划行程了' },
  { pattern: /(生日|纪念日).*(快到了|要到了|还有.*天|快来了)/, category: 'gift', template: '对方提到特殊日子快到了，可以开始准备礼物' },
  { pattern: /(工作压力好大|最近好累|加班太多|工作太忙了|快累死了)/, category: 'care', template: '对方最近工作压力大，可以关心一下' },
  { pattern: /(身体不舒服|生病了|感冒了|发烧了|头疼|肚子疼|去医院)/, category: 'health', template: '对方身体不适，可以表达关心或提供帮助' },
  { pattern: /(好饿|饿了|想吃.*|肚子饿了|没吃饭)/, category: 'food', template: '对方饿了，可以邀请一起吃饭或推荐餐厅' },
  { pattern: /(好无聊|没事干|好闲啊|无聊死了|不知道干嘛)/, category: 'activity', template: '对方无聊，可以提议一起活动' },
  { pattern: /(想买|看中了|购物车|打折|促销|优惠券)/, category: 'shopping', template: '对方有明确购物意向，可以关注一下' },
  { pattern: /(周末|放假|休息).*(干嘛|做什么|有什么安排|一起)/, category: 'plan', template: '对方在讨论周末/假期安排，可以提议一起活动' },
  { pattern: /(最近.*忙|最近在.*|最近.*项目|最近.*考试)/, category: 'followup', template: '对方最近在忙某事，可以跟进关心进展' },
  { pattern: /(谢谢|感谢|太感谢|麻烦你了|不好意思)/, category: 'relationship', template: '对方在表达感谢，可以回应增进关系' }
]

interface PersonaAnalysis {
  interestTags: Array<{ tag: string; count: number }>
  communicationStyle: {
    avgMessageLength: number
    emojiFrequency: number
    responseSpeed: string
    activeHours: Array<{ hour: number; count: number }>
  }
  sentimentAnalysis: {
    positive: number
    neutral: number
    negative: number
  }
  topTopics: Array<{ topic: string; count: number }>
  totalMessages: number
  analyzedAt: string
}

/**
 * 分析人物画像
 */
export function analyzeContactPersona(messages: MessageDTO[]): PersonaAnalysis {
  const peerMessages = messages.filter((m) => m.senderRole === 'peer')
  
  if (peerMessages.length === 0) {
    return {
      interestTags: [],
      communicationStyle: {
        avgMessageLength: 0,
        emojiFrequency: 0,
        responseSpeed: 'unknown',
        activeHours: []
      },
      sentimentAnalysis: { positive: 0, neutral: 0, negative: 0 },
      topTopics: [],
      totalMessages: 0,
      analyzedAt: new Date().toISOString()
    }
  }

  // 1. 兴趣标签提取
  const interestCounts: Record<string, number> = {}
  for (const msg of peerMessages) {
    const content = msg.content || ''
    for (const [tag, keywords] of Object.entries(INTEREST_KEYWORDS)) {
      for (const kw of keywords) {
        if (content.includes(kw)) {
          interestCounts[tag] = (interestCounts[tag] || 0) + 1
          break
        }
      }
    }
  }
  const interestTags = Object.entries(interestCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // 2. 沟通风格统计
  const totalLength = peerMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0)
  const avgMessageLength = Math.round(totalLength / peerMessages.length)
  
  const emojiCount = peerMessages.filter((m) => /\[.*?\]|[\u{1F600}-\u{1F64F}]/u.test(m.content || '')).length
  const emojiFrequency = emojiCount / peerMessages.length

  // 活跃时段分布
  const hourCounts = new Array(24).fill(0)
  for (const msg of peerMessages) {
    const hour = new Date(msg.timestamp.replace(' ', 'T')).getHours()
    hourCounts[hour]++
  }
  const activeHours = hourCounts.map((count, hour) => ({ hour, count }))

  // 回复速度（简化：计算对方消息与上一条我的消息的时间差）
  let totalResponseTime = 0
  let responseCount = 0
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].senderRole === 'peer' && messages[i - 1].senderRole === 'self') {
      const t1 = new Date(messages[i - 1].timestamp.replace(' ', 'T')).getTime()
      const t2 = new Date(messages[i].timestamp.replace(' ', 'T')).getTime()
      const diff = (t2 - t1) / 1000 / 60 // 分钟
      if (diff > 0 && diff < 60) {
        totalResponseTime += diff
        responseCount++
      }
    }
  }
  const avgResponseMinutes = responseCount > 0 ? totalResponseTime / responseCount : 0
  const responseSpeed = avgResponseMinutes < 5 ? 'fast' : avgResponseMinutes < 30 ? 'normal' : 'slow'

  // 3. 情感倾向
  let positive = 0, negative = 0, neutral = 0
  for (const msg of peerMessages) {
    const content = msg.content || ''
    const posCount = POSITIVE_WORDS.filter((w) => content.includes(w)).length
    const negCount = NEGATIVE_WORDS.filter((w) => content.includes(w)).length
    if (posCount > negCount) positive++
    else if (negCount > posCount) negative++
    else neutral++
  }

  // 4. 高频话题（简化：统计出现最多的兴趣标签）
  const topTopics = interestTags.slice(0, 5).map((t) => ({ topic: t.tag, count: t.count }))

  return {
    interestTags,
    communicationStyle: {
      avgMessageLength,
      emojiFrequency,
      responseSpeed,
      activeHours
    },
    sentimentAnalysis: { positive, neutral, negative },
    topTopics,
    totalMessages: peerMessages.length,
    analyzedAt: new Date().toISOString()
  }
}

/**
 * 生成对话建议
 */
export function generateSuggestions(
  messages: MessageDTO[],
  conversationId: number
): Array<{ category: string; content: string; triggerMessageId?: number }> {
  const suggestions: Array<{ category: string; content: string; triggerMessageId?: number }> = []
  const peerMessages = messages.filter((m) => m.senderRole === 'peer')
  const categoryCounts: Record<string, number> = {}

  for (const msg of peerMessages) {
    // 最多 15 条建议
    if (suggestions.length >= 15) break
    
    const content = msg.content || ''
    for (const { pattern, category, template } of SUGGESTION_PATTERNS) {
      const match = pattern.exec(content)
      if (match) {
        // 同一类型建议最多 2 条，避免重复
        const currentCount = categoryCounts[category] || 0
        if (currentCount >= 2) continue
        
        let suggestionContent = template
        if (match[2]) {
          suggestionContent = template.replace(/\$\d+/g, match[2])
        }
        suggestions.push({
          category,
          content: suggestionContent,
          triggerMessageId: msg.id
        })
        categoryCounts[category] = currentCount + 1
        break // 一条消息只触发一个建议
      }
    }
  }

  return suggestions
}

/** 重要信息本地提取规则（无 LLM 时的 fallback） */
export const FACT_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /生日|出生|纪念日|几号生/, category: 'birthday' },
  { pattern: /加班|值班|几点下班|请假|上班|出差|开会/, category: 'work' },
  { pattern: /生病|感冒|发烧|疼|医院|吃药|受伤|过敏/, category: 'health' },
  { pattern: /答应|约定|说好|承诺|那就说定/, category: 'promise' },
  { pattern: /过敏|不吃|讨厌|最爱|最喜欢|习惯/, category: 'preference' },
  { pattern: /记住|永远|一直|别忘|重要的话|心里话/, category: 'key_quote' },
  { pattern: /搬家|旅游|出发|考试|入职|离职|结婚|买房/, category: 'event' },
  { pattern: /爸爸|妈妈|父母|家里|弟弟|妹妹|哥哥|姐姐|家人/, category: 'family' },
  { pattern: /存钱|工资|花钱|转账|红包|借钱|还钱/, category: 'money' }
]

export interface LocalFact {
  category: string
  content: string
  evidence: string
}

/**
 * 本地重要信息提取（关键词扫描 fallback，LLM 不可用时使用）
 */
export function extractFactsLocal(messages: MessageDTO[]): LocalFact[] {
  const facts: LocalFact[] = []
  const seen = new Set<string>()

  for (const msg of messages) {
    if (facts.length >= 20) break
    const raw = (msg.content ?? '').trim()
    // 跳过占位符和过短消息
    if (!raw || raw.startsWith('[') || raw.length < 4) continue

    for (const { pattern, category } of FACT_PATTERNS) {
      if (pattern.test(raw)) {
        const key = category + raw.slice(0, 24)
        if (seen.has(key)) break
        seen.add(key)
        facts.push({
          category,
          content: raw.length > 60 ? `${raw.slice(0, 60)}…` : raw,
          evidence: `[${msg.timestamp}] ${msg.sender || ''}`
        })
        break // 一条消息只归一类
      }
    }
  }
  return facts
}
