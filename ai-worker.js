// ai-worker.js - Cérebro Independente (Processamento Paralelo)
importScripts('https://cdn.jsdelivr.net/npm/@vladmandic/human@3.2.2/dist/human.js');
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js');

let human = null;
let isReady = false;
let yoloSession = null;
let yoloInputName = null;

const YOLO_INPUT_SIZE = 640;
const YOLO_MODEL_URL = 'https://cdn.jsdelivr.net/gh/Hyuto/yolov8-onnxruntime-web@main/public/model/yolov8n.onnx';
const YOLO_LABELS = [
  'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'
];

function boxIou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const inter = w * h;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function nms(boxes, scores, iouThreshold, maxDet) {
  const idxs = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const keep = [];
  for (const i of idxs) {
    let ok = true;
    for (const j of keep) {
      if (boxIou(boxes[i], boxes[j]) > iouThreshold) { ok = false; break; }
    }
    if (ok) {
      keep.push(i);
      if (keep.length >= maxDet) break;
    }
  }
  return keep;
}

async function initYolo() {
  if (typeof ort === 'undefined') return;
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
  yoloSession = await ort.InferenceSession.create(YOLO_MODEL_URL, { executionProviders: ['wasm'] });
  yoloInputName = yoloSession.inputNames[0];
}

async function yoloDetect(imageData) {
  if (!yoloSession || !yoloInputName) return [];
  const origW = imageData.width;
  const origH = imageData.height;
  if (!origW || !origH) return [];

  const ratio = Math.min(YOLO_INPUT_SIZE / origW, YOLO_INPUT_SIZE / origH);
  const newW = Math.round(origW * ratio);
  const newH = Math.round(origH * ratio);
  const padX = Math.floor((YOLO_INPUT_SIZE - newW) / 2);
  const padY = Math.floor((YOLO_INPUT_SIZE - newH) / 2);

  const canvas = new OffscreenCanvas(YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
  const bitmap = await createImageBitmap(imageData);
  ctx.drawImage(bitmap, padX, padY, newW, newH);
  bitmap.close();
  const data = ctx.getImageData(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE).data;

  const size = YOLO_INPUT_SIZE * YOLO_INPUT_SIZE;
  const input = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) {
    input[i] = data[i * 4] / 255;
    input[i + size] = data[i * 4 + 1] / 255;
    input[i + size * 2] = data[i * 4 + 2] / 255;
  }
  const tensor = new ort.Tensor('float32', input, [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE]);
  const outputs = await yoloSession.run({ [yoloInputName]: tensor });
  const outName = yoloSession.outputNames[0];
  const out = outputs[outName];
  const dims = out.dims;
  const raw = out.data;
  if (!dims || dims.length !== 3) return [];

  let rows = 0;
  let cols = 0;
  let strideRow = 0;
  let strideCol = 0;
  let transposed = false;
  if (dims[1] === 8400) {
    rows = dims[1];
    cols = dims[2];
    strideRow = cols;
  } else if (dims[2] === 8400) {
    rows = dims[2];
    cols = dims[1];
    strideCol = rows;
    transposed = true;
  } else {
    return [];
  }
  const numClasses = cols - 4;
  const scoreThreshold = 0.25;
  const iouThreshold = 0.45;
  const maxDet = 100;

  const boxes = [];
  const scores = [];
  const classIds = [];

  for (let r = 0; r < rows; r++) {
    const base = transposed ? r : r * strideRow;
    const xc = transposed ? raw[0 * strideCol + r] : raw[base + 0];
    const yc = transposed ? raw[1 * strideCol + r] : raw[base + 1];
    const w = transposed ? raw[2 * strideCol + r] : raw[base + 2];
    const h = transposed ? raw[3 * strideCol + r] : raw[base + 3];

    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = transposed ? raw[(4 + c) * strideCol + r] : raw[base + 4 + c];
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (bestScore < scoreThreshold) continue;

    const x1 = xc - w / 2;
    const y1 = yc - h / 2;
    const x2 = xc + w / 2;
    const y2 = yc + h / 2;
    boxes.push([x1, y1, x2, y2]);
    scores.push(bestScore);
    classIds.push(best);
  }

  const keep = nms(boxes, scores, iouThreshold, maxDet);
  const results = [];
  for (const i of keep) {
    const clsId = classIds[i];
    const label = YOLO_LABELS[clsId] || String(clsId);
    const bx = boxes[i];
    let x1 = (bx[0] - padX) / ratio;
    let y1 = (bx[1] - padY) / ratio;
    let x2 = (bx[2] - padX) / ratio;
    let y2 = (bx[3] - padY) / ratio;
    x1 = Math.max(0, Math.min(origW - 1, x1));
    y1 = Math.max(0, Math.min(origH - 1, y1));
    x2 = Math.max(0, Math.min(origW - 1, x2));
    y2 = Math.max(0, Math.min(origH - 1, y2));
    const bw = Math.max(0, x2 - x1);
    const bh = Math.max(0, y2 - y1);
    results.push({ bbox: [x1, y1, bw, bh], class: label, score: scores[i] });
  }
  return results;
}

