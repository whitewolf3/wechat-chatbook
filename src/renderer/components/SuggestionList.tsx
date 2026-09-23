/**
 * 对话建议列表组件
 */
import React, { useState } from 'react'

interface Suggestion {
  id: number
  category: string
  content: string
  createdAt: string
}

interface SuggestionListProps {
  conversationId: number
  suggestions: Suggestion[]
  onRefresh: () => void
}

const CATEGORY_ICONS: Record<string, string> = {
  travel: '✈️',
  food: '🍜',
  care: '',
  health: '🏥',
  activity: '🎯',
  shopping: '🛍️',
  relationship: '💬',
  followup: '📌',
  plan: '📅',
  gift: ''
}

const CATEGORY_LABELS: Record<string, string> = {
  travel: '旅行',
  food: '美食',
  care: '关心',
  health: '健康',
  activity: '活动',
  shopping: '购物',
  relationship: '关系',
  followup: '跟进',
  plan: '计划',
  gift: '礼物'
}

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: '#ef4444',
  MEDIUM: '#f59e0b',
  LOW: '#6b7280'
}

export const SuggestionList: React.FC<SuggestionListProps> = ({ conversationId, suggestions, onRefresh }) => {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  const handleDismiss = async (id: number) => {
    await window.chatbook.updateSuggestionStatus(id, 'dismissed')
    setDismissed((prev) => new Set(prev).add(id))
    onRefresh()
  }

  const handleAcknowledge = async (id: number) => {
    await window.chatbook.updateSuggestionStatus(id, 'acknowledged')
    setDismissed((prev) => new Set(prev).add(id))
    onRefresh()
  }

  if (suggestions.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#999' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>💡</div>
        <div>还没有建议</div>
        <div style={{ fontSize: '12px', marginTop: '8px' }}>
          点击「分析人物画像」按钮生成建议
        </div>
      </div>
    )
  }

  const activeSuggestions = suggestions.filter((s) => !dismissed.has(s.id))

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
        共 {suggestions.length} 条建议，已处理 {dismissed.size} 条
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {activeSuggestions.map((suggestion) => {
          const icon = CATEGORY_ICONS[suggestion.category] || '💡'
          const label = CATEGORY_LABELS[suggestion.category] || suggestion.category
          
          // 解析优先级（如果内容包含 [HIGH] 等标记）
          let priority = 'MEDIUM'
          let content = suggestion.content
          const priorityMatch = /^\[(HIGH|MEDIUM|LOW)\]\s*/.exec(suggestion.content)
          if (priorityMatch) {
            priority = priorityMatch[1]
            content = suggestion.content.slice(priorityMatch[0].length)
          }

          return (
            <div
              key={suggestion.id}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '12px',
                padding: '16px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
              }}
            >
              {/* 头部 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '20px' }}>{icon}</span>
                <span style={{ fontSize: '13px', fontWeight: '500', color: '#374151' }}>{label}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    padding: '2px 8px',
                    background: PRIORITY_COLORS[priority],
                    color: '#fff',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: '600'
                  }}
                >
                  {priority}
                </span>
              </div>

              {/* 内容 */}
              <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#1f2937', marginBottom: '12px' }}>
                {content}
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => handleAcknowledge(suggestion.id)}
                  style={{
                    padding: '6px 12px',
                    border: 'none',
                    borderRadius: '6px',
                    background: '#10b981',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '500'
                  }}
                >
                  ✓ 已采纳
                </button>
                <button
                  onClick={() => handleDismiss(suggestion.id)}
                  style={{
                    padding: '6px 12px',
                    border: 'none',
                    borderRadius: '6px',
                    background: '#e5e7eb',
                    color: '#6b7280',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '500'
                  }}
                >
                   忽略
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {activeSuggestions.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#999' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
          <div>所有建议已处理完毕</div>
        </div>
      )}
    </div>
  )
}
