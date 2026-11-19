const { withInfoPlist, withPodfileProperties, withXcodeProject, withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')
const plist = require('@expo/plist').default
const targetName = 'ChandasWidgets'

module.exports = function withIOSTimers(config) {
  config = withInfoPlist(config, value => {
    value.modResults.NSAlarmKitUsageDescription = 'Chandas schedules the interval alarms you enable, including when your iPhone is locked.'
    value.modResults.NSSupportsLiveActivities = true
    // Ordinary bells use local notifications, not silent/background audio.
    return value
  })
  config = withPodfileProperties(config, value => {
    value.modResults['ios.deploymentTarget'] = '18.0'
    return value
  })
  config = withDangerousMod(config, ['ios', async value => {
    const destination = path.join(value.modRequest.platformProjectRoot, targetName)
    const source = path.join(value.modRequest.projectRoot, 'modules/chandas-timer-service/ios')
    fs.mkdirSync(destination, { recursive: true })
    for (const [from, to] of [['Widget/ChandasWidget.swift', 'ChandasWidget.swift'], ['Shared/ChandasActivityAttributes.swift', 'ChandasActivityAttributes.swift']]) {
      fs.copyFileSync(path.join(source, from), path.join(destination, to))
    }
    fs.writeFileSync(path.join(destination, 'Info.plist'), plist.build({
      CFBundleDisplayName: 'Chandas', CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleExecutable: '$(EXECUTABLE_NAME)', CFBundleName: '$(PRODUCT_NAME)', CFBundlePackageType: 'XPC!',
      CFBundleShortVersionString: '$(MARKETING_VERSION)', CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
      NSExtension: { NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' },
      NSSupportsLiveActivities: true,
    }))
    return value
  }])
  return withXcodeProject(config, value => {
    const project = value.modResults
    if (Object.values(project.pbxNativeTargetSection()).some(target => typeof target === 'object' && String(target.name).replaceAll('"', '') === targetName)) return value
    const target = project.addTarget(targetName, 'app_extension', targetName, `${value.ios.bundleIdentifier}.widgets`)
    const group = project.addPbxGroup([], targetName, targetName)
    project.addToPbxGroup({ fileRef: group.uuid, basename: targetName }, project.getFirstProject().firstProject.mainGroup)
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid)
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid)
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid)
    project.addSourceFile('ChandasWidget.swift', { target: target.uuid }, group.uuid)
    project.addSourceFile('ChandasActivityAttributes.swift', { target: target.uuid }, group.uuid)
    const configurationList = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList]
    for (const reference of configurationList.buildConfigurations) {
      const settings = project.pbxXCBuildConfigurationSection()[reference.value].buildSettings
      Object.assign(settings, {
        PRODUCT_BUNDLE_IDENTIFIER: `${value.ios.bundleIdentifier}.widgets`,
        PRODUCT_NAME: '"$(TARGET_NAME)"', SWIFT_VERSION: '5.0', IPHONEOS_DEPLOYMENT_TARGET: '18.0',
        INFOPLIST_FILE: `${targetName}/Info.plist`, GENERATE_INFOPLIST_FILE: 'NO',
        TARGETED_DEVICE_FAMILY: '"1,2"', SKIP_INSTALL: 'YES', APPLICATION_EXTENSION_API_ONLY: 'YES',
        MARKETING_VERSION: value.version, CURRENT_PROJECT_VERSION: value.ios.buildNumber || '1',
        CODE_SIGN_STYLE: 'Automatic',
      })
    }
    return value
  })
}
