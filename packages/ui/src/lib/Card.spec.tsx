import { render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { Card } from './Card.js';

describe('Card', () => {
  it('renders children inside a bordered surface', () => {
    render(
      <Card title="Summary">
        <Text>Inner</Text>
      </Card>,
    );
    expect(screen.getByText('Inner')).toBeInTheDocument();
    expect(screen.getByLabelText('Summary')).toBeInTheDocument();
  });
});
