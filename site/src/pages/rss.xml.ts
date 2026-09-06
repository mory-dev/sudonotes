import type { APIRoute } from 'astro';
import { getAllPosts } from '../lib/blog';

export const prerender = true;

export const GET: APIRoute = async () => {
  const posts = getAllPosts();
  const siteUrl = 'https://sudonotes.com';

  const rssItems = posts
    .map(
      (post) => `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${siteUrl}/blog/${post.slug}</link>
      <guid isPermaLink="true">${siteUrl}/blog/${post.slug}</guid>
      <description><![CDATA[${post.description}]]></description>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <author>team@sudonotes.com (${post.author})</author>
    </item>`
    )
    .join('');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>sudonotes Blog</title>
    <link>${siteUrl}/blog</link>
    <description>Engineering articles, local-first architecture notes, and guides on AI prompt management.</description>
    <language>en</language>
    <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml" />
    ${rssItems}
  </channel>
</rss>`;

  return new Response(rssXml.trim(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
