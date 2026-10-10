// Redacts credential-shaped *values* from exported workflow JSON.
//
// export-n8n.js strips the `credentials` block, but n8n users routinely paste a
// raw API key straight into an HTTP Request node's URL or header, where it lives
// as an ordinary parameter value. Field-name scrubbing cannot see those.
//
// Values are replaced, never deleted, so the workflow still shows that the field
// was set. Nothing is printed except counts — the point is to not surface secrets.

const fs = require('fs');
const path = require('path');

const PATTERNS = [
  ['google-api-key', /AIza[0-9A-Za-z_-]{30,}/g],
  ['jwt', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['openai-style', /sk-[A-Za-z0-9_-]{16,}/g],
  ['slack-token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['github-pat', /gh[pousr]_[A-Za-z0-9]{30,}/g],
  ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['bearer-inline', /Bearer\s+[A-Za-z0-9_\-.]{20,}/g],
];

const dir = process.argv[2] || path.join(__dirname, 'workflows');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

const totals = {};
let filesChanged = 0;

for (const file of files) {
  const full = path.join(dir, file);
  const before = fs.readFileSync(full, 'utf8');
  let after = before;
  const hits = {};

  for (const [label, re] of PATTERNS) {
    const found = after.match(re);
    if (found) {
      hits[label] = found.length;
      totals[label] = (totals[label] || 0) + found.length;
      after = after.replace(re, label === 'bearer-inline' ? 'Bearer <SCRUBBED>' : '<SCRUBBED>');
    }
  }

  if (after !== before) {
    fs.writeFileSync(full, after);
    filesChanged++;
    const detail = Object.entries(hits).map(([k, v]) => `${k} x${v}`).join(', ');
    console.log(`  ${file}: ${detail}`);
  }
}

console.log(`\n${filesChanged} file(s) scrubbed in ${dir}`);
if (Object.keys(totals).length === 0) {
  console.log('no credential-shaped values found');
} else {
  for (const [k, v] of Object.entries(totals)) console.log(`  ${k}: ${v}`);
}

// Fail loudly if the JSON no longer parses, rather than committing a broken export.
for (const file of files) {
  try {
    JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (err) {
    console.error(`\nBROKEN JSON after scrub: ${file} — ${err.message}`);
    process.exit(1);
  }
}
console.log('all files still parse as valid JSON');
