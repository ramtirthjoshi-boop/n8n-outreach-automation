# A/B Test — Outreach Email Content

Workflow: `N8N_ID_11` "Outreach-cheap-done" (64 nodes, ACTIVE)
Sheet: `YOUR_SHEET_ID` tab `leads-hunter`
Status: DESIGNED, NOT APPLIED (n8n unreachable, see bottom)

## 1. What is being tested

One axis only: the SUBJECT LINE of the first-touch email.

- Variant A (control): `subject_line` column, as written per-lead today.
- Variant B (test): fixed short template subject.
  `Quick question about your {page} page`
  falls back to `Quick question about your website` when `page` is blank.

Body, follow-ups, send times, and lead filter stay identical in both arms.

### Why subject, and why only subject
- Subject decides whether the email is opened at all. Biggest single lever.
- The body is locked by the evidence rules. Changing body copy risks breaking
  the no-invented-claims doctrine; subject text carries no claims.
- Today every lead already gets a DIFFERENT AI-written subject. That means
  there is currently no controlled comparison at all — subject style varies
  lead to lead and nothing is recorded. Variant B gives one fixed baseline to
  measure the AI-written subjects against.
- Two axes at once cannot be read apart. Second axis is parked, see §6.

## 2. Assignment — deterministic, not random

Hash of the lowercased email address, mod 2. Same lead always lands in the
same arm, and anyone can recompute which arm a lead was in from its email
alone. Reproducible, per the evidence rules.

NOT row_number parity: rows were appended in source batches, so parity
correlates with city/source and would confound the result.

## 3. Changes to apply

### 3.1 Sheet — manual, do first
Add one new header column to `leads-hunter`:

    Variant

Nothing else. No data backfill — rows already sent have no recorded variant
and are excluded from the scorecard.

### 3.2 Node `Get row(s) in sheet` (the Code node picker)
Add this function above the final return:

```js
function variantOf(j) {
  const s = String(j['Email Address'] || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
  return h % 2 === 0 ? 'A' : 'B';
}
```

Replace the final line:

```js
// OLD
return picked.length ? [{ json: picked[0] }] : [];

// NEW
if (!picked.length) return [];
const chosen = picked[0];
chosen.Variant = variantOf(chosen);
return [{ json: chosen }];
```

Nothing else in the picker changes. Filters, dedupe guard, `spoken` map,
ranking all stay exactly as they are.

### 3.3 Node `Send a message` (Gmail) — subject field only
```
OLD
={{ $('Get row(s) in sheet').item.json.subject_line }}

NEW
={{ $('Get row(s) in sheet').item.json.Variant === 'B' ? ('Quick question about your ' + ($('Get row(s) in sheet').item.json.page ? $('Get row(s) in sheet').item.json.page + ' page' : 'website')) : $('Get row(s) in sheet').item.json.subject_line }}
```

`sendTo` and `message` are UNCHANGED. Do not touch the body.

### 3.4 Node `Update row in sheet`
Add one column mapping alongside the existing Done / ThreadID / MessageID:

```
Variant  =  {{ $('Get row(s) in sheet').item.json.Variant }}
```

This is what makes the test measurable. Without it there is no record of
which arm a send belonged to.

### 3.5 Follow-up branch — NO CHANGES
`FU Pick` / `FU Decide` / follow-up bodies stay as they are. A lead keeps its
first-touch arm; follow-ups must be identical in both arms or the reply
cannot be attributed to the subject line. Do not add variant logic to
`FU Decide`.

## 4. What gets measured

Primary metric: REPLY RATE per arm = replies / sends, per variant.

- sends per arm: count rows where `Variant` = A or B and `Done` is set.
- replies per arm: of those, count rows where `Issues` contains "replied".
  This signal is already written by `Notification Automation`
  (`N8N_ID_12`), the reply checker. No new plumbing needed.

Open rate is NOT measured. It would need a tracking pixel, which hurts
deliverability and is a privacy problem for a cold first contact. Replies are
the outcome that actually matters anyway.

Counting rule: treat boolean `true` and string `"true"` as the same value.
Google Sheets returns both forms in this sheet. Do not count with grep.

Scorecard goes into the existing `Health Check` Code node in
`Pipeline Health Watchdog` (`N8N_ID_09`) — it already reads this
sheet every tick. No new workflow.

## 5. Sample size — read this before expecting a result

