# OpenAI MCP

Call OpenAI APIs — chat completions and DALL-E image generation — directly from Claude Code.

## Tools

- `openai_chat` — send a prompt to GPT-4o, GPT-4o-mini, o1, o3-mini, etc. and get a text response.
- `openai_image` — generate images with DALL-E 3 or DALL-E 2 and get back URL(s).

## Setup

Set your OpenAI API key:

**Option A — environment variable:**
```bash
export OPENAI_API_KEY=sk-...
```

**Option B — persistent config file:**
```bash
mkdir -p ~/.config/openai-mcp
echo '{"OPENAI_API_KEY":"sk-..."}' > ~/.config/openai-mcp/env.json
```

Then `/reload-plugins` in Claude Code.

Rebuild after editing `server/index.js`:
```bash
cd server && npm install && npm run build
```

## Install

```
/plugin install openai@brainrot-creations
```
