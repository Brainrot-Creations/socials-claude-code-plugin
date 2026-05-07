#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ─── Codex runner ─────────────────────────────────────────────────────────────

const CODEX_PATH = process.env.CODEX_PATH || 'codex';

// Sandbox defaults — override via env:
//   CODEX_SANDBOX=read-only|workspace-write|danger-full-access  (default: workspace-write)
// Agent automation requires non-interactive mode; dangerously-bypass is used unless CODEX_SANDBOX is set.
const CODEX_SANDBOX = process.env.CODEX_SANDBOX || null;

function buildCodexArgs(prompt, outFile, cwd) {
  const args = ['exec', prompt, '-o', outFile];
  if (CODEX_SANDBOX) {
    args.push('-s', CODEX_SANDBOX);
  } else {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }
  if (cwd) args.push('-C', cwd);
  args.push('--ephemeral');
  return args;
}

function runCodexSync(prompt, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(os.tmpdir(), `codex-${crypto.randomUUID()}.txt`);
    const args = buildCodexArgs(prompt, outFile, cwd);
    const opts = {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    };

    const child = spawn(CODEX_PATH, args, opts);
    const stderr = [];
    child.stderr.on('data', (d) => {
      stderr.push(d.toString());
      process.stderr.write(d);
    });
    child.stdout.on('data', (d) => process.stderr.write(d));

    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`codex timed out after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      let output = '';
      try { output = fs.readFileSync(outFile, 'utf8').trim(); } catch {}
      try { fs.unlinkSync(outFile); } catch {}
      if (code !== 0 && !output) {
        return reject(new Error(`codex exited ${code}\n${stderr.join('')}`));
      }
      resolve(output || `(codex exited ${code} with no output)`);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Failed to spawn codex: ${err.message}`));
    });
  });
}

// ─── Task registry ────────────────────────────────────────────────────────────

const tasks = new Map();

function submitTask(name, prompt, cwd) {
  const id = crypto.randomUUID();
  const outFile = path.join(os.tmpdir(), `codex-${id}.txt`);
  const task = {
    id,
    name,
    status: 'pending',
    prompt,
    cwd: cwd || null,
    outFile,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    pid: null,
  };
  tasks.set(id, task);

  const args = buildCodexArgs(prompt, outFile, cwd);
  const opts = {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  };

  const child = spawn(CODEX_PATH, args, opts);
  task.pid = child.pid;
  task.status = 'running';

  child.stderr.on('data', (d) => process.stderr.write(`[codex:${id.slice(0, 8)}] ${d}`));
  child.stdout.on('data', (d) => process.stderr.write(`[codex:${id.slice(0, 8)}] ${d}`));

  child.on('close', (code) => {
    let output = '';
    try { output = fs.readFileSync(outFile, 'utf8').trim(); } catch {}
    try { fs.unlinkSync(outFile); } catch {}
    task.completedAt = new Date().toISOString();
    if (code !== 0 && !output) {
      task.status = 'failed';
      task.error = `codex exited ${code}`;
    } else {
      task.status = 'completed';
      task.result = output || `(codex exited ${code} with no output)`;
    }
  });

  child.on('error', (err) => {
    task.status = 'failed';
    task.error = `Failed to spawn codex: ${err.message}`;
    task.completedAt = new Date().toISOString();
  });

  return id;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'codex_run',
    description:
      'Run a task with the OpenAI Codex CLI and wait for the result. Use for synchronous sub-tasks where you need the output before continuing. Uses whatever auth Codex already has on the machine (app sign-in or OPENAI_API_KEY).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The full task description and instructions for Codex',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the task (defaults to current)',
        },
        timeout_ms: {
          type: 'number',
          description: 'Max milliseconds to wait (default: 300000 = 5 min)',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'codex_task_submit',
    description:
      'Submit a named task to Codex in the background. Returns a task_id immediately. Use codex_task_status to poll and codex_task_result to fetch output.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short descriptive name for this task' },
        prompt: {
          type: 'string',
          description: 'The full task description and instructions for Codex',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the task',
        },
      },
      required: ['name', 'prompt'],
    },
  },
  {
    name: 'codex_task_status',
    description: 'Check the current status of a background Codex task (pending | running | completed | failed).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID returned by codex_task_submit' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'codex_task_result',
    description: 'Retrieve the full output of a completed Codex task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID returned by codex_task_submit' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'codex_tasks_list',
    description: 'List all submitted Codex tasks with their name, status, and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'codex_run': {
      process.stderr.write('[codex] starting task\n');
      const result = await runCodexSync(args.prompt, args.cwd, args.timeout_ms ?? 300000);
      process.stderr.write('[codex] task complete\n');
      return result;
    }

    case 'codex_task_submit': {
      const id = submitTask(args.name, args.prompt, args.cwd);
      return JSON.stringify({
        task_id: id,
        status: 'running',
        message: `Task "${args.name}" submitted (pid ${tasks.get(id)?.pid}). Poll with codex_task_status("${id}").`,
      });
    }

    case 'codex_task_status': {
      const t = tasks.get(args.task_id);
      if (!t) return JSON.stringify({ error: 'Task not found' });
      return JSON.stringify({
        id: t.id,
        name: t.name,
        status: t.status,
        pid: t.pid,
        created_at: t.createdAt,
        completed_at: t.completedAt,
      });
    }

    case 'codex_task_result': {
      const t = tasks.get(args.task_id);
      if (!t) return JSON.stringify({ error: 'Task not found' });
      if (t.status === 'pending' || t.status === 'running')
        return JSON.stringify({ status: t.status, message: 'Task not yet complete' });
      if (t.status === 'failed') return JSON.stringify({ status: 'failed', error: t.error });
      return JSON.stringify({ status: 'completed', result: t.result });
    }

    case 'codex_tasks_list': {
      const list = [...tasks.values()].map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        created_at: t.createdAt,
        completed_at: t.completedAt,
      }));
      return JSON.stringify({ tasks: list });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP stdio server ─────────────────────────────────────────────────────────

function mcpSend(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleMcp(msg) {
  if (msg.id === undefined || msg.id === null) return;

  switch (msg.method) {
    case 'initialize':
      mcpSend({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'codex', version: '1.0.0' },
        },
      });
      break;

    case 'ping':
      mcpSend({ jsonrpc: '2.0', id: msg.id, result: {} });
      break;

    case 'tools/list':
      mcpSend({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
      break;

    case 'resources/list':
      mcpSend({ jsonrpc: '2.0', id: msg.id, result: { resources: [] } });
      break;

    case 'prompts/list':
      mcpSend({ jsonrpc: '2.0', id: msg.id, result: { prompts: [] } });
      break;

    case 'tools/call': {
      const { name, arguments: toolArgs } = msg.params;
      try {
        const text = await callTool(name, toolArgs || {});
        mcpSend({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text }] },
        });
      } catch (err) {
        mcpSend({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          },
        });
      }
      break;
    }

    default:
      mcpSend({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: 'Method not found' },
      });
  }
}

process.stdin.setEncoding('utf8');
const mcpRl = readline.createInterface({ input: process.stdin });
mcpRl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  await handleMcp(msg);
});
