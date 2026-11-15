/**
 * Fixed list for expense ("dépense") cash movements — deliberately not free text, so stats don't
 * fragment into near-duplicates ("Transport" vs "transport" vs "Frais de transport"). Deposits
 * ("dépôt") keep free text: their motifs are naturally varied and aren't what's being analyzed.
 *
 * Internal caisse-to-caisse transfers write an expense row with category 'Transfert interne' (see
 * lib/db/mutations/cash-accounts.ts) — that's money moving between the business's own accounts,
 * not a real cost, so it's excluded from this list and from expense breakdown statistics.
 */
export const EXPENSE_CATEGORIES = [
  'Loyer',
  'Salaires',
  'Transport',
  'Achats & fournitures',
  'Entretien & réparations',
  'Électricité & eau',
  'Communication',
  'Impôts & taxes',
  'Autre',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value)
}
