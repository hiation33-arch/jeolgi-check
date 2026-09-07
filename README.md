# 절기, 맞았을까?

**바로가기 → https://hiation33-arch.github.io/jeolgi-check/**

24절기가 실제 기상 데이터로 얼마나 "절기다웠는지" 보여주는 단일 페이지 웹앱.

## 이 앱이 하는 일

- 24절기 중 하나를 고르면, 최근 10·20·30년간 인천(112) 관측소의 실제 기상값으로
  그 절기가 "절기다웠는지" 적중률을 매겨 보여준다.
  (예: *우수*는 그날 비가 왔는지, *대설*은 평균기온 5℃ 이하였는지)
- 연도별 막대 차트에서 각 해의 실제 수치(강수량·기온)를 확인할 수 있다.
- 함께 오늘의 절기·일진(간지) 기반 운세 문구를 보여준다.

## 사용하는 공공데이터

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

현재 배포됨: `https://jeolgi-check-proxy.hiation33.workers.dev` →
`index.html` 의 `PROXY_BASE` 가 이 주소(`/api` 포함)를 가리킨다.

코드/키를 바꿔 다시 배포할 때, `worker/` 디렉터리에서:

```bash
npm install
npx wrangler login                    # 처음 한 번, 또는 토큰 만료 시
npx wrangler secret put SERVICE_KEY   # 인증키 변경 시. 공공데이터포털 "일반 인증키(Decoding)"
npx wrangler deploy
```

인증키는 `wrangler secret` 으로만 등록하며 저장소에 커밋하지 않는다.
Worker 주소를 바꿨다면 `index.html` 상단 `PROXY_BASE` 도 `.../api` 형태로 맞춘다.

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
```
```bash
# 프론트 (PROXY_BASE 를 http://localhost:8787/api 로 잠깐 바꾼 뒤, 저장소 루트에서)
python -m http.server 8000              # http://localhost:8000
```

## 참고

- data.go.kr(특일·음양력 호스트)이 동시 요청에 느려 콜드 로드가 ~20초 걸릴 수 있다.
  Worker가 타임아웃·재시도로 흡수하며, 한 번 조회한 절기는 엣지 캐시로 이후 빨라진다.
- `robots.txt` + `<meta name="robots" content="noindex">` 로 검색 노출은 막았지만,
  GitHub Pages 특성상 URL을 아는 사람은 접속할 수 있다(접근 제한 아님).