async function initEngine(config, requestedBackend) {
  try {
    const HumanCtor = (typeof Human === 'function') ? Human : (Human?.Human || Human?.default);
    human = new HumanCtor(config);

    // Loop de Resistência: Tenta o melhor, se falhar tenta o próximo!
    const backends = [requestedBackend, 'webgl', 'wasm'].filter(Boolean);
    let loaded = false;

    for (const b of backends) {
      try {
        human.config.backend = b;
        await human.load();
        await human.warmup();
        loaded = true;
        break;
      } catch (e) {
        console.warn(`Worker: Falha ao usar o backend '${b}'. A tentar o próximo...`);
      }
    }

    if (!loaded) throw new Error("Todos os motores de hardware falharam.");

    try { await initYolo(); } catch (e) {}

    isReady = true;
    postMessage({ type: 'INIT_SUCCESS', backend: human.config.backend });
  } catch (error) {
    postMessage({ type: 'INIT_ERROR', error: error.message });
  }
}

async function processFrame(imageData, camId, configOverrides) {
  if (!isReady || !human) {
    postMessage({ type: 'PROCESS_RESULT', camId, error: 'Not Ready' });
    return;
  }

  try {
    if (configOverrides) {
      if (configOverrides.detConf !== undefined) human.config.face.detector.minConfidence = configOverrides.detConf;
      if (configOverrides.extConf !== undefined) human.config.face.description.minConfidence = configOverrides.extConf;
    }

    const tasks = [human.detect(imageData)];
    tasks.push(yoloDetect(imageData).catch(() => []));

    const [humanResult, vPreds] = await Promise.all(tasks);

    const safeFaces = (humanResult.face || []).map(f => ({
      id: f.id,
      boxRaw: f.boxRaw, boxScore: f.boxScore, score: f.score,
      real: f.real, age: f.age, gender: f.gender, genderScore: f.genderScore,
      embedding: f.embedding ? Array.from(f.embedding) : null
    }));

    const safeBodies = (humanResult.body || []).map(b => ({ boxRaw: b.boxRaw, id: b.id }));

    postMessage({ type: 'PROCESS_RESULT', camId, result: { faces: safeFaces, bodies: safeBodies, vehiclePredictions: vPreds } });
  } catch (error) {
    postMessage({ type: 'PROCESS_RESULT', camId, error: error.message });
  }
}

onmessage = async (e) => {
  const { type, payload } = e.data;
  if (type === 'INIT_ENGINE') await initEngine(payload.config, payload.backend);
  if (type === 'PROCESS_FRAME') await processFrame(payload.imageData, payload.camId, payload.configOverrides);
};
