const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** '2026-09-20' → '2026-09-20 星期日'（渲染进程用，避免依赖主进程模块） */
export function formatDateLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  if (isNaN(d.getTime())) return day
  return `${day} 星期${WEEKDAYS[d.getDay()]}`
}
