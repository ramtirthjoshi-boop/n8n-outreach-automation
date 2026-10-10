// Exports every workflow from the n8n instance to workflows/*.json, sanitized.
//
// The API key is read from the environment, never stored in this file:
//   PowerShell:  $env:N8N_API_KEY='<key>'; node export-n8n.js
//
// Sanitizing means: `credentials` and `webhookId` are stripped from every node.
// n8n's public API returns only credential ids and names, not secret values, but
// those ids are account-specific noise that does not belong in version control.

const fs = require('fs');
const path = require('path');

// A pasted key often arrives with a trailing newline, or still wrapped in the
// quotes or angle brackets from the instructions. All of those break the header.
function clean(raw) {
  return (raw || '').trim().replace(/^['"<]+|['">]+$/g, '').trim();
}

const KEY = clean(process.env.N8N_API_KEY);
const BASE = clean(process.env.N8N_BASE_URL)
  || 'https://n8n.example.com';

if (!KEY) {
  console.error("N8N_API_KEY is not set. In PowerShell:\n  $env:N8N_API_KEY='<your key>'; node export-n8n.js");
  process.exit(1);
}

// Enough to spot a truncated or mangled paste, not enough to reconstruct the key.
const parts = KEY.split('.').length;
console.log(`key: ${KEY.length} chars, ${parts} dot-separated part(s), starts "${KEY.slice(0, 6)}", ends "${KEY.slice(-4)}"`);
if (parts !== 3) console.log('  ! an n8n API key is a JWT and should have exactly 3 parts — this looks truncated or merged');
if (KEY.length < 200) console.log('  ! shorter than a typical n8n key (~300 chars) — the paste may have been cut off');
console.log(`base: ${BASE}`);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function strip(node) {
  const { credentials, webhookId, ...rest } = node;
  return rest;
}

(async () => {
  const url = `${BASE}/api/v1/workflows?limit=250`;
  let res;
  try {
    res = await fetch(url, { headers: { 'X-N8N-API-KEY': KEY } });
  } catch (err) {
    console.error(`\nCould not reach ${BASE} — ${err.message}`);
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`\nGET /api/v1/workflows failed: HTTP ${res.status} ${res.statusText}`);
    if (body) console.error(`server said: ${body.slice(0, 400)}`);
    if (res.status === 401) {
      console.error('\n401 means the key reached n8n and was rejected. Either it has been');
      console.error('revoked, or the paste was truncated. Check the key length printed above,');
      console.error('then issue a fresh key in n8n: Settings -> n8n API -> Create an API key.');
    }
    process.exit(1);
  }  const { data } = await res.json();

  // This repo covers one half of the pipeline. repo-manifest.json says which
  // workflows that is, and what each one is called here. Anything the instance
  // holds that is not on the list belongs to the other repo and is left alone —
  // that is what keeps the two from merging back together on the next export.
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'repo-manifest.json'), 'utf8'));
  const owns = manifest.owns;

  const outDir = path.join(__dirname, 'workflows');
  fs.mkdirSync(outDir, { recursive: true });

  const index = [];
  const skipped = [];

  for (const wf of data) {
    const file = owns[wf.name];
    if (!file) {
      skipped.push(wf.name);
      continue;
    }

    const cleanWf = {
      id: wf.id,
      name: wf.name,
      active: wf.active,
      settings: wf.settings,
      nodes: (wf.nodes || []).map(strip),
      connections: wf.connections,
    };

    const dest = path.join(outDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(cleanWf, null, 2) + '\n');
    index.push({ file, name: wf.name, id: wf.id, active: wf.active, nodes: cleanWf.nodes.length });
  }

  // A record of what was actually written, so the repo says what it holds
  // without opening every file.
  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    JSON.stringify({ repo: manifest.repo, exportedAt: new Date().toISOString(), workflows: index }, null, 2) + '\n'
  );

  console.log(`\nExported ${index.length} workflow(s) to workflows/  [${manifest.repo}]`);
  for (const w of index) {
    console.log(`  ${w.active ? 'active' : 'paused'}  ${w.nodes.toString().padStart(3)} nodes  ${w.name}  ->  ${w.file}`);
  }

  // A workflow on the instance that no manifest claims would otherwise vanish
  // from both backups silently, so name the ones this repo passed over.
  const missing = Object.keys(owns).filter((n) => !index.some((w) => w.name === n));
  if (missing.length) {
    console.log('\n  ! on the manifest but not found on the instance (renamed or deleted?):');
    for (const n of missing) console.log(`      ${n}`);
  }
  if (skipped.length) {
    console.log(`\n  ${skipped.length} workflow(s) left to the other repo:`);
    for (const n of skipped) console.log(`      ${n}`);
  }
})();
