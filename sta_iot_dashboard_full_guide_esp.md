# OGC SensorThings API 기반 IoT 실시간 센서 모니터링 웹 — 전체 개발 가이드

> 대상 환경: ESP32 + DHT11 → Wi-Fi(HTTP) → Jetson Orin Nano Super의 FROST-Server + PostgreSQL/PostGIS → Next.js + Chart.js
>
> 기준일: 2026-09-21  
> 검토·수정일: 2026-09-22  
> 목표: 초보자가 빈 폴더에서 시작해 온도·습도 값을 SensorThings API(STA)에 저장하고 웹 대시보드에서 확인한다.

> 검토판: Jetson ARM64, FROST 2.8.0, Next.js 16.3.5 기준으로 예제를 보완했다. 하드웨어 연결 및 Jetson에서의 컨테이너 실행은 사용자의 장비에서 체크리스트로 확인해야 한다. 이 문서의 “정상 출력”은 별도 표시가 없으면 기대 결과다.

---

## 0. 먼저 알아둘 것

### 완성되는 데이터 흐름

```text
DHT11
  │ 온도·습도
  ▼
ESP32 ── Wi-Fi · HTTP POST(STA Observation) ──▶ FROST-Server (STA 1.1)
                                                    (Jetson)
                                             │
                                      PostgreSQL/PostGIS
                                             ▲ HTTP GET
                                             │
                                  Next.js + React + Chart.js
```

### 각 구성요소의 역할

| 구성요소 | 역할 |
|---|---|
| DHT11 | 온도와 상대습도 측정 |
| ESP32 | DHT11을 읽고 값을 검증한 뒤 NTP 시각을 붙여 Wi-Fi로 Observation을 직접 POST |
| Jetson Orin Nano Super | FROST, DB, 선택적으로 웹을 실행 |
| FROST-Server | OGC SensorThings API 1.1 REST 서버 |
| PostgreSQL/PostGIS | FROST 데이터와 위치 정보를 영구 저장 |
| Next.js/React | 브라우저 대시보드 |
| Chart.js | 시간 순서 온도·습도 그래프 |

### 이 가이드의 범위

먼저 다음 최소 기능을 완성한다.

1. ESP32 Serial Monitor에 `{"temperature":25.3,"humidity":61.0}` 출력
2. Jetson의 FROST REST 주소 접속
3. Thing, Location, Sensor, ObservedProperty, Datastream 생성
4. ESP32가 Wi-Fi로 두 Datastream에 Observation 저장
5. 웹에서 최신값 카드와 시계열 그래프 표시

MQTT, 로그인, 알림, AI 분석은 이 경로가 안정적으로 동작한 뒤 추가한다.

유선판과 달리 Jetson에서 도는 Python Collector가 없다. ESP32가 STA 클라이언트 역할을 직접 하므로 USB Serial 포트 권한, `pyserial`, systemd 서비스가 필요 없다. 센서는 Wi-Fi가 닿고 USB 전원만 있으면 어디든 둘 수 있다.

### 명령과 파일 내용 구분

- `bash` 블록은 Jetson의 Bash 터미널에서 실행한다. Arduino IDE 단계만 개발 PC에서 진행한다.
- 파일 경로 바로 아래의 `python`, `tsx`, `yaml`, `dotenv` 등은 **그 경로에 저장할 파일 내용**이다. 터미널 명령이 아니다.
- 파일은 `nano 경로`로 열고, 붙여 넣은 다음 `Ctrl+O`, Enter, `Ctrl+X` 순서로 저장·종료한다.
- `~/sta-iot-dashboard`의 `~`는 현재 사용자의 홈 디렉터리다. `/home/YOUR_USER`는 실제 사용자명으로 바꾼다.
- `JETSON_IP`, 센서 좌표, 시스템 사용자명은 장비마다 다르므로 해당 단계에서 확인 후 입력한다. 예시 IP `192.168.0.50`은 자동으로 감지된 값이 아니다.
- 2초 측정과 약 5초마다 조회하는 **폴링 기반 준실시간** 구성이다. 네트워크 지연이 전혀 없는 실시간 시스템은 아니다.

---

## 1. 준비물

### 하드웨어

- Jetson Orin Nano Super Developer Kit와 전원 어댑터
- microSD 또는 NVMe 저장장치에 설치된 NVIDIA JetPack/Ubuntu
- ESP32 개발보드 (예: ESP32-DevKitC, ESP32-WROOM-32 보드). S3/C3 등 다른 칩이면 핀 번호를 보드 핀맵으로 확인
- DHT11 모듈
  - 3핀 모듈이면 보통 풀업 저항이 보드에 포함됨
- 센서 단품 4핀이면 DATA와 VCC 사이 4.7kΩ~10kΩ 풀업 저항 필요
- 데이터 전송 가능한 USB 케이블 (개발 PC에서 업로드·디버깅용)
- USB 충전기 (설치 후 ESP32 전원용, 5V 1A 이상 권장)
- 점퍼선, 브레드보드
- **2.4GHz** Wi-Fi 공유기. ESP32(오리지널/S3/C3)는 5GHz에 접속하지 못한다
- Jetson, 개발 PC, ESP32가 같은 공유기/LAN에 연결될 것. 게스트 Wi-Fi는 기기 간 통신이 막혀 있는 경우가 많으므로 쓰지 않는다

### 소프트웨어

- 개발 PC: Arduino IDE 2.x, ESP32 보드 패키지(esp32 by Espressif Systems)
- Jetson: Ubuntu, Docker Engine, Docker Compose 플러그인
- 웹 개발: Node.js 현재 LTS와 npm
- 확인 도구: `curl`, 선택적으로 `jq`

### 권장 네트워크 예시

| 장치 | 예시 주소/포트 | 설명 |
|---|---|---|
| Jetson | `192.168.0.50` | 공유기 DHCP 예약으로 고정 권장 |
| FROST HTTP | `192.168.0.50:8080` | REST API |
| Next.js 개발 서버 | `192.168.0.50:3000` | 대시보드 |
| PostgreSQL | Docker 내부 `database:5432` | 외부에 공개하지 않음 |
| ESP32 | DHCP 자동 할당 | FROST로 보내기만 하므로 고정 불필요 |

아래 명령의 `JETSON_IP`는 실제 Jetson IP로 바꾼다. Jetson에서 다음으로 확인한다.

```bash
hostname -I
```

---

## 2. 프로젝트 디렉터리 만들기

Jetson 터미널에서 실행한다.

```bash
mkdir -p ~/sta-iot-dashboard/{esp32/dht11_wifi,infra}
cd ~/sta-iot-dashboard
```

최종 구조는 다음과 같다.

```text
sta-iot-dashboard/
├── .gitignore
├── esp32/dht11_wifi/
│   ├── dht11_wifi.ino
│   ├── secrets.h            # Git 제외 (Wi-Fi 비밀번호)
│   └── secrets.h.example
├── infra/
│   ├── .env
│   ├── Dockerfile.postgis
│   ├── init-postgis.sql
│   ├── create_entities.sh
│   ├── ids.env
│   └── compose.yaml
└── web/
    ├── .env.local
    ├── app/
    │   ├── globals.css
    │   ├── layout.tsx
    │   └── page.tsx
    ├── components/
    │   └── Dashboard.tsx
    └── lib/
        └── sta.ts
```

---

## 3. DHT11 배선

ESP32의 GPIO는 **3.3V 전용**이다. DHT11은 3.3~5.5V에서 동작하므로 VCC를 ESP32의 `3V3`에 연결한다. VCC를 5V(`VIN`/`5V`)에 연결하면 모듈의 풀업 저항 때문에 DATA가 5V가 되어 GPIO를 손상시킬 수 있다.

### 3핀 DHT11 모듈

모듈에 인쇄된 `+`, `OUT` 또는 `S`, `-`를 먼저 확인한다. 제조사마다 핀 순서가 다르므로 색상만 믿지 않는다.

| DHT11 모듈 | ESP32 |
|---|---|
| VCC 또는 `+` | 3V3 |
| DATA/OUT/S | GPIO4 (보드 표기 `D4`, `IO4`, `G4` 등) |
| GND 또는 `-` | GND |

```text
DHT11 VCC  ───────── ESP32 3V3
DHT11 DATA ───────── ESP32 GPIO4
DHT11 GND  ───────── ESP32 GND
```

### 4핀 DHT11 단품

정면의 격자 부분을 바라볼 때 일반적인 순서는 `VCC, DATA, NC, GND`이다. 반드시 구매한 센서 데이터시트를 확인한다.

```text
ESP32 3V3 ────┬──────── DHT11 pin 1 (VCC)
              └─ 10kΩ ─ DHT11 pin 2 (DATA) ─── ESP32 GPIO4
                         DHT11 pin 3 (NC): 연결 안 함
ESP32 GND ──────────── DHT11 pin 4 (GND)
```

전원을 연결한 상태에서 배선을 바꾸지 않는다. DHT11은 빠른 센서가 아니므로 이 가이드에서는 2초 간격으로 읽는다. 3.3V에서는 선이 길면 읽기 실패가 늘어나므로 센서 선은 짧게 유지한다.

GPIO4 대신 다른 핀을 쓸 때 피할 핀:

- GPIO6~11: 내부 플래시 연결
- GPIO0, 2, 12, 15: 부팅 모드 결정(스트래핑) 핀
- GPIO34~39: 입력 전용이라 DHT11의 양방향 통신 불가

