#!/usr/bin/env node
/**
 * Pre-flight check for the VS Code Marketplace.
 *
 * `package.json` is the VS Code extension manifest (the equivalent of Chrome's
 * manifest.json). This script verifies the rules that vsce and the Marketplace
 * enforce or warn about, so a release never fails halfway through publishing.
 *
 * Usage: npm run verify:manifest
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * YAML parsing is used to inspect the workflow files. It is a dev dependency, so
 * the checks degrade to warnings when it is not installed (for example when the
 * script runs before `npm ci`).
 */
let yaml;
try {
    yaml = require('js-yaml');
} catch {
    yaml = undefined;
}

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'package.json');

let failures = 0;
let warnings = 0;

function pass(message) {
    console.log(`  [ok]   ${message}`);
}

function fail(message) {
    failures++;
    console.log(`  [FAIL] ${message}`);
}

function warn(message) {
    warnings++;
    console.log(`  [warn] ${message}`);
}

function exists(relativePath) {
    return fs.existsSync(path.join(root, relativePath));
}

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function section(title) {
    console.log(`\n${title}`);
}

function resolveString(value, nlsFile, key) {
    if (typeof value !== 'string') {
        return '';
    }
    const match = /^%(.+)%$/.exec(value);
    if (!match) {
        return value;
    }
    const resolved = nlsFile[match[1]];
    if (resolved === undefined) {
        fail(`"${key}" references %${match[1]}% which is not defined in package.nls.json`);
        return '';
    }
    return resolved;
}

function collectNlsKeys(value, keys = new Set()) {
    if (typeof value === 'string') {
        const match = /^%(.+)%$/.exec(value);
        if (match) {
            keys.add(match[1]);
        }
    } else if (Array.isArray(value)) {
        value.forEach((entry) => collectNlsKeys(entry, keys));
    } else if (value && typeof value === 'object') {
        Object.keys(value).forEach((key) => {
            if (key === '$schema') {
                return;
            }
            collectNlsKeys(value[key], keys);
        });
    }
    return [...keys];
}

if (!fs.existsSync(manifestPath)) {
    console.error('package.json not found.');
    process.exit(1);
}

let manifest;
try {
    manifest = readJson('package.json');
} catch (error) {
    console.error(`package.json is not valid JSON: ${error.message}`);
    process.exit(1);
}

const nls = exists('package.nls.json') ? readJson('package.nls.json') : {};

section('Manifest basics');

['name', 'displayName', 'description', 'version', 'publisher', 'engines', 'main', 'contributes'].forEach((field) => {
    if (manifest[field] === undefined) {
        fail(`missing required field "${field}"`);
    } else {
        pass(`"${field}" present`);
    }
});

if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(manifest.name ?? '')) {
    fail('"name" must be lowercase letters, digits and hyphens (max 50 characters)');
} else {
    pass(`"name" is marketplace-safe (${manifest.name})`);
}

if (/vscode|visualstudio|visual-studio/i.test(manifest.name ?? '')) {
    fail('"name" may not contain reserved words such as "vscode"');
}

if (!/^\d+\.\d+\.\d+/.test(manifest.version ?? '')) {
    fail('"version" must be semver (major.minor.patch)');
} else {
    pass(`"version" is semver (${manifest.version})`);
}

const displayName = resolveString(manifest.displayName, nls, 'displayName');
const description = resolveString(manifest.description, nls, 'description');

if (!displayName) {
    fail('"displayName" is empty');
} else if (displayName.length > 45) {
    warn(`"displayName" is ${displayName.length} characters; the Marketplace truncates around 45`);
} else {
    pass(`"displayName" length ok (${displayName.length} chars): ${displayName}`);
}

if (!description) {
    fail('"description" is empty');
} else if (description.length < 20) {
    warn('"description" is very short; it is used for search relevance');
} else if (description.length > 200) {
    warn(`"description" is ${description.length} characters; the Marketplace shows about 200`);
} else {
    pass(`"description" length ok (${description.length} chars)`);
}

if (!manifest.license) {
    fail('missing "license"');
} else if (!exists('LICENSE')) {
    fail('"license" is set but no LICENSE file exists at the repository root');
} else {
    pass(`license declared (${manifest.license}) with a LICENSE file`);
}

