import type { APIRoute } from 'astro';
import { getAllPosts } from '../lib/blog';

export const prerender = true;

export const GET: APIRoute = async () => {
  const posts = getAllPosts();
  const siteUrl = 'https://sudonotes.com';

  const staticUrls = [
    `${siteUrl}/`,
    `${siteUrl}/docs`,
    `${siteUrl}/download`,
    `${siteUrl}/features`,
    `${siteUrl}/open-source`,
    `${siteUrl}/changelog`,
    `${siteUrl}/roadmap`,
    `${siteUrl}/blog`,
  ];

  const postUrls = posts.map((p) => `${siteUrl}/blog/${p.slug}`);
  const allUrls = [...staticUrls, ...postUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (url) => `  <url>
    <loc>${url}</loc>
    <changefreq>weekly</changefreq>
    <priority>${url === siteUrl + '/' ? '1.0' : url.includes('/blog') ? '0.8' : '0.7'}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml.trim(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
