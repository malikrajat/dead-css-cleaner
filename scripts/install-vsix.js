#!/usr/bin/env node
/**
 * Installs the most recently built .vsix into VS Code.
 *
 * Usage: npm run install:vsix
 *
 * Run `npm run package:vsix` first to produce the file. The VS Code CLI must be
 * on PATH (Command Palette: "Shell Command: Install 'code' command in PATH").
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

const vsixFiles = fs
    .readdirSync(root)
    .filter((file) => file.endsWith('.vsix'))
    .map((file) => ({
        file,
        modified: fs.statSync(path.join(root, file)).mtimeMs,
    }))
    .sort((a, b) => b.modified - a.modified);

if (vsixFiles.length === 0) {
    console.error('No .vsix file found. Run "npm run package:vsix" first.');
    process.exit(1);
}

const vsix = path.join(root, vsixFiles[0].file);
const command = process.platform === 'win32' ? 'code.cmd' : 'code';

try {
    // The project path can contain spaces, and `shell: true` passes arguments
    // through unescaped, so the VSIX path is quoted explicitly.
    execFileSync(command, ['--install-extension', `"${vsix}"`, '--force'], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
} catch (error) {
    console.error(`Could not install "${vsixFiles[0].file}" with the VS Code CLI ("${command}").`);
    console.error('Make sure VS Code is installed and "code" is on PATH:');
    console.error('  Command Palette -> "Shell Command: Install \'code\' command in PATH"');
    if (error?.message) {
        console.error(error.message);
    }
    process.exit(1);
}
