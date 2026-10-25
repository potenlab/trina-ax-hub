// Schedules: validation, next-run computation, the scheduler tick, and saving results through the permission checks.
import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { setRule } from '../../src/policy/rules-admin'
import { updateUser } from '../../src/auth/users'
import { loadPrincipal } from '../../src/policy/access'
import { PRODUCT } from '../../src/product'
import { fileSafeName, fileStamp, fromMyFolder, nextRunAt, saveResult, SaveRefused, sweepOldJobs, toMyFolder, validateCron, CATCH_UP_MS, JOB_KEEP_DAYS } from '../../src/hub/schedules'
import { fakeHub, get, jobRow, post, type FakeHub } from './hub-fixtures'

const hubs: FakeHub[] = []
afterAll(async () => { for (const h of hubs) await h.stop() })
const make = async (o: Parameters<typeof fakeHub>[0] = {}) => { const h = await fakeHub(o); hubs.push(h); return h }

const msgOf = (fn: () => unknown) => { try { fn(); return null } catch (e) { return (e as Error).message } }

describe('schedule rules', () => {
  test('next run is in the server time zone, strictly after the given time', () => {
    const sat = new Date(2026, 9, 24, 12, 0) // Saturday noon, local
    expect(nextRunAt('0 9 * * 1-5', sat)?.getTime()).toBe(new Date(2026, 9, 26, 9, 0).getTime())
    expect(nextRunAt('0 9 * * *', new Date(2026, 9, 26, 9, 0))?.getTime()).toBe(new Date(2026, 9, 27, 9, 0).getTime())
    expect(nextRunAt('0 9 * * 1', sat)?.getTime()).toBe(new Date(2026, 9, 26, 9, 0).getTime())
    expect(nextRunAt('0 9 31 2 *', sat)).toBeNull()
    expect(nextRunAt('nonsense', sat)).toBeNull()
  })

  test('cron validation', () => {
    expect(validateCron('  0   9 * * 1-5 ')).toBe('0 9 * * 1-5')
    expect(validateCron('30 8 * * MON-FRI')).toBe('30 8 * * MON-FRI')
    expect(validateCron('0 */2 * * *')).toBe('0 */2 * * *')
    expect(msgOf(() => validateCron(''))).toContain('실행 시간을 정해 주세요')
    expect(msgOf(() => validateCron('every day'))).toContain('cron 형식이 아니에요')
    expect(msgOf(() => validateCron('0 25 * * *'))).toContain('cron 형식이 아니에요')
    expect(msgOf(() => validateCron('*/5 * * * *'))).toContain('30분보다 자주')
    expect(msgOf(() => validateCron('0,10 9 * * *'))).toContain('30분보다 자주')
    expect(msgOf(() => validateCron('*/10 * * * * *'))).toContain('초 단위')
    expect(msgOf(() => validateCron('0 9 31 2 *'))).toContain('실행될 날이 없어요')
  })

  test('file names', () => {
    expect(fileStamp(new Date(2026, 0, 5, 9, 3))).toBe('2026-01-05 0903')
    expect(fileSafeName('주간 / 보고: "영업"')).toBe('주간 보고 영업')
    expect(fileSafeName('...')).toBe('예약 작업')
    expect(fileSafeName(PRODUCT.tmpPrefix + 'x').startsWith(PRODUCT.tmpPrefix)).toBe(false)
    expect(fileSafeName('.hidden')).toBe('hidden')
    expect(fileSafeName('REPORT~1')).toBe('REPORT-1')
  })
})

