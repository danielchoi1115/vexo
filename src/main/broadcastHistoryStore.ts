import Store from 'electron-store'

const MAX_HISTORY = 200

interface BroadcastHistorySchema {
  commands: string[]
}

const store = new Store<BroadcastHistorySchema>({
  name: 'broadcast-history',
  defaults: { commands: [] }
})

export function getHistory(): string[] {
  return [...(store.get('commands') ?? [])]
}

/** Newest last in storage; returns updated list */
export function pushCommand(line: string): string[] {
  const trimmed = line.trimEnd()
  if (!trimmed) return getHistory()
  let commands = getHistory().filter((c) => c !== trimmed)
  commands.push(trimmed)
  if (commands.length > MAX_HISTORY) {
    commands = commands.slice(commands.length - MAX_HISTORY)
  }
  store.set('commands', commands)
  return commands
}

export function clearHistory(): string[] {
  store.set('commands', [])
  return []
}
