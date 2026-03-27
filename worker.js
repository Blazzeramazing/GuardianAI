// ai-worker.js - Cérebro Independente (Processamento Paralelo)
importScripts('https://cdn.jsdelivr.net/npm/@vladmandic/human@3.2.2/dist/human.js');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd');

let human = null;
let objectModel = null;
let isReady = false;

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

    try { objectModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' }); }
    catch (e) { console.warn('Worker: TF-SSD Offline', e); }

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

    if (configOverrides?.vehicles || configOverrides?.crowd || configOverrides?.flowCount) {
      if (objectModel) tasks.push(objectModel.detect(imageData).catch(() => []));
      else tasks.push(Promise.resolve([]));
    } else {
      tasks.push(Promise.resolve([]));
    }

    const [humanResult, vPreds] = await Promise.all(tasks);

    const safeFaces = (humanResult.face || []).map(f => ({
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
