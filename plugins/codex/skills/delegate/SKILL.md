---
name: delegate
description: Delegate a sub-task to OpenAI Codex CLI. Use when a task is better handled by Codex (e.g. complex file editing, multi-step coding tasks, automated code generation).
---

Use the `codex` MCP tools to delegate tasks to OpenAI Codex CLI.

## Prerequisites

Codex must be installed and authenticated:
```bash
npm i -g @openai/codex
# then either set OPENAI_API_KEY or sign in via browser auth
```

## Synchronous delegation (need result now)

Use `codex_run` when you need the output before continuing:

```
codex_run(
  prompt="<full task description with all context Codex needs>",
  cwd="/path/to/project"   # optional, defaults to current directory
)
```

Returns the final Codex message as a string.

## Background delegation (parallel work)

Use `codex_task_submit` to fire off tasks and continue working:

1. Submit one or more tasks:
   ```
   codex_task_submit(name="Refactor auth module", prompt="...", cwd="...")
   codex_task_submit(name="Write tests for API", prompt="...", cwd="...")
   ```

2. Check status:
   ```
   codex_task_status(task_id="<id>")
   ```

3. Fetch result when completed:
   ```
   codex_task_result(task_id="<id>")
   ```

4. See all tasks:
   ```
   codex_tasks_list()
   ```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | API key for Codex (required unless using browser auth) |
| `CODEX_PATH` | Override path to the `codex` binary |
| `CODEX_YOLO=1` | Bypass all approvals and sandbox (fastest, least safe) |
| `CODEX_APPROVAL` | `never` (default) or `untrusted` |
| `CODEX_SANDBOX` | `workspace-write` (default), `read-only`, or `danger-full-access` |

## Writing good prompts for Codex

- Include full context — Codex starts fresh with no knowledge of prior work
- Specify the working directory if the task involves files
- Be explicit about what "done" looks like (files to edit, tests to pass, output expected)
- If the task spans multiple files, list the key ones
