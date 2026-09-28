# 공부 가이드: 이 프로젝트로 배우는 SensorThings API와 IoT 시스템

이 문서는 [전체 개발 가이드](../sta_iot_dashboard_full_guide_esp.md)와 실제로 돌아가는 결과물(ESP32 → FROST → 웹, 7만 건 넘게 쌓인 측정값)을 바탕으로, **이 프로젝트에서 공부할 수 있는 것을 모두 정리한 교재**다. 중심은 OGC SensorThings API(STA)이고, 그 주변의 펌웨어, 서버, 웹, 운영을 STA와 연결해서 설명한다.

각 절 끝의 **직접 해 보기**는 Jetson 터미널에서 그대로 실행할 수 있는 명령이다. 예시 응답은 이 프로젝트 서버에서 실제로 받은 값이다. **확인 문제**의 답은 접어 두었으니 먼저 생각해 보고 연다.

## 목차

1. [공부 순서](#1-공부-순서)
2. [전체 그림: 값 하나가 화면에 뜨기까지](#2-전체-그림-값-하나가-화면에-뜨기까지)
3. [STA 기초: 표준이 정한 것](#3-sta-기초-표준이-정한-것)
4. [STA 데이터 모델: 8개 엔티티](#4-sta-데이터-모델-8개-엔티티)
5. [STA REST API: 만들기, 읽기, 고치기, 지우기](#5-sta-rest-api-만들기-읽기-고치기-지우기)
6. [STA 쿼리 옵션: 원하는 데이터만 꺼내기](#6-sta-쿼리-옵션-원하는-데이터만-꺼내기)
7. [STA 고급 기능: 페이지, dataArray, 배치, MQTT](#7-sta-고급-기능-페이지-dataarray-배치-mqtt)
8. [FROST-Server: STA 구현체의 속](#8-frost-server-sta-구현체의-속)
9. [ESP32 펌웨어: 측정값을 STA로 보내기](#9-esp32-펌웨어-측정값을-sta로-보내기)
10. [인프라: Docker Compose와 PostgreSQL](#10-인프라-docker-compose와-postgresql)
11. [웹 대시보드: STA를 읽어 화면 만들기](#11-웹-대시보드-sta를-읽어-화면-만들기)
12. [운영: 자동 실행, 백업, JSON 기록](#12-운영-자동-실행-백업-json-기록)
13. [시간 다루기: UTC와 한국 시간](#13-시간-다루기-utc와-한국-시간)
14. [보안](#14-보안)
15. [이 프로젝트에서 실제로 겪은 문제와 교훈](#15-이-프로젝트에서-실제로-겪은-문제와-교훈)
16. [확장 로드맵으로 더 공부하기](#16-확장-로드맵으로-더-공부하기)
17. [종합 실습 과제](#17-종합-실습-과제)
18. [용어집](#18-용어집)
19. [참고 문서](#19-참고-문서)

---

## 1. 공부 순서

처음 보는 사람 기준으로 아래 순서를 권한다. 앞 단계를 이해해야 뒤 단계가 읽힌다.

| 단계 | 공부할 것 | 이 문서 | 걸리는 시간(대략) |
|---|---|---|---|
| 1 | 데이터가 어디서 어디로 가는지 | 2절 | 30분 |
| 2 | STA가 무엇이고 왜 쓰는지 | 3절 | 1시간 |
| 3 | 엔티티 8개와 관계 | 4절 | 2시간 |
| 4 | REST API로 직접 만들고 읽기 | 5~6절 | 3시간 |
| 5 | 서버(FROST)와 DB가 STA를 어떻게 저장하는지 | 8, 10절 | 2시간 |
| 6 | ESP32가 보내는 쪽, 웹이 읽는 쪽 | 9, 11절 | 3시간 |
| 7 | 운영, 시간대, 보안 | 12~14절 | 2시간 |
| 8 | 실제 문제 사례와 확장 | 15~17절 | 자유 |

---

## 2. 전체 그림: 값 하나가 화면에 뜨기까지

```text
DHT11 ─(1)─▶ ESP32 ─(2) Wi-Fi, HTTP POST /Observations─▶ FROST-Server ─(3)─▶ PostgreSQL
                                                          (STA 1.1 서버)        (Docker 볼륨)
                                                               ▲
             브라우저 ─(4) GET /sta/...─▶ Next.js 서버 ─(5) 프록시─┘
                                                               ▲
             stream_json.sh ─(6) GET /Observations?$filter=id gt N ─┘ ──▶ ~/sta-backups/json/날짜.json
```

1. **측정:** DHT11이 온도와 습도를 잰다. ESP32가 2초마다 읽고 범위(0~50°C, 0~100%)를 검사한다.
2. **전송:** ESP32가 측정값마다 STA 형식의 JSON을 만들어 FROST에 `POST`한다. 중간 수집 서버가 없다.
3. **저장:** FROST가 JSON을 검사하고 PostgreSQL 테이블에 넣는다.
4. **조회:** 브라우저는 같은 주소의 `/sta/...`만 부른다.
5. **프록시:** Next.js 서버가 그 요청을 Jetson 내부의 FROST(`localhost:8080`)로 넘긴다.
6. **기록:** 별도 서비스가 새 측정값을 STA로 받아 날짜별 JSON 파일에 붙인다.

핵심은 **보내는 쪽(ESP32)과 읽는 쪽(웹, JSON 기록)이 서로를 전혀 모른다**는 점이다. 둘 다 STA라는 약속만 안다. 이게 3절에서 말하는 "표준을 쓰는 이유"다.

---

## 3. STA 기초: 표준이 정한 것

### 3.1 STA란

**OGC SensorThings API**는 지리공간 표준 기구 OGC(Open Geospatial Consortium)가 만든 IoT 표준이다. 두 부분으로 나뉜다.

| 부분 | 내용 | 이 프로젝트 |
|---|---|---|
| Part 1: Sensing | 센서가 잰 값을 저장하고 조회 | 사용 (버전 1.1) |
| Part 2: Tasking | 장치에 명령을 보냄 (예: 밸브 열기) | 미사용. AGV 제어 같은 확장 때 공부 |

STA는 두 가지를 함께 정한다.

- **데이터 모델:** "어떤 장치(Thing)가 어디(Location)에서, 어떤 센서(Sensor)로, 무엇(ObservedProperty)을, 언제 얼마로(Observation) 쟀는가"를 담는 구조
- **API 규칙:** 그 구조를 HTTP와 JSON으로 만들고 읽는 방법. 주소 모양, 쿼리 문법(`$filter`, `$orderby` 등), 응답 형식

뿌리는 두 표준이다. 데이터 모델은 ISO/OGC **Observations & Measurements(O&M)**, API 문법은 **OData**를 따른다. `$filter`, `$expand` 같은 `$` 옵션이 OData에서 왔다.

### 3.2 왜 표준을 쓰나

직접 DB 테이블과 API를 설계하면 처음엔 빠르지만, 이런 문제가 생긴다.

- 센서를 바꾸거나 늘릴 때마다 테이블과 API를 고친다.
- 다른 도구(Grafana, QGIS, 다른 팀의 앱)와 연결하려면 변환 코드를 짠다.
- 몇 달 뒤 데이터를 보면 "이 숫자가 무슨 단위였지?"를 알 수 없다.

STA를 쓰면:

- FROST 같은 **기성 서버**가 저장, 조회, 필터, 정렬, 페이지 나누기를 전부 제공한다.
- 측정값마다 **단위, 센서, 측정 대상이 연결**되어 있어 데이터의 뜻이 남는다.
- 센서 쪽과 화면 쪽을 **따로 바꿀 수 있다.** DHT11을 SHT31로 바꿔도 웹은 그대로다.

### 3.3 STA가 해 주지 않는 것

표준의 한계도 알아야 한다.

- **집계가 없다.** "최근 30분 최솟값"이나 "시간별 평균" 같은 계산은 STA 쿼리로 못 한다. 이 프로젝트 웹도 900개를 받아서 브라우저가 `Math.min/max`로 계산한다(`Dashboard.tsx`의 `range()`). 큰 데이터라면 DB에서 직접 계산하거나 별도 분석 도구가 필요하다.
- **인증 방식을 정하지 않는다.** 누가 쓸 수 있는지는 서버 구현(FROST 설정)의 몫이다. 이 프로젝트는 인증이 꺼져 있다(14절).
- **실시간 푸시는 선택 기능이다.** 기본은 요청해야 받는 방식(폴링)이다. MQTT 확장을 켜야 새 값 알림을 받을 수 있다(7.4절).

### 확인 문제

<details><summary>1. STA의 API 문법은 어떤 표준에서 왔고, 그 흔적은 어디서 보이나?</summary>

OData. `$filter`, `$orderby`, `$top`, `$expand`, `$select` 같은 `$` 쿼리 옵션과 `Datastreams(1)`처럼 괄호로 ID를 쓰는 주소 모양이 OData 문법이다.
</details>

<details><summary>2. 대시보드의 "30분 최저–최고 온도"는 STA 쿼리로 바로 받을 수 있나?</summary>

없다. STA에는 집계 함수가 없다. 그래서 웹이 최근 900개(2초 × 900 = 30분)를 받아 브라우저에서 최솟값과 최댓값을 계산한다.
</details>

---

## 4. STA 데이터 모델: 8개 엔티티

### 4.1 전체 관계

```text
                 Location ◀──── HistoricalLocation (위치가 바뀐 이력)
                    │
                  Thing  (ESP32 Room Sensor)
                    │ 1:N
     ┌──────────────┴──────────────┐
 Datastream 1                  Datastream 2
 (Room Temperature, °C)        (Room Humidity, %)
   │  ├─ Sensor: DHT11 Temperature   │  ├─ Sensor: DHT11 Humidity
   │  └─ ObservedProperty:           │  └─ ObservedProperty:
   │     Air Temperature             │     Relative Humidity
   │ 1:N                             │ 1:N
 Observation (22.8 at T)         Observation (60.0 at T)
   │                                 │
   └──────── FeatureOfInterest (관측 대상: aidtlab) ────────┘
```

이 서버의 실제 엔티티 목록은 서비스 루트에서 볼 수 있다.

```bash
curl -s http://localhost:8080/FROST-Server/v1.1 | jq -c '[.value[].name]'
# ["Datastreams","FeaturesOfInterest","HistoricalLocations","Locations","Observations","ObservedProperties","Sensors","Things"]
```

### 4.2 엔티티 하나씩

| 엔티티 | 한 줄 뜻 | 이 프로젝트의 값 | 핵심 필드 |
|---|---|---|---|
| **Thing** | 관측하는 대상 장치나 사물 | ESP32 Room Sensor | `name`, `description`, `properties` |
| **Location** | Thing이 있는 곳 | 연구실 (GeoJSON Point) | `encodingType`, `location` |
| **HistoricalLocation** | Thing의 위치가 바뀐 시각 기록 | Location을 연결할 때 자동 생성 | `time` |
| **Sensor** | 값을 만드는 장비나 절차 | DHT11 Temperature, DHT11 Humidity | `encodingType`, `metadata` |
| **ObservedProperty** | 무엇을 재는가 | Air Temperature, Relative Humidity | `definition` (URI) |
| **Datastream** | 같은 Thing·Sensor·ObservedProperty로 잰 값들의 묶음 | 온도 = 1번, 습도 = 2번 | `unitOfMeasurement`, `observationType` |
| **Observation** | 특정 시각에 잰 값 하나 | `22.8` at `2026-09-28T01:54:00Z` | `phenomenonTime`, `result` |
| **FeatureOfInterest** | 관측이 향하는 대상(공간) | aidtlab (Location에서 자동 생성) | `encodingType`, `feature` |

### 4.3 Datastream이 중심이다

Datastream은 "이 숫자들이 무엇인지"를 정하는 엔티티다. Observation은 숫자와 시각만 가지고, 뜻은 전부 Datastream에서 온다.

```bash
curl -s 'http://localhost:8080/FROST-Server/v1.1/Things(1)?$expand=Datastreams($select=id,name,unitOfMeasurement)' | jq '.Datastreams'
```

```json
[
  {"@iot.id": 1, "name": "Room Temperature",
   "unitOfMeasurement": {"name": "degree Celsius", "symbol": "°C", "definition": "https://qudt.org/vocab/unit/DEG_C"}},
  {"@iot.id": 2, "name": "Room Humidity",
   "unitOfMeasurement": {"name": "percent", "symbol": "%", "definition": "https://qudt.org/vocab/unit/PERCENT"}}
]
```

- **`unitOfMeasurement`:** 단위를 이름, 기호, 정의 URI로 적는다. URI는 QUDT라는 공개 단위 사전을 가리킨다. 사람이 아니라 프로그램도 "이건 섭씨"라고 알 수 있게 하려는 것이다.
- **`observationType`:** 값의 종류. 이 프로젝트는 숫자 측정이라 `OM_Measurement`다. 참/거짓이면 `OM_TruthObservation`, 분류 값이면 `OM_CategoryObservation`을 쓴다.
- **서버가 자동으로 채우는 필드:** Datastream의 `phenomenonTime`(첫 값~마지막 값 시각 구간)과 `observedArea`(관측 대상들의 범위)는 FROST가 Observation이 들어올 때마다 알아서 갱신한다.

```bash
curl -s 'http://localhost:8080/FROST-Server/v1.1/Datastreams(1)?$select=phenomenonTime'
# {"phenomenonTime":"2026-09-21T03:00:00Z/2026-09-28T01:54:00Z"}   ← 시작/끝 구간 표기
```

### 4.4 왜 온도와 습도를 Datastream 두 개로 나눴나

DHT11 하나가 두 값을 동시에 재지만, STA에서 Datastream은 **ObservedProperty 하나**에 묶인다. 온도와 습도는 무엇을 재는지(ObservedProperty)와 단위가 다르니 Datastream도 둘이다. 그래서 ESP32는 2초마다 **POST를 두 번** 보낸다. 두 Observation의 `phenomenonTime`이 같아서, 웹의 쾌적도 차트는 같은 시각끼리 짝을 지어 (온도, 습도) 점을 찍는다.

> 여러 값을 한 번에 묶는 `MultiDatastream`이라는 확장도 있다. 표준 핵심이 아니라 확장이고, 지원 여부가 서버마다 달라 이 프로젝트는 쓰지 않았다.

### 4.5 Observation의 시간 필드 세 개

| 필드 | 뜻 | 이 프로젝트 |
|---|---|---|
| `phenomenonTime` | 현상이 일어난(측정한) 시각. **필수** | ESP32가 NTP로 맞춘 UTC 시각 |
| `resultTime` | 결과가 만들어진 시각 | 비움(`null`). 측정과 결과가 같은 순간이라 필요 없음 |
| `validTime` | 결과가 유효한 기간 | 비움. 예보 데이터 같은 데서 씀 |

`phenomenonTime`을 **서버 도착 시각이 아니라 ESP32가 잰 시각**으로 넣는 게 중요하다. Wi-Fi가 느려서 늦게 도착해도 측정 시각은 정확하게 남는다.

`parameters`에는 표준이 정하지 않은 부가 정보를 자유롭게 넣는다. 이 프로젝트는 출처를 적어 둔다.

```json
"parameters": {"source": "esp32-wifi", "timeBasis": "esp32-ntp"}
```

### 4.6 FeatureOfInterest는 자동으로 생긴다

STA에서 모든 Observation은 FeatureOfInterest(관측 대상)를 가져야 한다. ESP32가 보내는 JSON에는 FeatureOfInterest가 없는데도 저장되는 이유는, **FROST가 Datastream → Thing → Location을 따라가 Location으로 FeatureOfInterest를 자동 생성**하기 때문이다.

```bash
curl -s 'http://localhost:8080/FROST-Server/v1.1/Observations(74845)/FeatureOfInterest?$select=id,name'
# {"@iot.id":1,"name":"aidtlab"}   ← Location 이름과 같다
```

반대로 **Thing에 Location이 없으면** 자동 생성이 불가능해서 POST가 `400 Bad Request`("No FeatureOfInterest provided, and none can be generated")로 실패한다. 이 경우 Observation마다 `"FeatureOfInterest": {"@iot.id": N}`을 직접 넣어야 한다.

### 직접 해 보기

```bash
B=http://localhost:8080/FROST-Server/v1.1
# 모든 Sensor와 ObservedProperty
curl -s "$B/Sensors" | jq '.value[] | {id: ."@iot.id", name, metadata}'
curl -s "$B/ObservedProperties" | jq '.value[] | {id: ."@iot.id", name, definition}'
# 온도 Datastream에 연결된 Thing, Sensor, ObservedProperty를 한 번에
curl -s "$B/Datastreams(1)?\$expand=Thing,Sensor,ObservedProperty" | jq
```

### 확인 문제

<details><summary>1. CO₂ 센서를 추가하려면 어떤 엔티티를 새로 만들어야 하나?</summary>

Sensor(CO₂ 센서 설명), ObservedProperty(이산화탄소 농도), Datastream(단위 ppm, 기존 Thing에 연결) 세 개. Thing과 Location은 같은 ESP32라면 그대로 쓴다. 그다음 ESP32가 새 Datastream ID로 Observation을 보내면 된다.
</details>

<details><summary>2. Wi-Fi가 30초 끊겼다가 붙어서 측정값이 늦게 도착하면, 그래프에서 그 점은 어느 시각에 찍히나?</summary>

측정한 시각. ESP32가 `phenomenonTime`에 측정 순간의 NTP 시각을 넣기 때문이다. (단, 이 펌웨어는 끊긴 동안의 값을 쌓아 두지 않고 버린다. 끊긴 동안 측정값을 보관했다가 나중에 보내는 것은 좋은 개선 과제다.)
</details>

<details><summary>3. Observation JSON에 FeatureOfInterest를 안 넣었는데 저장되는 이유는?</summary>

FROST가 Datastream의 Thing에 연결된 Location으로 FeatureOfInterest를 자동으로 만들기 때문이다. Thing에 Location이 없으면 400 오류가 난다.
</details>

---

## 5. STA REST API: 만들기, 읽기, 고치기, 지우기

### 5.1 주소 모양

```text
http://JETSON_IP:8080/FROST-Server/v1.1/Datastreams(1)/Observations?$top=5
└────── 서비스 루트 (serviceRootUrl) ──────┘└─ 엔티티(ID) ┘└ 관계 ┘└ 쿼리 옵션 ┘
```

| 주소 | 뜻 |
|---|---|
| `/Things` | Thing 전체 목록 |
| `/Things(1)` | ID 1번 Thing 하나 |
| `/Things(1)/Datastreams` | 1번 Thing의 Datastream들 (관계를 따라감) |
| `/Datastreams(1)/Observations` | 온도 Datastream의 측정값들 |
| `/Observations(74845)/Datastream` | 이 측정값이 속한 Datastream |
| `/Things(1)/name/$value` | 속성 값만 글자로 |

### 5.2 응답에 붙는 `@iot.` 필드

```json
{
  "@iot.id": 74845,
  "@iot.selfLink": "http://JETSON_IP:8080/FROST-Server/v1.1/Observations(74845)",
  "phenomenonTime": "2026-09-28T01:54:00Z",
  "result": 22.8,
  "Datastream@iot.navigationLink": ".../Observations(74845)/Datastream",
  "FeatureOfInterest@iot.navigationLink": ".../Observations(74845)/FeatureOfInterest"
}
```

- `@iot.id`: 서버가 발급한 ID
- `@iot.selfLink`: 자기 자신의 주소
- `...@iot.navigationLink`: 관계를 따라갈 주소. 링크만 따라가도 전체 데이터를 탐색할 수 있다(하이퍼미디어).
- `@iot.count`: `$count=true`일 때 전체 개수
- `@iot.nextLink`: 다음 페이지 주소(7.1절)

`selfLink`의 앞부분은 FROST 설정 `serviceRootUrl`에서 온다. 이 값이 실제 접속 주소와 다르면 링크가 틀린 곳을 가리킨다. `compose.yaml`에서 `http://${JETSON_IP}:8080/FROST-Server`로 맞춰 둔 이유다.

### 5.3 만들기: POST

```bash
curl -i -X POST "$B/Observations" \
  -H 'Content-Type: application/json' \
  -d '{"phenomenonTime":"2026-09-28T02:00:00Z","result":23.1,"Datastream":{"@iot.id":1}}'
```

- 성공하면 **`201 Created`**이고, 응답 헤더 `Location`에 새 엔티티 주소가 온다. ESP32는 이 `201`만 성공으로 친다.
- `Prefer: return=representation` 헤더를 주면 본문에 만든 엔티티 전체(ID 포함)를 돌려준다. `create_entities.sh`는 이걸로 새 ID를 받아 다음 엔티티에 연결한다.
- **관계는 ID로 연결한다:** `"Datastream": {"@iot.id": 1}`. 없는 ID면 `404`나 `400`이 난다.
- **한 번에 여러 개 만들기(deep insert):** 관계 자리에 ID 대신 객체를 통째로 넣으면 함께 만들어진다. 예: Thing을 만들면서 `"Locations": [{...}]`를 넣기.

### 5.4 POST는 같은 요청을 두 번 보내면 두 개가 생긴다

POST는 멱등(idempotent)하지 않다. 같은 요청을 두 번 보내면 엔티티가 두 개 생긴다. 이 서버에도 흔적이 있다.

```bash
curl -s "$B/Things?\$select=id,name&\$expand=Datastreams(\$select=id)" | jq -c '.value[]'
# {"@iot.id":1,"name":"ESP32 Room Sensor","Datastreams":[{"@iot.id":1},{"@iot.id":2}]}
# {"@iot.id":2,"name":"ESP32 Room Sensor","Datastreams":[]}   ← 재실행으로 생긴 빈 Thing
# {"@iot.id":3,"name":"ESP32 Room Sensor","Datastreams":[]}
```

그래서 `create_entities.sh`는 `ids.env`가 이미 있으면 실행을 거부한다. **ID도 1, 2로 보장되지 않는다.** 서버가 엔티티 종류마다 따로 발급하므로, 코드에 숫자를 박지 말고 `ids.env`처럼 발급된 값을 기록해서 쓴다.

### 5.5 고치기와 지우기

```bash
# 일부 필드만 고치기 (PATCH): Sensor 설명 바꾸기
curl -X PATCH "$B/Sensors(1)" -H 'Content-Type: application/json' -d '{"description":"DHT11, GPIO4"}'
# 지우기: 빈 Thing 정리
curl -X DELETE "$B/Things(3)"
```

- `PATCH`는 보낸 필드만 바꾼다. `PUT`은 전체를 바꾼다.
- 지우면 관계에 따라 연쇄 삭제가 일어날 수 있다. Datastream을 지우면 그 Observation도 전부 사라진다. **실험 전에 백업(12.3절)부터.**

### 확인 문제

<details><summary>1. ESP32가 POST 응답으로 200을 받으면 성공인가?</summary>

이 펌웨어 기준으로는 실패로 처리한다. STA에서 생성 성공은 `201 Created`이고, 코드가 `code == 201`만 성공으로 센다.
</details>

<details><summary>2. <code>create_entities.sh</code>를 두 번 실행하면 어떻게 되나? 스크립트는 이걸 어떻게 막나?</summary>

POST가 멱등하지 않아 Thing, Sensor, Datastream이 전부 하나씩 더 생긴다. 스크립트는 첫 실행 끝에 `ids.env`를 만들고, 다음 실행 때 그 파일이 있으면 바로 종료한다.
</details>

---

## 6. STA 쿼리 옵션: 원하는 데이터만 꺼내기

### 6.1 옵션 한눈에

| 옵션 | 뜻 | 예 |
|---|---|---|
| `$top` | 최대 N개 | `$top=10` |
| `$skip` | 앞의 N개 건너뛰기 | `$skip=10` |
| `$orderby` | 정렬 | `$orderby=phenomenonTime desc` |
| `$select` | 필요한 필드만 | `$select=phenomenonTime,result` |
| `$filter` | 조건 | `$filter=result gt 25` |
| `$expand` | 관련 엔티티 포함 | `$expand=Datastream` |
| `$count` | 전체 개수 포함 | `$count=true` |
| `$resultFormat` | 응답 모양 바꾸기 | `$resultFormat=dataArray` |

### 6.2 `$filter` 문법

| 종류 | 연산자와 함수 |
|---|---|
| 비교 | `eq`, `ne`, `gt`, `ge`, `lt`, `le` |
| 논리 | `and`, `or`, `not` |
| 산술 | `add`, `sub`, `mul`, `div`, `mod` |
| 글자 | `substringof`, `startswith`, `endswith`, `length`, `tolower`, `concat` |
| 시간 | `year`, `month`, `day`, `hour`, `minute`, `second`, `now()`, `duration'PT1M'` |
| 공간 | `geo.distance`, `geo.intersects`, `st_within` 등 |
| 관계 경로 | `Datastream/id eq 1`, `Thing/Locations/name eq 'aidtlab'` |

이 서버에서 실제로 돌려 본 예:

```bash
B=http://localhost:8080/FROST-Server/v1.1
q() { curl -s -G "$B/$1" "${@:2}"; }   # -G + --data-urlencode 로 공백과 $를 안전하게 인코딩

# 25°C 이상인 온도 측정값 개수 → {"@iot.count":2}
q Observations --data-urlencode '$filter=Datastream/id eq 1 and result ge 25' \
  --data-urlencode '$count=true' --data-urlencode '$top=0' | jq '."@iot.count"'

# 최근 1분 동안의 온도 측정값 개수 → 30 (2초 간격)
q 'Datastreams(1)/Observations' --data-urlencode "\$filter=phenomenonTime ge now() sub duration'PT1M'" \
  --data-urlencode '$count=true' --data-urlencode '$top=0' | jq '."@iot.count"'

# UTC 3시(한국 정오)에 잰 값 개수
q 'Datastreams(1)/Observations' --data-urlencode '$filter=hour(phenomenonTime) eq 3' \
  --data-urlencode '$count=true' --data-urlencode '$top=0' | jq '."@iot.count"'
```

> **셸에서 주의:** `$top`의 `$`는 셸 변수로 해석된다. URL을 작은따옴표로 감싸거나, 위처럼 `curl -G --data-urlencode`를 쓴다. 공백은 `%20`으로 인코딩해야 한다.

### 6.3 `$expand` 안에 옵션 넣기

`$expand`는 괄호 안에 다시 쿼리 옵션을 넣을 수 있고, 옵션 사이는 `;`로 나눈다. **Datastream마다 최신값 하나씩**을 요청 한 번으로 받는 예:

```bash
q Datastreams --data-urlencode '$select=id,name' \
  --data-urlencode '$expand=Observations($top=1;$orderby=phenomenonTime desc;$select=result,phenomenonTime)' \
  | jq -c '.value[] | {name, latest: .Observations[0]}'
# {"name":"Room Temperature","latest":{"result":22.8,"phenomenonTime":"2026-09-28T01:54:32Z"}}
# {"name":"Room Humidity","latest":{"result":60.0,"phenomenonTime":"2026-09-28T01:54:32Z"}}
```

웹 대시보드는 지금 온도와 습도를 따로 두 번 요청한다. 위처럼 한 번으로 줄이는 것도 개선 과제다.

### 6.4 이 프로젝트의 쿼리 읽기

`web/lib/sta.ts`가 보내는 쿼리:

```text
GET /sta/Datastreams(1)/Observations
    ?$select=@iot.id,phenomenonTime,result
    &$orderby=phenomenonTime desc,@iot.id desc
    &$top=900
```

- `$select`: 필요한 세 필드만 받아 응답을 줄인다.
- `$orderby`: 최신부터 900개. 같은 시각이면 ID로 한 번 더 정렬해 순서를 확정한다.
- 받은 뒤 `reverse()`로 과거→현재 순서로 뒤집어 그래프에 넣는다.

### 확인 문제

<details><summary>1. 2026-09-27 한국 시간 하루치 습도만 받는 <code>$filter</code>를 써 보라.</summary>

```text
$filter=phenomenonTime ge 2026-09-27T00:00:00+09:00 and phenomenonTime lt 2026-09-28T00:00:00+09:00
```
주소는 `/Datastreams(2)/Observations`. 시각에 `+09:00`을 붙이면 서버가 UTC로 바꿔 비교한다. `le`가 아니라 `lt`를 써야 다음 날 0시 값이 섞이지 않는다.
</details>

<details><summary>2. <code>$orderby</code>에 <code>@iot.id</code>를 두 번째 기준으로 넣은 이유는?</summary>

온도와 습도처럼 같은 `phenomenonTime`을 가진 값이 있으면 정렬 순서가 요청마다 달라질 수 있다. ID를 두 번째 기준으로 넣으면 순서가 항상 같다(결정적 정렬).
</details>

---

## 7. STA 고급 기능: 페이지, dataArray, 배치, MQTT

### 7.1 페이지 나누기와 `@iot.nextLink`

서버는 한 번에 줄 수 있는 개수에 상한이 있다. 이 서버는 `$top=20000`을 요청해도 1만 건만 준다. 결과가 더 있으면 응답에 `@iot.nextLink`가 붙는다. 그 주소를 그대로 다시 부르면 다음 페이지가 온다.

```json
"@iot.nextLink": ".../Observations?$top=2&$skip=2&...&$skipFilter=(phenomenonTime gt 2026-09-23T02:26:30Z)"
```

FROST의 nextLink에는 `$skipFilter`가 들어 있다. 단순 `$skip`(앞에서 N개 건너뛰기)은 데이터가 클수록 느리고, 중간에 새 값이 들어오면 겹치거나 빠진다. `$skipFilter`는 "마지막으로 본 값 다음부터"라는 조건이라 빠르고 안정적이다(키셋, 커서 방식).

**이 프로젝트의 활용:** `infra/stream_json.sh`는 같은 생각을 직접 구현한다. 마지막으로 받은 Observation ID를 `.last_id` 파일에 저장하고, 2초마다 `$filter=id gt 마지막ID`로 새 값만 받는다. 재시작해도 빠지거나 겹치는 값이 없다.

### 7.2 dataArray: 응답을 표처럼 줄이기

같은 필드 이름을 매번 반복하지 않고 표 모양으로 받는다. 큰 데이터를 받을 때 응답 크기가 크게 준다.

```bash
q 'Datastreams(1)/Observations' --data-urlencode '$resultFormat=dataArray' \
  --data-urlencode '$select=phenomenonTime,result' --data-urlencode '$top=2' | jq '.value[0] | {components, dataArray}'
```

```json
{"components": ["phenomenonTime", "result"],
 "dataArray": [["2026-09-21T03:00:00Z", 25.3], ["2026-09-23T02:26:30Z", 24.1]]}
```

반대로 **여러 Observation을 한 번에 만들 때도** dataArray 형식으로 `POST /CreateObservations`를 보낼 수 있다. Wi-Fi가 끊긴 동안 쌓아 둔 값을 한꺼번에 올릴 때 쓸 만하다.

### 7.3 배치 요청

`POST /$batch`로 여러 요청(만들기, 고치기, 읽기)을 HTTP 요청 하나에 묶어 보낸다. ESP32가 온도와 습도를 요청 두 번 대신 한 번에 보내는 식으로 쓸 수 있다.

### 7.4 MQTT

STA는 HTTP 말고 MQTT도 정의한다.

- **구독:** `v1.1/Datastreams(1)/Observations` 토픽을 구독하면 새 측정값이 생길 때마다 서버가 밀어 준다. 웹이 5초마다 묻는(폴링) 대신 값이 오자마자 반영할 수 있다.
- **발행:** ESP32가 같은 토픽에 JSON을 발행하면 Observation이 만들어진다. HTTP보다 가볍고 연결을 유지한다.

이 서버가 무엇을 지원한다고 알리는지는 서비스 루트의 `serverSettings.conformance`에 나온다.

```bash
curl -s http://localhost:8080/FROST-Server/v1.1 | jq '.serverSettings.conformance'
```

이 프로젝트의 FROST 이미지는 `frost-server-http`(HTTP 전용)다. MQTT를 쓰려면 MQTT 모듈이 들어간 이미지(`frost-server`)나 별도 MQTT 서비스를 추가해야 한다.

### 확인 문제

<details><summary>1. <code>stream_json.sh</code>가 <code>$skip</code> 대신 <code>id gt N</code>을 쓰는 이유는?</summary>

`$skip`은 "앞에서 N개"라서 새 값이 계속 들어오는 데이터에서는 위치가 밀려 겹치거나 빠진다. 또 N이 커질수록 느려진다. ID는 계속 커지므로 "마지막으로 본 ID보다 큰 것"은 항상 정확히 새 값만 가리킨다.
</details>

---

## 8. FROST-Server: STA 구현체의 속

### 8.1 FROST란

Fraunhofer IOSB가 만든 오픈소스 STA 서버다. Java로 만들어졌고, 받은 JSON을 검사해 PostgreSQL에 저장하고, 쿼리 옵션을 SQL로 바꿔 실행한다.

### 8.2 STA 엔티티는 DB 테이블이 된다

```bash
docker compose exec -T database psql -U sensorthings -d sensorthings -c '\dt'
```

| STA 엔티티 | PostgreSQL 테이블 |
|---|---|
| Things | `THINGS` |
| Locations | `LOCATIONS` (+ 연결 테이블 `THINGS_LOCATIONS`) |
| HistoricalLocations | `HIST_LOCATIONS` (+ `LOCATIONS_HIST_LOCATIONS`) |
| Sensors | `SENSORS` |
| ObservedProperties | `OBS_PROPERTIES` |
| Datastreams | `DATASTREAMS` |
| Observations | `OBSERVATIONS` |
| FeaturesOfInterest | `FEATURES` |

`databasechangelog`, `databasechangeloglock`은 Liquibase(DB 구조 버전 관리 도구)가 쓰는 테이블이다. `compose.yaml`의 `persistence_autoUpdateDatabase: "true"` 설정 때문에 FROST가 시작할 때 테이블을 자동으로 만들고 업그레이드한다. `spatial_ref_sys`는 PostGIS의 좌표계 목록이다.

### 8.3 왜 PostGIS가 필요한가

Location과 FeatureOfInterest는 GeoJSON 좌표를 가지고, `geo.distance` 같은 공간 필터가 있다. FROST는 이걸 PostGIS의 공간 자료형과 함수로 처리한다. 그래서 일반 PostgreSQL이 아니라 PostGIS 확장이 설치된 DB가 필요하다(`init-postgis.sql`의 `CREATE EXTENSION postgis`).

### 8.4 주요 설정 (`infra/compose.yaml`)

| 환경변수 | 뜻 |
|---|---|
| `serviceRootUrl` | 응답 링크(`selfLink`, `nextLink`)의 앞부분 |
| `http_cors_enable`, `http_cors_allowed_origins` | 브라우저가 다른 주소에서 부를 때 허용할 출처 |
| `persistence_db_url` 등 | DB 접속 정보 |
| `persistence_autoUpdateDatabase` | 시작할 때 테이블 자동 생성, 업그레이드 |

### 직접 해 보기

```bash
cd ~/sta-iot-dashboard/infra
docker compose ps                      # 두 컨테이너 상태와 healthy 여부
docker compose logs --tail=50 frost    # FROST 로그
# STA로 센 개수와 DB에서 센 개수가 같은지
curl -s 'http://localhost:8080/FROST-Server/v1.1/Observations?$count=true&$top=0' | jq '."@iot.count"'
docker compose exec -T database psql -U sensorthings -d sensorthings -Atc 'select count(*) from "OBSERVATIONS"'
```

---

## 9. ESP32 펌웨어: 측정값을 STA로 보내기

파일: `esp32/dht11_wifi/dht11_wifi.ino`

### 9.1 한 바퀴 흐름 (`loop()`, 2초마다)

1. DHT11에서 습도, 온도 읽기
2. 읽기 실패(`NaN`)나 범위 밖(0~50°C, 0~100%)이면 버리고 오류 출력
3. Wi-Fi 연결 확인
4. 시계가 NTP로 맞춰졌는지 확인
5. 현재 UTC 시각을 `2026-09-28T01:54:00Z` 형식으로 만들기
6. 온도와 습도를 각각 `POST /Observations` (같은 시각)
7. 걸린 시간을 빼고 남은 만큼 기다려 **주기를 2초로 유지**

### 9.2 공부할 포인트

| 코드 | 배울 점 |
|---|---|
| `WiFi.mode(WIFI_STA)` | ESP32를 공유기에 붙는 쪽(station)으로. ESP32는 **2.4GHz만** 지원한다 |
| `configTime(0, 0, NTP_SERVER)` | 시간대 오프셋 0 = UTC로 시계를 맞춘다 |
| `MIN_VALID_EPOCH` | NTP가 맞기 전 시계는 1970년부터 시작한다. 2025년 이전 시각이면 보내지 않는다 |
| `snprintf(body, ...)` | 라이브러리 없이 STA JSON을 직접 만든다. 버퍼 크기(224바이트) 안에 들어가야 한다 |
| `http.setTimeout(5000)` | 서버가 응답하지 않을 때 무한히 기다리지 않는다 |
| `code == 201` | STA 생성 성공 코드만 성공으로 센다 |
| `delay(SAMPLE_INTERVAL_MS - elapsed)` | 작업 시간을 빼서 측정 간격을 일정하게 유지한다 |
| Serial에 JSON 한 줄씩 출력 | 오류 종류를 기계가 읽기 쉬운 형태로 남긴다 |

### 9.3 보내는 JSON

```json
{"phenomenonTime":"2026-09-28T01:54:00Z","result":22.8,
 "parameters":{"source":"esp32-wifi","timeBasis":"esp32-ntp"},
 "Datastream":{"@iot.id":1}}
```

FeatureOfInterest가 없는 이유는 4.6절 참고.

### 9.4 오류 메시지로 문제 위치 찾기

| Serial 출력 | 문제 위치 |
|---|---|
| `dht_read_failed` | 배선, 전원, 핀 번호 |
| `out_of_range` | 센서 고장이나 잡음 |
| `wifi_disconnected` | SSID, 비밀번호, 2.4GHz 여부, 신호 세기 |
| `ntp_not_synced` | 인터넷 연결, NTP 서버 |
| `post_failed ... http:-1` | 서버 주소, 포트, 방화벽 (연결 자체가 안 됨) |
| `post_failed ... http:400` | JSON 형식, Datastream ID, FeatureOfInterest |

### 확인 문제

<details><summary>1. 전원을 켜자마자 1970년 날짜로 Observation이 저장되지 않는 이유는?</summary>

NTP로 시계가 맞기 전에는 `time()`이 1970년 근처 값을 준다. 코드가 `MIN_VALID_EPOCH`(2025-01-01)보다 이른 시각이면 `ntp_not_synced`를 출력하고 보내지 않는다.
</details>

<details><summary>2. POST 두 번에 0.5초가 걸리면 다음 측정은 언제 하나?</summary>

루프 시작부터 2초 뒤. 걸린 0.5초를 빼고 1.5초만 기다린다. 그냥 `delay(2000)`을 쓰면 주기가 2.5초로 늘어난다.
</details>

---

## 10. 인프라: Docker Compose와 PostgreSQL

파일: `infra/compose.yaml`, `infra/Dockerfile.postgis`

### 10.1 공부할 포인트

| 설정 | 배울 점 |
|---|---|
| `restart: unless-stopped` | 컨테이너가 죽거나 재부팅해도 다시 켜진다. 직접 멈춘 경우는 예외 |
| `healthcheck` + `pg_isready` | DB가 "켜짐"이 아니라 "접속 가능"인지 검사 |
| `depends_on: condition: service_healthy` | DB가 healthy가 된 뒤에 FROST를 시작한다 |
| `volumes: postgis_data` | 컨테이너를 지워도 데이터는 볼륨에 남는다 |
| `${POSTGRES_PASSWORD:?...}` | `.env`에 값이 없으면 시작 자체를 막는다 |
| `ports: "8080:8080"` | FROST만 밖으로 연다. DB 5432는 열지 않는다 |

### 10.2 ARM64 문제와 직접 만든 이미지

Jetson은 ARM64(aarch64) CPU다. 공식 `postgis/postgis` 이미지는 amd64(인텔/AMD)용만 있어서, 받아도 `exec format error`로 실행되지 않는다. 그래서 공식 `postgres:16` 이미지(ARM64 지원) 위에 PostGIS 패키지를 설치하는 `Dockerfile.postgis`를 직접 만들었다.

> 교훈: 새 이미지를 쓰기 전에 `docker manifest inspect 이미지:태그`로 지원 CPU 구조를 확인한다.

### 10.3 볼륨이 곧 데이터다

```bash
docker volume ls                                  # infra_postgis_data
docker volume inspect infra_postgis_data          # 실제 위치: /var/lib/docker/volumes/.../_data
```

`docker compose down`은 컨테이너만 지우지만, `docker compose down -v`는 **볼륨까지 지워서 모든 측정값이 사라진다.** 옛 설정에서 남은 볼륨을 지울 때도 먼저 압축 백업을 만든 뒤 지웠다(15절).

---

## 11. 웹 대시보드: STA를 읽어 화면 만들기

파일: `web/lib/sta.ts`, `web/components/Dashboard.tsx`, `web/next.config.ts`

### 11.1 CORS와 프록시

브라우저는 보안 규칙(동일 출처 정책) 때문에 `:3000`에서 연 페이지가 `:8080`의 API를 부르는 걸 기본적으로 막는다. 포트가 다르면 다른 출처다. 해결 방법은 둘이다.

1. **CORS 허용:** FROST가 "이 출처는 허용"이라고 응답 헤더를 붙인다(`http_cors_allowed_origins`).
2. **프록시 (현재 방식):** 브라우저는 같은 출처의 `/sta/...`만 부르고, Next.js 서버가 FROST로 전달한다.

```ts
// web/next.config.ts
rewrites: async () => [
  { source: "/sta/:path*", destination: "http://localhost:8080/FROST-Server/v1.1/:path*" },
],
```

프록시 방식의 장점: CORS 설정이 필요 없고, LAN IP든 Tailscale IP든 **3000 포트 하나로** 접속된다. FROST 8080을 외부에 노출하지 않아도 되는 구조로도 확장할 수 있다.

### 11.2 받은 데이터를 믿지 않는다 (`sta.ts`)

- `baseUrl`, `datastreamId`, `limit` 입력 검사
- 응답이 `{"value": [...]}` 모양인지, 각 항목에 숫자 ID, 날짜로 읽히는 `phenomenonTime`, 유한한 숫자 `result`가 있는지 검사(`isObservation`)
- 모양이 다르면 오류를 던져 화면에 알린다

외부 API 응답은 TypeScript 타입만으로 보장되지 않는다. 실행 중에 검사해야 한다.

### 11.3 폴링과 신선도

- 5초마다 온도와 습도를 동시에 요청(`Promise.all`)
- 요청마다 10초 제한(`AbortController`), 화면을 떠나면 요청 취소
- 마지막 측정이 15초보다 오래되면 "새 값이 없습니다. ESP32 전원과 Wi-Fi를 확인하세요"
- 측정 시각이 현재보다 10초 넘게 미래면 NTP 문제로 판단

### 11.4 차트 설계 판단

- **계단형 선(`stepped`):** DHT11은 0.1°C, 1% 단위로만 값이 바뀐다. 점 사이를 비스듬히 잇는 것보다 계단이 실제 측정에 맞다.
- **쾌적도 차트:** 온도와 습도를 같은 `phenomenonTime`끼리 짝지어 (온도, 습도) 평면에 30분 경로를 그린다. 4.4절에서 Datastream을 둘로 나눈 결과를 다시 합치는 예다.
- **부동소수점 표시 버그:** 차트 눈금에 `21.750000000000004`처럼 긴 숫자가 나왔다. 컴퓨터가 소수를 2진수로 저장하면서 생기는 오차다. 눈금은 소수 둘째 자리, 툴팁은 온도 한 자리, 습도 정수로 반올림해서 고쳤다(`toFixed`).

### 확인 문제

<details><summary>1. <code>curl</code>로는 되는데 브라우저에서만 <code>Failed to fetch</code>가 나면 먼저 무엇을 의심하나?</summary>

CORS. `curl`은 동일 출처 정책을 적용하지 않지만 브라우저는 적용한다. 개발자 도구 Console에 `blocked by CORS policy`가 있는지 본다. 이 프로젝트는 `/sta` 프록시로 이 문제를 피한다.
</details>

<details><summary>2. <code>0.1 + 0.2</code>가 <code>0.30000000000000004</code>가 되는 이유와, 화면에서 어떻게 다뤄야 하나?</summary>

0.1과 0.2는 2진수로 정확히 표현되지 않아 아주 작은 오차가 생긴다. 계산은 그대로 두고, **보여 줄 때** 의미 있는 자릿수로 반올림한다(`toFixed`, `Intl.NumberFormat`).
</details>

---

## 12. 운영: 자동 실행, 백업, JSON 기록

### 12.1 systemd 사용자 서비스

| 서비스 | 파일 | 하는 일 |
|---|---|---|
| `sta-web` | `infra/sta-web.service` | `next start`로 대시보드 실행 |
| `sta-json` | `infra/sta-json.service` | 실시간 JSON 기록 |

```bash
systemctl --user status sta-web sta-json
journalctl --user -u sta-json -f          # 로그 따라 보기
systemctl --user restart sta-web          # npm run build 후 반영
```

- `Restart=on-failure` / `Restart=always`: 죽으면 5초 뒤 다시 켠다.
- `loginctl enable-linger`: 사용자 서비스는 원래 로그인해야 켜진다. linger를 켜면 부팅만 해도 켜진다.
- **서비스로 도는 프로그램을 직접 `kill`하고 손으로 띄우면 systemd 관리에서 빠진다.** 이 프로젝트에서 실제로 한 번 겪었다. 항상 `systemctl --user restart`를 쓴다.

### 12.2 cron 백업

```cron
0 3 * * * ~/sta-iot-dashboard/infra/backup.sh >> ~/sta-backups/backup.log 2>&1
```

- `pg_dump -Fc`: PostgreSQL 전용 압축 형식으로 DB 전체를 덤프
- **임시 파일에 쓰고 성공하면 이름 바꾸기:** 중간에 실패한 반쪽 파일이 정상 백업처럼 남지 않게 한다
- 14일 지난 덤프는 자동 삭제

복원:

```bash
docker compose exec -T database pg_restore -U sensorthings -d sensorthings --clean < ~/sta-backups/sensorthings-YYYY-MM-DD.dump
```

> 백업은 **복원해 봐야** 백업이다. 테스트용 컨테이너에 복원해 건수를 비교하는 연습을 해 보자.

### 12.3 실시간 JSON 기록 (`infra/stream_json.sh`)

```text
~/sta-backups/json/2026-09-28.json
[
{"id":74209,"time":"2026-09-28T10:43:24+09:00","type":"temperature_c","value":22.1},
{"id":74210,"time":"2026-09-28T10:43:24+09:00","type":"humidity_pct","value":53.0}
]
```

| 설계 | 이유 |
|---|---|
| 2초마다 `$filter=id gt 마지막ID` | 새 값만 정확히 받기 (7.1절) |
| `.last_id` 파일에 마지막 ID 저장 | 재시작해도 이어서 받기 |
| 밀린 게 1,000개 넘으면 페이지를 끝까지 따라감 | 오래 꺼져 있다 켜져도 따라잡기 |
| 파일 끝의 `]`를 떼고 항목을 붙인 뒤 다시 닫기 | 파일이 항상 올바른 JSON 배열 |
| 시각을 UTC에서 한국 시간(`+09:00`)으로 변환 | 사람이 바로 읽기 좋게 (13절) |

**알려진 한계:** `]`를 떼고 붙이는 사이에 전원이 나가면 그날 파일 끝이 깨질 수 있다. 개선하려면 임시 파일에 쓰고 `mv`로 바꾼다(원자적 교체). 원본은 DB에 있으므로 다시 만들 수 있다.

---

## 13. 시간 다루기: UTC와 한국 시간

이 프로젝트에서 시간대는 여러 번 문제가 됐다. 원칙은 하나다. **저장은 UTC, 보여 줄 때 현지 시간.**

| 위치 | 시간대 | 이유 |
|---|---|---|
| ESP32 → FROST | UTC (`...Z`) | `configTime(0, 0, ...)`. 기기가 어디 있든 같은 기준 |
| FROST/DB | UTC | STA와 ISO 8601 관례 |
| 웹 화면 | 한국 시간 | 브라우저의 `toLocaleTimeString("ko-KR")`가 변환 |
| JSON 파일 | 한국 시간 (`+09:00`) | 사람이 파일을 직접 열어 보므로 |

- `2026-09-28T01:42:00Z`와 `2026-09-28T10:42:00+09:00`은 **같은 순간**이다. 표기만 다르다.
- 한국 시간 "하루"는 UTC로 전날 15:00부터 당일 15:00까지다. 날짜별 파일을 한국 날짜로 나누려면 이 경계를 써야 한다.
- 실제로 겪은 일: JSON에 UTC를 그대로 적었더니 "10:42인데 01:42로 남는다"는 문제가 됐다. 저장된 값이 틀린 게 아니라 표기가 사람에게 맞지 않았던 것이다.

### 확인 문제

<details><summary>1. <code>2026-09-27T16:30:00Z</code>는 한국 날짜로 며칠인가?</summary>

9월 28일 01:30. UTC에 9시간을 더한다. 그래서 이 값은 `2026-09-28.json`에 들어간다.
</details>

---

## 14. 보안

이 구성은 **믿을 수 있는 LAN에서 쓰는 학습용**이다. 인터넷에 그대로 공개하면 안 된다.

| 위험 | 현재 상태 | 운영 수준의 대책 |
|---|---|---|
| 누구나 Observation 쓰기 | FROST 인증 꺼짐 → 같은 LAN 누구나 POST 가능 | FROST 인증 켜기, ESP32에 계정 넣기, IoT 전용 SSID |
| 평문 통신 | ESP32 ↔ FROST가 HTTP | HTTPS 리버스 프록시(Nginx, Caddy), 장치 인증서 |
| 비밀값 노출 | `.env`, `.env.local`, `secrets.h`는 `.gitignore`로 제외 | 저장소가 공개라서 특히 중요. `*.example` 양식만 커밋 |
| DB 직접 접근 | 5432 포트를 열지 않음 | 계속 유지 |
| 위치 정보 | Location에 실제 좌표 | 공개할 때 좌표 정밀도 낮추기 |
| 관리 화면 | `/FROST-Server/DatabaseStatus` 무인증 | 외부 차단 |

---

## 15. 이 프로젝트에서 실제로 겪은 문제와 교훈

| 문제 | 원인 | 해결 | 교훈 |
|---|---|---|---|
| PostGIS 컨테이너 `exec format error` | 공식 이미지가 amd64 전용 | ARM64 `postgres:16` 위에 PostGIS 설치 | 이미지 CPU 구조를 먼저 확인 |
| Observation POST `400` | Thing에 Location이 없어 FeatureOfInterest 자동 생성 불가 | Location 연결 (또는 FoI 직접 지정) | STA 필수 관계를 이해하기 |
| 같은 이름 Thing 3개 | 엔티티 생성을 여러 번 실행 | `ids.env` 있으면 실행 거부 | POST는 멱등하지 않다 |
| ESP32가 Wi-Fi를 못 찾음 | ESP32는 2.4GHz 전용, Jetson은 5GHz SSID | ESP32만 2.4GHz SSID 사용 | 하드웨어 제약 먼저 확인 |
| 차트 눈금 `21.750000000000004` | 부동소수점 오차를 그대로 출력 | 표시할 때 반올림 | 계산과 표시를 분리 |
| JSON 시각이 9시간 늦음 | UTC를 그대로 기록 | `+09:00`으로 변환해 기록 | 저장은 UTC, 보여 줄 땐 현지 시간 |
| 대시보드가 재부팅 후 안 켜질 뻔함 | 서비스 프로세스를 손으로 죽이고 다시 띄움 | `systemctl --user restart` | 서비스는 서비스 관리자로만 |
| 옛 DB 볼륨이 남아 있음 | 이전 compose 프로젝트의 볼륨 | 압축 백업 후 삭제 | 지우기 전에 들여다보고 백업 |
| 예시 데이터가 실제 데이터에 섞임 | 가이드의 수동 POST 예시(2026-09-21 03:00, 25.3°C)가 남음 | 인지하고 분석할 때 제외 | 실험 데이터와 실제 데이터 구분 |

---

## 16. 확장 로드맵으로 더 공부하기

| 단계 | 할 일 | 새로 공부할 STA/기술 |
|---|---|---|
| 1 | 센서 추가 (CO₂, 조도, 미세먼지) | Sensor, ObservedProperty, Datastream 설계 |
| 2 | 끊긴 동안 값 보관 후 일괄 전송 | `CreateObservations`(dataArray), `$batch` |
| 3 | 실시간 알림 수신 | STA MQTT 확장, MQTT 브로커 |
| 4 | 임계치 알림 (5분 이상 초과 시) | 지속 조건, 중복 억제, 복귀 알림 |
| 5 | 움직이는 AGV에 센서 달기 | Thing의 Location 갱신, HistoricalLocation, 공간 필터 `geo.distance` |
| 6 | AGV 제어 | STA Part 2 Tasking (TaskingCapability, Task) |
| 7 | AI 이상 탐지 | 추론 결과를 별도 Datastream으로 저장, `resultQuality`에 신뢰도 기록 |

---

## 17. 종합 실습 과제

쉬운 것부터 순서대로. 실습 전에 `infra/backup.sh`로 백업을 하나 만들어 두자.

1. **탐색:** 서비스 루트에서 시작해 `navigationLink`만 따라가며 Thing → Datastream → 최신 Observation → FeatureOfInterest까지 가 본다.
2. **조회:** 오늘 한국 시간 0시부터 지금까지 온도의 최솟값과 최댓값을 구한다. (힌트: STA에는 집계가 없다. `$filter` + `$orderby=result asc&$top=1`)
3. **정리:** 빈 Thing 2, 3번이 정말 비어 있는지 `$expand`로 확인한 뒤 `DELETE`로 지운다.
4. **모델링:** 가짜 CO₂ 센서용 Sensor, ObservedProperty, Datastream(ppm)을 만들고 `curl`로 Observation 5개를 넣는다. 끝나면 지운다.
5. **dataArray:** 4번의 Observation 5개를 `POST /CreateObservations` 한 번으로 넣어 본다.
6. **웹 개선:** 대시보드의 온도·습도 요청 두 번을 6.3절의 `$expand` 요청 한 번으로 바꿔 본다.
7. **운영:** 테스트 컨테이너를 따로 띄워 어젯밤 덤프를 복원하고 Observation 건수를 비교한다.
8. **안정성:** `stream_json.sh`의 추가 방식을 "임시 파일에 쓰고 `mv`"로 바꾸고, 실행 중에 강제 종료해도 파일이 깨지지 않는지 확인한다.

---

## 18. 용어집

| 용어 | 뜻 |
|---|---|
| OGC | Open Geospatial Consortium. 지리공간 표준 기구 |
| STA | SensorThings API. OGC의 IoT 센서 데이터 표준 |
| O&M | Observations & Measurements. STA 데이터 모델의 뿌리가 된 관측 표준 |
| OData | REST API 쿼리 표준. `$filter` 등의 출처 |
| FROST-Server | Fraunhofer IOSB의 오픈소스 STA 서버 |
| 엔티티 | STA의 데이터 단위 (Thing, Datastream 등) |
| GeoJSON | 좌표를 JSON으로 적는 표준 형식 |
| PostGIS | PostgreSQL 공간 데이터 확장 |
| QUDT | 단위와 물리량을 URI로 정의한 공개 사전 |
| NTP | 인터넷으로 시계를 맞추는 프로토콜 |
| UTC | 협정 세계시. 한국 시간 = UTC + 9시간 |
| ISO 8601 | `2026-09-28T01:54:00Z` 같은 날짜·시각 표기 표준 |
| CORS | 브라우저가 다른 출처 API 호출을 허용할지 정하는 규칙 |
| 프록시 | 요청을 대신 받아 다른 서버로 전달하는 중계 |
| 폴링 | 새 값이 있는지 주기적으로 물어보는 방식 |
| 멱등 | 같은 요청을 여러 번 해도 결과가 한 번과 같은 성질 |
| 키셋 페이지네이션 | "마지막으로 본 값 다음부터"로 다음 페이지를 가져오는 방식 |
| systemd | 리눅스의 서비스 관리자 |
| cron | 정해진 시각에 명령을 실행하는 스케줄러 |
| JSON Lines | 한 줄에 JSON 하나씩 적는 형식 (`.jsonl`). 이 프로젝트는 대신 JSON 배열을 씀 |

---

## 19. 참고 문서

- [OGC SensorThings API 표준 개요](https://www.ogc.org/standards/sensorthings/)
- [OGC SensorThings API Part 1: Sensing 1.1 (표준 원문)](https://docs.ogc.org/is/18-088/18-088.html)
- [FROST-Server 저장소](https://github.com/FraunhoferIOSB/FROST-Server)
- [FROST-Server 문서 (설정, 확장 기능)](https://fraunhoferiosb.github.io/FROST-Server/)
- [OData URL 규칙](https://www.odata.org/documentation/)
- [QUDT 단위 사전](https://www.qudt.org/)
- [이 프로젝트 전체 개발 가이드](../sta_iot_dashboard_full_guide_esp.md)
- [이 프로젝트 README](../README.md)
