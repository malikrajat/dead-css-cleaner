#!/usr/bin/env node
/**
 * Verifies the reusable branch guard (`.github/workflows/branch-guard.yml`)
 * end to end, without touching this repository.
 *
 * It extracts the guard's shell script, builds a throwaway git repository with a
 * `main` branch and a `feature` branch (each with its own tag), and runs the
 * script four times to prove that:
 *
 *   1. a push to main is allowed
 *   2. a push to another branch is blocked
 *   3. a tag on main is allowed
 *   4. a tag on another branch is blocked
 *
 * Run it after changing the allowed branch to confirm the rule still behaves:
 *   npm run verify:guard
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const guardFile = path.join(root, '.github/workflows/branch-guard.yml');

let yaml;
try {
    yaml = require('js-yaml');
} catch {
    console.error('js-yaml is required for this check. Run `npm install` first.');
    process.exit(1);
}

function findBash() {
    const candidates =
        process.platform === 'win32'
            ? [
                  'C:\\Program Files\\Git\\bin\\bash.exe',
                  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
                  'bash.exe',
                  'bash',
              ]
            : ['/bin/bash', 'bash'];

    for (const candidate of candidates) {
        try {
            execFileSync(candidate, ['-c', 'exit 0'], { stdio: 'ignore' });
            return candidate;
        } catch {
            /* try the next candidate */
        }
    }
    return undefined;
}

function extractGuardScript() {
    if (!fs.existsSync(guardFile)) {
        console.error(`Guard workflow not found: ${guardFile}`);
        process.exit(1);
    }
    const workflow = yaml.load(fs.readFileSync(guardFile, 'utf8'));
    const steps = workflow?.jobs?.guard?.steps ?? [];
    const check = steps.find((step) => step && typeof step.run === 'string' && step.run.includes('ALLOWED_BRANCH'));
    if (!check) {
        console.error('Could not find the guard shell script in branch-guard.yml.');
        process.exit(1);
    }
    return check.run;
}

function git(directory, args, extraConfig = []) {
    return execFileSync('git', ['-C', directory, ...extraConfig, ...args], { encoding: 'utf8' }).trim();
}

function runScenario(bash, scriptPath, repository, scenario) {
    const outputFile = path.join(repository, '.github-output');
    try {
        const stdout = execFileSync(bash, [scriptPath], {
            cwd: repository,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PATH: process.env.PATH,
                GITHUB_WORKFLOW: 'Branch guard self-test',
                GITHUB_REF_TYPE: scenario.refType,
                GITHUB_REF_NAME: scenario.refName,
                GITHUB_SHA: scenario.sha,
                GITHUB_OUTPUT: outputFile,
                ALLOWED_BRANCH: scenario.allowedBranch ?? 'main',
            },
        });
        return { allowed: true, output: stdout.trim() };
    } catch (error) {
        const stderr = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
        return { allowed: false, output: stderr };
    }
}

