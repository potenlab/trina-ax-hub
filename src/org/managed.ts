// The values the admin pastes into Claude's admin console, generated from the hub's own settings.
//
//   Claude Code  Organization settings › Claude Code › Managed settings   (JSON; every member's Claude Code gets it)
//   Cowork       Admin settings › Cowork                                  (OTLP endpoint, protocol, headers)
//
// The Claude Code JSON carries the same telemetry env the PC installer writes in subscription mode (src/install/
// enroll.ts `installEnv`), but with the org token, plus the org marketplace and plugin. It never carries
// ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY: with any of them Claude Code skips managed settings
// altogether, and the people's own Claude logins are what this path relies on.
import { installEnv } from '../install/enroll'
import { marketplaceUrl, ORG_MARKETPLACE_NAME, ORG_PLUGIN_ID } from '../skills/marketplace'

/** Shown in place of the token whenever the real one is not on the screen (it is only shown once, when made). */
export const TOKEN_PLACEHOLDER = '<조직 토큰>'

export interface ManagedSettings {
  env: Record<string, string>
  extraKnownMarketplaces: Record<string, { source: { source: 'url'; url: string; headers: { Authorization: string } }; autoUpdate: boolean }>
  enabledPlugins: Record<string, true>
}

/** What a request to the hub must carry in `Authorization`. */
export const bearer = (token: string) => `Bearer ${token}`

/** `hub` = the public https address (no trailing slash). */
export function managedSettings(hub: string, token: string): ManagedSettings {
  return {
    env: {
      ...installEnv('subscription', hub, token),
      // prompt text stays on the PC, whatever a person sets for themselves (managed settings rank above theirs)
      OTEL_LOG_USER_PROMPTS: '0',
    },
    extraKnownMarketplaces: {
      [ORG_MARKETPLACE_NAME]: {
        source: { source: 'url', url: marketplaceUrl(hub), headers: { Authorization: bearer(token) } },
        autoUpdate: true,
      },
    },
    enabledPlugins: { [ORG_PLUGIN_ID]: true },
  }
}

export const managedSettingsJson = (hub: string, token: string) => JSON.stringify(managedSettings(hub, token), null, 2)

/** The three Cowork fields. The OTLP endpoint is the base: the exporter adds /v1/logs, which the hub serves. */
export function coworkOtlp(hub: string, token: string) {
  return { endpoint: `${hub}/otel`, protocol: 'http/json', headers: `Authorization=${bearer(token)}`, logsUrl: `${hub}/otel/v1/logs` }
}

/** The connector's address in Claude (an Owner enters it once). */
export const connectorUrl = (hub: string) => `${hub}/mcp`

/** Anthropic's servers reach connectors from this range; a WAF in front of the hub must let it through. */
export const ANTHROPIC_OUTBOUND_RANGE = '160.79.104.0/21'
