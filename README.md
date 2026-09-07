# 절기, 맞았을까?

24절기가 실제 기상 데이터로 얼마나 "절기다웠는지" 보여주는 단일 페이지 웹앱.

공공데이터포털 3개 API를 사용한다.

| 용도 | 서비스 |
|---|---|
| 24절기 날짜 | 특일정보 `SpcdeInfoService/get24DivisionsInfo` |
| 과거 일 기상값 | ASOS 일자료 `AsosDalyInfoService/getWthrDataList` |
| 오늘의 일진(간지) | 음양력정보 `LrsrCldInfoService/getLunCalInfo` |

## 구조

```
index.html         프론트엔드 (GitHub Pages 로 배포)
robots.txt         검색엔진 차단
worker/            Cloudflare Worker — API 프록시
  src/index.js     실제 인증키를 서버 쪽에서 붙여 공공데이터포털 호출
  wrangler.toml
```

실제 인증키는 프론트엔드에 **없다**. `index.html` 은 `PROXY_BASE`(배포된 Worker 주소)만 호출하고,
Worker 가 `wrangler secret` 으로 등록된 `SERVICE_KEY` 를 붙여 `apis.data.go.kr` 를 대신 호출한다.
따라서 브라우저 개발자도구(F12)로 열어봐도 인증키는 보이지 않는다.

## Worker 배포

`worker/` 디렉터리에서:

```bash
npm install
npx wrangler login
npx wrangler secret put SERVICE_KEY   # 공공데이터포털 "일반 인증키(Decoding)" 붙여넣기
npx wrangler deploy
```

배포되면 `https://jeolgi-check-proxy.<subdomain>.workers.dev` 주소가 나온다.
그 주소를 `index.html` 상단 `PROXY_BASE` 에 `.../api` 형태로 넣는다:

```js
var PROXY_BASE = "https://jeolgi-check-proxy.<subdomain>.workers.dev/api";
```

### 엔드포인트

| 프록시 경로 | 대신 호출하는 API |
|---|---|
| `GET /api/spcde24?solYear=YYYY&numOfRows=30` | 특일정보 |
| `GET /api/asos?dataCd=ASOS&dateCd=DAY&stnIds=112&startDt=YYYYMMDD&endDt=YYYYMMDD` | ASOS 일자료 |
| `GET /api/luncal?solYear=YYYY&solMonth=MM&solDay=DD` | 음양력정보 |

CORS 는 `https://hiation33-arch.github.io` 와 `localhost` 만 허용한다.

## 프론트엔드 배포

`main` 브랜치 루트를 GitHub Pages 로 서빙한다 → https://hiation33-arch.github.io/jeolgi-check/

## 로컬 확인

```bash
# worker
cd worker && npx wrangler dev            # http://localhost:8787

# 프론트 (PROXY_BASE 를 http://localhost:8787/api 로 잠깐 바꾼 뒤)
python -m http.server 5500
```
