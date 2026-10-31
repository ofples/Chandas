const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Native builds create many changing files. Keep Metro's Windows fallback
// watcher focused on JS/assets so a local Gradle build cannot starve the UI.
config.resolver.blockList = [
  ...config.resolver.blockList,
  ...['android', 'ios'].map(directory => new RegExp(`^${escapeRegex(path.join(__dirname, directory))}(?:[/\\\\]|$)`)),
  /[/\\]android[/\\](?:build|\.cxx|\.gradle|\.kotlin)(?:[/\\]|$)/,
]

module.exports = config
