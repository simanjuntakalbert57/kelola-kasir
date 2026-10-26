import { readFileSync } from 'node:fs';
import { STATE_FILE } from './global-setup.js';
import type { Cashier, Product, Sale, Shop } from './api.js';

export interface SeedState {
  shop: Shop;
  siti: Cashier;
  budi: Cashier;
  shift1: string;
  shift2: string;
  shift1Close: Record<string, any>;
  v1: Sale;
  v2: Sale;
  s1Cash: Sale;
}
export const seed = (): SeedState => JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SeedState;
export type { Product };
