# Read individual listen settings without executing the installed environment.
listen_setting() {
  local file=$1 name=$2 line
  [[ -f ${file} ]] || return 0
  line="$(grep "^${name}=" "${file}" | tail -n 1)" || return 0
  line=${line#*=}
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "${line}"
}

web_health_url() {
  local app=$1 runtime=$2 host port
  host="${NEXT_HOST:-$(listen_setting "${runtime}" NEXT_HOST)}"
  host="${host:-$(listen_setting "${app}/.env.local" NEXT_HOST)}"
  port="${NEXT_PORT:-$(listen_setting "${runtime}" NEXT_PORT)}"
  port="${port:-$(listen_setting "${app}/.env.local" NEXT_PORT)}"
  case "${host}" in ''|0.0.0.0) host=127.0.0.1 ;; ::) host='[::1]' ;; \[*\]) ;; *:*) host="[${host}]" ;; esac
  printf 'http://%s:%s/login' "${host}" "${port:-3000}"
}
