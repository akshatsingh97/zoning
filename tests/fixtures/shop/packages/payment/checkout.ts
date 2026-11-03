import { capturePayment } from './capture.js';
import { applyDiscount } from '../utils/pricing.js';

export function checkout(orderId: string, cents: number): string {
  const discounted = applyDiscount(cents, 10);
  return capturePayment({ orderId, cents: discounted }).charged;
}
