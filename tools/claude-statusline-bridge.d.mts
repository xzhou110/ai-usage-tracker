import type { QuotaWindow } from '../shared/schema.ts';
export function projectClaudeInput(input: unknown): QuotaWindow[] | null;
export function writeClaudeProjection(root: string, input: unknown, now?: string): Promise<{ changed: boolean; written: boolean }>;
export function readSmallJson(path: string, maxBytes?: number): Promise<unknown>;
export function atomicJson(path: string, value: unknown): Promise<void>;
export function resolveNativeShell(): Promise<{kind: 'posix' | 'powershell'; path: string}>;
export function quoteNativeArgument(value: string, shellKind: string): string;