Jetson과 ESP32는 선으로 연결하지 않는다. 둘은 Wi-Fi/LAN으로만 통신한다.

---

## 4. ESP32 Arduino IDE 설정과 코드

### 4.1 ESP32 보드 패키지 설치

1. Arduino IDE를 설치하고 실행한다.
2. **Tools → Board → Boards Manager**에서 `esp32`를 검색해 **esp32 by Espressif Systems**를 설치한다.
   - 목록에 없으면 **File → Preferences → Additional boards manager URLs**에 `https://espressif.github.io/arduino-esp32/package_esp32_index.json`을 추가한 뒤 다시 검색한다.
3. USB로 ESP32를 개발 PC에 연결한다.
4. **Tools → Board → esp32**에서 실제 보드를 고른다. 모르겠으면 `ESP32 Dev Module`.
5. **Tools → Port**에서 ESP32 포트를 선택한다. 포트가 보이지 않으면 15절의 업로드 문제를 확인한다.

### 4.2 DHT 라이브러리 설치

Arduino IDE에서 **Tools → Manage Libraries**를 연다.

1. `DHT sensor library` 검색
2. **DHT sensor library by Adafruit** 설치
3. 설치 요청이 나오면 **Adafruit Unified Sensor**도 설치

Wi-Fi, HTTP, NTP 시각 기능은 ESP32 보드 패키지에 포함되어 있으므로 추가 라이브러리는 없다.

### 4.3 스케치 파일 구성

새 스케치를 `dht11_wifi`라는 이름으로 저장한다. 스케치 폴더에 두 파일을 둔다. 탭 오른쪽의 `⋯`(또는 `▾`) → **New Tab**으로 `secrets.h`를 만든다. 나중에 프로젝트의 `esp32/dht11_wifi/` 폴더로 복사해 Git에 보관하되 `secrets.h`는 제외한다.

`secrets.h` — Wi-Fi 비밀번호가 들어가므로 **Git에 올리지 않는다**. 같은 내용에서 비밀번호만 지운 사본을 `secrets.h.example`로 보관한다.

```cpp
#pragma once

#define WIFI_SSID "YOUR_2G_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// localhost가 아니라 Jetson의 LAN IP. ESP32 입장에서 localhost는 ESP32 자신이다.
#define STA_BASE_URL "http://192.168.0.50:8080/FROST-Server/v1.1"
#define NTP_SERVER "pool.ntp.org"

// 9.9절 ids.env의 실제 값으로 10절에서 바꾼다.
constexpr int TEMPERATURE_DATASTREAM_ID = 1;
constexpr int HUMIDITY_DATASTREAM_ID = 2;
```

### 4.4 ESP32 코드

`dht11_wifi.ino`:

```cpp
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
```

### 4.5 1차 업로드 — 센서와 Wi-Fi만 확인

이 시점에는 FROST가 아직 없다. `secrets.h`의 Wi-Fi 이름·비밀번호와 Jetson IP만 실제 값으로 넣고 업로드한다. 업로드 후 Serial Monitor 속도를 `115200 baud`로 맞춘다.

```text
{"temperature":25.3,"humidity":61.0}
{"error":"post_failed","datastream":1,"http":-1}
{"error":"post_failed","datastream":2,"http":-1}
{"posted":0,"time":"2026-09-22T03:00:00Z"}
```

- 온도·습도 줄이 2초마다 나오면 센서 배선은 정상이다.
- `post_failed`의 `http:-1`은 서버에 연결하지 못했다는 뜻이다. FROST를 띄우기 전이므로 지금은 정상이다.
- `wifi_disconnected`가 계속 나오면 Wi-Fi 설정부터 해결한다. 15절 참고.
- `ntp_not_synced`는 부팅 직후 몇 초 동안은 정상이다. 계속되면 15절 참고.

Serial 출력은 사람이 보는 디버그용이다. 실제 데이터는 HTTP로 FROST에 저장된다. 부팅 직후 한 번 나오는 깨진 글자는 ESP32 부트로더 메시지이므로 무시한다.

---

## 5. Jetson Ubuntu 초기 설정

### 5.1 부팅 환경부터 확인

