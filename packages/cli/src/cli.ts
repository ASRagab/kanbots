#!/usr/bin/env node
import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };

export const program = new Command();
program.name('kanbots').version(pkg.version);

if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse(process.argv);
}
