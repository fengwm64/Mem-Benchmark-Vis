import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { BENCHMARKS, getBenchmarkById } from "./benchmarks.js";

const CATEGORY_META = {
  1: { label: "Category 1", tone: "c1" },
  2: { label: "Category 2", tone: "c2" },
  3: { label: "Category 3", tone: "c3" },
  4: { label: "Category 4", tone: "c4" },
  5: { label: "Category 5", tone: "c5" }
};

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
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
      className={`benchmark-card ${active ? "is-active" : ""} ${benchmark.status !== "ready" ? "is-disabled" : ""}`}
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

function ConversationViewer({ session }) {
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
        {session.turns.map((turn) => (
          <article
            key={turn.dia_id}
            className={`message-card speaker-${turn.speaker?.toLowerCase()}`}
          >
            <div className="message-head">
              <strong>{turn.speaker}</strong>
              <span>{turn.dia_id}</span>
            </div>
            <p>{turn.text}</p>
            {(turn.query || turn.blip_caption || turn.img_url?.length) && (
              <div className="media-note">
                {turn.query && <span>query: {turn.query}</span>}
                {turn.blip_caption && <span>caption: {turn.blip_caption}</span>}
                {turn.img_url?.length ? <span>{turn.img_url.length} image link</span> : null}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function QAExplorer({ rows, qaCategory, setQaCategory, qaSearch, setQaSearch }) {
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
        {rows.map((qa, index) => (
          <article key={`${qa.question}-${index}`} className="qa-card">
            <div className="qa-head">
              <span className={`pill ${CATEGORY_META[qa.category]?.tone || "c1"}`}>
                {CATEGORY_META[qa.category]?.label || `Category ${qa.category}`}
              </span>
              <span>{qa.evidence.length} evidence refs</span>
            </div>
            <h3>{qa.question}</h3>
            <p className="qa-answer">{String(qa.answer)}</p>
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
        ))}
      </div>
    </section>
  );
}

function RawPreview({ sample }) {
  const preview = JSON.stringify(sample.raw, null, 2).slice(0, 5000);

  return (
    <section className="panel">
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
        <pre>{preview}...</pre>
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
  const deferredSearch = useDeferredValue(qaSearch);

  const activeBenchmark = getBenchmarkById(activeBenchmarkId);

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

  if (status === "loading") {
    return <main className="loading-state">Loading {activeBenchmark.name}...</main>;
  }

  if (status === "error" || !dataset) {
    return <main className="loading-state">Failed to load {activeBenchmark.datasetPath}.</main>;
  }

  const selectedSample = dataset.samples[selectedIndex];
  const selectedSession =
    selectedSample.sessions.find((session) => session.number === activeSession) ||
    selectedSample.sessions[0];

  const filteredQa = selectedSample.qa.filter((qa) => {
    const matchCategory = qaCategory === "all" || String(qa.category) === qaCategory;
    const searchText = `${qa.question} ${String(qa.answer)} ${qa.evidence.join(" ")}`.toLowerCase();
    const matchSearch = !deferredSearch || searchText.includes(deferredSearch.toLowerCase());
    return matchCategory && matchSearch;
  });

  const maxTurns = Math.max(...dataset.samples.map((sample) => sample.turnCount), 1);
  const maxQa = Math.max(...dataset.samples.map((sample) => sample.qa.length), 1);

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Cloudflare + React Benchmark Studio</p>
          <h1>多 Benchmark 数据集可视化平台</h1>
          <p className="hero-text">
            这个站点现在已经不是单独服务 LoCoMo 的页面，而是一个可扩展的 benchmark
            可视化工作台。当前接入的数据源只有 {activeBenchmark.name}，但主页面、注册表和数据适配层都已经改成面向多 benchmark 的结构。
          </p>
        </div>
        <div className="hero-stats">
          <StatCard label="已注册 Benchmark" value={formatNumber(BENCHMARKS.length)} note="包含已接入与预留接入位" />
          <StatCard label="当前数据集" value={activeBenchmark.name} note={activeBenchmark.tagline} />
          <StatCard label="样本数" value={formatNumber(dataset.stats.sampleCount)} note="当前 benchmark 已加载的 records" />
          <StatCard label="会话总数" value={formatNumber(dataset.stats.totalSessions)} note="结构化 session 汇总" />
          <StatCard label="QA 总数" value={formatNumber(dataset.stats.totalQa)} note="question-answer pairs" />
          <StatCard label="证据引用" value={formatNumber(dataset.stats.totalEvidence)} note="evidence reference 出现次数" />
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
              <StatCard label="Samples" value={formatNumber(dataset.stats.sampleCount)} note="当前 benchmark 中的 sample 数" />
              <StatCard label="Turns" value={formatNumber(dataset.stats.totalTurns)} note="所有样本中的总消息轮次" />
              <StatCard label="QA Pairs" value={formatNumber(dataset.stats.totalQa)} note="问答监督条目数" />
              <StatCard label="Media Turns" value={formatNumber(dataset.stats.totalMedia)} note="包含图像元信息的 turns" />
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

        <PlatformReadiness activeBenchmark={activeBenchmark} />

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
          onSelectSession={setActiveSession}
        />
        <EvidenceHeatmap sample={selectedSample} />
        <ConversationViewer session={selectedSession} />
        <QAExplorer
          rows={filteredQa}
          qaCategory={qaCategory}
          setQaCategory={setQaCategory}
          qaSearch={qaSearch}
          setQaSearch={setQaSearch}
        />
        <RawPreview sample={selectedSample} />
      </section>
    </main>
  );
}
