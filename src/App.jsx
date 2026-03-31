import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState
} from "react";
import { BENCHMARKS, getBenchmarkById } from "./benchmarks.js";
import {
  buildCacheKey,
  chunkTexts,
  fetchTranslationRuntimeConfig,
  translateTexts
} from "./lib/translator.js";

const CATEGORY_META = {
  1: { label: "Category 1", tone: "c1" },
  2: { label: "Category 2", tone: "c2" },
  3: { label: "Category 3", tone: "c3" },
  4: { label: "Category 4", tone: "c4" },
  5: { label: "Category 5", tone: "c5" }
};

const TRANSLATION_STORAGE_KEY = "mem-benchmark-vis.translation-preferences";
const DEFAULT_TRANSLATION_PREFERENCES = {
  targetLanguage: "简体中文",
  autoTranslate: false
};

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function loadTranslationPreferences() {
  if (typeof window === "undefined") {
    return DEFAULT_TRANSLATION_PREFERENCES;
  }

  try {
    const saved = window.localStorage.getItem(TRANSLATION_STORAGE_KEY);
    if (!saved) {
      return DEFAULT_TRANSLATION_PREFERENCES;
    }

    return {
      ...DEFAULT_TRANSLATION_PREFERENCES,
      ...JSON.parse(saved)
    };
  } catch {
    return DEFAULT_TRANSLATION_PREFERENCES;
  }
}

function collectSessionTexts(session) {
  return session.turns.flatMap((turn) =>
    [turn.text, turn.query, turn.blip_caption].filter(Boolean).map((item) => String(item))
  );
}

function collectQaTexts(rows) {
  return rows.flatMap((qa) => [qa.question, String(qa.answer)].filter(Boolean));
}

function getTranslatedText(cache, targetLanguage, text) {
  return cache[buildCacheKey(targetLanguage, text)] || "";
}

function StatCard({ label, value, note }) {
  return (
    <article className="stat-card">
      <p className="stat-label">{label}</p>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">{note}</span>
    </article>
  );
}

function BenchmarkCard({ benchmark, active, onClick }) {
  return (
    <button
      type="button"
      className={`benchmark-card ${active ? "is-active" : ""} ${
        benchmark.status !== "ready" ? "is-disabled" : ""
      }`}
      onClick={onClick}
      disabled={benchmark.status !== "ready"}
    >
      <div className="benchmark-card-top">
        <span className="benchmark-name">{benchmark.name}</span>
        <span className={`status-pill ${benchmark.status}`}>{benchmark.statusLabel}</span>
      </div>
      <p className="benchmark-tagline">{benchmark.tagline}</p>
      <p className="benchmark-description">{benchmark.description}</p>
      <div className="chip-row">
        <span className="chip">{benchmark.domain}</span>
        <span className="chip">{benchmark.viewType}</span>
      </div>
    </button>
  );
}

function SampleButton({ sample, active, onClick, maxTurns, maxQa }) {
  const turnWidth = `${(sample.turnCount / maxTurns) * 100}%`;
  const qaWidth = `${(sample.qa.length / maxQa) * 100}%`;

  return (
    <button
      type="button"
      className={`sample-button ${active ? "is-active" : ""}`}
      onClick={onClick}
    >
      <div className="sample-button-top">
        <span className="sample-button-kicker">{sample.sampleId}</span>
        <span className="sample-button-people">{sample.speakers.join(" / ")}</span>
      </div>
      <div className="mini-track">
        <span>Turns</span>
        <div className="mini-bar">
          <div className="mini-bar-fill turns" style={{ width: turnWidth }} />
        </div>
        <strong>{sample.turnCount}</strong>
      </div>
      <div className="mini-track">
        <span>QA</span>
        <div className="mini-bar">
          <div className="mini-bar-fill qa" style={{ width: qaWidth }} />
        </div>
        <strong>{sample.qa.length}</strong>
      </div>
    </button>
  );
}

