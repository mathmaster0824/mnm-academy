// M&m 수학훈련소 사진 저장소 (Cloudflare Worker: mnm-photo-api)
// 이 파일을 Cloudflare 대시보드 › Workers › mnm-photo-api › 코드 편집 에 붙여넣고 배포한다.
// 필요한 바인딩(기존 그대로): PHOTOS = R2 버킷 mnm-private-photos, AI = Workers AI, (선택) FIREBASE_PROJECT_ID
//
// 출입 확인(2026-10-30 추가)
// - 앱이 보내는 Firebase 로그인 증표(ID 토큰)로 Firestore에 직접 문서를 읽어 본다. Firestore 보안 규칙이
//   원장/학생 여부를 판단하므로, 저장소는 그 결과만 따른다.
//   · 원장: 토큰의 uid가 DIRECTOR_UID이고 meta/settings를 읽을 수 있음
//   · 학생: studentSessions/{uid}의 studentId로 students/{studentId}를 읽을 수 있음(비밀번호까지 맞는 세션만 가능)
// - 올리기: 원장·학생만, 사진/PDF만, 15MB까지. 누가 올렸는지 사진에 기록한다.
// - 지우기: 원장은 모두, 학생은 자기가 올린 사진만.
// - AI 분석: 원장만.
// - 사진 보기(GET /photo): <img> 태그는 증표를 보낼 수 없으므로 그대로 둔다. 주소에 무작위 문자열이 있어 짐작할 수 없다.

const DIRECTOR_UID = "bcCt2VfFy2dyS786zXGpH0fuHIi2";
const DEFAULT_PROJECT_ID = "math-master-6a888";
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-MNM-Role",
  "Access-Control-Max-Age": "86400",
};

// ---------- 출입 확인 ----------
function projectId(env) { return env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID; }

function decodeJwtPayload(token) {
  const part = String(token).split(".")[1];
  if (!part) throw new Error("bad token");
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function firestoreGet(env, path, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId(env)}/databases/(default)/documents/${path}`;
  return fetch(url, { headers: { Authorization: "Bearer " + token } });
}

const authCache = new Map(); // token -> { auth, until }

// 반환: { role: 'director'|'student', uid, studentId? } 또는 null
async function authorize(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  let claims;
  try { claims = decodeJwtPayload(token); } catch { return null; }
  const pid = projectId(env);
  // 빠른 1차 거르기(진짜 검증은 아래 Firestore 호출에서 Google이 한다)
  if (!claims || !claims.sub || claims.aud !== pid ||
      claims.iss !== `https://securetoken.google.com/${pid}` ||
      !claims.exp || claims.exp * 1000 < Date.now()) return null;

  const cached = authCache.get(token);
  if (cached && cached.until > Date.now()) return cached.auth;

  let auth = null;
  if (claims.sub === DIRECTOR_UID) {
    const r = await firestoreGet(env, "meta/settings", token);
    if (r.ok || r.status === 404) auth = { role: "director", uid: claims.sub };
  } else {
    const s = await firestoreGet(env, "studentSessions/" + encodeURIComponent(claims.sub), token);
    if (s.ok) {
      const doc = await s.json().catch(() => null);
      const studentId = doc?.fields?.studentId?.stringValue || "";
      if (studentId) {
        const st = await firestoreGet(env, "students/" + encodeURIComponent(studentId), token);
        if (st.ok) auth = { role: "student", uid: claims.sub, studentId };
      }
    }
  }

  if (auth) {
    authCache.set(token, { auth, until: Math.min(claims.exp * 1000, Date.now() + 5 * 60 * 1000) });
    if (authCache.size > 500) authCache.delete(authCache.keys().next().value);
  }
  return auth;
}

const unauthorized = () => json({ ok: false, error: "로그인이 필요해요" }, 401, corsHeaders);
const forbidden = () => json({ ok: false, error: "권한이 없어요" }, 403, corsHeaders);

