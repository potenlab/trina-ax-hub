/** @jsxImportSource hono/jsx */
// The shared page shell and formatters: money formats, the copy button's fallbacks (plain-http office address),
// the phone navigation, and the 401 a disconnected PC sees.
import { describe, expect, test, afterAll } from 'bun:test'
import fs from 'node:fs'
import { fmtKrw, fmtUsd } from '../../src/ui/format'
import { CopyBlock, Page } from '../../src/ui/layout'
import { INSTALL_DONE_LINE } from '../../src/web/kit'
import { hubNav } from '../../src/hub/pages'
import { testHub, type TestHub } from '../lib/hub'

let hub: TestHub
afterAll(async () => { await hub?.stop() })

describe('formats', () => {
  test('dollars always with two decimals', () => {
    expect(fmtUsd(0)).toBe('$0.00')
    expect(fmtUsd(0.004)).toBe('$0.00')
    expect(fmtUsd(0.07)).toBe('$0.07')
    expect(fmtUsd(45)).toBe('$45.00')
    expect(fmtUsd(47.505)).toBe('$47.51')
    expect(fmtUsd(1234.5)).toBe('$1,234.50')
    expect(fmtUsd(-2)).toBe('-$2.00')
  })

  test('rough won amounts', () => {
    expect(fmtKrw(1.5, 1400)).toBe('약 2,100원')
    expect(fmtKrw(0.013, 1400)).toBe('약 20원')
    expect(fmtKrw(47.51, 1400)).toBe('약 66,500원')
    expect(fmtKrw(1000, 1350)).toBe('약 1,350,000원')
  })
})

describe('page shell', () => {
  const html = String(<Page title="t" nav={[{ href: '/a', label: 'A' }]} active="/a"><CopyBlock id="c1" text="curl x | bash" /></Page>)

  test('copy works without navigator.clipboard (http on the office network): select + execCommand, else long-press hint', () => {
    expect(html).toContain('navigator.clipboard&&window.isSecureContext')
    expect(html).toContain("document.execCommand('copy')")
    expect(html).toContain('길게 눌러 복사해 주세요')
    expect(html).toContain('data-copy="c1"')
  })

  test('disabled buttons look disabled; the phone nav scrolls to the current page', () => {
    expect(html).toContain('.btn:disabled')
    expect(html).toContain('cursor:not-allowed')
    expect(html).toContain("querySelector('header.top nav')")
  })

  test('phone pages link back to my page (and the admin pages for admins)', () => {
    const member = hubNav({ role: 'member' } as any).map((n) => n.href)
    expect(member).toEqual(['/app', '/app/schedules', '/me'])
    expect(hubNav({ role: 'admin' } as any).map((n) => n.label)).toEqual(['채팅', '예약 작업', '내 PC', '관리'])
  })

  test("the enroll steps quote the installers' last line exactly", () => {
    for (const f of ['installer/install.sh.tmpl', 'installer/install.ps1.tmpl']) expect(fs.readFileSync(f, 'utf8')).toContain(`${INSTALL_DONE_LINE}.`)
  })
})

describe('a PC whose connection is gone', async () => {
  hub = await testHub()
  const want = "Trina AX: 이 PC의 회사 연결이 끊겼어요. 회사 AI 페이지의 'PC 연결하기'로 다시 연결하거나 관리자에게 물어봐 주세요."

  test('the model relay and MCP answer 401 with how to reconnect', async () => {
    const relay = await fetch(hub.url + '/v1/messages', { method: 'POST', headers: { authorization: 'Bearer tax_revoked', 'content-type': 'application/json' }, body: '{}' })
    expect(relay.status).toBe(401)
    expect(((await relay.json()) as any).error.message).toBe(want)
    const mcp = await fetch(hub.url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(mcp.status).toBe(401)
    expect(JSON.stringify(await mcp.json())).toContain('PC 연결하기')
  })

  test('the phone pages have the way back to 내 PC', async () => {
    const s = hub.session(hub.owner.id)
    const body = await (await fetch(hub.url + '/app', { headers: { cookie: s.cookie, accept: 'text/html' } })).text()
    expect(body).toContain('href="/me"')
    expect(body).toContain('>관리</a>')
  })
})
