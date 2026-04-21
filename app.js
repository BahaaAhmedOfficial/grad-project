const PLAYER_COUNT = 11;
const TOAST_TIMEOUT_MS = 4200;
const RECONNECT_DELAY_MS = 2500;
const DEFAULT_WS_URL = "ws://192.168.4.1:81";
const START_MATCH_WHISTLE_SRC = "assets/soundEffects/Start Match Whistle.opus";
const END_MATCH_WHISTLE_SRC = "assets/soundEffects/End Match Whistle.opus";
const FIELD_X_MIN = 8;
const FIELD_X_MAX = 92;
const FIELD_Y_MIN = 14;
const FIELD_Y_MAX = 86;
const DEFAULT_HEADING_DEG = -90;
const MOVEMENT_SPEED_TO_PERCENT_PER_SEC = 2.6;
const RANDOM_DRIFT_INTERVAL_MS = 900;
const SPO2_CRITICAL_HOLD_MS = 60000;
const HR_RECOVERY_WINDOW_MS = 60000;
const ECG_CRITICAL_WINDOW_MS = 3000;
const WARNING_DEBOUNCE_MS = 9000;
const CRITICAL_REOPEN_DEBOUNCE_MS = 10000;
const ECG_BUFFER_SIZE = 1400;

const SUPABASE_URL = "https://doahbvwljbrjbduhhbtb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_2ZRNKUPXJuy51hgQ2K_4-g_UOQnbDq8";
const supabaseClient =
  window.supabase &&
  typeof window.supabase.createClient === "function" &&
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

const METRIC_CONFIG = [
  { key: "heartRate", label: "Heart Rate", unit: "bpm" },
  { key: "spo2", label: "Blood Oxygen", unit: "%" },
  { key: "bodyTemp", label: "Body Temperature", unit: "degC" },
  { key: "muscleFatigue", label: "Muscle Fatigue", unit: "Hz" },
  { key: "acceleration", label: "Acceleration", unit: "m/s2" },
  { key: "ecg", label: "ECG", unit: "mV" },
];

const METRIC_CARD_BACKGROUNDS = {
  heartRate: "assets/cards/hearRateCard.png",
  spo2: "assets/cards/bloodOxygenCard.jpg",
  bodyTemp: "assets/cards/bodyTempCard.png",
  muscleFatigue: "assets/cards/emgCard.jpg",
  acceleration: "assets/cards/accelerationCard.jpg",
  ecg: "assets/cards/ecgCard.png",
};

const CRITICAL_RULES = {
  heartRate: (v) => v > 188 || v < 42,
  spo2: (v) => v < 89,
  bodyTemp: (v) => v > 39.8,
  muscleFatigue: (v) => v < 56,
  acceleration: (v) => v > 17.5,
  ecg: (v) => Math.abs(v) > 2.6,
};

const ENGLISH_PLAYER_NAMES = [
  "James Carter",
  "Liam Walker",
  "Noah Bennett",
  "Ethan Foster",
  "Mason Brooks",
  "Lucas Perry",
  "Oliver Reed",
  "Henry Collins",
  "Jack Turner",
  "Daniel Cooper",
  "Aiden Hayes",
  "Logan Russell",
  "Caleb Morris",
  "Ryan Griffin",
  "Nathan Ward",
  "Isaac Palmer",
  "Levi Hughes",
  "Owen Barnes",
  "Dylan Price",
  "Jacob Wells",
];

const aiCache = new Map();
const aiPendingRequests = new Map();
const AI_PROXY_URL = "";

const FORMATION_4_4_3 = [
  { top: "83%", left: "50%" },
  { top: "67%", left: "18%" },
  { top: "67%", left: "39%" },
  { top: "67%", left: "61%" },
  { top: "67%", left: "82%" },
  { top: "50%", left: "16%" },
  { top: "50%", left: "38%" },
  { top: "50%", left: "62%" },
  { top: "50%", left: "84%" },
  { top: "30%", left: "33%" },
  { top: "30%", left: "67%" },
];

const state = {
  profile: null,
  players: [],
  activeVestPlayerId: null,
  matchState: "Idle",
  matchStartedAt: null,
  playerPositions: createInitialFormationPositions(),
  route: parseHashRoute(),
  summaryByPlayer: new Map(),
  toasts: new Map(),
  ws: {
    socket: null,
    reconnectTimer: null,
    disposed: false,
    connected: false,
  },
  exportLock: false,
  movement: {
    headingDeg: DEFAULT_HEADING_DEG,
    lastUpdateTs: null,
    randomVectors: new Map(),
  },
  exportInFlightByPlayer: new Set(),
  physiological: {
    perPlayer: new Map(),
    metricHighlightsByPlayer: new Map(),
    notificationHistoryByPlayer: new Map(),
    warningDebounceByPlayer: new Map(),
    criticalDebounceByPlayer: new Map(),
    criticalModal: null,
  },
  ecgMonitor: {
    buffer: new Float32Array(ECG_BUFFER_SIZE),
    writeIndex: 0,
    lastValue: 0,
    canvas: null,
    context: null,
    gridCanvas: null,
    animationFrameId: null,
    gridKey: "",
    visible: false,
    drawLoopRunning: false,
  },
};

const dom = {
  root: document.getElementById("root"),
  toastLayer: null,
};

const physiologyStateStore = new Map();

function createElement(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);

  if (options.className) {
    node.className = options.className;
  }

  if (options.text !== undefined) {
    node.textContent = options.text;
  }

  if (options.html !== undefined) {
    node.innerHTML = options.html;
  }

  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        node.setAttribute(key, String(value));
      }
    });
  }

  if (options.style) {
    Object.entries(options.style).forEach(([key, value]) => {
      node.style.setProperty(key, value);
    });
  }

  if (options.on) {
    Object.entries(options.on).forEach(([eventName, handler]) => {
      node.addEventListener(eventName, handler);
    });
  }

  children.forEach((child) => {
    if (child === null || child === undefined) {
      return;
    }
    if (typeof child === "string") {
      node.appendChild(document.createTextNode(child));
      return;
    }
    node.appendChild(child);
  });

  return node;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTelemetryPayload(rawPayload) {
  const source =
    typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  if (!source || typeof source !== "object") {
    return null;
  }

  const telemetry = {
    heartRate: toNumber(source.heartRate ?? source.hr ?? source.heart_rate),
    spo2: toNumber(source.spo2 ?? source.SpO2 ?? source.spo2_percent),
    bodyTemp: toNumber(
      source.bodyTemp ?? source.temp ?? source.temperature ?? source.body_temp,
    ),
    muscleFatigue: toNumber(
      source.muscleFatigue ?? source.emg ?? source.emg_hz,
    ),
    acceleration: toNumber(
      source.acceleration ?? source.accel ?? source.acceleration_ms2,
    ),
    speed: toNumber(source.speed ?? source.velocity ?? source.speed_ms),
    gyroX: toNumber(source.gyroX ?? source.gx ?? source.gyroscope_x),
    gyroY: toNumber(source.gyroY ?? source.gy ?? source.gyroscope_y),
    gyroZ: toNumber(source.gyroZ ?? source.gz ?? source.gyroscope_z),
    ecg: toNumber(source.ecg ?? source.ecg_mv ?? source.ecg_millivolts),
  };

  const hasAnyValue = Object.values(telemetry).some((value) => value !== null);
  return hasAnyValue ? telemetry : null;
}

function normalizeECGSamples(rawPayload) {
  const source =
    typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  if (!source || typeof source !== "object") {
    return [];
  }

  const rawSamples =
    source.ecgSamples ?? source.ecgWave ?? source.ecgArray ?? source.ecg_buffer;
  if (!Array.isArray(rawSamples)) {
    return [];
  }

  return rawSamples
    .map((sample) => toNumber(sample))
    .filter((sample) => sample !== null);
}

