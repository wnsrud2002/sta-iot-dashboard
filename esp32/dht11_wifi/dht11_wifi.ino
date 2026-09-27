#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include <DHT.h>
#include "secrets.h"

constexpr uint8_t DHT_PIN = 4;
constexpr uint8_t DHT_TYPE = DHT11;
constexpr unsigned long SAMPLE_INTERVAL_MS = 2000;
// NTP 동기화 전의 시계는 1970년부터 시작하므로, 이보다 이른 시각으로는 저장하지 않는다.
constexpr time_t MIN_VALID_EPOCH = 1735689600;  // 2025-01-01T00:00:00Z

DHT dht(DHT_PIN, DHT_TYPE);

bool postObservation(int datastreamId, float result, const char* phenomenonTime) {
  char body[224];
  snprintf(body, sizeof(body),
           "{\"phenomenonTime\":\"%s\",\"result\":%.1f,"
           "\"parameters\":{\"source\":\"esp32-wifi\",\"timeBasis\":\"esp32-ntp\"},"
           "\"Datastream\":{\"@iot.id\":%d}}",
           phenomenonTime, result, datastreamId);

  HTTPClient http;
  http.setTimeout(5000);
  http.begin(String(STA_BASE_URL) + "/Observations");
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  http.end();

  if (code != 201) {
    Serial.printf("{\"error\":\"post_failed\",\"datastream\":%d,\"http\":%d}\n", datastreamId, code);
  }
  return code == 201;
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, NTP_SERVER);  // UTC로 저장한다. 한국 시간 변환은 브라우저가 한다.
  delay(SAMPLE_INTERVAL_MS);
}

void loop() {
  const unsigned long startedAt = millis();
  const float humidity = dht.readHumidity();
  const float temperature = dht.readTemperature();
  const time_t now = time(nullptr);

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("{\"error\":\"dht_read_failed\"}");
  } else if (temperature < 0 || temperature > 50 || humidity < 0 || humidity > 100) {
    Serial.println("{\"error\":\"out_of_range\"}");
  } else {
    Serial.printf("{\"temperature\":%.1f,\"humidity\":%.1f}\n", temperature, humidity);

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("{\"error\":\"wifi_disconnected\"}");
    } else if (now < MIN_VALID_EPOCH) {
      Serial.println("{\"error\":\"ntp_not_synced\"}");
    } else {
      struct tm utc;
      char measuredAt[21];
      gmtime_r(&now, &utc);
      strftime(measuredAt, sizeof(measuredAt), "%Y-%m-%dT%H:%M:%SZ", &utc);

      int posted = 0;
      posted += postObservation(TEMPERATURE_DATASTREAM_ID, temperature, measuredAt);
      posted += postObservation(HUMIDITY_DATASTREAM_ID, humidity, measuredAt);
      Serial.printf("{\"posted\":%d,\"time\":\"%s\"}\n", posted, measuredAt);
    }
  }

  // POST에 걸린 시간을 빼서 측정 주기를 2초로 유지한다.
  const unsigned long elapsed = millis() - startedAt;
  if (elapsed < SAMPLE_INTERVAL_MS) {
    delay(SAMPLE_INTERVAL_MS - elapsed);
  }
}
