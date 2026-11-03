import { formatPrice } from '../utils/pricing.js';

export interface CaptureRequest {
  orderId: string;
  cents: number;
}

export interface CaptureResponse {
  orderId: string;
  charged: string;
}

export function capturePayment(req: CaptureRequest): CaptureResponse {
  return { orderId: req.orderId, charged: formatPrice(req.cents) };
}
