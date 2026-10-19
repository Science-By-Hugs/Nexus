<p align="center">
  <img src="brand/assets/approved/n-dot.svg" alt="NEXUS — approved n. app symbol" width="120" />
</p>

<h3 align="center">Explore. Connect. Order.</h3>

<p align="center">
  The customer research portal for the Science By Hugs ecosystem.
</p>

<p align="center">
  <a href="https://nexus.sciencebyhugs.com"><strong>Open NEXUS</strong></a>
  &nbsp;·&nbsp;
  <a href="https://sciencebyhugs.com">Science By Hugs</a>
</p>

---

## NEXUS

NEXUS is the customer-facing Science By Hugs experience for research catalog access, accounts, ordering, payments, invoices, referrals, support, and order history.

### Product identity

**NEXUS · SCIENCE BY HUGS**  
**Explore. Connect. Order.**

The [NEXUS 2.0 brand portfolio](brand/README.md) is the canonical source of truth, designated by the owner on October 19, 2026. The Slate system and approved lowercase **n.** icon supersede Blue Reactor and celestial/Orbit visual guidance for NEXUS.

See the [brand guide](brand/BRAND-GUIDE.md), [approval record](brand/DECISIONS.md), and [brand audit](brand/REPOSITORY-AUDIT.md). Follow recorded approval statuses; remaining proposals need approval. The current app still uses legacy assets pending a separate implementation migration. The legacy “Explore. Connect. Order.” tagline above is retained as historical product copy, not a newly approved brand tagline.

### Platform

- Vite + TypeScript
- Supabase-backed account and business data
- Installable PWA
- Responsive mobile and desktop interface
- Automatic PWA update workflow
- Canonical NEXUS 2.0 Slate brand portfolio; runtime migration pending

### Development

```bash
npm install
npm run dev
npm run build
```

---

<p align="center">
  <img src="public/brand/science-by-hugs.svg" alt="Science By Hugs" width="520" />
</p>

## 2.0 staging development branch

This branch is staging-only and must not be merged into production main. Read [Day 1 setup](docs/V2-DAY1.md), [beta scope](docs/V2-BETA-SCOPE.md), and [staging plan](docs/V2-STAGING-PLAN.md) before running or provisioning it. Explicit staging settings are required; CI builds fixtures without deploying.
