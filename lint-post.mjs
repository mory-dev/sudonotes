#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const NETWORK_DOMAINS = [
  'hacktribune.com',
  'hexdigest.com',
  'openonholiday.com',
  '0xegg.com',
  'openthebook.lol',
  'sudonotes.com',
  'tryseep.com',
  'formharvester.com',
  'codeamsterdam.nl',
  'freelancesoftware.nl',
  'mory.dev'
];

const DENYLIST_PATTERNS = [
  /\bbest\s+[\w\s-]*\btool\b/i,
  /\btop\s+10\b/i,
  /\bcheap\s+[\w\s-]+\b/i,
  /\bclick\s+here\b/i,
  /\bbuy\s+now\b/i,
];

function parseFrontmatter(rawContent) {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: rawContent, error: 'Missing or malformed frontmatter delimiters (---)' };
  }
  const yamlBlock = match[1];
  const body = match[2];
  const frontmatter = {};

  const lines = yamlBlock.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();

    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      val = inner ? inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')) : [];
    } else if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    }
    frontmatter[key] = val;
  }

  return { frontmatter, body };
}

function extractLinks(markdown) {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
  const links = [];
  let match;
  while ((match = linkRegex.exec(markdown)) !== null) {
    links.push({
      anchor: match[1].trim(),
      url: match[2].trim(),
      index: match.index
    });
  }
  return links;
}

function extractParagraphs(body) {
  const noCode = body.replace(/```[\s\S]*?```/g, '');
  const lines = noCode.split(/\r?\n/);
  const paragraphs = [];
  let currentPara = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentPara.length > 0) {
        paragraphs.push(currentPara.join(' '));
        currentPara = [];
      }
      continue;
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.startsWith('***') || trimmed.startsWith('|')) {
      if (currentPara.length > 0) {
        paragraphs.push(currentPara.join(' '));
        currentPara = [];
      }
      continue;
    }
    currentPara.push(trimmed);
  }
  if (currentPara.length > 0) {
    paragraphs.push(currentPara.join(' '));
  }
  return paragraphs;
}

export function lintMarkdown(filePath) {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [`File not found: ${filePath}`], warnings: [] };
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body, error: fmError } = parseFrontmatter(raw);

  if (fmError || !frontmatter) {
    return { valid: false, errors: [fmError || 'Invalid frontmatter'], warnings: [] };
  }

  if (!frontmatter.title || typeof frontmatter.title !== 'string' || !frontmatter.title.trim()) {
    errors.push('Frontmatter missing required field: "title"');
  }

  if (!frontmatter.description || typeof frontmatter.description !== 'string') {
    errors.push('Frontmatter missing required field: "description"');
  } else {
    const descLen = frontmatter.description.trim().length;
    if (descLen < 140 || descLen > 160) {
      errors.push(`Description length must be between 140 and 160 characters (currently ${descLen} chars: "${frontmatter.description.trim()}")`);
    }
  }

  if (!frontmatter.date) {
    errors.push('Frontmatter missing required field: "date" (YYYY-MM-DD)');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(frontmatter.date).trim())) {
    errors.push(`Date format must be YYYY-MM-DD (got: "${frontmatter.date}")`);
  }

  if (!frontmatter.author || typeof frontmatter.author !== 'string' || !frontmatter.author.trim()) {
    errors.push('Frontmatter missing required field: "author" (real name or editorial masthead)');
  }

  if (frontmatter.updated && !/^\d{4}-\d{2}-\d{2}$/.test(String(frontmatter.updated).trim())) {
    errors.push(`Updated date format must be YYYY-MM-DD (got: "${frontmatter.updated}")`);
  }

  const links = extractLinks(body);
  let networkLinksCount = 0;
  let externalCitationsCount = 0;

  for (const l of links) {
    let hostname = '';
    try {
      hostname = new URL(l.url).hostname.replace(/^www\./, '');
    } catch {
      errors.push(`Invalid URL in link: ${l.url}`);
      continue;
    }

    const isNetwork = NETWORK_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
    if (isNetwork) {
      networkLinksCount++;
    } else {
      externalCitationsCount++;
    }

    for (const pattern of DENYLIST_PATTERNS) {
      if (pattern.test(l.anchor)) {
        errors.push(`Anchor text "${l.anchor}" violates denylist rule (${pattern})`);
      }
    }
  }

  if (networkLinksCount > 2) {
    errors.push(`Network link count is ${networkLinksCount} (maximum allowed is 2)`);
  }

  if (externalCitationsCount < 4) {
    errors.push(`External citation count is ${externalCitationsCount} (minimum required is 4 genuine external links)`);
  }

  const paragraphs = extractParagraphs(body);
  if (paragraphs.length === 0) {
    errors.push('Article body has no content paragraphs');
  } else {
    const firstPara = paragraphs[0];
    const lastPara = paragraphs[paragraphs.length - 1];

    if (extractLinks(firstPara).length > 0 || /https?:\/\//.test(firstPara)) {
      errors.push('First paragraph (introduction) must not contain any links');
    }

    if (extractLinks(lastPara).length > 0 || /https?:\/\//.test(lastPara)) {
      errors.push('Last paragraph (conclusion) must not contain any links (no CTA link)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      networkLinks: networkLinksCount,
      externalCitations: externalCitationsCount,
      paragraphCount: paragraphs.length,
      descLength: frontmatter.description ? frontmatter.description.trim().length : 0
    }
  };
}

if (process.argv[1] && (path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')) || process.argv[1].endsWith('lint-post.mjs'))) {
  const targetFile = process.argv[2];
  if (!targetFile) {
    console.error('Usage: node lint-post.mjs <path-to-post.md>');
    process.exit(1);
  }

  const result = lintMarkdown(path.resolve(targetFile));
  console.log(`\nLinting: ${targetFile}`);
  console.log(`Status: ${result.valid ? 'PASSED' : 'FAILED'}`);
  if (result.stats) {
    console.log(`- Description length: ${result.stats.descLength} chars`);
    console.log(`- Network links: ${result.stats.networkLinks} (max 2)`);
    console.log(`- External citations: ${result.stats.externalCitations} (min 4)`);
    console.log(`- Body paragraphs: ${result.stats.paragraphCount}`);
  }

  if (result.errors.length > 0) {
    console.error('\nErrors:');
    result.errors.forEach(e => console.error(`  ✖ ${e}`));
  }
  if (result.warnings.length > 0) {
    console.warn('\nWarnings:');
    result.warnings.forEach(w => console.warn(`  ⚠ ${w}`));
  }

  process.exit(result.valid ? 0 : 1);
}
