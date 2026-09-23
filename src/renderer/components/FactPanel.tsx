/**
 * 重要信息面板：自动总结生日、加班、承诺、重点话等关键事实
 * 顶部展示 30 天内到期的事件；卡片可定位回聊天上下文
 */
import React from 'react'
import type { FactDTO } from '../../shared/types'

interface FactPanelProps {
  facts: FactDTO[]
  analyzing: boolean
  onAnalyze: () => void
  /** 定位到聊天上下文（传入来源消息 id） */
  onLocate?: (messageId: number) => void
}

const FACT_META: Record<string, { label: string; icon: string; color: string }> = {
  birthday: { label: '生日 / 纪念日', icon: '🎂', color: '#ec4899' },
  promise: { label: '承诺 / 约定', icon: '🤝', color: '#8b5cf6' },
  key_quote: { label: '重点话', icon: '💬', color: '#ef4444' },
  work: { label: '工作 / 加班', icon: '💼', color: '#3b82f6' },
  health: { label: '健康', icon: '💊', color: '#10b981' },
  preference: { label: '偏好 / 禁忌', icon: '💛', color: '#f59e0b' },
  event: { label: '重要事件', icon: '🎯', color: '#6366f1' },
  money: { label: '财务', icon: '💰', color: '#14b8a6' },
  family: { label: '家庭', icon: '🏠', color: '#f97316' }
}

/** 展示顺序：重要的类别靠前 */
const CATEGORY_ORDER = [
  'birthday',
  'promise',
  'key_quote',
  'work',
  'health',
  'preference',
  'event',
  'money',
  'family'
]

/**
 * 计算 occursAt 距今天的天数。
 * YYYY-MM-DD：具体日期直接比；MM-DD：每年循环，今年已过超半年则看明年。
 * 无法解析返回 null。
 */
function daysUntil(occursAt: string, today: Date): number | null {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const diffOf = (d: Date): number => Math.round((d.getTime() - t0) / 86400000)
  if (/^\d{4}-\d{2}-\d{2}$/.test(occursAt)) {
    return diffOf(new Date(`${occursAt}T00:00:00`))
  }
  if (/^\d{2}-\d{2}$/.test(occursAt)) {
    const [m, day] = occursAt.split('-').map(Number)
    let diff = diffOf(new Date(today.getFullYear(), m - 1, day))
    if (diff < -180) diff = diffOf(new Date(today.getFullYear() + 1, m - 1, day))
    return diff
  }
  return null
}

export const FactPanel: React.FC<FactPanelProps> = ({ facts, analyzing, onAnalyze, onLocate }) => {
  if (facts.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#999' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📌</div>
        <div>还没有重要信息</div>
        <div style={{ fontSize: '12px', marginTop: '8px', marginBottom: '20px' }}>
          分析后会自动总结生日、加班时间、说过的重点话等内容
        </div>
        <button
          onClick={onAnalyze}
          disabled={analyzing}
          style={{
            padding: '8px 20px',
            border: 'none',
            borderRadius: '8px',
            background: analyzing ? '#9ca3af' : '#3b82f6',
            color: '#fff',
            cursor: analyzing ? 'wait' : 'pointer',
            fontSize: '13px',
            fontWeight: '500'
          }}
        >
          {analyzing ? '分析中…' : '✨ 开始分析'}
        </button>
      </div>
    )
  }

  // 按类别分组，未知类别归入「其他」
  const groups = new Map<string, FactDTO[]>()
  for (const f of facts) {
    const key = FACT_META[f.category] ? f.category : 'other'
    const arr = groups.get(key)
    if (arr) arr.push(f)
    else groups.set(key, [f])
  }
  const orderedKeys = [
    ...CATEGORY_ORDER.filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !CATEGORY_ORDER.includes(k))
  ]

  // 近期到期（今天~30 天内，或刚过期 3 天内）：今天/生日/约定置顶提醒
  const today = new Date()
  const upcoming = facts
    .filter((f) => f.occursAt)
    .map((f) => ({ fact: f, diff: daysUntil(f.occursAt as string, today) }))
    .filter((u): u is { fact: FactDTO; diff: number } => u.diff !== null && u.diff >= -3 && u.diff <= 30)
    .sort((a, b) => a.diff - b.diff)

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
        共 {facts.length} 条重要信息，来自全量聊天记录的分片分析
      </div>

      {upcoming.length > 0 && (
        <div className="fact-upcoming">
          <div className="fu-title">📅 近期关注</div>
          {upcoming.map(({ fact, diff }) => (
            <div className="fu-item" key={fact.id}>
              <span className={`fu-badge${diff <= 7 && diff >= 0 ? ' soon' : ''}`}>
                {diff === 0 ? '今天' : diff > 0 ? `${diff} 天后` : `${-diff} 天前`}
              </span>
              <span className="fu-content">{fact.content}</span>
            </div>
          ))}
        </div>
      )}

      {orderedKeys.map((key) => {
        const meta = FACT_META[key] ?? { label: '其他', icon: '📋', color: '#6b7280' }
        const list = groups.get(key) ?? []
        return (
          <section key={key} style={{ marginBottom: '24px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '10px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151'
              }}
            >
              <span style={{ fontSize: '18px' }}>{meta.icon}</span>
              <span>{meta.label}</span>
              <span
                style={{
                  padding: '1px 8px',
                  borderRadius: '10px',
                  background: `${meta.color}1a`,
                  color: meta.color,
                  fontSize: '11px',
                  fontWeight: '600'
                }}
              >
                {list.length}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {list.map((f) => (
                <div
                  key={f.id}
                  style={{
                    background: '#fff',
                    border: '1px solid #e5e7eb',
                    borderLeft: `3px solid ${meta.color}`,
                    borderRadius: '10px',
                    padding: '12px 16px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
                  }}
                >
                  <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#1f2937' }}>
                    {f.content}
                  </div>
                  {f.evidence ? (
                    <div className="fact-evidence">
                      <span
                        style={{
                          fontSize: '12px',
                          color: '#9ca3af',
                          lineHeight: '1.5'
                        }}
                      >
                        依据：{f.evidence}
                      </span>
                      {f.messageId != null && onLocate ? (
                        <button
                          className="fact-locate"
                          onClick={() => onLocate(f.messageId as number)}
                          title="定位到聊天上下文"
                        >
                          ↗ 定位
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export default FactPanel
