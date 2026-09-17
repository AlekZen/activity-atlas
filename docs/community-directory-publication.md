# Community directory publication

Last reviewed: 2026-09-17

This document is the source of truth for publishing Activity Atlas in the official Obsidian Community directory. Keep it in this repository and update it whenever the upstream project, permission request, or Obsidian review state changes.

## Current state
- Public repository: <https://github.com/AlekZen/activity-atlas>
- Official directory listing: <https://community.obsidian.md/plugins/activity-atlas>
- Current release: [0.1.3](https://github.com/AlekZen/activity-atlas/releases/tag/0.1.3)
- Release commit: `a36534e35676bf5e09251edb9d046f6f73b71f2b`
- Directory status: PUBLISHED on 2026-09-17
- Upstream public approval: GRANTED on 2026-08-29 by `@kains2866` ([kains2866/vault-change-feed#1 (comment)](https://github.com/kains2866/vault-change-feed/issues/1#issuecomment-5459580771))
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
| Published to Community directory | 2026-09-17 | [Obsidian Community listing](https://community.obsidian.md/plugins/activity-atlas) |

The upstream author explicitly approved the publication of Activity Atlas as a separate derivative Community plugin under MIT.
Community publication completed on 2026-09-17. Fallback reminders and tasks were retired.
## Reminders status

The local Windows Task Scheduler reminders (`ActivityAtlas-Permission-FollowUp` and `ActivityAtlas-Directory-Fallback`) were unregistered on 2026-09-17 following successful publication.
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
