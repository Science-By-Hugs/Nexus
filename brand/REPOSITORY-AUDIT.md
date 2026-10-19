# NEXUS repository brand audit
October 19, 2026 · Authority audit, not a live-app visual or accessibility certification.

Baseline: main commit `a0d9eb8b686644a4d047af8bf835ff95745379a2`; saved portfolio commit `cfcc8a383c8d37b570a5fa0baf62423098b2461b`. Reviewed tracked repository guidance, token files, CSS imports, brand assets and install references. No Android project was found in this baseline. Native raster artwork has not been visually certified.

## Result
The new `brand/` portfolio is the owner's canonical NEXUS source of truth. Before this audit, the repository presented three conflicting visual systems. Documentation now resolves precedence; runtime remains legacy. Existing runtime code must not be used to overrule the new brand.

| Finding | Evidence | Resolution / remaining work |
|---|---|---|
| README claims Blue Reactor as current | `README.md` product identity and platform list | Corrected to canonical portfolio; approved n. icon used in repository header |
| Old design guide claims celestial approval | `docs/DESIGN-SYSTEM.md`: October 14 approval, navy/cyan palette, orbital imagery | Replaced entry point with canonical links; preserved original in `docs/design/LEGACY-CELESTIAL-DESIGN.md` as superseded history |
| Legacy tokens claim approved status | `public/brand/brand-tokens.json`: Blue Reactor v1.0.0, cobalt/cyan, Space Grotesk/Inter, glows | Companion README scopes this metadata as historical for NEXUS; file contents unchanged |
| Layered runtime overrides conflict with Slate | `src/main.ts` imports styles, brand, minimal, orbit, fluid, refinement, compact and authRedesign CSS; biometric CSS also imports early | Migration pending. Establish one approved-token adapter; inventory actual cascade and remove obsolete overrides only with regression testing |
| Hardcoded navy/cyan persists | `src/orbit.css`, `fluid.css`, `compact.css`, `refinement.css`, `biometricUnlock.css`, `authRedesign.css` | Migration pending across browsing, authentication, dialogs and focus states; do not simply replace one root color |
| Orbital background conflicts with calm flat system | `orbit.css`, `fluid.css`, `compact.css`, `public/orbit-horizon-v3.png` | Replace in separately scoped implementation; do not remove files still referenced by runtime |
| App/install icon still legacy | `index.html`, `vite.config.ts`, `public/push-sw.js` reference `public/brand/nexus-app-icon.svg` | Produce platform exports from approved `brand/assets/approved/n-dot.svg`; update references and verify install/push separately |
| Install theme remains navy | `vite.config.ts` theme/background #020b16 | Set appropriate approved Slate mapping during migration; browser chrome and splash need platform checks |
| iOS icon and splash independent | `ios/App/App/Assets.xcassets/AppIcon.appiconset/`, `Splash.imageset/`, `Base.lproj/LaunchScreen.storyboard` | Inspect artwork and export new approved assets later; current binaries unchanged |
| Old preview may be mistaken for current spec | `design-review.html` loads legacy CSS; `docs/design/approved-orbit-v3.png` is old reference | Historical implementation preview only; canonical review is `brand/REVIEW.html` |
| Label template and generated vial cannot establish real packaging | `public/brand/applications/product-label.svg`, `public/science-by-hugs-vial-v3.png`, old design guide's label claims | Not approved packaging evidence. Obtain actual reference pack per SKU; no inferred label colors, materials, wording or claims |
| Parent/other-product assets coexist | `public/brand/science-by-hugs*.svg`, `core.svg`, `pulse.svg`, applications/* | Preserve; authority change is NEXUS-specific, not a parent-brand or sibling-product rebrand |
| Portfolio still contains unresolved proposals | P01/P03–P08 and per-leaf token status | Keep explicit review status; owner canonical-source decision is not blanket approval |

## Changes completed by this audit
Canonical links added to root README, root AGENTS.md, docs/DESIGN-SYSTEM.md and legacy asset README. Historical celestial document preserved. Portfolio authority records updated. No runtime CSS, TypeScript, configuration, binary assets, public logo masters, native files or backend files changed.

## Separate migration acceptance
1. Resolve outstanding brand choices needed for the target screens; recover full 29-decision product blueprint.
2. Generate reviewed runtime adapters from approved tokens; document native unit mapping and all legacy overrides retired.
3. Migrate styling and icon/install metadata in a dedicated change, preserving all product flows.
4. Verify iOS, Android when available, and web: safe areas, text scaling, focus/contrast, reduced motion, provider branding, offline launch, install icons and push notifications.
5. Replace product imagery only after SKU-level fidelity review using real packaging sources.

No claim is made that the current app implements Slate, that all brand choices are approved, or that the current packaging imagery is accurate. Deployment and runtime migration are not performed by this audit.
