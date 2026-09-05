# Agent Instructions

## Build Policy

- Never run native builds locally on this computer. It does not have enough resources for them.
- Do not run Gradle build or compile tasks, `expo run:android`, `expo run:ios`, local EAS builds, Android Studio builds, or Xcode builds.
- Use remote EAS builds only, and only when the user explicitly requests a build.
- Local OTA publication with `eas update` is allowed when the user explicitly requests an update. The JavaScript bundling/Expo export performed as part of that command is allowed and may take some time. A standalone `expo export` remains disallowed unless it is required by an explicitly requested OTA publish workflow.
- Lightweight verification such as TypeScript checks, linting, unit tests, static inspection, and diff validation is allowed.
- When native changes cannot be fully verified without a build, report that limitation instead of attempting a local build.