function allowedUploadType(type, name) {
  const t = String(type || "").toLowerCase();
  if (t && t !== "application/octet-stream") return t.startsWith("image/") || t === "application/pdf";
  // 일부 휴대폰은 파일 종류를 비워서 보낸다: 확장자로 판단
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|pdf)$/i.test(String(name || ""));
}

// ---------- 문제 분석(원장 전용) ----------
const ANALYSIS_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function isModelLicenseError(err) {
  const msg = String(err?.message || err || "");
  return /5016|prompt[\s\S]*agree|license|acceptable use policy/i.test(msg);
}

async function runAnalysisModel(env, input) {
  try {
    return await env.AI.run(ANALYSIS_MODEL, input);
  } catch (err) {
    if (!isModelLicenseError(err)) throw err;
    await env.AI.run(ANALYSIS_MODEL, { prompt: "agree" });
    return await env.AI.run(ANALYSIS_MODEL, input);
  }
}

function safeKey(value = "") {
  return String(value)
    .replace(/[^a-zA-Z0-9._/-]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/^\/+/, "");
}

function cleanString(v, max = 300) {
  return String(v ?? "").trim().slice(0, max);
}

function uniqueStrings(v, maxItems = 12, maxLen = 80) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(x => cleanString(x, maxLen)).filter(Boolean))].slice(0, maxItems);
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeAnalysis(a = {}) {
  return {
    conceptTags: uniqueStrings(a.conceptTags),
    mainConceptId: cleanString(a.mainConceptId, 100),
    relatedConceptIds: uniqueStrings(a.relatedConceptIds, 10, 100),
    geometryStructure: cleanString(a.geometryStructure, 240),
    askType: cleanString(a.askType, 60),
    solutionSkills: uniqueStrings(a.solutionSkills),
    predictedDifficulty: cleanString(a.predictedDifficulty, 40),
    confidence: clamp01(a.confidence),
  };
}

function parseModelJson(output) {
  let text = "";
  if (typeof output === "string") text = output;
  else if (typeof output?.response === "string") text = output.response;
  else if (typeof output?.result === "string") text = output.result;
  else if (output?.response && typeof output.response === "object") return output.response;
  else if (output?.result && typeof output.result === "object") return output.result;
  else if (output && typeof output === "object" && output.analysis) return output.analysis;

  text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI response did not contain JSON");
  return JSON.parse(text.slice(first, last + 1));
}

