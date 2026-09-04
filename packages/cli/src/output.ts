/**
 * Terminal output.
 *
 * Colour only when the stream is a TTY, so piping into a file or a CI log
 * produces text rather than escape codes.
 */

const CSI = '\u001b[';
const RESET = `${CSI}0m`;

const useColor = Boolean(process.stdout.isTTY) && process.env['NO_COLOR'] === undefined;

const wrap = (code: string) => (text: string) =>
  useColor ? `${CSI}${code}m${text}${RESET}` : text;

export const dim = wrap('2');
export const bold = wrap('1');
export const green = wrap('32');
export const red = wrap('31');
export const yellow = wrap('33');
export const cyan = wrap('36');

export const PASS = green('✓');
export const FAIL = red('✗');
export const WARN = yellow('!');

export function heading(text: string): void {
  process.stdout.write(`\n${bold(text)}\n`);
}

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function errorLine(text: string): void {
  process.stderr.write(`${text}\n`);
}

/** A simple left-aligned table. Wide values are not truncated — they matter. */
export function table(rows: ReadonlyArray<readonly string[]>): void {
  if (rows.length === 0) return;

  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }

  for (const [index, row] of rows.entries()) {
    const rendered = row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join('  ');
    line(index === 0 ? dim(rendered) : rendered);
  }
}
