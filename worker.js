// ai-worker.js - Cérebro Independente (Processamento Paralelo)
// Importar bibliotecas diretamente para o worker (sem DOM)
importScripts('https://cdn.jsdelivr.net/npm/@vladmandic/human@3.2.2/dist/human.js');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd');

let human = null;
let objectModel = null;
let isReady = false;

// Recebe as configurações da Main Thread e arranca o motor
async function initEngine(config, backendToForce) {
  try {
    const HumanCtor = (typeof Human === 'function') ? Human : (Human?.Human || Human?.default);
    human = new HumanCtor(config);

    // Aplica o backend descoberto pelo frontend
    human.config.backend = backendToForce || 'wasm';

    await human.load();
    await human.warmup();

    try {
      objectModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    } catch (e) { console.warn('Worker: Falha no TF-SSD', e); }

    isReady = true;
    postMessage({ type: 'INIT_SUCCESS', backend: human.config.backend });
  } catch (error) {
    postMessage({ type: 'INIT_ERROR', error: error.message });
  }
}

// O Loop de Inferência agora vive aqui, livre de bloqueios de UI
async function processFrame(imageData, camId, configOverrides) {
  if (!isReady || !human) {
    postMessage({ type: 'PROCESS_RESULT', camId, error: 'Not Ready' });
    return;
  }

  try {
    // Aplica as sobreposições táticas específicas desta câmara (ex: sensibilidade)
    if (configOverrides) {
      if (configOverrides.detConf !== undefined) human.config.face.detector.minConfidence = configOverrides.detConf;
      if (configOverrides.extConf !== undefined) human.config.face.description.minConfidence = configOverrides.extConf;
    }

    // Execução paralela dos modelos
    const tasks = [human.detect(imageData)];

    // Só acorda o TensorFlow SSD se a câmara pedir (poupança de recursos)
    if (configOverrides?.vehicles || configOverrides?.crowd || configOverrides?.flowCount) {
      if (objectModel) tasks.push(objectModel.detect(imageData).catch(() => []));
      else tasks.push(Promise.resolve([]));
    } else {
      tasks.push(Promise.resolve([]));
    }

    const [humanResult, vPreds] = await Promise.all(tasks);

    // Prepara os resultados. Limpamos os tensores pesados, enviando só dados brutos via postMessage
    const safeFaces = (humanResult.face || []).map(f => ({
      boxRaw: f.boxRaw, boxScore: f.boxScore, score: f.score,
      real: f.real, age: f.age, gender: f.gender, genderScore: f.genderScore,
      // Importante: Passar o Array de floats normalizado, o postMessage não lida bem com Tensores puros
      embedding: f.embedding ? Array.from(f.embedding) : null
    }));

    const safeBodies = (humanResult.body || []).map(b => ({
      boxRaw: b.boxRaw, id: b.id
    }));

    // Devolve os resultados mastigados à Main Thread
    postMessage({
      type: 'PROCESS_RESULT',
      camId: camId,
      result: { faces: safeFaces, bodies: safeBodies, vehiclePredictions: vPreds }
    });
  } catch (error) {
    postMessage({ type: 'PROCESS_RESULT', camId, error: error.message });
  }
}

// Escuta comandos da Main Thread
onmessage = async (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT_ENGINE':
      await initEngine(payload.config, payload.backend);
      break;
    case 'PROCESS_FRAME':
      // Recebemos a ImageData diretamente
      await processFrame(payload.imageData, payload.camId, payload.configOverrides);
      break;
  }
};
