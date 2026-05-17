import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

function ensureDialogElementPolyfill(): void {
  HTMLDialogElement.prototype.showModal =
    HTMLDialogElement.prototype.showModal ||
    function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  HTMLDialogElement.prototype.close =
    HTMLDialogElement.prototype.close ||
    function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    ensureDialogElementPolyfill();
  });

  it('clears busy state and shows an error when onConfirm rejects', async () => {
    const onConfirm = jest
      .fn()
      .mockRejectedValue(new Error('Delete failed unexpectedly'));
    const onClose = jest.fn();

    render(
      <ConfirmDialog
        open
        title="Delete item?"
        confirmLabel="Delete"
        confirmBusyLabel="Deleting…"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(screen.getByRole('button', { name: /deleting/i })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Delete failed unexpectedly',
      );
    });

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
