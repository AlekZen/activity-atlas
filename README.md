# Activity Atlas

Visualize activity across an Obsidian vault as a compact, burst-based timeline.

[![GitHub release](https://img.shields.io/github/v/release/AlekZen/activity-atlas)](https://github.com/AlekZen/activity-atlas/releases)
[![License: MIT](https://img.shields.io/github/license/AlekZen/activity-atlas)](LICENSE)

Activity Atlas records file activity locally and groups noisy editing sessions into readable bursts. It is designed for large vaults where a flat list of recent Markdown notes is not enough.

> Activity Atlas works on desktop and mobile without executing external commands.

## Screenshots

### Dark theme

![Activity Atlas in Obsidian's dark theme](assets/activity-atlas-dark.png)

### Light theme

![Activity Atlas in Obsidian's light theme](assets/activity-atlas-light.png)

## Features

- Tracks file creation, modification, rename, and deletion.
- Receives Obsidian's live activity events for every file type; configured text formats additionally receive line-change statistics.
- Groups nearby events into collapsible activity bursts.
- Filters by path, day, operation, and extension.
- Includes a six-week activity calendar with accessible keyboard navigation.
- Coordinates multiple Obsidian instances with a writer lock so only one instance records.
- Uses no network services, telemetry, accounts, or advertising.

## Requirements

- Obsidian 1.13.0 or later on desktop or mobile.

## Installation

### Community Plugins

After the initial Community directory review is approved:

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse** and search for **Activity Atlas**.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest GitHub release](https://github.com/AlekZen/activity-atlas/releases/latest).
2. Create `<vault>/.obsidian/plugins/activity-atlas/`.
3. Copy the three files into that folder.
4. Reload Obsidian, then enable **Activity Atlas** under **Community plugins**.

## Usage

Open Activity Atlas from the ribbon activity icon or run **Activity Atlas: Open activity timeline** from the command palette.

The timeline updates while Obsidian is open, recording each file event as it happens.

### Calendar keyboard controls

When the activity calendar is open:

| Key | Action |
|---|---|
| `ArrowLeft` / `ArrowRight` | Previous or next day |
| `ArrowUp` / `ArrowDown` | Previous or next week |
| `Home` / `End` | Monday or Sunday of the current week |
| `PageUp` / `PageDown` | Previous or next month |
| `Shift+PageUp` / `Shift+PageDown` | Previous or next year |
| `Enter` / `Space` | Select the focused day |
| `Escape` | Close the calendar and return focus to its button |

## Settings

| Setting | Default | Description |
|---|---:|---|
| Tracked text extensions | Common note, data, code, and web formats | Formats that receive line-change statistics |
| Exclude globs | Empty | Additional paths to ignore; the vault configuration folder is always excluded |
| Large file threshold | 512 KB | Larger text files are tracked without line statistics |
| Live comparison budget | 20 MB | Maximum text kept in memory during the current session to compute line-change statistics; not persisted to disk |
| Retention | 90 days / 50,000 events | Bounds the local activity log |
| Burst window | 10 minutes | Maximum gap between events in one burst |

## Local data and privacy

Activity Atlas does not make network requests and does not collect telemetry. Runtime data stays under the plugin directory inside the vault configuration folder:

Activity Atlas does not inventory the vault on startup. It subscribes only to Obsidian's live create, modify, rename, and delete events while the app is open. For line statistics, it reads only the changed text file and keeps bounded comparison text in memory for the current session.

- `activity.jsonl` — bounded activity log.
- `writer.lock` — multi-instance writer coordination.
- `data.json` — Obsidian-managed plugin settings and local state.

## Development

```bash
npm ci
npm test
npm run build
```

The production build writes `main.js` at the repository root. A release must attach `main.js`, `manifest.json`, and `styles.css`, and its tag must match `manifest.json`.

## Origin and license

Activity Atlas began as a derivative of [Vault Change Feed](https://github.com/kains2866/vault-change-feed) by tiyukains. The product, interface, and storage contract have since diverged substantially. The original author and copyright remain credited in [LICENSE](LICENSE).

Activity Atlas is distributed under the MIT License.