function pickUniqueJerseys(count, reserved) {
  const set = new Set(reserved ? [Number(reserved)] : []);
  const jerseys = [];

  while (jerseys.length < count) {
    const candidate = Math.floor(Math.random() * 99) + 1;
    if (set.has(candidate)) {
      continue;
    }
    set.add(candidate);
    jerseys.push(candidate);
  }

  return jerseys;
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createInitialPlayers(profile) {
  const names = shuffle(ENGLISH_PLAYER_NAMES).slice(0, PLAYER_COUNT);
  const jerseys = pickUniqueJerseys(PLAYER_COUNT, profile.jerseyNumber);

  return Array.from({ length: PLAYER_COUNT }, (_, i) => ({
    id: i + 1,
    name: names[i],
    jerseyNumber: jerseys[i],
    heightCm: null,
    weightKg: null,
    age: null,
    online: false,
    telemetry: {
      heartRate: null,
      spo2: null,
      bodyTemp: null,
      muscleFatigue: null,
      acceleration: null,
      speed: null,
      gyroX: null,
      gyroY: null,
      gyroZ: null,
      ecg: null,
    },
    lastSeen: null,
    samplesCaptured: 0,
  }));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createInitialFormationPositions() {
  return FORMATION_4_4_3.map((pos, index) => ({
    id: index + 1,
    x: Number.parseFloat(pos.left),
    y: Number.parseFloat(pos.top),
  }));
}

function movePointByHeading(position, headingDeg, distance) {
  const radians = (headingDeg * Math.PI) / 180;
  const dx = Math.cos(radians) * distance;
  const dy = Math.sin(radians) * distance;

  return {
    x: clamp(position.x + dx, FIELD_X_MIN, FIELD_X_MAX),
    y: clamp(position.y + dy, FIELD_Y_MIN, FIELD_Y_MAX),
  };
}

function parseHashRoute() {
  const hash = window.location.hash || "#/";
  if (!hash.startsWith("#/player/")) {
    return { name: "team" };
  }

  const idPart = hash.replace("#/player/", "");
  const id = Number(idPart);
  if (!Number.isInteger(id)) {
    return { name: "team" };
  }

  return { name: "player", id };
}

function formatMetric(value, key) {
  if (value === null || value === undefined) {
    return "--";
  }

  if (key === "bodyTemp" || key === "acceleration" || key === "ecg") {
    return Number(value).toFixed(2);
  }

  if (key === "muscleFatigue") {
    return Number(value).toFixed(1);
  }

  return Math.round(value).toString();
}

function getCriticalFlags(telemetry) {
  return Object.fromEntries(
    METRIC_CONFIG.map((metric) => [
      metric.key,
      telemetry[metric.key] !== null &&
        CRITICAL_RULES[metric.key](telemetry[metric.key]),
    ]),
  );
}

function getCriticalMessages(playerName, telemetry) {
  const alerts = [];

  METRIC_CONFIG.forEach((metric) => {
    const value = telemetry[metric.key];
    if (value === null || value === undefined) {
      return;
    }

    if (CRITICAL_RULES[metric.key](value)) {
      alerts.push(
        `${playerName}: ${metric.label} critical at ${formatMetric(value, metric.key)} ${metric.unit}`,
      );
    }
  });

  return alerts;
}

function getMetricCardStyle(metricKey) {
  const backgroundImage = METRIC_CARD_BACKGROUNDS[metricKey];
  if (!backgroundImage) {
    return {};
  }

  return { "--metric-card-bg": `url("${backgroundImage}")` };
}

function playWhistle(src) {
  const audio = new Audio(src);
  audio.play().catch(() => {
    // Ignore playback errors (for example, unsupported format on some browsers).
  });
}

function ensureToastLayer() {
  if (dom.toastLayer) {
    return dom.toastLayer;
  }

  dom.toastLayer = createElement("div", {
    className: "fixed right-4 top-4 z-50 space-y-2 w-[min(92vw,26rem)]",
  });

  document.body.appendChild(dom.toastLayer);
  return dom.toastLayer;
}

function removeToast(id) {
  const toast = state.toasts.get(id);
  if (!toast) {
    return;
  }

  if (toast.timer) {
    clearTimeout(toast.timer);
  }

  if (toast.node && toast.node.parentNode) {
    toast.node.parentNode.removeChild(toast.node);
  }

  state.toasts.delete(id);
}

function pushToast(message, level = "info") {
  const layer = ensureToastLayer();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const closeButton = createElement("button", {
    className: "text-xs opacity-70 hover:opacity-100",
    text: "Close",
  });

  const text = createElement("p", {
    className: "text-sm font-semibold leading-5",
    text: message,
  });

  const row = createElement(
    "div",
    { className: "flex items-start justify-between gap-4" },
    [text, closeButton],
  );

  const card = createElement(
    "div",
    {
      className: `toast-card ${level === "critical" ? "critical" : level === "warning" ? "warning" : "info"}`,
    },
    [row],
  );

  closeButton.addEventListener("click", () => removeToast(id));

  layer.appendChild(card);

  const timer = setTimeout(() => {
    removeToast(id);
  }, TOAST_TIMEOUT_MS);

  state.toasts.set(id, { node: card, timer });
}

function getOrCreatePhysiologyState(playerId) {
  if (!physiologyStateStore.has(playerId)) {
    physiologyStateStore.set(playerId, {
      spo2Below90Since: null,
      sprintActive: false,
      sprintStartedAt: null,
      sprintEndedAt: null,
      hrRecoveryDeadlineAt: null,
      ecgAbove4Since: null,
    });
  }

  return physiologyStateStore.get(playerId);
}

function evaluateTelemetry(data, playerProfile) {
  const now = Date.now();
  const playerId = Number(playerProfile?.id ?? state.activeVestPlayerId ?? 0);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return { currentTier: 1, messages: [] };
  }

  const playerState = getOrCreatePhysiologyState(playerId);
  const age = Math.max(10, Number(playerProfile?.age) || 24);
  const maxHR = 220 - age;

  const heartRate = toNumber(data?.heartRate);
  const spo2 = toNumber(data?.spo2);
  const bodyTemp = toNumber(data?.bodyTemp);
  const muscleFatigueDrop = toNumber(data?.muscleFatigue);
  const acceleration = toNumber(data?.acceleration);
  const ecg = toNumber(data?.ecg);

  const metricTiers = {
    heartRate: 1,
    spo2: 1,
    bodyTemp: 1,
    muscleFatigue: 1,
    acceleration: 1,
    ecg: 1,
  };

  const warningMessages = [];
  const criticalMessages = [];

  const updateMetricTier = (metricKey, tier, message) => {
    metricTiers[metricKey] = Math.max(metricTiers[metricKey], tier);
    if (!message) {
      return;
    }
    if (tier >= 3) {
      criticalMessages.push(message);
    } else if (tier === 2) {
      warningMessages.push(message);
    }
  };

  if (acceleration !== null) {
    if (acceleration > 3.0) {
      playerState.sprintActive = true;
      playerState.sprintStartedAt = now;
      playerState.hrRecoveryDeadlineAt = null;
    }

    if (playerState.sprintActive && acceleration < 1.5) {
      playerState.sprintActive = false;
      playerState.sprintEndedAt = now;
      playerState.hrRecoveryDeadlineAt = now + HR_RECOVERY_WINDOW_MS;
    }

    if (acceleration > 8.0 || acceleration < -8.0) {
      updateMetricTier(
        "acceleration",
        3,
        `Critical impact spike detected (${formatMetric(acceleration, "acceleration")} m/s2).`,
      );
    } else if (acceleration < -3.0) {
      updateMetricTier(
        "acceleration",
        2,
        `Warning: deceleration load is high (${formatMetric(acceleration, "acceleration")} m/s2).`,
      );
    } else if (acceleration < -2.5 || acceleration > 4.0) {
      updateMetricTier(
        "acceleration",
        2,
        `Warning: acceleration is outside optimal training band (${formatMetric(acceleration, "acceleration")} m/s2).`,
      );
    }
  }

  if (heartRate !== null) {
    if (heartRate > maxHR * 1.05) {
      updateMetricTier(
        "heartRate",
        3,
        `Critical: heart rate exceeded 105% of maxHR (${Math.round(heartRate)} bpm).`,
      );
    } else if (heartRate >= maxHR * 0.95) {
      updateMetricTier(
        "heartRate",
        2,
        `Warning: heart rate is in overload zone (${Math.round(heartRate)} bpm).`,
      );
    }

    if (
      playerState.hrRecoveryDeadlineAt &&
      now >= playerState.hrRecoveryDeadlineAt
    ) {
      if (heartRate >= maxHR * 0.85) {
        updateMetricTier(
          "heartRate",
          3,
          `Critical: heart rate recovery failed after sprint (${Math.round(heartRate)} bpm at 60s).`,
        );
      }
      playerState.hrRecoveryDeadlineAt = null;
    }
  }

  if (spo2 !== null) {
    if (spo2 < 90) {
      if (!playerState.spo2Below90Since) {
        playerState.spo2Below90Since = now;
      }

      if (now - playerState.spo2Below90Since > SPO2_CRITICAL_HOLD_MS) {
        updateMetricTier(
          "spo2",
          3,
          `Critical: SpO2 has remained below 90% for over 60s (${Math.round(spo2)}%).`,
        );
      } else {
        updateMetricTier(
          "spo2",
          2,
          `Warning: SpO2 is currently low (${Math.round(spo2)}%).`,
        );
      }
    } else {
      if (spo2 >= 90) {
        playerState.spo2Below90Since = null;
      }

      if (spo2 <= 93) {
        updateMetricTier(
          "spo2",
          2,
          `Warning: SpO2 is in caution zone (${Math.round(spo2)}%).`,
        );
      }
    }
  }

  if (bodyTemp !== null) {
    if (bodyTemp >= 40.5) {
      updateMetricTier(
        "bodyTemp",
        3,
        `Critical: body temperature reached ${formatMetric(bodyTemp, "bodyTemp")} C.`,
      );
    } else if (bodyTemp >= 39.5) {
      updateMetricTier(
        "bodyTemp",
        2,
        `Warning: body temperature elevated to ${formatMetric(bodyTemp, "bodyTemp")} C.`,
      );
    }
  }

  if (muscleFatigueDrop !== null) {
    if (muscleFatigueDrop >= 20) {
      updateMetricTier(
        "muscleFatigue",
        3,
        `Critical: muscle fatigue drop is ${formatMetric(muscleFatigueDrop, "muscleFatigue")}%`,
      );
    } else if (muscleFatigueDrop >= 11) {
      updateMetricTier(
        "muscleFatigue",
        2,
        `Warning: muscle fatigue drop is ${formatMetric(muscleFatigueDrop, "muscleFatigue")}%`,
      );
    }
  }

  if (ecg !== null) {
    if (ecg > 4.0) {
      if (!playerState.ecgAbove4Since) {
        playerState.ecgAbove4Since = now;
      }

      if (now - playerState.ecgAbove4Since >= ECG_CRITICAL_WINDOW_MS) {
        updateMetricTier(
          "ecg",
          3,
          `Critical: ECG R-wave remained above 4.0 mV for 3 seconds (${formatMetric(ecg, "ecg")} mV).`,
        );
      } else {
        updateMetricTier(
          "ecg",
          2,
          `Warning: ECG R-wave is elevated (${formatMetric(ecg, "ecg")} mV).`,
        );
      }
    } else {
      playerState.ecgAbove4Since = null;
      if (ecg < 0.5) {
        updateMetricTier(
          "ecg",
          2,
          `Warning: ECG R-wave is low (${formatMetric(ecg, "ecg")} mV).`,
        );
      } else if (ecg < 1.5 || ecg > 3.5) {
        updateMetricTier(
          "ecg",
          2,
          `Warning: ECG is outside baseline range (${formatMetric(ecg, "ecg")} mV).`,
        );
      }
    }
  }

  const metricEntries = Object.entries(metricTiers);
  const criticalMetricKeys = metricEntries
    .filter(([, tier]) => tier >= 3)
    .map(([key]) => key);
  const warningMetricKeys = metricEntries
    .filter(([, tier]) => tier === 2)
    .map(([key]) => key);
  const currentTier = Math.max(1, ...metricEntries.map(([, tier]) => tier));

  state.physiological.metricHighlightsByPlayer.set(
    playerId,
    new Set(criticalMetricKeys),
  );

  return {
    currentTier,
    messages: [...criticalMessages, ...warningMessages],
    playerId,
    criticalMessages,
    warningMessages,
    criticalMetricKeys,
    warningMetricKeys,
    metricTiers,
  };
}

function dismissCriticalModal() {
  state.physiological.criticalModal = null;
  render();
}

function getNotificationHistoryForPlayer(playerId) {
  if (!state.physiological.notificationHistoryByPlayer.has(playerId)) {
    state.physiological.notificationHistoryByPlayer.set(playerId, []);
  }

  return state.physiological.notificationHistoryByPlayer.get(playerId);
}

function renderNotificationHistoryEntry(entry) {
  const tagClass =
    entry.tier >= 3
      ? "bg-red-100 text-red-700 border-red-300"
      : "bg-amber-100 text-amber-700 border-amber-300";
  const tagText = entry.tier >= 3 ? "Tier 3 Critical" : "Tier 2 Warning";

  const row = createElement("div", {
    className:
      "flex items-start gap-2 border-b border-slate-200 py-2 text-sm text-slate-800",
  });

  row.appendChild(
    createElement("span", {
      className:
        "shrink-0 rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600",
      text: entry.time,
    }),
  );

  row.appendChild(
    createElement("span", {
      className: `shrink-0 rounded border px-2 py-0.5 text-xs font-semibold ${tagClass}`,
      text: tagText,
    }),
  );

  row.appendChild(
    createElement("span", {
      className: "leading-5",
      text: entry.message,
    }),
  );

  return row;
}

function logToNotificationHistory(message, tier) {
  const playerId = Number(state.activeVestPlayerId || 0);
  if (!playerId || !message) {
    return;
  }

  const history = getNotificationHistoryForPlayer(playerId);
  const entry = {
    time: new Date().toLocaleTimeString(),
    tier,
    message,
  };

  history.push(entry);
  if (history.length > 300) {
    history.shift();
  }

  const historyContainer = document.getElementById("notification-history");
  if (!historyContainer) {
    return;
  }

  historyContainer.appendChild(renderNotificationHistoryEntry(entry));
  historyContainer.scrollTop = historyContainer.scrollHeight;
}

function handleTelemetryAlerts(evaluationResult) {
  const now = Date.now();
  const playerId = evaluationResult.playerId;
  const warningSignature = evaluationResult.warningMessages.join("|");
  const criticalSignature = evaluationResult.criticalMessages.join("|");

  if (evaluationResult.currentTier === 2 && warningSignature) {
    const previousWarning =
      state.physiological.warningDebounceByPlayer.get(playerId);
    const shouldNotifyWarning =
      !previousWarning ||
      previousWarning.signature !== warningSignature ||
      now - previousWarning.at > WARNING_DEBOUNCE_MS;

    if (shouldNotifyWarning) {
      pushToast(evaluationResult.warningMessages[0], "warning");
      evaluationResult.warningMessages.forEach((message) => {
        logToNotificationHistory(message, 2);
      });
      state.physiological.warningDebounceByPlayer.set(playerId, {
        signature: warningSignature,
        at: now,
      });
    }
  }

  if (evaluationResult.currentTier >= 3 && criticalSignature) {
    const previousCritical =
      state.physiological.criticalDebounceByPlayer.get(playerId);
    const shouldOpenCritical =
      !previousCritical ||
      previousCritical.signature !== criticalSignature ||
      now - previousCritical.at > CRITICAL_REOPEN_DEBOUNCE_MS;

    if (shouldOpenCritical) {
      evaluationResult.criticalMessages.forEach((message) => {
        logToNotificationHistory(message, 3);
      });
      state.physiological.criticalModal = {
        playerId,
        title: "Critical Physiological Alert",
        messages: evaluationResult.criticalMessages,
      };

      state.physiological.criticalDebounceByPlayer.set(playerId, {
        signature: criticalSignature,
        at: now,
      });
      render();
    }
  } else if (
    state.physiological.criticalModal &&
    state.physiological.criticalModal.playerId === playerId
  ) {
    state.physiological.criticalModal = null;
    render();
  }
}

function ensureECGGridCache(width, height, dpr) {
  const ecgState = state.ecgMonitor;
  const key = `${width}x${height}x${dpr}`;
  if (ecgState.gridCanvas && ecgState.gridKey === key) {
    return ecgState.gridCanvas;
  }

  const gridCanvas = document.createElement("canvas");
  gridCanvas.width = Math.max(1, Math.floor(width * dpr));
  gridCanvas.height = Math.max(1, Math.floor(height * dpr));

  const gridContext = gridCanvas.getContext("2d");
  if (!gridContext) {
    return null;
  }

  gridContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  gridContext.fillStyle = "#050b1f";
  gridContext.fillRect(0, 0, width, height);

  gridContext.strokeStyle = "rgba(76, 108, 156, 0.25)";
  gridContext.lineWidth = 1;

  for (let x = 0; x <= width; x += 16) {
    gridContext.beginPath();
    gridContext.moveTo(x + 0.5, 0);
    gridContext.lineTo(x + 0.5, height);
    gridContext.stroke();
  }

  for (let y = 0; y <= height; y += 16) {
    gridContext.beginPath();
    gridContext.moveTo(0, y + 0.5);
    gridContext.lineTo(width, y + 0.5);
    gridContext.stroke();
  }

  gridContext.strokeStyle = "rgba(112, 141, 184, 0.38)";
  gridContext.beginPath();
  gridContext.moveTo(0, height / 2);
  gridContext.lineTo(width, height / 2);
  gridContext.stroke();

  ecgState.gridCanvas = gridCanvas;
  ecgState.gridKey = key;
  return gridCanvas;
}

function renderECGFrame() {
  const ecgState = state.ecgMonitor;
  if (!ecgState.drawLoopRunning) {
    return;
  }

  const canvas = ecgState.canvas;
  if (!canvas || !ecgState.visible) {
    ecgState.drawLoopRunning = false;
    ecgState.animationFrameId = null;
    return;
  }

  const context =
    ecgState.context ||
    (() => {
      ecgState.context = canvas.getContext("2d");
      return ecgState.context;
    })();

  if (!context) {
    ecgState.drawLoopRunning = false;
    ecgState.animationFrameId = null;
    return;
  }

  const width = Math.max(1, Math.floor(canvas.clientWidth || 420));
  const height = Math.max(1, Math.floor(canvas.clientHeight || 180));
  const dpr = window.devicePixelRatio || 1;

  if (
    canvas.width !== Math.floor(width * dpr) ||
    canvas.height !== Math.floor(height * dpr)
  ) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ecgState.gridCanvas = null;
    ecgState.gridKey = "";
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const grid = ensureECGGridCache(width, height, dpr);
  if (grid) {
    context.drawImage(grid, 0, 0, width, height);
  } else {
    context.fillStyle = "#050b1f";
    context.fillRect(0, 0, width, height);
  }

  const midY = height / 2;
  const amplitudeScale = height / 7;
  const samplesPerPixel = Math.max(1, Math.floor(ECG_BUFFER_SIZE / width));

  context.lineWidth = 2;
  context.strokeStyle = "#22c55e";
  context.beginPath();

  for (let x = width - 1; x >= 0; x -= 1) {
    const sampleOffset = (width - 1 - x) * samplesPerPixel;
    const index =
      (ecgState.writeIndex - 1 - sampleOffset + ECG_BUFFER_SIZE) %
      ECG_BUFFER_SIZE;
    const value = ecgState.buffer[index] ?? 0;
    const y = midY - value * amplitudeScale;

    if (x === width - 1) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();

  if (Math.abs(ecgState.lastValue) > 4.0) {
    context.lineWidth = 2;
    context.strokeStyle = "#ef4444";
    context.beginPath();
    context.moveTo(width - 36, 18);
    context.lineTo(width - 6, 18);
    context.stroke();
  }

  ecgState.animationFrameId = window.requestAnimationFrame(renderECGFrame);
}

function drawLiveECG(voltageArray) {
  if (!Array.isArray(voltageArray) || !voltageArray.length) {
    return;
  }

  const ecgState = state.ecgMonitor;

  voltageArray.forEach((sample) => {
    const numericSample = toNumber(sample);
    if (numericSample === null) {
      return;
    }

    ecgState.buffer[ecgState.writeIndex] = numericSample;
    ecgState.writeIndex = (ecgState.writeIndex + 1) % ECG_BUFFER_SIZE;
    ecgState.lastValue = numericSample;
  });

  if (ecgState.visible && !ecgState.drawLoopRunning) {
    ecgState.drawLoopRunning = true;
    ecgState.animationFrameId = window.requestAnimationFrame(renderECGFrame);
  }
}

function setECGVisibility(isVisible) {
  const ecgState = state.ecgMonitor;
  ecgState.visible = isVisible;

  if (isVisible) {
    if (!ecgState.drawLoopRunning) {
      ecgState.drawLoopRunning = true;
      ecgState.animationFrameId = window.requestAnimationFrame(renderECGFrame);
    }
  } else {
    ecgState.drawLoopRunning = false;
    if (ecgState.animationFrameId) {
      window.cancelAnimationFrame(ecgState.animationFrameId);
      ecgState.animationFrameId = null;
    }
  }
}

function bindECGCanvasFromDOM() {
  const ecgCanvas = document.querySelector('[data-role="ecg-live-canvas"]');
  const ecgState = state.ecgMonitor;
  if (!ecgCanvas) {
    ecgState.canvas = null;
    ecgState.context = null;
    return;
  }

  ecgState.canvas = ecgCanvas;
  ecgState.context = ecgCanvas.getContext("2d");

  if (ecgState.visible && !ecgState.drawLoopRunning) {
    ecgState.drawLoopRunning = true;
    ecgState.animationFrameId = window.requestAnimationFrame(renderECGFrame);
  }
}

function renderCriticalModal() {
  const criticalModal = state.physiological.criticalModal;
  if (!criticalModal) {
    return null;
  }

  const overlay = createElement("div", {
    className: "critical-overlay",
  });

  const panel = createElement("div", { className: "critical-panel" });
  panel.appendChild(
    createElement("h2", {
      className: "critical-title",
      text: criticalModal.title,
    }),
  );

  const list = createElement("ul", { className: "critical-list" });
  criticalModal.messages.forEach((message) => {
    list.appendChild(createElement("li", { text: message }));
  });
  panel.appendChild(list);

  panel.appendChild(
    createElement("button", {
      className: "critical-dismiss-btn",
      text: "Acknowledge & Continue",
      attrs: { "data-action": "dismiss-critical" },
    }),
  );

  overlay.appendChild(panel);
  return overlay;
}

function getSelectedPlayer() {
  if (state.route.name !== "player") {
    return null;
  }

  return state.players.find((p) => p.id === state.route.id) || null;
}

function getSummaryTemplate(player) {
  return `Athlete Profile:\n- Name: ${player.name}\n- Jersey: #${player.jerseyNumber}\n- Height: ${player.heightCm || "-"} cm\n- Weight: ${player.weightKg || "-"} kg\n- Age: ${player.age || "-"}\n\nSession Duration:\n-\n\nSamples Captured:\n- ${player.samplesCaptured}\n\nTelemetry Summary:\n`;
}

function getPlayerSummary(player) {
  const existing = state.summaryByPlayer.get(player.id);
  if (typeof existing === "string") {
    return existing;
  }

  const template = getSummaryTemplate(player);
  state.summaryByPlayer.set(player.id, template);
  return template;
}

function setPlayerSummary(playerId, summary) {
  state.summaryByPlayer.set(playerId, summary);
}

function getSessionDurationText() {
  if (!state.matchStartedAt) {
    return "00:00";
  }

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - state.matchStartedAt) / 1000),
  );
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function openPlayer(id) {
  window.location.hash = `#/player/${id}`;
}

