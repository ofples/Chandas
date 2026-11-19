#!/usr/bin/env bash
set -euo pipefail
mkdir -p artifacts/ios
node scripts/build-ios-kernel.cjs --check
node -e "require('esbuild').buildSync({entryPoints:['scripts/ios-fixture.ts'],bundle:true,platform:'node',outfile:'artifacts/ios/fixture.cjs'})"
node artifacts/ios/fixture.cjs > artifacts/ios/fixture.json
swiftc modules/chandas-timer-service/ios/ChandasKernel.swift scripts/ios-native-smoke.swift -o artifacts/ios/kernel-smoke
artifacts/ios/kernel-smoke modules/chandas-timer-service/ios/Resources/ChandasKernel.js artifacts/ios/fixture.json
xcrun swiftc -typecheck -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" -target arm64-apple-ios18.0-simulator \
  modules/chandas-timer-service/ios/ChandasKernel.swift \
  modules/chandas-timer-service/ios/ChandasLedger.swift \
  modules/chandas-timer-service/ios/ChandasAudio.swift \
  modules/chandas-timer-service/ios/ChandasAlarms.swift \
  modules/chandas-timer-service/ios/Shared/ChandasActivityAttributes.swift \
  modules/chandas-timer-service/ios/ChandasLiveActivity.swift \
  modules/chandas-timer-service/ios/ChandasTimerEngine.swift
CI=1 npx expo prebuild --platform ios --no-install
cd ios
pod install
cd ..
set -o pipefail
xcodebuild -workspace ios/Chandas.xcworkspace -scheme Chandas -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath artifacts/ios/DerivedData CODE_SIGNING_ALLOWED=NO \
  build 2>&1 | tee artifacts/ios/xcodebuild.log | xcbeautify
app="$(find artifacts/ios/DerivedData/Build/Products/Release-iphonesimulator -maxdepth 1 -name '*.app' -print -quit)"
test -n "$app"
test -d "$app/PlugIns/ChandasWidgets.appex"
xcrun simctl list devices available -j > artifacts/ios/devices.json
device="$(python3 -c 'import json; v=json.load(open("artifacts/ios/devices.json")); print(next(d["udid"] for k, ds in v["devices"].items() if "iOS-26" in k for d in ds if "iPhone" in d["name"]))')"
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b
xcrun simctl install "$device" "$app"
xcrun simctl launch "$device" com.yukti.chandas
sleep 8
xcrun simctl io "$device" screenshot artifacts/ios/first-launch.png
xcrun simctl spawn "$device" launchctl list > artifacts/ios/processes.txt
grep -q com.yukti.chandas artifacts/ios/processes.txt
xcrun simctl shutdown "$device"
printf 'Native kernel, iOS compilation, embedded extension and simulator launch passed.\n' > artifacts/ios/result.txt
