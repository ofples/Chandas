Pod::Spec.new do |s|
  s.name = 'ChandasTimerService'
  s.version = '1.0.0'
  s.summary = 'Native iOS delivery for the canonical Chandas timer timeline'
  s.description = 'Durable multi-timer scheduling, AlarmKit, notification sounds and Live Activities.'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'Yukti'
  s.homepage = 'https://github.com/ofples/Chandas'
  s.platforms = { :ios => '18.0' }
  s.source = { :git => 'https://github.com/ofples/Chandas.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.exclude_files = 'ios/Widget/**'
  s.resource_bundles = { 'ChandasTimerService' => ['ios/Resources/*'] }
  s.frameworks = 'JavaScriptCore', 'AVFoundation', 'UserNotifications', 'ActivityKit', 'WidgetKit', 'SwiftUI'
  s.weak_frameworks = 'AlarmKit'
  s.swift_version = '5.9'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
