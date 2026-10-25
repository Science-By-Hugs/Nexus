# Releasing nexus.

The same rules apply in every Science By Hugs repository: Core, Nexus, Pulse and the website.

## Branches

| Branch | Means | Who changes it |
| --- | --- | --- |
| `main` | nexus. 2.0 releases: what is in the App Store and Google Play (see note below) | Pull request only, merged by Anthony |
| `staging` | What's on TestFlight and the staging site (2.0 work) | Pull request only, merged by Anthony |
| `feat/…`, `fix/…`, `design/…`, `ci/…`, `docs/…` | One piece of work | Anyone; deleted automatically after merge |
| `archive/2026-10-25` | Old branches kept for reference (see `ARCHIVE.md` on that branch) | Never merged |

- Nobody pushes straight to `main` or `staging`. Changes go through a pull request with CI passing.
- Work branches start from `staging` and target it.
- Stacked work (one PR building on another) points each PR at the branch before it, so every PR shows only its own changes. Merge from the bottom up.

## Versions

nexus. uses `MAJOR.MINOR.PATCH`:

- **MAJOR**: a new generation of the app (1.0 → 2.0).
- **MINOR**: new features.
- **PATCH**: fixes only.

iOS builds also carry a build number that only goes up. The version is what people see; the build number identifies one exact IPA.

> **Note (Oct 25, 2026):** this repository is nexus. 2.0, the native app customers will order through. The live 1.0 web storefront (commit `181284c`) stays in `ScienceByHugs/sciencebyhugs-nexus` and keeps taking orders until the app replaces it; storefront fixes go there. When the app takes over, nexus.sciencebyhugs.com becomes the app's home page (download, support, privacy, account links) and the old repository is archived.

## Tags and releases

Every build that leaves the building gets a git tag and a GitHub Release.

| Kind | Tag | Example |
| --- | --- | --- |
| App Store release | `nexus-vX.Y.Z` | `nexus-v2.0.0` |
| Web storefront 1.0 | `nexus-v1.0.0` | Live web store, commit `181284c` (kept in `sciencebyhugs-nexus`) |
| TestFlight build | `nexus-vX.Y.Z+BUILD` | `nexus-v2.0.0+1` |

The release notes say what changed, the exact commit, and how it was verified (CI run, device checks). For iOS builds, include the IPA SHA-256 and keep the IPA and crash symbols.

Never tag a commit you can't prove the build came from.

## Approvals

- Draft PRs, branches and CI changes: anyone.
- Merging, deploying, signed builds, TestFlight or App Store uploads, and production changes: **Anthony only, each time, for that specific action**.
- Staging work never touches production backends.

## Restoring an archived branch

```sh
git fetch origin archive/2026-10-25
git show origin/archive/2026-10-25:ARCHIVE.md   # find the branch and its commit
git push origin <commit>:refs/heads/<branch>
```
