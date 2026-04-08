import { render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { NavigationShell } from './NavigationShell.js';

describe('NavigationShell', () => {
  it('renders header, main, and footer slots', () => {
    render(
      <NavigationShell
        header={<Text>Top</Text>}
        footer={<Text>Bottom</Text>}
      >
        <Text>Middle</Text>
      </NavigationShell>,
    );
    expect(screen.getByText('Top')).toBeInTheDocument();
    expect(screen.getByText('Middle')).toBeInTheDocument();
    expect(screen.getByText('Bottom')).toBeInTheDocument();
  });
});
