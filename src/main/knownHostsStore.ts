import Store from 'electron-store'

/** host:port → sha256 hex of host key (when hostHash=sha256) */
interface KnownHostsSchema {
  hosts: Record<string, string>
}

const store = new Store<KnownHostsSchema>({
  name: 'known-hosts',
  defaults: { hosts: {} }
})

export function hostKeyId(host: string, port: number): string {
  return `${host}:${port || 22}`
}

export function getKnownHostKey(host: string, port: number): string | undefined {
  return store.get('hosts')[hostKeyId(host, port)]
}

export function setKnownHostKey(host: string, port: number, fingerprint: string): void {
  const hosts = { ...store.get('hosts') }
  hosts[hostKeyId(host, port)] = fingerprint
  store.set('hosts', hosts)
}
