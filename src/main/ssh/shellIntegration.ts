/**
 * Session-local shell integration (OSC CWD for Follow Terminal Folder).
 *
 * Login shell stays normal (`client.shell` → MOTD / Welcome).
 * SI scripts are staged via SFTP, then sourced once after MOTD settles.
 * The source command's echo is muted in the renderer so it is not visible.
 */

export const BASH_ZSH_INTEGRATION = [
  '# vexo shell integration (session)',
  '__vexo_cwd_report() {',
  "  printf '\\033]633;P;Cwd=%s\\007' \"$PWD\" 2>/dev/null || true",
  "  printf '\\033]7;file://%s%s\\007' \"${HOSTNAME:-localhost}\" \"$PWD\" 2>/dev/null || true",
  '}',
  'if [ -n "${__VEXO_SI:-}" ]; then',
  '  :',
  'elif [ -n "${BASH_VERSION:-}" ]; then',
  '  __VEXO_SI=1',
  "  if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare \\-a'; then",
  '    PROMPT_COMMAND+=(__vexo_cwd_report)',
  '  elif [ -n "${PROMPT_COMMAND:-}" ]; then',
  '    PROMPT_COMMAND="__vexo_cwd_report;${PROMPT_COMMAND}"',
  '  else',
  '    PROMPT_COMMAND=__vexo_cwd_report',
  '  fi',
  '  __vexo_cwd_report',
  'elif [ -n "${ZSH_VERSION:-}" ]; then',
  '  __VEXO_SI=1',
  '  typeset -ga precmd_functions 2>/dev/null || true',
  '  precmd_functions+=(__vexo_cwd_report)',
  '  __vexo_cwd_report',
  'else',
  '  __VEXO_SI=1',
  '  PROMPT_COMMAND="__vexo_cwd_report${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
  '  __vexo_cwd_report',
  'fi',
  ''
].join('\n')

export const FISH_INTEGRATION = [
  '# vexo shell integration (session, fish)',
  'if not set -q __VEXO_SI',
  '  set -g __VEXO_SI 1',
  "  function __vexo_cwd_report --on-variable PWD --description 'vexo cwd'",
  "    printf '\\033]633;P;Cwd=%s\\007' $PWD",
  "    printf '\\033]7;file://%s%s\\007' (hostname) $PWD",
  '  end',
  '  __vexo_cwd_report',
  'end',
  ''
].join('\n')

export type RemoteShellKind = 'bash' | 'zsh' | 'fish' | 'unknown'

export interface RemoteShellInfo {
  kind: RemoteShellKind
  path: string
}

export function shellKindFromPath(shellPath: string): RemoteShellKind {
  const base = shellPath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
  if (base.includes('fish')) return 'fish'
  if (base.includes('zsh')) return 'zsh'
  if (base.includes('bash')) return 'bash'
  return 'unknown'
}

export function remoteIntegrationPaths(sessionId: string): { sh: string; fish: string } {
  const tag = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'x'
  return {
    sh: `/tmp/.vexo-si-${tag}.sh`,
    fish: `/tmp/.vexo-si-${tag}.fish`
  }
}

/**
 * One-shot command typed into the login PTY to load SI.
 * Echo is line-filtered client-side (see siEchoFilterUntil).
 */
export function buildSourceCommand(
  kind: RemoteShellKind,
  shPath: string,
  fishPath: string
): string {
  // Ctrl-U clears partial input; history off when supported
  if (kind === 'fish') {
    return `\x15 source ${fishPath} 2>/dev/null\n`
  }
  return (
    `\x15 stty -echo 2>/dev/null; set +o history 2>/dev/null; ` +
    `. ${shPath} 2>/dev/null; set -o history 2>/dev/null; stty echo 2>/dev/null\n`
  )
}
