#!/bin/zsh
set -euo pipefail
APP="/Applications/Helium.app"
URL="http://127.0.0.1:4319/"
PROFILE="Profile 4"
test -d "$APP" || { echo "Helium.app not installed" >&2; exit 1; }
/usr/bin/curl --silent --show-error --fail --max-time 3 "http://127.0.0.1:4319/api/health" >/dev/null || {
  echo "Start the dashboard service first (scripts/install-dashboard.sh)" >&2; exit 1;
}
# Only read Chromium's profile NAME mapping, not its cookie/session files.
python3 - <<'PY'
import json,pathlib,sys
path=pathlib.Path.home()/'Library/Application Support/net.imput.helium/Local State'
profiles=json.loads(path.read_text()).get('profile',{}).get('info_cache',{})
if 'Profile 4' not in profiles:
  sys.exit('Helium Profile 4 is missing')
print('Profile 4:', profiles['Profile 4'].get('name','(unnamed)'))
PY
# macOS 'open --args' is ignored when Helium is already running.
# Calling the Chromium executable hands the new-window request to the EXISTING instance
# via its singleton socket, then exits. Never use 'open -n' or a second user data dir.
if ! pgrep -f '^/Applications/Helium.app/Contents/MacOS/Helium([[:space:]]|$)' >/dev/null; then
  echo 'Helium is not running. Start it in Profile 4 first.' >&2; exit 1
fi
"$APP/Contents/MacOS/Helium" --profile-directory="$PROFILE" --new-window "$URL"
echo "Opened a new Helium Profile 4 window: $URL"
echo "The authenticated ChatGPT window remains in the existing Helium process."
