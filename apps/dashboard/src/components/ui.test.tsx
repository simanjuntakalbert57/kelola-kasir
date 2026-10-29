import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
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

  it('forwards blur and redirects native focus to the combobox (react-hook-form)', async () => {
    const onBlur = vi.fn();
    render(
      <>
        <SelectField label="Kategori" onBlur={onBlur}>
          <option value="a">A</option>
        </SelectField>
        <button type="button">lain</button>
      </>,
    );
    const box = screen.getByRole('combobox', { name: 'Kategori' });
    box.focus();
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(onBlur.mock.calls[0]?.[0].target.tagName).toBe('SELECT');
    (document.querySelector('select') as HTMLSelectElement).focus();
    expect(box).toHaveFocus();
  });

  it('works with register() from react-hook-form', async () => {
    const onSubmit = vi.fn();
    function Form() {
      const { register, handleSubmit } = useForm({ defaultValues: { c: 'b' } });
      return (
        <>
          <SelectField label="Kategori" {...register('c')}>
            <option value="a">A</option>
            <option value="b">B</option>
          </SelectField>
          <button type="button" onClick={handleSubmit((v) => onSubmit(v.c))}>
            kirim
          </button>
        </>
      );
    }
    render(<Form />);
    expect(screen.getByRole('combobox')).toHaveTextContent('B');
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'A' }));
    expect(screen.getByRole('combobox')).toHaveTextContent('A');
    await userEvent.click(screen.getByRole('button', { name: 'kirim' }));
    expect(onSubmit).toHaveBeenCalledWith('a');
  });
});
