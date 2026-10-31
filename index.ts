import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import TimerSetupPrototype from './src/experimental/TimerSetupPrototype';
import { FloatingTimerOverlay } from './src/components/timer-v2/running/FloatingTimerOverlay';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
// The experimental setup owns separate prototype data and never mounts the
// production timer hooks. Normal launches continue to register the regular app.
registerRootComponent(process.env.EXPO_PUBLIC_SETUP_PROTOTYPE === '1' ? TimerSetupPrototype : App);
AppRegistry.registerComponent('ChandasFloatingTimer', () => FloatingTimerOverlay);
