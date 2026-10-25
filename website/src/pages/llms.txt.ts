// /llms.txt (https://llmstxt.org): what Trina AX is, for AI search and assistants. Built from the page copy, so it
// always matches the site.
import type { APIRoute } from 'astro'
import en from '../content/en'
import ko from '../content/ko'
import { llmsTxt } from '../seo'

export const GET: APIRoute = () => new Response(llmsTxt(en, ko), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
