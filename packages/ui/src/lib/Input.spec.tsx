import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from './Input.js';

describe('Input', () => {
  it('associates the visible label with the field for screen readers', () => {
    render(<Input label="Email" value="" onChangeText={vi.fn()} />);
    expect(
      screen.getByLabelText('Email', { selector: 'input' }),
    ).toBeInTheDocument();
  });

  it('forwards text changes', () => {
    const onChangeText = vi.fn();
    render(<Input label="Name" value="" onChangeText={onChangeText} />);
    fireEvent.change(screen.getByLabelText('Name', { selector: 'input' }), {
      target: { value: 'Ada' },
    });
    expect(onChangeText).toHaveBeenCalledWith('Ada');
  });

  it('applies minimum touch height by default', () => {
    render(<Input label="Field" value="" onChangeText={vi.fn()} />);
    expect(screen.getByLabelText('Field', { selector: 'input' })).toHaveStyle({
      minHeight: '44px',
    });
  });
});