if (!exists('README.md')) {
    fail('README.md must exist at the repository root (it becomes the extension page)');
} else {
    pass('README.md present');
}

if (!exists('CHANGELOG.md')) {
    warn('CHANGELOG.md is recommended at the repository root');
} else {
    pass('CHANGELOG.md present');
}

section('Searchability (Marketplace ranking)');

const keywords = manifest.keywords ?? [];
if (!Array.isArray(keywords) || keywords.length === 0) {
    fail('"keywords" is required for the Marketplace and for search ranking');
} else if (keywords.length > 30) {
    fail(`"keywords" must contain at most 30 entries (found ${keywords.length})`);
} else {
    pass(`${keywords.length}/30 keywords declared`);
}

const duplicateKeywords = keywords.filter((keyword, index) => keywords.indexOf(keyword) !== index);
if (duplicateKeywords.length > 0) {
    fail(`duplicate keywords: ${[...new Set(duplicateKeywords)].join(', ')}`);
}

const longKeywords = keywords.filter((keyword) => keyword.length > 30);
if (longKeywords.length > 0) {
    warn(`keywords longer than 30 characters: ${longKeywords.join(', ')}`);
}

const ALLOWED_CATEGORIES = [
    'AI',
    'Azure',
    'Data Science',
    'Debuggers',
    'Education',
    'Extension Packs',
    'Formatters',
    'Keymaps',
    'Language Packs',
    'Linters',
    'Machine Learning',
    'Notebooks',
    'Other',
    'Programming Languages',
    'SCM Providers',
    'Snippets',
    'Testing',
    'Themes',
    'Visualization',
];

const categories = manifest.categories ?? [];
if (categories.length === 0) {
    fail('at least one "categories" entry is required');
} else {
    const invalid = categories.filter((category) => !ALLOWED_CATEGORIES.includes(category));
    if (invalid.length > 0) {
        fail(`invalid categories: ${invalid.join(', ')}`);
    } else {
        pass(`categories valid: ${categories.join(', ')}`);
    }
}

if (!manifest.repository || !/^https?:\/\//.test(manifest.repository.url ?? '')) {
    fail('"repository.url" is required by vsce');
} else {
    pass(`repository: ${manifest.repository.url}`);
}

['homepage', 'bugs', 'qna', 'sponsor'].forEach((field) => {
    if (!manifest[field]) {
        warn(`"${field}" not set (optional, but improves the Marketplace page)`);
    }
});

section('Assets');

if (!manifest.icon) {
    fail('"icon" is required for a polished Marketplace listing');
} else if (!exists(manifest.icon)) {
    fail(`icon file not found: ${manifest.icon}`);
} else {
    const buffer = fs.readFileSync(path.join(root, manifest.icon));
    const isPng = buffer.length > 24 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a';
    if (!isPng) {
        fail(`icon must be a PNG file: ${manifest.icon}`);
    } else {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        if (width < 128 || height < 128) {
            fail(`icon must be at least 128x128 (found ${width}x${height})`);
        } else {
            pass(`icon is ${width}x${height} PNG (${Math.round(buffer.length / 1024)} KB)`);
        }
        if (width !== height) {
            warn('icon is not square; the Marketplace scales it to a square thumbnail');
        }
        if (buffer.length > 1024 * 1024) {
            warn('icon is larger than 1 MB; consider compressing it');
        }
    }
}

section('Engines & capabilities');

const vscodeEngine = manifest.engines?.vscode;
if (!vscodeEngine) {
    fail('"engines.vscode" is required');
} else if (!/^\^\d+\.\d+\.\d+$/.test(vscodeEngine)) {
    warn(`"engines.vscode" should look like "^1.90.0" (found ${vscodeEngine})`);
} else {
    pass(`VS Code engine: ${vscodeEngine}`);
}

if (!manifest.engines?.node) {
    warn('"engines.node" not set');
} else {
    pass(`Node engine: ${manifest.engines.node}`);
}

if (!manifest.capabilities) {
    warn('"capabilities" not declared; users get the default workspace trust behaviour');
} else {
    if (manifest.capabilities.untrustedWorkspaces === undefined) {
        warn('"capabilities.untrustedWorkspaces" not declared');
    } else {
        pass('untrusted workspace behaviour declared');
    }
    if (manifest.capabilities.virtualWorkspaces === undefined) {
        warn('"capabilities.virtualWorkspaces" not declared');
    } else {
        pass('virtual workspace behaviour declared');
    }
}

