// Illustrative workflows, verified against trina-app/trina-ax 5c15812.
// These are configured team skills and sample files, not preinstalled integrations or promised outcomes.
export type Preview =
  | { kind: 'file'; file: string; title: string; lines: string[] }
  | { kind: 'table'; title: string; columns: string[]; rows: string[][]; foot?: string }
  | { kind: 'number'; title: string; value: string; detail: string }
export interface TeamExample {
  person: string
  request: string
  skill: string
  sources: string[]
  tool?: { kind: 'clock' | 'globe' | 'plug'; text: string }
  answer: string
  preview: Preview
  confirmation?: { title: string; body: string; status: string }
}
export interface Team {
  id: string
  name: string
  role: string
  guide: string
  examples: TeamExample[]
}
export interface TeamCopy {
  title: string; body: string; scope: string; note: string
  label: string; skill: string; source: string; result: string; jump: string
  more: string; motion: string; teams: Team[]
}

const ko: TeamCopy = {
  title: '팀마다 일하는 AI 팀원',
  body: '잘 만든 결과를 다음에도, 다른 팀원도. 팀에 등록한 스킬로 우리 회사의 작성 기준을 따르고, 우리 팀 자료에서 답을 찾아요.',
  scope: 'AI는 묻는 사람이 열 수 있는 폴더 안에서만 찾아요.',
  note: '예시 화면이에요. 이름·파일·숫자는 가상 데이터이며, 결과는 등록한 팀 스킬과 자료에 따라 달라요.',
  label: '예시', skill: '팀 스킬', source: '팀 파일', result: '결과 미리보기', jump: '팀별 예시 바로 가기',
  more: '관련 가이드 보기', motion: '스크롤 효과 멈추기',
  teams: [
    {
      id: 'sales', name: '영업', role: '고객 미팅부터 제안까지, 우리 팀의 영업 방식으로', guide: 'use-cases/sales-quote',
      examples: [
        {
          person: '김민지 · 영업 담당', request: 'B사 센서 120개 견적서 만들어 줘. 우리 단가표랑 견적 기준으로.',
          skill: '견적서 작성', sources: ['영업/2026-단가표.xlsx', '영업/지난-견적서/'],
          answer: '품목과 수량 할인 기준을 반영했어요. 수량·납기를 확인할 수 있는 엑셀로 정리했어요.',
          preview: { kind: 'table', title: 'B사_견적서.xlsx', columns: ['품목', '수량', '납기'], rows: [['센서 S-200', '120', '11/20'], ['설치 브래킷', '120', '11/20']], foot: '값으로 정리한 새 엑셀 · 수식 없음' },
        },
        {
          person: '박지훈 · 영업 담당', request: '어제 C사 미팅 메모로 후속 메일 써 줘. 약속한 내용 빠짐없이.',
          skill: '미팅 후속 메일', sources: ['영업/고객-미팅메모/C사-1028.md'],
          answer: '우리 팀 메일 순서에 맞춰 요청사항과 다음 일정을 담았어요. 확인하고 직접 보내 주세요.',
          preview: { kind: 'file', file: 'C사_후속메일_초안.docx', title: '어제 논의한 도입 일정 안내', lines: ['요청사항 · 설치 일정과 지원 범위', '다음 단계 · 11/2까지 수정 제안서 전달'] },
        },
        {
          person: '김민지 · 영업 담당', request: '지난 제안서 3건에서 D사에 맞는 내용 골라서 발표 자료로 만들어 줘.',
          skill: '고객 제안 자료', sources: ['영업/제안서/지난-제안서-3건/', '영업/D사-요구사항.docx'],
          answer: 'D사 요구사항에 맞춰 8장으로 구성했어요. 팀 스킬에 둔 발표 양식을 적용했어요.',
          preview: { kind: 'file', file: 'D사_제안_초안.pptx', title: 'D사 도입 제안 · 8장', lines: ['현재 과제 → 도입 범위 → 추진 일정', '지난 사례 2건 · 고객별 비교표'] },
        },
      ],
    },
    {
      id: 'marketing', name: '마케팅', role: '브랜드 말투부터 발표 양식까지, 우리 회사답게', guide: 'use-skills',
      examples: [
        {
          person: '정유진 · 콘텐츠 담당', request: '이번 기능 업데이트로 블로그 초안 써 줘. 우리 브랜드 말투로.',
          skill: '브랜드 블로그 작성', sources: ['마케팅/브랜드-가이드.docx', '제품/10월-업데이트.md'],
          answer: '브랜드 가이드의 말투로 고객이 달라지는 점부터 썼어요. 게시 전 검토할 초안이에요.',
          preview: { kind: 'file', file: '10월_업데이트_초안.docx', title: '회의가 끝나면, 다음 할 일까지', lines: ['도입부 · 고객이 겪던 불편', '본문 · 바뀐 기능과 활용 예시 3개'] },
        },
        {
          person: '정유진 · 콘텐츠 담당', request: '다음 달 글 주제 3개 찾아 줘. 지난 글과 겹치지 않게 업계 소식도 봐 줘.',
          skill: '월간 콘텐츠 기획', sources: ['마케팅/지난-글-목록.xlsx'], tool: { kind: 'globe', text: '웹 검색 · 업계 소식' },
          answer: '지난 글 목록과 검색한 소식을 비교했어요. 주제마다 확인할 출처를 붙여 기획안으로 정리했어요.',
          preview: { kind: 'table', title: '11월 콘텐츠 기획안', columns: ['주차', '주제'], rows: [['1주', '고객 미팅 기록 정리법'], ['2주', '팀 문서 작성 기준 만들기'], ['3주', '연말 업무 인수인계']] },
        },
        {
          person: '이수빈 · 브랜드 담당', request: '회사 소개서로 전시회 발표 자료 6장 만들어 줘. 우리 발표 양식으로.',
          skill: '브랜드 발표 자료', sources: ['마케팅/회사소개.docx', '마케팅/전시회-참가메모.md'],
          answer: '팀 스킬의 발표 양식에 맞춰 핵심만 6장으로 정리했어요.',
          preview: { kind: 'file', file: '전시회_회사소개.pptx', title: '회사 소개 · 6장', lines: ['고객의 문제 · 제품 소개 · 사용 사례', '팀 스킬에 등록한 글꼴과 문서 스타일'] },
        },
      ],
    },
    {
      id: 'finance', name: '재무·회계', role: '흩어진 내역을 모아, 우리 기준으로 정리', guide: 'use-cases/expense-summary',
      examples: [
        {
          person: '이서연 · 재무 담당', request: '10월 카드내역을 부서별로 정리해 줘. 영수증 확인이 필요한 건도 표시해 줘.',
          skill: '경비 분류 기준', sources: ['재무/카드내역-10월.xlsx', '재무/영수증-대장-10월.xlsx'],
          answer: '회사 경비 기준으로 분류했어요. 대장에 없는 건은 영수증이 없다고 단정하지 않고 확인 필요로 표시했어요.',
          preview: { kind: 'table', title: '10월_경비정리.xlsx', columns: ['부서', '건수', '확인 필요'], rows: [['영업', '86', '3'], ['마케팅', '54', '1'], ['개발', '31', '0']], foot: '부서별 · 항목별 시트 / 수식 없는 값' },
        },
        {
          person: '이서연 · 재무 담당', request: '거래처별 미수 내역에서 약정일이 지난 건만 찾아 줘.',
          skill: '미수 내역 점검', sources: ['재무/거래처-미수내역.xlsx'],
          answer: '파일에 적힌 약정일과 입금 상태를 기준으로 확인할 거래 7건을 찾았어요.',
          preview: { kind: 'number', value: '7건', title: '약정일이 지난 거래', detail: '10월 28일 기준 · 미수 내역 파일의 기록 기준' },
        },
        {
          person: '오지은 · 회계 담당', request: '이번 달 마감 메모를 우리 월말 보고 양식으로 한 장에 정리해 줘.',
          skill: '월말 마감 보고', sources: ['재무/10월-마감메모.md', '재무/10월-집행내역.xlsx'],
          answer: '완료한 일과 확인할 일을 나눠서 보고용 PDF로 만들었어요.',
          preview: { kind: 'file', file: '10월_마감보고.pdf', title: '10월 마감 현황', lines: ['완료 · 카드내역 부서별 분류', '확인 필요 · 영수증 대장 미등록 4건'] },
        },
      ],
    },
    {
      id: 'people', name: '인사·총무', role: '규정과 공문을 찾아, 직원에게 필요한 안내로', guide: 'use-cases/official-letter',
      examples: [
        {
          person: '최하준 · 인사 담당', request: '이 한글 공문 읽고 우리가 할 일이랑 회신 초안 써 줘.',
          skill: '공문 회신 양식', sources: ['인사/공문/교육-실시요청.hwp', '인사/교육-실시기록.xlsx'],
          answer: '제출 항목을 정리하고, 교육 기록에 있는 내용으로 Word 회신 초안을 만들었어요.',
          preview: { kind: 'file', file: '교육_실시결과_회신.docx', title: '교육 실시 결과 회신 초안', lines: ['본문 · 실시 일자와 참석 인원', '붙임 · 교육 실시 기록'] },
        },
        {
          person: '최하준 · 인사 담당', request: '새 팀원이 첫날 볼 입사 안내문 만들어 줘. 우리 안내 순서대로.',
          skill: '입사 안내문', sources: ['인사/입사-안내.hwpx', '총무/사무실-이용규칙.docx'],
          answer: '첫날 준비할 것과 자주 묻는 내용을 모아 한 장으로 정리했어요.',
          preview: { kind: 'file', file: '첫날_입사안내.pdf', title: '첫 출근 안내', lines: ['준비 · 계정 신청과 자리 안내', '생활 · 사무실 이용과 문의 담당자'] },
        },
        {
          person: '윤서진 · 팀원', request: '휴가 신청할 때 뭘 적어야 해? 우리 규정에서 찾아 줘.',
          skill: '사내 규정 안내', sources: ['인사/2026-휴가규정.pdf'],
          answer: '휴가규정의 신청 절차를 찾아 정리했어요. 신청서 작성에 필요한 항목이에요.',
          preview: { kind: 'table', title: '휴가규정 · 신청 절차 요약', columns: ['항목', '적을 내용'], rows: [['일정', '시작일과 종료일'], ['종류', '연차 · 반차'], ['인수인계', '업무와 담당자']] },
        },
      ],
    },
    {
      id: 'operations', name: '운영·고객지원', role: '반복 문의와 업무 현황을, 팀의 대응 기준대로', guide: 'external-services',
      examples: [
        {
          person: '한지우 · 고객지원 담당', request: '이 배송 지연 문의 답변 써 줘. 우리 고객 응대 기준으로.',
          skill: '고객 문의 답변', sources: ['고객지원/문의-1028.md', '운영/배송-안내.docx'],
          answer: '안내 문서에서 확인한 범위만 담았어요. 확인하고 직접 보낼 답변 초안이에요.',
          preview: { kind: 'file', file: '배송문의_답변초안.docx', title: '배송 일정 확인 안내', lines: ['고객 상황 확인 → 안내 → 다음 단계', '확인되지 않은 도착일은 약속하지 않기'] },
        },
        {
          person: '한지우 · 고객지원 담당', request: '이번 주 문의에서 반복된 내용만 모아 줘. 우리 주간 정리 방식으로.',
          skill: '주간 문의 정리', sources: ['고객지원/문의내역-10월4주.xlsx'],
          answer: '문의 기록을 유형별로 묶고, 답변 문서에 보완할 내용을 정리했어요.',
          preview: { kind: 'table', title: '10월 4주 · 문의 유형', columns: ['유형', '건수', '보완할 안내'], rows: [['배송', '18', '예상 일정'], ['설치', '12', '시작 순서'], ['계정', '7', '비밀번호 재설정']] },
        },
        {
          person: '강도윤 · 운영 담당', request: '연결해 둔 업무 서비스에서 이번 주 마감할 일을 찾아 우리 보고 양식으로 정리해 줘.',
          skill: '업무 현황 보고', sources: ['운영/담당자-목록.xlsx'], tool: { kind: 'plug', text: '외부 서비스 · 설정한 API 연결로 조회' },
          answer: '사용 권한이 있는 연결에서 마감일을 조회하고, 팀 담당자 목록과 함께 정리했어요.',
          preview: { kind: 'table', title: '이번 주 마감 업무', columns: ['할 일', '담당', '기한'], rows: [['납품 일정 확인', '운영', '10/29'], ['설치 안내 개정', '고객지원', '10/30']], foot: '해당 서비스의 조회 API를 먼저 연결해야 해요.' },
        },
      ],
    },
    {
      id: 'leadership', name: '대표·경영', role: '여러 팀의 기록을 모아, 결정에 필요한 한 장으로', guide: 'use-cases/weekly-report',
      examples: [
        {
          person: '김대호 · 대표', request: '매주 월요일 9시에 영업·재무 자료로 주간 보고 써 줘. 내 폴더에 저장해 줘.',
          skill: '주간 보고 양식', sources: ['영업/주간-기록/', '재무/주간-기록/'], tool: { kind: 'clock', text: '매주 월 09:00 예약 작업 · 팀 시간대' },
          answer: '매주 핵심 숫자와 결정할 일을 정리해요. 아래는 실행을 마친 보고서 예시예요.',
          preview: { kind: 'file', file: '주간보고_10월4주.docx', title: '주간 보고 · 10월 4주', lines: ['영업 · 새 견적 5건, 계약 2건', '결정할 일 · 전시회 일정과 채용 계획', '저장 위치 · 내 폴더'] },
        },
        {
          person: '김대호 · 대표', request: '지난 경영회의 기록에서 아직 결정 안 된 안건만 정리해 줘.',
          skill: '경영회의 안건 정리', sources: ['경영/회의록/10월/'],
          answer: '회의록에 보류로 남은 안건을 담당자와 함께 모았어요.',
          preview: { kind: 'table', title: '다음 회의에서 정할 일', columns: ['안건', '확인할 내용'], rows: [['전시회 참가', '일정과 준비 인력'], ['고객지원 충원', '업무량과 채용 시점']] },
        },
        {
          person: '김대호 · 대표', request: '경영회의 내용을 팀 공지 초안으로 정리해서 공용 폴더에 저장해 줘.',
          skill: '팀 공지 작성', sources: ['경영/회의록/10월-운영계획.md'],
          answer: '공지 초안을 정리했어요. 원본보다 더 많은 사람이 보는 폴더라, 저장 전에 확인을 기다려요.',
          preview: { kind: 'file', file: '11월_운영공지_초안.docx', title: '11월 운영 계획', lines: ['일정 변경과 팀별 준비사항', '공용 폴더 저장 전 · 확인 대기'] },
          confirmation: { title: '팀 서버의 안전 확인', body: '경영 자료를 더 많은 사람이 볼 수 있는 공용 폴더에 저장하려고 해요.', status: '사용자 확인 전에는 저장하지 않아요.' },
        },
      ],
    },
  ],
}

