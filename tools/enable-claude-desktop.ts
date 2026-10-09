import { mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeConnector } from '../server/connectors/claude.ts';
import { atomicJson } from './claude-statusline-bridge.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Restore the old terminal wrapper before switching sources, respecting later edits.
try { await new ClaudeConnector(root).disconnect(); }
catch (error) { if ((error as { code?: string }).code !== 'CLAUDE_SETTINGS_CHANGED') throw new Error('Could not safely restore the terminal bridge. Check its settings before retrying.'); }
await mkdir(join(root, 'local'), { recursive: true });
await atomicJson(join(root, 'local', 'claude-desktop-installed.json'), { version: 1 });
console.log('Claude Desktop bridge selected. Open a new local Code session to load the installed mod.');
