const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ort = require('onnxruntime-node');

const humanNode = require('@vladmandic/human-node');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

const PORT = 3000;

// --------- State ---------
const camerasById = new Map();
const pipelinesByCamId = new Map();
const configsByCamId = new Map();
let globalConfig = {};

let studentsIndex = [];
let yoloSession = null;
let yoloInputName = null;

// --------- Utils ---------
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function computeCertaintyPct(sim, baseHumana, maxModelo) {
  const base = clamp(Number(baseHumana) || 0.45, 0.1, 0.8);
  const max = clamp(Number(maxModelo) || 0.85, base + 0.01, 1.0);
  let pct = 0;
  if (sim > base) pct = (sim - base) / (max - base);
  pct = clamp(pct, 0, 1);
  return Math.round(pct * 100);
}

function normalizeBox(boxRaw, frameW, frameH) {
  if (!Array.isArray(boxRaw) || boxRaw.length < 4) return null;
  const [x, y, w, h] = boxRaw;
  if (x <= 1.5 && y <= 1.5 && w <= 1.5 && h <= 1.5) return [x, y, w, h];
  if (frameW > 0 && frameH > 0) return [x / frameW, y / frameH, w / frameW, h / frameH];
  return null;
}

function currentConfigFor(camId) {
  const cfg = configsByCamId.get(camId) || {};
  return { ...globalConfig, ...cfg };
}

// --------- Human (Node) ---------
const HumanCtor = humanNode.Human || humanNode.default || humanNode;
const human = new HumanCtor({
  async: true,
  backend: 'wasm',
  modelBasePath: 'https://vladmandic.github.io/human/models/',
  filter: { equalization: true },
  face: {
    enabled: true,
    detector: { rotation: false, return: true, minConfidence: 0.15, maxDetected: 25 },
    description: { enabled: true, minConfidence: 0.45 },
    antispoof: { enabled: true },
    mesh: { enabled: false },
    iris: { enabled: false },
    emotion: { enabled: false }
  },
  body: { enabled: true, maxDetected: 25, minConfidence: 0.1 },
  hand: { enabled: false },
  object: { enabled: false }
});

async function initHuman() {
  await human.load();
  await human.warmup();
}

// --------- YOLO (Node / ORT) ---------
async function initYoloIfAvailable() {
  const modelPath = process.env.YOLO_MODEL_PATH;
  if (!modelPath) return;
  yoloSession = await ort.InferenceSession.create(modelPath);
  yoloInputName = (yoloSession.inputNames && yoloSession.inputNames[0]) || 'images';
}

async function yoloDetect(_jpegBuffer, _cfg) {
  if (!yoloSession) return [];
  // This is intentionally left as a structured stub:
  // - Decode JPEG -> RGB tensor [1,3,640,640]
  // - Run session.run({ [yoloInputName]: tensor })
  // - Parse outputs -> NMS -> [{ bbox:[x,y,w,h] normalized, score, label }]
  return [];
}

// --------- FFmpeg frame capture ---------
function splitJpegFrames(onFrame) {
  let buf = Buffer.alloc(0);
  const SOI = Buffer.from([0xff, 0xd8]);
  const EOI = Buffer.from([0xff, 0xd9]);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const start = buf.indexOf(SOI);
      if (start < 0) {
        if (buf.length > 2 * 1024 * 1024) buf = Buffer.alloc(0);
        return;
      }
      const end = buf.indexOf(EOI, start + 2);
      if (end < 0) return;
      const frame = buf.slice(start, end + 2);
      buf = buf.slice(end + 2);
      onFrame(frame);
    }
  };
}