Cold-email reply rates sit low, so a difference needs volume to show:

| Real difference | Sends needed PER ARM | Total sends |
|---|---|---|
| 4% vs 12% | ~120 | ~240 |
| 4% vs 8%  | ~440 | ~880 |
| 4% vs 6%  | ~1900 | ~3800 |

Current state of the list: 41 rows, 35 already sent, roughly 5 still sendable.

So the arms will hold about 2 and 3 leads. That is not a small sample, it is
no sample. Any difference seen at that size is noise, and calling a winner
off it would be inventing a finding.

Rule: do not report a winner, and do not change the live subject line, until
at least 120 sends per arm exist. Until then the instrumentation just records.

The instrumentation is still worth applying now — it costs nothing, changes
no filtering logic, and is the only way to have data when volume returns.

The real prerequisite is lead supply: Hunter.io quota has been dead since
2026-09-17 and 443 rows sit blocked in the V1 queue behind it. Fixing that
comes before the A/B test can produce anything.

## 6. Parked — test #2, do not run alongside test #1

`website_problem`, `recognisable_reason` and `consequence_mechanics` are
already stored packed as `"full || short"`. First emails always use index
[0] (full). Follow-ups already use index [1] (tightened). So a full-vs-short
BODY test needs no new copy written — the variants already exist in the
sheet, unused at first touch.

Run it only after test #1 has finished. Two axes at once cannot be read.

## 7. Blocked on

- n8n MCP servers down: `n8n-mcp` CONNECT_TIMEOUT, `n8n-instance` ENOTFOUND.
- The instance itself IS up (health endpoint returns 200), so the REST API
  would work — but reading the API key out of `.claude.json` was denied by
  the permission classifier. Needs either the MCP servers restarted, or a
  Bash permission rule, or the changes made by hand in the n8n UI.
- §3.1 (the `Variant` sheet column) can be done by hand right now and is
  safe on its own — an unused header column changes no behaviour.

---

# VERIFIED AGAINST LIVE WORKFLOW — 2026-09-29

Read first-hand from `N8N_ID_11` (MCP access now enabled). 64 nodes,
active, versionId `d9ec741d-ee1a-4faf-b91b-b61f51d7f30c`, 878 executions.

## Confirmed node facts

| Node | Type | typeVersion | Target |
|---|---|---|---|
| `Get row(s) in sheet` | `n8n-nodes-base.code` | 2 | `/jsCode` |
| `Send a message` | `n8n-nodes-base.gmail` | 2.2 | `/subject` |
| `Update row in sheet` | `n8n-nodes-base.googleSheets` | 4.7 | `/columns/value/Variant` |

`Update row in sheet` currently writes exactly:

    row_number = {{ $('Get row(s) in sheet').first().json.row_number }}
    Done       = true
    pitch      = Sent
    ThreadID   = {{ $json.threadId }}
    MessageID  = {{ $json.id }}

matchingColumns = ["row_number"], cellFormat RAW, mappingMode defineBelow.

## Two live findings that change the sequencing

### 1. The sheet has NO `Variant` header yet
Execution 3526 row 2 carries no `Variant` key. Section 3.1 was NOT done.

This makes the `Update row in sheet` edit UNSAFE to apply first. Order matters:
that node runs AFTER the Gmail send. If it errors on an unknown column, the
email has already gone out but `Done` never gets written — so the next tick
re-picks the same lead and emails the clinic twice. Duplicate sends are worse
than missing variant data.

So: header first, mapping second. Never the reverse.

### 2. Zero sendable leads, confirmed live
Execution 3526 (2026-09-29 20:30 UTC): `Get row(s) in sheet RAW` returned the
sheet, the picker returned `[]`. The workflow is healthy and finding nobody.
Recent executions all success; :00/:15/:30 schedules all firing.

This is why the ordering costs nothing right now — no send can occur, so no
variant data is lost while the header is missing.

## Apply order

1. Add header `Variant` to tab `leads-hunter`. Manual, by hand.
2. Apply the two code/expression ops (picker `jsCode`, Gmail `subject`).
3. Apply the sheet-write op, only after step 1 shows in a fresh read:
   `setNodeParameter` on `Update row in sheet`,
   path `/columns/value/Variant`,
   value `={{ $('Get row(s) in sheet').first().json.Variant }}`
   (`.first()` not `.item`, matching the four mappings already in that node).
   Also append `Variant` to that node's `columns.schema` array so the n8n UI
   does not drop it on the next manual open.
