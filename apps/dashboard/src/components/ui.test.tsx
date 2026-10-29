import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Badge, EmptyState, ErrorState, NoticeCard } from './ui';
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
