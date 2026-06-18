# 🌟 Yıldız Avcıları (Star Hunters)

> 🇹🇷 [Türkçe README](README.tr.md)

A gamified, RPG-themed family task portal that helps kids build good habits.

Kids complete daily and weekly tasks, upload proof, a parent approves, and the **stars** they collect gradually reveal a **mystery reward** in the center ("Who's That Pokémon?"-style curiosity mechanic). When the goal is reached, the reward unlocks.

Built so that a real reward (a gift) isn't just handed over for free, but **earned** through good habits — turned into a fun game.

**🕹️ Live showcase:** [yildizavcilari.com/tanitim](https://yildizavcilari.com/tanitim) (TR/EN)

> Built with "vibe coding" — designed and shipped end-to-end with an AI coding agent.

---

## ✨ Highlights

- **RPG onboarding wizard** — On first login the kid gets a cinematic intro, picks a *class*, and a guide bot explains the system like a game tutorial.
- **3 immersive themes** — the whole UI, colors and task language transform to the chosen theme:
  - 🚀 **Galactic Explorer** (Sci-Fi) — "Activate Gravity Shields", guide: NOVA
  - ⚔️ **Fantasy Realms** (RPG) — "Polish the White Armor", guide: Eldric
  - 🧱 **Pixel Universe** (Voxel) — "Set Up the Spawn Point", guide: Bit
- **AI learning chat** — The weekly "learn something new" task is a *Socratic conversation*: the guide bot asks what the kid learned, probes with questions to verify real understanding, and only then awards the stars. Memorization and copy-paste don't pass. Powered by Claude Haiku (with a Cloudflare Workers AI fallback).
- **Time-gated tasks** — each task is active during certain hours (make the bed in the morning, brush teeth morning + evening).
- **Age-aware content** — age 8 gets "animal of the day", age 13 gets "how does AI work".
- **Approval flow** — kid sends proof, parent/aunt approves or rejects with one tap, stars drop into the pool.
- **Custom tasks** — parents can define their own one-off tasks for a kid.
- **Milestone checkpoints** — family (and admin) set intermediate reward targets on the way to the big prize (e.g. "1000 ⭐ → ice cream"). Markers show on the kid's bar; the big prize stays hidden but checkpoints are visible. Reaching one triggers a celebration and a "give the reward" note to the parent.
- **Rewards log & metrics** — admin dashboard tracks who earned what, total stars and task counts. Parents see the full leaderboard too.
- **Dynamic silhouette** — as stars fill, milestone text changes in theme language ("The seal is cracking", "Structure 50% crafted").
- **Friendly leaderboard** — each kid fills their own bar; a shared board keeps it motivating.
- **Security** — server-side PIN auth (HMAC tokens), brute-force lockout, privacy-minimal public endpoints, photo size limits.

---

## 🧱 Tech stack

Single-page vanilla JS frontend (no build step) on a fully serverless Cloudflare backend:

- **Hosting + API:** Cloudflare Pages + Pages Functions (`/api/*` on the same domain, no CORS)
- **Database:** Cloudflare D1 (users, completions, custom tasks, seasons, reward log)
- **Storage:** Cloudflare R2 (photo proofs)
- **AI:** Claude Haiku (primary) with Cloudflare Workers AI (Llama) as fallback
- **Auth:** HMAC-signed session tokens, PIN login with rate limiting

The task catalog lives in code; everything user-generated lives in D1.

---

## 📂 Structure

```
yildiz-avcilari/
├── public/
│   ├── index.html        # the whole app (frontend)
│   └── tanitim.html       # bilingual (TR/EN) landing / about page
├── functions/
│   └── api/[[path]].js    # Pages Functions API (auth, tasks, approvals, AI chat, rewards)
├── backend/
│   ├── schema.sql         # D1 schema
│   └── seed.sql           # demo seed (generic names; real family data is never committed)
├── wrangler.toml
├── README.md / README.tr.md
└── LICENSE
```

---

## 🚀 Run it yourself

Requires a Cloudflare account and [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

```bash
# 1. create the D1 database, put the id in wrangler.toml
wrangler d1 create yildiz-db

# 2. create the R2 bucket
wrangler r2 bucket create yildiz-proofs

# 3. apply schema + demo seed
wrangler d1 execute yildiz-db --remote --file backend/schema.sql
wrangler d1 execute yildiz-db --remote --file backend/seed.sql

# 4. set the session secret (and optionally ANTHROPIC_API_KEY for Claude)
wrangler pages secret put SESSION_SECRET --project-name=yildiz-avcilari

# 5. deploy
wrangler pages deploy
```

Without `ANTHROPIC_API_KEY`, the AI chat automatically uses Cloudflare Workers AI (free tier), so no extra key is required to get started.

Demo seed logins: children `1111` / `2222` / `3333`, approvers `1234`, admin `0000`.

---

## 🗺️ Roadmap

- [x] Phase 1 — Frontend prototype (theme engine, wizard, approval flow, silhouette)
- [x] Phase 2 — Cloudflare backend (Pages Functions + D1 + R2), server-side PIN auth, AI learning chat
- [x] Custom tasks (parent-defined) + milestone checkpoints + rewards log & metrics
- [ ] Monthly season cycle (new reward each month)
- [ ] Admin-editable task catalog
- [ ] Notifications (task due, awaiting approval)

---

## 📝 License

**AGPL-3.0** — see [LICENSE](LICENSE). Free and open source: use, study, modify and share it freely (including running it as a web service). But any distributed or network-served version must keep its source open under the same license. You cannot close the source and sell it as a proprietary product.

---

*Made with love, to turn good habits into a game for kids. 💙*