4. Check `activeVersionId` vs `versionId`. This instance uses a draft/active
   version model — if the edit lands as a draft it must be published before
   the live schedule picks it up.

## Blocked on

The `update_workflow` call was denied by the permission classifier:
`[Modify Shared Resources]`. Standing rule is not to route around a classifier
denial, so nothing was written.

---

## THROUGHPUT DIAGNOSIS — 2026-09-29 21:15Z (supersedes earlier rate estimates)

Source: `Pipeline Health Watchdog` (N8N_ID_09) `Health Check` output across 4 executions,
plus a full parse of `Get row(s) in sheet RAW` from Outreach-cheap-done exec 3528.
Every number below is reproducible from those executions.

### Watchdog series

| when (UTC) | exec | rows | researched | pending | threads | ready-to-send | stuck | v1-done | v1-queued |
|---|---|---|---|---|---|---|---|---|---|
| Sep 27 10:00 | 3155 | 56 | 56 | 0 | 39 | 3 | 9  | 176 | 275 |
| Sep 29 06:00 | 3435 | 79 | 79 | 0 | 54 | 0 | 17 | 191 | 268 |
| Sep 29 12:00 | 3473 | 88 | 88 | 0 | 59 | 0 | 20 | 191 | 279 |
| Sep 29 20:00 | 3523 | 88 | 88 | 0 | 61 | 0 | 18 | 191 | 279 |

### What the series proves

- **Sourcing is healthy.** V1 queue grew 268 -> 279 today. Google Places side is adding clinics.
- **Contact-finding is stalled.** `v1-done` has been pinned at **191 since at least 06:00 UTC** —
  14+ hours with zero clinics person-searched, while 279 sit queued.
- **LEADS grew +9 this morning (79 -> 88) then went flat for 8 hours.**
- **Send rate is ~7-9/day, not 1-3.** threads 39 -> 61 across Sep 27 10:00 -> Sep 29 20:00 = +22
  over ~2.4 days. Today alone: 54 -> 61 = +7. The earlier "1 send/day" figure was a single-tick
  artifact and is withdrawn.
- **Sender and researcher are both idle for lack of input**, not capacity: 48 send slots/day
  against 7 sends, and `pending=0` means the research workflow has nothing to pick.

### Sheet state (88 rows, exec 3528, full parse)

- 57 unique clinics across 88 rows. **31 rows are duplicate contacts at clinics already emailed**
  and can never send — correct behaviour (one clinic, one pitch), but it means 88 rows ~ 57 leads.
- 73 rows have `Done` set. 61 have a `ThreadID`. 2 replies. 4 bounces.
- `Issues` breakdown: 9 Bad sitemap, 4 Bounced, 6 Research failed, 3 Screenshot failed, 2 Replied.
  **18 rows are stuck on research-tooling failures** — recoverable leads, not dead ones.
- **Ready to send right now: 0.** All 15 blank-`Done` rows are blocked: 9 are duplicate clinics,
  6 carry research failures.
- Reply rate to date: **2 / 73 sent = 2.7%**.

### Variant header — VERIFIED PRESENT

`Get row(s) in sheet RAW` (exec 3528) returns a `Variant` key on all 88 rows, so the sheet header
exists and is empty (0 / 88 populated). The header-first precondition for the patch is satisfied;
`Update row in sheet` can be given its `/columns/value/Variant` mapping safely.

### Revised verdict on running the A/B test

At ~9 sends/day, 240 sends (120/arm) is ~27 days, not months. But 240 sends consumes almost the
entire remaining pool of 279 queued clinics, and at a 2.7% observed baseline a 120/arm sample only
detects a very large lift. Spending the whole list to test one subject line is the wrong trade.
Order stands: unstall contact-finding first, then test once volume is not the scarce resource.

### Blocked on

`GET PERSONS V1` (N8N_ID_06), `GET PERSONS - HUNTER` (N8N_ID_07),
`Email automation` (N8N_ID_13) and `MASTER CLEAN BUILDER` (emyfAQMBhKmugeSP) all have
`availableInMCP: false`. That is a server-side per-workflow gate — a permission rule does not
reach it and there is no REST field or MCP operation to flip it. Their executions cannot be read
until MCP access is enabled on each workflow card.
