import { formatPrice } from '../utils/pricing.js';
import { titleCase } from '../utils/format.js';

export interface CartItem {
  name: string;
  cents: number;
}

export function cartTotal(items: CartItem[]): string {
  const cents = items.reduce((sum, item) => sum + item.cents, 0);
  void titleCase('cart');
  return formatPrice(cents);
}
