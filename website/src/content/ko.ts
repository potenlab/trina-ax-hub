// 한국어 카피 (ax.trina.app/ko). 출처는 런칭 카피 덱 A0-A17이고 en.ts와 같은 모양이어야 해요(`satisfies Copy`).
// ~/.claude/skills/korean-landing-copy 기준: 제목은 명사형, 본문은 해요체, 영어 섹션 라벨 없음.
// 제목의 "\n"은 줄바꿈이 돼요(Lines.astro).
import type { Lang } from '../site'
import type { Copy } from './en'

const ko = {
  lang: 'ko' as Lang,
  skip: '본문으로 건너뛰기',
  brand: '트리나 AX',

  meta: {
    title: '트리나 AX | 직원 모두의 Claude를 회사 AI로',
    description:
      '직원 각자의 Claude에 회사 파일과 일하는 방식을 연결해요. 폴더는 사람마다 볼 수 있는 곳만 열려요. 코드가 공개돼 있어 직접 설치하면 무료이고, 트리나가 회사이름.trina.app으로 호스팅해 드려요.',
    ogImage: '/og-ko.png',
    ogAlt: '트리나 AX: 직원 모두의 Claude를 우리 회사를 아는 AI로.',
    long:
      '트리나 AX는 직원 각자의 Claude에 회사 파일과 스킬, 사람별 사용량을 연결해 주는 오픈소스(Apache-2.0) 소프트웨어예요. 폴더 권한은 사람마다 따로 적용돼요.',
  },

  nav: {
    label: '주 메뉴',
    features: '기능',
    how: '시작하는 법',
    security: '보안',
    openSource: '오픈소스',
    pricing: '비용',
    faq: '자주 묻는 질문',
    github: 'GitHub',
    book: '도입 문의하기',
    theme: '밝은 화면과 어두운 화면 바꾸기',
    menu: '메뉴',
    home: '트리나 AX 처음으로',
    switchLabel: '언어',
    switchTo: 'English',
    switchToLang: 'en',
  },

  hero: {
    pill: '오픈소스 · Apache-2.0',
    title: '직원 모두의 Claude를',
    accent: '우리 회사를 아는 AI로',
    sub:
      '회사 파일과 일하는 방식, 사용량을 직원들이 이미 쓰는 Claude에 연결해요. 데스크톱·휴대폰 앱과 claude.ai, Claude Code 어디서나 돼요. 폴더는 사람마다 볼 수 있는 곳만 열려요.',
    primary: '도입 문의하기',
    secondary: 'GitHub에서 보기',
    note: "직원은 Claude 앱을 받고, 초대 링크를 열고, '연결'만 누르면 돼요.",
  },

  stage: {
    label:
      '예시 화면: 폴더별로 열 수 있는 사람 목록, 직원 두 명이 Claude에 회사 파일을 묻는 대화, 이번 달 사용량 표예요. 영업팀 김민지는 견적서 양식을 찾고, 디자인팀 박준호는 열 수 없는 재무 폴더가 목록에 없다는 답을 받아요.',
    caption: '예시 화면이에요. 회사 이름과 사람, 숫자는 모두 가상이에요.',
    folders: {
      title: '폴더 접근',
      col: '폴더',
      who: '열 수 있는 사람',
      rows: [
        { name: '공용', who: '모두' },
        { name: '영업', who: '영업팀' },
        { name: '재무', who: '재무팀, 대표' },
        { name: '인사', who: '인사팀' },
      ],
    },
    chats: {
      title: 'Claude',
      items: [
        {
          who: '김민지',
          team: '영업팀',
          q: '지난달 견적서 양식 찾아 줘',
          a: '공용/양식/견적서_2026.docx 를 찾았어요. 지난달 바뀐 할인 조건도 반영돼 있어요.',
          file: '견적서_2026.docx',
        },
        {
          who: '박준호',
          team: '디자인팀',
          q: '재무 폴더에 뭐 있어?',
          a: "열 수 있는 폴더 중에 '재무'는 없어요.",
          file: '',
        },
      ],
    },
    usage: {
      title: '이번 달 사용량',
      cols: { person: '사람', team: '팀', requests: '요청', skill: '많이 쓴 스킬' },
      rows: [
        { person: '김민지', team: '영업', requests: '214', skill: '견적서 양식' },
        { person: '박준호', team: '디자인', requests: '96', skill: '주간 보고' },
        { person: '이서연', team: '재무', requests: '158', skill: '경비 정리' },
        { person: '최하준', team: '인사', requests: '61', skill: '입사 안내' },
      ],
    },
  },

  works: {
    title: '지금 쓰는 Claude 그대로',
    items: ['Claude desktop app', 'claude.ai', 'Claude for iOS and Android', 'Claude Code', 'Cowork'],
    note:
      'Claude의 커스텀 커넥터와 Claude Code 플러그인으로 연결해요. Claude는 Anthropic의 상표이고, 트리나 AX는 주식회사 트리나가 만든 별도 제품이에요.',
  },

  problem: {
    title: 'Claude는 있는데 우리 회사는 모르는 상태',
    body:
      '계정은 나눠 줬는데 파일은 직원마다 직접 붙여 넣어요. 묻는 방식도 제각각이에요. 어떤 폴더까지 맡겨도 되는지, 비용이 얼마나 나오는지도 알기 어려워요.',
  },

  features: {
    title: '회사 파일과 일하는 방식을 아는 Claude',
    items: [
      {
        id: 'files',
        title: '사람마다 다르게 열리는 회사 파일',
        body: 'Claude가 회사 폴더의 문서를 찾아 읽고, 만든 결과물도 거기에 저장해요. 볼 수 있는 폴더만 열리고, 나머지는 이름도 보이지 않아요.',
        ui: {
          head: '김민지의 Claude에 보이는 폴더',
          tree: [
            { kind: 'folder', name: '공용' },
            { kind: 'file', name: '양식/견적서_2026.docx' },
            { kind: 'folder', name: '영업' },
            { kind: 'file', name: '제안서/A사_제안서.docx' },
          ],
        },
      },
      {
        id: 'formats',
        title: '한글 파일까지 읽는 Claude',
        body: 'PDF, 워드, 엑셀, 파워포인트에 한글(HWP·HWPX) 파일도 읽어요.',
        ui: { head: '텍스트로 읽어요', types: ['PDF', 'DOCX', 'XLSX', 'PPTX', 'HWP', 'HWPX'] },
      },
      {
        id: 'skills',
        title: '모든 직원에게 같은 업무 방식',
        body: '견적서, 주간 보고처럼 자주 하는 일을 스킬로 한 번 만들면 모든 직원의 Claude에 들어가요. 고치면 다 같이 바뀌어요.',
        ui: {
          head: '회사 스킬',
          rows: [
            { name: '견적서 양식', state: '모두에게 새 버전', fresh: true },
            { name: '주간 보고', state: '설치됨', fresh: false },
            { name: '경비 정리', state: '설치됨', fresh: false },
          ],
        },
      },
      {
        id: 'usage',
        title: '누가 얼마나 쓰는지 보이는 화면',
        body: '사람별·팀별 사용량과 많이 쓰는 스킬을 한 화면에서 봐요. 회사 키로 쓰는 직원에게는 월 한도도 걸 수 있어요.',
        ui: {
          head: '이번 달',
          export: 'CSV로 내보내기',
          limit: '월 한도',
          rows: [
            { name: '김민지', w: 82 },
            { name: '이서연', w: 61 },
            { name: '박준호', w: 37 },
            { name: '최하준', w: 24 },
          ],
        },
      },
      {
        id: 'log',
        title: '누가 무엇을 열었는지 남는 기록',
        body: '누가 어떤 파일을 읽고 고쳤는지 남아요. 덮어쓰거나 지운 파일은 90일 동안 보관해서 되살릴 수 있어요.',
        ui: {
          head: '기록',
          rows: [
            { who: '김민지', did: '읽음', what: '영업/제안서/A사_제안서.docx' },
            { who: '박준호', did: '수정', what: '공용/양식/견적서_2026.docx' },
            { who: '이서연', did: '삭제', what: '재무/영수증/10월.xlsx', restore: '되살리기' },
          ],
        },
      },
      {
        id: 'phone',
        title: '휴대폰에서도 같은 회사 파일',
        body: 'Claude 휴대폰 앱에서도 같은 연결로 회사 파일을 물어볼 수 있어요.',
        ui: {
          q: '지난달 견적서 양식 찾아 줘',
          a: '견적서_2026.docx 를 찾았어요.',
        },
      },
    ],
  },

  how: {
    title: '한 번 준비하면, 직원은 묻기만',
    steps: [
      {
        title: '회사 허브 준비',
        body: '트리나 서버의 회사이름.trina.app이나 사무실 Mac mini, 회사 서버에 설치해요. 회사 파일은 브라우저에서 올리거나 폴더째 옮겨요.',
      },
      {
        title: 'Claude 조직에 한 번 연결',
        body: 'Claude Team이나 Enterprise면 관리자가 커넥터를 한 번 등록하고, 허브가 만들어 주는 설정을 붙여 넣어요. 직원 PC마다 설치할 건 없어요.',
      },
      {
        title: '직원 초대',
        body: "직원은 초대 링크에서 비밀번호를 정하고, Claude 앱에서 '연결'을 누르면 끝나요.",
      },
    ],
    note:
      'Pro·Max 개인 구독이면 직원이 커넥터 주소를 한 번 붙여 넣어요. 회사 API 키로 쓰는 직원은 명령어 한 줄로 Claude Code를 연결해요.',
  },

  paying: {
    title: '각자 구독이든 회사 키든',
    body:
      '직원마다 자기 Claude 구독(Team·Pro·Max)으로 써도 되고, 회사 API 키 하나로 내면서 사람별 월 한도를 정해도 돼요. 어느 쪽이든 한 계정을 여럿이 나눠 쓰지 않아요. 구독 하나를 나눠 쓰는 건 Claude 약관에 어긋나요.',
    or: '또는',
    options: [
      { title: '각자 구독', chips: ['Team', 'Pro', 'Max'] },
      { title: '회사 키 하나', chips: ['사람별 월 한도'] },
    ],
  },

  security: {
    title: '권한은 그대로, 기록은 남게',
    lead: '약속하는 것과 약속하지 않는 것을 그대로 적어 뒀어요.',
    promises: [
      '파일 요청은 어느 앱에서 오든 폴더 규칙을 거쳐요.',
      '회사 API 키는 허브에만 있고 직원 PC로 가지 않아요.',
      'PC와 앱 연결마다 따로 토큰을 주고, 해시로만 저장하고, 언제든 끊을 수 있어요.',
      '올라온 문서는 격리된 환경에서 열어요.',
      '기록에는 토큰, 키, 비밀번호, 파일 내용이 남지 않아요.',
    ],
    limitsLabel: '약속하지 않는 것',
    limits:
      'Claude가 답하려고 읽은 내용은 쓰는 Claude 요금제의 약관에 따라 Anthropic으로 가요. 서버 관리자 권한이 있는 사람은 파일을 볼 수 있고, 트리나가 호스팅하는 허브라면 트리나 운영자도 여기에 들어가요.',
    link: '보안 자세히 보기',
  },

  openSource: {
    title: '코드까지 공개한 회사 AI',
    body:
      '트리나 AX의 코드는 모두 GitHub에 공개돼 있어요(Apache-2.0). 회사 파일로 무엇을 하는지 직접 확인할 수 있고, 직접 설치해서 무료로 쓸 수 있어요. 저희와 계약을 끝내도 같은 소프트웨어를 계속 쓸 수 있어요.',
    repo: 'potenlab/trina-ax',
    license: 'Apache-2.0',
    cmds: ['git clone https://github.com/potenlab/trina-ax', 'cd trina-ax && bun install && bun run dev'],
    cta: 'GitHub에서 보기',
    copy: '복사',
    copied: '복사했어요',
    copyLabel: '명령어 복사',
  },

  pricing: {
    title: '직접 설치는 무료,\n트리나 호스팅은 월 {from}부터',
    corner: '구분',
    cols: ['직접 설치 (오픈소스)', '트리나 호스팅'],
    rows: [
      { label: '비용', a: '무료 · Apache-2.0', b: '요금제에 따라 월 {from}부터' },
      { label: '운영하는 곳', a: '우리 회사', b: '트리나' },
      { label: '주소', a: '회사 서버나 사무실 Mac mini', b: '회사이름.trina.app' },
      { label: '업데이트·백업', a: '직접', b: '트리나가 해요' },
      { label: '문제가 생기면', a: 'GitHub 이슈', b: '트리나 담당자' },
    ],
    startLabel: '시작하기',
    startA: '설치 안내 보기',
    startB: '요금제 보기',
    plansTitle: '트리나 호스팅 요금제',
    plans: { starter: '스타터', team: '팀', business: '비즈니스' },
    perMonth: '/ 월',
    people: '최대 {n}명',
    server: '회사 전용 서버: vCPU {cpu}개, 메모리 {mem}GB, 저장공간 {disk}GB',
    planCta: '도입 문의하기',
    custom: {
      name: '더 큰 회사',
      price: '견적',
      people: '40명이 넘는 회사',
      body: '회사 AWS 계정이나 사무실 서버, Mac mini에 설치해요. 트리나와 직접 계약해요.',
      cta: '상담하고 견적 받기',
    },
    included:
      '모든 요금제에는 회사 전용 AWS 서울 서버와 회사이름.trina.app 주소가 있어요. 처음 설치부터 업데이트, 백업, 모니터링까지 트리나가 맡고, 문의에는 트리나 담당자가 답해 드려요.',
    fine:
      '가격은 달러 기준이고 세금은 별도예요. 결제는 해외 결제 대행사(Merchant of Record)인 Polar나 Creem이 맡고, 나라별 세금을 더해 청구해요. 해지할 때까지 매달 자동으로 결제돼요. 영수증 메일의 결제 포털에서 언제든 해지할 수 있고, 결제한 달 끝까지 쓸 수 있어요. 첫 결제 후 14일 안에 요청하면 전액 환불해 드려요. 원화 계약과 세금계산서가 필요하면 문의해 주세요.',
    termsLink: '이용약관(영문)',
    refundLink: '환불 정책(영문)',
    blocks: [
      {
        title: '서버 기준 요금',
        body: '요금제마다 회사 전용 AWS 서버가 하나씩 있고, 인원에 맞춰 크기를 정했어요. 요금은 그 서버 비용에 트리나의 운영을 더한 금액이에요.',
      },
      {
        title: '따로 내는 Claude 사용료',
        body: 'Claude 사용료는 Anthropic에 직접 내요. 트리나에는 호스팅 요금제만 내요.',
      },
      {
        title: '호스팅이 필요 없는 경우',
        body: '서버를 직접 운영할 개발자가 있으면 오픈소스만으로 충분해요.',
      },
    ],
  },

  examples: {
    title: '대표부터 현장까지, 평소에 묻는 것들',
    note: '예시예요.',
    asks: '묻는 말',
    gets: '돌아오는 답',
    items: [
      {
        role: '대표',
        q: '이번 분기 견적 중에 아직 답이 없는 곳 정리해 줘',
        a: '견적 폴더에서 회신이 없는 곳을 날짜순으로 정리해 드려요.',
      },
      {
        role: '영업',
        q: 'A사 제안서랑 같은 형식으로 B사 제안서 초안 써 줘',
        a: '회사 제안서 스킬에 맞춘 초안이 영업 폴더에 저장돼요.',
      },
      {
        role: '재무',
        q: '10월 경비 영수증 파일에서 합계 내 줘',
        a: '재무 폴더의 영수증을 읽어서 항목별 합계를 보여 드려요.',
      },
      {
        role: '인사',
        q: '새로 온 직원 안내 문서 요약해 줘',
        a: '인사 폴더의 안내 문서를 한 장으로 줄여 드려요.',
      },
    ],
  },

  service: {
    title: '설치에서 끝나지 않는 도입',
    body:
      '직원들이 어떤 일에 시간을 쓰는지 듣고, 허브와 폴더 권한을 정리하고, Claude 조직에 연결해요. 그 뒤로 매달 자주 하는 일을 스킬로 만들어 더해요.',
    path: ['현장 이야기 듣기', '허브와 폴더 권한 정리', 'Claude 조직에 연결', '매달 자주 하는 일을 스킬로'],
  },

  faq: {
    title: '도입 전에 궁금한 점',
    items: [
      {
        q: '기술을 몰라도 쓸 수 있나요?',
        a: '네. 직원은 평소 쓰던 Claude 그대로 써요. 허브 준비와 Claude 조직 연결은 저희가 해요. 직접 설치하려면 서버를 다뤄 본 개발자가 있어야 해요.',
      },
      {
        q: '정말 무료인가요?',
        a: '소프트웨어는 무료예요(Apache-2.0). 트리나 호스팅만 유료이고, 인원에 따라 고르는 월 요금제예요. 처음 설치도 들어 있어요. Claude 사용료는 따로 Anthropic에 내요.',
      },
      {
        q: '회사 파일은 어디에 있나요?',
        a: '허브에 있어요. 트리나가 호스팅하면 트리나 서버의 회사 전용 허브에, 직접 설치하면 회사 서버나 사무실 Mac mini에 있어요. 파일 내용은 Claude가 답하려고 읽을 때만 Anthropic으로 가요.',
      },
      {
        q: '다른 팀 폴더를 볼 수 있나요?',
        a: '아니요. 폴더마다 볼 수 있는 사람과 팀을 정하고, 각자의 Claude는 그 폴더만 열어요. 볼 수 없는 폴더는 없는 폴더처럼 보여요.',
      },
      {
        q: '어떤 Claude 요금제가 필요해요?',
        a: 'Claude Team이나 Enterprise면 관리자가 한 번에 설정할 수 있어서 가장 간편해요. Pro·Max 개인 구독이나 회사 API 키로도 쓸 수 있어요.',
      },
      {
        q: '계약을 끝내면요?',
        a: '회사 파일은 그대로 넘겨 드려요. 같은 오픈소스를 직접 설치해서 계속 쓸 수도 있어요.',
      },
      {
        q: 'ChatGPT도 되나요?',
        a: '지금은 Claude만 돼요.',
      },
      {
        q: 'Anthropic과 관계가 있나요?',
        a: '아니요. 트리나 AX는 주식회사 트리나가 만든 별도 제품이에요.',
      },
    ],
  },

  cta: {
    title: '30분 상담으로 시작하기',
    sub: '지금 하는 일을 들려주시면 어디부터 연결하면 좋을지 같이 정리해 드려요.',
    primary: '도입 문의하기',
    secondary: 'GitHub에서 보기',
  },

  footer: {
    company: '주식회사 트리나 (Trina Inc.)',
    links: {
      company: 'trina.app',
      github: 'GitHub',
      security: '보안',
      privacy: '개인정보 처리방침(영문)',
      terms: '이용약관(영문)',
      refund: '환불 정책(영문)',
    },
    trademark:
      'Claude는 Anthropic의 상표이고, 트리나 AX는 주식회사 트리나가 만든 별도 제품이에요.',
    langLabel: '언어',
  },

  secPage: {
    title: '보안 | 트리나 AX',
    description:
      '트리나 AX가 회사 파일에 대해 무엇을 약속하고, 어떻게 지키고, 어디까지는 약속하지 않는지 쉬운 말로 적었어요.',
    ogImage: '/og-ko.png',
    h1: '권한은 그대로, 기록은 남게',
    lead: '약속하는 것과 약속하지 않는 것을 그대로 적어 뒀어요.',
    promisesTitle: '다섯 가지 약속',
    promises: [
      {
        title: '파일 요청은 어느 앱에서 오든 폴더 규칙을 거쳐요.',
        how: '파일을 읽고, 찾고, 쓰고, 옮기고, 지우는 모든 요청이 허브에서 같은 권한 확인을 거쳐요. 열 수 없는 폴더는 없는 폴더와 똑같이 답해요.',
      },
      {
        title: '회사 API 키는 허브에만 있고 직원 PC로 가지 않아요.',
        how: 'PC는 자기 토큰으로 허브와 통신해요. 허브가 Anthropic을 부를 때 회사 키를 붙이고, PC의 토큰은 넘기지 않아요.',
      },
      {
        title: 'PC와 앱 연결마다 따로 토큰을 주고, 해시로만 저장하고, 언제든 끊을 수 있어요.',
        how: 'SHA-256 해시만 저장해서 데이터베이스에도 토큰으로 쓸 수 있는 값이 없어요. Claude 앱 연결 토큰은 1시간만 쓰고, 계속 바뀌는 갱신 토큰으로 이어 줘요.',
      },
      {
        title: '올라온 문서는 격리된 환경에서 열어요.',
        how: 'PDF, 오피스, 한글 파일은 네트워크가 막힌 보조 프로그램이 읽고, 빈 작업 폴더에만 쓸 수 있어요. Mac mini에서는 macOS 샌드박스가, Linux 서버에서는 bubblewrap이 설치돼 있을 때 bubblewrap이 맡아요.',
      },
      {
        title: '기록에는 토큰, 키, 비밀번호, 파일 내용이 남지 않아요.',
        how: '파일에 어떤 일이 있었는지는 누가 어떤 경로에 무엇을 했는지만 남고, 파일 안의 내용은 남지 않아요.',
      },
    ],
    limitsTitle: '약속하지 않는 것',
    limitsLead: '약속이 끝나는 곳이에요.',
    limits: [
      'Claude가 답하려고 읽은 내용은 쓰는 Claude 요금제의 약관에 따라 Anthropic으로 가요.',
      '서버 관리자 권한이 있는 사람은 파일을 볼 수 있고, 트리나가 호스팅하는 허브라면 트리나 운영자도 여기에 들어가요.',
      'https 없이 사무실 안에서만 쓰면 PC와 허브 사이가 암호화되지 않아요.',
      '각자 구독으로 쓰면 사용량 화면의 비용은 Claude Code가 보내 주는 값으로 낸 추정치예요.',
    ],
    runsTitle: '서버가 있는 곳',
    runs: [
      { title: '트리나 호스팅', body: '트리나 서버의 회사이름.trina.app에 회사 허브가 있어요.' },
      { title: '회사 서버', body: '직접 운영하는 Linux 서버예요. 관리자는 우리 회사예요.' },
      { title: '사무실 Mac mini', body: '사무실에 둔 Mac mini예요. 관리자는 우리 회사예요.' },
    ],
    reportTitle: '취약점 신고',
    reportBody:
      '권한보다 많은 파일을 보거나 바꾸거나 비용을 쓸 수 있는 버그는 보안 버그예요. 제목에 "Security: Trina AX"를 적어 메일로 알려 주세요. 공개 이슈로는 올리지 말아 주세요. 72시간 안에 답하고, 고친 버전은 모두에게 동시에 내요.',
    reportMail: 'contact@trina.app',
    reportLink: 'GitHub의 SECURITY.md 보기',
    back: '트리나 AX로 돌아가기',
    breadcrumb: '보안',
  },

  notFound: {
    title: '페이지를 찾을 수 없어요',
    body: '없는 주소예요. 있는 페이지는 처음 화면에서 찾을 수 있어요.',
    back: '트리나 AX로 돌아가기',
  },
} satisfies Copy

export default ko