function backToTeam() {
  window.location.hash = "#/";
}

function handleProfileSubmit(form) {
  const payload = {
    name: form.name.trim(),
    heightCm: Number(form.heightCm),
    weightKg: Number(form.weightKg),
    age: Number(form.age),
    jerseyNumber: Number(form.jerseyNumber),
  };

  if (
    !payload.name ||
    payload.heightCm <= 0 ||
    payload.weightKg <= 0 ||
    payload.age <= 0
  ) {
    pushToast("Please enter a valid athlete profile.", "info");
    return;
  }

  if (payload.jerseyNumber < 1 || payload.jerseyNumber > 99) {
    pushToast("Jersey number must be between 1 and 99.", "info");
    return;
  }

  state.profile = payload;
  state.players = createInitialPlayers(payload);
  state.playerPositions = createInitialFormationPositions();
  state.summaryByPlayer.clear();

  if (!window.location.hash) {
    window.location.hash = "#/";
  }

  render();
}

function handlePlayerClick(id) {
  if (!state.profile) {
    pushToast("Complete athlete setup first.", "info");
    return;
  }

  if (!state.activeVestPlayerId) {
    state.activeVestPlayerId = id;
    state.movement.headingDeg = DEFAULT_HEADING_DEG;
    state.movement.lastUpdateTs = null;
    state.matchState = "Idle";
    state.matchStartedAt = null;

    state.players = state.players.map((player) => {
      if (player.id !== id) {
        return { ...player, online: false };
      }

      return {
        ...player,
        name: state.profile.name,
        jerseyNumber: state.profile.jerseyNumber,
        heightCm: state.profile.heightCm,
        weightKg: state.profile.weightKg,
        age: state.profile.age,
        online: false,
      };
    });

    pushToast(
      `Vest assigned to ${state.profile.name}. Waiting for actual vest connection...`,
      "info",
    );

    connectVestSocket();
    openPlayer(id);
    return;
  }

  if (state.activeVestPlayerId !== id) {
    pushToast(
      "Only one vest is active. Open the selected vest player to view live telemetry.",
      "info",
    );
    return;
  }

  openPlayer(id);
}