function TranslationPanel({
  preferences,
  runtimeConfig,
  onPreferenceChange,
  onTranslate,
  onClearCache,
  translateState,
  translatedEntryCount
}) {
  return (
    <section className="panel">
      <div className="panel-head panel-head-stack">
        <div>
          <p className="panel-kicker">Translation</p>
          <h2>实时翻译</h2>
        </div>
      </div>
      <div className="schema-list">
        <div>
          <span>Base URL</span>
          <strong>{runtimeConfig.baseUrl || "未配置"}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{runtimeConfig.model || "未配置"}</strong>
        </div>
        <div>
          <span>API Key Secret</span>
          <strong>{runtimeConfig.hasApiKey ? "已配置" : "未配置"}</strong>
        </div>
      </div>
      <div className="translator-form translator-form-readonly">
        <label>
          <span>Target Language</span>
          <input
            value={preferences.targetLanguage}
            onChange={(event) => onPreferenceChange("targetLanguage", event.target.value)}
            placeholder="简体中文"
          />
        </label>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={preferences.autoTranslate}
          onChange={(event) => onPreferenceChange("autoTranslate", event.target.checked)}
        />
        <span>自动翻译当前选中的会话与当前过滤后的 QA</span>
      </label>
      <div className="translator-actions">
        <button type="button" className="action-button" onClick={onTranslate}>
          立即翻译当前内容
        </button>
        <button type="button" className="action-button secondary" onClick={onClearCache}>
          清空翻译缓存
        </button>
      </div>
      <div className="translator-meta">
        <span>缓存条目：{translatedEntryCount}</span>
        <span>状态：{translateState.statusLabel}</span>
      </div>
      <p className="translator-note">
        `BASE_URL` 和 `MODEL` 来自 Worker `vars`，`API_KEY` 来自 Wrangler secret。浏览器不会直接接触密钥。
      </p>
      {translateState.error ? <p className="translator-error">{translateState.error}</p> : null}
    </section>
  );
}

