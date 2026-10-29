import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImageUpload } from './ImageUpload';

describe('ImageUpload', () => {
  it('shows a clear pick button and empty hint when there is no image', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    render(<ImageUpload label="Logo" purpose="logo" value={null} onChange={() => {}} />);
    expect(screen.getByText('Belum ada gambar dipilih.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pilih gambar' }));
    expect(click).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Hapus/ })).toBeNull();
    click.mockRestore();
  });

  it('offers replace and remove when an image is set', async () => {
    const onChange = vi.fn();
    render(
      <ImageUpload
        label="Logo"
        purpose="logo"
        value="https://cdn.test/a.png"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ganti gambar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hapus Logo' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
