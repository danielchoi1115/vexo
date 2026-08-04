import { useEffect, useRef, useState } from 'react'
import type { ActiveSessionInfo } from '../../../../shared/types'
import type { DropZone, LayoutNode } from '../../layout/types'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { TerminalView } from '../TerminalView'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { DropOverlay, zoneFromPoint } from './DropOverlay'

const TAB_MIME = 'application/x-vexo-tab'

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
  const disconnectSession = useAppStore((s) => s.disconnectSession)
  const disconnectAll = useAppStore((s) => s.disconnectAll)
  const disconnectOthers = useAppStore((s) => s.disconnectOthers)
  const disconnectDisconnected = useAppStore((s) => s.disconnectDisconnected)
  const activeSessions = useAppStore((s) => s.activeSessions)
  const metrics = useAppStore((s) => s.metrics)
  const remoteMonitoring = useSettingsStore((s) => s.remoteMonitoring)

  const bodyRef = useRef<HTMLDivElement>(null)
  const [dropZone, setDropZone] = useState<DropZone | null>(null)
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const isLeafFocused = focusedLeafId === leaf.id
  const activeTabId = leaf.activeTabId
  const paneSessions = leaf.tabIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter(Boolean) as ActiveSessionInfo[]

  useEffect(() => {
    if (!activeTabId || !isLeafFocused) return
    tabRefs.current.get(activeTabId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    })
  }, [activeTabId, isLeafFocused, leaf.tabIds.length])

  const hasDisconnected = activeSessions.some(
    (a) => a.status === 'disconnected' || a.status === 'error'
  )

  const tabMenuItems = (id: string): MenuItem[] => [
    {
      label: t('tabs.closeTab'),
      onClick: () => void disconnectSession(id)
    },
    {
      label: t('tabs.closeOthers'),
      onClick: () => void disconnectOthers(id),
      disabled: activeSessions.length <= 1
    },
    {
      label: t('tabs.closeDisconnected'),
      onClick: () => void disconnectDisconnected(),
      disabled: !hasDisconnected
    },
    {
      label: t('tabs.closeAll'),
      onClick: () => void disconnectAll(),
      danger: true
    }
  ]

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
            }}
            onClick={() => setLeafActive(leaf.id, s.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setLeafActive(leaf.id, s.id)
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
        <div className="tab-bar-spacer" />
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
          e.dataTransfer.dropEffect = 'move'
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
          const tabId = e.dataTransfer.getData(TAB_MIME)
          const zone = bodyRef.current
            ? zoneFromPoint(bodyRef.current, e.clientX, e.clientY)
            : 'center'
          setDropZone(null)
          if (!tabId) return
          dropTab(tabId, leaf.id, zone)
        }}
      >
        <DropOverlay zone={dropZone} />
        {paneSessions.map((s) => {
          const isActive = s.id === activeTabId
          const isFocusedTerm = isActive && isLeafFocused && focusedActiveId === s.id
          return (
            <div
              key={s.id}
              className="session-pane"
              style={{ display: isActive ? 'flex' : 'none' }}
            >
              <TerminalView activeSessionId={s.id} active={!!isFocusedTerm} />
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
    </div>
  )
}
