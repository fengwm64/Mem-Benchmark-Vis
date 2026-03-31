import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState
} from "react";
import { BENCHMARKS, getBenchmarkById } from "./benchmarks.js";
import { buildCacheKey, chunkTexts, translateTexts } from "./lib/translator.js";

const CATEGORY_META = {
  1: { label: "Category 1", tone: "c1" },
  2: { label: "Category 2", tone: "c2" },
  3: { label: "Category 3", tone: "c3" },
  4: { label: "Category 4", tone: "c4" },
  5: { label: "Category 5", tone: "c5" }
};

const TARGET_LANGUAGE = "简体中文";

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function getTranslatedText(cache, targetLanguage, text) {
  return cache[buildCacheKey(targetLanguage, text)] || "";
}

function extractEvidenceRefs(evidenceList = []) {
  return evidenceList.flatMap((entry) => String(entry).match(/D\d+:\d+/g) || []);
}

function parseEvidenceRef(ref) {
  const match = String(ref).match(/^D(\d+):(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    sessionNumber: Number(match[1]),
    turnRef: match[0]
  };
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

function SessionTimeline({
  sample,
  activeSession,
  onSelectSession,
  translationCache,
  targetLanguage,
  loadingByKey,
  errorByKey,
  onTranslateSession
}) {
  return (
    <section className="panel span-two panel-scroll">
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
            <article
              key={session.number}
              className={`timeline-card ${activeSession === session.number ? "is-active" : ""}`}
              onClick={() => onSelectSession(session.number)}
            >
              <div className="timeline-top">
                <span className="timeline-tag">Session {session.number}</span>
                <div className="message-actions">
                  <span>{session.dateTime}</span>
                  <button
                    type="button"
                    className="mini-action-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onTranslateSession(
                        `session-${session.number}`,
                        [
                          session.summary,
                          ...eventSpeakers.flatMap(([, entries]) => entries || [])
                        ].filter(Boolean)
                      );
                    }}
                    disabled={Boolean(loadingByKey[`session-${session.number}`])}
                  >
                    {loadingByKey[`session-${session.number}`] ? "翻译中" : "翻译"}
                  </button>
                </div>
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
                      {(entries || []).length ? (
                        <>
                          {entries
                            .slice(0, 2)
                            .map((entry) => getTranslatedText(translationCache, targetLanguage, entry))
                            .filter(Boolean)
                            .map((translated, index) => (
                              <span key={`${speaker}-${index}`} className="timeline-translation">
                                {translated}
                              </span>
                            ))}
                        </>
                      ) : null}
                    </p>
                  ))
                ) : (
                  <p>该会话未提供结构化事件摘要。</p>
                )}
              </div>
              <p className="timeline-summary">{session.summary || "暂无 session summary。"}</p>
              {session.summary &&
              getTranslatedText(translationCache, targetLanguage, session.summary) ? (
                <p className="translated-block inline">
                  <span>{targetLanguage}</span>
                  {getTranslatedText(translationCache, targetLanguage, session.summary)}
                </p>
              ) : null}
              {errorByKey[`session-${session.number}`] ? (
                <p className="translator-error compact">{errorByKey[`session-${session.number}`]}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ConversationViewer({
  session,
  translationCache,
  targetLanguage,
  highlightedDiaId,
  loadingByKey,
  errorByKey,
  onTranslateTurn
}) {
  useEffect(() => {
    if (!highlightedDiaId) {
      return;
    }

    const target = document.querySelector(`[data-dia-id="${highlightedDiaId}"]`);
    if (!target) {
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }, [highlightedDiaId, session.number]);

  return (
    <section className="panel span-two panel-scroll">
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
              data-dia-id={turn.dia_id}
              className={`message-card speaker-${turn.speaker?.toLowerCase()} ${
                highlightedDiaId === turn.dia_id ? "is-highlighted" : ""
              }`}
            >
              <div className="message-head">
                <strong>{turn.speaker}</strong>
                <div className="message-actions">
                  <span>{turn.dia_id}</span>
                  <button
                    type="button"
                    className="mini-action-button"
                    onClick={() =>
                      onTranslateTurn(turn.dia_id, [turn.text, turn.query, turn.blip_caption])
                    }
                    disabled={Boolean(loadingByKey[turn.dia_id])}
                  >
                    {loadingByKey[turn.dia_id] ? "翻译中" : "翻译"}
                  </button>
                </div>
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
              {errorByKey[turn.dia_id] ? (
                <p className="translator-error compact">{errorByKey[turn.dia_id]}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ConversationRawPanel({ session }) {
  const sessionPreview = JSON.stringify(
    {
      session_number: session.number,
      date_time: session.dateTime,
      summary: session.summary,
      event_summary: session.eventBlock,
      observation: session.observationBlock,
      turns: session.turns
    },
    null,
    2
  ).slice(0, 7000);

  return (
    <section className="panel raw-panel conversation-raw-panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Session JSON</p>
          <h2>原始 JSON 预览</h2>
        </div>
      </div>
      <div className="raw-pre-wrap conversation-raw-wrap">
        <pre>{sessionPreview}...</pre>
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
  targetLanguage,
  onEvidenceClick,
  loadingByKey,
  errorByKey,
  onTranslateQa
}) {
  return (
    <section className="panel span-two panel-scroll">
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

          const evidenceRefs = extractEvidenceRefs(qa.evidence);

          return (
            <article key={`${qa.question}-${index}`} className="qa-card">
              <div className="qa-head">
                <span className={`pill ${CATEGORY_META[qa.category]?.tone || "c1"}`}>
                  {CATEGORY_META[qa.category]?.label || `Category ${qa.category}`}
                </span>
                <div className="message-actions">
                  <span>{qa.evidence.length} evidence refs</span>
                  <button
                    type="button"
                    className="mini-action-button"
                    onClick={() => onTranslateQa(`qa-${index}`, [qa.question, String(qa.answer)])}
                    disabled={Boolean(loadingByKey[`qa-${index}`])}
                  >
                    {loadingByKey[`qa-${index}`] ? "翻译中" : "翻译"}
                  </button>
                </div>
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
                {evidenceRefs.length ? (
                  evidenceRefs.map((evidence) => (
                    <button
                      type="button"
                      key={`${qa.question}-${evidence}`}
                      className="evidence-pill evidence-button"
                      onClick={() => onEvidenceClick(evidence)}
                    >
                      {evidence}
                    </button>
                  ))
                ) : (
                  <span className="evidence-pill is-empty">No evidence</span>
                )}
              </div>
              {errorByKey[`qa-${index}`] ? (
                <p className="translator-error compact">{errorByKey[`qa-${index}`]}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function QARawPanel({ rows }) {
  const preview = JSON.stringify(rows, null, 2).slice(0, 7000);

  return (
    <section className="panel raw-panel conversation-raw-panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">QA JSON</p>
          <h2>原始 JSON 预览</h2>
        </div>
      </div>
      <div className="raw-pre-wrap conversation-raw-wrap">
        <pre>{preview}...</pre>
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
  const [highlightedDiaId, setHighlightedDiaId] = useState("");
  const [qaCategory, setQaCategory] = useState("all");
  const [qaSearch, setQaSearch] = useState("");
  const [translationCache, setTranslationCache] = useState({});
  const [translationLoadingByKey, setTranslationLoadingByKey] = useState({});
  const [translationErrorByKey, setTranslationErrorByKey] = useState({});
  const translationCacheRef = useRef({});
  const deferredSearch = useDeferredValue(qaSearch);

  const activeBenchmark = getBenchmarkById(activeBenchmarkId);

  useEffect(() => {
    translationCacheRef.current = translationCache;
  }, [translationCache]);

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
    setHighlightedDiaId("");
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

  async function translateItem(itemKey, rawTexts) {
    const texts = rawTexts.filter(Boolean).map((item) => String(item));

    if (!texts.length) {
      return;
    }

    setTranslationLoadingByKey((previous) => ({ ...previous, [itemKey]: true }));
    setTranslationErrorByKey((previous) => ({ ...previous, [itemKey]: "" }));

    try {
      const uniqueTexts = [...new Set(texts)];
      const missingTexts = uniqueTexts.filter(
        (text) => !translationCacheRef.current[buildCacheKey(TARGET_LANGUAGE, text)]
      );

      if (!missingTexts.length) {
        return;
      }

      const nextEntries = {};
      const chunks = chunkTexts(missingTexts, 20);

      for (const chunk of chunks) {
        const translations = await translateTexts({
          targetLanguage: TARGET_LANGUAGE,
          texts: chunk
        });

        chunk.forEach((text, index) => {
          nextEntries[buildCacheKey(TARGET_LANGUAGE, text)] = translations[index];
        });
      }

      setTranslationCache((previous) => {
        const merged = {
          ...previous,
          ...nextEntries
        };
        translationCacheRef.current = merged;
        return merged;
      });
    } catch (error) {
      console.error(error);
      setTranslationErrorByKey((previous) => ({
        ...previous,
        [itemKey]: error.message || "Translation failed."
      }));
    } finally {
      setTranslationLoadingByKey((previous) => ({
        ...previous,
        [itemKey]: false
      }));
    }
  }

  if (status === "loading") {
    return <main className="loading-state">Loading {activeBenchmark.name}...</main>;
  }

  if (status === "error" || !dataset || !selectedSample || !selectedSession) {
    return <main className="loading-state">Failed to load {activeBenchmark.datasetPath}.</main>;
  }

  const maxTurns = Math.max(...dataset.samples.map((sample) => sample.turnCount), 1);
  const maxQa = Math.max(...dataset.samples.map((sample) => sample.qa.length), 1);

  function jumpToEvidence(ref) {
    const parsed = parseEvidenceRef(ref);
    if (!parsed) {
      return;
    }

    setActiveSession(parsed.sessionNumber);
    setHighlightedDiaId(parsed.turnRef);
  }

  return (
    <main className="app-shell">
      <section className="top-layout">
        <section className="panel top-overview">
          <div className="hero-copy hero-copy-embedded">
            <p className="eyebrow">Cloudflare + React Benchmark Studio</p>
            <h1>多 Benchmark 数据集可视化平台</h1>
            <p className="hero-text">
              时间线、对话详情和 QA 明细都支持按条点击翻译，只请求你真正想看的那一小段内容。
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
        </section>

        <section className="panel top-benchmark-panel">
          <div className="top-benchmark-grid">
            <section className="top-benchmark-block">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Benchmarks</p>
                  <h2>Benchmark 切换</h2>
                </div>
              </div>
              <div className="benchmark-strip benchmark-strip-compact">
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

            <section className="top-benchmark-block">
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
          </div>
        </section>
      </section>

      <section className="dashboard-grid">
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

        <CategoryBars sample={selectedSample} />
        <SessionTimeline
          sample={selectedSample}
          activeSession={selectedSession.number}
          onSelectSession={(sessionNumber) => {
            setActiveSession(sessionNumber);
            setHighlightedDiaId("");
          }}
          translationCache={translationCache}
          targetLanguage={TARGET_LANGUAGE}
          loadingByKey={translationLoadingByKey}
          errorByKey={translationErrorByKey}
          onTranslateSession={translateItem}
        />
        <EvidenceHeatmap sample={selectedSample} />
        <ConversationViewer
          session={selectedSession}
          translationCache={translationCache}
          targetLanguage={TARGET_LANGUAGE}
          highlightedDiaId={highlightedDiaId}
          loadingByKey={translationLoadingByKey}
          errorByKey={translationErrorByKey}
          onTranslateTurn={translateItem}
        />
        <ConversationRawPanel session={selectedSession} />
        <QAExplorer
          rows={filteredQa}
          qaCategory={qaCategory}
          setQaCategory={setQaCategory}
          qaSearch={qaSearch}
          setQaSearch={setQaSearch}
          translationCache={translationCache}
          targetLanguage={TARGET_LANGUAGE}
          onEvidenceClick={jumpToEvidence}
          loadingByKey={translationLoadingByKey}
          errorByKey={translationErrorByKey}
          onTranslateQa={translateItem}
        />
        <QARawPanel rows={filteredQa} />
      </section>
    </main>
  );
}
