# n8n — outreach and reply handling

> Public copy. Sheet IDs, workflow IDs, hosts and email addresses are replaced with placeholders; credentials are stripped.

Version-controlled export of the four n8n workflows that handle **outreach**: taking a
clean lead list and turning it into sent email, follow-ups, reply detection and a voice
handoff.

Sourcing and enrichment — finding the clinics and working out who to contact — live in a
separate repo. The two halves meet at one Google Sheet and nowhere else; see
[The boundary](#the-boundary) below.

## What's here

| File | Workflow | Nodes | Role |
|---|---|---|---|
| `01-email-automation.json` | Email automation | 52 | researches one clinic, composes the pitch, sends it, writes the thread id back |
| `02-outreach-followup.json` | Outreach-cheap-done | 62 | timed follow-up sequence after the first send |
| `03-notification-automation.json` | Notification Automation | 10 | watches the inbox and flags real replies |
| `04-vapi-voice-handoff.json` | Vapi Workflow | 7 | hands a warm reply to the voice agent |

`repo-manifest.json` is the list of workflows this repo owns. `export-n8n.js` reads it and
writes only those, so running an export here cannot pull the lead-generation workflows back
in. Anything on the instance that this repo does not own is named in the export output
rather than silently skipped.

The JSON is pretty-printed rather than stored as the single line n8n exports, so changes
between versions show up as readable line diffs.

## The boundary

The two pipelines are **not** wired to each other. There is no Execute Workflow node, no
internal webhook call, no shared trigger. The only thing they share is a Google Sheet:

```
  lead generation  ──writes──▶  [ clean lead sheet ]  ──reads──▶  outreach  (this repo)
```

The lead-generation side appends a row once a clinic has a verified contact. This side
reads that sheet, picks one unsent row, and never writes back into the sourcing sheets.

That is why they split cleanly: each half can be rebuilt, paused or replaced without
touching the other, as long as the sheet keeps its column names.

## How the main workflow runs

Three entry points:

| Trigger | Schedule | Purpose |
|---|---|---|
| `Schedule Trigger` | every 30 min | main send loop |
| `Sweep Schedule` | every 6h at :45 | retry rows that failed research |
| `When clicking 'Execute workflow'` | manual | testing |

**Main loop.** Reads the lead sheet, picks one unsent row, researches the clinic's website,
captures a screenshot, composes a pitch, sends it, then writes the thread id back to the
sheet. The `Wait` nodes stagger follow-ups after the first send.

Only **one clinic per execution** is processed on purpose. Downstream `$('Node').first()`
references resolve to the last run of that node, so a second lead in the same execution
would overwrite the first one's data.

The picker also enforces rules the sheet columns alone don't express:

- one pitch per clinic, even when a clinic has several addresses on file
- skip role inboxes (`jobs@`, `careers@`, `hr@`, `noreply@`, …)
- skip rows whose detected website problem is an artifact rather than a real defect
- skip clinics already emailed, replied, or bounced

**Sweep.** `Sweep Pick` retries rows that failed research, at most 4 per sweep and 3 tries
per row. Once a row exhausts its tries it is stamped `Permanent: <reason>` so it stops being
retried and stops triggering health alerts. Retry counts live in
`$getWorkflowStaticData('global')`.

**HTTP fallbacks.** The `PRIMARY` / `FALLBACK` / `CAPTURE` node pairs deliberately run with
`onError: continueRegularOutput`. A failure there is not a bug — it is how the flow falls
through to the next source.

## Credentials

Exports carry no credential values and no credential ids — `export-n8n.js` strips the
`credentials` key from every node before writing. After importing into a fresh n8n
instance, rebind each node by hand in the UI. The types used here are Google Sheets OAuth2,
Gmail OAuth2, and JWT auth.

## Editing these workflows — two rules that will bite you

**1. After any API update to an active workflow, restart it** — deactivate, then activate.

A live trigger holds its own in-memory copy of `staticData`. Keys a Code node writes after
an update land in the database but are invisible to the next run, so counters silently reset
forever while pre-existing keys keep working. This is what froze the sweep retry counter at
"try 2" across four consecutive sweeps.

A workflow update through the API also accepts only `name`, `nodes`, `connections` and
`settings`, and `settings` must not contain `binaryMode` or `availableInMCP`.

**2. The Code node sandbox is not plain Node.**

No `URL` class. Avoid `replace()` with a callback and dynamic `$(variableName)` node
references — both have hung a node until the hard 300-second timeout. Use plain loops and
literal `$('Node Name')` references.

## Known limitations

- `Sitemap Proxy` uses a free public CORS proxy, which intermittently returns 522. Some
  clinic sites bot-wall every free proxy; those rows are meant to end at
  `Permanent: Bad sitemap` rather than be worked around.
- Google Sheets nodes write with `cellFormat: RAW`. Any field whose value begins with `=`
  is stored as literal text, not evaluated — check for that after switching a node to RAW.
- The follow-up `Wait` nodes are currently set to short test intervals, not the intended
  multi-day gaps.

## Re-exporting

```powershell
$env:N8N_API_KEY = Read-Host "Paste n8n API key"
node export-n8n.js
node scrub-values.js workflows
```

`export-n8n.js` strips credentials and webhook ids by matching field *names*.
`scrub-values.js` is the second pass: it matches credential-shaped *values*, which is what
catches a key pasted into some other field, such as a URL or a custom header. Run both, and
read the diff before committing.
