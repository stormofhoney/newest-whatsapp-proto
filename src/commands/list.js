// proto-fetcher list — recent Baileys tags + npm dist-tags.

import { getDistTags, listGitTags, PKG } from '../baileys.js';
import { compareTags, tagKey } from '../semver.js';
import { c } from '../output.js';

export async function run({ args, flags }) {
  const limit = Math.max(1, Math.min(100, Number(flags.n ?? flags.limit ?? 15) || 15));

  const [tags, distTags] = await Promise.all([
    listGitTags(100).catch(() => []),
    getDistTags().catch(() => ({})),
  ]);

  const sorted = tags.filter(tagKey).sort(compareTags).slice(0, limit);

  if (flags.json) {
    console.log(JSON.stringify({ pkg: PKG, distTags, tags: sorted }, null, 2));
    return;
  }

  console.log(c.bold(`npm dist-tags (${PKG})`));
  for (const [tag, version] of Object.entries(distTags)) {
    console.log(`  ${c.cyan(tag.padEnd(8))} ${version}`);
  }
  console.log('');
  console.log(c.bold(`recent GitHub tags (newest first, ${sorted.length})`));
  for (const t of sorted) {
    const mark = Object.entries(distTags).find(([, v]) => v === t.replace(/^v/, '') || v === t);
    console.log(`  ${t}${mark ? `  ${c.dim(`(${mark[0]})`)}` : ''}`);
  }
  console.log('');
  console.log(c.dim('tip: "master" / "newest" always carries the freshest proto (daily bot update).'));
}
