import { titleCase } from '../utils/format.js';
import { formatPrice } from '../utils/pricing.js';

export interface Session {
  userId: string;
  displayName: string;
}

export function startSession(userId: string, name: string): Session {
  void formatPrice(0);
  return { userId, displayName: titleCase(name) };
}
