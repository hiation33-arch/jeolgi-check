// Cloudflare Worker — 공공데이터포털 API 프록시
// ------------------------------------------------------------------
// 프론트엔드(GitHub Pages)에서 apis.data.go.kr 을 직접 호출하지 않고
// 이 Worker 를 거치게 해서, 실제 인증키가 브라우저 코드에 노출되지 않게 한다.
//
// 실제 인증키는 저장소에 두지 않고 wrangler secret 으로만 등록한다:
//   wrangler secret put SERVICE_KEY
// (공공데이터포털 "일반 인증키(Decoding)" 값을 넣을 것)
// ------------------------------------------------------------------

// 프록시가 대신 호출하는 3개 서비스
const UPSTREAM = {
  // 특일정보 — 24절기 목록
  spcde24: "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/get24DivisionsInfo",
  // ASOS 일자료 — 지점별 일 단위 관측값
  asos: "https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList",
  // 음양력정보 — 양력→음력/일진 변환
  luncal: "https://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getLunCalInfo",
};

// 서비스별로 프론트에서 넘어올 수 있는 쿼리 파라미터만 화이트리스트로 통과
// (임의 파라미터 주입/오픈 프록시 악용 방지. serviceKey 는 여기서 절대 받지 않는다.)
const ALLOWED_PARAMS = {
  spcde24: ["solYear", "solMonth", "solDay", "numOfRows", "pageNo", "_type"],
  asos: ["dataCd", "dateCd", "stnIds", "startDt", "endDt", "numOfRows", "pageNo", "_type"],
  luncal: ["solYear", "solMonth", "solDay", "_type"],
};

// CORS 허용 origin (브라우저 JS 호출 제한 — 무료 한도 도용 방지용).
// 실제 배포 사이트 + 로컬 개발 주소만 허용한다.
const STATIC_ALLOWED_ORIGINS = new Set([
  "https://hiation33-arch.github.io",
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  } catch (_) {
    /* invalid origin */
  }
  return false;
}

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function jsonResponse(obj, status, origin) {
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json; charset=utf-8";
  return new Response(JSON.stringify(obj), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    // 프리플라이트
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method Not Allowed" }, 405, origin);
    }

    // 라우팅: /api/<service>
    const match = url.pathname.match(/^\/api\/(spcde24|asos|luncal)\/?$/);
    if (!match) {
      return jsonResponse({ error: "Not Found", hint: "use /api/spcde24 | /api/asos | /api/luncal" }, 404, origin);
    }
    const service = match[1];

    if (!env.SERVICE_KEY) {
      return jsonResponse({ error: "SERVICE_KEY not configured (wrangler secret put SERVICE_KEY)" }, 500, origin);
    }

    // 업스트림 URL 구성 — 화이트리스트 파라미터만 전달 + 서버측에서 인증키 주입
    const upstream = new URL(UPSTREAM[service]);
    for (const key of ALLOWED_PARAMS[service]) {
      const v = url.searchParams.get(key);
      if (v !== null) upstream.searchParams.set(key, v);
    }
    if (!upstream.searchParams.has("_type")) upstream.searchParams.set("_type", "xml");
    upstream.searchParams.set("serviceKey", env.SERVICE_KEY);

    // data.go.kr(B090041/1360000) 은 동시 요청이 몰리면 느려지거나
    // Cloudflare↔origin 타임아웃(522)을 자주 낸다. 짧은 타임아웃 + 재시도로 흡수한다.
    const upstreamUrl = upstream.toString();
    const res = await fetchWithRetry(upstreamUrl, { attempts: 4, timeoutMs: 12000 });

    if (!res) {
      return jsonResponse({ error: "Upstream unavailable (retries exhausted)" }, 504, origin);
    }

    const bodyBuf = await res.arrayBuffer();
    const headers = corsHeaders(origin);
    headers["Content-Type"] = res.headers.get("Content-Type") || "application/xml; charset=utf-8";
    headers["Cache-Control"] = "public, max-age=3600";
    return new Response(bodyBuf, { status: res.status, headers });
  },
};

// 성공(2xx) 또는 API 레벨 응답(4xx: 잘못된 파라미터/키 등)은 그대로 반환.
// 네트워크 오류·타임아웃·5xx(502/503/504/522…) 는 재시도.
async function fetchWithRetry(url, { attempts, timeoutMs }) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(300 * 2 ** (i - 1) + Math.random() * 200); // 0.3s → 0.8s → 1.8s (+jitter)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/xml" },
        signal: controller.signal,
        // 과거 데이터는 바뀌지 않으므로 엣지 캐시로 업스트림 호출 수를 줄인다
        cf: { cacheTtl: 86400, cacheEverything: true },
      });
      clearTimeout(timer);
      if (res.status < 500) return res; // 2xx/3xx/4xx → 확정 응답
      last = res; // 5xx → 재시도
    } catch (_) {
      clearTimeout(timer);
      last = null; // abort/network → 재시도
    }
  }
  return last;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
