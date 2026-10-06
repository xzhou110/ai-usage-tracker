import type { Connectors } from '../../shared/schema.ts';
import { ClaudeConnector } from './claude.ts';
import { CodexConnector } from './codex.ts';
import { CursorConnector } from './cursor.ts';
export { ConnectorError } from './errors.ts';

export function createConnectors(root: string): Connectors {
  return { claude: new ClaudeConnector(root), codex: new CodexConnector(), cursor: new CursorConnector(root) };
}
