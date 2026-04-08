import { fireEvent, render, screen } from '@testing-library/react';
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
});
