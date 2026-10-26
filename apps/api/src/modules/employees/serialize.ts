import type { employees } from '../../db/schema.js';

export interface EmployeeDto {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export function toEmployee(
  row: Pick<typeof employees.$inferSelect, 'id' | 'name' | 'isActive' | 'createdAt'>,
): EmployeeDto {
  return {
    id: row.id,
    name: row.name,
    is_active: row.isActive,
    created_at: row.createdAt.toISOString(),
  };
}
