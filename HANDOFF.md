# OTF.Website — Handoff

Working notes for the next person (or session) picking this up.

## Where you are

- **Active branch:** `ui-polish` — open as **PR #25** against `main`.
- **Repo:** `anandmacwan123-tech/OTF.Website`.
- **Site:** Cloudflare Worker + static assets. Production: `otf.show`. Per-student subdomains (`<name>.otf.show`) route to that student's page via `src/worker.mjs`.
- **Owner workflow:** push to `ui-polish`, owner previews and merges to `main` when happy. Only push to `main` on explicit ask.

## Site map

| Path | File | Role |
|---|---|---|
| `/` (root) | `index.html` | "You're Invited" invite/video landing (black bg, headshot confetti). No labels, no project images. |
| `/showcase/` | `showcase/index.html` | **The "landing" we restyled** — central cycling headshot + floating project images. Red bg, no project labels, project images at 0.6x. |
| `/index/` | `index/index.html` | Student index — toggles **Faces (default)** ↔ List. |
| `/students/<slug>/` | `students/index.html` | Individual student portfolio. Also served at `<slug>.otf.show/`. |
| `/files/`, `/edit/`, `/display/` | admin tools | Not touched in the visual overhaul. |
| `src/worker.mjs` | Worker | Subdomain routing + `/api/*` handlers. |
| `wrangler.jsonc` | Config | `routes: *.otf.show/*` + `run_worker_first: true` (subdomain fix). |
| `scripts/generate-manifest.mjs` | Build | Inlines the per-page `MANIFEST` from `Student Work/`. |

## Current theme matrix (after PR #25)

| Page | Background | Text | Name label | Project label | Notes |
|---|---|---|---|---|---|
| Home (`/`) | black | white | — | — | Untouched. |
| Showcase (landing) | **red `#FC1233`** | white | **black bg / white text** | **removed** | Project images **0.6×** desktop+mobile. Bottom nav stays red bg with black `[VISIT] [INFO] [INDEX]` text. |
| Index | black | white | **red** | n/a | Defaults to Faces. Toggle pill is red with white text; selected button is black. |
| Student page | black | white | **red** | **white bg / black text** | Three-column hero: headshot (name label on top) · bio (380px) · practices+links to its right, all top-aligned to the headshot **image** (not the label). |
| Admin tools | unchanged | unchanged | — | — | Per-owner answer: public pages only. |

CSS variables on dark pages: `--bg #000`, `--fg #fff`, `--muted #9a9a9a`.

## Bracket-link hover (site-wide motif)

All bracketed links (`[SHOWCASE]`, `[VISIT]`, etc., plus the home CTA, student-page arrows, and socials) render the `[ ]` as `::before`/`::after` pseudo-elements. On `:hover`, `:focus-visible`, and `:active` the brackets fade to opacity 0 and the label goes `font-weight: 700`. Don't reintroduce literal `[ ]` in link text — both the pseudo-elements and the text characters would render together.

## ui-polish change log (most recent first)

- Black showcase nav text (revert of bar bg); red index pill, black selected state.
- Visual overhaul: red landing, dark public pages, faces-default index.
- Mobile name-label fixes (size + flush to headshot top).
- Hero lockup iterated several times; final: 2-row grid, label row 1 col 1, everything else row 2 top-aligned to the image.
- Bracket hover redesign (drop brackets + bold on hover/focus/active).
- Side padding increased via `--pad-x` on the student page.
- Project-name display transform on student/showcase/display: `-` → space, `_` → real `-` (so `Anand_Non_Consensual-INtelligence_1.webp` renders "Non Consensual-Intelligence" → with `_` for the real dash. Anand's file still needs renaming via /files/).

Earlier ui-polish work (a11y/polish, pre-overhaul) is also on the branch — full list via `git log main..ui-polish`.

## Standing flagged items (not acted on yet)

- **Showcase `/info/` nav link is broken** — there is no `/info/` page yet. Either build it or remove the link.
- **Two reds in the codebase:** `--red: #FF002F` (home/showcase var) vs `#FC1233` (the "iconic" red used as bg + label). The overhaul standardized on `#FC1233`; the unused `--red` vars could be deleted.
- **Anand non-consensual file** still uses a `-` where it should be `_` to render the real dash. Rename via the /files/ admin tool when convenient.
- **Mid-width tablet (~720–1000px) on student pages**: the three columns (headshot · bio · practices · links) get tight before the 720px mobile breakpoint kicks in. If it looks cramped in QA, raise the breakpoint or stack practices/links under the bio sooner.

## Other live branches worth knowing about

- `main` — production. Per-student subdomains and the reapply submissions button are merged.
- `student-subdomains` — already merged (subdomain routing in worker).
- `submissions-reapply` — already merged (the "Re-apply → stage changes" button).
- `worker-route-wildcard` — Cloudflare routes + `run_worker_first: true` config.
- `claude/add-student-index-page-NyC5j` — earlier index/edit work, merged via PR #23/#24.
- `showcase-updates`, `OTF.Showcase`, `efficiency`, `library` — older/legacy, treat with care; some are well behind main.

⚠️ When opening a PR from a Claude UI session, double-check the **base branch** — the UI defaults to `OTF.Showcase` and has caused phantom conflicts several times. Use `mcp__github__update_pull_request` to retarget to `main`.

## How to preview / deploy

- **Local preview:** `npx wrangler dev` (or any static server from repo root). Live pages fetch the published Google Sheet for bios/practices and `/Student Work/` for images. Offline you'll see the "Couldn't load profile" fallback.
- **Deploy:** `npx wrangler deploy`. Static assets ship from repo root via the `assets` binding in `wrangler.jsonc`.
- **WebFetch to otf.show is blocked** by Cloudflare bot protection (403), so don't try to self-verify the live site that way — preview locally or rely on owner review.

## Conventions worth keeping

- File-naming for projects: `<Student>_<Project>_<N>.webp` under `Student Work/Projects/`; headshots `<Student>.webp` under `Student Work/Headshots/`. The student page groups by `<Project>`.
- Project-title display: replace `-` with a space and `_` with `-` (see `projectGroups`/`titleEl.textContent` in `students/index.html`, and `projectLabelFor`-equivalents in showcase/display).
- Don't comment what well-named code already says; comments are for non-obvious *why* (a constraint, a workaround, an invariant).
