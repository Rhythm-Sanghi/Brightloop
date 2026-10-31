export function parseBusinessDate(str: string): Date {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(str);
  if (!match) {
    throw new Error(`Invalid business date format: "${str}". Expected YYYY-MM-DD.`);
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: "${str}".`);
  }
  return date;
}

export function formatBusinessDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayBusinessDate(now = new Date()): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return parseBusinessDate(formatter.format(now));
}

export function kolkataMidnightUtc(businessDate: Date): Date {
  // Asia/Kolkata is UTC + 5:30 with no daylight saving time.
  // Midnight Kolkata time is 18:30 UTC of previous day = UTC date midnight minus 5h 30m.
  const offsetMs = (5 * 60 + 30) * 60 * 1000;
  return new Date(businessDate.getTime() - offsetMs);
}

export function addDays(date: Date, n: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + n));
}

export function addUnits(anchor: Date, period: string, interval: number, n: number): Date {
  const totalUnits = interval * n;
  if (period === 'DAILY') {
    return addDays(anchor, totalUnits);
  }
  if (period === 'WEEKLY') {
    return addDays(anchor, totalUnits * 7);
  }

  const anchorYear = anchor.getUTCFullYear();
  const anchorMonth = anchor.getUTCMonth();
  const anchorDay = anchor.getUTCDate();

  if (period === 'MONTHLY') {
    const totalMonths = anchorYear * 12 + anchorMonth + totalUnits;
    const targetYear = Math.floor(totalMonths / 12);
    const targetMonth = ((totalMonths % 12) + 12) % 12;
    const maxDays = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const clampedDay = Math.min(anchorDay, maxDays);
    return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
  }

  if (period === 'YEARLY') {
    const targetYear = anchorYear + totalUnits;
    const maxDays = new Date(Date.UTC(targetYear, anchorMonth + 1, 0)).getUTCDate();
    const clampedDay = Math.min(anchorDay, maxDays);
    return new Date(Date.UTC(targetYear, anchorMonth, clampedDay));
  }

  throw new Error(`Unsupported billing period: ${period}`);
}

export function getPeriodDates(
  startDate: Date,
  period: string,
  interval: number,
  cycleIndex: number
): { periodStart: Date; periodEnd: Date } {
  const periodStart = addUnits(startDate, period, interval, cycleIndex);
  const nextPeriodStart = addUnits(startDate, period, interval, cycleIndex + 1);
  const periodEnd = addDays(nextPeriodStart, -1);
  return { periodStart, periodEnd };
}

export function calculateRenewalExpiry(
  currentExpiry: Date | null,
  period: string,
  interval: number,
  today: Date
): Date {
  if (!currentExpiry) {
    throw new Error('Renewal requires an expiryDate.');
  }
  const nextDay = addDays(currentExpiry, 1);
  const exclusiveStart = nextDay.getTime() > today.getTime() ? nextDay : today;
  const newExpiry = addDays(addUnits(exclusiveStart, period, interval, 1), -1);
  return newExpiry;
}

export function findResumeIndex(
  startDate: Date,
  period: string,
  interval: number,
  billingCycleIndex: number,
  today: Date
): { resumeIndex: number; nextBillingDate: Date } {
  let i = billingCycleIndex;
  while (true) {
    const start = addUnits(startDate, period, interval, i);
    if (start.getTime() >= today.getTime()) {
      return { resumeIndex: i, nextBillingDate: start };
    }
    i++;
  }
}
