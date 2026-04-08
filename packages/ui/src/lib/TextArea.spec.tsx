import { fireEvent, render, screen } from '@testing-library/react';
import { TextArea } from './TextArea.js';

describe('TextArea', () => {
  it('renders a multiline field with label', () => {
    render(<TextArea label="Notes" value="" onChangeText={vi.fn()} />);
    const field = screen.getByLabelText('Notes', { selector: 'textarea' });
    expect(field.tagName).toBe('TEXTAREA');
  });

  it('floors height by minimum touch target', () => {
    render(
      <TextArea label="Notes" value="" onChangeText={vi.fn()} minHeight={32} />,
    );
    expect(
      screen.getByLabelText('Notes', { selector: 'textarea' }),
    ).toHaveStyle({ minHeight: '44px' });
  });

  it('forwards text changes', () => {
    const onChangeText = vi.fn();
    render(<TextArea label="Notes" value="" onChangeText={onChangeText} />);
    fireEvent.change(screen.getByLabelText('Notes', { selector: 'textarea' }), {
      target: { value: 'Line' },
    });
    expect(onChangeText).toHaveBeenCalledWith('Line');
  });
});
