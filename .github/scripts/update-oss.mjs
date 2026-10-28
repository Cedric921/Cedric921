/**
 * Rewrites the "Open source" block of README.md (between the OSS:START / OSS:END
 * markers) from live GitHub data: merged and open PRs per project, stars, and any
 * new public project contributed to since the last run.
 *
 * Projects listed in .github/oss-projects.json keep their name, description and
 * write-up; other repos are discovered from the PR search and added automatically
 * (as a table row from `minStars` stars, in the "Also contributed to" line below that).
 *
 *   GITHUB_TOKEN=... node .github/scripts/update-oss.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG_PATH = '.github/oss-projects.json';
const README_PATH = 'README.md';
const START = '<!-- OSS:START -->';
const END = '<!-- OSS:END -->';

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const USER = config.user;
const token = process.env.GITHUB_TOKEN;
const lc = (s) => s.toLowerCase();
const excluded = new Set((config.exclude ?? []).map(lc));

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `${USER}-profile-readme`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

/** PR count per repo ("owner/name" → n) for a search query, outside the user's own repos. */
async function countByRepo(state) {
  const q = encodeURIComponent(`is:pr author:${USER} -user:${USER} is:public ${state}`);
  const counts = new Map();
  // The search API returns at most 1000 results (10 pages of 100).
  for (let page = 1; page <= 10; page++) {
    const r = await gh(`/search/issues?q=${q}&per_page=100&page=${page}`);
    for (const item of r.items) {
      const repo = item.repository_url.replace('https://api.github.com/repos/', '');
      counts.set(repo, (counts.get(repo) ?? 0) + 1);
    }
    if (r.items.length < 100 || page * 100 >= r.total_count) break;
  }
  return counts;
}

const fmtStars = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n);
const prsLink = (repo) => `https://github.com/${repo}/pulls?q=is%3Apr+author%3A${USER}`;
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function prsCell(merged, open) {
  const parts = [];
  if (merged) parts.push(`**${merged}** merged`);
  if (open) parts.push(`${open} open`);
  return parts.join(' · ') || '—';
}

async function main() {
  const [merged, open] = await Promise.all([countByRepo('is:merged'), countByRepo('is:open')]);
  const contributed = [...new Set([...merged.keys(), ...open.keys()])].filter((r) => !excluded.has(lc(r)));

  const configured = new Set(config.projects.flatMap((p) => p.repos.map(lc)));
  const allRepos = [...new Set([...config.projects.flatMap((p) => p.repos), ...contributed])];
  const meta = new Map(
    await Promise.all(allRepos.map(async (repo) => [lc(repo), await gh(`/repos/${repo}`)])),
  );
  const count = (map, repo) => [...map].find(([r]) => lc(r) === lc(repo))?.[1] ?? 0;

  // Rows from the config, then discovered repos above the stars threshold.
  const rows = config.projects.map((p) => ({
    ...p,
    repos: p.repos.filter((r) => meta.get(lc(r))),
  }));
  const extra = [];
  for (const repo of contributed) {
    if (configured.has(lc(repo))) continue;
    const m = meta.get(lc(repo));
    if (!m || m.private || m.fork) continue;
    if (m.stargazers_count >= (config.minStars ?? 0)) {
      rows.push({ name: m.name, repos: [m.full_name], description: m.description ?? '' });
    } else if (count(merged, repo) > 0) {
      extra.push(m);
    }
  }

  const table = rows
    .map((p) => {
      const m = p.repos.reduce((n, r) => n + count(merged, r), 0);
      const o = p.repos.reduce((n, r) => n + count(open, r), 0);
      const stars = Math.max(0, ...p.repos.map((r) => meta.get(lc(r)).stargazers_count));
      return { ...p, merged: m, open: o, stars };
    })
    .filter((p) => p.repos.length && (p.merged || p.open));

  const lines = table.map((p) => {
    const name =
      p.repos.length === 1
        ? `[${cell(p.name)}](${prsLink(p.repos[0])})`
        : p.repos.map((r) => `[${cell(meta.get(lc(r)).name)}](${prsLink(r)})`).join(' · ');
    const label = p.repos.length === 1 ? name : `**${cell(p.name)}**<br>${name}`;
    const writeup = p.writeup ? `[Read](${p.writeup})` : '—';
    return `| ${label} | ★ ${fmtStars(p.stars)} | ${cell(p.description)} | ${prsCell(p.merged, p.open)} | ${writeup} |`;
  });

  const totalMerged = contributed.reduce((n, r) => n + count(merged, r), 0);
  const totalOpen = contributed.reduce((n, r) => n + count(open, r), 0);
  const projects = table.length + extra.length;
  const today = new Date().toISOString().slice(0, 10);

  const block = [
    START,
    `<sub><b>${totalMerged}</b> merged pull requests${totalOpen ? ` (+${totalOpen} open)` : ''} across <b>${projects}</b> open-source projects — most have a short write-up on my blog · <a href="https://cedric-karungu.vercel.app/en#open-source">live PR tree</a> · updated ${today}</sub>`,
    '',
    '| Project | Stars | What it is | My PRs | Write-up |',
    '|---|---|---|---|---|',
    ...lines,
    ...(extra.length
      ? [
          '',
          `<sub>Also contributed to: ${extra
            .sort((a, b) => b.stargazers_count - a.stargazers_count)
            .map((m) => `<a href="${prsLink(m.full_name)}">${m.full_name}</a>`)
            .join(' · ')}</sub>`,
        ]
      : []),
    END,
  ].join('\n');

  const readme = readFileSync(README_PATH, 'utf8');
  const from = readme.indexOf(START);
  const to = readme.indexOf(END);
  if (from < 0 || to < from) throw new Error(`README.md is missing the ${START} / ${END} markers`);
  const next = readme.slice(0, from) + block + readme.slice(to + END.length);
  // Only the date changed: keep the file as is so the workflow makes no empty commit.
  const strip = (s) => s.replace(/ · updated \d{4}-\d{2}-\d{2}/, '');
  if (strip(next) === strip(readme)) {
    console.log('No change in open-source numbers.');
    return;
  }
  writeFileSync(README_PATH, next);
  console.log(`README updated: ${totalMerged} merged, ${totalOpen} open, ${projects} projects.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
