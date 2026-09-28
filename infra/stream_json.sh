#!/usr/bin/env bash
# 새 측정값을 2초마다 FROST에서 받아 ~/sta-backups/json/YYYY-MM-DD.json 배열 끝에 붙인다 (날짜는 한국 시간).
# 파일은 항상 올바른 JSON 배열 "[\n{...},\n{...}\n]\n" 형태로 유지된다.
# 마지막으로 받은 Observation id를 상태 파일에 남겨, 재시작해도 빠지거나 겹치는 줄이 없다.
# systemd user unit(sta-json.service)으로 실행.
set -euo pipefail
cd "$(dirname "$0")"
source ids.env
FROST="${FROST:-http://localhost:8080/FROST-Server/v1.1}"
OUT_DIR="${JSON_DIR:-$HOME/sta-backups/json}"
STATE="$OUT_DIR/.last_id"
PAGE=1000
mkdir -p "$OUT_DIR"

# 배열 끝의 "\n]\n"을 떼고 새 항목을 붙인 뒤 다시 닫는다.
# ponytail: 떼고 붙이는 사이에 전원이 나가면 그 파일 끝이 깨질 수 있다. 문제가 되면 임시 파일에 쓰고 mv로 바꾼다.
append() {
  if [ -s "$1" ]; then truncate -s -3 "$1"; printf ',\n%s\n]\n' "$2" >> "$1"
  else printf '[\n%s\n]\n' "$2" > "$1"; fi
}

query() { curl -fsS -G "$FROST/Observations" --data-urlencode '$select=id,phenomenonTime,result' \
  --data-urlencode '$expand=Datastream($select=id)' --data-urlencode "\$top=$PAGE" "$@"; }

# 처음 실행이면 오늘 0시(한국 시간) 직전 id부터 시작해 오늘 파일을 처음부터 채운다.
if [ ! -s "$STATE" ]; then
  query --data-urlencode "\$filter=phenomenonTime lt $(TZ=Asia/Seoul date +%F)T00:00:00+09:00" \
    --data-urlencode '$orderby=id desc' | jq '.value[0]["@iot.id"] // 0' > "$STATE"
fi
last=$(cat "$STATE")

while true; do
  # 밀린 게 많으면(재시작 직후 등) 한 페이지씩 끝까지 따라잡는다.
  while page=$(query --data-urlencode "\$filter=id gt $last" --data-urlencode '$orderby=id asc'); do
    n=$(jq '.value | length' <<<"$page")
    [ "$n" -eq 0 ] && break
    # 한 줄 = "날짜<TAB>JSON". 같은 시각의 온도·습도는 각각 한 줄씩.
    jq -r --argjson t "$TEMPERATURE_DATASTREAM_ID" --argjson h "$HUMIDITY_DATASTREAM_ID" '.value[] |
      # FROST는 UTC로 준다. 9시간을 더해 한국 시간(+09:00)으로 바꾼다.
      (.phenomenonTime | sub("\\.[0-9]+"; "") | fromdateiso8601 + 32400) as $kst |
      ($kst | strftime("%Y-%m-%d")) + "\t" +
      ({id: .["@iot.id"], time: ($kst | strftime("%Y-%m-%dT%H:%M:%S+09:00")),
        type: (if .Datastream["@iot.id"] == $t then "temperature_c" elif .Datastream["@iot.id"] == $h then "humidity_pct" else "datastream_\(.Datastream["@iot.id"])" end),
        value: .result} | tojson)' <<<"$page" |
    while IFS=$'\t' read -r day line; do append "$OUT_DIR/$day.json" "$line"; done
    last=$(jq '.value[-1]["@iot.id"]' <<<"$page")
    echo "$last" > "$STATE"
    [ "$n" -lt "$PAGE" ] && break
  done
  sleep 2
done
