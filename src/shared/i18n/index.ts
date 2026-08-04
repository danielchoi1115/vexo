import { en, type MessageTree } from './en'
import { ko } from './ko'

export type LocaleId = 'en' | 'ko'

const catalogs: Record<LocaleId, MessageTree> = { en, ko }

export type { MessageTree }

/** Dot-path keys into MessageTree, e.g. "settings.title" */
export type MessageKey = string

function getByPath(obj: unknown, path: string): string | undefined {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return typeof cur === 'string' ? cur : undefined
}

export function t(
  locale: LocaleId,
  key: string,
  vars?: Record<string, string | number>
): string {
  const catalog = catalogs[locale] ?? en
  let text = getByPath(catalog, key) ?? getByPath(en, key) ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
}

export { en, ko }
