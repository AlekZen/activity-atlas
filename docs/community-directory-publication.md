# Community directory publication

Last reviewed: 2026-08-28

This document is the source of truth for publishing Activity Atlas in the official Obsidian Community directory. Keep it in this repository and update it whenever the upstream project, permission request, or Obsidian review state changes.

## Current state

- Public repository: <https://github.com/AlekZen/activity-atlas>
- Current release: [0.1.3](https://github.com/AlekZen/activity-atlas/releases/tag/0.1.3)
- Release commit: `a36534e35676bf5e09251edb9d046f6f73b71f2b`
- Obsidian review draft: created, with the 0.1.3 automated review completed.
- Automated review result: all checks passed, with no warning or recommendation.
- Publish action: intentionally not performed.
- Tracking issue: [AlekZen/activity-atlas#1](https://github.com/AlekZen/activity-atlas/issues/1)
- Public permission request: [kains2866/vault-change-feed#1](https://github.com/kains2866/vault-change-feed/issues/1)

The only remaining publication gate is Obsidian's policy for plugins derived from an existing Community plugin.

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
| Thirty-day contact period completes | 2026-09-27 | Derived from the public request date |
| Earliest six-month inactivity review | 2027-01-27 | Valid only if the upstream project receives no later update |

Obsidian's fallback requires both a public contact attempt with at least 30 days to respond and at least six months without an upstream project update. Eligibility is reviewed by Obsidian; it is not automatic.

If the upstream project is updated after 2026-07-27, recompute the six-month date from the new update and re-register the fallback reminder.

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

## Procedure on 2026-09-27

1. Read the upstream permission request and all replies.
2. If `@kains2866` explicitly approves publication, preserve the public reply URL and proceed with the Obsidian draft.
3. If there is no response, leave no more than one concise and courteous follow-up.
4. Update this document and the tracking issue with the observed state.

## Procedure on or after 2027-01-27

1. Verify the latest upstream commit or release date; do not rely on the date recorded here.
2. Confirm that at least six months have passed since the latest upstream update.
3. Confirm that the public contact attempt has been visible for at least 30 days.
4. Preserve links to the upstream repository, latest commit, permission issue, Activity Atlas repository, release, license, and passing Obsidian review.
5. Ask Obsidian to evaluate the unreachable-author and inactive-project exception.
6. Publish only after Obsidian accepts the evidence or the original author gives explicit public approval.
7. After publication, install Activity Atlas from Community Plugins in the independent test vault and close the tracking issue.

## If the fallback remains unavailable

If the upstream author remains active but does not approve the derivative, the official directory can remain blocked for the current code lineage. Activity Atlas may still be developed and distributed manually under MIT.

The alternative is a demonstrably independent implementation with no reused upstream source. That requires a clean implementation audit and should not be represented as complete merely because files were renamed or refactored.
