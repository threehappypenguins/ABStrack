import { fireEvent, render, screen } from '@testing-library/react';
import { LiveAnnouncerProvider, useAnnounce } from './LiveAnnouncer.js';

describe('LiveAnnouncerProvider', () => {
  it('renders polite and assertive live regions', () => {
    render(
      <LiveAnnouncerProvider>
        <span>App</span>
      </LiveAnnouncerProvider>,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('updates polite region text when announce runs', () => {
    function Demo() {
      const { announce } = useAnnounce();
      return (
        <button type="button" onClick={() => announce('Saved profile')}>
          Save
        </button>
      );
    }

    render(
      <LiveAnnouncerProvider>
        <Demo />
      </LiveAnnouncerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('status')).toHaveTextContent('Saved profile');
  });

  it('routes assertive announcements to the alert region', () => {
    function Demo() {
      const { announce } = useAnnounce();
      return (
        <button
          type="button"
          onClick={() =>
            announce('Session expired', { politeness: 'assertive' })
          }
        >
          Warn
        </button>
      );
    }

    render(
      <LiveAnnouncerProvider>
        <Demo />
      </LiveAnnouncerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Warn' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Session expired');
  });

  it('ignores empty or whitespace-only messages', () => {
    function Demo() {
      const { announce } = useAnnounce();
      return (
        <>
          <button type="button" onClick={() => announce('Prior message')}>
            Set prior
          </button>
          <button type="button" onClick={() => announce('   ')}>
            Whitespace only
          </button>
        </>
      );
    }

    render(
      <LiveAnnouncerProvider>
        <Demo />
      </LiveAnnouncerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set prior' }));
    expect(screen.getByRole('status')).toHaveTextContent('Prior message');

    fireEvent.click(screen.getByRole('button', { name: 'Whitespace only' }));

    expect(screen.getByRole('status')).toHaveTextContent('Prior message');
    expect(screen.getByRole('alert')).toHaveTextContent('');
  });
});

describe('useAnnounce', () => {
  it('throws outside LiveAnnouncerProvider', () => {
    function Bad() {
      useAnnounce();
      return null;
    }

    expect(() => render(<Bad />)).toThrow(/LiveAnnouncerProvider/);
  });
});
