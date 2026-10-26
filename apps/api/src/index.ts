import type { ResponseBody } from '@kelola-kasir/contracts';

/** Placeholder until B-1. Shows how handlers type their responses from the contract. */
export type CurrentShiftResponse = ResponseBody<'/shifts/current', 'get'>;

export const API_BASE_PATH = '/v1';
