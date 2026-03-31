import { configure } from '@testing-library/react-native';

jest.mock('expo/src/winter/ImportMetaRegistry', () => ({
  ImportMetaRegistry: {
    get url() {
      return null;
    },
  },
}));

jest.mock(
  'react-native-safe-area-context',
  () => {
    const mock = require('react-native-safe-area-context/jest/mock').default;
    return {
      __esModule: true,
      ...mock,
      default: mock,
    };
  },
);

configure({ asyncUtilTimeout: 5000 });

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (object) => JSON.parse(JSON.stringify(object));
}