function startCameraPipeline(cam) {
  const camId = cam.id;
  const src = cam.aiUrl || cam.rtspUrl || cam.url;
  if (!src) return;
  stopCameraPipeline(camId);

  const cfg = currentConfigFor(camId);
  const fps = clamp(Number(cfg.fps) || 8, 1, 15);

  const command = ffmpeg(src)
    .inputOptions([
      '-rtsp_transport', 'tcp',
      '-stimeout', '5000000'
    ])
    .outputOptions([
      '-an',
      '-vf', `fps=${fps}`,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '5'
    ])
    .on('start', (cmd) => console.log(`[FFMPEG] ${camId} start: ${cmd}`))
    .on('error', (err) => console.warn(`[FFMPEG] ${camId} error:`, err.message))
    .on('end', () => console.log(`[FFMPEG] ${camId} ended`));

  const stream = command.pipe();
  const onChunk = splitJpegFrames((jpeg) => handleFrame(camId, jpeg).catch(() => {}));
  stream.on('data', onChunk);
  pipelinesByCamId.set(camId, { command, stream });
}

function stopCameraPipeline(camId) {
  const p = pipelinesByCamId.get(camId);
  if (!p) return;
  pipelinesByCamId.delete(camId);
  try { p.stream?.removeAllListeners(); } catch {}
  try { p.command?.kill('SIGKILL'); } catch {}
}

async function handleFrame(camId, jpegBuffer) {
  const cfg = currentConfigFor(camId);

  const detConf = clamp(Number(cfg.vms_det_conf ?? cfg.detConf) || 0.15, 0.1, 0.9);
  const extConf = clamp(Number(cfg.vms_ext_conf ?? cfg.extConf) || 0.45, 0.1, 0.9);
  const maxDetected = clamp(Number(cfg.vms_max_detected ?? cfg.maxDetected) || 25, 1, 50);
  const rotation = (cfg.vms_det_rotation ?? cfg.detRotation) === '1';
  const equalization = (cfg.vms_equalization ?? cfg.equalization) !== '0';
  const livenessOn = (cfg.vms_liveness_on ?? cfg.livenessOn) !== '0';
  const livenessLimit = clamp(Number(cfg.vms_liveness_conf ?? cfg.livenessConf) || 0.45, 0.1, 0.9);
  const baseHumana = clamp(Number(cfg.vms_base_humana ?? cfg.baseHumana) || 0.45, 0.1, 0.8);
  const maxModelo = clamp(Number(cfg.vms_max_modelo ?? cfg.maxModelo) || 0.85, baseHumana + 0.01, 1.0);
  const aiConfidence = clamp(Number(cfg.vms_ai_confidence ?? cfg.aiConfidence) || 0.65, 0.1, 0.95);

  human.config.filter.equalization = equalization;
  human.config.face.detector.rotation = rotation;
  human.config.face.detector.minConfidence = detConf;
  human.config.face.detector.maxDetected = maxDetected;
  human.config.face.description.minConfidence = extConf;
  human.config.face.antispoof.enabled = livenessOn;

  const res = await human.detect(jpegBuffer);
  const frameW = res?.canvas?.width || 0;
  const frameH = res?.canvas?.height || 0;

  const faces = [];
  for (const f of res.face || []) {
    const bbox = normalizeBox(f.boxRaw, frameW, frameH);
    if (!bbox) continue;
    const real = Number.isFinite(f.real) ? f.real : null;
    if (livenessOn && real !== null && real < livenessLimit) {
      faces.push({ bbox, score: f.boxScore ?? f.score ?? 0, label: 'FRAUDE/FOTO', color: '#ef4444' });
      continue;
    }
    let best = null;
    let bestSim = 0;
    if (Array.isArray(f.embedding) && f.embedding.length) {
      for (const s of studentsIndex) {
        const sim = cosineSimilarity(f.embedding, s.descriptor);
        if (sim > bestSim) { bestSim = sim; best = s; }
      }
    }
    if (best && bestSim >= baseHumana) {
      const pct = computeCertaintyPct(bestSim, baseHumana, maxModelo);
      const confirmed = bestSim >= aiConfidence;
      const name = confirmed ? `${best.name} (${pct}%)` : `Analisando: ${best.name} (${pct}%)`;
      const color = best.level === 'danger' ? '#ef4444' : best.level === 'suspect' ? '#eab308' : '#10b981';
      faces.push({ bbox, score: bestSim, name, color, level: best.level, authorized: best.authorized === true });
      if (confirmed) {
        const now = Date.now();
        const camKey = String(camId || '');
        const personKey = String(best.id || best.name || '');
        const fire = async (eventType) => {
          const k = `${camKey}:${personKey}:${eventType}`;
          const last = lastRelayFireByKey.get(k) || 0;
          if (now - last < 2000) return;
          lastRelayFireByKey.set(k, now);
          await triggerRelays(eventType, { camId, person: best });
        };
        await fire('recognition');
        if (best.authorized === true) await fire('authorized');
        if (best.level === 'danger') await fire('danger');
        if (best.level === 'suspect') await fire('suspect');
      }
    } else {
      faces.push({ bbox, score: f.boxScore ?? f.score ?? 0, name: 'Desconhecido', color: '#3b82f6' });
    }
  }

  const bodies = [];
  for (const b of res.body || []) {
    const bbox = normalizeBox(b.boxRaw, frameW, frameH);
    if (!bbox) continue;
    bodies.push({ bbox, score: b.boxScore ?? b.score ?? 0, label: b.label || 'Pessoa', color: '#22c55e' });
  }

  const vehicles = await yoloDetect(jpegBuffer, cfg);

  io.emit('ai_result', {
    camId,
    ts: Date.now(),
    frame: { w: frameW, h: frameH },
    faces,
    bodies,
    vehicles,
    alerts: []
  });
}