function updateActivePlayerOnline(isConnected) {
  if (!state.activeVestPlayerId) {
    return;
  }

  state.players = state.players.map((player) => {
    if (player.id !== state.activeVestPlayerId) {
      return player;
    }
    return { ...player, online: isConnected };
  });
}

function disconnectVestSocket() {
  state.ws.disposed = true;

  if (state.ws.reconnectTimer) {
    clearTimeout(state.ws.reconnectTimer);
    state.ws.reconnectTimer = null;
  }

  if (state.ws.socket) {
    state.ws.socket.close();
    state.ws.socket = null;
  }

  state.ws.connected = false;
  setECGVisibility(false);
  updateActivePlayerOnline(false);
}

function connectVestSocket() {
  disconnectVestSocket();

  if (!state.activeVestPlayerId) {
    render();
    return;
  }

  state.ws.disposed = false;

  const connect = () => {
    if (state.ws.disposed) {
      return;
    }

    let socket;
    try {
      socket = new WebSocket(DEFAULT_WS_URL);
    } catch (error) {
      state.ws.connected = false;
      updateActivePlayerOnline(false);
      state.ws.reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      render();
      return;
    }

    state.ws.socket = socket;

    socket.addEventListener("open", () => {
      state.ws.connected = true;
      updateActivePlayerOnline(true);
      render();
    });

    socket.addEventListener("message", (event) => {
      try {
        const parsed =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        const normalized = normalizeTelemetryPayload(parsed);
        const ecgSamples = normalizeECGSamples(parsed);

        if (!normalized) {
          if (ecgSamples.length) {
            drawLiveECG(ecgSamples);
          }
          return;
        }

        handleTelemetryPacket(state.activeVestPlayerId, {
          ...normalized,
          ecgSamples,
        });
      } catch (error) {
        // Ignore malformed packets and continue listening.
      }
    });

    socket.addEventListener("error", () => {
      state.ws.connected = false;
      setECGVisibility(false);
      updateActivePlayerOnline(false);
      render();
    });

    socket.addEventListener("close", () => {
      state.ws.connected = false;
      setECGVisibility(false);
      updateActivePlayerOnline(false);
      render();

      if (!state.ws.disposed) {
        state.ws.reconnectTimer = window.setTimeout(
          connect,
          RECONNECT_DELAY_MS,
        );
      }
    });
  };

  connect();
}

