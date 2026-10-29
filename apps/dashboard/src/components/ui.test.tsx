import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SelectField } from './ui';

function Harness() {
  const [v, setV] = useState('');
  return (
    <SelectField label="Filter kategori" value={v} onChange={(e) => setV(e.target.value)}>
      <option value="">Semua kategori</option>
      <option value="jus">Jus</option>
    </SelectField>
  );
}

describe('SelectField', () => {
  it('opens a listbox below the control and selects with mouse', async () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Filter kategori' });
    await userEvent.click(box);
    expect(screen.getByRole('listbox').className).toContain('top-full');
    await userEvent.click(screen.getByRole('option', { name: 'Jus' }));
    expect(box).toHaveTextContent('Jus');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('supports keyboard selection', async () => {
    render(<Harness />);
    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByRole('combobox')).toHaveTextContent('Jus');
  });
});