function CategoryBars({ sample }) {
  const counts = Object.entries(CATEGORY_META).map(([category, meta]) => ({
    category,
    label: meta.label,
    tone: meta.tone,
    count: sample.qaCategoryCounts[category] || 0
  }));
  const max = Math.max(...counts.map((item) => item.count), 1);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Question Mix</p>
          <h2>QA 分类分布</h2>
        </div>
      </div>
      <div className="bar-list">
        {counts.map((item) => (
          <div key={item.category} className="bar-row">
            <div className="bar-meta">
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </div>
            <div className="bar-track">
              <div
                className={`bar-fill ${item.tone}`}
                style={{ width: `${(item.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceHeatmap({ sample }) {
  const max = Math.max(
    ...sample.sessions.map((session) => sample.evidenceCounts.get(session.number) || 0),
    1
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Evidence</p>
          <h2>证据引用热度</h2>
        </div>
      </div>
      <div className="heatmap-grid">
        {sample.sessions.map((session) => {
          const count = sample.evidenceCounts.get(session.number) || 0;
          const intensity = 0.16 + count / max;

          return (
            <div
              key={session.number}
              className="heatmap-cell"
              style={{ opacity: Math.min(intensity, 1) }}
            >
              <span className="heatmap-label">S{session.number}</span>
              <strong>{count}</strong>
              <small>{session.turnCount} turns</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SessionTimeline({ sample, activeSession, onSelectSession }) {
  return (
    <section className="panel span-two">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Timeline</p>
          <h2>会话时间线</h2>
        </div>
      </div>
      <div className="timeline">
        {sample.sessions.map((session) => {
          const eventSpeakers = Object.entries(session.eventBlock || {}).filter(
            ([key]) => key !== "date"
          );

          return (
            <button
              type="button"
              key={session.number}
              className={`timeline-card ${activeSession === session.number ? "is-active" : ""}`}
              onClick={() => onSelectSession(session.number)}
            >
              <div className="timeline-top">
                <span className="timeline-tag">Session {session.number}</span>
                <span>{session.dateTime}</span>
              </div>
              <div className="chip-row">
                <span className="chip">{session.turnCount} turns</span>
                <span className="chip">{session.speakerCount} speakers</span>
                <span className="chip">{session.mediaCount} media</span>
              </div>
              <div className="timeline-events">
                {eventSpeakers.length ? (
                  eventSpeakers.map(([speaker, entries]) => (
                    <p key={speaker}>
                      <strong>{speaker}:</strong> {(entries || []).slice(0, 2).join(" / ")}
                    </p>
                  ))
                ) : (
                  <p>该会话未提供结构化事件摘要。</p>
                )}
              </div>
              <p className="timeline-summary">{session.summary || "暂无 session summary。"}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ConversationViewer({ session, translationCache, targetLanguage }) {
  return (
    <section className="panel span-two">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Conversation</p>
          <h2>Session {session.number} 对话详情</h2>
        </div>
        <div className="session-meta">
          <span>{session.dateTime}</span>
        </div>
      </div>
      <div className="conversation-list">
        {session.turns.map((turn) => {
          const translatedText = getTranslatedText(translationCache, targetLanguage, turn.text);
          const translatedQuery = turn.query
            ? getTranslatedText(translationCache, targetLanguage, turn.query)
            : "";
          const translatedCaption = turn.blip_caption
            ? getTranslatedText(translationCache, targetLanguage, turn.blip_caption)
            : "";

          return (
            <article
              key={turn.dia_id}
              className={`message-card speaker-${turn.speaker?.toLowerCase()}`}
            >
              <div className="message-head">
                <strong>{turn.speaker}</strong>
                <span>{turn.dia_id}</span>
              </div>
              <p>{turn.text}</p>
              {translatedText ? (
                <p className="translated-block">
                  <span>{targetLanguage}</span>
                  {translatedText}
                </p>
              ) : null}
              {(turn.query || turn.blip_caption || turn.img_url?.length) && (
                <div className="media-note">
                  {turn.query ? (
                    <span>
                      query: {turn.query}
                      {translatedQuery ? ` | ${targetLanguage}: ${translatedQuery}` : ""}
                    </span>
                  ) : null}
                  {turn.blip_caption ? (
                    <span>
                      caption: {turn.blip_caption}
                      {translatedCaption ? ` | ${targetLanguage}: ${translatedCaption}` : ""}
                    </span>
                  ) : null}
                  {turn.img_url?.length ? <span>{turn.img_url.length} image link</span> : null}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function QAExplorer({
  rows,
  qaCategory,
  setQaCategory,
  qaSearch,
  setQaSearch,
  translationCache,
  targetLanguage
}) {
  return (
    <section className="panel span-two">
      <div className="panel-head panel-head-stack">
        <div>
          <p className="panel-kicker">Question Answering</p>
          <h2>QA 明细</h2>
        </div>
        <div className="filters">
          <label>
            <span>分类</span>
            <select value={qaCategory} onChange={(event) => setQaCategory(event.target.value)}>
              <option value="all">全部分类</option>
              {Object.entries(CATEGORY_META).map(([category, meta]) => (
                <option key={category} value={category}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>
          <label className="search-field">
            <span>搜索</span>
            <input
              value={qaSearch}
              onChange={(event) => setQaSearch(event.target.value)}
              placeholder="question / answer / evidence"
            />
          </label>
        </div>
      </div>
      <div className="qa-list">
        {rows.map((qa, index) => {
          const translatedQuestion = getTranslatedText(
            translationCache,
            targetLanguage,
            qa.question
          );
          const translatedAnswer = getTranslatedText(
            translationCache,
            targetLanguage,
            String(qa.answer)
          );

          return (
            <article key={`${qa.question}-${index}`} className="qa-card">
              <div className="qa-head">
                <span className={`pill ${CATEGORY_META[qa.category]?.tone || "c1"}`}>
                  {CATEGORY_META[qa.category]?.label || `Category ${qa.category}`}
                </span>
                <span>{qa.evidence.length} evidence refs</span>
              </div>
              <h3>{qa.question}</h3>
              {translatedQuestion ? (
                <p className="translated-block inline">
                  <span>{targetLanguage}</span>
                  {translatedQuestion}
                </p>
              ) : null}
              <p className="qa-answer">{String(qa.answer)}</p>
              {translatedAnswer ? (
                <p className="translated-block inline">
                  <span>{targetLanguage}</span>
                  {translatedAnswer}
                </p>
              ) : null}
              <div className="evidence-row">
                {qa.evidence.length ? (
                  qa.evidence.map((evidence) => (
                    <span key={evidence} className="evidence-pill">
                      {evidence}
                    </span>
                  ))
                ) : (
                  <span className="evidence-pill is-empty">No evidence</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RawPreview({ sample }) {
  const preview = JSON.stringify(sample.raw, null, 2).slice(0, 5000);

  return (
    <section className="panel raw-panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Schema</p>
          <h2>原始 JSON 预览</h2>
        </div>
      </div>
      <div className="schema-list">
        <div>
          <span>Top-level fields</span>
          <strong>{Object.keys(sample.raw).join(", ")}</strong>
        </div>
        <div>
          <span>Sessions</span>
          <strong>{sample.sessionCount}</strong>
        </div>
        <div>
          <span>Observations</span>
          <strong>{sample.observationCount}</strong>
        </div>
        <div>
          <span>Events</span>
          <strong>{sample.eventCount}</strong>
        </div>
      </div>
      <details className="raw-details">
        <summary>展开原始片段</summary>
        <div className="raw-pre-wrap">
          <pre>{preview}...</pre>
        </div>
      </details>
    </section>
  );
}

function PlatformReadiness({ activeBenchmark }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Platform</p>
          <h2>多 Benchmark 接入方式</h2>
        </div>
      </div>
      <div className="schema-list">
        <div>
          <span>当前激活</span>
          <strong>{activeBenchmark.name}</strong>
        </div>
        <div>
          <span>接入模式</span>
          <strong>Registry + Adapter</strong>
        </div>
        <div>
          <span>当前视图类型</span>
          <strong>{activeBenchmark.viewType}</strong>
        </div>
        <div>
          <span>后续扩展</span>
          <strong>新增 benchmark 时注册 loader 并补对应 renderer</strong>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [activeBenchmarkId, setActiveBenchmarkId] = useState(BENCHMARKS[0].id);
  const [dataset, setDataset] = useState(null);
  const [status, setStatus] = useState("loading");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeSession, setActiveSession] = useState(1);
  const [qaCategory, setQaCategory] = useState("all");
  const [qaSearch, setQaSearch] = useState("");
  const [translationPreferences, setTranslationPreferences] = useState(
    loadTranslationPreferences
  );
  const [translationRuntimeConfig, setTranslationRuntimeConfig] = useState({
    baseUrl: "",
    model: "",
    hasApiKey: false
  });
  const [translationCache, setTranslationCache] = useState({});
  const [translateState, setTranslateState] = useState({
    status: "idle",
    statusLabel: "未翻译",
    error: ""
  });
  const translationCacheRef = useRef({});
  const translationRunId = useRef(0);
  const deferredSearch = useDeferredValue(qaSearch);

  const activeBenchmark = getBenchmarkById(activeBenchmarkId);

  useEffect(() => {
    translationCacheRef.current = translationCache;
  }, [translationCache]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      TRANSLATION_STORAGE_KEY,
      JSON.stringify(translationPreferences)
    );
  }, [translationPreferences]);

  useEffect(() => {
    let cancelled = false;

    async function loadRuntimeConfig() {
      try {
        const config = await fetchTranslationRuntimeConfig();
        if (!cancelled) {
          setTranslationRuntimeConfig(config);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setTranslateState({
            status: "error",
            statusLabel: "翻译配置读取失败",
            error: error.message || "Failed to load translation config."
          });
        }
      }
    }

    loadRuntimeConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBenchmark() {
      setStatus("loading");
      setDataset(null);

      try {
        const nextDataset = await activeBenchmark.loader(activeBenchmark);

        if (cancelled) {
          return;
        }

        setDataset(nextDataset);
        setStatus("ready");
        setSelectedIndex(0);
        setQaCategory("all");
        setQaSearch("");
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setStatus("error");
        }
      }
    }

    loadBenchmark();

    return () => {
      cancelled = true;
    };
  }, [activeBenchmark]);

  useEffect(() => {
    if (!dataset?.samples?.length) {
      return;
    }
    setActiveSession(dataset.samples[selectedIndex].sessions[0]?.number || 1);
  }, [dataset, selectedIndex]);

  const selectedSample = dataset?.samples?.[selectedIndex] || null;
  const selectedSession =
    selectedSample?.sessions?.find((session) => session.number === activeSession) ||
    selectedSample?.sessions?.[0] ||
    null;

  const filteredQa = (selectedSample?.qa || []).filter((qa) => {
    const matchCategory = qaCategory === "all" || String(qa.category) === qaCategory;
    const searchText = `${qa.question} ${String(qa.answer)} ${qa.evidence.join(" ")}`.toLowerCase();
    const matchSearch =
      !deferredSearch || searchText.includes(deferredSearch.toLowerCase());
    return matchCategory && matchSearch;
  });

  async function translateVisibleContent() {
    if (!selectedSession || !selectedSample) {
      return;
    }

    if (!translationRuntimeConfig.hasApiKey) {
      setTranslateState({
        status: "error",
        statusLabel: "缺少 API_KEY secret",
        error: "请先在 Cloudflare Wrangler 中配置 API_KEY secret。"
      });
      return;
    }

    if (!translationRuntimeConfig.baseUrl || !translationRuntimeConfig.model) {
      setTranslateState({
        status: "error",
        statusLabel: "缺少翻译配置",
        error: "请先在 wrangler.jsonc 中配置 BASE_URL 和 MODEL。"
      });
      return;
    }

    const runId = Date.now();
    translationRunId.current = runId;
    setTranslateState({
      status: "running",
      statusLabel: "翻译中",
      error: ""
    });

    try {
      const texts = [
        ...collectSessionTexts(selectedSession),
        ...collectQaTexts(filteredQa)
      ].filter(Boolean);
      const uniqueTexts = [...new Set(texts)];
      const missingTexts = uniqueTexts.filter(
        (text) =>
          !translationCacheRef.current[
            buildCacheKey(translationPreferences.targetLanguage, text)
          ]
      );

      if (!missingTexts.length) {
        setTranslateState({
          status: "ready",
          statusLabel: "已命中缓存",
          error: ""
        });
        return;
      }

      const nextEntries = {};
      const chunks = chunkTexts(missingTexts, 20);

      for (const chunk of chunks) {
        const translations = await translateTexts({
          targetLanguage: translationPreferences.targetLanguage,
          texts: chunk
        });

        chunk.forEach((text, index) => {
          nextEntries[buildCacheKey(translationPreferences.targetLanguage, text)] =
            translations[index];
        });
      }

      if (translationRunId.current !== runId) {
        return;
      }

      setTranslationCache((previous) => {
        const merged = {
          ...previous,
          ...nextEntries
        };
        translationCacheRef.current = merged;
        return merged;
      });

      setTranslateState({
        status: "ready",
        statusLabel: `已翻译 ${missingTexts.length} 条`,
        error: ""
      });
    } catch (error) {
      console.error(error);
      if (translationRunId.current !== runId) {
        return;
      }

      setTranslateState({
        status: "error",
        statusLabel: "翻译失败",
        error: error.message || "Translation failed."
      });
    }
  }

  useEffect(() => {
    if (!translationPreferences.autoTranslate) {
      return;
    }

    translateVisibleContent();
  }, [
    dataset,
    activeBenchmarkId,
    selectedIndex,
    activeSession,
    qaCategory,
    deferredSearch,
    translationPreferences.autoTranslate,
    translationPreferences.targetLanguage,
    translationRuntimeConfig.baseUrl,
    translationRuntimeConfig.model,
    translationRuntimeConfig.hasApiKey
  ]);

  if (status === "loading") {
    return <main className="loading-state">Loading {activeBenchmark.name}...</main>;
  }

  if (status === "error" || !dataset || !selectedSample || !selectedSession) {
    return <main className="loading-state">Failed to load {activeBenchmark.datasetPath}.</main>;
  }

  const maxTurns = Math.max(...dataset.samples.map((sample) => sample.turnCount), 1);
  const maxQa = Math.max(...dataset.samples.map((sample) => sample.qa.length), 1);

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Cloudflare + React Benchmark Studio</p>
          <h1>多 Benchmark 数据集可视化平台</h1>
          <p className="hero-text">
            翻译现在改成 Worker 代理模式。`BASE_URL` 和 `MODEL` 来自 Cloudflare 环境变量，
            `API_KEY` 来自 Worker secret，前端只负责请求本站 `/api/translate`。
          </p>
        </div>
        <div className="hero-stats">
          <StatCard
            label="已注册 Benchmark"
            value={formatNumber(BENCHMARKS.length)}
            note="包含已接入与预留接入位"
          />
          <StatCard
            label="当前数据集"
            value={activeBenchmark.name}
            note={activeBenchmark.tagline}
          />
          <StatCard
            label="样本数"
            value={formatNumber(dataset.stats.sampleCount)}
            note="当前 benchmark 已加载的 records"
          />
          <StatCard
            label="会话总数"
            value={formatNumber(dataset.stats.totalSessions)}
            note="结构化 session 汇总"
          />
          <StatCard
            label="QA 总数"
            value={formatNumber(dataset.stats.totalQa)}
            note="question-answer pairs"
          />
          <StatCard
            label="证据引用"
            value={formatNumber(dataset.stats.totalEvidence)}
            note="evidence reference 出现次数"
          />
        </div>
      </header>

      <section className="panel sample-strip-panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Benchmarks</p>
            <h2>Benchmark 切换</h2>
          </div>
        </div>
        <div className="benchmark-strip">
          {BENCHMARKS.map((benchmark) => (
            <BenchmarkCard
              key={benchmark.id}
              benchmark={benchmark}
              active={benchmark.id === activeBenchmarkId}
              onClick={() => {
                if (benchmark.status !== "ready") {
                  return;
                }
                startTransition(() => {
                  setActiveBenchmarkId(benchmark.id);
                });
              }}
            />
          ))}
        </div>
      </section>

      <section className="dashboard-grid">
        <section className="panel span-two">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Selected Benchmark</p>
              <h2>{activeBenchmark.name}</h2>
            </div>
            <div className="session-meta">{activeBenchmark.domain}</div>
          </div>
          <div className="sample-summary">
            <p className="benchmark-summary-copy">{activeBenchmark.description}</p>
            <div className="summary-cards">
              <StatCard
                label="Samples"
                value={formatNumber(dataset.stats.sampleCount)}
                note="当前 benchmark 中的 sample 数"
              />
              <StatCard
                label="Turns"
                value={formatNumber(dataset.stats.totalTurns)}
                note="所有样本中的总消息轮次"
              />
              <StatCard
                label="QA Pairs"
                value={formatNumber(dataset.stats.totalQa)}
                note="问答监督条目数"
              />
              <StatCard
                label="Media Turns"
                value={formatNumber(dataset.stats.totalMedia)}
                note="包含图像元信息的 turns"
              />
            </div>
            <div className="feature-grid">
              <article className="feature-card">
                <span>Visualization Mode</span>
                <strong>{activeBenchmark.viewType}</strong>
              </article>
              <article className="feature-card">
                <span>Dataset Path</span>
                <strong>{activeBenchmark.datasetPath}</strong>
              </article>
              <article className="feature-card">
                <span>Adapter</span>
                <strong>{dataset.adapterName}</strong>
              </article>
              <article className="feature-card">
                <span>Data Schema</span>
                <strong>{dataset.schemaLabel}</strong>
              </article>
            </div>
          </div>
        </section>

        <TranslationPanel
          preferences={translationPreferences}
          runtimeConfig={translationRuntimeConfig}
          onPreferenceChange={(field, value) =>
            setTranslationPreferences((previous) => ({
              ...previous,
              [field]: value
            }))
          }
          onTranslate={translateVisibleContent}
          onClearCache={() => {
            translationCacheRef.current = {};
            setTranslationCache({});
            setTranslateState({
              status: "idle",
              statusLabel: "缓存已清空",
              error: ""
            });
          }}
          translateState={translateState}
          translatedEntryCount={Object.keys(translationCache).length}
        />

        <section className="panel sample-strip-panel span-two">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Samples</p>
              <h2>{activeBenchmark.name} 样本切换</h2>
            </div>
          </div>
          <div className="sample-strip">
            {dataset.samples.map((sample, index) => (
              <SampleButton
                key={sample.sampleId}
                sample={sample}
                active={index === selectedIndex}
                maxTurns={maxTurns}
                maxQa={maxQa}
                onClick={() => {
                  startTransition(() => {
                    setSelectedIndex(index);
                    setQaSearch("");
                    setQaCategory("all");
                  });
                }}
              />
            ))}
          </div>
        </section>

        <PlatformReadiness activeBenchmark={activeBenchmark} />
        <CategoryBars sample={selectedSample} />
        <SessionTimeline
          sample={selectedSample}
          activeSession={selectedSession.number}
          onSelectSession={setActiveSession}
        />
        <EvidenceHeatmap sample={selectedSample} />
        <ConversationViewer
          session={selectedSession}
          translationCache={translationCache}
          targetLanguage={translationPreferences.targetLanguage}
        />
        <QAExplorer
          rows={filteredQa}
          qaCategory={qaCategory}
          setQaCategory={setQaCategory}
          qaSearch={qaSearch}
          setQaSearch={setQaSearch}
          translationCache={translationCache}
          targetLanguage={translationPreferences.targetLanguage}
        />
        <RawPreview sample={selectedSample} />
      </section>
    </main>
  );
}