function handleTelemetryPacket(playerId, payload) {
  const now = Date.now();
  const movementState = state.movement;
  const ecgSamples = Array.isArray(payload.ecgSamples)
    ? payload.ecgSamples
    : [];
  const telemetryPayload = { ...payload };
  delete telemetryPayload.ecgSamples;

  if (playerId === state.activeVestPlayerId) {
    const dtSeconds = movementState.lastUpdateTs
      ? Math.max(0.04, Math.min(1.2, (now - movementState.lastUpdateTs) / 1000))
      : 0.2;

    movementState.lastUpdateTs = now;

    const gyroZ = toNumber(payload.gyroZ) ?? 0;
    const speedFromPayload = toNumber(telemetryPayload.speed);
    const acceleration =
      toNumber(telemetryPayload.acceleration) !== null
        ? Math.abs(toNumber(telemetryPayload.acceleration))
        : null;
    const fallbackSpeed = acceleration !== null ? acceleration * 0.18 : 0;
    const speed = Math.max(0, speedFromPayload ?? fallbackSpeed);

    movementState.headingDeg += gyroZ * dtSeconds;

    const distance = speed * MOVEMENT_SPEED_TO_PERCENT_PER_SEC * dtSeconds;

    if (distance > 0) {
      state.playerPositions = state.playerPositions.map((entry) => {
        if (entry.id !== state.activeVestPlayerId) {
          return entry;
        }

        const moved = movePointByHeading(
          entry,
          movementState.headingDeg,
          distance,
        );
        return { ...entry, ...moved };
      });
    }
  }

  state.players = state.players.map((player) => {
    if (player.id !== playerId) {
      return player;
    }

    const updated = {
      ...player,
      online: true,
      lastSeen: now,
      telemetry: { ...player.telemetry, ...telemetryPayload },
      samplesCaptured: player.samplesCaptured + 1,
    };

    const evaluationResult = evaluateTelemetry(updated.telemetry, updated);
    handleTelemetryAlerts(evaluationResult);

    if (ecgSamples.length) {
      drawLiveECG(ecgSamples);
    } else if (
      telemetryPayload.ecg !== null &&
      telemetryPayload.ecg !== undefined
    ) {
      drawLiveECG([telemetryPayload.ecg]);
    }

    return updated;
  });

  render();
}

function startRandomDrift() {
  setInterval(() => {
    if (!state.players.length) {
      return;
    }

    const movementState = state.movement;

    state.playerPositions = state.playerPositions.map((entry) => {
      if (entry.id === state.activeVestPlayerId) {
        return entry;
      }

      let vector = movementState.randomVectors.get(entry.id);
      if (!vector || vector.stepsLeft <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.25 + Math.random() * 0.75;
        vector = {
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          stepsLeft: 2 + Math.floor(Math.random() * 6),
        };
      }

      let nextX = entry.x + vector.dx;
      let nextY = entry.y + vector.dy;

      if (nextX < FIELD_X_MIN || nextX > FIELD_X_MAX) {
        vector.dx *= -1;
        nextX = clamp(entry.x + vector.dx, FIELD_X_MIN, FIELD_X_MAX);
      }

      if (nextY < FIELD_Y_MIN || nextY > FIELD_Y_MAX) {
        vector.dy *= -1;
        nextY = clamp(entry.y + vector.dy, FIELD_Y_MIN, FIELD_Y_MAX);
      }

      vector.stepsLeft -= 1;
      movementState.randomVectors.set(entry.id, vector);

      return {
        ...entry,
        x: nextX,
        y: nextY,
      };
    });

    if (state.route.name === "team") {
      render();
    }
  }, RANDOM_DRIFT_INTERVAL_MS);
}

function startMatch() {
  if (state.matchState === "Active") {
    return;
  }

  state.matchState = "Active";
  state.matchStartedAt = Date.now();
  playWhistle(START_MATCH_WHISTLE_SRC);

  const player = getSelectedPlayer();
  if (player) {
    const prev = getPlayerSummary(player);
    setPlayerSummary(
      player.id,
      `${prev}\nSession started at ${new Date().toLocaleTimeString()}.\n`,
    );
  }

  render();
}

function endMatch() {
  if (state.matchState !== "Active") {
    return;
  }

  state.matchState = "Idle";
  playWhistle(END_MATCH_WHISTLE_SRC);

  const player = getSelectedPlayer();
  if (player) {
    const prev = getPlayerSummary(player);
    setPlayerSummary(
      player.id,
      `${prev}\nSession ended at ${new Date().toLocaleTimeString()}.\n`,
    );
  }

  render();
}

function appendLabeledValue(parent, label, value) {
  const wrapper = createElement("div");
  wrapper.appendChild(createElement("span", { text: label }));
  wrapper.appendChild(createElement("strong", { text: value }));
  parent.appendChild(wrapper);
}

function renderAthleteSetupModal() {
  const overlay = createElement("div", {
    className: "setup-overlay fixed inset-0 z-[80] grid place-items-center p-4",
  });

  const form = createElement("form", {
    className: "setup-card w-full max-w-lg rounded-2xl p-5 sm:p-6",
  });

  form.appendChild(
    createElement("h2", {
      className: "text-2xl font-bold text-white",
      text: "Athlete Setup",
    }),
  );
  form.appendChild(
    createElement("p", {
      className: "mt-1 text-sm text-white/80",
      text: "Enter your athlete profile first. The vest will be assigned to the first player you click on the field.",
    }),
  );

  const grid = createElement("div", {
    className: "mt-5 grid gap-3 sm:grid-cols-2",
  });

  const fields = [
    {
      key: "name",
      label: "Name",
      attrs: { required: "", placeholder: "Athlete name" },
      span2: true,
    },
    {
      key: "heightCm",
      label: "Height (cm)",
      attrs: {
        required: "",
        type: "number",
        min: "50",
        max: "260",
        step: "0.1",
      },
    },
    {
      key: "weightKg",
      label: "Weight (kg)",
      attrs: {
        required: "",
        type: "number",
        min: "20",
        max: "250",
        step: "0.1",
      },
    },
    {
      key: "age",
      label: "Age",
      attrs: { required: "", type: "number", min: "10", max: "60", step: "1" },
    },
    {
      key: "jerseyNumber",
      label: "Jersey Number",
      attrs: { required: "", type: "number", min: "1", max: "99", step: "1" },
    },
  ];

  const values = {
    name: "",
    heightCm: "",
    weightKg: "",
    age: "",
    jerseyNumber: "",
  };

  fields.forEach((field) => {
    const label = createElement("label", {
      className: `setup-label ${field.span2 ? "sm:col-span-2" : ""}`.trim(),
      text: field.label,
    });

    const input = createElement("input", {
      className: "setup-input",
      attrs: field.attrs,
      on: {
        input: (event) => {
          values[field.key] = event.target.value;
        },
      },
    });

    label.appendChild(input);
    grid.appendChild(label);
  });

  form.appendChild(grid);

  const submitButton = createElement("button", {
    className:
      "mt-5 w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400",
    attrs: { type: "submit" },
    text: "Continue",
  });

  form.appendChild(submitButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handleProfileSubmit(values);
  });

  overlay.appendChild(form);
  return overlay;
}

