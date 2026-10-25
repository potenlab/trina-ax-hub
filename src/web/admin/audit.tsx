/** @jsxImportSource hono/jsx */
// Audit log: admin actions and security events, newest first, 200 per page.
import type { App, C } from '../../http/app'
import { listAudit } from '../../audit'
import type { Database } from 'bun:sqlite'
import { listGroups, listUsers } from '../../auth/users'
import { listTokens } from '../../auth/tokens'
import { listBudgets } from '../../usage/budgets'
import { fmtDateTime } from '../../ui/format'
import { type Web, type Flash, Shell, Empty, render, takeFlashes, ROLE_LABEL, ACCESS_LABEL, PERIOD_LABEL, BUDGET_ACTION_LABEL } from '../kit'

const PAGE = 200

/** Every action the hub writes to the audit log (grep `audit(` in src/), in Korean. Unknown ones show as they are. */
export const ACTION_LABEL: Record<string, string> = {
  'setup': '처음 설정',
  'login': '로그인',
  'login.fail': '로그인 실패',
  'logout': '로그아웃',
  'password.change': '비밀번호 변경',
  'user.create': '사람 추가',
  'user.update': '사람 정보 변경',
  'user.password_reset': '비밀번호 초기화',
  'invite.create': '초대·초기화 링크 만듦',
  'invite.join': '링크로 비밀번호를 정함',
  'enroll.create': 'PC 연결 코드 만듦',
  'enroll.redeem': 'PC 연결됨',
  'device.enroll': 'PC 연결됨',
  'device.approve': 'PC 승인',
  'device.revoke': 'PC 연결 끊음',
  'device.unenroll': 'PC에서 연결 해제',
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
  'hub.schedule.save': '예약 작업 결과 저장',
  'file.restore': '파일 되살림',
  'file.version.restore': '파일 되살림',
  'file.trash.restore': '휴지통에서 되살림',
  'file.upload': '파일 올림',
  'file.delete': '파일 지움',
  'file.move': '파일 이름·위치 바꿈',
  'folder.create': '폴더 만듦',
  'backup': '백업',
  'settings.pricing': '모델 가격표 변경',
  'settings.access': 'Claude 사용 방식 기본값 변경',
  'connector.allow': 'Claude 앱 연결 허용',
  'connector.deny': 'Claude 앱 연결 거부',
  'connector.revoke': 'Claude 앱 연결 끊음',
  'org_token.create': '조직 토큰 만듦',
  'org_token.rotate': '조직 토큰 새로 만듦 (이전 토큰 멈춤)',
  'org_token.revoke': '조직 토큰 멈춤',
  'claude_org.plan': 'Claude 조직 설정: 종류 선택',
  'claude_org.name': 'Claude 조직 설정: 커넥터 이름 변경',
  'claude_org.pasted': 'Claude 조직 설정: 관리 콘솔에 붙여 넣음',
  'claude_org.unknown_clear': 'Claude 조직 설정: 허브에 없는 이메일 목록 비움',
}

const KEY_LABEL: Record<string, string> = {
  name: '이름', username: '아이디', email: '이메일', role: '역할', status: '상태', groups: '그룹', group: '그룹', user: '사람',
  device: 'PC', os: 'OS', ip: 'IP', subject: '대상', access: '권한', period: '기간', limitUsd: '달러 한도', limitTokens: '토큰 한도',
  action: '넘으면', companyName: '회사 이름', hubConcurrency: '동시 실행', publicUrl: '공개 주소', lanUrl: '사내 주소', krwPerUsd: '원화 환산',
  kind: '종류', temp: '임시 비밀번호', invite: '초대 링크', bulk: '한꺼번에', link: '링크', reissue: '다시 만듦',
  replaced: '교체', files: '파일 수', bytes: '용량(바이트)', via: '경로', paths: '파일', ok: '성공', status_code: '응답', from: '시작', to: '끝', first: '첫 변경', apiKey: 'API 키', path: '경로', version: '버전',
  plan: '종류', connectorName: '커넥터 이름',
}

