import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const forbiddenPath = path => /^(local|private|out|dist|node_modules)\//i.test(path) || /(^|\/)(\.env(?:\..*)?|server\.lock)$/i.test(path);
const zeros = /^0+$/;
const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

// Never relay Git output on an error: it may contain a private blob. Blob checks
// stream their bytes instead of imposing a size cap or buffering private content.
function git(args, inspect) {
  return new Promise((resolve, reject) => {
    // Replacement refs alter local inspection, but pushes transfer original objects.
    const child = spawn('git', ['--no-replace-objects', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    child.stdout.on('data', chunk => { if (inspect) inspect(chunk); else chunks.push(chunk); });
    child.once('error', () => reject(new Error('Git could not inspect the proposed publication.')));
    child.once('close', code => code === 0 ? resolve(inspect ? null : Buffer.concat(chunks).toString('utf8')) : reject(new Error('Git could not inspect the proposed publication.')));
  });
}

async function main() {
  let blocked = false;
  const checkedBlobs = new Map();
  const reported = new Set();
  const hold = (path, reason, commit) => {
    const key = `${path}:${reason}`;
    if (reported.has(key)) return;
    reported.add(key);
    console.error(`HOLD ${JSON.stringify(path)}${commit ? ` in commit ${commit.slice(0, 12)}` : ''}: ${reason}`);
    blocked = true;
  };
  const check = async (path, object, type, commit) => {
    if (forbiddenPath(path)) { hold(path, 'private/runtime path is not publishable.', commit); return; }
    if (type !== 'blob') return;
    if (!checkedBlobs.has(object)) {
      let binary = false;
      await git(['cat-file', 'blob', object], chunk => { if (chunk.includes(0)) binary = true; });
      checkedBlobs.set(object, binary);
    }
    if (checkedBlobs.get(object)) hold(path, 'binary files require a separate privacy review.', commit);
  };

  if (process.argv.includes('--push')) {
    const commits = new Set();
    const input = readFileSync(0, 'utf8');
    for (const line of input.split(/\r?\n/).filter(line => line.trim())) {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4 || !sha.test(fields[1]) || !sha.test(fields[3])) throw new Error('Push references could not be validated.');
      const [, localSha, , remoteSha] = fields;
      if (zeros.test(localSha)) continue; // A deleted ref publishes no objects.
      const revisions = [localSha];
      if (!zeros.test(remoteSha)) {
        // A new branch, or an unavailable remote object, gets a conservative
        // complete-history scan. Never trust the working tree or index at push.
        try { await git(['cat-file', '-e', `${remoteSha}^{commit}`]); revisions.push(`^${remoteSha}`); } catch { /* Scan all local history. */ }
      }
      const outgoing = await git(['rev-list', ...revisions]);
      for (const commit of outgoing.trim().split(/\r?\n/).filter(Boolean)) commits.add(commit);
    }
    for (const commit of commits) {
      const tree = await git(['ls-tree', '-r', '-z', '--full-tree', commit]);
      for (const entry of tree.split('\0').filter(Boolean)) {
        const tab = entry.indexOf('\t');
        const [, type, object] = entry.slice(0, tab).split(' ');
        await check(entry.slice(tab + 1), object, type, commit);
      }
    }
  } else {
    const selected = process.argv.includes('--tracked') ? null : new Set((await git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])).split('\0').filter(Boolean));
    const entries = await git(['ls-files', '--stage', '-z']);
    for (const entry of entries.split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      const path = entry.slice(tab + 1);
      if (selected && !selected.has(path)) continue;
      const [mode, object, stage] = entry.slice(0, tab).split(' ');
      if (stage !== '0') throw new Error('Unmerged index entries cannot be published.');
      await check(path, object, mode === '160000' ? 'commit' : 'blob');
    }
  }
  if (blocked) process.exitCode = 1;
  else console.log('Privacy gate passed: proposed source and documentation exclude private runtime paths and unreviewed binaries.');
}

main().catch(() => {
  console.error('HOLD: Git publication metadata could not be inspected safely. No private content was printed.');
  process.exitCode = 1;
});
