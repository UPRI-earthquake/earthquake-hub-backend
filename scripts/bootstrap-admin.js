#!/usr/bin/env node
require('dotenv/config');
const { execFileSync } = require('child_process');
const { createInterface } = require('readline/promises');
const mongoose = require('mongoose');
const mongodb = require('../src/services/mongodb.service');
const { bootstrapFirstAdmin } = require('../src/services/adminBootstrap.service');

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function readPasswordFromStdin() {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value.replace(/[\r\n]+$/, '');
}

async function promptHidden(label) {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive password entry requires a TTY; use --password-stdin with a protected file.');
  }
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write(label);
  try {
    execFileSync('stty', ['-echo'], { stdio: ['inherit', 'ignore', 'inherit'] });
    return await readline.question('');
  } finally {
    try {
      execFileSync('stty', ['echo'], { stdio: ['inherit', 'ignore', 'inherit'] });
    } catch (_) {}
    process.stderr.write('\n');
    readline.close();
  }
}

async function readPassword() {
  if (process.argv.includes('--password-stdin')) return readPasswordFromStdin();
  const password = await promptHidden('Admin password: ');
  const confirmation = await promptHidden('Confirm password: ');
  if (password !== confirmation) throw new Error('Password confirmation did not match.');
  return password;
}

async function main() {
  const username = argumentValue('username');
  const email = argumentValue('email');
  if (!username || !email) {
    throw new Error(
      'Usage: npm run admin:bootstrap -- --username=<name> --email=<address> [--password-stdin]',
    );
  }

  const password = await readPassword();
  await mongodb.connect();
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB connection is unavailable.');

  const account = await bootstrapFirstAdmin({ username, email, password });
  process.stdout.write(
    `Created first admin account ${account.username} (${account.email}); accountId=${account.accountId}\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`Admin bootstrap failed [${error.code || error.name || 'ERROR'}]: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
