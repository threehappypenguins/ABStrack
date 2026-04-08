import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Text } from 'react-native';
import { Button } from './Button.js';

describe('Button', () => {
  it('invokes onPress when the control is activated', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('applies default minimum touch target sizing on web', () => {
    render(<Button minimumTouchTarget={44}>Go</Button>);
    const el = screen.getByRole('button', { name: 'Go' });
    expect(el).toHaveStyle({ minHeight: '44px', minWidth: '44px' });
  });

  it('exposes a disabled state to assistive technologies', () => {
    render(
      <Button disabled onPress={vi.fn()}>
        Locked
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Locked' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('does not set an empty aria-label when children are non-text and no label is given', () => {
    render(
      <Button onPress={vi.fn()}>
        <Text>Custom</Text>
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Custom' });
    expect(el.getAttribute('aria-label')).toBeNull();
  });

  it('uses an explicit accessibilityLabel for non-text children', () => {
    render(
      <Button accessibilityLabel="Submit" onPress={vi.fn()}>
        <Text>Custom</Text>
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('sets aria-disabled from the disabled prop even when accessibilityState.disabled is false', () => {
    render(
      <Button
        disabled
        accessibilityState={{ disabled: false }}
        onPress={vi.fn()}
      >
        Tab
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Tab' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('Button high contrast', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockPrefersHighContrast(matches: boolean) {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(prefers-contrast: more)' ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  it('uses high-contrast primary fill when the system prefers high contrast and the prop is omitted', async () => {
    mockPrefersHighContrast(true);
    render(<Button onPress={vi.fn()}>Save</Button>);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toHaveStyle({
        backgroundColor: 'rgb(255, 255, 255)',
      });
    });
  });

  it('keeps the default primary fill when highContrast is false even if the system prefers high contrast', async () => {
    mockPrefersHighContrast(true);
    render(
      <Button highContrast={false} onPress={vi.fn()}>
        Save
      </Button>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toHaveStyle({
        backgroundColor: 'rgb(29, 78, 216)',
      });
    });
  });

  it('uses high-contrast primary fill when highContrast is true regardless of system preference', async () => {
    mockPrefersHighContrast(false);
    render(
      <Button highContrast onPress={vi.fn()}>
        Save
      </Button>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toHaveStyle({
        backgroundColor: 'rgb(255, 255, 255)',
      });
    });
  });
});
