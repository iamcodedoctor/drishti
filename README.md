# DRISHTI (GUI-first)

DRISHTI is a local GUI application for SERP-driven lead generation and technical website inspection.

## Run

```bash
npm install
npm run gui
```

Open: `http://127.0.0.1:3847`

## Workflow

1. Create a project in the dashboard.
2. Add `keywords.txt` and `blacklist.txt` from the project screen.
3. Configure scrape settings from GUI (max pages / per-engine overrides).
4. Run recon steps (Bing, DuckDuckGo, Clean, Inspector).
5. Review outputs in the built-in file browser under `data/<project>/`.

## Planning docs

- `docs/LEAD_GEN_3DAY_PLAN.md`