section('Activation, commands & menus');

const activationEvents = manifest.activationEvents ?? [];
if (activationEvents.length === 0) {
    warn('no activationEvents: the extension only activates from contributed commands/languages');
} else {
    pass(`${activationEvents.length} activation event(s)`);
}

const commands = (manifest.contributes?.commands ?? []).map((command) => command.command);
const duplicateCommands = commands.filter((command, index) => commands.indexOf(command) !== index);
if (duplicateCommands.length > 0) {
    fail(`duplicate command ids: ${[...new Set(duplicateCommands)].join(', ')}`);
} else {
    pass(`${commands.length} command(s) contributed`);
}

const menuCommands = new Set();
Object.values(manifest.contributes?.menus ?? {}).forEach((entries) => {
    (entries ?? []).forEach((entry) => menuCommands.add(entry.command));
});
const unknownInMenus = [...menuCommands].filter((command) => !commands.includes(command));
if (unknownInMenus.length > 0) {
    fail(`menu entries reference unknown commands: ${unknownInMenus.join(', ')}`);
} else {
    pass('every menu entry points at a contributed command');
}

section('Views');

const viewIds = new Set();
Object.values(manifest.contributes?.views ?? {}).forEach((views) => {
    (views ?? []).forEach((view) => viewIds.add(view.id));
});
const containerIds = new Set((manifest.contributes?.viewsContainers?.activitybar ?? []).map((entry) => entry.id));

if (viewIds.size === 0) {
    warn('no views contributed');
} else {
    pass(`${viewIds.size} view(s) contributed: ${[...viewIds].join(', ')}`);
}

Object.entries(manifest.contributes?.views ?? {}).forEach(([container]) => {
    if (!containerIds.has(container)) {
        fail(`views are attached to unknown container "${container}"`);
    }
});

(manifest.contributes?.viewsContainers?.activitybar ?? []).forEach((entry) => {
    if (entry.icon && !exists(entry.icon)) {
        fail(`view container "${entry.id}" icon not found: ${entry.icon}`);
    } else {
        pass(`view container "${entry.id}" icon: ${entry.icon}`);
    }
});

Object.values(manifest.contributes?.menus ?? {}).forEach((entries) => {
    (entries ?? []).forEach((entry) => {
        const condition = typeof entry.when === 'string' ? entry.when : '';
        const referenced = [...condition.matchAll(/view\s*==\s*([A-Za-z0-9._-]+)/g)].map((match) => match[1]);
        referenced.forEach((id) => {
            if (!viewIds.has(id)) {
                fail(`menu entry references unknown view "${id}" (command: ${entry.command})`);
            }
        });
    });
});

if (viewIds.size > 0) {
    const referenced = new Set(
        Object.values(manifest.contributes?.menus ?? {})
            .flat()
            .flatMap((entry) =>
                [...String(entry.when ?? '').matchAll(/view\s*==\s*([A-Za-z0-9._-]+)/g)].map((m) => m[1]),
            ),
    );
    [...viewIds].forEach((id) => {
        if (!referenced.has(id)) {
            warn(`view "${id}" has no menu contributions`);
        }
    });
}

section('Walkthroughs & localisation');

const walkthroughs = manifest.contributes?.walkthroughs ?? [];
if (walkthroughs.length === 0) {
    warn('no walkthrough contributed');
}
walkthroughs.forEach((walkthrough) => {
    (walkthrough.steps ?? []).forEach((step) => {
        const markdown = step.media?.markdown ?? step.media?.image;
        if (!markdown) {
            fail(`walkthrough step "${step.id}" has no media`);
            return;
        }
        if (!exists(markdown)) {
            fail(`walkthrough media not found: ${markdown}`);
        } else {
            pass(`walkthrough step "${step.id}" media: ${markdown}`);
        }
    });
});

