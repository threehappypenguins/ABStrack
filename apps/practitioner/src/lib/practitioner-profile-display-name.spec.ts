import {
  combinePractitionerNameFieldsIntoDisplayName,
  splitDisplayNameIntoPractitionerNameFields,
} from './practitioner-profile-display-name';

describe('practitioner-profile-display-name', () => {
  it('combines title and name fields into display name', () => {
    expect(
      combinePractitionerNameFieldsIntoDisplayName({
        title: 'Dr',
        firstName: 'Jane',
        lastName: 'Smith',
      }),
    ).toBe('Dr Jane Smith');
  });

  it('splits display name using stored title metadata', () => {
    expect(
      splitDisplayNameIntoPractitionerNameFields('Dr Jane Smith', 'Dr'),
    ).toEqual({
      title: 'Dr',
      firstName: 'Jane',
      lastName: 'Smith',
    });
  });

  it('returns empty fields when display name is unset', () => {
    expect(splitDisplayNameIntoPractitionerNameFields(null, null)).toEqual({
      title: '',
      firstName: '',
      lastName: '',
    });
  });
});
