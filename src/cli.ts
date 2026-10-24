// Admin CLI on the hub machine: `bun src/cli.ts <command>` (the installed `trina-ax` wrapper calls this).
//   status                         what is configured, who is there
//   init --username U --name N     create the owner (password from stdin or prompted)
//   set-key                        store the company Anthropic API key (read from stdin, never an argument)
//   remove-key                     delete it
//   set-url --public URL --lan URL save the addresses PCs use
//   user-add U "Name" [--admin]    add a person; prints a temporary password once
//   reset-password U               new temporary password, printed once
//   enroll U                       one-time PC code + install commands
import path from 'node:path'
import { loadConfig, hubUrl } from './config'
import { openDb, getSetting, setSetting } from './db'
import { fileSecrets } from './secrets'
import { createUser, getUserByUsername, listUsers, setPassword } from './auth/users'
import { makeEnrollCode } from './auth/enroll'
import { initTeamFolder } from './policy/rules-admin'
import { secret } from './ids'
import { PRODUCT } from './product'

const args = process.argv.slice(2)
const cmd = args[0]
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const has = (name: string) => args.includes(name)

const config = loadConfig()
const db = openDb(path.join(config.dataDir, 'hub.db'))
const secrets = fileSecrets(config.dataDir)

async function readSecretLine(prompt: string): Promise<string> {
  if (process.stdin.isTTY) {
    process.stdout.write(prompt)
    Bun.spawnSync(['stty', '-echo'], { stdin: 'inherit' })
    try {
      for await (const line of console) return line.trim()
    } finally {
      Bun.spawnSync(['stty', 'echo'], { stdin: 'inherit' })
      process.stdout.write('\n')
    }
  }
  const text = await new Response(Bun.stdin.stream()).text()
  return text.split(/\r?\n/)[0]!.trim()
}

const tempPassword = () => secret(9).replace(/[-_]/g, 'x')
const urls = () => {
  const pub = getSetting<string | null>(db, 'publicUrl', config.publicUrl)
  const lan = getSetting<string | null>(db, 'lanUrl', config.lanUrl)
  return { pub, lan, best: pub ?? lan ?? hubUrl(config) }
}

function die(msg: string): never { console.error(msg); process.exit(1) }

switch (cmd) {
  case 'status': {
    const u = urls()
    const users = listUsers(db)
    console.log(`${PRODUCT.displayName} ${PRODUCT.version}`)
    console.log(`  data       ${config.dataDir}`)
    console.log(`  team       ${config.teamRoot}`)
    console.log(`  listen     http://${config.host}:${config.port}`)
    console.log(`  public URL ${u.pub ?? '(없음: 스킬 배포에는 https 공개 주소가 필요해요)'}`)
    console.log(`  LAN URL    ${u.lan ?? '(없음)'}`)
    console.log(`  API key    ${secrets.apiKeyHint() ?? '(없음: 관리자 설정 또는 `set-key`로 넣어 주세요)'}`)
    console.log(`  claude     ${config.claudeBin ?? '(없음: 휴대폰·예약 작업이 꺼져 있어요)'}`)
    console.log(`  people     ${users.length} (${users.filter((x) => x.status === 'active').length} active)`)
    if (!users.length) {
      const t = secrets.ensureSetupToken()
      console.log(`  setup      이 컴퓨터: http://127.0.0.1:${config.port}/setup  ·  다른 컴퓨터: ${u.best}/setup?t=${t}`)
    }
    break
  }
  case 'init': {
    if (listUsers(db).length) die('이미 소유자가 있어요.')
    const username = flag('--username') ?? die('--username 이 필요해요.')
    const name = flag('--name') ?? username
    const password = await readSecretLine('소유자 비밀번호: ')
    const owner = await createUser(db, { username, name, role: 'owner', password })
    if (flag('--company')) setSetting(db, 'companyName', flag('--company'))
    secrets.clearSetupToken()
    initTeamFolder(db, config.teamRoot)
    console.log(`소유자 ${owner.username}을(를) 만들었어요. ${urls().best}/login 에서 로그인하세요.`)
    break
  }
  case 'set-key': {
    const key = await readSecretLine('Anthropic API 키: ')
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) die('Anthropic API 키 형식이 아니에요 (sk-ant-…).')
    secrets.setApiKey(key)
    console.log(`저장했어요 (${secrets.apiKeyHint()}).`)
    break
  }
  case 'remove-key':
    secrets.setApiKey(null)
    console.log('API 키를 지웠어요.')
    break
  case 'set-url': {
    const pub = flag('--public'), lan = flag('--lan')
    if (pub !== undefined) setSetting(db, 'publicUrl', pub ? pub.replace(/\/+$/, '') : null)
    if (lan !== undefined) setSetting(db, 'lanUrl', lan ? lan.replace(/\/+$/, '') : null)
    console.log(`public: ${urls().pub ?? '-'}  lan: ${urls().lan ?? '-'}  (서버를 다시 시작하면 적용돼요)`)
    break
  }
  case 'user-add': {
    const username = args[1] ?? die('사용법: user-add <아이디> "<이름>" [--admin]')
    const name = args[2] && !args[2].startsWith('--') ? args[2] : username
    const pw = tempPassword()
    const u = await createUser(db, { username, name, role: has('--admin') ? 'admin' : 'member', password: pw, mustChangePassword: true })
    console.log(`${u.name}(${u.username}) 추가. 임시 비밀번호: ${pw}  (처음 로그인할 때 바꾸게 돼요)`)
    break
  }
  case 'reset-password': {
    const u = getUserByUsername(db, args[1] ?? die('사용법: reset-password <아이디>')) ?? die('없는 아이디예요.')
    const pw = tempPassword()
    await setPassword(db, u.id, pw, true)
    console.log(`${u.username} 임시 비밀번호: ${pw}`)
    break
  }
  case 'enroll': {
    const u = getUserByUsername(db, args[1] ?? die('사용법: enroll <아이디>')) ?? die('없는 아이디예요.')
    const { code, expiresAt } = makeEnrollCode(db, u.id, null)
    const hub = urls().best
    console.log(`${u.name}의 PC 연결 코드: ${code} (${new Date(expiresAt).toLocaleString('ko-KR')}까지, 한 번만)`)
    console.log(`  Mac/Linux: curl -fsSL ${hub}/install.sh | bash -s -- ${code}`)
    console.log(`  Windows:   & ([scriptblock]::Create((irm ${hub}/install.ps1))) ${code}`)
    break
  }
  default:
    console.log('사용법: trina-ax <status|init|set-key|remove-key|set-url|user-add|reset-password|enroll>')
    process.exit(cmd ? 1 : 0)
}
db.close()
