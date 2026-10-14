#!/bin/bash
# Oracle-only Sashai passive watcher. Adds NO browser sends or filesystem task execution.
set -euo pipefail
ROOT="/Users/test/Documents/work/temporal-harness-mvp"
STATE="$ROOT/.state/oracle-sashai"
LABEL="org.drunkod.oracle-sashai-passive-watcher"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
NODE="$(command -v node)"
action="${1:-status}"
mkdir -p "$STATE" "$HOME/Library/LaunchAgents"
case "$action" in
  start)
    if ! [ -f "$PLIST" ]; then
      cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array>
<string>$NODE</string>
<string>$ROOT/scripts/sashai-supervisor.mjs</string>
<string>supervise</string>
<string>forever</string>
</array>
<key>WorkingDirectory</key><string>$ROOT</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>$STATE/watcher.log</string>
<key>StandardErrorPath</key><string>$STATE/watcher.error.log</string>
</dict></plist>
EOF
      chmod 600 "$PLIST"
    fi
    if ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl bootstrap "$DOMAIN" "$PLIST"
    else
      launchctl kickstart -k "$DOMAIN/$LABEL"
    fi
    echo "Started read-only Sashai watcher: $LABEL"
    ;;
  stop)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl bootout "$DOMAIN/$LABEL"
    fi
    echo "Stopped read-only Sashai watcher: $LABEL"
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$LABEL" | grep -E 'state =|pid =|last exit code|path =' | head -10
    else
      echo "Watcher not loaded"
    fi
    ;;
  *)
    echo "Usage: $0 start|stop|status" >&2; exit 2 ;;
esac
