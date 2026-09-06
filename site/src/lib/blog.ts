import fs from 'node:fs';
import path from 'node:path';

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  author: string;
  tags: string[];
  draft: boolean;
  canonical?: string;
  content: string;
  contentHtml: string;
  excerpt: string;
}

function parseFrontmatter(rawContent: string) {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {} as Record<string, any>, body: rawContent };
  const yaml = match[1];
  const body = match[2];
  const frontmatter: Record<string, any> = {};

  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let val = trimmed.slice(colon + 1).trim();

    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) as any;
    } else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else if (val === 'true') {
      val = true as any;
    } else if (val === 'false') {
      val = false as any;
    }
    frontmatter[key] = val;
  }
  return { frontmatter, body };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let inOrderedList = false;
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let inTable = false;
  let tableHeader = true;

  function inlineFormat(text: string): string {
    let res = escapeHtml(text);
    res = res.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    res = res.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    res = res.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    res = res.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="external-link">$1</a>');
    return res;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        out.push(`<pre class="code-block"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        if (inOrderedList) { out.push('</ol>'); inOrderedList = false; }
        if (inTable) { out.push('</tbody></table></div>'); inTable = false; }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (trimmed.startsWith('|')) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inOrderedList) { out.push('</ol>'); inOrderedList = false; }
      if (!inTable) {
        inTable = true;
        tableHeader = true;
        out.push('<div class="table-wrapper"><table class="prose-table">');
      }
      if (trimmed.includes('---')) {
        tableHeader = false;
        continue;
      }
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      if (tableHeader) {
        out.push('<thead><tr>' + cells.map(c => `<th>${inlineFormat(c)}</th>`).join('') + '</tr></thead><tbody>');
      } else {
        out.push('<tr>' + cells.map(c => `<td>${inlineFormat(c)}</td>`).join('') + '</tr>');
      }
      continue;
    } else if (inTable) {
      out.push('</tbody></table></div>');
      inTable = false;
    }

    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (!inOrderedList) {
        inOrderedList = true;
        out.push('<ol class="prose-ol">');
      }
      out.push(`<li>${inlineFormat(olMatch[2])}</li>`);
      continue;
    } else if (inOrderedList) {
      out.push('</ol>');
      inOrderedList = false;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        inList = true;
        out.push('<ul class="prose-ul">');
      }
      out.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`);
      continue;
    } else if (inList) {
      out.push('</ul>');
      inList = false;
    }

    if (trimmed.startsWith('### ')) {
      out.push(`<h3>${inlineFormat(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      out.push(`<h2>${inlineFormat(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      out.push(`<h1>${inlineFormat(trimmed.slice(2))}</h1>`);
      continue;
    }

    if (!trimmed) continue;

    out.push(`<p>${inlineFormat(trimmed)}</p>`);
  }

  if (inList) out.push('</ul>');
  if (inOrderedList) out.push('</ol>');
  if (inTable) out.push('</tbody></table></div>');
  if (inCodeBlock) out.push(`<pre class="code-block"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);

  return out.join('\n');
}

export function getAllPosts(): BlogPost[] {
  const posts: BlogPost[] = [];
  const postEntries: Array<{ slug: string; raw: string }> = [];

  try {
    const rawImports = import.meta.glob('../content/blog/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    for (const [key, raw] of Object.entries(rawImports)) {
      const slug = key.split('/').pop()?.replace(/\.md$/, '') || '';
      if (slug && typeof raw === 'string') {
        postEntries.push({ slug, raw });
      }
    }
  } catch {
    // fallback to fs
  }

  if (postEntries.length === 0) {
    const candidates = [
      path.join(process.cwd(), 'src', 'content', 'blog'),
      path.join(process.cwd(), 'site', 'src', 'content', 'blog'),
      path.join(process.cwd(), 'content', 'blog'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const slug = file.replace(/\.md$/, '');
          const raw = fs.readFileSync(path.join(dir, file), 'utf8');
          postEntries.push({ slug, raw });
        }
        break;
      }
    }
  }

  for (const { slug, raw } of postEntries) {
    const { frontmatter, body } = parseFrontmatter(raw);
    if (frontmatter.draft) continue;

    const contentHtml = markdownToHtml(body);
    const lines = body.replace(/```[\s\S]*?```/g, '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('|'));
    const excerpt = lines[0] || frontmatter.description || '';

    posts.push({
      slug,
      title: frontmatter.title || slug,
      description: frontmatter.description || '',
      date: String(frontmatter.date || ''),
      updated: frontmatter.updated ? String(frontmatter.updated) : undefined,
      author: frontmatter.author || 'sudonotes Editorial',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      draft: Boolean(frontmatter.draft),
      canonical: frontmatter.canonical,
      content: body,
      contentHtml,
      excerpt,
    });
  }

  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPostBySlug(slug: string): BlogPost | null {
  const posts = getAllPosts();
  return posts.find(p => p.slug === slug) || null;
}
