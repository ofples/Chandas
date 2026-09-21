const { withAppBuildGradle, CodeGenerator } = require('@expo/config-plugins')

/** Keep debug installs independent of the production app and its data. */
module.exports = function withDevelopmentIdentity(config) {
  return withAppBuildGradle(config, config => {
    if (config.modResults.language !== 'groovy') throw new Error('Development identity requires Groovy app Gradle configuration')
    config.modResults.contents = CodeGenerator.mergeContents({
      src: config.modResults.contents,
      newSrc: '            applicationIdSuffix ".dev"\n            resValue "string", "app_name", "Chandas Dev"',
      tag: 'chandas-development-identity',
      anchor: /^\s*signingConfig signingConfigs\.debug\s*$/,
      offset: 0,
      comment: '//',
    }).contents
    return config
  })
}
