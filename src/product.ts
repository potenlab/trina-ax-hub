// Product names in one place. Folders, cookies and token prefixes all come from here.
export const PRODUCT = {
  id: 'trina-ax',
  displayName: 'Trina AX',
  /** reserved folder at the team root (trash, versions). Never shown to or reachable by tools. */
  systemDir: '.trina',
  /** prefix of server temp files inside the team folder; never shown, never accepted as a name */
  tmpPrefix: '.trina-tmp-',
  /** personal access token prefix (PC devices and hub sessions) */
  tokenPrefix: 'tax_',
  sessionCookie: 'tax_session',
  /** the MCP server name the PC installer registers; tools show up as mcp__trina__<tool> */
  mcpName: 'trina',
  /** the plugin marketplace name the PC installer registers */
  marketplaceName: 'trina-ax',
  version: '0.1.0',
} as const
