/**
 * 人物画像展示面板
 */
import React from 'react'
import type { MonthlyTrend } from '../../shared/types'

interface PersonaPanelProps {
  persona: any
  /** 按月关系趋势（stats:trends 本地统计），无数据或加载中传 null */
  trends?: MonthlyTrend[] | null
}

export const PersonaPanel: React.FC<PersonaPanelProps> = ({ persona, trends }) => {
  // 处理各种可能的数据结构
  const hasData = persona && (persona.local || persona.interestTags || persona.deep)
  
  if (!hasData) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#999' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}></div>
        <div>还没有人物画像</div>
        <div style={{ fontSize: '12px', marginTop: '8px' }}>
          点击右上角「✨ 分析人物画像」按钮开始分析
        </div>
      </div>
    )
  }

  // 兼容两种数据结构：{local, deep, hasLLM} 或直接是本地分析结果
  const local = persona.local || persona
  const deep = persona.deep
  const hasLLM = persona.hasLLM || false

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      {/* LLM 深度分析 */}
      {hasLLM && deep && (
        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
             LLM 深度分析
          </h3>
          
          <div style={{ display: 'grid', gap: '16px' }}>
            <InfoCard title="性格特征" content={deep.personality} color="#3b82f6" />
            <InfoCard title="沟通风格" content={deep.communicationStyle} color="#8b5cf6" />
            <InfoCard title="兴趣爱好" content={deep.interests} color="#10b981" />
            <InfoCard title="情感模式" content={deep.emotionalPattern} color="#f59e0b" />
            <InfoCard title="关系建议" content={deep.relationshipAdvice} color="#ef4444" />
            
            {deep.keyInsights && deep.keyInsights.length > 0 && (
              <div style={{ background: '#f3f4f6', borderRadius: '12px', padding: '16px' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#1f2937' }}>
                  💡 关键洞察
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', lineHeight: '1.8', color: '#374151' }}>
                  {deep.keyInsights.map((insight: string, i: number) => (
                    <li key={i}>{insight}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 本地分析数据 */}
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
          📊 本地分析数据
          {hasLLM && <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>（基础统计）</span>}
        </h3>

        {/* 兴趣标签 */}
        {local.interestTags && local.interestTags.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '12px', color: '#374151' }}>
              兴趣标签
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {local.interestTags.map((tag: any, idx: number) => (
                <span
                  key={tag.tag || idx}
                  style={{
                    padding: '6px 12px',
                    background: '#e0e7ff',
                    color: '#3730a3',
                    borderRadius: '16px',
                    fontSize: '13px',
                    fontWeight: '500'
                  }}
                >
                  {tag.tag} ({tag.count})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 沟通风格 */}
        {local.communicationStyle && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '12px', color: '#374151' }}>
              沟通风格
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              <StatBox label="平均消息长度" value={`${local.communicationStyle.avgMessageLength || 0} 字`} />
              <StatBox label="回复速度" value={local.communicationStyle.responseSpeed === 'fast' ? '快' : local.communicationStyle.responseSpeed === 'normal' ? '正常' : '慢'} />
              <StatBox label="表情频率" value={`${((local.communicationStyle.emojiFrequency || 0) * 100).toFixed(1)}%`} />
              <StatBox label="总消息数" value={(local.totalMessages || 0).toString()} />
            </div>
          </div>
        )}

        {/* 情感倾向 */}
        {local.sentimentAnalysis && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '12px', color: '#374151' }}>
              情感倾向
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <SentimentBar
                positive={local.sentimentAnalysis.positive || 0}
                neutral={local.sentimentAnalysis.neutral || 0}
                negative={local.sentimentAnalysis.negative || 0}
              />
            </div>
            <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
              <span>😊 积极 {local.sentimentAnalysis.positive || 0}</span>
              <span>😐 中性 {local.sentimentAnalysis.neutral || 0}</span>
              <span> 消极 {local.sentimentAnalysis.negative || 0}</span>
            </div>
          </div>
        )}

        {/* 活跃时段 */}
        {local.communicationStyle?.activeHours && local.communicationStyle.activeHours.length > 0 && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '12px', color: '#374151' }}>
              活跃时段分布
            </div>
            <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '100px' }}>
              {local.communicationStyle.activeHours.map((h: any, idx: number) => {
                const maxCount = Math.max(...local.communicationStyle.activeHours.map((x: any) => x.count))
                const height = maxCount > 0 ? (h.count / maxCount) * 100 : 0
                return (
                  <div
                    key={h.hour || idx}
                    style={{
                      flex: 1,
                      height: `${height}%`,
                      background: '#3b82f6',
                      borderRadius: '2px 2px 0 0',
                      minHeight: h.count > 0 ? '4px' : '0',
                      position: 'relative'
                    }}
                    title={`${h.hour}:00 - ${h.count} 条消息`}
                  />
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#9ca3af', marginTop: '4px' }}>
              <span>0:00</span>
              <span>6:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>23:00</span>
            </div>
          </div>
        )}
      </div>

      {/* 关系趋势（本地按月统计） */}
      {trends && trends.length > 0 && (
        <div style={{ marginTop: '32px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
            📈 关系趋势
            <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>（按月统计，最近 12 个月）</span>
          </h3>
          <TrendCharts trends={trends} />
        </div>
      )}
    </div>
  )
}

// 信息卡片组件
const InfoCard: React.FC<{ title: string; content: string; color: string }> = ({ title, content, color }) => (
  <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '16px', borderLeft: `4px solid ${color}` }}>
    <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color }}>{title}</div>
    <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#374151' }}>{content}</div>
  </div>
)

