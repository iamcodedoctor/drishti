# DRISHTI 3-Day Lead Generation Plan (No Paid APIs)

This plan focuses on speed: make DRISHTI GUI-first, prioritize high-value leads, and produce outreach-ready artifacts without paid APIs.

## Objectives

- Turn DRISHTI into a primary GUI workflow.
- Improve lead quality by ranking opportunities.
- Reduce manual work with contact discovery and pitch-ready outputs.
- Keep all components free/open-source and local-first.

## Current Gaps

- No lead scoring to prioritize who to pitch first.
- No built-in contact discovery flow.
- No outreach-ready artifact generation from findings.
- Limited SERP diversity and intent-focused keyword packs.
- Throughput can improve with caching, retries, and smarter scheduling.
- No historical tracking for follow-up and before/after evidence.

## 3-Day Execution Plan

### Day 1 - GUI-first foundation and lead scoring

1. Make project GUI-primary:
   - Keep `npm run gui` as the default workflow.
   - Remove script-based pipeline usage from docs and package scripts.
   - Add GUI controls for scraping settings (global max pages and per-engine overrides).
2. Add lead scoring engine (local, no APIs):
   - Intent score (service/commercial/local intent keywords).
   - Pain score (SEO/performance/link issues from inspector output).
   - Pitchability score (clear business site + fixable issues).
3. Create ranked output:
   - `data/<project>/lead_scores.json`
   - `data/<project>/top_leads.csv`

Deliverable: prioritized leads list visible in files and ready for outreach triage.

### Day 2 - Contact discovery and enrichment

1. Add free contact discovery module:
   - Crawl homepage, `/contact`, `/about`.
   - Extract emails (`mailto:` and visible patterns).
   - Extract social profile URLs (LinkedIn/Facebook/Instagram/X).
2. Add confidence labels:
   - `high`: direct email + clear owner/company context.
   - `medium`: role/team email or social profile only.
   - `low`: weak or inferred contact evidence.
3. Save enrichment outputs:
   - `data/<project>/contacts.json`
   - merge contact fields into lead score output.

Deliverable: top leads include contact paths for outreach.

### Day 3 - Outreach artifacts and efficiency upgrades

1. Auto-generate outreach assets per top lead:
   - `lead_brief.md`
   - `pitch_email.txt`
   - `audit_snapshot.json`
2. Add efficiency guardrails:
   - Domain cache with re-check window (for example 7-14 days).
   - Retry-once with backoff for transient failures.
   - Skip duplicate domains seen recently.
   - Process higher scored leads first.
3. Follow-up support:
   - Store last-audit timestamp and latest score delta.
   - Mark quick-win issues for first-message personalization.

Deliverable: "find -> score -> contact -> pitch" runs with minimal manual effort.

## Free Stack Only

- Playwright for browsing and extraction.
- Existing DRISHTI parser/inspector modules.
- Local JSON/CSV/Markdown outputs.
- Optional free search expansion via additional local keyword packs.

No paid enrichment, SEO, or data APIs required.

## Suggested Output Contract

Each lead record should include:

- `domain`
- `source_keywords`
- `score_total`
- `score_intent`
- `score_pain`
- `score_pitchability`
- `top_issues`
- `contact_emails`
- `contact_socials`
- `contact_confidence`
- `last_audited_at`

## Prioritization Rule

Default queue: sort by `score_total` descending, then by contact confidence (`high -> medium -> low`).

This keeps daily outreach focused on the highest expected close probability.

