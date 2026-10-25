/** @jsxImportSource hono/jsx */
// Earlier versions and deleted files: what the hub kept before an overwrite, edit, move-over or delete, newest
// first, filtered by path, with a 복원 button (src/files/versions.ts). Admins and the owner only (the /admin/* guard).
// Another person's personal folder (users/<id>/) never shows here: it stays theirs alone.
import type { App, C } from '../../http/app'
import { audit } from '../../audit'
import { getVersion, listVersions, restoreVersion, type VersionRow } from '../../files/versions'
import { fmtDateTime } from '../../ui/format'
import { type Web, type Flash, Shell, Empty, ButtonForm, render, takeFlashes, act, say, field, fail } from '../kit'

const PAGE = 100

export const REASON_LABEL: Record<string, string> = { overwrite: '고치기 전', move: '덮어쓰기 전', trash: '지운 파일' }

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`)

const listUrl = (q: string, before?: string) => {
  const p = new URLSearchParams()
  if (q) p.set('path', q)
  if (before) p.set('before', before)
  const s = p.toString()
  return '/admin/versions' + (s ? '?' + s : '')
}

function VersionsPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const s = p.c.get('session')!
  const q = (p.c.req.query('path') ?? '').trim()
  const before = p.c.req.query('before') || undefined
  const rows: VersionRow[] = listVersions(p.web.ctx, { path: q, before, limit: PAGE, viewer: s.user.id })
  const last = rows[rows.length - 1]
  return (
    <Shell c={p.c} title="이전 버전" active="/admin/versions" flashes={p.flashes}>
      <h1>이전 버전</h1>
      <p class="lead">파일을 고치거나 덮어쓰거나 지우기 전 내용이 허브에 남아요. 되살리면 원래 자리에 다시 생겨요.</p>
      <div class="card">
        <ul style="margin:0;padding-left:20px">
          <li>그 자리에 지금 파일이 있으면, 지금 파일도 이전 버전으로 남긴 뒤 되살려요. 아무것도 사라지지 않아요.</li>
          <li>지운 파일은 같은 이름의 파일이 이미 있으면 옆에 <b>(복원)</b>을 붙인 이름으로 되살려요.</li>
          <li>개인 폴더(users/)의 파일은 본인만 볼 수 있어서 여기에 나오지 않아요.</li>
        </ul>
      </div>

      <form method="get" action="/admin/versions" class="card" style="padding:12px 16px">
        <div class="row">
          <div class="field" style="margin:0"><label for="vpath">파일이나 폴더</label>
            <input id="vpath" name="path" value={q} placeholder="예: shared/영업" autocapitalize="off" /></div>
          <div><button class="btn" type="submit">찾기</button></div>
        </div>
      </form>

      {before ? <p class="small"><a href={listUrl(q)}>← 최근 것부터 보기</a></p> : null}
      {rows.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>언제</th><th>파일</th><th class="hide-sm">무엇</th><th class="hide-sm">누가</th><th class="hide-sm right">크기</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr>
              <td style="white-space:nowrap">{fmtDateTime(r.createdAt)}</td>
              <td style="word-break:break-word"><code>{r.path}</code>
                <div class="muted small show-sm">{REASON_LABEL[r.reason] ?? r.reason} · {r.userName ?? '—'} · {fmtSize(r.size)}</div></td>
              <td class="hide-sm">{REASON_LABEL[r.reason] ?? r.reason}</td>
              <td class="hide-sm">{r.userName ?? <span class="muted">—</span>}</td>
              <td class="hide-sm right" style="white-space:nowrap">{fmtSize(r.size)}</td>
              <td class="right">{r.stored
                ? <ButtonForm action={`/admin/versions/${r.id}/restore`} csrf={s.csrf} label="복원" hidden={{ q }}
                    confirm={`${r.path} 을(를) ${fmtDateTime(r.createdAt)} 내용으로 되살릴까요?`} />
                : <span class="muted small">정리됨</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title={q ? '맞는 이전 버전이 없어요' : before ? '더 오래된 버전이 없어요' : '아직 남은 이전 버전이 없어요'}>
        {q ? '경로 앞부분을 짧게 적어 보세요. 예: shared' : '파일을 고치거나 지우면 여기에 생겨요.'}</Empty>}
      {rows.length === PAGE && last ? <a class="btn" href={listUrl(q, last.cursor)}>더 오래된 것 보기</a> : null}
    </Shell>
  )
}

export function mountVersions(app: App, web: Web) {
  const { ctx } = web

  app.get('/admin/versions', (c) => render(c, <VersionsPage web={web} c={c} flashes={takeFlashes(web, c)} />))

  app.post('/admin/versions/:id/restore', (c) => act(web, c, '/admin/versions', (f, s) => {
    const id = c.req.param('id')
    const v = /^[A-Za-z0-9]{1,40}$/.test(id) ? getVersion(ctx, id) : null
    if (!v) fail('그 이전 버전을 찾을 수 없어요.')
    const r = restoreVersion(ctx, v!.id, s.user.id)
    audit(ctx.db, { actor: s.user.id, action: 'file.restore', target: r.path, detail: { version: v!.id, original: v!.path, reason: v!.reason } })
    say(web, s, 'ok', r.path === v!.path ? `${r.path} 을(를) 되살렸어요.` : `${r.path} (으)로 되살렸어요. 원래 이름에는 지금 다른 파일이 있어요.`)
    return listUrl(field(f, 'q'))
  }))
}
