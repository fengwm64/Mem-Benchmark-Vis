function sortSessionNumbers(keys) {
  return keys
    .map((key) => {
      const match = key.match(/^session_(\d+)$/);
      return match ? Number(match[1]) : null;
    })
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
}

function collectEvidenceSessions(evidenceList = []) {
  const counts = new Map();

  evidenceList.forEach((item) => {
    const matches = String(item).match(/D(\d+):\d+/g) || [];
    matches.forEach((match) => {
      const sessionNumber = Number(match.match(/D(\d+):/)[1]);
      counts.set(sessionNumber, (counts.get(sessionNumber) || 0) + 1);
    });
  });

  return counts;
}

function normalizeSample(sample, index) {
  const sessionNumbers = sortSessionNumbers(Object.keys(sample.conversation || {}));
  const sessions = sessionNumbers.map((sessionNumber) => {
    const turns = sample.conversation[`session_${sessionNumber}`] || [];
    const dateTime = sample.conversation[`session_${sessionNumber}_date_time`] || "Unknown";
    const eventBlock = sample.event_summary?.[`events_session_${sessionNumber}`] || {};
    const observationBlock = sample.observation?.[`session_${sessionNumber}_observation`] || {};
    const summary = sample.session_summary?.[`session_${sessionNumber}_summary`] || "";
    const speakers = [...new Set(turns.map((turn) => turn.speaker).filter(Boolean))];
    const mediaTurns = turns.filter(
      (turn) => (turn.img_url && turn.img_url.length) || turn.query || turn.blip_caption
    );

    return {
      number: sessionNumber,
      dateTime,
      turns,
      turnCount: turns.length,
      speakers,
      speakerCount: speakers.length,
      mediaTurns,
      mediaCount: mediaTurns.length,
      eventBlock,
      observationBlock,
      summary
    };
  });

  const qaCategoryCounts = {};
  sample.qa.forEach((qa) => {
    qaCategoryCounts[qa.category] = (qaCategoryCounts[qa.category] || 0) + 1;
  });

  const evidenceCounts = new Map();
  sample.qa.forEach((qa) => {
    const qaEvidenceCounts = collectEvidenceSessions(qa.evidence);
    qaEvidenceCounts.forEach((count, sessionNumber) => {
      evidenceCounts.set(sessionNumber, (evidenceCounts.get(sessionNumber) || 0) + count);
    });
  });

  const speakers = [...new Set(sessions.flatMap((session) => session.speakers))];
  const observations = sessions.reduce((sum, session) => {
    return (
      sum +
      Object.values(session.observationBlock || {}).reduce((speakerSum, entries) => {
        return speakerSum + (Array.isArray(entries) ? entries.length : 0);
      }, 0)
    );
  }, 0);

  const events = sessions.reduce((sum, session) => {
    return (
      sum +
      Object.entries(session.eventBlock || {}).reduce((speakerSum, [key, entries]) => {
        if (key === "date") {
          return speakerSum;
        }
        return speakerSum + (Array.isArray(entries) ? entries.length : 0);
      }, 0)
    );
  }, 0);

  return {
    index,
    sampleId: sample.sample_id || `sample-${index + 1}`,
    raw: sample,
    sessions,
    qa: sample.qa,
    speakers,
    sessionCount: sessions.length,
    turnCount: sessions.reduce((sum, session) => sum + session.turnCount, 0),
    mediaCount: sessions.reduce((sum, session) => sum + session.mediaCount, 0),
    evidenceCount: [...evidenceCounts.values()].reduce((sum, value) => sum + value, 0),
    observationCount: observations,
    eventCount: events,
    qaCategoryCounts,
    evidenceCounts
  };
}

export async function loadLoCoMoBenchmark(benchmark) {
  const response = await fetch(benchmark.datasetPath);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${benchmark.datasetPath}: ${response.status}`);
  }

  const json = await response.json();
  const samples = json.map(normalizeSample);

  return {
    adapterName: "LoCoMo Conversation Adapter",
    schemaLabel: "conversation + observation + event_summary + qa",
    samples,
    stats: {
      sampleCount: samples.length,
      totalSessions: samples.reduce((sum, sample) => sum + sample.sessionCount, 0),
      totalTurns: samples.reduce((sum, sample) => sum + sample.turnCount, 0),
      totalQa: samples.reduce((sum, sample) => sum + sample.qa.length, 0),
      totalEvidence: samples.reduce((sum, sample) => sum + sample.evidenceCount, 0),
      totalMedia: samples.reduce((sum, sample) => sum + sample.mediaCount, 0)
    }
  };
}
