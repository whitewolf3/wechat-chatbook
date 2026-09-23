/**
 * 智能分析增强 headless 验证（真实数据）
 * A. 迁移：contact_fact 加列 message_id / occurs_at（幂等）
 * B. listFacts 新字段 + getTrendStats 按月统计
 * C. runAnalysisPipeline 全量分片管线（真实 LLM）：facts 带 msgId/occursAt、画像合并、建议、回复草案
 *
 * 前置：tsc 编译到 .test-build（见 package.json 外手动命令）
 * 运行：ELECTRON_RUN_AS_NODE=1 electron scripts/test-smart-analysis.js
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') })

const { ChatDatabase } = require('../.test-build/main/db/database.js')
const { runAnalysisPipeline, generateReplyDrafts } = require('../.test-build/main/ai/enhanced-analyzer.js')

const DB_PATH = process.env.CHATBOOK_DB_PATH || `${process.env.HOME}/Documents/ChatBook/chatbook.db`
const CONV_ID = 2

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')) }
}

async function main() {
  console.log('[A] 迁移与 facts/trends DB 层')
  const db = new ChatDatabase(DB_PATH)

  const cols = db.db.prepare('PRAGMA table_info(contact_fact)').all().map((c) => c.name)
  check('contact_fact 有 message_id 列', cols.includes('message_id'), cols)
  check('contact_fact 有 occurs_at 列', cols.includes('occurs_at'), cols)

  const facts = db.listFacts(CONV_ID)
  check('listFacts 返回数组', Array.isArray(facts))
  if (facts.length > 0) {
    const f0 = facts[0]
    check('fact 带 messageId 字段', 'messageId' in f0, Object.keys(f0))
    check('fact 带 occursAt 字段', 'occursAt' in f0, Object.keys(f0))
  }

  const trends = db.getTrendStats(CONV_ID)
  check('trends 非空数组', Array.isArray(trends) && trends.length > 0, trends)
  if (trends.length > 0) {
    const t0 = trends[trends.length - 1]
    check('trend 桶字段齐全', ['month','selfCount','peerCount','selfInitiated','peerInitiated','selfReplyMin','peerReplyMin'].every((k) => k in t0), t0)
    console.log('  最近一月趋势:', JSON.stringify(t0))
    const totalCount = trends.reduce((s, t) => s + t.selfCount + t.peerCount, 0)
    check('trends 消息总量与会话一致', totalCount > 0, totalCount)
  }

  console.log('[C] 分片全量分析管线（真实 LLM，约 2-4 分钟）')
  const messages = db.listMessages(CONV_ID, { limit: 100000 })
  console.log(`  消息总量: ${messages.length}`)

  const t0 = Date.now()
  let lastStage = ''
  const result = await runAnalysisPipeline(messages, (p) => {
    const label = `${p.stage} ${p.current}/${p.total}`
    if (label !== lastStage) {
      lastStage = label
      console.log(`  [progress] ${label} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    }
  })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`  管线耗时: ${secs}s`)

  check('facts 非空', result.facts.length > 0, result.facts.length)
  check('facts 数量 >= 20（全量分片应多于旧窗口 20 条上限）', result.facts.length >= 20, result.facts.length)
  const withMsg = result.facts.filter((f) => f.messageId !== null)
  check('facts 大部分带 msgId', withMsg.length >= result.facts.length * 0.5, `${withMsg.length}/${result.facts.length}`)
  const msgIdSet = new Set(messages.map((m) => m.id))
  const badMsgId = withMsg.filter((f) => !msgIdSet.has(f.messageId))
  check('msgId 全部真实存在', badMsgId.length === 0, badMsgId.slice(0, 3))
  const withOccurs = result.facts.filter((f) => f.occursAt !== null)
  check('有 occursAt 的 facts', withOccurs.length > 0, withOccurs.length)
  const badOccurs = result.facts.filter((f) => f.occursAt !== null && !/^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}$/.test(f.occursAt))
  check('occursAt 格式全部合法', badOccurs.length === 0, badOccurs.slice(0, 3))
  console.log('  带日期 facts 示例:', JSON.stringify(withOccurs.slice(0, 5).map((f) => ({ c: f.category, d: f.occursAt, t: f.content.slice(0, 20) }))))

  check('LLM 画像非空', result.hasLLM && result.deep !== null)
  if (result.deep) {
    check('画像五维齐全', ['personality','communicationStyle','interests','emotionalPattern','relationshipAdvice'].every((k) => result.deep[k]), Object.keys(result.deep))
  }
  const sugCount = result.suggestions.deep ? result.suggestions.deep.suggestions.length : result.suggestions.local.length
  check('建议非空', sugCount > 0, sugCount)

  console.log('[C2] 回复助手（真实 LLM）')
  const drafts = await generateReplyDrafts(messages, 'natural', '阿白', '小雨')
  check('回复草案非空', drafts !== null && drafts.length > 0, drafts)
  if (drafts) {
    check('草案 1-3 条', drafts.length >= 1 && drafts.length <= 3, drafts.length)
    console.log('  草案示例:', JSON.stringify(drafts.map((d) => d.text.slice(0, 30))))
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常:', e)
  process.exit(1)
})