function renderTeamOverview() {
  const section = createElement("section", { className: "space-y-4" });

  const topRow = createElement("div", {
    className: "flex flex-wrap items-end justify-between gap-2",
  });

  const titleBlock = createElement("div");
  titleBlock.appendChild(
    createElement("h1", {
      className: "text-3xl font-bold tracking-tight text-white",
      text: "Athlete Telemetry System",
    }),
  );
  titleBlock.appendChild(
    createElement("p", {
      className: "mt-1 text-sm text-white/80",
      text: "Dashboard 0: 4-4-3 formation and live injury alerts",
    }),
  );

  const modePill = createElement("p", {
    className:
      "rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white/85",
    text: "Single Active Vest Mode",
  });

  topRow.appendChild(titleBlock);
  topRow.appendChild(modePill);
  section.appendChild(topRow);

  const board = createElement("div", { className: "field-board" });

  state.players.forEach((player, index) => {
    const pos =
      state.playerPositions.find((entry) => entry.id === player.id) ||
      createInitialFormationPositions()[index];
    const isActive = player.id === state.activeVestPlayerId;

    const button = createElement("button", {
      className: `formation-player ${player.online ? "online" : "offline"} ${isActive ? "is-vest" : ""}`,
      style: {
        top: `${pos.y}%`,
        left: `${pos.x}%`,
      },
      attrs: {
        title: isActive ? "Active vest player" : "Click to select player",
      },
      on: {
        click: () => handlePlayerClick(player.id),
      },
    });

    button.appendChild(
      createElement("span", {
        className: "formation-player-jersey",
        text: `#${player.jerseyNumber}`,
      }),
    );

    button.appendChild(
      createElement("span", {
        className: "formation-player-name",
        text: player.name,
      }),
    );

    button.appendChild(
      createElement("span", {
        className: `status-pill ${player.online ? "on" : "off"}`,
        text: player.online ? "Online" : "Offline",
      }),
    );

    board.appendChild(button);
  });

  section.appendChild(board);
  return section;
}

function renderDashboardHeader(player) {
  const header = createElement("header", {
    className: "mb-5 flex flex-wrap items-start justify-between gap-4",
  });

  const left = createElement("div");
  left.appendChild(
    createElement("button", {
      className:
        "mb-2 rounded-full border border-white/35 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-white hover:bg-white/20",
      text: "Back to Team Dashboard",
      on: {
        click: backToTeam,
      },
    }),
  );

  left.appendChild(
    createElement("h1", {
      className: "text-3xl font-bold tracking-tight text-white",
      text: "Athlete Telemetry System",
    }),
  );

  left.appendChild(
    createElement("p", {
      className: "mt-1 text-sm text-white/80",
      text: `Dashboard 1: ${player.name} (Jersey #${player.jerseyNumber})`,
    }),
  );

  const connected = state.ws.connected && player.online;

  const pill = createElement("div", {
    className: `connection-pill ${connected ? "connected" : "disconnected"}`,
  });
  pill.appendChild(createElement("span", { className: "status-dot" }));
  pill.appendChild(
    createElement("span", {
      text: connected ? "Connected" : "Disconnected",
    }),
  );

  header.appendChild(left);
  header.appendChild(pill);
  return header;
}

function renderMatchControls() {
  const section = createElement("section", {
    className:
      "glass-panel mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3",
  });

  const left = createElement("div", { className: "flex items-center gap-2" });
  left.appendChild(
    createElement("p", {
      className:
        "text-sm font-semibold uppercase tracking-widest text-slate-600",
      text: "Match State",
    }),
  );

  left.appendChild(
    createElement("span", {
      className: `rounded-full px-3 py-1 text-sm font-bold ${
        state.matchState === "Active"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-slate-200 text-slate-700"
      }`,
      text: state.matchState,
    }),
  );

  const actions = createElement("div", { className: "flex gap-2" });

  const startBtn = createElement("button", {
    className:
      "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50",
    text: "Start Match",
    attrs: { disabled: state.matchState === "Active" ? "" : null },
    on: { click: startMatch },
  });

  const endBtn = createElement("button", {
    className:
      "rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50",
    text: "End Match",
    attrs: { disabled: state.matchState !== "Active" ? "" : null },
    on: { click: endMatch },
  });

  actions.appendChild(startBtn);
  actions.appendChild(endBtn);

  section.appendChild(left);
  section.appendChild(actions);
  return section;
}

function renderTelemetryGrid(player) {
  const section = createElement("section", {
    className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3",
  });

  const highlightedMetrics =
    state.physiological.metricHighlightsByPlayer.get(player.id) || new Set();
  const ecgLiveActive =
    state.ws.connected && player.id === state.activeVestPlayerId;

  METRIC_CONFIG.forEach((metric) => {
    const style =
      metric.key === "ecg" && ecgLiveActive
        ? {}
        : getMetricCardStyle(metric.key);
    const metricIsCritical = highlightedMetrics.has(metric.key);

    const card = createElement("article", {
      className: `metric-card p-5 ${metricIsCritical ? "metric-critical-hl" : ""} ${metric.key === "ecg" && ecgLiveActive ? "ecg-live-active" : ""}`,
      style,
      attrs: { "data-metric-key": metric.key },
    });

    card.appendChild(
      createElement("p", {
        className: "metric-label text-xs font-bold uppercase tracking-[0.16em]",
        text: metric.label,
      }),
    );

    const valueRow = createElement("p", {
      className: "metric-value mt-4 text-4xl font-bold tracking-tight",
      text: formatMetric(player.telemetry[metric.key], metric.key),
    });

    valueRow.appendChild(
      createElement("span", {
        className: "metric-unit ml-2 text-base font-semibold",
        text: metric.unit,
      }),
    );

    if (metric.key === "ecg") {
      const ecgShell = createElement("div", {
        className: `ecg-live-shell ${ecgLiveActive ? "active" : "inactive"}`,
      });

      const ecgCanvas = createElement("canvas", {
        className: "ecg-live-canvas",
        attrs: {
          "data-role": "ecg-live-canvas",
          "aria-label": "Live ECG waveform",
        },
      });

      const ecgPlaceholder = createElement("p", {
        className: "ecg-live-placeholder",
        text: ecgLiveActive
          ? "Streaming ECG waveform..."
          : "ECG monitor idle. Connect vest to begin live waveform.",
      });

      ecgShell.appendChild(ecgCanvas);
      ecgShell.appendChild(ecgPlaceholder);
      card.appendChild(ecgShell);
    }

    card.appendChild(valueRow);
    section.appendChild(card);
  });

  return section;
}

function getBase64ImageFromURL(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;

        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Unable to create canvas context."));
          return;
        }

        context.drawImage(image, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };

    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });
}

function markdownInlineToPdfText(line) {
  const parts = [];
  const text = line || "";
  const boldRegex = /\*\*(.*?)\*\*/g;
  let cursor = 0;
  let match;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index) });
    }
    parts.push({ text: match[1], bold: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor) });
  }

  return parts.length ? parts : [{ text: "" }];
}

function markdownToPdfmakeContent(markdown) {
  const source = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const content = [];
  let bulletBuffer = [];

  const flushBullets = () => {
    if (!bulletBuffer.length) {
      return;
    }
    content.push({
      ul: bulletBuffer.map((line) => ({
        text: markdownInlineToPdfText(line),
      })),
      margin: [0, 2, 0, 6],
    });
    bulletBuffer = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushBullets();
      content.push({ text: "", margin: [0, 2, 0, 2] });
      return;
    }

    if (line.startsWith("### ")) {
      flushBullets();
      content.push({
        text: line.slice(4),
        bold: true,
        fontSize: 12,
        margin: [0, 8, 0, 4],
      });
      return;
    }

    if (line.startsWith("## ")) {
      flushBullets();
      content.push({
        text: line.slice(3),
        bold: true,
        fontSize: 13,
        margin: [0, 10, 0, 5],
      });
      return;
    }

    if (line.startsWith("# ")) {
      flushBullets();
      content.push({
        text: line.slice(2),
        bold: true,
        fontSize: 14,
        margin: [0, 12, 0, 6],
      });
      return;
    }

    if (/^[-*]\s+/.test(line)) {
      bulletBuffer.push(line.replace(/^[-*]\s+/, ""));
      return;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushBullets();
      content.push({
        text: markdownInlineToPdfText(line),
        margin: [0, 2, 0, 3],
      });
      return;
    }

    flushBullets();
    content.push({
      text: markdownInlineToPdfText(line),
      margin: [0, 2, 0, 3],
    });
  });

  flushBullets();
  return content.length ? content : [{ text: "-" }];
}