// 统计框组件
const StatBox: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ background: '#f3f4f6', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{label}</div>
    <div style={{ fontSize: '18px', fontWeight: '600', color: '#1f2937' }}>{value}</div>
  </div>
)

// 情感条组件
const SentimentBar: React.FC<{ positive: number; neutral: number; negative: number }> = ({ positive, neutral, negative }) => {
  const total = positive + neutral + negative
  if (total === 0) return null
  
  const posPct = (positive / total) * 100
  const neuPct = (neutral / total) * 100
  const negPct = (negative / total) * 100

  return (
    <div style={{ display: 'flex', height: '24px', borderRadius: '12px', overflow: 'hidden', width: '100%', maxWidth: '400px' }}>
      <div style={{ width: `${posPct}%`, background: '#10b981' }} />
      <div style={{ width: `${neuPct}%`, background: '#9ca3af' }} />
      <div style={{ width: `${negPct}%`, background: '#ef4444' }} />
    </div>
  )
}

const TREND_SELF = '#3b82f6'
const TREND_PEER = '#10b981'

/** 分钟格式化为可读文本 */
function fmtMin(min: number | null): string {
  if (min === null) return '—'
  if (min < 60) return `${min}分`
  return `${(min / 60).toFixed(1)}小时`
}

/** 月份标签：2026-08 → 08月；跨年首月带年份 */
function monthLabel(month: string, prevMonth: string | null): string {
  const ym = month.split('-')
  if (prevMonth && prevMonth.slice(0, 4) !== ym[0]) return `${ym[0].slice(2)}/${ym[1]}`
  return `${ym[1]}月`
}

/**
 * 关系趋势三图：月消息量（双系列柱）、主动比例（100% 堆叠条）、平均回复时长（折线）
 * 纯 SVG/div 实现，无图表库依赖
 */
