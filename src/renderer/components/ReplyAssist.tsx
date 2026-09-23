/**
 * 回复助手：基于最近对话 + 语气选择，生成可直接发送的回复草案
 * 浮动按钮挂在聊天页右下，点击展开面板
 */
import React, { useState } from 'react'
import type { ReplyDraft } from '../../shared/types'

interface ReplyAssistProps {
  conversationId: number
  onToast: (text: string) => void
}

const TONES: Array<{ value: string; label: string }> = [
  { value: 'natural', label: '😌 自然' },
  { value: 'humor', label: '😄 幽默' },
  { value: 'gentle', label: '🥰 温柔' },
  { value: 'serious', label: '😐 正经' }
]

export const ReplyAssist: React.FC<ReplyAssistProps> = ({ conversationId, onToast }) => {
  const [open, setOpen] = useState(false)
  const [tone, setTone] = useState('natural')
  const [loading, setLoading] = useState(false)
  const [drafts, setDrafts] = useState<ReplyDraft[]>([])

  const generate = async (): Promise<void> => {
    setLoading(true)
    try {
      const r = await window.chatbook.replyAssist(conversationId, tone)
      if (r.ok && r.drafts && r.drafts.length > 0) {
        setDrafts(r.drafts)
      } else if (r.error === 'no-llm') {
        onToast('需要先配置 LLM API Key（工具栏 🔑 LLM 按钮）才能使用回复助手')
      } else {
        onToast('生成失败，请稍后重试')
      }
    } catch {
      onToast('生成失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const copyDraft = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      onToast('已复制到剪贴板')
    } catch {
      onToast('复制失败')
    }
  }

  return (
    <div className="reply-assist">
      {open ? (
        <div className="ra-panel">
          <div className="ra-header">
            <span className="ra-title">💬 回复助手</span>
            <button className="ra-close" onClick={() => setOpen(false)} title="关闭">
              ✕
            </button>
          </div>

          <div className="ra-tones">
            {TONES.map((t) => (
              <button
                key={t.value}
                className={`ra-tone${tone === t.value ? ' active' : ''}`}
                onClick={() => setTone(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button className="btn primary ra-generate" disabled={loading} onClick={() => void generate()}>
            {loading ? '生成中…' : drafts.length > 0 ? '🔄 重新生成' : '✨ 生成回复草案'}
          </button>

          {drafts.length > 0 && (
            <div className="ra-drafts">
              {drafts.map((d, i) => (
                <button key={i} className="ra-draft" onClick={() => void copyDraft(d.text)} title="点击复制">
                  <span className="ra-draft-text">{d.text}</span>
                  {d.intent ? <span className="ra-draft-intent">{d.intent}</span> : null}
                </button>
              ))}
              <div className="ra-hint">点击草案即可复制，粘贴到微信发送</div>
            </div>
          )}
        </div>
      ) : (
        <button className="ra-fab" onClick={() => setOpen(true)} title="回复助手：不知道回什么？点我">
          💬
        </button>
      )}
    </div>
  )
}

export default ReplyAssist
