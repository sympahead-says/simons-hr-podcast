import { useState, useRef, useEffect, useCallback } from "react";
import { saveEpisode, loadEpisodes, deleteEpisode } from "./db";

const DEFAULT_FEEDS = [
  // Recht & Rechtsprechung
  { id: 1, name: "Bundesarbeitsgericht (BAG)", url: "https://www.bundesarbeitsgericht.de/feed/", active: true, category: "Recht" },
  { id: 2, name: "Expertenforum Arbeitsrecht (EFAR)", url: "https://efarbeitsrecht.net/feed/", active: true, category: "Recht" },
  { id: 3, name: "FAZ Recht & Steuern", url: "https://www.faz.net/rss/aktuell/wirtschaft/recht-steuern/", active: true, category: "Recht" },
  { id: 4, name: "JUVE", url: "https://www.juve.de/feed/", active: true, category: "Recht" },
  // HR & Personal
  { id: 5, name: "Personalwirtschaft", url: "https://www.personalwirtschaft.de/feed/", active: true, category: "HR" },
  { id: 6, name: "HRM.de", url: "https://www.hrm.de/feed/", active: true, category: "HR" },
  { id: 7, name: "Human Resources Manager", url: "https://www.humanresourcesmanager.de/feed/", active: true, category: "HR" },
  { id: 8, name: "Persoblogger", url: "https://www.persoblogger.de/feed/", active: true, category: "HR" },
];

// Pronunciation fixes for German TTS
function preprocessForTTS(text) {
  return text
    .replace(/\bHR\b/g, "Ha-Er")
    .replace(/\bKPIs?\b/g, (m) => m.endsWith("s") ? "Ka-Pe-Ies" : "Ka-Pe-I")
    .replace(/\bROI\b/g, "Er-O-I")
    .replace(/\bCEO\b/g, "Ce-E-O")
    .replace(/\bCFO\b/g, "Ce-Ef-O")
    .replace(/\bCHRO\b/g, "Ce-Ha-Er-O")
    .replace(/\bOKRs?\b/g, (m) => m.endsWith("s") ? "O-Ka-Ers" : "O-Ka-Er")
    .replace(/\bKI\b/g, "Ka-I")
    .replace(/\bBGH\b/g, "Be-Ge-Ha")
    .replace(/\bBAG\b/g, "Be-A-Ge")
    .replace(/\bBVerfG\b/g, "Bundesverfassungsgericht")
    .replace(/\bAGG\b/g, "A-Ge-Ge")
    .replace(/\bDSGVO\b/g, "De-Es-Ge-Fau-O");
}

