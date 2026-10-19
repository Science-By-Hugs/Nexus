# NEXUS repository guidance

## Brand authority
Read `brand/README.md`, `brand/DECISIONS.md` and the relevant sections of `brand/BRAND-GUIDE.md` before brand-related work. The owner designated this new NEXUS 2.0 portfolio as the source of truth on October 19, 2026.

- `brand/tokens/brand.tokens.json` is the canonical design-token source. Honor per-token approval status. Do not treat proposed values as approved.
- `brand/assets/approved/n-dot.svg` is the approved visual app symbol: lowercase n., Muted #A8B0B2 background, dark Slate #171A1C lettering. Platform exports still require QA.
- `public/brand/`, `src/brand.css`, celestial/Orbit references and existing screenshots are legacy implementation or history, not competing brand authority. Read `brand/REPOSITORY-AUDIT.md` before migration.
- Do not copy rejected proposal assets into the application. Do not invent physical packaging or infer it from generated images; require verified packaging references and fidelity signoff.
- Preserve product requirements and existing functionality. A brand-authority update does not authorize changing authentication, checkout, integrations, navigation or deployment settings. Keep runtime migration in a separate scoped change when requested.
- This authority applies to NEXUS. Do not restyle Science By Hugs, CORE or PULSE as a side effect.
