import { render, screen, fireEvent } from '@testing-library/react';
import {
  observationNoteNeedsExpand,
  PractitionerObservationNoteContent,
} from './practitioner-observation-note-content';

describe('observationNoteNeedsExpand', () => {
  it('returns false for short single-line notes', () => {
    expect(observationNoteNeedsExpand('Brief note.')).toBe(false);
  });

  it('returns true when text exceeds the character threshold', () => {
    expect(observationNoteNeedsExpand('x'.repeat(161))).toBe(true);
  });

  it('returns true when there are more than three lines', () => {
    expect(observationNoteNeedsExpand('a\nb\nc\nd')).toBe(true);
  });
});

describe('PractitionerObservationNoteContent', () => {
  it('renders full text without expand control for short notes', () => {
    render(<PractitionerObservationNoteContent body="Short note" />);
    expect(screen.getByText('Short note')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /expand observation note/i }),
    ).toBeNull();
  });

  it('shows expand control and reveals full text for long notes', () => {
    const longBody = `${'Line one.\n'.repeat(4)}End.`;
    render(<PractitionerObservationNoteContent body={longBody} />);

    const expand = screen.getByRole('button', {
      name: /expand observation note/i,
    });
    expect(expand).toBeTruthy();
    expect(expand.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(expand);

    expect(expand.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByRole('button', { name: /collapse observation note/i }),
    ).toBeTruthy();
  });
});
