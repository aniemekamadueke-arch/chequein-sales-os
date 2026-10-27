# ChequeIn Sales OS

A local, offline sales system for ChequeIn's free-payroll model. It is built around one idea: **free payroll is the door, employee activation is the revenue.**

**Live:** https://aniemekamadueke-arch.github.io/chequein-sales-os/
**Repo:** https://github.com/aniemekamadueke-arch/chequein-sales-os

Open the live link on any device, or open **`ChequeIn-Sales-OS.html`** locally (single file, no install, works offline). The GitHub Pages build is the static version: each visitor's data is saved in their own browser via `localStorage`. Use **Settings & data** to export a JSON backup, import one, or reset to the seeded baseline.

---

## The five screens

| Screen | What it does |
| --- | --- |
| **Today** | A prioritised action queue built from every employer's next step, plus a daily activity log and weekly input targets. This is the screen you open first. |
| **Pipeline** | Kanban from Lead to Live. Sourcing links for Lagos schools, batch paste, search, and a record for every employer. Stages are gated. |
| **Compliance gate** | The pre-qualification rules, the eight documents, red flags, and a triage table for the seven employers that failed. |
| **Playbook** | The pitch, the six qualification questions, the 21-day cadence with copyable WhatsApp/email/call scripts, the staff onboarding session, payday push, objections and the compliance-recovery sequence. |
| **Numbers** | Baseline funnel, quarter targets, a live revenue model, the weekly scorecard and the 90-day plan. |

## The gates (the important part)

Seven of eleven employers failed compliance after sign-up. The system now refuses to let that happen quietly:

1. **Qualified** requires all six answers, a score of 7/10, 10+ staff, salaries paid by transfer, CAC/TIN in place and a decision maker engaged. Cash payroll is a hard stop even with a high score.
2. **Demo → Compliance** requires the demo to be marked complete.
3. **Compliance → Live** requires all eight documents. The button is disabled and tells you exactly what is missing.

These are enforced in the record drawer, not just written in a doc.

## Getting started (first 30 minutes)

1. Open **Compliance** → **Triage the seven**. Rename the placeholder records to the real employers, then mark each **Fixable** or **Not a fit**. This clears the dead weight.
2. Open **Pipeline** → add 20–25 schools using the sourcing links or **Paste a list**. The 21-day cadence schedules its own first WhatsApp for each one.
3. Open **Today** and work the queue. Each row tells you what to send and when. Open the record to copy the script, or use **Open WhatsApp** once a phone number is saved.
4. Add phone numbers and contacts for the three live employers, then book the staff sessions. An employer without a staff session is a payroll, not a customer.
5. Log what you actually sent. The weekly scorecard is only as good as the log.

## Seeded with your numbers

- 3 live employers, 106 employees, **₦31,905/month**, about **₦301 per employee**
- 11 employers signed, 4 passed compliance
- 33% EWA use, 8% funded savings, 1 of 25 recent sign-ups retained after 30 days
- EWA repayment reported at 6.4% — flagged for verification, not celebrated
- The 7 failed compliance records are **placeholders** with plausible reasons. Rename them before triage.

## The weekly rhythm

- **Daily (45 min):** Today queue; 20 WhatsApps, 10 calls, follow-ups; log it.
- **Friday (20 min):** Numbers → weekly scorecard; triage any new compliance failures; set next week's 25 targets.
- **Monthly:** 30-day activation review at each live employer. Compare staff paid, savings, EWA and revenue.

## Files

- `index.html` — app shell
- `styles.css` — styling
- `data.js` — seed data, sequences, scripts, qualification rules
- `app.js` — logic and views
- `ChequeIn-Sales-OS.html` — single-file build for sharing

## Hosting

- **GitHub Pages** serves `docs/index.html` at https://aniemekamadueke-arch.github.io/chequein-sales-os/. This is the public, permanent, per-device build.
- **`dist/index.html` + `netlify/functions/state.mjs`** is the shared build: a team code gate, version-checked sync and Netlify Blobs storage. It requires a host that allows public functions and a `TEAM_CODE` environment variable. The Netlify project is deployed, but its project visibility is set to **Private**, so visitors currently hit a Netlify login wall; set **Project visibility → Public** in the Netlify dashboard to enable the shared version.
- Never commit the team code. It lives in the host's environment variables, never in this repo.

### Updating the public site

```bash
python3 build.py
cp ChequeIn-Sales-OS.html docs/index.html
git add docs && git commit -m "Update app" && git push
```

## Limits

The GitHub Pages build is per-device — it is a shared *tool*, not a shared pipeline. WhatsApp, call and email links open your own apps; nothing is sent automatically. For one shared pipeline, use the shared build with a public host, or replace localStorage with a shared database.

Before marketing credit, confirm the 6.4% repayment definition and the regulatory position with VFD or Wema.
