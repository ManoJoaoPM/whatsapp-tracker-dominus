export const MAX_SALE_VALUE = 1_000_000_000

/** Accepts "1500", "1.500", "1.500,00", "R$ 1.500,50" and "1500,5". Returns null when it is not a valid amount. */
export const parseMoneyInput = (raw: string): number | null => {
  const cleaned = raw.replace(/[^\d.,]/g, '')
  if (!cleaned) return null

  let normalized = cleaned
  if (cleaned.includes(',')) normalized = cleaned.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) normalized = cleaned.replace(/\./g, '')

  const n = Number(normalized)
  return Number.isFinite(n) && n > 0 && n <= MAX_SALE_VALUE ? Math.round(n * 100) / 100 : null
}

export const formatMoney = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