// --------- Webhooks/Automation (server-side) ---------
let relays = [];
const lastRelayFireByKey = new Map();

async function sendWebhook(url, method = 'GET', headers = {}, body = null) {
  if (!url) return { ok: false, status: 0 };
  const fetchImpl = global.fetch || (await import('node-fetch')).default;
  const opt = { method, headers: { ...headers } };
  if (method !== 'GET' && body) {
    opt.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!opt.headers['Content-Type']) opt.headers['Content-Type'] = 'application/json';
  }
  try {
    const res = await fetchImpl(url, opt);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

function parseHeadersText(text) {
  const headers = {};
  String(text || '').split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx <= 0) return;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) headers[k] = v;
  });
  return headers;
}

async function triggerRelays(eventType, ctx) {
  for (const r of relays) {
    const allowed = Array.isArray(r.camIds) ? r.camIds : [];
    if (allowed.length && ctx?.camId && !allowed.includes(ctx.camId)) continue;
    const should =
      (eventType === 'authorized' && r.onAuthorized && ctx?.person?.authorized === true) ||
      (eventType === 'recognition' && r.onRecognition) ||
      (eventType === 'suspect' && r.onSuspect) ||
      (eventType === 'danger' && r.onDanger);
    if (!should) continue;
    const headers = parseHeadersText(r.headersText || '');
    await sendWebhook(r.onUrl, 'GET', headers, null);
    if (Number(r.autoOffMs) > 0 && r.offUrl) {
      setTimeout(() => { sendWebhook(r.offUrl, 'GET', headers, null); }, Number(r.autoOffMs));
    }
  }
}

// --------- Socket.io bridge ---------
io.on('connection', (socket) => {
  socket.on('register_cameras', (list) => {
    if (!Array.isArray(list)) return;
    const next = new Map();
    for (const cam of list) {
      if (!cam?.id) continue;
      next.set(cam.id, cam);
    }
    camerasById.clear();
    for (const [id, cam] of next) camerasById.set(id, cam);
    for (const [id] of pipelinesByCamId) {
      if (!camerasById.has(id)) stopCameraPipeline(id);
    }
    for (const cam of camerasById.values()) {
      const src = cam.aiUrl || cam.rtspUrl || cam.url || '';
      if (typeof src === 'string' && src.startsWith('rtsp://')) startCameraPipeline(cam);
    }
  });

  socket.on('sync_students', (list) => {
    if (!Array.isArray(list)) return;
    const next = [];
    for (const p of list) {
      const raw = Array.isArray(p?.descriptors) ? p.descriptors : [];
      for (const d of raw) {
        try {
          const parsed = typeof d === 'string' ? JSON.parse(d) : d;
          if (!Array.isArray(parsed) || parsed.length === 0) continue;
          next.push({
            id: p.id,
            name: p.name,
            level: p.level || 'normal',
            authorized: p.authorized === true,
            descriptor: new Float32Array(parsed)
          });
        } catch {}
      }
    }
    studentsIndex = next;
  });

  socket.on('update_config', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const camId = payload.camId || null;
    const config = payload.config || null;
    if (config && typeof config === 'object') {
      if (camId) configsByCamId.set(camId, config);
      else globalConfig = config;
    }
    if (camId && camerasById.has(camId)) startCameraPipeline(camerasById.get(camId));
  });

  socket.on('update_relays', (list) => {
    if (!Array.isArray(list)) return;
    relays = list;
  });
});