이미 JetPack으로 부팅되는 장비는 재설치하지 않는다. 빈 장비라면 [NVIDIA 초기 설치 안내](https://docs.nvidia.com/jetson/orin-nano-devkit/user-guide/latest/quick_start.html)에서 장비의 펌웨어와 설치할 JetPack에 맞는 절차를 따라 부팅 미디어를 만들고, 사용자 계정·네트워크까지 설정한다. 설치 미디어 기록은 선택한 저장장치를 지우므로 대상 장치를 확인한다. Jetson은 일반 PC용 Ubuntu ISO가 아니라 NVIDIA가 제공하는 Jetson 설치 경로를 사용한다.

이 예제의 기준은 JetPack 6.x 계열 Ubuntu 22.04 이상, Python 3.10 이상이다. Ubuntu 버전만 올리는 `do-release-upgrade`를 이 실습의 선행 조건으로 삼지 않는다. 펌웨어/JetPack 업그레이드는 NVIDIA 지원 절차에 따른다.

Jetson에서 실행한다.

```bash
uname -m
lsb_release -ds
python3 --version
dpkg-query -W nvidia-l4t-core
```

`uname -m`은 `aarch64`여야 한다. Docker 표기는 같은 CPU 계열을 `linux/arm64`라고 부른다.

### 5.2 기본 도구와 시간

```bash
sudo apt update
sudo apt install -y ca-certificates curl git jq nano openssl
```

시간이 틀리면 Observation의 시간도 틀어진다.

```bash
timedatectl
sudo timedatectl set-timezone Asia/Seoul
sudo timedatectl set-ntp true
```

방화벽을 사용하는 경우 LAN에서 필요한 포트만 허용한다. 아래의 `192.168.0.0/24`는 실제 로컬 네트워크 대역으로 바꾼다.

```bash
sudo ufw allow from 192.168.0.0/24 to any port 8080 proto tcp  # ESP32 POST와 브라우저 조회
sudo ufw allow from 192.168.0.0/24 to any port 3000 proto tcp
sudo ufw status
```

UFW가 설치·활성화된 장비에만 위 규칙을 적용한다. SSH로 접속 중이라면 SSH 허용 규칙부터 확인한다. **Docker가 공개한 포트는 UFW 규칙을 우회할 수 있다.** 위 명령만으로 FROST의 접근 제어가 완료되었다고 판단하지 않는다. 학습 중 공유기 포트포워딩을 켜지 말고, 외부 공개 전 Docker의 `DOCKER-USER` 정책 또는 인증을 적용한 프록시를 구성한다. [Docker 공식 방화벽 설명](https://docs.docker.com/engine/install/ubuntu/)

---

## 6. Docker Engine과 Compose 설치

### 6.1 기존 설치 확인

```bash
docker --version
docker compose version
```

둘 다 정상이라면 기존 JetPack/Docker 구성을 유지하고 6.3절로 간다. `docker.io`가 이미 있고 Compose만 없다면 먼저 Ubuntu 저장소의 `docker-compose-v2` 후보가 있는지 확인한다.

```bash
apt-cache policy docker.io docker-compose-v2 docker-ce docker-compose-plugin
```

`docker.io`를 사용하는 장비에 `docker-compose-v2` 후보가 있으면 `sudo apt install docker-compose-v2`로 보완한다. 후보가 없거나 Docker가 전혀 없다면 아래 공식 저장소 경로를 따른다. 배포판의 `docker.io`/`containerd`와 공식 저장소의 `docker-ce`/`containerd.io`를 섞어서 설치하지 않는다. 기존 컨테이너가 있다면 마이그레이션·백업을 먼저 하고 [공식 설치 문서](https://docs.docker.com/engine/install/ubuntu/)의 충돌 패키지 절차를 따른다.

### 6.2 새 설치: Docker 공식 Ubuntu 저장소

Docker가 없는 Ubuntu 장비에서 실행한다. 설치 스크립트를 내려받아 바로 실행하는 방식 대신 apt 서명 키와 저장소를 등록한다.

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "$VERSION_CODENAME" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 6.3 시작과 권한 확인

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

그룹 변경을 적용하려면 로그아웃 후 다시 로그인하거나 Jetson을 재부팅한다. 이후 확인한다.

```bash
docker --version
docker compose version
docker run --rm hello-world
```

`docker` 그룹은 사실상 관리자 권한을 준다. 신뢰하는 사용자만 추가한다. 이 프로젝트는 GPU 컨테이너가 아니므로 NVIDIA Container Toolkit 설정을 바꿀 필요가 없다.

---

## 7. PostgreSQL/PostGIS와 FROST-Server 구축

FROST는 PostgreSQL의 공간 확장인 PostGIS가 필요하다. **`postgis/postgis` 배포 이미지는 공식 README 기준 amd64 전용**이므로 Jetson에서 그대로 사용할 수 없다. ARM64를 지원하는 공식 `postgres:16-bookworm`에 같은 PostGIS 패키지를 설치한다. x86 에뮬레이션은 사용하지 않는다. [PostGIS 지원 아키텍처](https://github.com/postgis/docker-postgis), [PostgreSQL 이미지 아키텍처](https://github.com/docker-library/official-images/blob/master/library/postgres)

### 7.1 비밀값 파일

```bash
cd ~/sta-iot-dashboard/infra
nano .env
```

아래 값을 넣되 비밀번호는 직접 길고 임의의 값으로 바꾼다.

```dotenv
POSTGRES_DB=sensorthings
POSTGRES_USER=sensorthings
POSTGRES_PASSWORD=CHANGE_THIS_TO_A_LONG_RANDOM_PASSWORD
JETSON_IP=192.168.0.50
FROST_IMAGE=fraunhoferiosb/frost-server-http:2.8.0
```

`openssl rand -hex 32`로 생성한 값을 비밀번호 자리에 붙여 넣고 `chmod 600 .env`로 보호한다. 실제 비밀번호는 가이드나 Git에 적지 않는다. `FROST_IMAGE`의 2.8.0 태그는 Docker Hub 메타데이터에서 `linux/arm64` 제공을 확인한 버전이다. [FROST 이미지 정보](https://hub.docker.com/v2/repositories/fraunhoferiosb/frost-server-http/tags/2.8.0/)

### 7.2 ARM64용 PostGIS 이미지

`~/sta-iot-dashboard/infra/Dockerfile.postgis`:

```dockerfile
FROM postgres:16-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-postgis-3 \
    && apt-get clean
COPY init-postgis.sql /docker-entrypoint-initdb.d/10-postgis.sql
```

`~/sta-iot-dashboard/infra/init-postgis.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

초기화 SQL은 **빈 볼륨으로 처음 시작할 때만** 실행된다. 이 가이드는 기본 숫자 ID를 사용하므로 UUID 확장은 필요 없다. [FROST DB 요구사항](https://fraunhoferiosb.github.io/FROST-Server/deployment/postgresql.html)

### 7.3 Compose 파일

`~/sta-iot-dashboard/infra/compose.yaml`:

```yaml
services:
  database:
    build:
      context: .
      dockerfile: Dockerfile.postgis
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:?Set POSTGRES_DB in .env}
      POSTGRES_USER: ${POSTGRES_USER:?Set POSTGRES_USER in .env}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
    volumes:
      - postgis_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -d \"$$POSTGRES_DB\" -U \"$$POSTGRES_USER\""]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  frost:
    image: ${FROST_IMAGE:?Set FROST_IMAGE in .env}
    restart: unless-stopped
    depends_on:
      database:
        condition: service_healthy
    ports:
      - "8080:8080"
    environment:
      serviceRootUrl: http://${JETSON_IP:?Set JETSON_IP in .env}:8080/FROST-Server
      http_cors_enable: "true"
      http_cors_allowed_origins: "http://localhost:3000,http://${JETSON_IP}:3000"
      http_cors_allowed_methods: "GET,HEAD,OPTIONS"
      persistence_db_driver: org.postgresql.Driver
      persistence_db_url: jdbc:postgresql://database:5432/${POSTGRES_DB}
      persistence_db_username: ${POSTGRES_USER}
      persistence_db_password: ${POSTGRES_PASSWORD}
      persistence_autoUpdateDatabase: "true"

volumes:
  postgis_data:
```

중요:

- `.env`의 `192.168.0.50`은 실제 Jetson IP로 바꾼다.
- `serviceRootUrl`은 응답에 들어가는 링크의 기준 주소다. 다른 PC에서도 링크를 따라가야 한다면 `http://JETSON_IP:8080/FROST-Server`로 바꾼다.
- FROST는 버전 태그를 고정했다. `postgres:16-bookworm`은 같은 메이저의 보안 패치를 받으므로 빌드마다 패치 버전이 달라질 수 있다. 운영에서는 검증한 이미지 digest도 기록한다.
- DB 포트 `5432`는 호스트에 공개하지 않았다.

### 7.4 시작과 상태 확인

```bash
cd ~/sta-iot-dashboard/infra
docker compose config --quiet
docker manifest inspect postgres:16-bookworm | jq -r '.manifests[].platform | "\(.os)/\(.architecture)"'
docker manifest inspect fraunhoferiosb/frost-server-http:2.8.0 | jq -r '.manifests[].platform | "\(.os)/\(.architecture)"'
docker compose pull frost
docker compose build database
docker compose up -d
docker compose ps
docker compose logs --tail=100 frost
```

Jetson 자체에서 확인한다.

```bash
curl -sS http://localhost:8080/FROST-Server/v1.1 | jq
```

개발 PC에서는 다음 주소를 브라우저로 연다.

```text
http://JETSON_IP:8080/FROST-Server/v1.1
```

`Things`, `Locations`, `Datastreams`, `Observations`, `ObservedProperties`, `Sensors` 등의 엔티티 집합이 보이면 정상이다.

DB 확장도 확인한다. 시작 직후 FROST 스키마 생성에는 시간이 걸릴 수 있다.

```bash
docker compose exec database psql -U sensorthings -d sensorthings -c 'SELECT PostGIS_Version();'
```

`config --quiet`는 Compose 구문·변수 확인이고 `SELECT`는 실제 DB 확인이다. 둘을 구분한다. 일반 `docker compose config`는 비밀번호까지 출력할 수 있으므로 로그 공유에 사용하지 않는다. 이전 볼륨을 재사용해 `postgis` 확장이 없다면 같은 DB에서 `CREATE EXTENSION IF NOT EXISTS postgis;`를 실행하고 FROST를 재시작한다. 볼륨을 삭제할 필요는 없다.

### 자주 쓰는 운영 명령

```bash
cd ~/sta-iot-dashboard/infra
docker compose ps
docker compose logs -f --tail=100 frost
docker compose restart frost
docker compose stop
docker compose start
```

데이터까지 지우는 `docker compose down -v`는 이 가이드의 일반 재시작에 사용하지 않는다. `-v`는 PostgreSQL 볼륨을 삭제한다.

---

## 8. SensorThings API 핵심 엔티티

STA Sensing 1.1의 핵심 관계를 DHT11 예제로 단순화하면 다음과 같다.

```text
Thing: Arduino Room Sensor
├── Location: Lab Desk
├── Datastream: Temperature
│   ├── Sensor: DHT11 temperature procedure
│   ├── ObservedProperty: Air temperature
│   └── Observation: 25.3 °C at time T
└── Datastream: Humidity
    ├── Sensor: DHT11 humidity procedure
    ├── ObservedProperty: Relative humidity
    └── Observation: 61.0 % at time T
```

| 엔티티 | 뜻 | 이 프로젝트의 예 |
|---|---|---|
| Thing | 식별 가능한 물리/가상 대상 | DHT11이 연결된 Arduino 노드 |
| Location | Thing이 있는 장소 | 연구실 책상 위치 |
| Sensor | 관측을 만드는 절차/센서 설명 | DHT11의 온도 또는 습도 측정 절차 |
| ObservedProperty | 무엇을 관측하는지 | 공기 온도, 상대습도 |
| Datastream | 같은 Thing·Sensor·ObservedProperty의 관측 묶음 | 온도 스트림, 습도 스트림 |
| Observation | 특정 시점의 실제 결과 | `25.3`, `61.0` |
| FeatureOfInterest | 관측 대상 | FROST가 Datastream의 Thing에서 자동 생성 가능 |

DHT11 한 장치여도 온도와 습도는 서로 다른 ObservedProperty이므로 Datastream을 두 개 만든다.

---

## 9. STA 엔티티 생성

### 9.1 API 기준 주소 설정

Jetson 터미널에서 실행한다.

```bash
export STA_URL='http://localhost:8080/FROST-Server/v1.1'
```

이 절의 짧은 개별 `curl`은 데이터 모델을 읽어 보는 예시다. **실제 초기 등록은 아래 9.9절의 스크립트 한 번으로 진행하는 것을 권장한다.** 9.2~9.8을 수동 실행한 뒤 9.9를 다시 실행하면 같은 이름의 엔티티가 중복된다. 기본 ID `1`, `2`는 보장되지 않으며 엔티티 집합마다 독립적으로 발급된다.

각 POST가 성공하면 `201 Created`와 `Location` 응답 헤더가 온다. 아래 명령은 헤더까지 보여준다.

### 9.2 Thing 생성

```bash
curl -i -X POST "$STA_URL/Things" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "ESP32 Room Sensor",
    "description": "ESP32 and DHT11 posting to FROST over Wi-Fi",
    "properties": {
      "deviceType": "ESP32",
      "transport": "Wi-Fi HTTP"
    }
  }'
```

생성된 ID를 확인한다.

```bash
curl -sS "$STA_URL/Things?%24select=%40iot.id,name" | jq
```

아래 단계에서는 예시로 Thing ID를 `1`이라 가정한다. 실제 출력이 다르면 숫자를 바꾼다.

### 9.3 Location 생성과 Thing 연결

GeoJSON의 좌표 순서는 `[경도, 위도]`다. 아래 서울 좌표는 예시이므로 실제 위치로 바꾼다. 공개 저장소에 집의 정밀 좌표를 올리지 않는다.

```bash
curl -i -X POST "$STA_URL/Locations" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Lab Desk",
    "description": "Indoor test location",
    "encodingType": "application/vnd.geo+json",
    "location": {
      "type": "Point",
      "coordinates": [126.9780, 37.5665]
    },
    "Things": [
      {"@iot.id": 1}
    ]
  }'
```

### 9.4 온도 Sensor 생성

```bash
curl -i -X POST "$STA_URL/Sensors" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "DHT11 Temperature Sensor",
    "description": "DHT11 temperature measurement procedure",
    "encodingType": "application/pdf",
    "metadata": "https://cdn-shop.adafruit.com/datasheets/DHT11-chinese.pdf"
  }'
```

### 9.5 습도 Sensor 생성

```bash
curl -i -X POST "$STA_URL/Sensors" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "DHT11 Humidity Sensor",
    "description": "DHT11 relative humidity measurement procedure",
    "encodingType": "application/pdf",
    "metadata": "https://cdn-shop.adafruit.com/datasheets/DHT11-chinese.pdf"
  }'
```

ID 확인:

```bash
curl -sS "$STA_URL/Sensors?%24select=%40iot.id,name" | jq
```

이후 예시는 온도 Sensor ID `1`, 습도 Sensor ID `2`를 가정한다.

### 9.6 ObservedProperty 생성

온도:

```bash
curl -i -X POST "$STA_URL/ObservedProperties" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Air Temperature",
    "description": "Ambient air temperature",
    "definition": "https://qudt.org/vocab/quantitykind/Temperature"
  }'
```

습도:

```bash
curl -i -X POST "$STA_URL/ObservedProperties" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Relative Humidity",
    "description": "Relative humidity of ambient air",
    "definition": "https://qudt.org/vocab/quantitykind/RelativeHumidity"
  }'
```

ID 확인:

```bash
curl -sS "$STA_URL/ObservedProperties?%24select=%40iot.id,name" | jq
```

이후 예시는 온도 ObservedProperty ID `1`, 습도 ID `2`를 가정한다.

### 9.7 Datastream 생성

온도 Datastream:

```bash
curl -i -X POST "$STA_URL/Datastreams" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Room Temperature",
    "description": "Temperature measured by DHT11 every two seconds",
    "observationType": "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement",
    "unitOfMeasurement": {
      "name": "degree Celsius",
      "symbol": "°C",
      "definition": "https://qudt.org/vocab/unit/DEG_C"
    },
    "Thing": {"@iot.id": 1},
    "Sensor": {"@iot.id": 1},
    "ObservedProperty": {"@iot.id": 1}
  }'
```

습도 Datastream:

```bash
curl -i -X POST "$STA_URL/Datastreams" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Room Humidity",
    "description": "Relative humidity measured by DHT11 every two seconds",
    "observationType": "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement",
    "unitOfMeasurement": {
      "name": "percent",
      "symbol": "%",
      "definition": "https://qudt.org/vocab/unit/PERCENT"
    },
    "Thing": {"@iot.id": 1},
    "Sensor": {"@iot.id": 2},
    "ObservedProperty": {"@iot.id": 2}
  }'
```

실제 Datastream ID를 기록한다.

```bash
curl -sS "$STA_URL/Datastreams?%24select=%40iot.id,name" | jq
```

이후 예시는 온도 `1`, 습도 `2`를 가정한다.

### 9.8 Observation 수동 POST 구조 예시

아래 날짜는 JSON 구조를 보여 주기 위한 과거 예시다. 최신값 카드 검증에는 9.9절의 **현재 UTC 시각 테스트**를 사용한다. 예시 날짜를 미래로 수정하면 그 Observation이 최신값으로 계속 선택될 수 있다.

온도:

```bash
curl -i -X POST "$STA_URL/Observations" \
  -H 'Content-Type: application/json' \
  -d '{
    "phenomenonTime": "2026-09-21T03:00:00Z",
    "result": 25.3,
    "Datastream": {"@iot.id": 1}
  }'
```

습도:

```bash
curl -i -X POST "$STA_URL/Observations" \
  -H 'Content-Type: application/json' \
  -d '{
    "phenomenonTime": "2026-09-21T03:00:00Z",
    "result": 61.0,
    "Datastream": {"@iot.id": 2}
  }'
```

최신값 확인:

```bash
curl -sS "$STA_URL/Datastreams(1)/Observations?%24orderby=phenomenonTime%20desc&%24top=1" | jq
curl -sS "$STA_URL/Datastreams(2)/Observations?%24orderby=phenomenonTime%20desc&%24top=1" | jq
```

`201 Created`가 아니면 ESP32를 연결하기 전에 이 단계부터 해결한다.

### 9.9 실제 실행용: 발급된 ID 자동 연결

`~/sta-iot-dashboard/infra/create_entities.sh`를 만들고 아래 내용을 저장한다. 빈 학습용 서버에서 **한 번** 실행한다. 성공하면 비밀정보가 없는 `ids.env`에 실제 ID가 기록된다. 일부 POST 후 실패한 경우에는 이미 생성된 엔티티가 남으므로 목록을 확인한 다음 이어서 등록한다. 무작정 재실행하면 중복된다.

```bash
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
```

실행:

```bash
cd ~/sta-iot-dashboard/infra
bash create_entities.sh
source ./ids.env
export STA_URL='http://localhost:8080/FROST-Server/v1.1'
```

`Prefer: return=representation`은 생성된 엔티티 JSON을 응답받기 위한 헤더다. ID 추출에 실패하면 다음 생성 단계가 실행되지 않는다. [FROST 엔티티 생성 문서](https://fraunhoferiosb.github.io/FROST-Server/sensorthingsapi/deploy/1_CreatingEntities.html)

현재 시각으로 온도·습도 테스트 값을 넣는다. **이 값은 실제 센서 측정이 아닌 수동 테스트**이며 `parameters.source`로 표시한다.

```bash
MEASURED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for pair in "$TEMPERATURE_DATASTREAM_ID:25.3" "$HUMIDITY_DATASTREAM_ID:61.0"; do
  jq -n --arg time "$MEASURED_AT" --argjson id "${pair%%:*}" --argjson value "${pair#*:}" '{
    phenomenonTime: $time, result: $value,
    parameters: {source: "manual-test"}, Datastream: {"@iot.id": $id}
  }' | curl --fail-with-body -i -X POST "$STA_URL/Observations" \
    -H 'Content-Type: application/json' --data-binary @-
done

curl --fail-with-body -sS --get "$STA_URL/Datastreams($TEMPERATURE_DATASTREAM_ID)/Observations" \
  --data-urlencode '$orderby=phenomenonTime desc' --data-urlencode '$top=1' | jq
```

Observation에는 FeatureOfInterest도 연결된다. 이 고정형 실습은 GeoJSON Location이 있는 Thing으로부터 FROST가 이를 생성하도록 맡긴다. Location이 없으면 자동 생성이 실패할 수 있다. 이동형 센서에서는 **센서 위치(Location)**와 **실제 관측 대상(FeatureOfInterest)**이 다를 수 있으므로 구분해서 등록한다. Thing 위치 변경 이력은 HistoricalLocation으로 연결된다. [STA 1.1 데이터 모델](https://docs.ogc.org/is/18-088/18-088.html)

---

## 10. ESP32 Wi-Fi 전송 연결

### 10.1 실제 Datastream ID 반영

Jetson에서 9.9절이 만든 ID를 확인한다.

```bash
cat ~/sta-iot-dashboard/infra/ids.env
```

개발 PC의 Arduino IDE에서 `secrets.h`의 두 ID를 위 `TEMPERATURE_DATASTREAM_ID`, `HUMIDITY_DATASTREAM_ID` 값으로 바꾼다. `STA_BASE_URL`의 IP가 실제 Jetson IP인지 다시 확인한다.

개발 PC 브라우저에서 아래 주소가 열려야 ESP32도 접속할 수 있다. 같은 공유기에 있는 기기 기준 확인이다.

```text
http://JETSON_IP:8080/FROST-Server/v1.1
```

### 10.2 업로드와 확인

다시 업로드하고 Serial Monitor를 연다. 정상 예시:

```text
{"temperature":25.3,"humidity":61.0}
{"posted":2,"time":"2026-09-22T03:00:02Z"}
```

Jetson에서 저장 결과를 확인한다. `parameters.source`가 `esp32-wifi`인 Observation이 2초마다 늘어나야 한다.

```bash
source ~/sta-iot-dashboard/infra/ids.env
curl -sS --get "http://localhost:8080/FROST-Server/v1.1/Datastreams($TEMPERATURE_DATASTREAM_ID)/Observations" \
  --data-urlencode '$orderby=phenomenonTime desc' --data-urlencode '$top=3' | jq
```

### 10.3 USB에서 분리해 무선으로 운영

1. Serial Monitor를 닫고 개발 PC에서 USB 케이블을 뽑는다.
2. ESP32를 USB 충전기에 연결해 원하는 위치에 둔다.
3. 약 10초 뒤 위 `curl`을 다시 실행해 새 Observation이 계속 들어오는지 확인한다.

스케치는 ESP32 플래시에 저장되어 전원만 들어오면 자동 실행된다. 유선판의 systemd 설정에 해당하는 작업이 따로 필요 없다.

### 코드가 처리하는 실패

- DHT11 읽기 실패(`NaN`): 저장하지 않음
- DHT11 범위(0~50°C, 0~100%)를 벗어난 값: 저장하지 않음
- Wi-Fi 끊김: 저장하지 않고, ESP32가 백그라운드에서 자동 재접속
- NTP 미동기화: 1970년 시각으로 저장하지 않음
- HTTP 4xx/5xx 또는 5초 타임아웃: Serial에 오류를 남기고 다음 측정 진행
- 동일 샘플의 온도·습도: 같은 UTC `phenomenonTime` 사용

두 POST는 독립적으로 시도하므로 첫 번째만 성공할 수 있다. `posted:2`일 때 두 값이 모두 저장된 것이다. **Wi-Fi나 FROST가 끊긴 동안의 측정값은 ESP32에 보관하지 않으므로 누락된다.** 무작정 재시도하면 서버가 저장한 뒤 응답만 끊긴 경우 중복될 수 있다. 유실을 줄이려면 ESP32 메모리 큐와 중복 식별 키를 함께 설계한다.

유선판과 달리 `phenomenonTime`은 수신 시각이 아니라 **ESP32가 NTP로 맞춘 시계의 측정 시각**이다. NTP 오차(보통 수십 ms 이하)만큼 차이가 날 수 있다. [DHT11의 일반 범위는 0~50°C, 20~80% RH](https://learn.adafruit.com/dht/overview)이며 구매한 부품의 사양이 우선이다. 소수점 한 자리 표시는 센서가 0.1°C 정확도를 가진다는 뜻이 아니다.

---

## 11. Next.js 대시보드 만들기

### 11.0 Node.js 설치

기존 Node.js가 24.x라면 설치를 건너뛰고 버전만 확인한다. 새 설치는 사용자 계정의 nvm으로 Node.js 24 LTS를 설치한다. nvm은 여러 Node.js 버전을 관리하는 도구다. 설치 파일은 [nvm 공식 저장소](https://github.com/nvm-sh/nvm)에서 받아 내용을 확인한 뒤 실행한다. `sudo npm`은 사용하지 않는다.

```bash
cd ~/sta-iot-dashboard
curl -fsSLo /tmp/sta-nvm-install.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh
less /tmp/sta-nvm-install.sh
bash /tmp/sta-nvm-install.sh
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
nvm alias default 24
```

`less`는 `q`로 종료한다. Node.js 24는 Next.js 16의 최소 Node.js 요구사항(20.9 이상)을 충족한다. [Next.js 설치 요구사항](https://nextjs.org/docs/app/getting-started/installation)

```bash
node --version
npm --version
```

### 11.1 프로젝트 생성

```bash
cd ~/sta-iot-dashboard
npx create-next-app@16.3.5 web --ts --eslint --app --no-src-dir --no-tailwind --no-react-compiler --no-agents-md --use-npm --disable-git --import-alias '@/*' --yes
cd web
npm install --save-exact chart.js@4.5.1 react-chartjs-2@5.3.1
mkdir -p lib components
```

`--no-src-dir`로 루트 `app/` 경로를 선택하고, `--no-tailwind`로 일반 CSS를 사용한다. `--disable-git`은 `web/`에 별도 Git 저장소가 생기는 것을 막는다. `web`에 이미 다른 프로젝트가 있으면 덮어쓰지 말고 기존 파일과 경로를 확인한다. 버전 재현에는 생성된 `package-lock.json`을 커밋하고 이후 `npm ci`를 사용한다. [공식 CLI 옵션](https://nextjs.org/docs/app/api-reference/cli/create-next-app)

### 11.2 환경변수

`web/.env.local`:

```dotenv
NEXT_PUBLIC_STA_BASE_URL=http://192.168.0.50:8080/FROST-Server/v1.1
NEXT_PUBLIC_TEMPERATURE_DATASTREAM_ID=1
NEXT_PUBLIC_HUMIDITY_DATASTREAM_ID=2
NEXT_PUBLIC_REFRESH_MS=5000
```

- `192.168.0.50`을 실제 Jetson IP로 바꾼다.
- ID는 9.7절에서 조회한 실제 값으로 바꾼다.
- `NEXT_PUBLIC_` 값은 브라우저 번들에 공개된다. 비밀번호나 API 키를 절대 넣지 않는다.
- `.env.local` 변경 후 개발 서버를 재시작한다.
- 프로덕션의 `NEXT_PUBLIC_` 값은 빌드 시 들어간다. 변경한 뒤 `npm run build`도 다시 실행한다.

9.9절에서 자동 생성한 ID를 쓰려면 다음처럼 만들고 IP를 수정한다.

```bash
cd ~/sta-iot-dashboard/web
source ../infra/ids.env
printf 'NEXT_PUBLIC_STA_BASE_URL=http://192.168.0.50:8080/FROST-Server/v1.1\nNEXT_PUBLIC_TEMPERATURE_DATASTREAM_ID=%s\nNEXT_PUBLIC_HUMIDITY_DATASTREAM_ID=%s\nNEXT_PUBLIC_REFRESH_MS=5000\n' \
  "$TEMPERATURE_DATASTREAM_ID" "$HUMIDITY_DATASTREAM_ID" > .env.local
nano .env.local
```

### 11.3 STA API 호출 코드

`web/lib/sta.ts`:

```ts
export type Observation = {
  "@iot.id": number;
  phenomenonTime: string;
  result: number;
};

function isObservation(value: unknown): value is Observation {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return Number.isSafeInteger(item["@iot.id"]) &&
    typeof item.phenomenonTime === "string" &&
    Number.isFinite(Date.parse(item.phenomenonTime)) &&
    typeof item.result === "number" && Number.isFinite(item.result);
}

export async function getObservations(
  datastreamId: number,
  limit = 60,
  signal?: AbortSignal,
): Promise<Observation[]> {
  const baseUrl = process.env.NEXT_PUBLIC_STA_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    throw new Error("NEXT_PUBLIC_STA_BASE_URL must be an HTTP(S) URL");
  }
  if (!Number.isSafeInteger(datastreamId) || datastreamId <= 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Invalid Datastream ID or query limit");
  }
  const query = new URLSearchParams({
    "$select": "@iot.id,phenomenonTime,result",
    "$orderby": "phenomenonTime desc,@iot.id desc",
    "$top": String(limit),
  });
  const response = await fetch(
    `${baseUrl}/Datastreams(${datastreamId})/Observations?${query}`,
    { cache: "no-store", signal },
  );

  if (!response.ok) {
    throw new Error(`STA request failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  if (typeof data !== "object" || data === null || !("value" in data) ||
      !Array.isArray(data.value) || !data.value.every(isObservation)) {
    throw new Error("Unexpected STA response: expected numeric observations with instant timestamps");
  }
  return data.value.reverse();
}
```

FROST에서 최신값부터 받고 `reverse()`해 과거→최신 순서로 넘긴다. 같은 시각이면 ID로 순서를 정한다. 이 웹은 이 가이드의 **숫자 결과·시점형 시간**을 가진 Datastream을 대상으로 한다. STA가 허용하는 문자열 결과나 시간 구간(`start/end`)까지 처리하는 범용 뷰어는 아니다.

### 11.4 카드와 Chart.js 그래프

`web/components/Dashboard.tsx`:

```tsx
"use client";

import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import type { ChartOptions } from "chart.js";
import { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import { getObservations, type Observation } from "@/lib/sta";

ChartJS.register(
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
);

const temperatureId = Number(
  process.env.NEXT_PUBLIC_TEMPERATURE_DATASTREAM_ID,
);
const humidityId = Number(process.env.NEXT_PUBLIC_HUMIDITY_DATASTREAM_ID);
const refreshMs = Number(process.env.NEXT_PUBLIC_REFRESH_MS ?? 5000);
const staleMs = 15_000;

const chartOptions: ChartOptions<"line"> = {
  responsive: true,
  animation: false,
  parsing: false,
  scales: {
    x: {
      type: "linear",
      ticks: {
        maxTicksLimit: 6,
        callback: (value) => new Date(Number(value)).toLocaleTimeString("ko-KR"),
      },
    },
  },
  plugins: {
    tooltip: {
      callbacks: {
        title: (items) => {
          const time = items[0]?.parsed.x;
          return time == null ? "" : new Date(time).toLocaleString("ko-KR");
        },
      },
    },
  },
};

function latest(items: Observation[]): Observation | undefined {
  return items.at(-1);
}

function chartData(
  label: string,
  items: Observation[],
  color: string,
) {
  return {
    datasets: [
      {
        label,
        data: items.map((item) => ({ x: Date.parse(item.phenomenonTime), y: item.result })),
        borderColor: color,
        backgroundColor: color,
        tension: 0,
      },
    ],
  };
}

export default function Dashboard() {
  const [temperature, setTemperature] = useState<Observation[]>([]);
  const [humidity, setHumidity] = useState<Observation[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function load() {
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 10_000);
      try {
        if (!Number.isFinite(refreshMs) || refreshMs < 1000 || temperatureId === humidityId) {
          throw new Error("Use distinct Datastream IDs and refresh interval >= 1000 ms");
        }
        const [nextTemperature, nextHumidity] = await Promise.all([
          getObservations(temperatureId, 60, request.signal),
          getObservations(humidityId, 60, request.signal),
        ]);
        if (!stopped) {
          setTemperature(nextTemperature);
          setHumidity(nextHumidity);
          setError("");
        }
      } catch (cause) {
        request.abort();
        if (!stopped) setError(cause instanceof Error ? cause.message : "Unknown error");
      } finally {
        clearTimeout(timeout);
        if (!stopped) {
          setLoading(false);
          setCheckedAt(Date.now());
          timer = setTimeout(() => void load(), Number.isFinite(refreshMs) ? Math.max(1000, refreshMs) : 5000);
        }
      }
    }

    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  const latestTemperature = latest(temperature);
  const latestHumidity = latest(humidity);
  const recent = [latestTemperature, latestHumidity];
  const missing = recent.some((item) => !item);
  const ages = recent.map((item) => item ? checkedAt - Date.parse(item.phenomenonTime) : Infinity);
  const clockError = ages.some((age) => age < -10_000);
  const stale = ages.some((age) => age > staleMs);
  const status = error ? `API 연결 오류 · 이전 수신값 표시: ${error}`
    : missing ? "API 연결됨 · 아직 센서 데이터 없음"
    : clockError ? "관측 시간이 미래입니다 · 장비 시각 확인"
    : stale ? "API 연결됨 · 센서 값이 15초 이상 갱신되지 않음"
    : "최근 온도·습도 관측 수신";

  if (loading) return <main><p>센서 데이터를 불러오는 중입니다.</p></main>;

  return (
    <main>
      <header>
        <p className="eyebrow">OGC SensorThings API</p>
        <h1>환경 센서 대시보드</h1>
        <p className={error || missing || stale || clockError ? "status error" : "status"} role="status">
          {status}
        </p>
      </header>

      <section className="cards" aria-label="최신 센서 값">
        <article className="card">
          <h2>온도</h2>
          <strong>{latestTemperature?.result ?? "-"} °C</strong>
          <small>{latestTemperature ? new Date(latestTemperature.phenomenonTime).toLocaleString("ko-KR") : "데이터 없음"}</small>
        </article>
        <article className="card">
          <h2>습도</h2>
          <strong>{latestHumidity?.result ?? "-"} %</strong>
          <small>{latestHumidity ? new Date(latestHumidity.phenomenonTime).toLocaleString("ko-KR") : "데이터 없음"}</small>
        </article>
      </section>

      <section className="charts" aria-label="센서 시계열 그래프">
        <article className="chart">
          <h2>최근 온도</h2>
          <Line options={chartOptions} data={chartData("온도 °C", temperature, "#ef4444")} role="img" aria-label="온도 시간별 그래프" />
        </article>
        <article className="chart">
          <h2>최근 습도</h2>
          <Line options={chartOptions} data={chartData("습도 %", humidity, "#3b82f6")} role="img" aria-label="습도 시간별 그래프" />
        </article>
      </section>
    </main>
  );
}
```

`web/app/page.tsx`:

```tsx
import Dashboard from "@/components/Dashboard";

export default function Home() {
  return <Dashboard />;
}
```

`web/app/globals.css`를 다음으로 교체한다.

```css
:root {
  color-scheme: dark;
  font-family: Arial, Helvetica, sans-serif;
  background: #07111f;
  color: #e5edf7;
}

* { box-sizing: border-box; }
body { margin: 0; background: #07111f; }
main { width: min(1100px, 92vw); margin: 0 auto; padding: 48px 0; }
header { margin-bottom: 28px; }
h1 { margin: 4px 0 12px; font-size: clamp(2rem, 5vw, 3.5rem); }
h2 { margin-top: 0; font-size: 1rem; color: #aebdd0; }
.eyebrow { margin: 0; color: #60a5fa; font-weight: 700; letter-spacing: .08em; }
.status { color: #4ade80; }
.status.error { color: #f87171; }
.cards, .charts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
.cards { margin-bottom: 18px; }
.card, .chart { padding: 22px; border: 1px solid #203047; border-radius: 16px; background: #0d1b2d; }
.card strong { display: block; margin: 12px 0; font-size: 2.4rem; }
.card small { color: #91a2b8; }
.chart { min-width: 0; }

@media (max-width: 720px) {
  .cards, .charts { grid-template-columns: 1fr; }
}
```

`web/app/layout.tsx`에서 metadata와 lang을 정리한다.

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "STA Sensor Dashboard",
  description: "OGC SensorThings API environmental sensor dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

### 11.5 실행과 확인

```bash
cd ~/sta-iot-dashboard/web
npm run dev -- --hostname 0.0.0.0
```

Jetson에서:

```text
http://localhost:3000
```

같은 LAN의 개발 PC에서:

```text
http://JETSON_IP:3000
```

검사와 프로덕션 빌드:

```bash
npx eslint .
npm run build
```

Next.js 16의 `next build`는 lint를 대신 실행하지 않는다. ESLint와 빌드를 각각 확인한다. [Next.js ESLint 문서](https://nextjs.org/docs/app/api-reference/config/eslint)

빌드가 성공한 뒤 서비스용으로 띄우려면 개발 서버를 종료하고 다음을 실행한다. 이 명령은 자동 부팅 설정까지 만들지는 않는다.

```bash
npm run start -- --hostname 0.0.0.0
```

그래프는 별도 날짜 어댑터 없이 Unix 밀리초 숫자를 가로축으로 사용한다. 그래서 측정 간격이 달라져도 실제 시간 간격을 반영한다. API 요청은 이전 요청이 끝난 뒤 5초 후 다시 시작해 겹치지 않으며, 10초를 넘기면 취소한다. “수신” 표시는 실제 관측 시간이 15초 이내인지로 판단한다. 브라우저 시각도 동기화되어 있어야 한다.

---

## 12. 자주 쓰는 STA 조회 쿼리

셸에서는 `$`가 변수로 해석되지 않게 URL 전체를 작은따옴표로 감싼다.

### 최신 Observation 1개

```bash
curl -sS 'http://localhost:8080/FROST-Server/v1.1/Datastreams(1)/Observations?$orderby=phenomenonTime%20desc&$top=1' | jq
```

### 최근 60개 중 필요한 필드만

```bash
curl -sS 'http://localhost:8080/FROST-Server/v1.1/Datastreams(1)/Observations?$select=phenomenonTime,result&$orderby=phenomenonTime%20desc&$top=60' | jq
```

### 특정 시각 이후 데이터

```bash
curl -sS 'http://localhost:8080/FROST-Server/v1.1/Datastreams(1)/Observations?$filter=phenomenonTime%20ge%202026-09-21T00:00:00Z&$orderby=phenomenonTime%20asc' | jq
```

### Datastream과 관련 엔티티 함께 조회

```bash
curl -sS 'http://localhost:8080/FROST-Server/v1.1/Datastreams?$expand=Thing,Sensor,ObservedProperty&$top=10' | jq
```

### 옵션 의미

| 옵션 | 의미 |
|---|---|
| `$top=10` | 최대 10개 반환 |
| `$orderby=phenomenonTime desc` | 최신 시각부터 정렬 |
| `$select=result,phenomenonTime` | 필요한 필드만 반환 |
| `$filter=...` | 조건에 맞는 데이터만 반환 |
| `$expand=Thing` | 관련 엔티티를 응답에 포함 |
| `$skip=10` | 앞의 10개 건너뜀; 큰 데이터에서는 서버의 nextLink 권장 |

응답에 `@iot.nextLink`가 있으면 다음 페이지가 있다는 뜻이다.

---

## 13. CORS 문제 해결

CORS는 브라우저가 다른 출처(origin)의 API를 호출할 때 서버 허용 여부를 검사하는 보안 규칙이다. `http://192.168.0.50:3000`과 `http://192.168.0.50:8080`은 포트가 달라 서로 다른 출처다.

### 증상

- `curl`은 성공하지만 브라우저에서만 실패
- 개발자 도구 Console에 `blocked by CORS policy`
- Network 탭의 요청이 차단됨

### 해결

`infra/compose.yaml`의 FROST 환경변수에 실제 프론트 주소가 들어 있는지 확인한다.

```yaml
http_cors_enable: "true"
http_cors_allowed_origins: "http://localhost:3000,http://192.168.0.50:3000"
```

수정 후 컨테이너를 다시 만든다.

```bash
cd ~/sta-iot-dashboard/infra
docker compose up -d --force-recreate frost
docker compose logs --tail=100 frost
```

개발 중 원인 분리를 위해 잠시 `*`를 쓸 수 있지만, 운영에서는 실제 허용 주소만 적는다. CORS를 바꿔도 서버 인증을 대신하지는 않는다.

---

## 14. 처음부터 끝까지 테스트 순서

각 단계를 통과한 뒤 다음으로 넘어간다.

### 1단계 — 센서 단독

```text
[ ] DHT11 VCC가 3V3, DATA가 GPIO4인지 재확인
[ ] ESP32 업로드 성공
[ ] Serial Monitor 115200 baud
[ ] 2초마다 유효한 온도·습도 JSON 출력
[ ] 손으로 센서를 감쌌을 때 값 변화
```

### 2단계 — ESP32 Wi-Fi

```text
[ ] 2.4GHz SSID 사용, wifi_disconnected가 사라짐
[ ] ntp_not_synced가 부팅 후 수 초 안에 사라짐
[ ] 개발 PC 브라우저에서 http://JETSON_IP:8080/FROST-Server/v1.1 열림
```

### 3단계 — FROST와 DB

```text
[ ] docker compose ps에서 database healthy
[ ] frost가 Up 상태
[ ] curl http://localhost:8080/FROST-Server/v1.1 성공
[ ] POST 테스트가 201 Created
```

### 4단계 — STA 모델

```text
[ ] Thing 1개
[ ] Location 1개와 Thing 연결
[ ] Sensor 2개
[ ] ObservedProperty 2개
[ ] Datastream 2개
[ ] 실제 ID를 secrets.h와 web/.env.local에 기록
```

### 5단계 — 자동 수집

```text
[ ] Serial Monitor에 "posted":2 표시
[ ] USB 충전기 전원만으로도 Observation이 계속 쌓임
[ ] 온도 최신 Observation 조회 성공
[ ] 습도 최신 Observation 조회 성공
[ ] 두 Observation의 시간이 일치
```

### 6단계 — 웹

```text
[ ] .env.local의 Jetson IP와 ID 정확
[ ] npm run dev 실행
[ ] 최신값 카드 표시
[ ] 그래프가 시간 순서로 표시
[ ] 5초마다 새 데이터 반영
[ ] npx eslint . 성공
[ ] npm run build 성공
```

---

## 15. 자주 발생하는 오류와 해결

### `DHT.h: No such file or directory`

원인: Adafruit DHT 라이브러리가 설치되지 않았거나 잘못된 라이브러리를 설치했다.

해결:

1. Arduino IDE Library Manager에서 `DHT sensor library by Adafruit` 설치
2. `Adafruit Unified Sensor` 의존성 설치
3. IDE 재시작 후 다시 컴파일

### 계속 `dht_read_failed`

- 코드의 `DHT_PIN = 4`와 실제 연결한 GPIO 번호가 같은지 확인. 보드 인쇄 `D4`가 GPIO4가 아닌 보드도 있으므로 핀맵 확인
- VCC/GND 반전 여부 확인
- 4핀 단품이면 DATA 풀업 저항 확인
- 3.3V에서 선이 길면 실패하므로 짧은 점퍼선 사용
- 최소 2초 간격 유지
- 점퍼선과 센서를 바꿔 확인

### ESP32 포트가 안 보이거나 업로드 실패

- 충전 전용이 아닌 데이터 USB 케이블인지 확인
- 보드의 USB 칩(CP210x 또는 CH340)에 맞는 드라이버를 개발 PC에 설치
- `Connecting......`에서 멈추면 그 동안 보드의 `BOOT` 버튼을 누르고 있다가 업로드가 시작되면 뗀다
- `Brownout detector was triggered`가 반복되면 USB 허브를 빼고 PC 포트나 충분한 용량의 충전기에 직접 연결

### Serial 글자가 깨짐

Serial Monitor를 `115200 baud`로 맞춘다. 전원을 켠 직후 한 번 나오는 깨진 글자는 부트로더 메시지라 정상이다.

### 계속 `wifi_disconnected`

- SSID·비밀번호의 대소문자 확인
- 공유기의 2.4GHz 대역이 켜져 있는지, 5GHz 전용 SSID가 아닌지 확인
- WPA3 전용 모드면 WPA2/WPA3 혼합 모드로 변경
- 공유기와 너무 멀지 않은지 확인

### 계속 `ntp_not_synced`

ESP32는 공유기를 통해 인터넷의 `pool.ntp.org`에 접속해 시각을 맞춘다. 인터넷이 없는 폐쇄망이면 Jetson에 NTP 서버(chrony 등)를 설정하고 `secrets.h`의 `NTP_SERVER`를 Jetson IP로 바꾼다.

### `post_failed`의 `http:-1`

서버에 TCP 연결 자체를 못 했다는 뜻이다.

- `STA_BASE_URL`이 `localhost`가 아닌 Jetson IP인지 확인
- 개발 PC 브라우저로 같은 주소가 열리는지 확인
- ESP32가 게스트 Wi-Fi나 AP 격리(클라이언트 격리)가 켜진 SSID에 붙어 있지 않은지 확인
- `docker compose ps`로 FROST가 Up인지 확인
- Jetson IP가 바뀌었는지 `hostname -I`로 확인. 공유기 DHCP 예약 권장

### Docker 명령에 권한 오류

```bash
sudo usermod -aG docker "$USER"
```

다시 로그인한다. Docker 소켓에 `chmod 777`을 사용하지 않는다.

### `docker compose` 명령이 없음

```bash
sudo apt install -y docker-compose-v2
```

`docker-compose-v2`에 설치 후보가 없다면 6절의 공식 저장소 설정부터 확인한다. `docker-compose-plugin`은 저장소 등록 없이 이름만 바꿔 설치한다고 해결되지 않는다. 구형 `docker-compose`와 새 `docker compose`를 섞지 않는다.

### `no matching manifest for linux/arm64` 또는 `exec format error`

amd64 전용 이미지를 ARM64 Jetson에서 실행하려는 경우다. 7절의 `Dockerfile.postgis`와 빌드 구성을 사용하고 이미지 manifest에 `linux/arm64`가 있는지 확인한다. `platform: linux/amd64`를 강제로 넣어 해결한 것으로 취급하지 않는다.

### PostgreSQL이 healthy가 되지 않음

```bash
cd ~/sta-iot-dashboard/infra
docker compose ps
docker compose logs --tail=100 database
```

- `.env`의 변수 누락 확인
- 저장장치 공간 확인: `df -h`
- 기존 볼륨의 DB 비밀번호는 `.env`만 바꿔도 변경되지 않음
- 데이터를 보존해야 하면 볼륨을 지우지 말고 DB 안에서 비밀번호 변경

### FROST가 DB에 연결하지 못함

```bash
docker compose logs --tail=150 frost
docker compose exec database pg_isready -U sensorthings -d sensorthings
```

- JDBC 호스트는 `localhost`가 아니라 Compose 서비스명 `database`
- DB명, 사용자명, 비밀번호가 양쪽에서 같은지 확인
- `depends_on`과 healthcheck 확인

### FROST `404 Not Found`

기준 경로를 정확히 사용한다.

```text
http://JETSON_IP:8080/FROST-Server/v1.1
```

대소문자와 `/FROST-Server`를 확인한다.

### Observation POST `400 Bad Request`

- JSON 문법 확인: `jq . request.json`
- `result`가 문자열이 아닌 숫자인지 확인
- `phenomenonTime`이 ISO 8601 UTC인지 확인
- 응답 본문과 FROST 로그 확인

### Observation POST `404` 또는 잘못된 Datastream ID

```bash
curl -sS "$STA_URL/Datastreams?%24select=%40iot.id,name" | jq
```

실제 ID를 ESP32 `secrets.h`와 `web/.env.local`에 반영한다. ESP32는 다시 업로드하고 웹 개발 서버는 재시작한다.

### 웹에서 `Failed to fetch`

1. 브라우저 주소창에서 FROST API가 열리는지 확인
2. `NEXT_PUBLIC_STA_BASE_URL`이 `localhost`인지 확인
   - 웹을 다른 PC에서 열면 `localhost`는 그 PC 자신이므로 Jetson IP를 써야 함
3. Jetson 방화벽 8080 확인
4. FROST CORS 허용 주소 확인
5. 브라우저 개발자 도구 Network/Console 확인

### 그래프가 최신→과거로 거꾸로 표시됨

API는 `desc`로 최신부터 받지만 `getObservations()`에서 `reverse()`해 Chart.js에는 과거부터 전달해야 한다.

### 시각이 9시간 차이 남

ESP32는 `configTime(0, 0, ...)`으로 UTC `Z` 시각을 저장하고 브라우저의 `toLocaleString("ko-KR")`에서 로컬 시간으로 표시한다. ESP32 코드의 `configTime` 첫 두 인자를 0이 아닌 값으로 바꾸지 않았는지, Jetson의 NTP 상태도 확인한다.

```bash
timedatectl
```

### 값이 중복 저장됨

- 같은 Datastream ID로 올린 ESP32가 두 대 이상 켜져 있는지 확인
- 예전 유선판 Collector(`sta-collector` 서비스)가 아직 실행 중인지 확인: `systemctl status sta-collector`

---

## 16. 보안과 운영 주의사항

현재 구성은 신뢰할 수 있는 로컬 네트워크의 학습용이다. 인터넷에 그대로 공개하지 않는다.

- `.env`, `.env.local`, ESP32 `secrets.h`, 비밀번호, 토큰을 Git에 커밋하지 않는다.
- 현재 FROST는 인증 없이 쓰기를 허용하므로 **같은 LAN의 누구나 Observation을 POST할 수 있다.** 공유 Wi-Fi라면 IoT 전용 SSID로 분리하거나 FROST 인증을 켠 뒤 ESP32에 계정을 넣는다.
- ESP32와 FROST 사이는 평문 HTTP다. 신뢰할 수 있는 LAN 밖으로 보내지 않는다.
- PostgreSQL 5432 포트를 외부에 노출하지 않는다.
- FROST를 인터넷에 공개할 때는 인증·권한 설정을 켠다.
- Nginx/Caddy 같은 리버스 프록시에서 HTTPS를 적용한다.
- 방화벽에서 필요한 출발지와 포트만 허용한다.
- CORS `*`는 개발 확인용으로만 사용한다.
- Docker 이미지 태그와 digest를 기록하고 업데이트 전 별도 검증한다.
- `/FROST-Server/DatabaseStatus`도 관리 화면이므로 외부에 무인증으로 공개하지 않는다.
- 이 Compose는 DB 초기화 편의를 위해 관리자급 DB 사용자를 FROST에도 쓴다. 운영에서는 초기화/마이그레이션 계정과 실행 계정의 권한을 분리한다.
- PostgreSQL 볼륨을 정기적으로 백업하고 복원 연습도 한다.
- 보존 기간을 정한다. 2초 간격이면 센서당 하루 43,200개의 Observation이 생긴다.
- 외부에 공개할 위치 정보의 정밀도를 낮춘다.
- Docker와 Ubuntu 보안 업데이트를 정기 적용한다.

간단한 DB 백업 예시:

```bash
cd ~/sta-iot-dashboard/infra
docker compose exec -T database pg_dump -U sensorthings -d sensorthings -Fc > sensorthings-$(date +%F).dump
```

백업 파일에는 센서 데이터가 들어 있으므로 접근 권한과 보관 위치를 관리한다.

---

## 17. `.gitignore`와 GitHub README 구조

프로젝트 루트의 `.gitignore`:

```gitignore
# Secrets and local configuration
.env
.env.*
!.env.example
secrets.h

# Python
__pycache__/
*.py[cod]
.venv/

# Next.js / Node.js
node_modules/
.next/
out/
npm-debug.log*

# Editors and OS
.DS_Store
.idea/
.vscode/

# Local backups and logs
*.dump
*.log
```

`web/.env.local`도 `.env.*`에 의해 제외된다. 공유할 값은 비밀이 없는 `.env.example`로 제공한다.

### README 권장 목차

```markdown
# STA Sensor Dashboard

## 프로젝트 소개
## 시스템 아키텍처
## 기술 스택
## 하드웨어와 배선
## 빠른 시작
## SensorThings API 데이터 모델
## API 예시
## 화면
## 테스트 방법
## 문제 해결
## 보안과 제한사항
## 확장 계획
## 라이선스
```

### 커밋 단계 예시

```bash
git init
git add .gitignore
git commit -m "chore: initialize project"

git add esp32
git commit -m "feat: send DHT11 readings to STA over Wi-Fi"

git add infra
git commit -m "feat: add FROST and PostGIS stack"

git add web
git commit -m "feat: add sensor dashboard"
```

커밋 전에 반드시 비밀 파일이 추적되지 않는지 확인한다.

```bash
git status --short
git ls-files | grep -E '(^|/)\.env($|\.)' || true
```

`git ls-files | grep secrets.h`도 비어 있어야 한다. 위 결과에서 `.env.example`은 허용된 예시 파일이다. 다른 `.env`/`.env.local`이 보이면 커밋 전에 추적 대상에서 제외한다. `.gitignore`는 이미 추적 중인 비밀 파일을 자동으로 제거하지 않는다. 외부에 비밀값이 올라갔다면 파일 삭제뿐 아니라 해당 값을 폐기·교체한다.

---

## 18. 확장 로드맵

### 1단계 — 현재 구조 안정화

- Jetson IP를 공유기 DHCP 예약으로 고정
- Docker 이미지 버전 고정
- ESP32 전원을 안정적인 충전기로 고정
- DB 백업과 데이터 보존 정책
- 2초 대신 실제 목적에 맞는 측정 주기 설정

### 2단계 — 추가 센서

조도, CO₂, 미세먼지 등을 추가할 때 각 측정 종류마다 다음을 만든다.

1. 해당 Sensor 생성
2. 해당 ObservedProperty 생성
3. 해당 Datastream 생성
4. ESP32 스케치에서 값을 읽고 범위를 검증한 뒤 `postObservation()` 호출 추가
5. 웹 카드와 그래프 추가

### 3단계 — MQTT

FROST의 MQTT 모듈과 브로커를 추가해 새 Observation 알림을 구독한다. ESP32도 HTTP 대신 `v1.1/Datastreams(ID)/Observations` 토픽에 MQTT로 발행해 Observation을 만들 수 있다. 주기적 HTTP 조회를 줄이고 값이 들어온 즉시 UI에 반영할 수 있다. 먼저 현재 REST 경로를 안정화한 뒤 도입한다.

### 4단계 — 알림

- 임계치: CO₂ 1,000 ppm 초과 등
- 지속 조건: 한 번이 아니라 5분 이상 초과
- 중복 억제: 같은 상태의 알림 반복 방지
- 정상 복귀 알림
- 이메일/Slack 등 외부 채널 연결

### 5단계 — AGV 연동

- AGV를 별도 Thing으로 등록
- 이동할 때 Thing의 현재 Location 관계를 갱신하고 HistoricalLocation으로 위치 변경 이력을 조회
- AGV 탑재 센서별 Datastream 생성
- 고정 센서와 이동 센서 값을 시간·공간 기준으로 비교
- 제어가 필요하면 Sensing 데이터와 OGC SensorThings API Part 2 Tasking의 책임을 분리

### 6단계 — VLM/AI 분석

- 카메라 관측과 환경 센서의 시간을 맞춤
- 이상값 탐지 전 센서 결측·노이즈·보정 처리
- AI 결과도 별도 관측 속성/Datastream으로 저장
- 원본 측정값과 모델 추론값을 구분
- 모델 버전, 신뢰도, 입력 구간을 properties 또는 resultQuality에 기록

처음부터 AI를 붙이지 말고 신뢰할 수 있는 시계열 데이터가 쌓이고 정상 범위를 이해한 뒤 추가한다.

---

## 19. 최종 완료 기준

다음을 모두 만족하면 1차 프로젝트가 완성된 것이다.

```text
[ ] ESP32가 USB 연결 없이 충전기 전원만으로 DHT11 값을 Wi-Fi로 전송한다.
[ ] Jetson이 재부팅되어도 FROST와 PostgreSQL이 다시 시작한다.
[ ] STA 서비스 루트와 각 엔티티를 REST로 조회할 수 있다.
[ ] Thing/Location/Sensor/ObservedProperty/Datastream 관계가 맞다.
[ ] ESP32가 공유기 재시작·FROST 재시작 뒤에도 스스로 전송을 재개한다.
[ ] 온도와 습도 Observation이 실제 Datastream에 계속 쌓인다.
[ ] 대시보드가 최신값과 최근 60개 시계열을 표시한다.
[ ] 다른 LAN 기기에서 대시보드가 열린다.
[ ] lint와 production build가 성공한다.
[ ] 비밀번호, .env, secrets.h 파일이 Git에 없다.
[ ] DB 백업을 한 번 만들고 보관 위치를 확인했다.
```

---

## 20. 공식 참고 문서

- [OGC SensorThings API 표준 개요](https://www.ogc.org/standards/sensorthings/)
- [OGC SensorThings API Part 1: Sensing 1.1](https://docs.ogc.org/is/18-088/18-088.html)
- [FROST-Server 공식 저장소](https://github.com/FraunhoferIOSB/FROST-Server)
- [FROST-Server 공식 설정 문서](https://fraunhoferiosb.github.io/FROST-Server/settings/settings.html)
- [FROST-Server 공식 Docker Compose 예제](https://github.com/FraunhoferIOSB/FROST-Server/tree/v2.x/scripts)
- [Next.js App Router 문서](https://nextjs.org/docs/app)
- [Next.js 환경변수 문서](https://nextjs.org/docs/app/guides/environment-variables)
- [Chart.js 문서](https://www.chartjs.org/docs/latest/)
- [react-chartjs-2 문서](https://react-chartjs-2.js.org/)
- [Docker Engine Ubuntu 설치 문서](https://docs.docker.com/engine/install/ubuntu/)
- [PostGIS Docker 이미지의 지원 아키텍처](https://github.com/postgis/docker-postgis)
- [PostgreSQL 공식 Docker 이미지 아키텍처](https://github.com/docker-library/official-images/blob/master/library/postgres)
- [FROST PostgreSQL/PostGIS 요구사항](https://fraunhoferiosb.github.io/FROST-Server/deployment/postgresql.html)
- [Jetson 초기 설치 공식 안내](https://docs.nvidia.com/jetson/orin-nano-devkit/user-guide/latest/quick_start.html)
- [Adafruit DHT11/DHT22 사양 비교](https://learn.adafruit.com/dht/overview)
- [Next.js 프로젝트 생성 CLI](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
- [Next.js ESLint 설정](https://nextjs.org/docs/app/api-reference/config/eslint)

---

## 21. 이 검토판에서 실제로 확인한 범위

2026-09-22에 유선판 문서의 코드 블록을 임시 프로젝트로 추출해서 확인했다. 아래 결과는 실제 검증 결과이며, 앞 절들의 정상 로그 예시와 구분한다.

| 검사 | 실제 결과 |
|---|---|
| 모든 Bash 블록의 `bash -n` | 구문 검사 통과 |
| JSON 코드 블록 | 파싱 통과 |
| `docker compose config --quiet` | Compose 변수 치환·구문 검사 통과 |
| ESP32 스케치 (무선 수정판) | **컴파일 미검증.** 수정한 환경에 ESP32 보드 패키지/arduino-cli가 없었다 |
| 엔티티 생성 스크립트 | 로컬 모의 서버에서 POST 8회, 1·2가 아닌 발급 ID 연결, 중복 실행 차단 통과 |
| 프론트 STA 조회 테스트 | URL·쿼리·정렬·취소 신호, 잘못된 응답·ID, 빈 결과·HTTP 오류 처리 통과 |
| `npx eslint .` | 종료 코드 0 |
| `npm run build` | Next.js 16.3.5에서 TypeScript 검사와 프로덕션 빌드 통과 |

검증 컴퓨터는 macOS, Node.js 26.5.0, Python 3.14.7이었다. 설치 가이드의 Node.js 24 및 Jetson Ubuntu/Python 3.10 환경과는 차이가 있다. 실제 Jetson·ESP32·DHT11 연결과 Wi-Fi 전송, ARM64 PostGIS 이미지 빌드, FROST와 DB 컨테이너 실행, 실제 브라우저의 LAN/CORS 통신은 여기서 실행하지 못했다. Docker 엔진이 실행되지 않아 `config` 검사까지만 가능했다. **모의 서버 테스트는 FROST 자체의 실행 검증이 아니다.** 최종 완성 판정은 14절과 19절의 장비 체크리스트로 한다.
