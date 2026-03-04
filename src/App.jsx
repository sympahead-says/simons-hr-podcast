import { useState, useRef, useEffect, useCallback } from "react";

const DEFAULT_FEEDS = [
  { id: 1, name: "Personalwirtschaft", url: "https://www.personalwirtschaft.de/feed/", active: true, category: "HR" },
  { id: 2, name: "HRM.de", url: "https://www.hrm.de/feed/", active: true, category: "HR" },
  { id: 3, name: "Human Resources Manager", url: "https://www.humanresourcesmanager.de/feed/", active: true, category: "HR" },
  { id: 4, name: "Persoblogger", url: "https://www.persoblogger.de/feed/", active: true, category: "HR" },
  { id: 5, name: "REXX Systems HR-Blog", url: "https://www.rexx-systems.com/feed/", active: true, category: "HR" },
];

const STEPS = ["quellen", "artikel", "script", "audio"];

export default function App() {
  const [tab, setTab] = useState("quellen");
  const [feeds, setFeeds] = useState(DEFAULT_FEEDS);
  const [articles, setArticles] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [fetchingFeeds, setFetchingFeeds] = useState(false);
  const [script, setScript] = useState([]);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [audioSegments, setAudioSegments] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [claudeApiKey, setClaudeApiKey] = useState(() => localStorage.getItem("rp_claudeApiKey") || "");
  const [elApiKey, setElApiKey] = useState(() => localStorage.getItem("rp_elApiKey") || "");
  const [annaVoiceId, setAnnaVoiceId] = useState(() => localStorage.getItem("rp_annaVoiceId") || "21m00Tcm4TlvDq8ikWAM");
  const [peterVoiceId, setPeterVoiceId] = useState(() => localStorage.getItem("rp_peterVoiceId") || "AZnzlk1XvdvUeBnXmlld");

  useEffect(() => { localStorage.setItem("rp_claudeApiKey", claudeApiKey); }, [claudeApiKey]);
  useEffect(() => { localStorage.setItem("rp_elApiKey", elApiKey); }, [elApiKey]);
  useEffect(() => { localStorage.setItem("rp_annaVoiceId", annaVoiceId); }, [annaVoiceId]);
  useEffect(() => { localStorage.setItem("rp_peterVoiceId", peterVoiceId); }, [peterVoiceId]);
  const [status, setStatus] = useState({ msg: "", type: "idle" });
  const [audioProgress, setAudioProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSeg, setCurrentSeg] = useState(0);
  const [activeEpisode, setActiveEpisode] = useState(null);
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [scriptPreviewOpen, setScriptPreviewOpen] = useState(false);
  const audioRef = useRef(null);

  const setMsg = (msg, type = "info") => setStatus({ msg, type });

  // — RSS Fetching —
  const fetchFeeds = async () => {
    const activeFeeds = feeds.filter(f => f.active);
    if (!activeFeeds.length) { setMsg("Keine aktiven Feeds.", "error"); return; }
    setFetchingFeeds(true);
    setMsg("Feeds werden geladen…", "loading");
    const all = [];
    for (const feed of activeFeeds) {
      try {
        const res = await fetch(`/api/proxy?url=${encodeURIComponent(feed.url)}`);
        const text = await res.text();
        const xml = new DOMParser().parseFromString(text, "text/xml");
        const items = Array.from(xml.querySelectorAll("item")).slice(0, 6);
        items.forEach((item, i) => {
          const title = item.querySelector("title")?.textContent?.trim() || "(Kein Titel)";
          const desc = item.querySelector("description")?.textContent?.replace(/<[^>]*>/g, "").slice(0, 400).trim() || "";
          const link = item.querySelector("link")?.textContent?.trim() || "";
          const pub = item.querySelector("pubDate")?.textContent?.trim() || "";
          all.push({ id: `${feed.id}-${i}`, feedName: feed.name, category: feed.category, title, desc, link, pub });
        });
      } catch (e) {
        console.warn("Feed error:", feed.name, e);
      }
    }
    setArticles(all);
    setSelectedIds(all.slice(0, 8).map(a => a.id));
    setFetchingFeeds(false);
    if (all.length) { setMsg(`${all.length} Artikel geladen.`, "success"); setTab("artikel"); }
    else setMsg("Keine Artikel gefunden. Feeds prüfen.", "error");
  };

  // — Script Generation —
  const generateScript = async () => {
    const sel = articles.filter(a => selectedIds.includes(a.id));
    if (!sel.length) { setMsg("Keine Artikel ausgewählt.", "error"); return; }
    if (!claudeApiKey) { setMsg("Claude API-Key fehlt (⚙ Einstellungen).", "error"); return; }
    setGeneratingScript(true);
    setMsg("Script wird generiert…", "loading");
    const articleText = sel.map(a => `[${a.feedName} | ${a.category}]\nTitel: ${a.title}\n${a.desc}`).join("\n\n—\n\n");

    const prompt = `Du bist Produzent eines deutschen Arbeitsrecht & HR-Podcasts namens "Recht & Personal".

Erstelle ein natürliches, professionelles Podcast-Gespräch zwischen:

- Anna Becker: Fachanwältin für Arbeitsrecht, präzise und praxisnah
- Peter Hoffmann: Senior HR-Manager, fragt nach Auswirkungen für Unternehmen

Basierend auf diesen aktuellen Artikeln/Urteilen:
${articleText}

WICHTIG: Antworte NUR mit einem JSON-Array ohne Markdown-Backticks oder Erklärungen. Format:
[{"speaker":"Anna","text":"…"},{"speaker":"Peter","text":"…"},…]

Anforderungen:

- Auf Deutsch, professionell aber zugänglich
- Begrüßung am Anfang, Zusammenfassung am Ende
- Praxisrelevanz für HR hervorheben
- Mindestens 25 Wechsel zwischen den Sprechern
- Jedes Thema einführen und praktische Konsequenzen besprechen`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeApiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      const text = data.content?.find(c => c.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setScript(parsed);
      setMsg(`Script: ${parsed.length} Gesprächsrunden generiert.`, "success");
      setTab("script");
    } catch (e) {
      setMsg("Fehler: " + e.message, "error");
    }
    setGeneratingScript(false);
  };

  // — Audio Generation —
  const generateAudio = async () => {
    if (!elApiKey) { setMsg("ElevenLabs API-Key fehlt (⚙ Einstellungen).", "error"); return; }
    if (!script.length) { setMsg("Kein Script vorhanden.", "error"); return; }
    setGeneratingAudio(true);
    const segs = [];
    for (let i = 0; i < script.length; i++) {
      const turn = script[i];
      setMsg(`Audio: ${i + 1}/${script.length} (${turn.speaker})…`, "loading");
      const voiceId = turn.speaker === "Anna" ? annaVoiceId : peterVoiceId;
      try {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: { "xi-api-key": elApiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ text: turn.text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
        });
        if (!r.ok) throw new Error(`ElevenLabs: ${r.status}`);
        const blob = await r.blob();
        segs.push({ ...turn, url: URL.createObjectURL(blob) });
      } catch (e) {
        setMsg("Audio-Fehler bei Segment " + (i + 1) + ": " + e.message, "error");
        setGeneratingAudio(false);
        return;
      }
    }
    setAudioSegments(segs);
    const ep = {
      id: Date.now(),
      date: new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" }),
      title: `Recht & Personal – ${new Date().toLocaleDateString("de-DE")}`,
      segments: segs,
      script,
      articleCount: selectedIds.length,
    };
    setEpisodes(prev => [ep, ...prev]);
    setActiveEpisode(ep);
    setGeneratingAudio(false);
    setMsg("Episode fertig! Viel Spaß beim Hören.", "success");
    setTab("audio");
  };

  // — Player —
  const playFrom = useCallback((ep, idx = 0) => {
    setActiveEpisode(ep);
    setCurrentSeg(idx);
    if (audioRef.current && ep.segments[idx]) {
      audioRef.current.src = ep.segments[idx].url;
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else { audioRef.current.play(); setIsPlaying(true); }
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnded = () => {
      if (activeEpisode && currentSeg < activeEpisode.segments.length - 1) {
        const next = currentSeg + 1;
        setCurrentSeg(next);
        el.src = activeEpisode.segments[next].url;
        el.play();
      } else setIsPlaying(false);
    };
    const onTime = () => {
      if (el.duration) setAudioProgress((el.currentTime / el.duration) * 100);
    };
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTime);
    return () => { el.removeEventListener("ended", onEnded); el.removeEventListener("timeupdate", onTime); };
  }, [activeEpisode, currentSeg]);

  const addFeed = () => {
    if (!newFeedUrl.trim()) return;
    const name = newFeedName.trim() || newFeedUrl;
    setFeeds(prev => [...prev, { id: Date.now(), name, url: newFeedUrl.trim(), active: true, category: "Sonstige" }]);
    setNewFeedName(""); setNewFeedUrl("");
  };

  const toggleFeed = id => setFeeds(prev => prev.map(f => f.id === id ? { ...f, active: !f.active } : f));
  const removeFeed = id => setFeeds(prev => prev.filter(f => f.id !== id));
  const toggleArticle = id => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const stepDone = step => {
    if (step === "quellen") return articles.length > 0;
    if (step === "artikel") return selectedIds.length > 0 && articles.length > 0;
    if (step === "script") return script.length > 0;
    if (step === "audio") return audioSegments.length > 0;
    return false;
  };

  const currentTurn = activeEpisode?.segments[currentSeg];

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;0,700;1,300&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500&display=swap'); *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; } body { background: #0d1117; } ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #161b22; } ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; } @keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} } @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} } @keyframes barPulse { 0%,100%{height:6px} 50%{height:20px} } .wave span { display:inline-block; width:3px; background:#e8a135; border-radius:2px; margin:0 1px; animation: barPulse 0.8s ease-in-out infinite; } .wave span:nth-child(2){animation-delay:0.15s} .wave span:nth-child(3){animation-delay:0.3s} .wave span:nth-child(4){animation-delay:0.15s} .wave span:nth-child(5){animation-delay:0s} .fadeIn { animation: fadeIn 0.3s ease forwards; } input, textarea { outline: none; } button { cursor: pointer; border: none; background: none; } .tag-recht { background: #1a2744; color: #6fa3ef; border: 1px solid #1e3a6e; } .tag-hr { background: #1a2e24; color: #5fb878; border: 1px solid #1e4a2e; } .tag-sonstige { background: #2a2020; color: #c47a5a; border: 1px solid #4a2a1a; }`}</style>

      <div style={{ fontFamily: "'Inter', sans-serif", background: "#0d1117", minHeight: "100vh", color: "#e6edf3" }}>
        <audio ref={audioRef} style={{ display: "none" }} />

        {/* Header */}
        <header style={{ background: "#161b22", borderBottom: "1px solid #21262d", padding: "0 24px" }}>
          <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#e8a135,#c17d1a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🎙</div>
              <div>
                <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17, letterSpacing: "-0.3px", color: "#f0f6fc" }}>Recht & Personal</div>
                <div style={{ fontSize: 10, color: "#6e7681", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.5px", textTransform: "uppercase" }}>KI-Podcast Generator</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {[
                { key: "quellen", label: "01 Quellen" },
                { key: "artikel", label: "02 Artikel" },
                { key: "script", label: "03 Script" },
                { key: "audio", label: "04 Episode" },
              ].map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  style={{
                    padding: "6px 14px", borderRadius: 6, fontSize: 12,
                    fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
                    background: tab === t.key ? "#21262d" : "transparent",
                    color: tab === t.key ? "#f0f6fc" : "#6e7681",
                    border: tab === t.key ? "1px solid #30363d" : "1px solid transparent",
                    transition: "all 0.15s",
                    position: "relative",
                  }}>
                  {stepDone(t.key) && <span style={{ position: "absolute", top: 3, right: 3, width: 5, height: 5, borderRadius: "50%", background: "#3fb950" }} />}
                  {t.label}
                </button>
              ))}
              <button onClick={() => setShowSettings(!showSettings)}
                style={{ marginLeft: 8, width: 34, height: 34, borderRadius: 6, background: showSettings ? "#21262d" : "transparent", border: "1px solid " + (showSettings ? "#30363d" : "transparent"), color: "#6e7681", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                ⚙
              </button>
            </div>
          </div>
        </header>

        {/* Status bar */}
        {status.msg && (
          <div style={{ background: status.type === "error" ? "#2d1318" : status.type === "success" ? "#112320" : "#161b22", borderBottom: "1px solid " + (status.type === "error" ? "#5a1e26" : status.type === "success" ? "#1a4434" : "#21262d"), padding: "8px 24px" }}>
            <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              {status.type === "loading" && <div style={{ width: 12, height: 12, border: "2px solid #e8a135", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />}
              {status.type === "success" && <span style={{ color: "#3fb950" }}>✓</span>}
              {status.type === "error" && <span style={{ color: "#f85149" }}>✗</span>}
              <span style={{ color: status.type === "error" ? "#f85149" : status.type === "success" ? "#3fb950" : "#8b949e" }}>{status.msg}</span>
            </div>
          </div>
        )}

        <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px" }}>

          {/* Settings Panel */}
          {showSettings && (
            <div className="fadeIn" style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 24, marginBottom: 24 }}>
              <h3 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18, marginBottom: 20, color: "#f0f6fc" }}>Einstellungen</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={labelStyle}>Claude API-Key</label>
                  <input type="password" value={claudeApiKey} onChange={e => setClaudeApiKey(e.target.value)}
                    placeholder="sk-ant-..." style={inputStyle} />
                  <div style={{ fontSize: 11, color: "#6e7681", marginTop: 4 }}>Für Script-Generierung. console.anthropic.com → API Keys</div>
                </div>
                <div>
                  <label style={labelStyle}>ElevenLabs API-Key</label>
                  <input type="password" value={elApiKey} onChange={e => setElApiKey(e.target.value)}
                    placeholder="sk-..." style={inputStyle} />
                  <div style={{ fontSize: 11, color: "#6e7681", marginTop: 4 }}>Für Audio-Generierung. elevenlabs.io → Profile → API Keys</div>
                </div>
                <div>
                  <label style={labelStyle}>Anna – Voice ID (weiblich)</label>
                  <input value={annaVoiceId} onChange={e => setAnnaVoiceId(e.target.value)} style={inputStyle} placeholder="Voice ID" />
                  <div style={{ fontSize: 11, color: "#6e7681", marginTop: 4 }}>Standard: Rachel (21m00Tcm4TlvDq8ikWAM)</div>
                </div>
                <div>
                  <label style={labelStyle}>Peter – Voice ID (männlich)</label>
                  <input value={peterVoiceId} onChange={e => setPeterVoiceId(e.target.value)} style={inputStyle} placeholder="Voice ID" />
                  <div style={{ fontSize: 11, color: "#6e7681", marginTop: 4 }}>Standard: Domi (AZnzlk1XvdvUeBnXmlld)</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: QUELLEN */}
          {tab === "quellen" && (
            <div className="fadeIn">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <h2 style={h2Style}>RSS-Quellen</h2>
                  <p style={subtitleStyle}>Aktive Feeds werden wöchentlich abgerufen und zu Podcast-Episoden verarbeitet.</p>
                </div>
                <button onClick={fetchFeeds} disabled={fetchingFeeds}
                  style={{ ...btnPrimary, opacity: fetchingFeeds ? 0.7 : 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {fetchingFeeds ? <><span style={{ width: 12, height: 12, border: "2px solid #fff3", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} /> Laden…</> : "▶ Feeds laden"}
                </button>
              </div>

              <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
                {feeds.map(feed => (
                  <div key={feed.id} style={{ background: "#161b22", border: "1px solid " + (feed.active ? "#21262d" : "#161b22"), borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, transition: "all 0.15s", opacity: feed.active ? 1 : 0.5 }}>
                    <button onClick={() => toggleFeed(feed.id)}
                      style={{ width: 36, height: 20, borderRadius: 10, background: feed.active ? "#e8a135" : "#21262d", border: "none", position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
                      <span style={{ position: "absolute", top: 2, left: feed.active ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "#f0f6fc", marginBottom: 2 }}>{feed.name}</div>
                      <div style={{ fontSize: 11, color: "#6e7681", fontFamily: "'IBM Plex Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{feed.url}</div>
                    </div>
                    <span className={`tag-${feed.category.toLowerCase()}`} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0 }}>{feed.category}</span>
                    <button onClick={() => removeFeed(feed.id)} style={{ color: "#6e7681", fontSize: 16, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, transition: "all 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.color = "#f85149"}
                      onMouseLeave={e => e.currentTarget.style.color = "#6e7681"}>×</button>
                  </div>
                ))}
              </div>

              <div style={{ background: "#161b22", border: "1px dashed #21262d", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 12, color: "#6e7681", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>+ Feed hinzufügen</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input value={newFeedName} onChange={e => setNewFeedName(e.target.value)} placeholder="Name" style={{ ...inputStyle, flex: 1 }} />
                  <input value={newFeedUrl} onChange={e => setNewFeedUrl(e.target.value)} placeholder="RSS-URL" style={{ ...inputStyle, flex: 2 }} />
                  <button onClick={addFeed} style={btnSecondary}>Hinzufügen</button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: ARTIKEL */}
          {tab === "artikel" && (
            <div className="fadeIn">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <h2 style={h2Style}>Artikel auswählen</h2>
                  <p style={subtitleStyle}>{selectedIds.length} von {articles.length} ausgewählt – diese werden in die Episode aufgenommen.</p>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setSelectedIds(articles.map(a => a.id))} style={btnSecondary}>Alle</button>
                  <button onClick={generateScript} disabled={generatingScript || !selectedIds.length}
                    style={{ ...btnPrimary, opacity: generatingScript || !selectedIds.length ? 0.6 : 1, display: "flex", alignItems: "center", gap: 8 }}>
                    {generatingScript ? <><span style={{ width: 12, height: 12, border: "2px solid #fff3", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} /> Script wird generiert…</> : "✦ Script generieren"}
                  </button>
                </div>
              </div>

              {articles.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#6e7681" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                  <div>Noch keine Artikel. Bitte zuerst Feeds laden.</div>
                  <button onClick={() => setTab("quellen")} style={{ ...btnSecondary, marginTop: 16 }}>→ Zu den Quellen</button>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {articles.map(article => {
                    const selected = selectedIds.includes(article.id);
                    return (
                      <div key={article.id} onClick={() => toggleArticle(article.id)}
                        style={{ background: "#161b22", border: "1px solid " + (selected ? "#2d3f2d" : "#21262d"), borderRadius: 10, padding: "14px 16px", display: "flex", gap: 12, cursor: "pointer", transition: "all 0.15s", opacity: selected ? 1 : 0.6 }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = selected ? "#3fb950" : "#30363d"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = selected ? "#2d3f2d" : "#21262d"}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: "1.5px solid " + (selected ? "#3fb950" : "#30363d"), background: selected ? "#3fb950" : "transparent", flexShrink: 0, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", transition: "all 0.15s" }}>
                          {selected ? "✓" : ""}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: "#f0f6fc", marginBottom: 4, lineHeight: 1.4 }}>{article.title}</div>
                          {article.desc && <div style={{ fontSize: 12, color: "#6e7681", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{article.desc}</div>}
                        </div>
                        <div style={{ flexShrink: 0, textAlign: "right" }}>
                          <span className={`tag-${article.category.toLowerCase()}`} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, fontFamily: "'IBM Plex Mono', monospace", display: "block", marginBottom: 4 }}>{article.feedName}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB: SCRIPT */}
          {tab === "script" && (
            <div className="fadeIn">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <h2 style={h2Style}>Podcast-Script</h2>
                  <p style={subtitleStyle}>{script.length} Gesprächsrunden • Bereit zur Audio-Generierung</p>
                </div>
                <button onClick={generateAudio} disabled={generatingAudio || !script.length || !elApiKey}
                  style={{ ...btnPrimary, opacity: generatingAudio || !script.length ? 0.6 : 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {generatingAudio ? <><span style={{ width: 12, height: 12, border: "2px solid #fff3", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} /> Audio wird generiert…</> : "🎙 Audio generieren"}
                </button>
              </div>

              {!elApiKey && (
                <div style={{ background: "#2d1f10", border: "1px solid #5a3a1a", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#d08020", display: "flex", gap: 8, alignItems: "center" }}>
                  ⚠ Kein ElevenLabs API-Key. Bitte in ⚙ Einstellungen hinterlegen.
                </div>
              )}

              {!claudeApiKey && (
                <div style={{ background: "#2d1f10", border: "1px solid #5a3a1a", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#d08020", display: "flex", gap: 8, alignItems: "center" }}>
                  ⚠ Kein Claude API-Key. Bitte in ⚙ Einstellungen hinterlegen.
                </div>
              )}

              {script.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#6e7681" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
                  <div>Noch kein Script. Bitte erst Artikel auswählen und generieren.</div>
                  <button onClick={() => setTab("artikel")} style={{ ...btnSecondary, marginTop: 16 }}>→ Zu den Artikeln</button>
                </div>
              ) : (
                <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.5px" }}>Script-Vorschau</span>
                    <button onClick={() => setScriptPreviewOpen(!scriptPreviewOpen)} style={{ fontSize: 12, color: "#e8a135", fontFamily: "'IBM Plex Mono', monospace" }}>
                      {scriptPreviewOpen ? "Einklappen" : "Ausklappen"}
                    </button>
                  </div>
                  <div style={{ maxHeight: scriptPreviewOpen ? "none" : 500, overflow: scriptPreviewOpen ? "visible" : "hidden", padding: "12px 0" }}>
                    {script.map((turn, i) => (
                      <div key={i} style={{ padding: "10px 16px", display: "flex", gap: 12, borderBottom: i < script.length - 1 ? "1px solid #161b22" : "none" }}>
                        <div style={{
                          flexShrink: 0, width: 52, height: 24, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", marginTop: 2,
                          background: turn.speaker === "Anna" ? "#1e2f4a" : "#1e3028",
                          color: turn.speaker === "Anna" ? "#58a6ff" : "#3fb950",
                          border: "1px solid " + (turn.speaker === "Anna" ? "#1a3a6a" : "#1a4a34"),
                        }}>{turn.speaker}</div>
                        <div style={{ fontSize: 14, color: "#c9d1d9", lineHeight: 1.6, flex: 1 }}>{turn.text}</div>
                      </div>
                    ))}
                  </div>
                  {!scriptPreviewOpen && (
                    <div style={{ padding: "10px 16px", background: "linear-gradient(to top, #161b22, transparent)", borderTop: "1px solid #21262d", textAlign: "center" }}>
                      <button onClick={() => setScriptPreviewOpen(true)} style={{ fontSize: 12, color: "#6e7681" }}>Alle {script.length} Zeilen anzeigen ↓</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB: AUDIO / EPISODE */}
          {tab === "audio" && (
            <div className="fadeIn">
              <h2 style={{ ...h2Style, marginBottom: 8 }}>Episoden</h2>
              <p style={{ ...subtitleStyle, marginBottom: 24 }}>Generierte Podcast-Episoden zum Abspielen und Archivieren.</p>

              {episodes.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#6e7681" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🎧</div>
                  <div>Noch keine Episoden. Bitte erst ein Script generieren und in Audio umwandeln.</div>
                  <button onClick={() => setTab("script")} style={{ ...btnSecondary, marginTop: 16 }}>→ Zum Script</button>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 16 }}>
                  {episodes.map(ep => {
                    const isActive = activeEpisode?.id === ep.id;
                    return (
                      <div key={ep.id} style={{ background: "#161b22", border: "1px solid " + (isActive ? "#30363d" : "#21262d"), borderRadius: 12, overflow: "hidden" }}>
                        <div style={{ padding: "18px 20px", display: "flex", gap: 16, alignItems: "center" }}>
                          <button onClick={() => isActive && isPlaying ? togglePlay() : playFrom(ep, 0)}
                            style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,#e8a135,#c17d1a)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 18, boxShadow: "0 4px 12px #e8a13530", transition: "transform 0.15s" }}
                            onMouseEnter={e => e.currentTarget.style.transform = "scale(1.08)"}
                            onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                            {isActive && isPlaying ? "⏸" : "▶"}
                          </button>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 16, color: "#f0f6fc", marginBottom: 4 }}>{ep.title}</div>
                            <div style={{ fontSize: 12, color: "#6e7681", display: "flex", gap: 16 }}>
                              <span>{ep.date}</span>
                              <span>•</span>
                              <span>{ep.segments.length} Segmente</span>
                              <span>•</span>
                              <span>{ep.articleCount} Artikel</span>
                            </div>
                          </div>
                          {isActive && isPlaying && (
                            <div className="wave" style={{ display: "flex", alignItems: "center", height: 24 }}>
                              <span /><span /><span /><span /><span />
                            </div>
                          )}
                        </div>

                        {isActive && (
                          <div style={{ borderTop: "1px solid #21262d", padding: "14px 20px" }}>
                            {/* Progress bar */}
                            <div style={{ background: "#21262d", borderRadius: 4, height: 4, marginBottom: 12, cursor: "pointer" }}
                              onClick={e => {
                                const pct = e.nativeEvent.offsetX / e.currentTarget.offsetWidth;
                                if (audioRef.current) { audioRef.current.currentTime = audioRef.current.duration * pct; }
                              }}>
                              <div style={{ width: audioProgress + "%", height: "100%", background: "#e8a135", borderRadius: 4, transition: "width 0.3s" }} />
                            </div>
                            {/* Current turn */}
                            {currentTurn && (
                              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
                                <span style={{
                                  flexShrink: 0, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600,
                                  padding: "2px 8px", borderRadius: 4, marginTop: 3,
                                  background: currentTurn.speaker === "Anna" ? "#1e2f4a" : "#1e3028",
                                  color: currentTurn.speaker === "Anna" ? "#58a6ff" : "#3fb950",
                                  border: "1px solid " + (currentTurn.speaker === "Anna" ? "#1a3a6a" : "#1a4a34"),
                                }}>{currentTurn.speaker}</span>
                                <div style={{ fontSize: 13, color: "#c9d1d9", lineHeight: 1.5 }}>{currentTurn.text}</div>
                              </div>
                            )}
                            {/* Segment nav */}
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {ep.segments.map((seg, i) => (
                                <button key={i} onClick={() => playFrom(ep, i)}
                                  style={{
                                    width: 24, height: 24, borderRadius: 4, fontSize: 9,
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    background: i === currentSeg && isActive ? "#e8a135" : "#21262d",
                                    color: i === currentSeg && isActive ? "#000" : "#6e7681",
                                    border: "1px solid " + (i === currentSeg && isActive ? "#e8a135" : "#30363d"),
                                    transition: "all 0.15s",
                                  }}>
                                  {i + 1}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid #21262d", padding: "16px 24px", marginTop: 40 }}>
          <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#6e7681", fontFamily: "'IBM Plex Mono', monospace" }}>Recht & Personal · KI-Podcast Generator</span>
            <span style={{ fontSize: 11, color: "#6e7681", fontFamily: "'IBM Plex Mono', monospace" }}>Claude API + ElevenLabs</span>
          </div>
        </div>
      </div>
    </>
  );
}

const h2Style = { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 22, color: "#f0f6fc", letterSpacing: "-0.4px" };
const subtitleStyle = { fontSize: 13, color: "#6e7681", marginTop: 4 };
const labelStyle = { display: "block", fontSize: 12, color: "#8b949e", marginBottom: 6, fontFamily: "'IBM Plex Mono', monospace", textTransform: "uppercase", letterSpacing: "0.3px" };
const inputStyle = { width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "8px 12px", color: "#f0f6fc", fontSize: 13, fontFamily: "'Inter', sans-serif", transition: "border-color 0.15s" };
const btnPrimary = { background: "linear-gradient(135deg,#e8a135,#c17d1a)", color: "#000", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, letterSpacing: "0.2px", transition: "all 0.15s" };
const btnSecondary = { background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 500, transition: "all 0.15s" };
