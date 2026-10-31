import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import { FloatingTimerOverlay } from './src/components/timer-v2/running/FloatingTimerOverlay';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
// The unified timer editor is the normal production setup flow.
registerRootComponent(App);
AppRegistry.registerComponent('ChandasFloatingTimer', () => FloatingTimerOverlay);
