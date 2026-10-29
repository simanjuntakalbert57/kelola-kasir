import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';
import { Badge, EmptyState, ErrorState, NoticeCard, SelectField } from './ui';
import { CountBadge } from '../layout/AppShell';

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

describe('SelectField', () => {
  const Harness = ({ onPick }: { onPick?: (v: string) => void }) => {
    const [v, setV] = useState('');
    return (
      <>
        <SelectField
          label="Metode"
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            onPick?.(e.target.value);
          }}
        >
          <option value="">Semua metode</option>
          <option value="cash">Tunai</option>
          <option value="qris">QRIS</option>
        </SelectField>
        <p>Luar</p>
      </>
    );
  };

  it('opens a listbox with the selected option checked and picks by click', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const combo = screen.getByRole('combobox', { name: 'Metode' });
    expect(combo).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(combo);
    expect(combo).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Semua metode' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(screen.getByRole('option', { name: 'QRIS' }));
    expect(onPick).toHaveBeenCalledWith('qris');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combo).toHaveTextContent('QRIS');
    expect(combo).toHaveFocus();
  });

  it('supports keyboard navigation, type-ahead and Escape', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const combo = screen.getByRole('combobox', { name: 'Metode' });
    combo.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}');
    expect(combo.getAttribute('aria-activedescendant')).toMatch(/-opt-1$/);
    await userEvent.keyboard('{End}');
    expect(combo.getAttribute('aria-activedescendant')).toMatch(/-opt-2$/);
    await userEvent.keyboard('{Home}t');
    expect(combo.getAttribute('aria-activedescendant')).toMatch(/-opt-1$/);
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('cash');
    await userEvent.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combo).toHaveFocus();
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('closes on outside click and returns focus to the trigger', async () => {
    render(<Harness />);
    const combo = screen.getByRole('combobox', { name: 'Metode' });
    await userEvent.click(combo);
    await userEvent.click(screen.getByText('Luar'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combo).toHaveFocus();
  });
});
