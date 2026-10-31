import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function getFilesRecursively(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Action Layer Clock Protection & Test Isolation (R26)', () => {
  it('asserts that app routes and server actions never reference asOfDate or auditAt', () => {
    const appDir = path.resolve(process.cwd(), 'app');
    const files = getFilesRecursively(appDir);
    expect(files.length).toBeGreaterThan(0);

    const violatingFiles: { file: string; line: number; content: string }[] = [];
    const pattern = /\b(asOfDate|auditAt)\b/;

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          violatingFiles.push({
            file: path.relative(process.cwd(), file),
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    expect(violatingFiles).toEqual([]);
  });

  it('R26: asserts that app routes and server actions never reference BillingTestOptions or test hooks', () => {
    const appDir = path.resolve(process.cwd(), 'app');
    const files = getFilesRecursively(appDir);
    expect(files.length).toBeGreaterThan(0);

    const violatingFiles: { file: string; line: number; content: string }[] = [];
    const testPattern = /\b(faultInjection|throwAtPeriodIndex|throwAfterDiscountIncrement|allowRepair|onTryIncrementReady)\b/;

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (testPattern.test(line)) {
          violatingFiles.push({
            file: path.relative(process.cwd(), file),
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    expect(violatingFiles).toEqual([]);
  });
});
