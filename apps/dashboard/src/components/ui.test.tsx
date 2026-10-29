import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { Badge, EmptyState, ErrorState, NoticeCard, SelectField } from './ui';
import { CountBadge } from '../layout/AppShell';

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

describe('ui primitives', () => {
  it('Badge renders an icon with its text', () => {
    const { container } = render(<Badge tone="ok">Aktif</Badge>);
    expect(screen.getByText('Aktif')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('NoticeCard distinguishes info from action', () => {
    render(
      <NoticeCard kind="action" title="Perlu dicek">
        2 permintaan
      </NoticeCard>,
    );
    expect(screen.getByText('Perlu dicek')).toBeInTheDocument();
  });

  it('EmptyState shows its title', () => {
    render(<EmptyState icon="✅" title="Kosong" />);
    expect(screen.getByText('Kosong')).toBeInTheDocument();
  });

  it('ErrorState is an alert and retries', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('CountBadge hides at 0 and caps at 9+', () => {
    const { rerender, container } = render(<CountBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CountBadge count={12} />);
    expect(screen.getByLabelText('12 permintaan batal menunggu')).toHaveTextContent('9+');
  });
});