/** `git merge-base --is-ancestor` as a boolean. */
function isAncestorOf(directory, sha, ref) {
    try {
        execFileSync('git', ['-C', directory, 'fetch', '--no-tags', 'origin', `+refs/heads/main:${ref}`], {
            stdio: 'ignore',
        });
    } catch {
        /* the local remote is the repository itself, so this normally succeeds */
    }
    try {
        execFileSync('git', ['-C', directory, 'merge-base', '--is-ancestor', sha, ref], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function main() {
    const script = extractGuardScript();
    console.log(`Branch guard verification (branch-guard.yml, ${script.split('\n').length} lines of shell)\n`);

    if (!canSpawnGit()) {
        console.warn(
            '  [skip] This environment does not allow spawning git/bash, so the guard was extracted but not executed.\n' +
                '         Run `npm run verify:guard` in a normal shell (or in CI on ubuntu-latest) to execute it.',
        );
        return;
    }

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-css-guard-'));
    const repository = path.join(workspace, 'repo');
    const scriptPath = path.join(workspace, 'guard.sh');
    fs.writeFileSync(scriptPath, `${script}\n`, 'utf8');
    fs.mkdirSync(repository);

    try {
        const identity = ['-c', 'user.email=guard@example.com', '-c', 'user.name=Guard Test'];
        // `git -C <dir>` needs the repository to exist first.
        execFileSync('git', ['init', '--quiet', '--initial-branch=main', repository], { stdio: 'ignore' });
        fs.writeFileSync(path.join(repository, 'file.txt'), 'main\n', 'utf8');
        git(repository, ['add', '.']);
        git(repository, ['commit', '--quiet', '-m', 'main commit'], identity);
        const mainSha = git(repository, ['rev-parse', 'HEAD']);

        git(repository, ['checkout', '--quiet', '-b', 'feature']);
        fs.writeFileSync(path.join(repository, 'file.txt'), 'feature\n', 'utf8');
        git(repository, ['add', '.']);
        git(repository, ['commit', '--quiet', '-m', 'feature commit'], identity);
        const featureSha = git(repository, ['rev-parse', 'HEAD']);

        // A local `origin` so `git fetch origin main` works inside the guard.
        git(repository, ['remote', 'add', 'origin', repository]);
        git(repository, ['tag', 'v-main', mainSha]);
        git(repository, ['tag', 'v-feature', featureSha]);
        git(repository, ['checkout', '--quiet', 'main']);

        // The primitive behind the tag rule: a tag on main is an ancestor of
        // origin/main, a tag on a side branch is not. This runs everywhere git
        // is available, even when bash is not.
        const ancestryChecks = [
            { name: 'commit on main is an ancestor of origin/main', sha: mainSha, expect: true },
            { name: 'commit on a side branch is not', sha: featureSha, expect: false },
        ];

        let failures = 0;
        ancestryChecks.forEach((check) => {
            const isAncestor = isAncestorOf(repository, check.sha, 'refs/remotes/origin/main');
            const ok = isAncestor === check.expect;
            if (!ok) {
                failures++;
            }
            console.log(`  ${ok ? '[ok]  ' : '[FAIL]'} ${check.name.padEnd(45)} -> ${isAncestor ? 'yes' : 'no'}`);
        });

        const bash = findBash();
        if (!bash) {
            console.warn(
                '\n  [skip] No usable bash shell in this environment, so the guard script itself was extracted\n' +
                    '         (see above) but not executed. It runs on Linux/macOS and on Windows with Git Bash;\n' +
                    '         CI on ubuntu-latest always executes it.',
            );
            if (failures > 0) {
                process.exitCode = 1;
            }
            return;
        }

        const scenarios = [
            { name: 'push to main', refType: 'branch', refName: 'main', sha: mainSha, expect: true },
            { name: 'push to feature branch', refType: 'branch', refName: 'feature', sha: featureSha, expect: false },
            { name: 'tag created on main', refType: 'tag', refName: 'v-main', sha: mainSha, expect: true },
            {
                name: 'tag created on a side branch',
                refType: 'tag',
                refName: 'v-feature',
                sha: featureSha,
                expect: false,
            },
        ];

        scenarios.forEach((scenario) => {
            const result = runScenario(bash, scriptPath, repository, scenario);
            const ok = result.allowed === scenario.expect;
            if (!ok) {
                failures++;
            }
            const verdict = result.allowed ? 'allowed' : 'blocked';
            console.log(
                `  ${ok ? '[ok]  ' : '[FAIL]'} ${scenario.name.padEnd(30)} -> ${verdict} (expected ${
                    scenario.expect ? 'allowed' : 'blocked'
                })`,
            );
            if (!ok || process.env.GUARD_VERBOSE === '1') {
                console.log(`         ${result.output.split('\n')[0]}`);
            }
        });

        console.log(`\n  ${failures} failure(s)`);
        if (failures > 0) {
            process.exitCode = 1;
        }
    } catch (error) {
        if (isSpawnBlocked(error)) {
            console.warn(
                '  [skip] This environment blocked spawning git, so the guard could not be executed here.\n' +
                    '         Run `npm run verify:guard` in a normal shell (or in CI on ubuntu-latest) to execute it.',
            );
        } else {
            throw error;
        }
    } finally {
        const tempRoot = os.tmpdir();
        if (path.resolve(workspace).startsWith(path.resolve(tempRoot))) {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    }
}

/** Spawning git is blocked in some restricted sandboxes; skip instead of crashing. */
function canSpawnGit() {
    try {
        execFileSync('git', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function isSpawnBlocked(error) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    return code === 'EPERM' || code === 'EACCES' || code === 'ENOENT';
}

main();
