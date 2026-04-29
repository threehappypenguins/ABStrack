// Must run before shared packages use Web Crypto (`crypto.getRandomValues` / UUID keys for Storage).
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import './global.css';
import { registerRootComponent } from 'expo';

import App from './src/app/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
