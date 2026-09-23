/**
 * 时间解析与格式化：兼容常见中英文写法
 */

const DT_FULL =
  /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?[\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/
const DT_TIME_ONLY = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/

/** 解析时间字符串；仅时分秒时需 base 提供日期上下文 */
export function parseDateTime(input: string, base?: Date): Date | null {
  const s = input.trim()
  if (!s) return null

  // ISO 格式直接交给 Date
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }

  const m = DT_FULL.exec(s)
  if (m) {
    const [, y, mo, d, h, mi, se] = m
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), se ? Number(se) : 0)
    return isNaN(dt.getTime()) ? null : dt
  }

  const t = DT_TIME_ONLY.exec(s)
  if (t && base) {
    const dt = new Date(base)
    dt.setHours(Number(t[1]), Number(t[2]), t[3] ? Number(t[3]) : 0, 0)
    return isNaN(dt.getTime()) ? null : dt
  }
  return null
}

/** Date → YYYY-MM-DD HH:mm:ss（本地时间，可排序） */
export function formatTimestamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** '2026-09-20' → '2026-09-20 星期日' */
export function formatDateLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  if (isNaN(d.getTime())) return day
  return `${day} 星期${WEEKDAYS[d.getDay()]}`
}