// WAV encoder from AudioBuffer
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

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
  const [annaVoice, setAnnaVoice] = useState(() => localStorage.getItem("rp_annaVoice") || "de-DE-Chirp3-HD-Aoede");
  const [peterVoice, setPeterVoice] = useState(() => localStorage.getItem("rp_peterVoice") || "de-DE-Chirp3-HD-Charon");

  useEffect(() => { localStorage.setItem("rp_annaVoice", annaVoice); }, [annaVoice]);
  useEffect(() => { localStorage.setItem("rp_peterVoice", peterVoice); }, [peterVoice]);

  const [status, setStatus] = useState({ msg: "", type: "idle" });
  const [audioProgress, setAudioProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSeg, setCurrentSeg] = useState(0);
  const [activeEpisode, setActiveEpisode] = useState(null);
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [scriptPreviewOpen, setScriptPreviewOpen] = useState(false);
  const [downloadMenuEpId, setDownloadMenuEpId] = useState(null);

  // Two audio elements for crossfade
  const audioARef = useRef(null);
  const audioBRef = useRef(null);
  const activeAudioRef = useRef("A"); // which one is currently playing
  const crossfadeTimerRef = useRef(null);

  const setMsg = (msg, type = "info") => setStatus({ msg, type });

  // Load saved episodes on mount
  useEffect(() => {
    loadEpisodes().then(eps => setEpisodes(eps.slice(0, 5))).catch(e => console.warn("DB load error:", e));
  }, []);

  // — RSS Fetching —
  const fetchFeeds = async () => {
    const activeFeeds = feeds.filter(f => f.active);
    if (!activeFeeds.length) { setMsg("Keine aktiven Feeds.", "error"); return; }
    setFetchingFeeds(true);
    setMsg("Feeds werden geladen…", "loading");
    const all = [];
    for (const feed of activeFeeds) {
      try {
        const res = await fetch(`/api/rss-proxy?url=${encodeURIComponent(feed.url)}`);
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

  // — Script Generation (30 min target) —
  const generateScript = async () => {
    const sel = articles.filter(a => selectedIds.includes(a.id));
    if (!sel.length) { setMsg("Keine Artikel ausgewählt.", "error"); return; }
    setGeneratingScript(true);
    setMsg("Script wird generiert (ca. 30 Min. Episode)…", "loading");
    const articleText = sel.map(a => `[${a.feedName} | ${a.category}]\nTitel: ${a.title}\n${a.desc}`).join("\n\n—\n\n");

    const prompt = `Du bist Produzent eines deutschen Arbeitsrecht & HR-Podcasts namens "Recht & Personal".

Erstelle ein LANGES, natürliches Podcast-Gespräch (Ziel: ca. 30 Minuten Sprechzeit, also ca. 4500–5000 Wörter) zwischen:

- Anna Becker: Fachanwältin für Arbeitsrecht. Spricht präzise, praxisnah, erklärt juristische Details verständlich. Nutzt gelegentlich Fachbegriffe, die sie dann direkt erklärt.
- Peter Hoffmann: Senior HR-Manager mit 15 Jahren Erfahrung. Pragmatisch, fragt nach konkreten Auswirkungen für Unternehmen, bringt Praxisbeispiele ein, reagiert emotional auf überraschende Urteile.

Basierend auf diesen aktuellen Artikeln/Urteilen:
${articleText}

WICHTIG: Antworte NUR mit einem JSON-Array ohne Markdown-Backticks oder Erklärungen. Format:
[{"speaker":"Anna","text":"…"},{"speaker":"Peter","text":"…"},…]

STIL-ANFORDERUNGEN für einen authentischen Podcast:
- Natürliche Gesprächsdynamik: Unterbrechungen, kurze Reaktionen ("Ja, genau.", "Oh, das ist interessant.", "Moment, da muss ich kurz einhaken…", "Absolut.", "Das sehe ich anders.")
- Füllwörter und Denkpausen natürlich einbauen: "Also…", "Naja…", "Hmm, guter Punkt.", "Weißt du was…"
- Kurze Zwischenreaktionen als eigene Turns: z.B. {"speaker":"Peter","text":"Mhm, ja."} oder {"speaker":"Anna","text":"Genau, und das ist der entscheidende Punkt."}
- Gelegentlich persönliche Anekdoten oder Beispiele aus der Praxis: "Ich hatte letztens einen Fall…", "Bei uns im Unternehmen…"
- Humor und Leichtigkeit einstreuen, wo es passt
- Spannungsbogen: Themen aufbauen, überraschende Wendungen, "Das hätte ich nicht erwartet"
- KEINE steife Moderation – es soll klingen wie zwei Experten, die sich gut kennen

STRUKTUR:
- Lockere, persönliche Begrüßung (nicht formell)
- Jedes Thema: Einführung → Hintergrund → juristische Analyse (Anna) → praktische Auswirkungen (Peter) → Diskussion → Fazit
- Zwischendurch: kurze Übergänge, Rückbezüge auf vorherige Themen
- Ausführliche Zusammenfassung und persönlicher Ausblick am Ende
- Verabschiedung mit Hinweis auf nächste Episode

UMFANG:
- Mindestens 70 Sprecherwechsel
- Einzelne Turns dürfen 3-5 Sätze lang sein (nicht nur Einzeiler!)
- Mische lange inhaltliche Turns mit kurzen Reaktionen
- Jedes Thema ausführlich besprechen (nicht nur anreißen)`;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.find(c => c.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setScript(parsed);
      const wordCount = parsed.reduce((sum, t) => sum + t.text.split(/\s+/).length, 0);
      const estMinutes = Math.round(wordCount / 140);
      setMsg(`Script: ${parsed.length} Turns, ~${wordCount} Wörter, ~${estMinutes} Min. geschätzt.`, "success");
      setTab("script");
    } catch (e) {
      setMsg("Fehler: " + e.message, "error");
    }
    setGeneratingScript(false);
  };

  // — Audio Generation (Google Cloud TTS) —
  const generateAudio = async () => {
    if (!script.length) { setMsg("Kein Script vorhanden.", "error"); return; }
    setGeneratingAudio(true);
    const segs = [];
    for (let i = 0; i < script.length; i++) {
      const turn = script[i];
      const processedText = preprocessForTTS(turn.text);
      setMsg(`Audio: ${i + 1}/${script.length} (${turn.speaker})…`, "loading");
      const voiceName = turn.speaker === "Anna" ? annaVoice : peterVoice;
      try {
        const r = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text: processedText },
            voice: { languageCode: "de-DE", name: voiceName },
            audioConfig: { audioEncoding: "MP3", speakingRate: 1.0, pitch: 0 },
          })
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error?.message || `Google TTS: ${r.status}`);
        }
        const data = await r.json();
        const audioBytes = atob(data.audioContent);
        const audioArray = new Uint8Array(audioBytes.length);
        for (let j = 0; j < audioBytes.length; j++) audioArray[j] = audioBytes.charCodeAt(j);
        const blob = new Blob([audioArray], { type: "audio/mpeg" });
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
    setEpisodes(prev => {
      const updated = [ep, ...prev];
      // Keep only last 5 episodes — delete oldest from DB
      if (updated.length > 5) {
        const toRemove = updated.slice(5);
        toRemove.forEach(old => deleteEpisode(old.id).catch(() => {}));
      }
      return updated.slice(0, 5);
    });
    setActiveEpisode(ep);
    setGeneratingAudio(false);
    setMsg("Episode wird gespeichert…", "loading");
    try {
      await saveEpisode(ep);
      setMsg("Episode fertig und gespeichert!", "success");
    } catch (e) {
      setMsg("Episode fertig, aber Speicherfehler: " + e.message, "error");
    }
    setTab("audio");
  };

  // — Download Episode —
  const handleDownload = async (ep, format) => {
    setDownloadMenuEpId(null);
    const safeName = ep.title.replace(/[^a-zA-Z0-9äöüÄÖÜß\- ]/g, "");

    if (format === "mp3") {
      // ElevenLabs already returns MP3 — just concatenate the blobs
      setMsg("MP3 wird zusammengeführt…", "loading");
      try {
        const parts = [];
        for (const seg of ep.segments) {
          const resp = await fetch(seg.url);
          parts.push(await resp.blob());
        }
        const merged = new Blob(parts, { type: "audio/mpeg" });
        const url = URL.createObjectURL(merged);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}.mp3`;
        a.click();
        URL.revokeObjectURL(url);
        setMsg("MP3-Download gestartet!", "success");
      } catch (e) {
        setMsg("Download-Fehler: " + e.message, "error");
      }
    } else {
      // WAV: decode all segments, merge, encode
      setMsg("WAV wird zusammengeführt (kann etwas dauern)…", "loading");
      try {
        const audioCtx = new AudioContext();
        const buffers = [];
        for (const seg of ep.segments) {
          const resp = await fetch(seg.url);
          const arrayBuf = await resp.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(arrayBuf);
          buffers.push(decoded);
        }
        const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
        const sampleRate = buffers[0].sampleRate;
        const channels = buffers[0].numberOfChannels;
        const merged = audioCtx.createBuffer(channels, totalLength, sampleRate);
        let offset = 0;
        for (const buf of buffers) {
          for (let ch = 0; ch < channels; ch++) {
            merged.getChannelData(ch).set(buf.getChannelData(ch), offset);
          }
          offset += buf.length;
        }
        const wavBlob = audioBufferToWav(merged);
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}.wav`;
        a.click();
        URL.revokeObjectURL(url);
        audioCtx.close();
        setMsg("WAV-Download gestartet!", "success");
      } catch (e) {
        setMsg("Download-Fehler: " + e.message, "error");
      }
    }
  };

  // — Delete Episode —
  const handleDeleteEpisode = async (epId) => {
    try {
      await deleteEpisode(epId);
      setEpisodes(prev => prev.filter(e => e.id !== epId));
      if (activeEpisode?.id === epId) {
        setActiveEpisode(null);
        setIsPlaying(false);
      }
      setMsg("Episode gelöscht.", "success");
    } catch (e) {
      setMsg("Löschfehler: " + e.message, "error");
    }
  };

  // — Crossfade Player —
  const getActiveAudio = () => activeAudioRef.current === "A" ? audioARef.current : audioBRef.current;
  const getNextAudio = () => activeAudioRef.current === "A" ? audioBRef.current : audioARef.current;

  const playFrom = useCallback((ep, idx = 0) => {
    setActiveEpisode(ep);
    setCurrentSeg(idx);
    clearTimeout(crossfadeTimerRef.current);
    const audio = getActiveAudio();
    const other = getNextAudio();
    if (other) { other.pause(); other.volume = 0; }
    if (audio && ep.segments[idx]) {
      audio.volume = 1;
      audio.src = ep.segments[idx].url;
      audio.play();
      setIsPlaying(true);
    }
  }, []);

  const togglePlay = () => {
    const audio = getActiveAudio();
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else { audio.play(); setIsPlaying(true); }
  };

  // Crossfade: start next segment 250ms before current ends
  useEffect(() => {
    const audio = getActiveAudio();
    if (!audio) return;

    const onTimeUpdate = () => {
      if (!audio.duration) return;
      setAudioProgress((audio.currentTime / audio.duration) * 100);

      // Start crossfade 250ms before end
      if (activeEpisode && currentSeg < activeEpisode.segments.length - 1) {
        const remaining = audio.duration - audio.currentTime;
        if (remaining <= 0.25 && remaining > 0 && !crossfadeTimerRef.current) {
          crossfadeTimerRef.current = true; // flag to prevent double-trigger
          const next = getNextAudio();
          const nextIdx = currentSeg + 1;
          if (next && activeEpisode.segments[nextIdx]) {
            next.src = activeEpisode.segments[nextIdx].url;
            next.volume = 0;
            next.play().then(() => {
              // Quick crossfade
              let vol = 0;
              const fade = setInterval(() => {
                vol += 0.1;
                if (vol >= 1) {
                  clearInterval(fade);
                  audio.pause();
                  next.volume = 1;
                  activeAudioRef.current = activeAudioRef.current === "A" ? "B" : "A";
                  setCurrentSeg(nextIdx);
                  crossfadeTimerRef.current = null;
                } else {
                  next.volume = Math.min(vol, 1);
                  audio.volume = Math.max(1 - vol, 0);
                }
              }, 25);
            }).catch(() => {});
          }
        }
      }
    };

    const onEnded = () => {
      if (crossfadeTimerRef.current) return; // crossfade already handled it
      if (activeEpisode && currentSeg < activeEpisode.segments.length - 1) {
        const nextIdx = currentSeg + 1;
        setCurrentSeg(nextIdx);
        audio.src = activeEpisode.segments[nextIdx].url;
        audio.volume = 1;
        audio.play();
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, [activeEpisode, currentSeg]);

  // Reset crossfade flag on segment change
  useEffect(() => {
    crossfadeTimerRef.current = null;
  }, [currentSeg]);

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
    if (step === "audio") return audioSegments.length > 0 || episodes.length > 0;
    return false;
  };

  const currentTurn = activeEpisode?.segments[currentSeg];

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;0,700;1,300&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500&display=swap'); *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; } body { background: #0d1117; } ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #161b22; } ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; } @keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} } @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} } @keyframes barPulse { 0%,100%{height:6px} 50%{height:20px} } .wave span { display:inline-block; width:3px; background:#e8a135; border-radius:2px; margin:0 1px; animation: barPulse 0.8s ease-in-out infinite; } .wave span:nth-child(2){animation-delay:0.15s} .wave span:nth-child(3){animation-delay:0.3s} .wave span:nth-child(4){animation-delay:0.15s} .wave span:nth-child(5){animation-delay:0s} .fadeIn { animation: fadeIn 0.3s ease forwards; } input, textarea { outline: none; } button { cursor: pointer; border: none; background: none; } .tag-recht { background: #1a2744; color: #6fa3ef; border: 1px solid #1e3a6e; } .tag-hr { background: #1a2e24; color: #5fb878; border: 1px solid #1e4a2e; } .tag-sonstige { background: #2a2020; color: #c47a5a; border: 1px solid #4a2a1a; }`}</style>

      <div style={{ fontFamily: "'Inter', sans-serif", background: "#0d1117", minHeight: "100vh", color: "#e6edf3" }}>
        <audio ref={audioARef} style={{ display: "none" }} />
        <audio ref={audioBRef} style={{ display: "none" }} />

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
                  <label style={labelStyle}>Anna – Voice (weiblich)</label>
                  <input value={annaVoice} onChange={e => setAnnaVoice(e.target.value)} style={inputStyle} placeholder="de-DE-Chirp3-HD-..." />
                  <div style={{ fontSize: 11, color: "#6e7681", marginTop: 4 }}>Standard: Chirp3-HD Aoede (weiblich, natürlich)</div>
                </div>
                <div>
                  <label style={labelStyle}>Peter – Voice (männlich)</label>
                  <input value={peterVoice} onChange={e => setPeterVoice(e.target.value)} style={inputStyle} placeholder="de-DE-Chirp3-HD-..." />
                  <div style={{ fontSize: 11, color: "#6e7681", marginTop: 4 }}>Standard: Chirp3-HD Charon (männlich, natürlich)</div>
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
                  <p style={subtitleStyle}>Aktive Feeds werden abgerufen und zu Podcast-Episoden verarbeitet.</p>
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
                <button onClick={generateAudio} disabled={generatingAudio || !script.length}
                  style={{ ...btnPrimary, opacity: generatingAudio || !script.length ? 0.6 : 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {generatingAudio ? <><span style={{ width: 12, height: 12, border: "2px solid #fff3", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} /> Audio wird generiert…</> : "🎙 Audio generieren"}
                </button>
              </div>


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
              <p style={{ ...subtitleStyle, marginBottom: 24 }}>Generierte Podcast-Episoden – gespeichert und auch nach Reload verfügbar.</p>

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
                          <div style={{ position: "relative" }}>
                            <button onClick={() => setDownloadMenuEpId(downloadMenuEpId === ep.id ? null : ep.id)} title="Episode herunterladen"
                              style={{ color: downloadMenuEpId === ep.id ? "#e8a135" : "#6e7681", fontSize: 14, padding: "6px 10px", borderRadius: 6, border: "1px solid " + (downloadMenuEpId === ep.id ? "#5a3a1a" : "transparent"), transition: "all 0.15s" }}
                              onMouseEnter={e => { e.currentTarget.style.color = "#e8a135"; e.currentTarget.style.borderColor = "#5a3a1a"; }}
                              onMouseLeave={e => { if (downloadMenuEpId !== ep.id) { e.currentTarget.style.color = "#6e7681"; e.currentTarget.style.borderColor = "transparent"; } }}>
                              ⬇
                            </button>
                            {downloadMenuEpId === ep.id && (
                              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 4, zIndex: 10, minWidth: 120, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                                <button onClick={() => handleDownload(ep, "mp3")}
                                  style={{ display: "block", width: "100%", padding: "8px 12px", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: "#c9d1d9", textAlign: "left", borderRadius: 4, transition: "background 0.1s" }}
                                  onMouseEnter={e => e.currentTarget.style.background = "#21262d"}
                                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                  ⬇ MP3
                                </button>
                                <button onClick={() => handleDownload(ep, "wav")}
                                  style={{ display: "block", width: "100%", padding: "8px 12px", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: "#c9d1d9", textAlign: "left", borderRadius: 4, transition: "background 0.1s" }}
                                  onMouseEnter={e => e.currentTarget.style.background = "#21262d"}
                                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                  ⬇ WAV
                                </button>
                              </div>
                            )}
                          </div>
                          <button onClick={() => handleDeleteEpisode(ep.id)} title="Episode löschen"
                            style={{ color: "#6e7681", fontSize: 14, padding: "6px 10px", borderRadius: 6, border: "1px solid transparent", transition: "all 0.15s" }}
                            onMouseEnter={e => { e.currentTarget.style.color = "#f85149"; e.currentTarget.style.borderColor = "#5a1e26"; }}
                            onMouseLeave={e => { e.currentTarget.style.color = "#6e7681"; e.currentTarget.style.borderColor = "transparent"; }}>
                            🗑
                          </button>
                        </div>

                        {isActive && (
                          <div style={{ borderTop: "1px solid #21262d", padding: "14px 20px" }}>
                            {/* Progress bar */}
                            <div style={{ background: "#21262d", borderRadius: 4, height: 4, marginBottom: 12, cursor: "pointer" }}
                              onClick={e => {
                                const pct = e.nativeEvent.offsetX / e.currentTarget.offsetWidth;
                                const audio = getActiveAudio();
                                if (audio) { audio.currentTime = audio.duration * pct; }
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
            <span style={{ fontSize: 11, color: "#6e7681", fontFamily: "'IBM Plex Mono', monospace" }}>Claude API + Google Cloud TTS</span>
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
