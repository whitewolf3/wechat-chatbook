/**
 * LLM 配置弹窗：更新 API Key / Base URL / Model。
 * - Key 输入框为密码框且默认留空（占位符显示脱敏标识，如 sk-abc****wxyz），
 *   完整密钥不回显——截屏/录屏不泄露
 * - 「留空保存」= 保持现有 Key 不变（只更新 Base URL / Model）；「清空 Key」显式操作
 * - 「测试连接」用表单当前值真实调一次 LLM；Key 留空时自动用已保存的 Key 测试
 * - 「保存」写入 .env 并同步主进程环境变量，立即生效、无需重启
 */
import { useEffect, useState } from 'react'

interface Props {
  onClose: () => void
  onToast: (text: string) => void
}

export function LLMConfigDialog({ onClose, onToast }: Props): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [maskedKey, setMaskedKey] = useState('')
  const [configured, setConfigured] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  // 打开时读当前配置预填（Key 只拿脱敏标识）
  useEffect(() => {
    void (async () => {
      try {
        const c = await window.chatbook.checkLLMConfig()
        setMaskedKey(c.maskedKey ?? '')
        setConfigured(c.configured)
        setBaseUrl(c.baseUrl ?? '')
        setModel(c.model ?? '')
      } catch {
        // 读取失败时留空表单，仍可填写保存
      } finally {
        setLoaded(true)
      }
    })()
  }, [])

  const handleTest = async (): Promise<void> => {
    if (!apiKey.trim() && !configured) {
      onToast('❌ 请先填写 API Key')
      return
    }
    setTesting(true)
    try {
      const r = await window.chatbook.testLLMConfig(apiKey.trim(), baseUrl.trim(), model.trim())
      if (r.ok) onToast(`✅ 连接正常（${r.latencyMs} ms）`)
      else onToast(`❌ 连接失败：${r.error}`)
    } catch (e) {
      onToast(`❌ 测试失败：${(e as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      // Key 留空 → null（保持现有 Key 不变）；填了 → 新值
      const r = await window.chatbook.setLLMConfig(
        apiKey.trim() ? apiKey.trim() : null,
        baseUrl.trim(),
        model.trim()
      )
      if (r.success) {
        onToast(configured || apiKey.trim() ? '✅ 已保存到 .env，立即生效' : '已保存')
        onClose()
      }
    } catch (e) {
      onToast(`❌ 保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleClearKey = async (): Promise<void> => {
    setSaving(true)
    try {
      const r = await window.chatbook.setLLMConfig('', baseUrl.trim(), model.trim())
      if (r.success) {
        onToast('已清空 API Key，AI 功能将使用本地分析')
        onClose()
      }
    } catch (e) {
      onToast(`❌ 清空失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const keyPlaceholder = configured
    ? `当前 ${maskedKey}（留空保持不变）`
    : 'sk-...（DeepSeek / OpenAI 等）'

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🔑 LLM 配置</h2>
          <button className="btn small" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="llm-config-hint">
          用于人物画像 / 重要信息 / 回复助手等 AI 功能。保存后写入 .env 并立即生效，无需重启。
        </p>
        <div className="field">
          <label>API Key（{configured ? `当前 ${maskedKey}，留空保持不变` : '尚未配置'}）</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyPlaceholder}
            disabled={!loaded}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label>Base URL（留空默认 https://api.deepseek.com/v1）</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
            disabled={!loaded}
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label>Model（留空默认 deepseek-chat）</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat"
            disabled={!loaded}
            spellCheck={false}
          />
        </div>
        <div className="modal-actions">
          {configured && (
            <button className="btn" disabled={saving || !loaded} onClick={() => void handleClearKey()}>
              清空 Key
            </button>
          )}
          <button className="btn" disabled={testing || !loaded} onClick={() => void handleTest()}>
            {testing ? '⏳ 测试中…' : '🔌 测试连接'}
          </button>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={saving || !loaded} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
