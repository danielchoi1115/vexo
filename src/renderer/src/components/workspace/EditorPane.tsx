import { useEffect, useRef, useState } from 'react'
import type { ActiveSessionInfo } from '../../../../shared/types'
import type { DropZone, LayoutNode } from '../../layout/types'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { TerminalView } from '../TerminalView'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { DropOverlay, zoneFromPoint } from './DropOverlay'
import { SESSION_CONFIG_MIME, TAB_MIME } from '../../layout/dnd'

interface Props {
  leaf: Extract<LayoutNode, { type: 'leaf' }>
  sessions: ActiveSessionInfo[]
}

export function EditorPane({ leaf, sessions }: Props): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const focusedActiveId = useAppStore((s) => s.focusedActiveId)
  const focusedLeafId = useAppStore((s) => s.focusedLeafId)
  const setLeafActive = useAppStore((s) => s.setLeafActive)
  const setFocusedLeaf = useAppStore((s) => s.setFocusedLeaf)
  const dropTab = useAppStore((s) => s.dropTab)
  const connectSession = useAppStore((s) => s.connectSession)
  const disconnectSession = useAppStore((s) => s.disconnectSession)
  const disconnectOthers = useAppStore((s) => s.disconnectOthers)
  const metrics = useAppStore((s) => s.metrics)
  const remoteMonitoring = useSettingsStore((s) => s.remoteMonitoring)

  const bodyRef = useRef<HTMLDivElement>(null)
  const tabScrollRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const [dropZone, setDropZone] = useState<DropZone | null>(null)
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const isLeafFocused = focusedLeafId === leaf.id
  const activeTabId = leaf.activeTabId
  const paneSessions = leaf.tabIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter(Boolean) as ActiveSessionInfo[]

  const paneHasDisconnected = paneSessions.some(
    (a) => a.status === 'disconnected' || a.status === 'error'
  )

  useEffect(() => {
    if (!activeTabId || !isLeafFocused) return
    tabRefs.current.get(activeTabId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    })
  }, [activeTabId, isLeafFocused, leaf.tabIds.length])

  // Horizontal wheel → scroll tab strip
  useEffect(() => {
    const el = tabScrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      if (el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const closeAllInPane = (): void => {
    const ids = [...leaf.tabIds]
    for (const id of ids) {
      void disconnectSession(id)
    }
  }

  const closeDisconnectedInPane = (): void => {
    const ids = paneSessions
      .filter((s) => s.status === 'disconnected' || s.status === 'error')
      .map((s) => s.id)
    for (const id of ids) {
      void disconnectSession(id)
    }
  }

  const tabMenuItems = (id: string): MenuItem[] => [
    {
      label: t('tabs.closeTab'),
      onClick: () => void disconnectSession(id)
    },
    {
      label: t('tabs.closeOthers'),
      onClick: () => void disconnectOthers(id),
      disabled: paneSessions.length <= 1
    },
    {
      label: t('tabs.closeDisconnectedInPane'),
      onClick: closeDisconnectedInPane,
      disabled: !paneHasDisconnected
    },
    {
      label: t('tabs.closeAllInPane'),
      onClick: closeAllInPane,
      danger: true,
      disabled: paneSessions.length === 0
    }
  ]

  const paneMenuItems = (): MenuItem[] => [
    {
      label: t('tabs.closeAllInPane'),
      onClick: closeAllInPane,
      disabled: paneSessions.length === 0
    },
    {
      label: t('tabs.closeDisconnectedInPane'),
      onClick: closeDisconnectedInPane,
      disabled: !paneHasDisconnected
    }
  ]

  const openPaneMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    // Focus this pane first (⋯ on an unfocused pane should steal focus)
    setFocusedLeaf(leaf.id)
    if (leaf.activeTabId) setLeafActive(leaf.id, leaf.activeTabId)
    setTabMenu(null)
    const btn = menuBtnRef.current
    if (btn) {
      const r = btn.getBoundingClientRect()
      setPaneMenu({ x: r.right - 8, y: r.bottom + 2 })
    } else {
      setPaneMenu({ x: e.clientX, y: e.clientY })
    }
  }

  const focusedMetrics =
    activeTabId && isLeafFocused && focusedActiveId === activeTabId
      ? metrics[activeTabId]
      : undefined

  return (
    <div
      className={`editor-pane ${isLeafFocused ? 'focused' : ''}`}
      onMouseDown={() => {
        setFocusedLeaf(leaf.id)
        if (leaf.activeTabId) setLeafActive(leaf.id, leaf.activeTabId)
      }}
    >
      <div className="tab-bar">
        <div className="tab-bar-scroll" ref={tabScrollRef}>
          {paneSessions.map((s) => (
            <div
              key={s.id}
              ref={(node) => {
                if (node) tabRefs.current.set(s.id, node)
                else tabRefs.current.delete(s.id)
              }}
              className={`tab ${s.id === activeTabId ? 'active' : 'inactive'}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, s.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', s.id)
              }}
              onClick={() => setLeafActive(leaf.id, s.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setLeafActive(leaf.id, s.id)
                setPaneMenu(null)
                setTabMenu({ x: e.clientX, y: e.clientY, id: s.id })
              }}
            >
              <span className={`status-dot ${s.status}`} />
              <span className="tab-label">{s.name}</span>
              <button
                className="tab-close"
                title={t('tabs.close')}
                onClick={(e) => {
                  e.stopPropagation()
                  void disconnectSession(s.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="tab-bar-actions">
          <button
            ref={menuBtnRef}
            type="button"
            className="tab-bar-menu-btn"
            title={t('tabs.paneMenu')}
            aria-label={t('tabs.paneMenu')}
            onClick={openPaneMenu}
            onMouseDown={(e) => e.stopPropagation()}
          >
            ⋯
          </button>
        </div>
      </div>

      {remoteMonitoring && focusedMetrics && isLeafFocused && (
        <div className="metrics-bar" title={focusedMetrics.error || undefined}>
          <span>
            <b>Host</b> {focusedMetrics.hostname}
          </span>
          <span>
            <b>CPU</b> {focusedMetrics.cpu}
          </span>
          <span>
            <b>Mem</b> {focusedMetrics.memory}
          </span>
          <span>
            <b>Net</b> {focusedMetrics.network}
          </span>
          <span>
            <b>Up</b> {focusedMetrics.uptime}
          </span>
          <span>
            <b>Disk</b> {focusedMetrics.storage}
          </span>
        </div>
      )}

      <div
        className="editor-pane-body"
        ref={bodyRef}
        onDragOver={(e) => {
          e.preventDefault()
          const types = [...e.dataTransfer.types]
          const fromSidebar = types.includes(SESSION_CONFIG_MIME)
          e.dataTransfer.dropEffect = fromSidebar ? 'copy' : 'move'
          if (bodyRef.current) {
            setDropZone(zoneFromPoint(bodyRef.current, e.clientX, e.clientY))
          }
        }}
        onDragLeave={(e) => {
          if (!bodyRef.current?.contains(e.relatedTarget as Node)) {
            setDropZone(null)
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const zone = bodyRef.current
            ? zoneFromPoint(bodyRef.current, e.clientX, e.clientY)
            : 'center'
          setDropZone(null)

          const configId = e.dataTransfer.getData(SESSION_CONFIG_MIME)
          if (configId) {
            void connectSession(configId, { leafId: leaf.id, zone })
            return
          }

          const tabId = e.dataTransfer.getData(TAB_MIME)
          if (tabId) {
            dropTab(tabId, leaf.id, zone)
          }
        }}
      >
        <DropOverlay zone={dropZone} />
        {paneSessions.map((s) => {
          const isActiveTab = s.id === activeTabId
          const hasKeyboardFocus =
            isActiveTab && isLeafFocused && focusedActiveId === s.id
          return (
            <div
              key={s.id}
              className="session-pane"
              style={{ display: isActiveTab ? 'flex' : 'none' }}
            >
              <TerminalView activeSessionId={s.id} active={!!hasKeyboardFocus} />
            </div>
          )
        })}
        {paneSessions.length === 0 && (
          <div className="editor-pane-empty muted">Drop a tab here</div>
        )}
      </div>

      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={tabMenuItems(tabMenu.id)}
          onClose={() => setTabMenu(null)}
        />
      )}
      {paneMenu && (
        <ContextMenu
          x={paneMenu.x}
          y={paneMenu.y}
          items={paneMenuItems()}
          onClose={() => setPaneMenu(null)}
        />
      )}
    </div>
  )
}
