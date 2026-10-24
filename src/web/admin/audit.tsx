/** @jsxImportSource hono/jsx */
// Audit log: admin actions and security events, newest first, 200 per page.
import type { App, C } from '../../http/app'
import { listAudit } from '../../audit'
import { listGroups, listUsers } from '../../auth/users'
import { fmtDateTime } from '../../ui/format'
import { type Web, type Flash, Shell, Empty, render, takeFlashes, ROLE_LABEL, ACCESS_LABEL, PERIOD_LABEL } from '../kit'

const PAGE = 200

export const ACTION_LABEL: Record<string, string> = {
  'setup': '처음 설정',
  'login': '로그인',
  'login.fail': '로그인 실패',
  'logout': '로그아웃',
  'password.change': '비밀번호 변경',
  'user.create': '사람 추가',
  'user.update': '사람 정보 변경',
  'user.password_reset': '비밀번호 초기화',
  'enroll.create': 'PC 연결 코드 만듦',
  'enroll.redeem': 'PC 연결됨',
  'device.revoke': 'PC 연결 끊음',
  'group.create': '그룹 만듦',
  'group.rename': '그룹 이름 변경',
  'group.delete': '그룹 지움',
  'group.member_add': '그룹에 사람 넣음',
  'group.member_remove': '그룹에서 사람 뺌',
  'rule.set': '폴더 권한 설정',
  'rule.remove': '폴더 권한 지움',
  'budget.create': '예산 만듦',
  'budget.delete': '예산 지움',
  'usage.export': '사용량 CSV 내려받음',
  'settings.update': '설정 변경',
  'settings.urls': '접속 주소 변경',
  'apikey.set': 'API 키 저장',
  'apikey.remove': 'API 키 지움',
  'apikey.check': 'API 키 연결 확인',
}

const KEY_LABEL: Record<string, string> = {
  name: '이름', username: '아이디', email: '이메일', role: '역할', status: '상태', groups: '그룹', group: '그룹', user: '사람',
  device: 'PC', ip: 'IP', subject: '대상', access: '권한', period: '기간', limitUsd: '달러 한도', limitTokens: '토큰 한도',
  action: '넘으면', companyName: '회사 이름', hubConcurrency: '동시 실행', publicUrl: '공개 주소', lanUrl: '사내 주소',
  replaced: '교체', ok: '성공', status_code: '응답', from: '시작', to: '끝', first: '첫 변경', apiKey: 'API 키',
}

const VALUE_LABEL: Record<string, Record<string, string>> = {
  role: ROLE_LABEL, access: ACCESS_LABEL, period: PERIOD_LABEL,
  status: { active: '사용 중', disabled: '꺼짐' }, action: { block: '막기', warn: '알림만' },
}

function detailText(raw: string | null): string {
  if (!raw) return ''
  let d: unknown
  try { d = JSON.parse(raw) } catch { return raw.slice(0, 300) }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return String(raw).slice(0, 300)
  return Object.entries(d as Record<string, unknown>).map(([k, v]) => {
    const val = v === null ? '없음' : typeof v === 'boolean' ? (v ? '예' : '아니요') : Array.isArray(v) ? (v.length ? v.join(', ') : '없음')
      : typeof v === 'object' ? JSON.stringify(v) : (VALUE_LABEL[k]?.[String(v)] ?? String(v))
    return `${KEY_LABEL[k] ?? k}: ${val}`
  }).join(' · ').slice(0, 400)
}

function AuditPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { db } = p.web.ctx
  const beforeQ = Number(p.c.req.query('before'))
  const before = Number.isInteger(beforeQ) && beforeQ > 0 ? beforeQ : undefined
  const rows = listAudit(db, PAGE, before)
  const names = new Map<string, string>([...listUsers(db).map((u) => [u.id, u.name] as [string, string]), ...listGroups(db).map((g) => [g.id, `그룹 ${g.name}`] as [string, string])])
  const last = rows[rows.length - 1]
  return (
    <Shell c={p.c} title="기록" active="/admin/audit" flashes={p.flashes}>
      <h1>기록</h1>
      <p class="lead">누가 언제 무엇을 바꿨는지 남아요. 로그인과 PC 연결도 남아요. 비밀번호, 키, 파일 내용은 남기지 않아요.</p>
      {before ? <p class="small"><a href="/admin/audit">← 최근 기록으로</a></p> : null}
      {rows.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th>언제</th><th>누가</th><th>한 일</th><th class="hide-sm">대상</th><th class="hide-sm">내용</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr>
              <td style="white-space:nowrap">{fmtDateTime(r.at)}</td>
              <td>{r.actor ? names.get(r.actor) ?? r.actor : <span class="muted">—</span>}</td>
              <td>{ACTION_LABEL[r.action] ?? r.action}{r.target ? <div class="muted small show-sm" style="word-break:break-word">{names.get(r.target) ?? r.target}</div> : null}</td>
              <td class="hide-sm">{r.target ? names.get(r.target) ?? r.target : ''}</td>
              <td class="hide-sm muted small">{detailText(r.detail)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title={before ? '더 오래된 기록이 없어요' : '아직 기록이 없어요'} />}
      {rows.length === PAGE && last ? <a class="btn" href={`/admin/audit?before=${last.id}`}>더 오래된 기록 보기</a> : null}
    </Shell>
  )
}

export function mountAudit(app: App, web: Web) {
  app.get('/admin/audit', (c) => render(c, <AuditPage web={web} c={c} flashes={takeFlashes(web, c)} />))
}
