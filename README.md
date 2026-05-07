<h1 align="center">Brainrot Creations · Claude Plugins</h1>

<p align="center">
  <strong>Official Claude Code plugins by Brainrot Creations.</strong>
</p>

<p align="center">
  <a href="https://github.com/Brainrot-Creations/claude-plugins"><img src="https://img.shields.io/badge/claude--code-plugin--marketplace-blue" alt="Claude Code Plugin Marketplace" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

---

## Install

In Claude Code:

```
/plugin marketplace add Brainrot-Creations/claude-plugins
```

Then install individual plugins:

```
/plugin install socials@brainrot-creations
/plugin install hive@brainrot-creations
/plugin install agent-browser@brainrot-creations
```

```
/reload-plugins
```

---

## Plugins

### [Socials](./plugins/socials)

<p>
  <img src="./assets/socials.gif" alt="Socials" width="100%" />
</p>

Connect Claude to X, LinkedIn, and Reddit via the Socials browser extension. Post, engage, search, and manage social media directly from Claude Code.

**Install:** `/plugin install socials@brainrot-creations`

### [Hive](./plugins/hive)

Collective browser automation intelligence. Pull known interaction methods before acting, contribute discoveries after, vote on what works. Every agent makes the network smarter.

**Install:** `/plugin install hive@brainrot-creations`

### [Agent Browser](./plugins/agent-browser)

Fast native browser automation for AI agents. Navigate, screenshot, fill forms, click, and extract data from any webpage — powered by Chrome DevTools Protocol.

**Install:** `/plugin install agent-browser@brainrot-creations`

### [AMC Theatres](./plugins/amc-theatres)

Search AMC theatres, get showtimes, and view seat maps. No auth required — works out of the box.

**Install:** `/plugin install amc-theatres@brainrot-creations`

### [Luma Events](./plugins/luma-events)

Browse Luma events — discover, search calendars, and get event details via the Luma public API.

**Install:** `/plugin install luma-events@brainrot-creations`

---

## For Developers

This repo is the plugin marketplace definition — it contains skill files, commands, and MCP config for each plugin. The underlying MCP servers live in their own packages:

| Plugin | Source |
|--------|--------|
| socials | [@brainrotcreations/socials](https://github.com/Brainrot-Creations/socials) |
| hive | [api.hive.brainrotcreations.com](https://hive.brainrotcreations.com) |
| agent-browser | [Brainrot-Creations/agent-browser](https://github.com/Brainrot-Creations/agent-browser) |
| amc-theatres | [api.brainrotcreations.com/api/amc](https://api.brainrotcreations.com) |
| luma-events | [api.brainrotcreations.com/api/luma](https://api.brainrotcreations.com) |

---

[MIT License](./LICENSE) · [contact@brainrotcreations.com](mailto:contact@brainrotcreations.com)
