#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
STA_URL="${STA_URL:-http://localhost:8080/FROST-Server/v1.1}"
STA_URL="${STA_URL%/}"

if [[ -e ids.env ]]; then
  echo 'ids.env already exists; inspect existing entities before rerunning.' >&2
  exit 1
fi

post_entity() {
  curl --fail-with-body -sS -X POST "$STA_URL/$1" \
    -H 'Content-Type: application/json' \
    -H 'Prefer: return=representation' --data-binary @- \
    | jq -er '."@iot.id" | select(type == "number" and . > 0)'
}

THING_ID=$(post_entity Things <<'JSON'
{"name":"ESP32 Room Sensor","description":"Wi-Fi DHT11 node"}
JSON
)

LOCATION_ID=$(jq -n --argjson thing "$THING_ID" '{
  name: "Lab Desk", description: "Example indoor location; replace coordinates",
  encodingType: "application/vnd.geo+json",
  location: {type: "Point", coordinates: [126.9780, 37.5665]},
  Things: [{"@iot.id": $thing}]
}' | post_entity Locations)

TEMPERATURE_SENSOR_ID=$(post_entity Sensors <<'JSON'
{"name":"DHT11 Temperature","description":"DHT11 temperature procedure","encodingType":"text/plain","metadata":"DHT11; ESP32 GPIO4; temperature in Celsius"}
JSON
)
HUMIDITY_SENSOR_ID=$(post_entity Sensors <<'JSON'
{"name":"DHT11 Humidity","description":"DHT11 humidity procedure","encodingType":"text/plain","metadata":"DHT11; ESP32 GPIO4; relative humidity in percent"}
JSON
)

TEMPERATURE_PROPERTY_ID=$(post_entity ObservedProperties <<'JSON'
{"name":"Air Temperature","description":"Ambient air temperature","definition":"https://qudt.org/vocab/quantitykind/Temperature"}
JSON
)
HUMIDITY_PROPERTY_ID=$(post_entity ObservedProperties <<'JSON'
{"name":"Relative Humidity","description":"Relative humidity of air","definition":"https://qudt.org/vocab/quantitykind/RelativeHumidity"}
JSON
)

make_stream() {
  jq -n --arg name "$1" --arg unit "$2" --arg symbol "$3" --arg definition "$4" \
    --argjson thing "$THING_ID" --argjson sensor "$5" --argjson property "$6" '{
    name: $name, description: "DHT11 sampled every two seconds",
    observationType: "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement",
    unitOfMeasurement: {name: $unit, symbol: $symbol, definition: $definition},
    Thing: {"@iot.id": $thing}, Sensor: {"@iot.id": $sensor},
    ObservedProperty: {"@iot.id": $property}
  }' | post_entity Datastreams
}

TEMPERATURE_DATASTREAM_ID=$(make_stream 'Room Temperature' 'degree Celsius' '°C' \
  'https://qudt.org/vocab/unit/DEG_C' "$TEMPERATURE_SENSOR_ID" "$TEMPERATURE_PROPERTY_ID")
HUMIDITY_DATASTREAM_ID=$(make_stream 'Room Humidity' 'percent' '%' \
  'https://qudt.org/vocab/unit/PERCENT' "$HUMIDITY_SENSOR_ID" "$HUMIDITY_PROPERTY_ID")

printf 'THING_ID=%s\nLOCATION_ID=%s\nTEMPERATURE_DATASTREAM_ID=%s\nHUMIDITY_DATASTREAM_ID=%s\n' \
  "$THING_ID" "$LOCATION_ID" "$TEMPERATURE_DATASTREAM_ID" "$HUMIDITY_DATASTREAM_ID" > ids.env
printf 'Created: temperature=%s humidity=%s\n' "$TEMPERATURE_DATASTREAM_ID" "$HUMIDITY_DATASTREAM_ID"