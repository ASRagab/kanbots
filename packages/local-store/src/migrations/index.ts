import { migration as m0001 } from './0001-initial.js';
import { migration as m0002 } from './0002-agent-session.js';
import { migration as m0003 } from './0003-local-issues.js';
import { migration as m0004 } from './0004-agent-model.js';
import { migration as m0005 } from './0005-workspaces-folders.js';
import { migration as m0006 } from './0006-agent-cost.js';
import { migration as m0007 } from './0007-agent-checks.js';
import { migration as m0008 } from './0008-agent-preview.js';
import { migration as m0009 } from './0009-autopilot-sessions.js';
import { migration as m0010 } from './0010-sentry.js';
import type { Migration } from './types.js';

export const migrations: readonly Migration[] = [
  m0001,
  m0002,
  m0003,
  m0004,
  m0005,
  m0006,
  m0007,
  m0008,
  m0009,
  m0010,
];

export type { Migration };
