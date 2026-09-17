# Community directory publication

Last reviewed: 2026-09-17

This document is the source of truth for publishing Activity Atlas in the official Obsidian Community directory. Keep it in this repository and update it whenever the upstream project, permission request, or Obsidian review state changes.

## Current state

- Public repository: <https://github.com/AlekZen/activity-atlas>
- Current release: [0.1.3](https://github.com/AlekZen/activity-atlas/releases/tag/0.1.3)
- Release commit: `a36534e35676bf5e09251edb9d046f6f73b71f2b`
- Obsidian review draft: created, with the 0.1.3 automated review completed.
- Automated review result: all checks passed, with no warning or recommendation.
- Upstream public approval: GRANTED on 2026-08-29 by `@kains2866` ([kains2866/vault-change-feed#1 (comment)](https://github.com/kains2866/vault-change-feed/issues/1#issuecomment-5459580771)).
- Publication gate: CLEARED. Ready for final submission on the Obsidian Community directory portal.
- Tracking issue: [AlekZen/activity-atlas#1](https://github.com/AlekZen/activity-atlas/issues/1)
- Public permission request: [kains2866/vault-change-feed#1](https://github.com/kains2866/vault-change-feed/issues/1)

## License and directory policy are separate

Vault Change Feed and Activity Atlas use the MIT License. MIT already permits use, modification, publication, distribution, sublicensing, and sale when the original copyright and permission notice are preserved.

The upstream notice remains in `LICENSE`:

- Copyright (c) 2026 tiyukains
- Copyright (c) 2026 Alek (AlekZen)

The pending public approval is not an MIT requirement. It is an eligibility requirement imposed by [Obsidian's developer policies](https://docs.obsidian.md/Developer+policies) for the official Community directory.

## Evidence and dates

| Event | Date | Evidence |
|---|---|---|
| Last known upstream source commit | 2026-07-27 | [`b198a875daf5`](https://github.com/kains2866/vault-change-feed/commit/b198a875daf5ac0a86581087896feb170b2b8eb8) |
| Public permission request opened | 2026-08-28 | [Upstream issue #1](https://github.com/kains2866/vault-change-feed/issues/1) |
| Public permission granted by author | 2026-08-29 | [Upstream issue #1 comment](https://github.com/kains2866/vault-change-feed/issues/1#issuecomment-5459580771) |

The upstream author explicitly approved the publication of Activity Atlas as a separate derivative Community plugin under MIT.
Because written approval was provided directly on 2026-08-29, the 30-day contact follow-up and the six-month inactivity fallback are no longer required.
## Local reminders

Two one-time Windows Task Scheduler reminders are defined by scripts kept in this repository:

| Task | Local time | Purpose |
|---|---|---|
| `ActivityAtlas-Permission-FollowUp` | 2026-09-27 09:00 | Review the permission request after 30 days and leave at most one courteous follow-up if there is still no response. |
| `ActivityAtlas-Directory-Fallback` | 2027-01-27 09:00 | Verify six months of upstream inactivity and prepare the Obsidian fallback evidence. |

Register or refresh both reminders from the repository root:

```powershell
pwsh -NoProfile -File ./scripts/register-community-publication-reminders.ps1
```

Verify them:

```powershell
Get-ScheduledTask -TaskName 'ActivityAtlas-*' |
    Select-Object TaskName, State
```

The reminders use `StartWhenAvailable`, so Windows runs a missed reminder after the user next signs in. They display a local notification and link back to the tracking issue. If the repository moves, re-run the registration script from its new location.

A scheduled GitHub Actions workflow is intentionally not the only reminder. GitHub can [disable scheduled workflows in public repositories after 60 days without repository activity](https://docs.github.com/actions/managing-workflow-runs/disabling-and-enabling-a-workflow), which is shorter than the fallback waiting period.

## Submission procedure

1. The upstream permission request was approved on 2026-08-29 with the following public record:
   > *"Thank you for your thoughtful approach and for keeping the license and my original attribution intact. Since this is a substantial rework, I am happy to give my explicit approval. I approve Vault Pulse as a separate derivative Community plugin. I wish you the best of luck with Activity Atlas."*
2. Navigate to the Obsidian Community Directory portal (<https://community.obsidian.md>) or review draft for Activity Atlas 0.1.3.
3. Verify the automated review results remain green (0 warnings, 0 recommendations).
4. Include the link to the explicit public approval ([kains2866/vault-change-feed#1 (comment)](https://github.com/kains2866/vault-change-feed/issues/1#issuecomment-5459580771)) in the submission notes/justification.
5. Trigger final submission for reviewer evaluation.
6. After admission, install Activity Atlas from Community Plugins in a test vault to verify directory availability and close the tracking issue.
## If the fallback remains unavailable

If the upstream author remains active but does not approve the derivative, the official directory can remain blocked for the current code lineage. Activity Atlas may still be developed and distributed manually under MIT.

The alternative is a demonstrably independent implementation with no reused upstream source. That requires a clean implementation audit and should not be represented as complete merely because files were renamed or refactored.