const TrendCharts: React.FC<{ trends: MonthlyTrend[] }> = ({ trends }) => {
  const data = trends.slice(-12)

  // ---- 图 1：月消息量双系列柱状 ----
  const W = 720
  const H = 150
  const PAD_B = 20
  const PAD_T = 10
  const maxCount = Math.max(1, ...data.map((t) => Math.max(t.selfCount, t.peerCount)))
  const groupW = W / data.length
  const barW = Math.min(14, groupW / 3)

  // ---- 图 3：回复时长折线 ----
  const LW = 720
  const LH = 140
  const LPAD_B = 22
  const LPAD_T = 14
  const maxMin = Math.max(10, ...data.flatMap((t) => [t.selfReplyMin ?? 0, t.peerReplyMin ?? 0]))
  const xOf = (i: number): number => (data.length > 1 ? (i / (data.length - 1)) * LW : LW / 2)
  const yOf = (v: number): number => LH - LPAD_B - (v / maxMin) * (LH - LPAD_B - LPAD_T)

  // 折线分段（null 点断开）
  const linePath = (key: 'selfReplyMin' | 'peerReplyMin'): string => {
    let d = ''
    data.forEach((t, i) => {
      const v = t[key]
      if (v === null) return
      d += `${d ? ' L' : 'M'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`
    })
    return d
  }

  return (
    <div style={{ display: 'grid', gap: '24px' }}>
      {/* 月消息量 */}
      <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
          月消息量
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
          <span style={{ color: TREND_SELF }}>■</span> 我{'　'}
          <span style={{ color: TREND_PEER }}>■</span> 对方
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {data.map((t, i) => {
            const gx = i * groupW + groupW / 2
            const selfH = (t.selfCount / maxCount) * (H - PAD_B - PAD_T)
            const peerH = (t.peerCount / maxCount) * (H - PAD_B - PAD_T)
            return (
              <g key={t.month}>
                <rect
                  x={gx - barW - 1}
                  y={H - PAD_B - selfH}
                  width={barW}
                  height={selfH}
                  rx={2}
                  fill={TREND_SELF}
                >
                  <title>{`${t.month} 我：${t.selfCount} 条`}</title>
                </rect>
                <rect
                  x={gx + 1}
                  y={H - PAD_B - peerH}
                  width={barW}
                  height={peerH}
                  rx={2}
                  fill={TREND_PEER}
                >
                  <title>{`${t.month} 对方：${t.peerCount} 条`}</title>
                </rect>
                <text x={gx} y={H - 6} textAnchor="middle" fontSize="10" fill="#9ca3af">
                  {monthLabel(t.month, i > 0 ? data[i - 1].month : null)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* 主动比例 */}
      <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
          主动开启话题比例
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '10px' }}>
          2 小时无对话后先开口的一方（按月）
        </div>
        <div style={{ display: 'grid', gap: '8px' }}>
          {data.map((t, i) => {
            const total = t.selfInitiated + t.peerInitiated
            const selfPct = total > 0 ? Math.round((t.selfInitiated / total) * 100) : 50
            return (
              <div key={t.month} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#6b7280', width: '38px', flexShrink: 0 }}>
                  {monthLabel(t.month, i > 0 ? data[i - 1].month : null)}
                </span>
                <div style={{ flex: 1, display: 'flex', height: '14px', borderRadius: '7px', overflow: 'hidden', background: '#e5e7eb' }}>
                  <div
                    style={{ width: `${selfPct}%`, background: TREND_SELF, transition: 'width .3s' }}
                    title={`我主动 ${t.selfInitiated} 次`}
                  />
                  <div
                    style={{ width: `${100 - selfPct}%`, background: TREND_PEER, transition: 'width .3s' }}
                    title={`对方主动 ${t.peerInitiated} 次`}
                  />
                </div>
                <span style={{ fontSize: '11px', color: '#6b7280', width: '64px', flexShrink: 0, textAlign: 'right' }}>
                  {total > 0 ? `我 ${selfPct}%` : '无数据'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 平均回复时长 */}
      <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
          平均回复时长
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '8px' }}>
          对方发消息后我多快回（<span style={{ color: TREND_SELF }}>— 我</span>）/ 对方多快回（
          <span style={{ color: TREND_PEER }}>— 对方</span>），24 小时以上不计
        </div>
        <svg viewBox={`0 0 ${LW} ${LH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* 网格参考线 */}
          {[0.25, 0.5, 0.75, 1].map((r) => (
            <line
              key={r}
              x1={0}
              x2={LW}
              y1={yOf(maxMin * r)}
              y2={yOf(maxMin * r)}
              stroke="#e5e7eb"
              strokeDasharray="3 3"
            />
          ))}
          <path d={linePath('selfReplyMin')} fill="none" stroke={TREND_SELF} strokeWidth={2} />
          <path d={linePath('peerReplyMin')} fill="none" stroke={TREND_PEER} strokeWidth={2} />
          {data.map((t, i) => (
            <g key={t.month}>
              {t.selfReplyMin !== null && (
                <circle cx={xOf(i)} cy={yOf(t.selfReplyMin)} r={3} fill={TREND_SELF}>
                  <title>{`${t.month} 我平均 ${fmtMin(t.selfReplyMin)}回复`}</title>
                </circle>
              )}
              {t.peerReplyMin !== null && (
                <circle cx={xOf(i)} cy={yOf(t.peerReplyMin)} r={3} fill={TREND_PEER}>
                  <title>{`${t.month} 对方平均 ${fmtMin(t.peerReplyMin)}回复`}</title>
                </circle>
              )}
              <text x={xOf(i)} y={LH - 6} textAnchor="middle" fontSize="10" fill="#9ca3af">
                {monthLabel(t.month, i > 0 ? data[i - 1].month : null)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
