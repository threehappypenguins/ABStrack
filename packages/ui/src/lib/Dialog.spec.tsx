import { fireEvent, render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { Dialog } from './Dialog.js';

describe('Dialog', () => {
  it('renders title and body when open', () => {
    render(
      <Dialog open title="Confirm" onRequestClose={vi.fn()}>
        <Text>Body</Text>
      </Dialog>,
    );
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('invokes onRequestClose when the backdrop is pressed', () => {
    const onRequestClose = vi.fn();
    render(
      <Dialog open title="Hi" onRequestClose={onRequestClose}>
        <Text>Content</Text>
      </Dialog>,
    );
    fireEvent.click(screen.getByLabelText('Dismiss dialog'));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });
});
