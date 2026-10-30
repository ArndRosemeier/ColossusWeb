// Frozen full source trees: isolate each controller and all of its relative imports.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(process.env.AI_PROJECT || '.');
const snapshots = [
  ['ai-baseline-1c39d62', '1c39d623dbe6beeb024e806af30b7a85026ee936'],
  ['ai-normal-67bc', '67bc699e4a6f4250abfa4b437b952115a60c2e26'],
];
for (const [name, commit] of snapshots) {
  const dest = path.join(root, '.gate-logs', name);
  assert.ok(!fs.existsSync(dest), `Snapshot already exists: ${dest}; preserve it or choose a fresh checkout`);
  assert.equal(execFileSync('git', ['rev-parse', `${commit}^{commit}`], { cwd: root, encoding: 'utf8' }).trim(), commit);
  fs.mkdirSync(dest, { recursive: true });
  const archive = path.join(dest, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, commit, 'web/src'], { cwd: root });
  execFileSync('tar', ['-xf', 'source.tar'], { cwd: dest });
  fs.renameSync(path.join(dest, 'web', 'src'), path.join(dest, 'src'));
  fs.rmdirSync(path.join(dest, 'web'));
  fs.unlinkSync(archive);
  fs.writeFileSync(path.join(dest, 'commit.txt'), commit + '\n');
  console.log(`${name}: ${commit}`);
}
