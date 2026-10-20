import type { ScopedDb } from "@store-ops/db";

/**
 * Monthly spending limits per store. Each run's model cost is recorded in
 * `usage` (rupees, per calendar month in UTC); a store that has reached its
 * limit gets no new agent runs until the month turns or the owner raises it.
 */

export function defaultMonthlyBudgetInr(): number {
  const value = Number(process.env.DEFAULT_MONTHLY_BUDGET_INR ?? 500);
  return Number.isFinite(value) && value > 0 ? value : 500;
}

export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7);

export interface BudgetStatus {
  month: string;
  limitInr: number;
  spentInr: number;
  runs: number;
  remainingInr: number;
  exhausted: boolean;
  /** Share of the limit used, 0–1 (capped at 1). */
  used: number;
}

export async function budgetStatus(db: ScopedDb, storeId: string, now = new Date()): Promise<BudgetStatus> {
  const month = currentMonth(now);
  const [store, usage] = await Promise.all([
    db.store.findUnique({ where: { id: storeId }, select: { monthlyBudgetInr: true } }),
    db.usage.findUnique({ where: { storeId_month: { storeId, month } } }),
  ]);
  const limitInr = store?.monthlyBudgetInr != null ? Number(store.monthlyBudgetInr) : defaultMonthlyBudgetInr();
  const spentInr = Number(usage?.costInr ?? 0);
  return {
    month,
    limitInr,
    spentInr,
    runs: usage?.runs ?? 0,
    remainingInr: Math.max(0, limitInr - spentInr),
    exhausted: spentInr >= limitInr,
    used: limitInr > 0 ? Math.min(1, spentInr / limitInr) : 1,
  };
}