// --------- HTTP helpers (optional) ---------
app.get('/health', (_req, res) => res.json({ ok: true }));

// Used by the frontend to generate embeddings for enrollment and to support any remaining UI flows
// that rely on Human.detect() (now delegated to the backend).
app.post('/api/human_detect', async (req, res) => {
  try {
    const image = String(req.body?.image || '');
    if (!image.startsWith('data:image')) return res.status(400).json({ error: 'invalid_image' });
    const comma = image.indexOf(',');
    const b64 = comma >= 0 ? image.slice(comma + 1) : '';
    const buf = Buffer.from(b64, 'base64');

    const cfg = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
    const detConf = clamp(Number(cfg.vms_det_conf ?? cfg.detConf) || 0.15, 0.1, 0.9);
    const extConf = clamp(Number(cfg.vms_ext_conf ?? cfg.extConf) || 0.45, 0.1, 0.9);
    const maxDetected = clamp(Number(cfg.vms_max_detected ?? cfg.maxDetected) || 25, 1, 50);
    const rotation = (cfg.vms_det_rotation ?? cfg.detRotation) === '1';
    const equalization = (cfg.vms_equalization ?? cfg.equalization) !== '0';
    const livenessOn = (cfg.vms_liveness_on ?? cfg.livenessOn) !== '0';

    human.config.filter.equalization = equalization;
    human.config.face.detector.rotation = rotation;
    human.config.face.detector.minConfidence = detConf;
    human.config.face.detector.maxDetected = maxDetected;
    human.config.face.description.minConfidence = extConf;
    human.config.face.antispoof.enabled = livenessOn;

    const out = await human.detect(buf);
    const frameW = out?.canvas?.width || 0;
    const frameH = out?.canvas?.height || 0;
    const faces = (out.face || []).map((f) => ({
      id: f.id,
      boxRaw: normalizeBox(f.boxRaw, frameW, frameH),
      boxScore: f.boxScore ?? f.score ?? 0,
      score: f.score ?? f.boxScore ?? 0,
      real: f.real ?? null,
      age: f.age ?? null,
      gender: f.gender ?? null,
      genderScore: f.genderScore ?? null,
      embedding: Array.isArray(f.embedding) ? f.embedding : (f.embedding ? Array.from(f.embedding) : null)
    }));
    const bodies = (out.body || []).map((b) => ({
      id: b.id,
      boxRaw: normalizeBox(b.boxRaw, frameW, frameH),
      boxScore: b.boxScore ?? b.score ?? 0,
      score: b.score ?? b.boxScore ?? 0,
      label: b.label || 'Pessoa'
    }));
    res.json({ canvas: { width: frameW, height: frameH }, face: faces, body: bodies });
  } catch (e) {
    res.status(500).json({ error: 'detect_failed' });
  }
});

// --------- Boot ---------
async function main() {
  await initHuman();
  await initYoloIfAvailable();
  server.listen(PORT, () => console.log(`AI backend listening on http://localhost:${PORT}`));
}

main().catch((e) => {
  console.error('Fatal backend boot error:', e);
  process.exit(1);
});
