import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const roots: string[] = [];
const zero = '0'.repeat(40);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ai-usage-gate-test-'));
  roots.push(root);
  const runGit = (args: string[], input?: string | Buffer) => {
    const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-c', 'user.name=Synthetic QA', '-c', 'user.email=qa@example.invalid', ...args], { cwd: root, encoding: 'utf8', input, windowsHide: true });
    if (result.status !== 0) throw new Error('Synthetic Git fixture could not be prepared.');
    return result.stdout.trim();
  };
  runGit(['init', '--quiet']);
  const add = (path: string, value = 'Synthetic source fixture only.') => {
    const object = runGit(['hash-object', '-w', '--stdin'], value);
    runGit(['update-index', '--add', '--cacheinfo', `100644,${object},${path}`]);
  };
  const commit = (parent?: string) => runGit(['commit-tree', runGit(['write-tree']), ...(parent ? ['-p', parent] : []), '-m', 'Synthetic privacy fixture']);
  const gate = (args: string[] = [], input = '') => spawnSync(process.execPath, [join(project, 'scripts', 'privacy-gate.mjs'), ...args], { cwd: root, encoding: 'utf8', input, windowsHide: true });
  return { root, runGit, add, commit, gate };
}
function ref(local: string, remote = zero, name = 'main') { return `refs/heads/${name} ${local} refs/heads/${name} ${remote}\n`; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Publication Privacy Gate', () => {
  it('accepts source and blocks private paths and binary content in the exact staged index', () => {
    const f = fixture(); f.add('source.txt');
    expect(f.gate().status).toBe(0);
    f.add('local/quota.json', '{"syntheticQuota":42}');
    expect(f.gate().status).toBe(1);
    f.runGit(['update-index', '--force-remove', 'local/quota.json']);
    f.add('synthetic.bin', 'a\0b');
    expect(f.gate().status).toBe(1);
  });
  it('blocks a removed private file in outgoing history even when the index and tip are clean', () => {
    const f = fixture(); f.add('source.txt'); f.add('local/quota.json', '{"syntheticQuota":42}');
    const privateCommit = f.commit();
    f.runGit(['update-index', '--force-remove', 'local/quota.json']);
    const cleanTip = f.commit(privateCommit);
    expect(f.gate(['--tracked']).status).toBe(0);
    const result = f.gate(['--push'], ref(cleanTip));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('local/quota.json');
    expect(result.stderr).not.toContain('syntheticQuota');
  });
  it('scans every outgoing commit and every updated ref without depending on index contents', () => {
    const f = fixture(); f.add('source.txt'); const remote = f.commit();
    f.add('out/capture.bin', 'synthetic account screenshot'); const privateCommit = f.commit(remote);
    f.runGit(['update-index', '--force-remove', 'out/capture.bin']); const cleanTip = f.commit(privateCommit);
    expect(f.gate(['--push'], ref(remote, remote, 'unchanged') + ref(cleanTip, remote, 'changed')).status).toBe(1);
    expect(f.gate(['--push'], ref(remote, remote)).status).toBe(0);
  });
  it('scans original ancestor commits even when local replacement refs show a clean tree', () => {
    const f = fixture(); f.add('source.txt'); const clean = f.commit();
    f.add('local/quota.json', 'Synthetic forbidden fixture.'); const unsafe = f.commit(clean);
    f.runGit(['update-index', '--force-remove', 'local/quota.json']); const tip = f.commit(unsafe);
    f.runGit(['replace', unsafe, clean]);
    const result = f.gate(['--push'], ref(tip));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('local/quota.json');
    expect(result.stderr).not.toContain('Synthetic forbidden fixture.');
  });
  it('inspects original blob bytes when a replacement blob would hide binary content', () => {
    const f = fixture(); f.add('source.txt'); const clean = f.commit();
    const binary = f.runGit(['hash-object', '-w', '--stdin'], 'a\0b');
    f.runGit(['update-index', '--add', '--cacheinfo', `100644,${binary},synthetic.bin`]);
    const tip = f.commit(clean);
    const text = f.runGit(['hash-object', '-w', '--stdin'], 'Synthetic text replacement.');
    f.runGit(['replace', binary, text]);
    const result = f.gate(['--push'], ref(tip));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('binary files require a separate privacy review.');
  });
  it('blocks an old binary, scans all history if the remote object is absent, and skips deleted refs', () => {
    const f = fixture(); f.add('source.txt'); const initial = f.commit();
    f.add('image.bin', 'a\0b'); const binary = f.commit(initial);
    f.runGit(['update-index', '--force-remove', 'image.bin']); const tip = f.commit(binary);
    expect(f.gate(['--push'], ref(tip, initial)).status).toBe(1);
    expect(f.gate(['--push'], ref(tip, '1'.repeat(40))).status).toBe(1);
    expect(f.gate(['--push'], ref(zero, tip)).status).toBe(0);
    expect(f.gate(['--push'], 'malformed push metadata').status).toBe(1);
  });
  it('replays every original push ref and hook argument to the global scanner', () => {
    const f = fixture(); f.add('source.txt'); const tip = f.commit();
    mkdirSync(join(f.root, 'scripts'));
    mkdirSync(join(f.root, 'global-hooks'));
    copyFileSync(join(project, 'scripts', 'privacy-gate.mjs'), join(f.root, 'scripts', 'privacy-gate.mjs'));
    const captured = join(f.root, 'captured-refs.txt').replaceAll('\\', '/');
    const argumentsPath = join(f.root, 'captured-args.txt').replaceAll('\\', '/');
    const environmentPath = join(f.root, 'captured-environment.txt').replaceAll('\\', '/');
    writeFileSync(join(f.root, 'global-hooks', 'pre-push'), '#!/bin/sh\ncat > "$QA_CAPTURE_REFS"\nprintf "%s\\n" "$@" > "$QA_CAPTURE_ARGS"\nprintf "%s\\n" "$GIT_NO_REPLACE_OBJECTS" > "$QA_CAPTURE_ENV"\n');
    const globalConfig = join(f.root, 'global.gitconfig');
    writeFileSync(globalConfig, `[core]\n  hooksPath = "${join(f.root, 'global-hooks').replaceAll('\\', '/')}"\n`);
    const input = ref(tip, zero, 'first') + ref(zero, tip, 'deleted');
    const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/sh.exe' : '/bin/sh';
    const result = spawnSync(shell, [join(project, '.githooks', 'pre-push'), 'origin', 'https://example.invalid/synthetic.git'], {
      cwd: f.root, encoding: 'utf8', input, windowsHide: true,
      env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', QA_CAPTURE_REFS: captured, QA_CAPTURE_ARGS: argumentsPath, QA_CAPTURE_ENV: environmentPath },
    });
    expect(result.status).toBe(0);
    expect(readFileSync(captured, 'utf8')).toBe(input);
    expect(readFileSync(argumentsPath, 'utf8')).toBe('origin\nhttps://example.invalid/synthetic.git\n');
    expect(readFileSync(environmentPath, 'utf8')).toBe('1\n');
  });
});