const VALUE_LABEL: Record<string, Record<string, string>> = {
  role: ROLE_LABEL, access: ACCESS_LABEL, period: PERIOD_LABEL, action: BUDGET_ACTION_LABEL,
  plan: { team: 'Claude Team·Enterprise', individual: 'Pro·Max 개인 구독', company_key: '회사 API 키' },
  kind: { invite: '초대', reset: '비밀번호 초기화' },
  status: { active: '사용 중', disabled: '꺼짐' }, os: { macos: '맥', windows: '윈도우', linux: '리눅스', other: '기타' },
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

/** A team-folder path with the personal folder users/<id> shown as "이름님 폴더". */
export function pathLabel(p: string, people: Map<string, string>): string {
  if (p === '/' || p === '') return '팀 폴더 맨 위'
  const m = /^users\/([^/]+)(\/.*)?$/.exec(p)
  if (!m) return p
  const who = people.get(m[1]!)
  return who ? `${who}님 폴더${m[2] ?? ''}` : p
}

interface Names { people: Map<string, string>; groups: Map<string, string>; devices: Map<string, string>; budgets: Map<string, string> }

function loadNames(db: Database): Names {
  return {
    people: new Map(listUsers(db).map((u) => [u.id, u.name] as [string, string])),
    groups: new Map(listGroups(db).map((g) => [g.id, `그룹 ${g.name}`] as [string, string])),
    devices: new Map(listTokens(db).map((t) => [t.id, `PC '${t.name}'${t.user_name ? ` (${t.user_name})` : ''}`] as [string, string])),
    budgets: new Map(listBudgets(db).map((b) => [b.id, `${b.subjectName} ${PERIOD_LABEL[b.period] ?? ''} 예산`] as [string, string])),
  }
}

/** The target as people read it: a name instead of an id where we can find one. */
export function targetText(action: string, target: string | null, detail: string | null, n: Names): string {
  if (!target) return ''
  const named = n.people.get(target) ?? n.groups.get(target) ?? n.devices.get(target) ?? n.budgets.get(target)
  if (named) return named
  if (action.startsWith('budget.')) {
    try { const d = JSON.parse(detail ?? '{}'); if (typeof d.subject === 'string') return `${d.subject} 예산` } catch {}
    return '예산'
  }
  if (action.startsWith('device.')) {
    try { const d = JSON.parse(detail ?? '{}'); if (typeof d.device === 'string') return `PC '${d.device}'` } catch {}
  }
  if (action.startsWith('rule.') || action.startsWith('file.') || action.startsWith('hub.') || target.includes('/')) return pathLabel(target, n.people)
  return target
}

function AuditPage(p: { web: Web; c: C; flashes: Flash[] }) {
  const { db } = p.web.ctx
  const beforeQ = Number(p.c.req.query('before'))
  const before = Number.isInteger(beforeQ) && beforeQ > 0 ? beforeQ : undefined
  const rows = listAudit(db, PAGE, before)
  const n = loadNames(db)
  const last = rows[rows.length - 1]
  return (
    <Shell c={p.c} title="기록" active="/admin/audit" flashes={p.flashes}>
      <h1>기록</h1>
      <p class="lead">누가 언제 무엇을 바꿨는지 남아요. 로그인과 PC 연결도 남아요. 비밀번호, 키, 파일 내용은 남기지 않아요.</p>
      {before ? <p class="small"><a href="/admin/audit">← 최근 기록으로</a></p> : null}
      {rows.length ? (
        <div class="tablewrap"><table>
          <thead><tr><th class="nowrap">언제</th><th class="nowrap">누가</th><th>한 일</th><th class="hide-sm">대상</th><th class="hide-sm">내용</th></tr></thead>
          <tbody>{rows.map((r) => {
            const target = targetText(r.action, r.target, r.detail, n)
            return (
              <tr>
                <td class="nowrap">{fmtDateTime(r.at)}</td>
                <td class="nowrap">{r.actor ? n.people.get(r.actor) ?? r.actor : <span class="muted">—</span>}</td>
                <td>{ACTION_LABEL[r.action] ?? <code>{r.action}</code>}{target ? <div class="muted small show-sm" style="word-break:break-word">{target}</div> : null}</td>
                <td class="hide-sm" style="word-break:break-word">{target}</td>
                <td class="hide-sm muted small">{detailText(r.detail)}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      ) : <Empty title={before ? '더 오래된 기록이 없어요' : '아직 기록이 없어요'} />}
      {rows.length === PAGE && last ? <a class="btn" href={`/admin/audit?before=${last.id}`}>더 오래된 기록 보기</a> : null}
    </Shell>
  )
}

export function mountAudit(app: App, web: Web) {
  app.get('/admin/audit', (c) => render(c, <AuditPage web={web} c={c} flashes={takeFlashes(web, c)} />))
}
