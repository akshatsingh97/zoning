export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function applyDiscount(cents: number, percent: number): number {
  return Math.round(cents * (1 - percent / 100));
}
