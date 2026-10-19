# NEXUS 2.0 brand portfolio
Version 0.1.0 · October 19, 2026 · APPROVAL CANDIDATE

Start with REVIEW.html, then BRAND-GUIDE.md. This is a standalone branding package, not an application change. This portfolio is stored separately from runtime assets. Application code and configuration are unchanged.

## Authority
A = approved foundation from the current user request or retrieved conversation. P = proposed specification awaiting owner approval. B = blocked pending source material. Approved foundations do not automatically approve the specifications built around them. Nothing in this candidate is production-ready merely because it is included.

## Contents
- BRAND-GUIDE.md — comprehensive identity, UI, imagery, platform and governance rules.
- DECISIONS.md — evidence, gaps and approval record.
- REVIEW.html — offline, responsive visual review and reusable layout examples; no external assets or dependencies.
- tokens/brand.tokens.json — typed, status-tagged source tokens.
- tokens/brand.preview.css — review-only CSS mapping, not an app stylesheet.
- assets/proposals/ — editable SVG identity studies; live text, not final outlined logos.
- templates/ — reusable briefs and review records.
- ASSET-INVENTORY.csv — delivered, proposed and blocked assets.
- CONTRAST.md — calculated palette pairings and accessibility constraints.

## Recommended canonical home
After approval and repository audit, place this package at `brand/` in ScienceByHugs/Nexus. Use `brand/README.md` as the entry point, `brand/tokens/brand.tokens.json` as the sole token source, `brand/assets/approved/` for released masters, `brand/assets/proposals/` for candidates, and `brand/releases/` for immutable snapshots. Link to it from the repository README and contributor instructions. Generate platform exports from approved tokens later; never hand-maintain duplicate values. This recommendation has not been applied to the repository.

The brand owner must approve the decision record before v1.0.0. Product packaging fidelity and platform export checks remain asset-specific gates even after system approval. No trademark clearance, domain acquisition or rights registration is implied by this portfolio.

## Repository handoff · October 19, 2026
The repository already contains `src/brand.css`, `public/brand-mark.svg` and `public/brand/brand-tokens.json` (Blue Reactor). These remain unchanged. This new directory records the NEXUS 2.0 design direction and approval status; it is not connected to runtime styling. Do not overwrite parent-brand rules or runtime tokens without a separately reviewed implementation change.

The approved app symbol is [assets/approved/n-dot.svg](assets/approved/n-dot.svg). Its current geometry, Muted background and dark Slate foreground were approved by the owner. Other logo studies remain proposals or rejected history; consult LOGO-REVISION.md and DECISIONS.md. System-wide approval is still pending. Platform exports and fidelity-approved product imagery are not delivered here.
