# Blog Architecture Contract

All blog implementations must adhere to these specifications:

## Frontmatter Schema
- `title`: string (required)
- `description`: string (required, 140-160 chars)
- `date`: string (required, YYYY-MM-DD)
- `author`: string (required, real person or editorial masthead)
- `updated`: string (optional, YYYY-MM-DD)
- `tags`: string[] (optional)
- `draft`: boolean (optional, default false)
- `canonical`: string (optional, URL)

## Required Routes & Endpoints
- `/blog/` - Paginated or complete list of posts
- `/blog/<slug>/` - Full post page
- `/rss.xml` - RSS 2.0 feed
- `/sitemap.xml` - XML Sitemap
- `/llms.txt` - LLM context file
- `robots.txt` - Explicitly allowing 20 AI crawlers

## Seed Article Rules
- Word count: 600-900 words
- First screen: 40-60 word definitional paragraph
- Network links: 0 (max 2)
- External citations: >= 4 genuine resolving links
- Anchor text: specific and natural (no 'best ... tool', 'top 10', 'cheap ...')
- No links in intro paragraph or conclusion paragraph
