// /sitemap.xml: both languages of every indexable page, with hreflang alternates (src/seo.ts). 404 is left out.
import type { APIRoute } from 'astro'
import { sitemapXml } from '../seo'

export const GET: APIRoute = () => new Response(sitemapXml(), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
