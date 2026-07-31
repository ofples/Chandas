// Config plugin for the local chandas-timer-service module.
//
// MainActivity.kt is regenerated on every `expo prebuild`, so it can't be
// hand-edited directly. This injects two tiny calls out to
// AlarmWindowHelper.applyAlarmWindowFlags() (a plain Kotlin object living in
// this module — see android/.../AlarmWindowHelper.kt) so the full-screen alarm
// notification can wake the screen and show over the lock screen:
//   1. in onCreate(), for a cold launch/relaunch via the alarm notification
//   2. in a newly-added onNewIntent() override, for when MainActivity (singleTask)
//      is already running and gets brought to front instead of recreated
//
// Referenced from app.json as a relative path (this is a local module, not an
// installed npm package, so it isn't auto-discovered by name):
//   "plugins": [["./modules/chandas-timer-service/app.plugin.js"]]

const { withMainActivity } = require('@expo/config-plugins')
const { CodeGenerator } = require('@expo/config-plugins')

const HELPER_IMPORT = 'import expo.modules.chandastimerservice.AlarmWindowHelper'
const INTENT_IMPORT = 'import android.content.Intent'

function withChandasAlarmMainActivity(config) {
  return withMainActivity(config, config => {
    if (config.modResults.language !== 'kt') {
      // Only Kotlin MainActivity is supported — Expo's default template is
      // Kotlin for new projects; Java projects fall back to no-op (alarm mode
      // still works, just without the lock-screen wake behavior).
      return config
    }

    let src = config.modResults.contents

    src = CodeGenerator.mergeContents({
      src,
      newSrc: INTENT_IMPORT,
      tag: 'chandas-alarm-intent-import',
      anchor: /import android\.os\.Bundle/,
      offset: 1,
      comment: '//',
    }).contents

    src = CodeGenerator.mergeContents({
      src,
      newSrc: HELPER_IMPORT,
      tag: 'chandas-alarm-helper-import',
      anchor: /import expo\.modules\.ReactActivityDelegateWrapper/,
      offset: 1,
      comment: '//',
    }).contents

    src = CodeGenerator.mergeContents({
      src,
      newSrc: '    AlarmWindowHelper.applyAlarmWindowFlags(this, intent)',
      tag: 'chandas-alarm-oncreate',
      anchor: /super\.onCreate\(null\)/,
      offset: 1,
      comment: '//',
    }).contents

    src = CodeGenerator.mergeContents({
      src,
      newSrc: [
        '  override fun onNewIntent(intent: Intent) {',
        '    super.onNewIntent(intent)',
        '    setIntent(intent)',
        '    AlarmWindowHelper.applyAlarmWindowFlags(this, intent)',
        '  }',
        '',
      ].join('\n'),
      tag: 'chandas-alarm-onnewintent',
      anchor: /override fun getMainComponentName\(\): String = "main"/,
      offset: 0,
      comment: '//',
    }).contents

    config.modResults.contents = src
    return config
  })
}

module.exports = withChandasAlarmMainActivity
