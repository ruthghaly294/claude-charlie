#!/bin/sh
set -eu
if [ "$(id -u)" = 0 ]; then
  chown node:node /data
  mkdir -p /tmp/.X11-unix
  chmod 1777 /tmp/.X11-unix
  exec gosu node "$0" "$@"
fi
Xvfb :99 -screen 0 1366x900x24 -nolisten tcp &
display_pid=$!
vnc_pid=''
limit_pid=''
cleanup() {
  [ -z "$limit_pid" ] || kill "$limit_pid" 2>/dev/null || true
  [ -z "$vnc_pid" ] || kill "$vnc_pid" 2>/dev/null || true
  kill "$display_pid" 2>/dev/null || true
}
trap cleanup EXIT
for attempt in 1 2 3 4 5; do
  [ ! -S /tmp/.X11-unix/X99 ] || break
  sleep 1
done
if [ "${ENABLE_VNC:-false}" = true ]; then
  umask 077
  if [ -s /run/secrets/vnc_password ]; then
    vnc_password=$(cat /run/secrets/vnc_password)
  else
    vnc_password=${VNC_PASSWORD:?Missing VNC password secret}
  fi
  x11vnc -storepasswd "$vnc_password" /tmp/vnc-passwd >/dev/null
  unset vnc_password VNC_PASSWORD
  x11vnc -display :99 -rfbauth /tmp/vnc-passwd -rfbport 5900 -forever -shared -quiet &
  vnc_pid=$!
fi
"$@" &
app_pid=$!
if [ -n "${RUN_LIMIT_SECONDS:-}" ]; then
  case "$RUN_LIMIT_SECONDS" in *[!0-9]*|'') echo "Invalid run limit" >&2; kill "$app_pid"; exit 1;; esac
  (sleep "$RUN_LIMIT_SECONDS"; kill -TERM "$app_pid" 2>/dev/null || true) &
  limit_pid=$!
fi
trap 'kill -TERM "$app_pid" 2>/dev/null || true' TERM INT
set +e
wait "$app_pid"
result=$?
# A signal can interrupt wait before Chrome has flushed its profile.
if kill -0 "$app_pid" 2>/dev/null; then wait "$app_pid"; result=$?; fi
exit "$result"