function bytesToDataUrl(bytes, contentType = "image/jpeg") {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

function extractPhotoKey(imageUrl = "") {
  try {
    const u = new URL(imageUrl);
    if (u.pathname !== "/photo") return "";
    return safeKey(u.searchParams.get("key") || "");
  } catch {
    return "";
  }
}

async function loadProblemImage(payload, env) {
  if (!env.PHOTOS) throw new Error("R2 binding PHOTOS is missing");

  const key = safeKey(payload.cropKey || payload.imageKey || "") ||
    extractPhotoKey(payload.imageUrl || "");

  if (!key) throw new Error("cropKey is required for private problem analysis");

  const object = await env.PHOTOS.get(key);
  if (!object) throw new Error("Problem crop not found in R2");

  const size = Number(object.size || 0);
  if (size > MAX_IMAGE_BYTES) throw new Error("Problem crop is too large");

  const buffer = await object.arrayBuffer();
  const contentType = object.httpMetadata?.contentType || "image/jpeg";
  return { key, image: bytesToDataUrl(new Uint8Array(buffer), contentType) };
}

function normalizeSegments(v) {
  const rows = Array.isArray(v?.segments) ? v.segments : Array.isArray(v) ? v : [];
  return rows.map((x, i) => {
    const box = x?.box || x?.bbox || {};
    const n = Number(String(x?.problemNo ?? x?.no ?? i + 1).replace(/[^0-9]/g, ""));
    const clamp = z => Math.max(0, Math.min(1, Number(z) || 0));
    const left = clamp(box.left ?? box.x0 ?? x?.left);
    const top = clamp(box.top ?? box.y0 ?? x?.top);
    const right = clamp(box.right ?? box.x1 ?? x?.right);
    const bottom = clamp(box.bottom ?? box.y1 ?? x?.bottom);
    return { problemNo: n ? String(n).padStart(2, "0") : "", left, top, right, bottom };
  }).filter(x => x.problemNo && x.right > x.left + .05 && x.bottom > x.top + .03).slice(0, 30);
}

function segmentationPrompt(payload) {
  return `이 이미지는 한국 수학 교재/PDF의 한 페이지다. 문제은행 수집을 위해 이 페이지에 실제로 존재하는 독립 문항의 경계를 찾아라.
문항번호가 보이면 그대로 숫자로 읽고, 각 문항 전체(문제문장, 보기, 도형, 표)를 빠짐없이 포함하는 사각형을 이미지 전체 기준 0~1 좌표로 반환한다.
머리말, 쪽번호, 단원제목, 정답표, 해설만 있는 영역은 문항으로 만들지 않는다. 2단 편집이면 좌우 문항을 각각 분리한다.
반드시 JSON만 반환한다. 형식: {"segments":[{"problemNo":"1","box":{"left":0.0,"top":0.0,"right":0.5,"bottom":0.5}}]}.
문항이 없으면 {"segments":[]}. 페이지 번호: ${cleanString(payload.page,20)} / 파일: ${cleanString(payload.fileName,180)}`;
}

function analysisPrompt(payload) {
  const context = {
    problemNo: cleanString(payload.problemNo, 20),
    grade: cleanString(payload.grade, 30),
    semester: cleanString(payload.semester, 30),
    majorUnit: cleanString(payload.majorUnit, 120),
    extractedText: cleanString(payload.extractedText, 6000),
    taxonomyVersion: cleanString(payload.taxonomyVersion, 80),
  };

  return `너는 한국 중학교 수학 문항을 문제은행용 메타데이터로 분류하는 분석기다.
반드시 첨부된 문제 이미지와 추출 텍스트를 함께 보고 판단한다.
이미지에서 도형의 실제 배치, 표시, 평행/수직/중점/등변/원/접선/보조선/접기 관계를 읽어라.
텍스트가 깨졌거나 이미지와 충돌하면 이미지 증거를 우선하되 확신도를 낮춰라.
정답을 풀어내는 것이 목적이 아니라 검색 가능한 구조를 분류하는 것이 목적이다.

분류 원칙:
- conceptTags: 교육과정 개념 태그. 예: 이등변삼각형, 삼각형의 외심, 삼각형의 내심, 평행사변형, 사다리꼴, 직사각형, 마름모, 정사각형, 닮음.
- mainConceptId: 이 문제 해결에 가장 중심적인 개념 1개. 짧은 한국어 표준명.
- relatedConceptIds: 함께 필요한 관련 개념.
- geometryStructure: "같은 모양의 문제"를 검색할 수 있을 만큼 구조적으로 기술. 숫자나 점 이름에 과도하게 의존하지 말 것. 예: "이등변삼각형 내부에 꼭짓점에서 밑변으로 선분을 그어 두 삼각형이 생기는 구조".
- askType: 최종적으로 묻는 것. 각도/길이/넓이/둘레/비/개수/증명/기타 중 가장 적절한 하나.
- solutionSkills: 실제 풀이에 필요한 기술. 예: 합동, 이등변삼각형의 성질, 외심 성질, 내심 성질, 평행선의 성질, 닮음비, 넓이 관계, 중점 활용, 접기 대응.
- predictedDifficulty: 하/중/상 중 하나.
- confidence: 0~1. 이미지나 텍스트가 불완전하거나 분류가 애매하면 0.75 미만으로 낮춰라.
추측으로 빈칸을 채우지 말고 확실하지 않은 배열 값은 제외한다.

문항 문맥:
${JSON.stringify(context)}

다음 JSON 객체만 출력하라. 설명, 마크다운, 코드펜스 금지.
{"conceptTags":[],"mainConceptId":"","relatedConceptIds":[],"geometryStructure":"","askType":"","solutionSkills":[],"predictedDifficulty":"","confidence":0}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      if (!env.PHOTOS) {
        return json({ ok: false, error: "R2 binding PHOTOS is missing" }, 500, corsHeaders);
      }
      return json({
        ok: true,
        service: "mnm-photo-api",
        storage: "R2",
        binding: "PHOTOS",
        ai: Boolean(env.AI),
        aiLicenseAutoRetry: true,
        authRequired: true,
        workerVersion: "2026-10-30-auth",
        firebaseProject: projectId(env),
      }, 200, corsHeaders);
    }

    if (request.method === "POST" && url.pathname === "/upload") {
      try {
        if (!env.PHOTOS) {
          return json({ ok: false, error: "R2 binding PHOTOS is missing" }, 500, corsHeaders);
        }
        const auth = await authorize(request, env);
        if (!auth) return unauthorized();

        const declared = Number(request.headers.get("content-length") || 0);
        if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
          return json({ ok: false, error: "파일이 너무 커요(15MB까지)" }, 413, corsHeaders);
        }

        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file === "string") {
          return json({ ok: false, error: "file is required" }, 400, corsHeaders);
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          return json({ ok: false, error: "파일이 너무 커요(15MB까지)" }, 413, corsHeaders);
        }
        if (!allowedUploadType(file.type, file.name)) {
          return json({ ok: false, error: "사진이나 PDF만 올릴 수 있어요" }, 415, corsHeaders);
        }

        // 학생은 본인 이름으로만 저장된다(폼의 studentId는 원장이 올릴 때만 쓴다).
        const owner = auth.role === "student"
          ? safeKey(auth.studentId)
          : safeKey(form.get("studentId") || "director");
        const category = safeKey(form.get("category") || "general");
        const ext = (file.name && file.name.includes(".") ? file.name.split(".").pop() : "jpg")
          .replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "jpg";

        const id = crypto.randomUUID();
        const key = `mnm/${owner}/${category}/${Date.now()}-${id}.${ext}`;

        await env.PHOTOS.put(key, file.stream(), {
          httpMetadata: { contentType: file.type || "application/octet-stream" },
          customMetadata: {
            studentId: owner,
            category,
            uploaderUid: auth.uid,
            uploaderRole: auth.role,
            firebaseProject: projectId(env),
          },
        });

        return json({
          ok: true,
          key,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }, 201, corsHeaders);
      } catch (err) {
        return json({
          ok: false,
          error: "Upload failed",
          detail: String(err?.message || err),
        }, 500, corsHeaders);
      }
    }

    if (request.method === "GET" && url.pathname === "/photo") {
      try {
        const key = safeKey(url.searchParams.get("key") || "");
        if (!key) return json({ ok: false, error: "key is required" }, 400, corsHeaders);

        const object = await env.PHOTOS.get(key);
        if (!object) return json({ ok: false, error: "Photo not found" }, 404, corsHeaders);

        const headers = new Headers(corsHeaders);
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("cache-control", "private, max-age=3600");

        return new Response(object.body, { headers });
      } catch (err) {
        return json({
          ok: false,
          error: "Read failed",
          detail: String(err?.message || err),
        }, 500, corsHeaders);
      }
    }

    if (request.method === "DELETE" && url.pathname === "/photo") {
      try {
        const auth = await authorize(request, env);
        if (!auth) return unauthorized();

        const key = safeKey(url.searchParams.get("key") || "");
        if (!key) return json({ ok: false, error: "key is required" }, 400, corsHeaders);

        if (auth.role !== "director") {
          // 학생은 자기가 올린 사진만 지울 수 있다.
          const head = await env.PHOTOS.head(key);
          if (!head) return json({ ok: true, deleted: false, key }, 200, corsHeaders);
          const meta = head.customMetadata || {};
          const mine = meta.uploaderUid === auth.uid ||
            (meta.uploaderRole === "student" && meta.studentId === safeKey(auth.studentId));
          if (!mine) return forbidden();
        }

        await env.PHOTOS.delete(key);
        return json({ ok: true, deleted: true, key }, 200, corsHeaders);
      } catch (err) {
        return json({
          ok: false,
          error: "Delete failed",
          detail: String(err?.message || err),
        }, 500, corsHeaders);
      }
    }

    if (request.method === "POST" && url.pathname === "/segment-problem-page") {
      try {
        const auth = await authorize(request, env);
        if (!auth) return unauthorized();
        if (auth.role !== "director") return forbidden();

        if (!env.AI) return json({ ok:false, error:"Workers AI binding AI is missing" },500,corsHeaders);
        if (!env.PHOTOS) return json({ ok:false, error:"R2 binding PHOTOS is missing" },500,corsHeaders);

        const contentType=request.headers.get("content-type")||"";
        if(!contentType.includes("application/json")) {
          return json({ok:false,error:"application/json is required"},415,corsHeaders);
        }

        const payload=await request.json();
        const {key,image}=await loadProblemImage(payload,env);

        const output=await runAnalysisModel(env,{
          messages:[
            {
              role:"system",
              content:"You locate math problem regions on a page image. Return JSON only."
            },
            {
              role:"user",
              content:segmentationPrompt(payload)
            }
          ],
          image,
          max_tokens:1200,
          temperature:0.05
        });

        const parsed=parseModelJson(output);

        return json({
          ok:true,
          page:Number(payload.page||0)||null,
          cropKey:key,
          model:ANALYSIS_MODEL,
          segments:normalizeSegments(parsed)
        },200,corsHeaders);

      } catch(err) {
        return json({
          ok:false,
          error:"Problem page segmentation failed",
          detail:String(err?.message||err)
        },500,corsHeaders);
      }
    }

    if (request.method === "POST" && url.pathname === "/analyze-problem") {
      try {
        const auth = await authorize(request, env);
        if (!auth) return unauthorized();
        if (auth.role !== "director") return forbidden();

        if (!env.AI) {
          return json({ ok: false, error: "Workers AI binding AI is missing" }, 500, corsHeaders);
        }

        if (!env.PHOTOS) {
          return json({ ok: false, error: "R2 binding PHOTOS is missing" }, 500, corsHeaders);
        }

        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          return json({ ok: false, error: "application/json is required" }, 415, corsHeaders);
        }

        const payload = await request.json();
        const { key, image } = await loadProblemImage(payload, env);
        const prompt = analysisPrompt(payload);

        const output = await runAnalysisModel(env, {
          messages: [
            {
              role: "system",
              content: "You are a precise Korean mathematics problem taxonomy classifier. Return JSON only.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          image,
          max_tokens: 900,
          temperature: 0.1,
        });

        const parsed = parseModelJson(output);
        const analysis = normalizeAnalysis(parsed?.analysis || parsed);

        return json({
          ok: true,
          problemId: cleanString(payload.problemId, 160),
          cropKey: key,
          model: ANALYSIS_MODEL,
          taxonomyVersion: cleanString(payload.taxonomyVersion, 80),
          analysis,
        }, 200, corsHeaders);

      } catch (err) {
        return json({
          ok: false,
          error: "Problem analysis failed",
          detail: String(err?.message || err),
        }, 500, corsHeaders);
      }
    }

    return json({
      ok: false,
      error: "Not found",
      available: [
        "GET /health",
        "POST /upload",
        "GET /photo?key=...",
        "DELETE /photo?key=...",
        "POST /analyze-problem",
        "POST /segment-problem-page",
      ],
    }, 404, corsHeaders);
  },
};
