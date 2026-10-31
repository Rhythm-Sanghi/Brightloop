import { describe, it, expect, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { createDiscount, updateDiscount } from '../discounts';
import { parseBusinessDate } from '../../dates/business-date';

describe('Discount Validation and Scope Change Protection', () => {
  it('rejects zero or negative discount values at creation', async () => {
    await expect(
      createDiscount({
        name: 'Zero discount',
        kind: 'FIXED',
        value: '0.00',
        scope: 'PRODUCT',
        startsOn: parseBusinessDate('2026-01-01'),
      })
    ).rejects.toThrow(/greater than zero/);

    await expect(
      createDiscount({
        name: 'Negative discount',
        kind: 'PERCENT',
        value: '-10.00',
        scope: 'PRODUCT',
        startsOn: parseBusinessDate('2026-01-01'),
      })
    ).rejects.toThrow(/greater than zero/);

    await expect(
      createDiscount({
        name: 'Excessive percent discount',
        kind: 'PERCENT',
        value: '105.00',
        scope: 'PRODUCT',
        startsOn: parseBusinessDate('2026-01-01'),
      })
    ).rejects.toThrow(/cannot exceed 100/);
  });
});
