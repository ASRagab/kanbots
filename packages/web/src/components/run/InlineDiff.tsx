// Compact unified diff renderer for the agent thread. Mirrors the look of
// claude-code's StructuredDiffList: line numbers in a dim gutter, additions on
// green, deletions on red, no surrounding chrome.

import { useMemo } from 'react';

interface InlineDiffProps {
  oldString: string;
  newString: string;
  // Number of unchanged lines to keep around each change, like CONTEXT_LINES
  // in claude-code's diff util.
  context?: number;
}

interface DiffRow {
  kind: 'context' | 'add' | 'del' | 'hunk';
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export function InlineDiff({ oldString, newString, context = 3 }: InlineDiffProps) {
  const rows = useMemo(
    () => buildDiffRows(oldString, newString, context),
    [oldString, newString, context],
  );

  if (rows.length === 0) return null;

  const oldGutter = Math.max(2, String(rows.at(-1)?.oldLine ?? 0).length);
  const newGutter = Math.max(2, String(rows.at(-1)?.newLine ?? 0).length);

  return (
    <div className="kb-idiff">
      {rows.map((r, i) => (
        <div key={i} className={`kb-idiff-line ${r.kind}`}>
          <span className="kb-idiff-num" aria-hidden>
            {r.oldLine !== null ? String(r.oldLine).padStart(oldGutter, ' ') : ' '.repeat(oldGutter)}
          </span>
          <span className="kb-idiff-num" aria-hidden>
            {r.newLine !== null ? String(r.newLine).padStart(newGutter, ' ') : ' '.repeat(newGutter)}
          </span>
          <span className="kb-idiff-sign" aria-hidden>
            {r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}
          </span>
          <span className="kb-idiff-text">{r.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}

// Compact LCS-based line diff. The agent inputs are typically a few-line
// snippet for Edit and a whole file for Write — both stay well under the
// O(n*m) memory we use here.
function buildDiffRows(oldStr: string, newStr: string, context: number): DiffRow[] {
  const oldLines = oldStr === '' ? [] : oldStr.split('\n');
  const newLines = newStr === '' ? [] : newStr.split('\n');

  // Trailing-newline split produces a trailing '' which we drop — diff renders
  // "no newline at end of file" implicitly.
  const trimmedOld =
    oldLines.length > 0 && oldLines.at(-1) === '' ? oldLines.slice(0, -1) : oldLines;
  const trimmedNew =
    newLines.length > 0 && newLines.at(-1) === '' ? newLines.slice(0, -1) : newLines;

  const ops = lcsDiff(trimmedOld, trimmedNew);

  // Collapse runs of unchanged lines beyond the context window into "hunk"
  // separators so large unchanged blocks don't dominate the diff card.
  const rows: DiffRow[] = [];
  let oldNum = 0;
  let newNum = 0;
  // Compute, for each op index, distance to nearest non-equal op so we can
  // decide which equal-runs to keep.
  const distanceToChange: number[] = new Array(ops.length).fill(Infinity);
  let last = -Infinity;
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]!.kind !== 'eq') last = i;
    distanceToChange[i] = i - last;
  }
  let next = Infinity;
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i]!.kind !== 'eq') next = i;
    distanceToChange[i] = Math.min(distanceToChange[i]!, next - i);
  }

  let pendingHunkBreak = false;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const showLine = op.kind !== 'eq' || distanceToChange[i]! <= context;
    if (op.kind === 'eq') {
      oldNum++;
      newNum++;
      if (!showLine) {
        pendingHunkBreak = true;
        continue;
      }
      if (pendingHunkBreak) {
        rows.push({ kind: 'hunk', oldLine: null, newLine: null, text: `@@ -${oldNum} +${newNum} @@` });
        pendingHunkBreak = false;
      }
      rows.push({ kind: 'context', oldLine: oldNum, newLine: newNum, text: op.text });
    } else if (op.kind === 'del') {
      if (pendingHunkBreak) {
        rows.push({ kind: 'hunk', oldLine: null, newLine: null, text: `@@ -${oldNum + 1} +${newNum + 1} @@` });
        pendingHunkBreak = false;
      }
      oldNum++;
      rows.push({ kind: 'del', oldLine: oldNum, newLine: null, text: op.text });
    } else {
      if (pendingHunkBreak) {
        rows.push({ kind: 'hunk', oldLine: null, newLine: null, text: `@@ -${oldNum + 1} +${newNum + 1} @@` });
        pendingHunkBreak = false;
      }
      newNum++;
      rows.push({ kind: 'add', oldLine: null, newLine: newNum, text: op.text });
    }
  }
  return rows;
}

interface DiffOp {
  kind: 'eq' | 'add' | 'del';
  text: string;
}

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // Simple O(n*m) DP — good enough for the snippets the agent edits at a time.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'eq', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: 'del', text: a[i]! });
      i++;
    } else {
      ops.push({ kind: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ kind: 'del', text: a[i++]! });
  while (j < m) ops.push({ kind: 'add', text: b[j++]! });
  return ops;
}