const en: TeamCopy = {
  title: 'An AI teammate for every team',
  body: 'Good work, repeatable across your team. Registered team skills guide the format and standards. Your own team’s files supply the answers.',
  scope: 'The AI searches only folders the person asking can open.',
  note: 'Example screens. Names, files and numbers are fictional. Results depend on your registered team skills and source material.',
  label: 'Example', skill: 'Team skill', source: 'Team files', result: 'Result preview', jump: 'Jump to a team',
  more: 'Explore the guide', motion: 'Pause scroll effects',
  teams: [
    {
      id: 'sales', name: 'Sales', role: 'From customer meetings to proposals, the way your team sells', guide: 'use-cases/sales-quote',
      examples: [
        {
          person: 'Minji · Sales', request: 'Make a quote for 120 sensors for B Corp., using our price list and quoting rules.',
          skill: 'Quote preparation', sources: ['Sales/2026-price-list.xlsx', 'Sales/Previous-quotes/'],
          answer: 'I applied the item and volume-discount rules, with quantities and delivery dates in a new spreadsheet.',
          preview: { kind: 'table', title: 'B-Corp-quote.xlsx', columns: ['Item', 'Qty', 'Due'], rows: [['S-200 sensor', '120', 'Nov 20'], ['Mounting bracket', '120', 'Nov 20']], foot: 'New spreadsheet with values · no formulas' },
        },
        {
          person: 'Jihoon · Sales', request: 'Draft a follow-up email from yesterday’s C Corp. meeting. Include everything we promised.',
          skill: 'Meeting follow-up', sources: ['Sales/Meeting-notes/C-Corp-Oct28.md'],
          answer: 'I used our email structure for the requests and next steps. Review the draft and send it yourself.',
          preview: { kind: 'file', file: 'C-Corp-follow-up-draft.docx', title: 'Following up on your rollout', lines: ['Requested · installation dates and support scope', 'Next step · revised proposal by Nov 2'] },
        },
        {
          person: 'Minji · Sales', request: 'Use our last three proposals to make a presentation that fits D Corp.’s requirements.',
          skill: 'Customer proposals', sources: ['Sales/Proposals/Previous-three/', 'Sales/D-Corp-requirements.docx'],
          answer: 'I organized eight slides around their requirements, using the presentation template in our team skill.',
          preview: { kind: 'file', file: 'D-Corp-proposal-draft.pptx', title: 'D Corp. proposal · 8 slides', lines: ['Current needs → scope → rollout plan', 'Two past examples · customer comparison'] },
        },
      ],
    },
    {
      id: 'marketing', name: 'Marketing', role: 'Your brand’s voice and presentation style, carried into every draft', guide: 'use-skills',
      examples: [
        {
          person: 'Yujin · Content', request: 'Write a blog draft about this feature update in our brand voice.',
          skill: 'Brand blog writing', sources: ['Marketing/Brand-guide.docx', 'Product/October-updates.md'],
          answer: 'I followed the brand guide and led with what changes for customers. This draft is ready for your review.',
          preview: { kind: 'file', file: 'October-update-draft.docx', title: 'From meeting notes to next steps', lines: ['Opening · the customer’s everyday problem', 'Body · updated features and three use cases'] },
        },
        {
          person: 'Yujin · Content', request: 'Find three topics for next month. Check industry news and avoid topics we’ve already covered.',
          skill: 'Monthly content planning', sources: ['Marketing/Published-posts.xlsx'], tool: { kind: 'globe', text: 'Web search · industry news' },
          answer: 'I compared our post list with search results and included sources to check in the content plan.',
          preview: { kind: 'table', title: 'November content plan', columns: ['Week', 'Topic'], rows: [['1', 'Organizing customer meeting notes'], ['2', 'Setting team document standards'], ['3', 'Year-end work handovers']] },
        },
        {
          person: 'Subin · Brand', request: 'Turn our company overview into six slides for the trade show, using our presentation template.',
          skill: 'Brand presentations', sources: ['Marketing/Company-overview.docx', 'Marketing/Trade-show-notes.md'],
          answer: 'I condensed the key points into six slides using the presentation template in our team skill.',
          preview: { kind: 'file', file: 'Trade-show-overview.pptx', title: 'Company overview · 6 slides', lines: ['Customer problem · product · use cases', 'Fonts and document styles from our team template'] },
        },
      ],
    },
    {
      id: 'finance', name: 'Finance & accounting', role: 'Scattered records, organized by your company’s rules', guide: 'use-cases/expense-summary',
      examples: [
        {
          person: 'Seoyeon · Finance', request: 'Sort October card expenses by department and flag receipts that need checking.',
          skill: 'Expense classification', sources: ['Finance/October-card-records.xlsx', 'Finance/October-receipt-register.xlsx'],
          answer: 'I used our expense rules. Records absent from the register are marked for review, not assumed to be missing receipts.',
          preview: { kind: 'table', title: 'October-expenses.xlsx', columns: ['Team', 'Items', 'Check'], rows: [['Sales', '86', '3'], ['Marketing', '54', '1'], ['Engineering', '31', '0']], foot: 'Department and category sheets · values, no formulas' },
        },
        {
          person: 'Seoyeon · Finance', request: 'Find receivables that are past their agreed payment date.',
          skill: 'Receivables review', sources: ['Finance/Customer-receivables.xlsx'],
          answer: 'I found seven items to check, based on the agreed dates and payment status recorded in the file.',
          preview: { kind: 'number', value: '7', title: 'Items past their agreed date', detail: 'As of October 28 · based on the receivables file' },
        },
        {
          person: 'Jieun · Accounting', request: 'Turn this month’s closing notes into one page in our monthly report format.',
          skill: 'Monthly closing report', sources: ['Finance/October-closing-notes.md', 'Finance/October-spending.xlsx'],
          answer: 'I separated completed work from open checks in a PDF report.',
          preview: { kind: 'file', file: 'October-closing-report.pdf', title: 'October closing status', lines: ['Done · card expenses sorted by department', 'Check · four items absent from the receipt register'] },
        },
      ],
    },
    {
      id: 'people', name: 'People & admin', role: 'Company policies and documents, turned into useful employee guidance', guide: 'use-cases/official-letter',
      examples: [
        {
          person: 'Hajun · People', request: 'Read this HWP letter, list our next steps and draft a reply.',
          skill: 'Official reply format', sources: ['People/Letters/Training-request.hwp', 'People/Training-records.xlsx'],
          answer: 'I listed the required submissions and drafted a Word reply using the training records.',
          preview: { kind: 'file', file: 'Training-results-reply.docx', title: 'Training results · draft reply', lines: ['Body · training date and attendance', 'Attachment · training record'] },
        },
        {
          person: 'Hajun · People', request: 'Make a first-day guide for a new teammate, in our usual order.',
          skill: 'New starter guide', sources: ['People/Onboarding.hwpx', 'Admin/Office-guidelines.docx'],
          answer: 'I put first-day essentials and common questions into one page.',
          preview: { kind: 'file', file: 'First-day-guide.pdf', title: 'Your first day', lines: ['Getting ready · account requests and your desk', 'Office life · guidelines and who to ask'] },
        },
        {
          person: 'Seojin · Team member', request: 'What do I need to put in a leave request? Check our policy.',
          skill: 'Company policy guidance', sources: ['People/2026-leave-policy.pdf'],
          answer: 'I found the request procedure in the leave policy. Here are the fields to fill in.',
          preview: { kind: 'table', title: 'Leave policy · request checklist', columns: ['Field', 'What to enter'], rows: [['Dates', 'Start and end date'], ['Type', 'Full day or half day'], ['Handover', 'Tasks and cover person']] },
        },
      ],
    },
    {
      id: 'operations', name: 'Operations & support', role: 'Recurring questions and work updates, handled to your team’s standards', guide: 'external-services',
      examples: [
        {
          person: 'Jiwoo · Support', request: 'Draft a reply to this delayed-delivery question using our support guidelines.',
          skill: 'Customer support replies', sources: ['Support/Inquiry-Oct28.md', 'Operations/Delivery-guide.docx'],
          answer: 'I included only what the guide confirms. Review the draft and send it yourself.',
          preview: { kind: 'file', file: 'Delivery-reply-draft.docx', title: 'An update on your delivery', lines: ['Acknowledge → explain → next step', 'No promised arrival date without confirmation'] },
        },
        {
          person: 'Jiwoo · Support', request: 'Group this week’s recurring questions in our weekly summary format.',
          skill: 'Weekly support summary', sources: ['Support/October-week4-inquiries.xlsx'],
          answer: 'I grouped the records by topic and listed the guidance we could improve.',
          preview: { kind: 'table', title: 'October, week 4 · inquiry topics', columns: ['Topic', 'Count', 'Improve'], rows: [['Delivery', '18', 'Expected timing'], ['Setup', '12', 'Getting started'], ['Accounts', '7', 'Password reset']] },
        },
        {
          person: 'Doyun · Operations', request: 'Find tasks due this week in our connected work service and use our status-report format.',
          skill: 'Work status report', sources: ['Operations/Task-owners.xlsx'], tool: { kind: 'plug', text: 'External service · configured API connection' },
          answer: 'I read due dates through a connection you have access to, then matched them with the team’s owner list.',
          preview: { kind: 'table', title: 'Due this week', columns: ['Task', 'Owner', 'Due'], rows: [['Confirm delivery', 'Ops', 'Oct 29'], ['Revise setup guide', 'Support', 'Oct 30']], foot: 'Requires a configured connection to the service’s read API.' },
        },
      ],
    },
    {
      id: 'leadership', name: 'Leadership', role: 'Team records, brought together for the decisions ahead', guide: 'use-cases/weekly-report',
      examples: [
        {
          person: 'Daeho · CEO', request: 'Every Monday at 9, write a weekly report from Sales and Finance records. Save it in my folder.',
          skill: 'Weekly report format', sources: ['Sales/Weekly-records/', 'Finance/Weekly-records/'], tool: { kind: 'clock', text: 'Scheduled task · Mondays 09:00 · team time zone' },
          answer: 'Each run brings together key figures and decisions to make. Here is an example of a completed report.',
          preview: { kind: 'file', file: 'Weekly-report-Oct-w4.docx', title: 'Weekly report · October, week 4', lines: ['Sales · five new quotes, two contracts', 'Decisions · trade-show dates and hiring plans', 'Saved in · my folder'] },
        },
        {
          person: 'Daeho · CEO', request: 'List the decisions still open in our recent management meeting notes.',
          skill: 'Management meeting agenda', sources: ['Leadership/Meeting-notes/October/'],
          answer: 'I gathered the items marked as deferred, along with what needs checking.',
          preview: { kind: 'table', title: 'Decisions for the next meeting', columns: ['Item', 'To check'], rows: [['Trade-show attendance', 'Timing and staffing'], ['Support hiring', 'Workload and start date']] },
        },
        {
          person: 'Daeho · CEO', request: 'Turn the management meeting notes into a team announcement and save it in the shared folder.',
          skill: 'Team announcements', sources: ['Leadership/Meeting-notes/October-plan.md'],
          answer: 'The draft is ready. The destination has a wider audience than the source, so I’m waiting for confirmation before saving.',
          preview: { kind: 'file', file: 'November-plan-draft.docx', title: 'November operating plan', lines: ['Schedule changes and team preparations', 'Shared-folder save · awaiting confirmation'] },
          confirmation: { title: 'Safety check by the team server', body: 'This would save management material in a shared folder that more people can read.', status: 'Nothing is saved there until you confirm.' },
        },
      ],
    },
  ],
}
export const teamCopy = { en, ko }