if (Object.keys(nls).length === 0) {
    warn('package.nls.json not found; manifest strings are not localisable');
} else {
    const usedKeys = collectNlsKeys(manifest);
    const missing = usedKeys.filter((key) => nls[key] === undefined);
    if (missing.length > 0) {
        fail(`package.nls.json is missing: ${missing.join(', ')}`);
    } else {
        pass(`all ${usedKeys.length} localisation keys resolve via package.nls.json`);
    }

    const unused = Object.keys(nls).filter((key) => !usedKeys.includes(key));
    if (unused.length > 0) {
        warn(`unused package.nls.json keys: ${unused.join(', ')}`);
    }
}

section('Packaging');

const mainEntry = typeof manifest.main === 'string' ? manifest.main.replace(/^\.\//, '') : '';
if (!mainEntry) {
    fail('"main" is missing from the manifest');
} else if (!exists(mainEntry)) {
    warn(`${mainEntry} not found - run "npm run build" before packaging`);
} else {
    pass(`entry point bundle exists (${mainEntry})`);
}

if (!exists('.vscodeignore')) {
    warn('.vscodeignore not found; the VSIX will include development files');
} else {
    const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
    const ignorePatterns = ignore
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
    [
        ['src/**', 'TypeScript sources'],
        ['node_modules/**', 'bundled dependencies'],
        ['test-files/**', 'test fixtures'],
        ['.github/**', 'CI configuration'],
    ].forEach(([pattern, label]) => {
        if (ignorePatterns.includes(pattern)) {
            pass(`${label} excluded (${pattern})`);
        } else {
            warn(`${label} not excluded in .vscodeignore (${pattern})`);
        }
    });

    if (mainEntry) {
        const bundleDirectory = posixDirname(mainEntry);
        const ignoredBundle = ignorePatterns.some((pattern) => {
            const normalized = pattern.replace(/\/\*\*$/, '');
            return (
                normalized === bundleDirectory ||
                normalized === mainEntry ||
                pattern === '**/*.js' ||
                pattern === '*.js'
            );
        });
        if (ignoredBundle) {
            fail(`the entry point bundle (${mainEntry}) would be excluded from the VSIX by .vscodeignore`);
        } else {
            pass(`entry point bundle is not excluded (${mainEntry})`);
        }
    }
}

function posixDirname(relativePath) {
    const index = relativePath.lastIndexOf('/');
    return index === -1 ? '.' : relativePath.slice(0, index);
}

/**
 * Workflows may only run from the allowed branch (default `main`) or from tags
 * that point at it, every workflow must call the reusable guard, and pull
 * requests must not trigger anything. See GITHUB-ACTIONS.md to change the rule.
 */
function checkWorkflowBranchPolicy(workflowFiles) {
    const GUARD_FILE = 'branch-guard.yml';
    const GUARD_CALL = './.github/workflows/branch-guard.yml';

    if (!yaml) {
        warn('js-yaml is not installed, so the workflow branch rules were not inspected (run npm install)');
        return;
    }

    const allowedBranch = readAllowedBranch(workflowFiles);

    pass(`branch guard allows '${allowedBranch}' (branch-guard.yml input default)`);

    workflowFiles.forEach((file) => {
        if (file === GUARD_FILE) {
            return;
        }

        const content = fs.readFileSync(path.join(workflowsDirectory, file), 'utf8');
        let workflow;
        try {
            workflow = yaml.load(content);
        } catch (error) {
            fail(`${file} is not valid YAML: ${error.message}`);
            return;
        }

        const triggers = normalizeTriggers(workflow);
        const startsOutsideMain = triggers.some(
            (trigger) => trigger !== 'push' && trigger !== 'schedule' && trigger !== 'workflow_dispatch',
        );
        if (startsOutsideMain) {
            fail(
                `${file} uses unsupported trigger(s): ${triggers
                    .filter((trigger) => !['push', 'schedule', 'workflow_dispatch'].includes(trigger))
                    .join(', ')} - pull requests are not allowed under the current policy (see GITHUB-ACTIONS.md)`,
            );
        }

        const pushBranches = readPushBranches(workflow);
        pushBranches.forEach((branch) => {
            if (branch !== allowedBranch) {
                fail(`${file} would run on branch "${branch}" but only "${allowedBranch}" is allowed`);
            }
        });

        const runsOnEvents = triggers.some((trigger) => ['push', 'schedule', 'workflow_dispatch'].includes(trigger));
        if (runsOnEvents && !content.includes(GUARD_CALL)) {
            fail(`${file} does not call the reusable branch guard (${GUARD_CALL})`);
        } else if (runsOnEvents) {
            pass(`${file}: triggers [${triggers.join(', ')}], guarded, push branches ${formatList(pushBranches)}`);
        }
    });

    const guardPath = path.join(workflowsDirectory, GUARD_FILE);
    if (!fs.existsSync(guardPath)) {
        fail(`${GUARD_FILE} is missing; every workflow depends on it`);
        return;
    }

    const guardContent = fs.readFileSync(guardPath, 'utf8');
    if (!guardContent.includes('merge-base --is-ancestor')) {
        fail(`${GUARD_FILE} no longer verifies that release tags point at '${allowedBranch}'`);
    } else {
        pass(`${GUARD_FILE}: verifies tags with \`git merge-base --is-ancestor\``);
    }

    [
        ['GITHUB_REF_TYPE', 'branches and tags are distinguished'],
        ['GITHUB_REF_NAME', 'the ref name is compared with the allowed branch'],
        ['GITHUB_OUTPUT', 'the guard still exports its result'],
        ['exit 1', 'blocked runs fail instead of silently continuing'],
    ].forEach(([needle, description]) => {
        if (!guardContent.includes(needle)) {
            fail(`${GUARD_FILE} is missing "${needle}" (${description})`);
        }
    });

    ['branch-guard.yml', 'ci.yml', 'release.yml', 'codeql.yml'].forEach((file) => {
        if (!workflowFiles.includes(file)) {
            warn(`expected workflow ${file} is missing`);
        }
    });
}

function readAllowedBranch(workflowFiles) {
    if (!workflowFiles.includes('branch-guard.yml')) {
        return 'main';
    }
    try {
        const guard = yaml.load(fs.readFileSync(path.join(workflowsDirectory, 'branch-guard.yml'), 'utf8'));
        const trigger = guard?.on ?? guard?.[true];
        const called = trigger?.workflow_call;
        const input = called?.inputs?.allowedBranch;
        return typeof input?.default === 'string' && input.default.length > 0 ? input.default : 'main';
    } catch {
        return 'main';
    }
}

function normalizeTriggers(workflow) {
    // `on:` may be parsed as the string "on" or (YAML 1.1) as boolean true.
    const raw = workflow?.on ?? workflow?.[true];
    if (!raw) {
        return [];
    }
    if (typeof raw === 'string') {
        return [raw];
    }
    if (Array.isArray(raw)) {
        return raw.map((entry) => String(entry));
    }
    return Object.keys(raw);
}

function readPushBranches(workflow) {
    const raw = workflow?.on ?? workflow?.[true];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return [];
    }
    const push = raw.push;
    if (!push || typeof push !== 'object' || Array.isArray(push)) {
        return [];
    }
    const branches = push.branches;
    if (Array.isArray(branches)) {
        return branches.map((branch) => String(branch));
    }
    return typeof branches === 'string' ? [branches] : [];
}

function formatList(values) {
    return values.length > 0 ? `[${values.join(', ')}]` : '(none)';
}

section('Workflows (branch rules and nothing stored)');

const workflowsDirectory = path.join(root, '.github/workflows');
if (!fs.existsSync(workflowsDirectory)) {
    warn('no .github/workflows directory found');
} else {
    const workflowFiles = fs
        .readdirSync(workflowsDirectory)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));
    const offendingActions = ['actions/upload-artifact', 'actions/download-artifact'];
    let violations = 0;

    workflowFiles.forEach((file) => {
        const content = fs.readFileSync(path.join(workflowsDirectory, file), 'utf8');
        const found = offendingActions.filter((action) => content.includes(action));
        if (found.length > 0) {
            violations++;
            fail(`${file} would store artifacts (${found.join(', ')}); this repository must not store any`);
        }
    });

    if (violations === 0) {
        pass(`${workflowFiles.length} workflow(s) checked: no artifact upload or download steps`);
    }

    checkWorkflowBranchPolicy(workflowFiles);
}

section('Summary');
console.log(`  ${failures} failure(s), ${warnings} warning(s)`);

if (failures > 0) {
    process.exitCode = 1;
}
