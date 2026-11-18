export const quantityStep = (unit: string) => unit === "head" ? 1 : 0.01;
export const validQuantity = (unit: string, value: number) => Number.isFinite(value) && value > 0 && (unit !== "head" || Number.isInteger(value));

export function changedQuantity(unit: string, current: number, change: number, maximum: number) {
  const next = unit === "head"
    ? change > 0 ? Math.floor(current) + change : Math.ceil(current) + change
    : Math.round((current + change) * 100) / 100;
  return Math.max(0, Math.min(unit === "head" ? Math.floor(maximum) : maximum, next));
}
