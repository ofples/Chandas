# Agent Instructions

## Build Policy

- This machine has enough capacity for Android emulators and local native builds. Use `expo prebuild`, `expo run:android`, Android Studio, and targeted Gradle compile or test tasks when they help verify a change. Confirm the required SDK, JDK, and emulator are available before relying on their results.
- Start with focused TypeScript checks, linting, unit tests, and static inspection. For native changes or interaction bugs, follow with an Android build and emulator or physical-device checks when practical. Report checks that could not be completed.
- Remote EAS Build remains available for distributable artifacts and release parity; it is not required for routine local development or native verification. Local Android release builds may be used for testing, but follow the release guide for signing, runtime compatibility, and store delivery.
- Local Expo export and bundling are allowed for validation. `eas update` bundles on this machine and uploads to EAS Update; publishing to preview or production is a release action, not a substitute for local testing. Follow the release guide before publishing.
- This Windows machine cannot run iOS/Xcode builds directly. Use a macOS host or remote build if iOS verification is needed.
