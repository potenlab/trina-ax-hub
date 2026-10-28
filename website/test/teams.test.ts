import { describe, expect, test } from 'bun:test'
import { teamCopy } from '../src/content/teams'
import { attrs, built, visibleText } from './helpers'

for (const [lang, file] of [['en', 'index.html'], ['ko', 'ko/index.html']] as const) {
  describe(`${lang}: team showcase`, () => {
    const copy = teamCopy[lang]
    const html = built(file)
    // Work from the built section, not just the data: detect a dropped card or source in the template.
    const section = html.slice(html.indexOf('id="roles"'), html.indexOf('id="features"'))
    const text = visibleText(section).replace(/\u200b/g, '')

    test('six teams and eighteen complete examples are readable in the initial HTML', () => {
      expect(copy.teams).toHaveLength(6)
      expect(section.match(/class="team-example"/g)).toHaveLength(18)
      expect(section).not.toContain('role="tabpanel"')
      expect(text).toContain(copy.title)
      expect(text).toContain(copy.scope)
      expect(text).toContain(copy.note)
      for (const team of copy.teams) {
        expect(team.examples).toHaveLength(3)
        expect(attrs(section, 'href')).toContain(`#team-${team.id}`)
        expect(attrs(section, 'id')).toContain(`team-${team.id}`)
        for (const example of team.examples) {
          for (const value of [example.person, example.request, `${copy.skill} · ${example.skill}`, example.answer, example.preview.title]) expect(text).toContain(value)
          expect(example.sources.length).toBeGreaterThan(0)
          for (const source of example.sources) expect(text).toContain(`${copy.source} · ${source}`)
          if (example.preview.kind === 'file') expect(text).toContain(example.preview.file)
          if (example.preview.kind === 'table') for (const row of example.preview.rows) for (const cell of row) expect(text).toContain(cell)
          if (example.preview.kind === 'number') expect(text).toContain(example.preview.value)
        }
      }
    })

    test('motion is optional and preview cards do not pretend to be downloads or approval buttons', () => {
      expect(section).toContain('data-team-motion aria-pressed="false" hidden')
      expect(attrs(section, 'href').some(h => /\.(docx|xlsx|pptx|pdf|hwpx)$/.test(h))).toBe(false)
      expect(section.match(/class="team-confirm"/g)).toHaveLength(1)
      const confirmation = copy.teams.at(-1)!.examples.at(-1)!.confirmation!
      expect(text).toContain(confirmation.title)
      expect(text).toContain(confirmation.status)
    })

    test('examples preserve product boundaries and require configured skills and connections', () => {
      const examples = copy.teams.flatMap(t => t.examples)
      const external = examples.find(e => e.tool?.kind === 'plug')!
      expect(external.preview.kind).toBe('table')
      if (external.preview.kind === 'table') expect(external.preview.foot).toContain(lang === 'ko' ? '먼저 연결' : 'configured connection')
      expect(examples.filter(e => e.tool?.kind === 'clock')).toHaveLength(1)
      for (const example of examples) {
        if (example.preview.kind === 'file') expect(example.preview.file).toMatch(/\.(docx|pptx|pdf)$/)
      }
      expect(text).toContain(lang === 'ko' ? '수식 없음' : 'no formulas')
      expect(text).toContain(lang === 'ko' ? '직접 보내 주세요' : 'send it yourself')
      expect(text).not.toMatch(/CRM|자동 발송|자동 게시|automatically (send|publish)/i)
    })
  })
}

test('llms.txt describes all six teams, both inputs and example-data limits', () => {
  const text = built('llms.txt')
  expect(text).toContain('## Examples by team')
  expect(text).toContain(teamCopy.en.note)
  expect(text).toContain(teamCopy.en.scope)
  for (const team of teamCopy.en.teams) {
    expect(text).toContain(`### ${team.name}`)
    for (const example of team.examples) {
      expect(text).toContain(example.request)
      expect(text).toContain(example.skill)
      expect(text).toContain(example.sources[0])
    }
  }
})
