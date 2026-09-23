/** 真实调用 testConfig 同款逻辑：加载 .env → callLLM 极小请求 → 返回延迟 */
require('dotenv').config()
const { getLLMConfig, callLLM } = require('../.test-build/main/ai/llm-client.js')

const config = getLLMConfig()
if (!config) { console.log('SKIP: .env 无 API Key'); process.exit(0) }
console.log('baseUrl:', config.baseUrl, 'model:', config.model, 'key尾4位:', config.apiKey.slice(-4))
const start = Date.now()
callLLM(config, [{ role: 'user', content: '请只回复：ok' }]).then((r) => {
  console.log(`✅ 连接正常（${Date.now() - start} ms），回复: ${r.content.slice(0, 20)}`)
  process.exit(0)
}).catch((e) => { console.log('❌ ' + e.message.slice(0, 160)); process.exit(1) })
