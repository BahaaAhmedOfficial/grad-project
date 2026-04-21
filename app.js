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
};

const dom = {
  root: document.getElementById("root"),
  toastLayer: null,
};

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
      className: `toast-card ${level === "critical" ? "critical" : "info"}`,
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
        const normalized = normalizeTelemetryPayload(event.data);
        if (!normalized) {
          return;
        }

        handleTelemetryPacket(state.activeVestPlayerId, normalized);
      } catch (error) {
        // Ignore malformed packets and continue listening.
      }
    });

    socket.addEventListener("error", () => {
      state.ws.connected = false;
      updateActivePlayerOnline(false);
      render();
    });

    socket.addEventListener("close", () => {
      state.ws.connected = false;
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

  if (playerId === state.activeVestPlayerId) {
    const dtSeconds = movementState.lastUpdateTs
      ? Math.max(0.04, Math.min(1.2, (now - movementState.lastUpdateTs) / 1000))
      : 0.2;

    movementState.lastUpdateTs = now;

    const gyroZ = toNumber(payload.gyroZ) ?? 0;
    const speedFromPayload = toNumber(payload.speed);
    const acceleration =
      toNumber(payload.acceleration) !== null
        ? Math.abs(toNumber(payload.acceleration))
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
      telemetry: { ...player.telemetry, ...payload },
      samplesCaptured: player.samplesCaptured + 1,
    };

    const criticalMessages = getCriticalMessages(
      updated.name,
      updated.telemetry,
    );
    criticalMessages.forEach((message) => pushToast(message, "critical"));

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

  const criticalFlags = getCriticalFlags(player.telemetry);

  METRIC_CONFIG.forEach((metric) => {
    const style = getMetricCardStyle(metric.key);

    const card = createElement("article", {
      className: `metric-card p-5 ${criticalFlags[metric.key] ? "critical" : ""}`,
      style,
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

    card.appendChild(valueRow);
    section.appendChild(card);
  });

  return section;
}

function escapeHtml(text) {
  if (text === null || text === undefined) {
    return "";
  }

  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function markdownToHtml(markdown) {
  if (window.marked && typeof window.marked.parse === "function") {
    return window.marked.parse(markdown || "", {
      gfm: true,
      breaks: true,
    });
  }

  return `<pre>${escapeHtml(markdown || "")}</pre>`;
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

function createPdfExportTemplate(player, summary, suggestions) {
  const reportDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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

  const rowsHtml = telemetryRows
    .map((metric) => {
      const value = player.telemetry?.[metric.key];
      const display =
        value === null || value === undefined
          ? "--"
          : formatMetric(value, metric.key);

      return `
        <tr>
          <td>${escapeHtml(metric.label)}</td>
          <td>${escapeHtml(display)}</td>
          <td>${escapeHtml(metric.unit)}</td>
        </tr>
      `;
    })
    .join("");

  const coachSummaryHtml = markdownToHtml(
    summary || "No coach summary provided.",
  );
  const aiSummaryHtml = markdownToHtml(
    suggestions || "No AI suggestions returned.",
  );

  const host = document.createElement("div");
  host.className = "pdf-export-host";
  host.innerHTML = `
    <article class="pdf-export-sheet">
      <header class="pdf-export-header">
        <div class="pdf-export-brand">
          <img src="assets/logo.png" alt="Athlete Telemetry Logo" class="pdf-export-logo" />
          <div>
            <p class="pdf-export-kicker">Athlete Telemetry System</p>
            <h1 class="pdf-export-title">Match Medical Performance Report</h1>
          </div>
        </div>
        <p class="pdf-export-date">Report Date: ${escapeHtml(reportDate)}</p>
      </header>

      <section class="pdf-section pdf-export-profile">
        <h2>Athlete Profile</h2>
        <div class="pdf-export-profile-grid">
          <div><span>Name</span><strong>${escapeHtml(player.name || "-")}</strong></div>
          <div><span>Jersey</span><strong>#${escapeHtml(player.jerseyNumber || "-")}</strong></div>
          <div><span>Height</span><strong>${escapeHtml(player.heightCm || "-")} cm</strong></div>
          <div><span>Weight</span><strong>${escapeHtml(player.weightKg || "-")} kg</strong></div>
          <div><span>Age</span><strong>${escapeHtml(player.age || "-")}</strong></div>
          <div><span>Session</span><strong>${escapeHtml(player.sessionDurationText || "00:00")}</strong></div>
        </div>
      </section>

      <section class="pdf-section">
        <h2>Telemetry Snapshot</h2>
        <table class="pdf-export-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </section>

      <section class="pdf-section pdf-export-md">
        <h2>Coach Summary</h2>
        ${coachSummaryHtml}
      </section>

      <section class="pdf-section pdf-export-md">
        <h2>AI Analysis and Recommendations</h2>
        ${aiSummaryHtml}
      </section>
    </article>
  `;

  return host;
}

async function exportMatchPdf(player, summary, button, originalText) {
  if (!window.pdfMake || typeof window.pdfMake.createPdf !== "function") {
    window.alert("pdfmake library failed to load.");
    return;
  }

  try {
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

    const profileRows = [
      ["Name", String(player.name || "-")],
      ["Jersey", `#${String(player.jerseyNumber || "-")}`],
      ["Height", `${String(player.heightCm || "-")} cm`],
      ["Weight", `${String(player.weightKg || "-")} kg`],
      ["Age", String(player.age || "-")],
      ["Session Duration", String(player.sessionDurationText || "00:00")],
      ["Samples Captured", String(player.samplesCaptured || 0)],
      ["Generated At", new Date().toLocaleString()],
    ];

    const theme = {
      ink: "#08112a",
      sky: "#0f3e7b",
      grass: "#1f7a3f",
      accent: "#0f5fa8",
      border: "#cccccc",
      rowAlt: "#f0f4f8",
    };

    const closedTableLayout = {
      hLineWidth: function (i, node) {
        return 1;
      },
      vLineWidth: function (i, node) {
        return 1;
      },
      hLineColor: function (i, node) {
        return theme.border;
      },
      vLineColor: function (i, node) {
        return theme.border;
      },
      paddingLeft: function (i, node) {
        return 8;
      },
      paddingRight: function (i, node) {
        return 8;
      },
      paddingTop: function (i, node) {
        return 6;
      },
      paddingBottom: function (i, node) {
        return 6;
      },
      fillColor: function (rowIndex, node, columnIndex) {
        return rowIndex % 2 === 0 ? null : theme.rowAlt;
      },
    };

    let headerLogo = "";
    try {
      headerLogo = await getBase64ImageFromURL("assets/headerLogo.png");
    } catch (error) {
      headerLogo = "";
    }

    const docDefinition = {
      pageSize: "A4",
      pageMargins: [32, 100, 32, 38],
      defaultStyle: {
        fontSize: 10,
      },
      content: [
        headerLogo
          ? {
              image: headerLogo,
              width: 70,
              absolutePosition: { x: 470, y: 25 },
            }
          : { text: "" },
        {
          text: "Match Medical Performance Report",
          fontSize: 18,
          bold: true,
          margin: [0, 0, 0, 15],
        },
        {
          text: "Athlete Profile",
          style: "sectionTitle",
        },
        {
          table: {
            widths: [140, "*"],
            body: profileRows,
          },
          layout: closedTableLayout,
          margin: [0, 0, 0, 12],
        },
        {
          text: "Telemetry Snapshot",
          style: "sectionTitle",
        },
        {
          table: {
            headerRows: 1,
            widths: ["*", 72, 56],
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
          layout: closedTableLayout,
          margin: [0, 0, 0, 12],
        },
        {
          text: "Coach Summary",
          style: "sectionTitle",
        },
        ...markdownToPdfmakeContent(summary || "No coach summary provided."),
        {
          text: "AI Analysis and Recommendations",
          style: "sectionTitle",
          margin: [0, 12, 0, 6],
        },
        ...markdownToPdfmakeContent(
          suggestions || "No AI suggestions returned.",
        ),
      ],
      styles: {
        sectionTitle: {
          fontSize: 14,
          bold: true,
          color: theme.sky,
          margin: [0, 10, 0, 6],
        },
      },
    };

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

  const textarea = createElement("textarea", {
    className:
      "w-full rounded-xl border border-slate-300 bg-white/95 p-3 text-sm leading-6 text-slate-800 outline-none ring-0 focus:border-sky-500",
    attrs: { rows: "8", placeholder: "Telemetry Summary..." },
  });

  textarea.value = summaryText;
  textarea.addEventListener("input", (event) => {
    setPlayerSummary(player.id, event.target.value);
  });

  panel.appendChild(textarea);
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

  dom.root.appendChild(main);
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
