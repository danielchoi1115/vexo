import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'

/**
 * True only for real app form fields — NOT xterm's helper textarea
 * (xterm focuses a hidden <textarea>, which would otherwise block shortcuts).
 */
function isAppFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  if (
    target.classList.contains('xterm-helper-textarea') ||
    target.closest('.xterm') ||
    target.closest('.terminal-host')
  ) {
    return false
  }

  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function isArrowLeft(key: string): boolean {
  return key === 'ArrowLeft' || key === 'Left'
}

function isArrowRight(key: string): boolean {
  return key === 'ArrowRight' || key === 'Right'
}

type ArrowAction = 'tab-next' | 'tab-prev'

/** Dedupe main IPC + DOM keydown when both fire for the same keypress */
let lastArrowAction: ArrowAction | null = null
let lastArrowAt = 0

function runArrowAction(action: ArrowAction): void {
  const now = Date.now()
  if (action === lastArrowAction && now - lastArrowAt < 80) return
  lastArrowAction = action
  lastArrowAt = now

  useAppStore.getState().cycleTab(action === 'tab-next' ? 'next' : 'prev')
}

/**
 * Global app shortcuts (capture phase so they work while xterm has focus).
 *
 * - Ctrl+W — close focused tab
 * - Ctrl+Left / Ctrl+Right — prev / next tab (all panes, visual order)
 * - Ctrl+Tab / Ctrl+Shift+Tab — next / prev tab (same)
 * - Ctrl+B — toggle sidebar
 * - Ctrl+, — open settings
 */
export function useAppShortcuts(): void {
  useEffect(() => {
    const offIpc =
      typeof window !== 'undefined' && window.api?.app?.onShortcut
        ? window.api.app.onShortcut((payload) => {
            if (payload.action === 'tab-next' || payload.action === 'tab-prev') {
              runArrowAction(payload.action)
            }
          })
        : undefined

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.isComposing) return

      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return

      const key = e.key
      const lower = key.length === 1 ? key.toLowerCase() : key
      const inForm = isAppFormField(e.target)

      // Ctrl+B — toggle sidebar
      if (!e.shiftKey && !e.altKey && (lower === 'b' || key === 'B')) {
        e.preventDefault()
        e.stopPropagation()
        useAppStore.getState().toggleSidebar()
        return
      }

      // Ctrl+, — settings
      if (!e.shiftKey && !e.altKey && (key === ',' || key === 'Comma')) {
        e.preventDefault()
        e.stopPropagation()
        useAppStore.getState().setSettingsOpen(true)
        return
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — next / prev tab (cross-pane visual order)
      if (key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        useAppStore.getState().cycleTab(e.shiftKey ? 'prev' : 'next')
        return
      }

      // Ctrl(+Shift)+Left / Right — same tab cycle (Shift no longer means pane move)
      if ((isArrowLeft(key) || isArrowRight(key)) && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        runArrowAction(isArrowRight(key) ? 'tab-next' : 'tab-prev')
        return
      }

      // Ctrl+W — close focused tab (skip real form fields only, not xterm)
      if (!e.shiftKey && !e.altKey && (lower === 'w' || key === 'W')) {
        if (inForm) return
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        void useAppStore.getState().closeFocusedTab()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      offIpc?.()
    }
  }, [])
}
