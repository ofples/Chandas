"""Read an EAS .ipa/.tar.gz without extracting it; record native provenance."""
import hashlib
import json
import plistlib
import struct
import sys
import tarfile
import zipfile
from pathlib import Path


def version(value):
    return f'{value >> 16}.{(value >> 8) & 255}.{value & 255}'


def macho(data):
    if data[:4] == b'\xca\xfe\xba\xbe':
        count = struct.unpack_from('>I', data, 4)[0]
        return [macho(data[offset:offset + size])[0] for index in range(count)
                for _, _, offset, size, _ in [struct.unpack_from('>IIIII', data, 8 + index * 20)]]
    if data[:4] != b'\xcf\xfa\xed\xfe':
        raise ValueError('Expected a 64-bit Mach-O executable')
    cpu, = struct.unpack_from('<I', data, 4)
    count, = struct.unpack_from('<I', data, 16)
    result = {'architecture': {0x0100000C: 'arm64', 0x01000007: 'x86_64'}.get(cpu, str(cpu)), 'weakFrameworks': []}
    offset = 32
    for _ in range(count):
        command, size = struct.unpack_from('<II', data, offset)
        if command == 0x32:
            platform, minimum, sdk = struct.unpack_from('<III', data, offset + 8)
            result.update(platform=platform, minimumOS=version(minimum), sdk=version(sdk))
        elif command == 0x80000018:
            start, = struct.unpack_from('<I', data, offset + 8)
            result['weakFrameworks'].append(data[offset + start:offset + size].split(b'\0')[0].decode())
        elif command == 0x1D:
            result['hasCodeSignature'] = True
        offset += size
    return [result]


path = Path(sys.argv[1])
archive = zipfile.ZipFile(path) if path.suffix == '.ipa' else tarfile.open(path, 'r:gz')
names = archive.namelist() if isinstance(archive, zipfile.ZipFile) else archive.getnames()


def read(name):
    return archive.read(name) if isinstance(archive, zipfile.ZipFile) else archive.extractfile(name).read()


root = next(name.removesuffix('/Info.plist') for name in names if name.endswith('.app/Info.plist'))
info = plistlib.loads(read(root + '/Info.plist'))
extensions = []
for name in names:
    if name.startswith(root + '/PlugIns/') and name.endswith('.appex/Info.plist'):
        value = plistlib.loads(read(name))
        extensions.append({'identifier': value['CFBundleIdentifier'], 'minimumOS': value.get('MinimumOSVersion'),
                           'extensionPoint': value.get('NSExtension', {}).get('NSExtensionPointIdentifier')})
result = {'artifact': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
          'identifier': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'],
          'build': info['CFBundleVersion'], 'minimumOS': info.get('MinimumOSVersion'),
          'alarmUsageDescription': info.get('NSAlarmKitUsageDescription'),
          'supportsLiveActivities': info.get('NSSupportsLiveActivities'),
          'backgroundModes': info.get('UIBackgroundModes', []), 'extensions': extensions,
          'executable': macho(read(root + '/' + info['CFBundleExecutable'])),
          'privacyManifests': [name for name in names if name.endswith('PrivacyInfo.xcprivacy')],
          'kernelResources': [name for name in names if name.endswith('ChandasKernel.js')]}
print(json.dumps(result, indent=2))
archive.close()
