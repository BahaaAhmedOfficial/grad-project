const { useEffect, useMemo, useRef, useState } = React;

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

function useHashRoute() {
  const parse = () => {
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
  };

  const [route, setRoute] = useState(parse);

  useEffect(() => {
    const onHashChange = () => setRoute(parse());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

function useSingleVestTelemetry(activePlayerId, onMessage, onConnectionChange) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!activePlayerId) {
      setConnected(false);
      onConnectionChange(false);
      return;
    }

    let socket = null;
    let reconnectTimer = null;
    let disposed = false;

    const connect = () => {
      if (disposed) {
        return;
      }

      try {
        socket = new WebSocket(DEFAULT_WS_URL);
      } catch (error) {
        setConnected(false);
        onConnectionChange(false);
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }

      socket.addEventListener("open", () => {
        setConnected(true);
        onConnectionChange(true);
      });

      socket.addEventListener("message", (event) => {
        try {
          const normalized = normalizeTelemetryPayload(event.data);
          if (!normalized) {
            return;
          }

          onMessage({
            type: "telemetry",
            playerId: activePlayerId,
            payload: normalized,
          });
        } catch (error) {
          // Ignore malformed packets and continue listening.
        }
      });

      socket.addEventListener("error", () => {
        setConnected(false);
        onConnectionChange(false);
      });

      socket.addEventListener("close", () => {
        setConnected(false);
        onConnectionChange(false);
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });
    };

    connect();

    return () => {
      disposed = true;
      setConnected(false);
      onConnectionChange(false);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socket) {
        socket.close();
      }
    };
  }, [activePlayerId, onMessage, onConnectionChange]);

  return connected;
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
    return undefined;
  }

  return { "--metric-card-bg": `url("${backgroundImage}")` };
}

function exportMatchPdf(player, summary) {
  const jsPdfApi = window.jspdf;
  if (!jsPdfApi || !jsPdfApi.jsPDF) {
    window.alert("PDF library failed to load.");
    return;
  }

  const doc = new jsPdfApi.jsPDF();
  const lines = doc.splitTextToSize(summary, 180);

  doc.setFontSize(16);
  doc.text("Athlete Telemetry System", 14, 16);
  doc.setFontSize(12);
  doc.text(`Match Report - ${player.name}`, 14, 26);
  doc.setFontSize(10);
  doc.text(lines, 14, 38);
  doc.save(`${player.name.replace(/\s+/g, "_")}_match_report.pdf`);
}

function playWhistle(src) {
  const audio = new Audio(src);
  audio.play().catch(() => {
    // Ignore playback errors (for example, unsupported format on some browsers).
  });
}

