/** upsertEnvContent / applyLLMConfig headless 验证（临时目录，不动真实 .env） */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { upsertEnvContent, applyLLMConfig, getLLMConfig } = require('../.test-build/main/ai/llm-client.js')
const dotenv = require('../node_modules/dotenv')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')) }
}

// --- upsertEnvContent 纯函数 ---
const sample = [
  '# ChatBook LLM 配置',
  'CHATBOOK_LLM_API_KEY=old-key',
  'CHATBOOK_LLM_BASE_URL=https://api.deepseek.com/v1',
  'OTHER_VAR=keep-me',
  ''
].join('\n')

const r1 = upsertEnvContent(sample, { CHATBOOK_LLM_API_KEY: 'new-key' })
check('原位替换 key（双引号包裹）', r1.includes('CHATBOOK_LLM_API_KEY="new-key"') && !r1.includes('old-key'), r1)
check('保留注释与其他变量', r1.includes('# ChatBook LLM 配置') && r1.includes('OTHER_VAR=keep-me'), r1)
check('未动 baseUrl', r1.includes('CHATBOOK_LLM_BASE_URL=https://api.deepseek.com/v1'), r1)
check('dotenv 读回去掉引号', dotenv.parse(r1).CHATBOOK_LLM_API_KEY === 'new-key', dotenv.parse(r1))

// # 值不被 dotenv 当行内注释截断
const rh = upsertEnvContent('CHATBOOK_LLM_API_KEY=old\n', { CHATBOOK_LLM_API_KEY: 'sk-a#b$c' })
check('# 值加引号防截断', rh.includes('CHATBOOK_LLM_API_KEY="sk-a#b$c"') && dotenv.parse(rh).CHATBOOK_LLM_API_KEY === 'sk-a#b$c', rh)

// export KEY= 前缀兼容
const re = upsertEnvContent('export CHATBOOK_LLM_API_KEY=old\n', { CHATBOOK_LLM_API_KEY: 'k9' })
check('export 前缀原位替换', re === 'CHATBOOK_LLM_API_KEY="k9"\n', re)

// 同名重复定义只保留第一处（防 dotenv 重载旧值覆盖新值）
const rd = upsertEnvContent('CHATBOOK_LLM_API_KEY=v1\nCHATBOOK_LLM_API_KEY=v2\n', { CHATBOOK_LLM_API_KEY: 'v3' })
check('同名重复定义去重', rd === 'CHATBOOK_LLM_API_KEY="v3"\n', rd)
check('重复定义去重后 dotenv 读到新值', dotenv.parse(rd).CHATBOOK_LLM_API_KEY === 'v3', dotenv.parse(rd))

// CRLF 行尾保真
const rc = upsertEnvContent('A=1\r\nCHATBOOK_LLM_API_KEY=old\r\n', { CHATBOOK_LLM_API_KEY: 'k' })
check('CRLF 行尾保真', rc.includes('CHATBOOK_LLM_API_KEY="k"\r\n'), JSON.stringify(rc))
const CRLF = String.fromCharCode(13) + String.fromCharCode(10)
check('CRLF 不产生多余空行', rc.split(CRLF).length === 3, JSON.stringify(rc))
check('CRLF 文件 dotenv 正常解析', dotenv.parse(rc).CHATBOOK_LLM_API_KEY === 'k')

// 值内双引号转义
const rq = upsertEnvContent('', { CHATBOOK_LLM_API_KEY: 'a"b' })
check('值内双引号转义', rq === 'CHATBOOK_LLM_API_KEY="a\\"b"\n', rq)

// 缺失 key 追加
const r2 = upsertEnvContent(sample, { CHATBOOK_LLM_MODEL: 'gpt-4o' })
check('缺失 key 追加到末尾', r2.endsWith('CHATBOOK_LLM_MODEL="gpt-4o"\n'), r2)
check('追加时保留原有行', r2.includes('OTHER_VAR=keep-me'), r2)

const r3 = upsertEnvContent('', { CHATBOOK_LLM_API_KEY: 'k' })
check('空内容直接生成', r3 === 'CHATBOOK_LLM_API_KEY="k"\n', r3)

// --- applyLLMConfig 文件写入 + process.env 同步（临时目录） ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbook-env-'))
const envPath = path.join(dir, '.env')
fs.writeFileSync(envPath, sample, 'utf8')
applyLLMConfig(envPath, 'sk-test-123', 'https://api.openai.com/v1', 'gpt-4o-mini')
const written = fs.readFileSync(envPath, 'utf8')
check('applyLLMConfig 写入 key', written.includes('CHATBOOK_LLM_API_KEY="sk-test-123"'), written)
check('applyLLMConfig 写入 baseUrl', written.includes('CHATBOOK_LLM_BASE_URL="https://api.openai.com/v1"'), written)
check('applyLLMConfig 写入 model', written.includes('CHATBOOK_LLM_MODEL="gpt-4o-mini"'), written)
check('其他变量仍在', written.includes('OTHER_VAR=keep-me'), written)
check('写出的文件 dotenv 可直接读回', dotenv.parse(written).CHATBOOK_LLM_API_KEY === 'sk-test-123')
check('process.env 立即同步', process.env.CHATBOOK_LLM_API_KEY === 'sk-test-123' && process.env.CHATBOOK_LLM_MODEL === 'gpt-4o-mini')
check('getLLMConfig 立即用新值', getLLMConfig().baseUrl === 'https://api.openai.com/v1' && getLLMConfig().model === 'gpt-4o-mini', getLLMConfig())

// apiKey 传 null = 不更新 key（UI「留空保存」语义），其余照常更新
applyLLMConfig(envPath, null, 'https://api.deepseek.com/v1')
check('null 不更新 key', process.env.CHATBOOK_LLM_API_KEY === 'sk-test-123' && getLLMConfig().apiKey === 'sk-test-123')
check('null 时 baseUrl 仍更新', getLLMConfig().baseUrl === 'https://api.deepseek.com/v1', getLLMConfig())
check('null 不改写 key 行', fs.readFileSync(envPath, 'utf8').includes('CHATBOOK_LLM_API_KEY="sk-test-123"'))

// 清空 key
applyLLMConfig(envPath, '')
check('清空 key 后 getLLMConfig 返回 null', getLLMConfig() === null)
check('清空后文件保留结构', fs.readFileSync(envPath, 'utf8').includes('CHATBOOK_LLM_API_KEY=""') && fs.readFileSync(envPath, 'utf8').includes('OTHER_VAR=keep-me'))

// 文件不存在时新建
const newPath = path.join(dir, 'sub', '.env')
applyLLMConfig(newPath, 'k2')
check('不存在时自动建目录与文件', fs.readFileSync(newPath, 'utf8') === 'CHATBOOK_LLM_API_KEY="k2"\n')

// 幂等：重复写同样内容
applyLLMConfig(newPath, 'k2')
check('重复写入幂等', fs.readFileSync(newPath, 'utf8').split('CHATBOOK_LLM_API_KEY="k2"').length === 2)

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