async function testAPIKey() {
  try {
    const response = await fetch(`${AI_PROXY_URL}/api/health`);
    const data = await response.json();

    if (!response.ok) {
      alert(
        "Backend/API test failed\nStatus: " +
          response.status +
          "\nError: " +
          (data.error || "Unknown error"),
      );
      return false;
    }

    alert("Backend/API test passed\n\n" + data.message);
    return true;
  } catch (error) {
    alert("Cannot reach backend API.\n\n" + error.message);
    return false;
  }
}

async function generateAISuggestions(player, summary) {
  const cacheKey = JSON.stringify({ telemetry: player.telemetry, summary });
  if (aiCache.has(cacheKey)) {
    return aiCache.get(cacheKey);
  }

  if (aiPendingRequests.has(cacheKey)) {
    return aiPendingRequests.get(cacheKey);
  }

  const payload = {
    player: {
      id: player.id,
      name: player.name,
      jerseyNumber: player.jerseyNumber,
      heightCm: player.heightCm,
      weightKg: player.weightKg,
      age: player.age,
      sessionDurationText: player.sessionDurationText,
      samplesCaptured: player.samplesCaptured,
      telemetry: {
        heartRate: player.telemetry?.heartRate ?? null,
        spo2: player.telemetry?.spo2 ?? null,
        bodyTemp: player.telemetry?.bodyTemp ?? null,
        muscleFatigue: player.telemetry?.muscleFatigue ?? null,
        acceleration: player.telemetry?.acceleration ?? null,
        speed: player.telemetry?.speed ?? null,
        ecg: player.telemetry?.ecg ?? null,
        gyroX: player.telemetry?.gyroX ?? null,
        gyroY: player.telemetry?.gyroY ?? null,
        gyroZ: player.telemetry?.gyroZ ?? null,
      },
    },
    summary: summary || "",
  };

  const requestPromise = (async () => {
    let response;
    try {
      response = await fetch(`${AI_PROXY_URL}/api/analyze-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new Error(
        "AI analysis unavailable. Ensure backend API is reachable.",
      );
    }

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    if (response.status === 429) {
      const quotaError = new Error("System busy, please wait 30 seconds");
      quotaError.code = "RATE_LIMITED";
      throw quotaError;
    }

    if (!response.ok) {
      throw new Error(data.error || "Unknown backend error");
    }

    const suggestions = data.suggestions || "No suggestions returned.";
    aiCache.set(cacheKey, suggestions);
    return suggestions;
  })();

  aiPendingRequests.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    aiPendingRequests.delete(cacheKey);
  }
}

async function saveMatchReportToDB(
  playerProfile,
  telemetrySummary,
  aiSuggestions,
) {
  if (!supabaseClient) {
    console.error(
      "Supabase client is not initialized. Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
    );
    return;
  }

  try {
    const maxHeartRateSource =
      telemetrySummary?.maxHeartRate ??
      telemetrySummary?.max_heart_rate ??
      playerProfile?.telemetry?.heartRate ??
      null;

    const parsedAge = Number(playerProfile?.age);
    const parsedMaxHeartRate = Number(maxHeartRateSource);

    const fallbackCriticalAlerts = getCriticalMessages(
      playerProfile?.name || "Unknown Player",
      playerProfile?.telemetry || {},
    );

    const criticalAlertsTriggered =
      telemetrySummary?.criticalAlertsTriggered ??
      telemetrySummary?.critical_alerts_triggered ??
      fallbackCriticalAlerts;

    const row = {
      player_name: String(playerProfile?.name || "Unknown Player"),
      age: Number.isFinite(parsedAge) ? Math.round(parsedAge) : null,
      max_heart_rate: Number.isFinite(parsedMaxHeartRate)
        ? Math.round(parsedMaxHeartRate)
        : null,
      critical_alerts_triggered: criticalAlertsTriggered,
      raw_ai_summary: String(aiSuggestions || ""),
    };

    const { error } = await supabaseClient.from("match_reports").insert([row]);

    if (error) {
      throw error;
    }

    console.log("Match report saved to DB successfully.", row);
  } catch (error) {
    console.error("Failed to save match report to DB:", error);
  }
}

async function exportMatchPdf(player, summary, button, originalText) {
  if (!window.pdfMake || typeof window.pdfMake.createPdf !== "function") {
    window.alert("pdfmake library failed to load.");
    return;
  }

  try {
    const exportTimestamp = new Date().toLocaleString();
    let suggestions;
    try {
      suggestions = await generateAISuggestions(player, summary);
    } catch (error) {
      if (error?.code === "RATE_LIMITED") {
        window.alert("System busy, please wait 30 seconds");
        return;
      }

      window.alert(error.message || "AI analysis failed. Please try again.");
      return;
    }

    const telemetryRows = [
      { label: "Heart Rate", key: "heartRate", unit: "bpm" },
      { label: "SpO2", key: "spo2", unit: "%" },
      { label: "Body Temp", key: "bodyTemp", unit: "degC" },
      { label: "Muscle Fatigue", key: "muscleFatigue", unit: "Hz" },
      { label: "Acceleration", key: "acceleration", unit: "m/s2" },
      { label: "Speed", key: "speed", unit: "m/s" },
      { label: "ECG", key: "ecg", unit: "mV" },
      { label: "Gyro X", key: "gyroX", unit: "deg/s" },
      { label: "Gyro Y", key: "gyroY", unit: "deg/s" },
      { label: "Gyro Z", key: "gyroZ", unit: "deg/s" },
    ];

    const telemetryTableBody = [
      [
        { text: "Metric", bold: true, fillColor: "#e2e8f0" },
        { text: "Value", bold: true, fillColor: "#e2e8f0" },
        { text: "Unit", bold: true, fillColor: "#e2e8f0" },
      ],
      ...telemetryRows.map((metric) => {
        const value = player.telemetry?.[metric.key];
        const display =
          value === null || value === undefined
            ? "--"
            : formatMetric(value, metric.key);
        return [metric.label, String(display), metric.unit];
      }),
    ];

    const theme = {
      ink: "#08112a",
      sky: "#0f3e7b",
      critical: "#cf2f2f",
      muted: "#6b7280",
      softPanel: "#f3f4f6",
      rowAlt: "#f8fafc",
      border: "#d1d5db",
    };

    const samplesCaptured = Number(player.samplesCaptured || 0);

    const profileSessionGrid = [
      [
        { text: "Name", style: "fieldLabel" },
        { text: String(player.name || "-"), style: "fieldValue" },
        { text: "Jersey", style: "fieldLabel" },
        { text: `#${String(player.jerseyNumber || "-")}`, style: "fieldValue" },
      ],
      [
        { text: "Age", style: "fieldLabel" },
        { text: String(player.age || "-"), style: "fieldValue" },
        { text: "Height", style: "fieldLabel" },
        { text: `${String(player.heightCm || "-")} cm`, style: "fieldValue" },
      ],
      [
        { text: "Weight", style: "fieldLabel" },
        { text: `${String(player.weightKg || "-")} kg`, style: "fieldValue" },
        { text: "Duration", style: "fieldLabel" },
        {
          text: String(player.sessionDurationText || "00:00"),
          style: "fieldValue",
        },
      ],
      [
        { text: "Samples Captured", style: "fieldLabel" },
        { text: String(samplesCaptured), style: "fieldValue" },
        { text: "", style: "fieldLabel" },
        { text: "", style: "fieldValue" },
      ],
    ];

    const profilePanelLayout = {
      hLineWidth: function () {
        return 0;
      },
      vLineWidth: function () {
        return 0;
      },
      paddingLeft: function () {
        return 6;
      },
      paddingRight: function () {
        return 6;
      },
      paddingTop: function () {
        return 6;
      },
      paddingBottom: function () {
        return 6;
      },
      fillColor: function () {
        return theme.softPanel;
      },
    };

    const telemetryTableLayout = {
      hLineWidth: function () {
        return 1;
      },
      vLineWidth: function () {
        return 1;
      },
      hLineColor: function () {
        return theme.border;
      },
      vLineColor: function () {
        return theme.border;
      },
      paddingLeft: function () {
        return 8;
      },
      paddingRight: function () {
        return 8;
      },
      paddingTop: function () {
        return 6;
      },
      paddingBottom: function () {
        return 6;
      },
      fillColor: function (rowIndex) {
        if (rowIndex === 0) {
          return null;
        }
        return rowIndex % 2 === 0 ? theme.rowAlt : null;
      },
    };

    const docDefinition = {
      pageSize: "A4",
      pageMargins: [32, 42, 32, 38],
      defaultStyle: {
        fontSize: 11,
        color: theme.ink,
      },
      content: [
        {
          columns: [
            {
              width: "*",
              text: "Elite Athlete Telemetry Report",
              style: "reportTitle",
            },
            {
              width: "auto",
              text: `Exported: ${exportTimestamp}`,
              style: "exportStamp",
              alignment: "right",
            },
          ],
          margin: [0, 0, 0, 12],
        },
        {
          table: {
            widths: [90, "*", 90, "*"],
            body: profileSessionGrid,
          },
          layout: profilePanelLayout,
          margin: [0, 0, 0, 14],
        },
        {
          text: "Raw Telemetry Snapshot",
          style: "sectionHeader",
        },
        {
          table: {
            headerRows: 1,
            widths: ["*", 86, 62],
            body: [
              [
                {
                  text: "Metric",
                  fillColor: theme.sky,
                  color: "#ffffff",
                  bold: true,
                },
                {
                  text: "Value",
                  fillColor: theme.sky,
                  color: "#ffffff",
                  bold: true,
                },
                {
                  text: "Unit",
                  fillColor: theme.sky,
                  color: "#ffffff",
                  bold: true,
                },
              ],
              ...telemetryTableBody.slice(1),
            ],
          },
          layout: telemetryTableLayout,
          margin: [0, 0, 0, 8],
        },
        ...(samplesCaptured === 0
          ? [
              {
                text: "SYSTEM NOTE: Zero samples captured. Verify hardware connection.",
                style: "criticalNote",
                margin: [0, 0, 0, 12],
              },
            ]
          : []),
        {
          text: "AI Clinical Synthesis & Recovery Plan",
          style: "sectionHeader",
          margin: [0, 10, 0, 6],
        },
        ...markdownToPdfmakeContent(
          suggestions || "No AI suggestions returned.",
        ),
      ],
      styles: {
        reportTitle: {
          fontSize: 16,
          bold: true,
          color: theme.sky,
        },
        exportStamp: {
          fontSize: 10,
          italics: true,
          color: theme.muted,
        },
        sectionHeader: {
          fontSize: 14,
          bold: true,
          color: theme.sky,
          margin: [0, 6, 0, 6],
        },
        fieldLabel: {
          fontSize: 10,
          bold: true,
          color: theme.sky,
        },
        fieldValue: {
          fontSize: 11,
          color: theme.ink,
        },
        criticalNote: {
          fontSize: 11,
          bold: true,
          color: theme.critical,
        },
      },
    };

    const telemetrySummaryPayload = {
      maxHeartRate: player.telemetry?.heartRate ?? null,
      criticalAlertsTriggered: getCriticalMessages(
        player.name || "Unknown Player",
        player.telemetry || {},
      ),
      coachSummary: summary || "",
    };

    await saveMatchReportToDB(player, telemetrySummaryPayload, suggestions);

    window.pdfMake.createPdf(docDefinition).download("Match_Report.pdf");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || "Export to PDF";
    }
  }
}