describe('schedule pages', async () => {
  const h = await make({ scheduler: true })
  const u = await h.t.user('planner')
  const other = await h.t.user('planner2')
  const s = h.t.session(u.id)
  const o = h.t.session(other.id)
  const db = h.t.ctx.db
  const base = { name: '주간 보고', when: 'weekday9', prompt: '이번 주 영업 파일을 읽고 보고서를 써 줘 [report]', outputDir: `users/${u.id}/예약 작업` }

  test('page renders with the presets and a default folder in my own space', async () => {
    const r = await get(h, s.cookie, '/app/schedules')
    expect(r.status).toBe(200)
    const html = await r.text()
    for (const label of ['매일 오전 9시', '평일 오전 9시', '매주 월요일 오전 9시', '직접 입력']) expect(html).toContain(label)
    expect(html).toContain(`value="내 폴더/예약 작업"`)
    expect(html).not.toContain(`users/${u.id}`) // people see "내 폴더", never their id
  })

  test('"내 폴더/…" is the person\'s own users/<id>/ folder', async () => {
    const r = await post(h, s.cookie, '/app/schedules', { ...base, name: '내 폴더 보고', outputDir: '내 폴더/메모', _csrf: s.csrf })
    expect(r.status).toBe(303)
    const row = db.query("SELECT * FROM schedules WHERE name = '내 폴더 보고'").get() as any
    expect(row.output_dir).toBe(`users/${u.id}/메모`)
    const html = await (await get(h, s.cookie, '/app/schedules')).text()
    expect(html).toContain('저장 폴더: 내 폴더/메모')
    // another person's "내 폴더" is their own, never this one
    expect(fromMyFolder(other.id, '내 폴더')).toBe(`users/${other.id}`)
    expect(fromMyFolder(u.id, 'shared/내 폴더')).toBe('shared/내 폴더')
    expect(toMyFolder(u.id, `users/${u.id}`)).toBe('내 폴더')
    expect(toMyFolder(u.id, `users/${other.id}/x`)).toBe(`users/${other.id}/x`)
    db.query('DELETE FROM schedules WHERE id = ?').run(row.id)
  })

  test('create needs CSRF and valid input', async () => {
    expect((await post(h, s.cookie, '/app/schedules', base)).status).toBe(403)
    const bad = await post(h, s.cookie, '/app/schedules', { ...base, when: 'custom', cron: '* * * * *', _csrf: s.csrf })
    expect(bad.status).toBe(400)
    const html = await bad.text()
    expect(html).toContain('30분보다 자주')
    expect(html).toContain('value="주간 보고"') // what was typed stays
    const noName = await post(h, s.cookie, '/app/schedules', { ...base, name: ' ', _csrf: s.csrf })
    expect(await noName.text()).toContain('이름을 적어 주세요')
    expect((db.query('SELECT COUNT(*) AS n FROM schedules').get() as any).n).toBe(0)
  })

  test('the output folder must be one the person can write', async () => {
    for (const dir of ['skills', 'skills/company', `users/${other.id}`, 'users', '.trina/x', '../outside', '/etc']) {
      const r = await post(h, s.cookie, '/app/schedules', { ...base, outputDir: dir, _csrf: s.csrf })
      expect(r.status).toBe(400)
    }
    const top = await post(h, s.cookie, '/app/schedules', { ...base, outputDir: '', _csrf: s.csrf })
    expect(await top.text()).toContain('저장할 폴더를 적어 주세요')
    const ro = await post(h, s.cookie, '/app/schedules', { ...base, outputDir: 'skills', _csrf: s.csrf })
    expect(await ro.text()).toContain('쓸 권한이 없어요')
    expect((db.query('SELECT COUNT(*) AS n FROM schedules').get() as any).n).toBe(0)
  })

  let id = ''
  test('a valid schedule is saved with its next run', async () => {
    const before = Date.now()
    const r = await post(h, s.cookie, '/app/schedules', { ...base, _csrf: s.csrf })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/app/schedules?n=created')
    const row = db.query('SELECT * FROM schedules WHERE user_id = ?').get(u.id) as any
    id = row.id
    expect(row).toMatchObject({ name: '주간 보고', cron: '0 9 * * 1-5', output_dir: `users/${u.id}/예약 작업`, enabled: 1 })
    expect(row.next_run_at).toBe(nextRunAt('0 9 * * 1-5', new Date(before))!.toISOString())
    const html = await (await get(h, s.cookie, '/app/schedules?n=created')).text()
    expect(html).toContain('예약 작업을 만들었어요.')
    expect(html).toContain('평일 오전 9시')
    expect(html).toContain('다음 실행')
    expect(html).toContain('아직 없어요')
  })

  test('run now saves the final message as Markdown in the folder', async () => {
    const r = await post(h, s.cookie, `/app/schedules/${id}/run`, { _csrf: s.csrf })
    expect(r.headers.get('location')).toBe('/app/schedules?n=started')
    const job = db.query('SELECT * FROM hub_jobs WHERE schedule_id = ?').get(id) as any
    expect(job.kind).toBe('schedule')
    expect((await post(h, s.cookie, `/app/schedules/${id}/run`, { _csrf: s.csrf })).headers.get('location')).toBe('/app/schedules?n=running')
    await h.hub.runner.wait(job.id)
    const done = jobRow(h, job.id)
    expect(done.status).toBe('done')
    const stamp = fileStamp(new Date(done.started_at))
    expect(done.output_path).toBe(`users/${u.id}/예약 작업/${stamp} 주간 보고.md`)
    const file = fs.readFileSync(path.join(h.t.ctx.fx.root, done.output_path), 'utf8')
    expect(file).toContain('# 주간 보고\n')
    expect(file).toContain('- 첫째 항목\n- 둘째 항목')
    expect(file).not.toContain('파일을 확인해 볼게요') // the preamble message is not part of the report
    // no temp files left behind
    expect(fs.readdirSync(path.join(h.t.ctx.fx.root, 'users', u.id, '예약 작업')).filter((f) => f.startsWith(PRODUCT.tmpPrefix))).toEqual([])
    const row = db.query('SELECT last_run_at FROM schedules WHERE id = ?').get(id) as any
    expect(row.last_run_at).not.toBeNull()
    const html = await (await get(h, s.cookie, '/app/schedules')).text()
    expect(html).toContain('성공')
    expect(html).toContain(`href="/app/files?path=${encodeURIComponent(done.output_path).replace(/&/g, '&amp;')}"`)
    expect(html).toContain(`>${stamp} 주간 보고.md</a>`)
    // the link downloads the saved file (same permission check as the file tools)
    const dl = await get(h, s.cookie, `/app/files?path=${encodeURIComponent(done.output_path)}`)
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(dl.headers.get('content-disposition')).toStartWith('attachment;')
    expect(dl.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent(`${stamp} 주간 보고.md`)}`)
    expect(await dl.text()).toBe(file)
    // someone else gets the same 404 as for a file that is not there
    const nope = await get(h, o.cookie, `/app/files?path=${encodeURIComponent(done.output_path)}`)
    expect(nope.status).toBe(404)
    expect((await get(h, s.cookie, `/app/files?path=${encodeURIComponent(`users/${u.id}/없는 파일.md`)}`)).status).toBe(404)
    expect(html).toContain('마지막 결과 보기')
    expect(html).toContain('<li>첫째 항목</li>')
    // a second run in the same minute gets its own file
    await post(h, s.cookie, `/app/schedules/${id}/run`, { _csrf: s.csrf })
    const j2 = db.query('SELECT id FROM hub_jobs WHERE schedule_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(id) as any
    await h.hub.runner.wait(j2.id)
    expect(jobRow(h, j2.id).output_path).not.toBe(done.output_path)
  }, 20_000)

  test('saving is refused once write access is gone', async () => {
    const r = await post(h, s.cookie, '/app/schedules', { ...base, name: '공유 보고', outputDir: 'shared/보고', _csrf: s.csrf })
    expect(r.status).toBe(303)
    const sid = (db.query("SELECT id FROM schedules WHERE name = '공유 보고'").get() as any).id
    setRule(db, 'shared', 'everyone', null, 'read')
    h.t.ctx.rulesChanged()
    try {
      await post(h, s.cookie, `/app/schedules/${sid}/run`, { _csrf: s.csrf })
      const job = db.query('SELECT id FROM hub_jobs WHERE schedule_id = ?').get(sid) as any
      await h.hub.runner.wait(job.id)
      const j = jobRow(h, job.id)
      expect(j.status).toBe('failed')
      expect(j.error).toBe("'shared/보고' 폴더에 쓸 권한이 없어서 결과를 저장하지 못했어요.")
      expect(j.output_path).toBeNull()
      expect(fs.existsSync(path.join(h.t.ctx.fx.root, 'shared', '보고'))).toBe(false)
      const html = await (await get(h, s.cookie, '/app/schedules')).text()
      expect(html).toContain('실패')
      expect(html).toContain('쓸 권한이 없어서')
    } finally {
      setRule(db, 'shared', 'everyone', null, 'write')
      h.t.ctx.rulesChanged()
    }
  }, 15_000)

  test('saveResult refuses folders the person cannot write', () => {
    const me = loadPrincipal(db, u.id)!
    expect(() => saveResult(h.t.ctx, me, 'skills', 'x', 'y', new Date())).toThrow(SaveRefused)
    expect(() => saveResult(h.t.ctx, me, `users/${other.id}`, 'x', 'y', new Date())).toThrow(SaveRefused)
    h.t.write(`users/${u.id}/a-file`, 'x')
    expect(() => saveResult(h.t.ctx, me, `users/${u.id}/a-file`, 'x', 'y', new Date())).toThrow(SaveRefused)
  })

  test('other people cannot see or change it', async () => {
    expect(await (await get(h, o.cookie, '/app/schedules')).text()).not.toContain(id)
    for (const a of ['run', 'toggle', 'delete']) expect((await post(h, o.cookie, `/app/schedules/${id}/${a}`, { _csrf: o.csrf })).status).toBe(404)
    expect((db.query('SELECT enabled FROM schedules WHERE id = ?').get(id) as any).enabled).toBe(1)
  })

  test('the scheduler starts what is due and moves the next run forward', async () => {
    const due = new Date(Date.now() - 60_000).toISOString()
    db.query('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(due, id)
    const started = h.hub.scheduler.tick()
    expect(started.length).toBe(1)
    const row = db.query('SELECT next_run_at FROM schedules WHERE id = ?').get(id) as any
    expect(Date.parse(row.next_run_at)).toBeGreaterThan(Date.now())
    expect(h.hub.scheduler.tick()).toEqual([]) // not twice
    await h.hub.runner.wait(started[0]!)
    expect(jobRow(h, started[0]!).status).toBe('done')
  }, 15_000)

  test('runs missed long ago are skipped, not replayed', () => {
    db.query('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - CATCH_UP_MS - 3600_000).toISOString(), id)
    h.hub.scheduler.skipMissed()
    const row = db.query('SELECT next_run_at FROM schedules WHERE id = ?').get(id) as any
    expect(Date.parse(row.next_run_at)).toBeGreaterThan(Date.now())
    expect(h.hub.scheduler.tick()).toEqual([])
  })

  test('disable and enable', async () => {
    const r = await post(h, s.cookie, `/app/schedules/${id}/toggle`, { _csrf: s.csrf })
    expect(r.headers.get('location')).toBe('/app/schedules?n=off')
    expect(db.query('SELECT enabled, next_run_at FROM schedules WHERE id = ?').get(id)).toEqual({ enabled: 0, next_run_at: null })
    db.query('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id)
    expect(h.hub.scheduler.tick()).toEqual([])
    await post(h, s.cookie, `/app/schedules/${id}/toggle`, { _csrf: s.csrf })
    const on = db.query('SELECT enabled, next_run_at FROM schedules WHERE id = ?').get(id) as any
    expect(on.enabled).toBe(1)
    expect(Date.parse(on.next_run_at)).toBeGreaterThan(Date.now())
  })

  test('a disabled account is not run by the scheduler', async () => {
    const gone = await h.t.user('leaver')
    db.query("INSERT INTO schedules (id, user_id, name, cron, prompt, output_dir, enabled, next_run_at, created_at) VALUES ('leaversched', ?, 'x', '0 9 * * *', 'p', ?, 1, ?, ?)")
      .run(gone.id, `users/${gone.id}`, new Date(Date.now() - 1000).toISOString(), new Date().toISOString())
    updateUser(db, gone.id, { status: 'disabled' })
    expect(h.hub.scheduler.tick()).toEqual([])
  })

  test('delete', async () => {
    const r = await post(h, s.cookie, `/app/schedules/${id}/delete`, { _csrf: s.csrf })
    expect(r.headers.get('location')).toBe('/app/schedules?n=removed')
    expect(db.query('SELECT 1 FROM schedules WHERE id = ?').get(id)).toBeNull()
    expect((await post(h, s.cookie, `/app/schedules/${id}/run`, { _csrf: s.csrf })).status).toBe(404)
  })
})

describe('housekeeping and downloads', async () => {
  const h = await make({ start: false })
  const u = await h.t.user('keeper')
  const other = await h.t.user('peeker')
  const s = h.t.session(u.id)
  const db = h.t.ctx.db

  test(`finished jobs older than ${JOB_KEEP_DAYS} days go, except each schedule's last run and anything still active`, () => {
    const day = 86_400_000
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString()
    db.query("INSERT INTO schedules (id, user_id, name, cron, prompt, output_dir, enabled, created_at) VALUES ('sch1', ?, 's', '0 9 * * *', 'p', NULL, 1, ?)").run(u.id, at(200))
    const job = (id: string, status: string, daysAgo: number, schedule: string | null = null) =>
      db.query("INSERT INTO hub_jobs (id, kind, user_id, schedule_id, prompt, status, created_at, finished_at) VALUES (?,?,?,?,'p',?,?,?)")
        .run(id, schedule ? 'schedule' : 'chat', u.id, schedule, status, at(daysAgo), status === 'queued' ? null : at(daysAgo))
    job('oldchat', 'done', 120)
    job('oldfail', 'failed', 91)
    job('recent', 'done', 30)
    job('oldqueued', 'queued', 120)
    job('schedold', 'done', 150, 'sch1')
    job('schedlast', 'done', 100, 'sch1')
    expect(sweepOldJobs(h.t.ctx)).toBe(3)
    const left = (db.query('SELECT id FROM hub_jobs ORDER BY id').all() as { id: string }[]).map((r) => r.id)
    expect(left).toEqual(['oldqueued', 'recent', 'schedlast'])
  })

  test('downloads: only files the person may read, never a folder, hidden names or paths outside', async () => {
    h.t.write(`users/${u.id}/보고서.md`, '# 보고\n')
    h.t.write(`users/${other.id}/비밀.md`, 'x')
    h.t.write('shared/표.csv', 'a,b\n')
    h.t.write('shared/사진.bin', 'raw')
    const ok = await get(h, s.cookie, `/app/files?path=${encodeURIComponent('shared/표.csv')}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(ok.headers.get('cache-control')).toContain('no-store')
    const bin = await get(h, s.cookie, `/app/files?path=${encodeURIComponent('shared/사진.bin')}`)
    expect(bin.headers.get('content-type')).toBe('application/octet-stream')
    expect(bin.headers.get('content-disposition')).toBe(`attachment; filename="__.bin"; filename*=UTF-8''${encodeURIComponent('사진.bin')}`)
    for (const p of [`users/${other.id}/비밀.md`, 'shared', '../etc/passwd', '/etc/passwd', '.trina/x', '']) {
      expect(`${p} ${(await get(h, s.cookie, `/app/files?path=${encodeURIComponent(p)}`)).status}`).toBe(`${p} 404`)
    }
    // logged out → login
    expect((await fetch(`${h.t.url}/app/files?path=shared%2F%ED%91%9C.csv`, { redirect: 'manual' })).status).toBe(302)
  })
})