function ToastLayer({ toasts, dismiss }) {
  return (
    <div className="fixed right-4 top-4 z-50 space-y-2 w-[min(92vw,26rem)]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-card ${toast.level === "critical" ? "critical" : "info"}`}
        >
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-semibold leading-5">{toast.message}</p>
            <button
              className="text-xs opacity-70 hover:opacity-100"
              onClick={() => dismiss(toast.id)}
            >
              Close
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AthleteSetupModal({ onSubmit }) {
  const [form, setForm] = useState({
    name: "",
    heightCm: "",
    weightKg: "",
    age: "",
    jerseyNumber: "",
  });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (e) => {
    e.preventDefault();

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
      return;
    }

    if (payload.jerseyNumber < 1 || payload.jerseyNumber > 99) {
      return;
    }

    onSubmit(payload);
  };

  return (
    <div className="setup-overlay fixed inset-0 z-[80] grid place-items-center p-4">
      <form
        onSubmit={submit}
        className="setup-card w-full max-w-lg rounded-2xl p-5 sm:p-6"
      >
        <h2 className="text-2xl font-bold text-white">Athlete Setup</h2>
        <p className="mt-1 text-sm text-white/80">
          Enter your athlete profile first. The vest will be assigned to the
          first player you click on the field.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="setup-label sm:col-span-2">
            Name
            <input
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              className="setup-input"
              placeholder="Athlete name"
            />
          </label>

          <label className="setup-label">
            Height (cm)
            <input
              required
              type="number"
              min="50"
              max="260"
              step="0.1"
              value={form.heightCm}
              onChange={(e) => update("heightCm", e.target.value)}
              className="setup-input"
            />
          </label>

          <label className="setup-label">
            Weight (kg)
            <input
              required
              type="number"
              min="20"
              max="250"
              step="0.1"
              value={form.weightKg}
              onChange={(e) => update("weightKg", e.target.value)}
              className="setup-input"
            />
          </label>

          <label className="setup-label">
            Age
            <input
              required
              type="number"
              min="10"
              max="60"
              step="1"
              value={form.age}
              onChange={(e) => update("age", e.target.value)}
              className="setup-input"
            />
          </label>

          <label className="setup-label">
            Jersey Number
            <input
              required
              type="number"
              min="1"
              max="99"
              step="1"
              value={form.jerseyNumber}
              onChange={(e) => update("jerseyNumber", e.target.value)}
              className="setup-input"
            />
          </label>
        </div>

        <button
          type="submit"
          className="mt-5 w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400"
        >
          Continue
        </button>
      </form>
    </div>
  );
}

function TeamOverview({
  players,
  activeVestPlayerId,
  playerPositions,
  onPlayerClick,
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Athlete Telemetry System
          </h1>
          <p className="mt-1 text-sm text-white/80">
            Dashboard 0: 4-4-3 formation and live injury alerts
          </p>
        </div>
        <p className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white/85">
          Single Active Vest Mode
        </p>
      </div>

      <div className="field-board">
        {players.map((player, index) => {
          const pos =
            playerPositions.get(player.id) ||
            createInitialFormationPositions()[index];
          const isActive = player.id === activeVestPlayerId;

          return (
            <button
              key={player.id}
              onClick={() => onPlayerClick(player.id)}
              className={`formation-player ${player.online ? "online" : "offline"} ${isActive ? "is-vest" : ""}`}
              style={{ top: `${pos.y}%`, left: `${pos.x}%` }}
              title={isActive ? "Active vest player" : "Click to select player"}
            >
              <span className="formation-player-jersey">
                #{player.jerseyNumber}
              </span>
              <span className="formation-player-name">{player.name}</span>
              <span className={`status-pill ${player.online ? "on" : "off"}`}>
                {player.online ? "Online" : "Offline"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DashboardHeader({ player, connected, onBack }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <button
          onClick={onBack}
          className="mb-2 rounded-full border border-white/35 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-white hover:bg-white/20"
        >
          Back to Team Dashboard
        </button>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Athlete Telemetry System
        </h1>
        <p className="mt-1 text-sm text-white/80">
          Dashboard 1: {player.name} (Jersey #{player.jerseyNumber})
        </p>
      </div>

      <div
        className={`connection-pill ${connected ? "connected" : "disconnected"}`}
      >
        <span className="status-dot" />
        <span>{connected ? "Connected" : "Disconnected"}</span>
      </div>
    </header>
  );
}

function MatchControls({ matchState, onStart, onEnd }) {
  return (
    <section className="glass-panel mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold uppercase tracking-widest text-slate-600">
          Match State
        </p>
        <span
          className={`rounded-full px-3 py-1 text-sm font-bold ${matchState === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}
        >
          {matchState}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onStart}
          disabled={matchState === "Active"}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start Match
        </button>
        <button
          onClick={onEnd}
          disabled={matchState !== "Active"}
          className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          End Match
        </button>
      </div>
    </section>
  );
}

function TelemetryGrid({ telemetry }) {
  const criticalFlags = getCriticalFlags(telemetry);

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {METRIC_CONFIG.map((metric) => (
        <article
          key={metric.key}
          className={`metric-card p-5 ${criticalFlags[metric.key] ? "critical" : ""}`}
          style={getMetricCardStyle(metric.key)}
        >
          <p className="metric-label text-xs font-bold uppercase tracking-[0.16em]">
            {metric.label}
          </p>
          <p className="metric-value mt-4 text-4xl font-bold tracking-tight">
            {formatMetric(telemetry[metric.key], metric.key)}
            <span className="metric-unit ml-2 text-base font-semibold">
              {metric.unit}
            </span>
          </p>
        </article>
      ))}
    </section>
  );
}

function MatchReport({ player, matchState, summary, setSummary, onExport }) {
  return (
    <section className="glass-panel mt-5 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">Match Report</h2>
        <button
          onClick={onExport}
          disabled={!summary.trim()}
          className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Export to PDF
        </button>
      </div>

      <p className="text-sm text-slate-600">
        Athlete Profile: {player.name} | Jersey: #{player.jerseyNumber} |
        Height: {player.heightCm || "-"} cm | Weight: {player.weightKg || "-"}{" "}
        kg | Age: {player.age || "-"} | Session Duration:{" "}
        {player.sessionDurationText || "00:00"} | Samples Captured:{" "}
        {player.samplesCaptured} | Match State: {matchState}
      </p>

      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={8}
        className="w-full rounded-xl border border-slate-300 bg-white/95 p-3 text-sm leading-6 text-slate-800 outline-none ring-0 focus:border-sky-500"
        placeholder="Telemetry Summary..."
      />
    </section>
  );
}

function PlayerDetail({
  player,
  connected,
  onBack,
  matchState,
  matchStartedAt,
  onStartMatch,
  onEndMatch,
}) {
  const summaryTemplate = useMemo(
    () =>
      `Athlete Profile:\n- Name: ${player.name}\n- Jersey: #${player.jerseyNumber}\n- Height: ${player.heightCm || "-"} cm\n- Weight: ${player.weightKg || "-"} kg\n- Age: ${player.age || "-"}\n\nSession Duration:\n-\n\nSamples Captured:\n- ${player.samplesCaptured}\n\nTelemetry Summary:\n`,
    [player],
  );

  const [summary, setSummary] = useState(summaryTemplate);

  useEffect(() => {
    setSummary(summaryTemplate);
  }, [summaryTemplate]);

  const sessionDurationText = useMemo(() => {
    if (!matchStartedAt) {
      return "00:00";
    }

    const seconds = Math.max(
      0,
      Math.floor((Date.now() - matchStartedAt) / 1000),
    );
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }, [matchStartedAt, player.samplesCaptured]);

  const playerWithDuration = { ...player, sessionDurationText };

  const startMatch = () => {
    onStartMatch();
    setSummary(
      (prev) =>
        `${prev}\nSession started at ${new Date().toLocaleTimeString()}.\n`,
    );
  };

  const endMatch = () => {
    onEndMatch();
    setSummary(
      (prev) =>
        `${prev}\nSession ended at ${new Date().toLocaleTimeString()}.\n`,
    );
  };

  const exportPdf = () => exportMatchPdf(playerWithDuration, summary);

  return (
    <section>
      <DashboardHeader
        player={player}
        connected={connected && player.online}
        onBack={onBack}
      />
      <MatchControls
        matchState={matchState}
        onStart={startMatch}
        onEnd={endMatch}
      />
      <TelemetryGrid telemetry={player.telemetry} />
      <MatchReport
        player={playerWithDuration}
        matchState={matchState}
        summary={summary}
        setSummary={setSummary}
        onExport={exportPdf}
      />
    </section>
  );
}

function App() {
  const [profile, setProfile] = useState(null);
  const [players, setPlayers] = useState([]);
  const [activeVestPlayerId, setActiveVestPlayerId] = useState(null);
  const [matchState, setMatchState] = useState("Idle");
  const [matchStartedAt, setMatchStartedAt] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [playerPositions, setPlayerPositions] = useState(() =>
    createInitialFormationPositions(),
  );
  const route = useHashRoute();
  const toastTimers = useRef(new Map());
  const movementStateRef = useRef({
    headingDeg: DEFAULT_HEADING_DEG,
    lastUpdateTs: null,
    randomVectors: new Map(),
  });

  const playerPositionsMap = useMemo(
    () => new Map(playerPositions.map((entry) => [entry.id, entry])),
    [playerPositions],
  );

  const pushToast = React.useCallback((message, level = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, message, level }]);

    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      toastTimers.current.delete(id);
    }, TOAST_TIMEOUT_MS);

    toastTimers.current.set(id, timer);
  }, []);

  const dismissToast = (id) => {
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  useEffect(() => {
    return () => {
      toastTimers.current.forEach((timer) => clearTimeout(timer));
      toastTimers.current.clear();
    };
  }, []);

  const handleProfileSubmit = (payload) => {
    setProfile(payload);
    setPlayers(createInitialPlayers(payload));
    setPlayerPositions(createInitialFormationPositions());
    if (!window.location.hash) {
      window.location.hash = "#/";
    }
  };

  const handleMockSocketMessage = React.useCallback(
    (event) => {
      const now = Date.now();
      const movementState = movementStateRef.current;

      if (event.playerId === activeVestPlayerId) {
        const dtSeconds = movementState.lastUpdateTs
          ? Math.max(
              0.04,
              Math.min(1.2, (now - movementState.lastUpdateTs) / 1000),
            )
          : 0.2;

        movementState.lastUpdateTs = now;

        const gyroZ = toNumber(event.payload.gyroZ) ?? 0;
        const speedFromPayload = toNumber(event.payload.speed);
        const acceleration =
          toNumber(event.payload.acceleration) !== null
            ? Math.abs(toNumber(event.payload.acceleration))
            : null;
        const fallbackSpeed = acceleration !== null ? acceleration * 0.18 : 0;
        const speed = Math.max(0, speedFromPayload ?? fallbackSpeed);

        movementState.headingDeg += gyroZ * dtSeconds;

        const distance = speed * MOVEMENT_SPEED_TO_PERCENT_PER_SEC * dtSeconds;

        if (distance > 0) {
          setPlayerPositions((prevPositions) =>
            prevPositions.map((entry) => {
              if (entry.id !== activeVestPlayerId) {
                return entry;
              }

              const moved = movePointByHeading(
                entry,
                movementState.headingDeg,
                distance,
              );

              return { ...entry, ...moved };
            }),
          );
        }
      }

      setPlayers((prev) => {
        const next = prev.map((p) => ({ ...p }));
        const idx = next.findIndex((p) => p.id === event.playerId);
        if (idx === -1) {
          return prev;
        }

        const player = next[idx];
        if (player.id !== activeVestPlayerId) {
          return prev;
        }

        player.online = true;
        player.lastSeen = Date.now();
        player.telemetry = { ...player.telemetry, ...event.payload };
        player.samplesCaptured += 1;

        const criticalMessages = getCriticalMessages(
          player.name,
          player.telemetry,
        );
        criticalMessages.forEach((message) => pushToast(message, "critical"));

        return next;
      });
    },
    [activeVestPlayerId, pushToast],
  );

  useEffect(() => {
    if (!players.length) {
      return undefined;
    }

    const timer = setInterval(() => {
      setPlayerPositions((prevPositions) => {
        const movementState = movementStateRef.current;
        const nextPositions = prevPositions.map((entry) => {
          if (entry.id === activeVestPlayerId) {
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

        return nextPositions;
      });
    }, RANDOM_DRIFT_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [players.length, activeVestPlayerId]);

  const handleConnectionChange = React.useCallback(
    (isConnected) => {
      setPlayers((prev) =>
        prev.map((player) => {
          if (player.id !== activeVestPlayerId) {
            return player;
          }

          return {
            ...player,
            online: isConnected,
          };
        }),
      );
    },
    [activeVestPlayerId],
  );

  const wsConnected = useSingleVestTelemetry(
    activeVestPlayerId,
    handleMockSocketMessage,
    handleConnectionChange,
  );

  const handleStartMatch = React.useCallback(() => {
    if (matchState === "Active") {
      return;
    }

    playWhistle(START_MATCH_WHISTLE_SRC);
    setMatchState("Active");
    setMatchStartedAt(Date.now());
  }, [matchState]);

  const handleEndMatch = React.useCallback(() => {
    if (matchState !== "Active") {
      return;
    }

    playWhistle(END_MATCH_WHISTLE_SRC);
    setMatchState("Idle");
  }, [matchState]);

  const openPlayer = (id) => {
    window.location.hash = `#/player/${id}`;
  };

  const backToTeam = () => {
    window.location.hash = "#/";
  };

  const handlePlayerClick = (id) => {
    if (!profile) {
      pushToast("Complete athlete setup first.", "info");
      return;
    }

    if (!activeVestPlayerId) {
      setActiveVestPlayerId(id);
      movementStateRef.current.headingDeg = DEFAULT_HEADING_DEG;
      movementStateRef.current.lastUpdateTs = null;
      setMatchState("Idle");
      setMatchStartedAt(null);
      setPlayers((prev) =>
        prev.map((player) => {
          if (player.id !== id) {
            return { ...player, online: false };
          }

          return {
            ...player,
            name: profile.name,
            jerseyNumber: profile.jerseyNumber,
            heightCm: profile.heightCm,
            weightKg: profile.weightKg,
            age: profile.age,
            online: false,
          };
        }),
      );
      pushToast(
        `Vest assigned to ${profile.name}. Waiting for actual vest connection...`,
        "info",
      );
      openPlayer(id);
      return;
    }

    if (activeVestPlayerId !== id) {
      pushToast(
        "Only one vest is active. Open the selected vest player to view live telemetry.",
        "info",
      );
      return;
    }

    openPlayer(id);
  };

  const selectedPlayer =
    route.name === "player" ? players.find((p) => p.id === route.id) : null;

  useEffect(() => {
    if (window.location.hash === "") {
      window.location.hash = "#/";
    }
  }, []);

  useEffect(() => {
    if (route.name !== "player") {
      return;
    }

    if (!selectedPlayer || selectedPlayer.id !== activeVestPlayerId) {
      pushToast("Only the active vest player can open Dashboard 1.", "info");
      backToTeam();
    }
  }, [route.name, selectedPlayer, activeVestPlayerId, pushToast]);

  return (
    <main
      className={`app-root min-h-screen p-4 md:p-8 ${route.name === "player" ? "player-view" : ""}`}
    >
      <div className="mx-auto max-w-7xl">
        {route.name === "team" && (
          <TeamOverview
            players={players}
            activeVestPlayerId={activeVestPlayerId}
            playerPositions={playerPositionsMap}
            onPlayerClick={handlePlayerClick}
          />
        )}

        {route.name === "player" &&
          selectedPlayer &&
          selectedPlayer.id === activeVestPlayerId && (
            <PlayerDetail
              player={selectedPlayer}
              connected={wsConnected}
              onBack={backToTeam}
              matchState={matchState}
              matchStartedAt={matchStartedAt}
              onStartMatch={handleStartMatch}
              onEndMatch={handleEndMatch}
            />
          )}
      </div>

      {!profile && <AthleteSetupModal onSubmit={handleProfileSubmit} />}
      <ToastLayer toasts={toasts} dismiss={dismissToast} />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