function renderMatchReport(player) {
  const panel = createElement("section", {
    className: "glass-panel mt-5 space-y-3 p-4",
  });

  const top = createElement("div", {
    className: "flex flex-wrap items-center justify-between gap-2",
  });

  top.appendChild(
    createElement("h2", {
      className: "text-lg font-bold text-slate-900",
      text: "Match Report",
    }),
  );

  const summaryText = getPlayerSummary(player);
  const sessionDurationText = getSessionDurationText();

  const exportButton = createElement("button", {
    className:
      "rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-45",
    text: state.exportLock ? "Generating AI Report..." : "Export to PDF",
    attrs: {
      disabled: !summaryText.trim() || state.exportLock ? "" : null,
      "data-action": "export-report",
      "data-player-id": String(player.id),
    },
  });

  top.appendChild(exportButton);

  panel.appendChild(top);

  panel.appendChild(
    createElement("p", {
      className: "text-sm text-slate-600",
      text:
        `Athlete Profile: ${player.name} | Jersey: #${player.jerseyNumber} | ` +
        `Height: ${player.heightCm || "-"} cm | Weight: ${player.weightKg || "-"} kg | ` +
        `Age: ${player.age || "-"} | Session Duration: ${sessionDurationText} | ` +
        `Samples Captured: ${player.samplesCaptured} | Match State: ${state.matchState}`,
    }),
  );

  const notificationHistory = createElement("div", {
    className:
      "h-56 w-full overflow-y-auto rounded-xl border border-slate-300 bg-white p-3 font-mono text-sm leading-6 text-slate-800 shadow-inner",
    attrs: { id: "notification-history" },
  });

  const history = getNotificationHistoryForPlayer(player.id);
  if (!history.length) {
    notificationHistory.appendChild(
      createElement("p", {
        className: "text-slate-500",
        text: "No notification history yet. New Tier 2/Tier 3 alerts will appear here.",
      }),
    );
  } else {
    history.forEach((entry) => {
      notificationHistory.appendChild(renderNotificationHistoryEntry(entry));
    });
  }

  panel.appendChild(notificationHistory);
  notificationHistory.scrollTop = notificationHistory.scrollHeight;
  return panel;
}

function renderPlayerDetail(player) {
  const section = createElement("section");

  section.appendChild(renderDashboardHeader(player));
  section.appendChild(renderMatchControls());
  section.appendChild(renderTelemetryGrid(player));
  section.appendChild(renderMatchReport(player));

  return section;
}

function render() {
  if (!dom.root) {
    return;
  }

  if (state.route.name === "player") {
    const selectedPlayer = getSelectedPlayer();
    if (!selectedPlayer || selectedPlayer.id !== state.activeVestPlayerId) {
      pushToast("Only the active vest player can open Dashboard 1.", "info");
      backToTeam();
      return;
    }
  }

  dom.root.innerHTML = "";

  const main = createElement("main", {
    className: `app-root min-h-screen p-4 md:p-8 ${state.route.name === "player" ? "player-view" : ""}`,
  });

  const wrapper = createElement("div", { className: "mx-auto max-w-7xl" });

  if (state.route.name === "team") {
    wrapper.appendChild(renderTeamOverview());
  } else {
    const selectedPlayer = getSelectedPlayer();
    if (selectedPlayer) {
      wrapper.appendChild(renderPlayerDetail(selectedPlayer));
    }
  }

  main.appendChild(wrapper);

  if (!state.profile) {
    main.appendChild(renderAthleteSetupModal());
  }

  const criticalModal = renderCriticalModal();
  if (criticalModal) {
    main.appendChild(criticalModal);
  }

  dom.root.appendChild(main);

  const shouldShowECG =
    state.route.name === "player" &&
    state.ws.connected &&
    state.activeVestPlayerId === state.route.id;
  bindECGCanvasFromDOM();
  setECGVisibility(shouldShowECG);
}

function handleHashChange() {
  state.route = parseHashRoute();
  render();
}

function setActiveVestOffline() {
  if (!state.activeVestPlayerId) {
    return;
  }

  state.players = state.players.map((player) => {
    if (player.id !== state.activeVestPlayerId) {
      return player;
    }

    return {
      ...player,
      online: false,
    };
  });
}

function startConnectionGuard() {
  setInterval(() => {
    if (!state.activeVestPlayerId) {
      return;
    }

    const activePlayer = state.players.find(
      (p) => p.id === state.activeVestPlayerId,
    );
    if (!activePlayer) {
      return;
    }

    const stale =
      !activePlayer.lastSeen || Date.now() - activePlayer.lastSeen > 4000;
    if (stale && activePlayer.online) {
      setActiveVestOffline();
      render();
    }
  }, 1200);
}

function startClockRefresh() {
  setInterval(() => {
    if (state.route.name === "player" && state.matchStartedAt) {
      render();
    }
  }, 1000);
}

function init() {
  ensureToastLayer();

  if (!window.location.hash) {
    window.location.hash = "#/";
  }

  state.route = parseHashRoute();

  window.addEventListener("hashchange", handleHashChange);
  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("beforeunload", () => {
    disconnectVestSocket();
    state.toasts.forEach((toast, id) => {
      removeToast(id);
    });
  });

  startRandomDrift();
  startConnectionGuard();
  startClockRefresh();
  render();
}

function handleDocumentClick(event) {
  const dismissCriticalButton = event.target.closest(
    '[data-action="dismiss-critical"]',
  );
  if (dismissCriticalButton) {
    dismissCriticalModal();
    return;
  }

  const button = event.target.closest('[data-action="export-report"]');
  if (!button) {
    return;
  }

  if (state.exportLock) {
    return;
  }

  const playerId = Number(button.getAttribute("data-player-id"));
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return;
  }

  state.exportLock = true;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Generating AI Report...";

  const playerWithDuration = {
    ...player,
    sessionDurationText: getSessionDurationText(),
  };
  const summaryText = getPlayerSummary(player);

  exportMatchPdf(playerWithDuration, summaryText, button, originalText).finally(
    () => {
      state.exportLock = false;
    },
  );
}

init();
