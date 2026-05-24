import {
  combineNameFieldsIntoDisplayName,
  splitDisplayNameIntoNameFields,
} from './profile-display-name';

describe('profile-display-name', () => {
  it('splits display name into first and last', () => {
    expect(splitDisplayNameIntoNameFields('Jordan Lee')).toEqual({
      firstName: 'Jordan',
      lastName: 'Lee',
    });
  });

  it('returns empty fields for null display name', () => {
    expect(splitDisplayNameIntoNameFields(null)).toEqual({
      firstName: '',
      lastName: '',
    });
  });

  it('combines trimmed name fields into display name', () => {
    expect(
      combineNameFieldsIntoDisplayName({
        firstName: '  Sam  ',
        lastName: ' Taylor ',
      }),
    ).toBe('Sam Taylor');
  });

  it('returns null when both name fields are empty', () => {
    expect(
      combineNameFieldsIntoDisplayName({ firstName: ' ', lastName: '' }),
    ).toBeNull();
  });
});
