"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Image from "next/image";
import {
  Bot, Send, Loader2, AlertCircle, UserRound, CalendarDays, MapPin, Clock,
  ExternalLink, Plane, Image as ImageIcon, ChevronLeft, ChevronRight,
  Volume2, VolumeX, Play, Pause, Square, Mic,
  Sun, Moon
} from "lucide-react";

import { motion, AnimatePresence } from "framer-motion";

// ---------- Types for itinerary payload ----------

type Role = "user" | "assistant" | "error";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  itinerary?: ItineraryPayload; // when assistant returns JSON
};

type Meta = {
  timezone: string;
  destination: string;
  start_date: string;
  end_date: string;
  days: number;
};

type Activity = {
  activity_id: string;
  title: string;
  time?: string;
  description?: string;
  images?: string[];
  booking?: string | null;
  location?: {
    name?: string;
    address?: string;
    lat?: number;
    lon?: number;
    place_id?: string;
  } | null;
};

type Travel = {
  from: string;
  to: string;
  mode: string;
  eta_minutes?: number;
  distance_km?: number;
};

type DayPlan = {
  day: number;
  date: string;
  activities: Activity[];
  travel?: Travel[];
};

type CalendarPreviewItem = {
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
};

type ItineraryPayload = {
  meta: Meta;
  itinerary: DayPlan[];
  calendar_preview?: CalendarPreviewItem[];
  next_action?: string;
};

// ---------- Helpers ----------

function stripCodeFence(input: string) {
  const trimmed = input.trim();
  // FIX: remove bogus early returns that matched "```)"
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const lines = trimmed.split(/\r?\n/);
    lines.shift();
    lines.pop();
    return lines.join("\n").trim();
  }
  const match = trimmed.match(/```(?:json)?\n([\s\S]*?)\n```/i);
  if (match) return match[1].trim();
  return trimmed;
}

function safeParseItinerary(raw: string): ItineraryPayload | null {
  try {
    const s = stripCodeFence(raw);
    const obj = JSON.parse(s);
    if (isItinerary(obj)) return obj;
    return null;
  } catch {
    return null;
  }
}

function isItinerary(x: any): x is ItineraryPayload {
  if (!x || typeof x !== "object") return false;
  if (!x.meta || !x.itinerary) return false;
  if (!Array.isArray(x.itinerary)) return false;
  return true;
}

function fmtDate(iso?: string) {
  try {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso || "";
  }
}

function googleMapsLink(loc?: Activity["location"]) {
  if (!loc) return undefined;
  if (loc.lat != null && loc.lon != null)
    return `https://maps.google.com/?q=${loc.lat},${loc.lon}`;
  if (loc.name)
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      loc.name
    )}`;
  if (loc.address)
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      loc.address
    )}`;
  return undefined;
}

// ---- Minimal Markdown renderer: **bold**, * bullets, and ### headings ----

function renderInlineBold(text: string): ReactNode {
  const out: ReactNode[] = [];
  const regex = /(\*\*|__)(.+?)\1/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const [full, , inner] = m as unknown as [string, string, string];
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong key={m.index} className="font-semibold text-zinc-100">
        {inner}
      </strong>
    );
    last = m.index + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function renderMarkdown(text: string): ReactNode {
  const lines = text.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const h3 = /^###\s+(.+)\s*$/.exec(line);
    if (h3) {
      nodes.push(
        <h3
          key={`h3-${i}`}
          className="text-[17px] sm:text-base font-semibold text-zinc-100 mb-1 mt-1 tracking-[-0.01em]"
        >
          {renderInlineBold(h3[1])}
        </h3>
      );
      i++;
      continue;
    }

    if (/^\*\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\*\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\*\s+/, ""));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 space-y-1.5 text-zinc-300 my-1">
          {items.map((it, idx) => (
            <li key={`li-${i}-${idx}`} className="leading-relaxed">
              {renderInlineBold(it)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (!line.trim()) {
      nodes.push(<div key={`br-${i}`} className="h-1" />);
      i++;
      continue;
    }

    nodes.push(
      <p key={`p-${i}`} className="text-zinc-300 leading-relaxed">
        {renderInlineBold(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-1.5">{nodes}</div>;
}

// ---------- NEW: Text-to-Speech utilities ----------

function useTTS() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ready, setReady] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = (window as any).speechSynthesis as SpeechSynthesis;

    let tries = 0;
    const loadVoices = () => {
      const v = synth.getVoices();
      if (v.length > 0 || tries > 20) {
        setVoices(v);
        setReady(true);
      } else {
        tries += 1;
        setTimeout(loadVoices, 150);
      }
    };

    synth.addEventListener("voiceschanged", loadVoices);
    loadVoices();
    return () => synth.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const speak = useCallback(
    (
      text: string,
      opts?: { voice?: SpeechSynthesisVoice; rate?: number; pitch?: number; volume?: number; onend?: () => void }
    ) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const synth = (window as any).speechSynthesis as SpeechSynthesis;
      if (!text) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (opts?.voice) u.voice = opts.voice;
      if (opts?.rate) u.rate = opts.rate;
      if (opts?.pitch) u.pitch = opts.pitch;
      if (opts?.volume != null) u.volume = opts.volume;
      u.onend = () => {
        setSpeaking(false);
        setPaused(false);
        opts?.onend?.();
      };
      u.onstart = () => setSpeaking(true);
      synth.speak(u);
    },
    []
  );

  const cancel = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = (window as any).speechSynthesis as SpeechSynthesis;
    synth.cancel();
    setSpeaking(false);
    setPaused(false);
  }, []);

  const pause = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = (window as any).speechSynthesis as SpeechSynthesis;
    if (synth.speaking && !synth.paused) {
      synth.pause();
      setPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = (window as any).speechSynthesis as SpeechSynthesis;
    if (synth.paused) {
      synth.resume();
      setPaused(false);
    }
  }, []);

  return { voices, ready, speaking, paused, speak, cancel, pause, resume };
}

function stripMarkdown(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[\*_]{1,3}([^\*_]+)[\*_]{1,3}/g, "$1")
    .replace(/^###\s+/gm, "")
    .replace(/^\*\s+/gm, "• ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function summarizeItinerary(it?: ItineraryPayload) {
  if (!it) return "";
  const { meta, itinerary } = it;
  const header = `${meta.destination}. ${fmtDate(meta.start_date)} to ${fmtDate(meta.end_date)}. ${meta.days} days.`;
  const lines: string[] = [header];
  for (const d of itinerary) {
    const date = fmtDate(d.date);
    lines.push(`Day ${d.day} — ${date}.`);
    for (const a of d.activities || []) {
      const t = a.time ? `${a.time}: ` : "";
      lines.push(`${t}${a.title}`);
    }
  }
  return lines.join(" \n");
}

// ---------- Main component (Greyscale palette) ----------

export default function Home() {
  const pendingSpeakRef = useRef<number | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hey! I’m your trip-planning buddy. Tell me where, when, and your vibe, and I’ll draft an itinerary.",
    },
  ]);

  // Theme only (light by default)
  const [lightMode, setLightMode] = useState(true);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // NEW: hydration-safe feature detection
  const [mounted, setMounted] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);

  useEffect(() => {
    setMounted(true);
    const hasWindow = typeof window !== "undefined";
    setTtsSupported(hasWindow && "speechSynthesis" in window);
    setSttSupported(
      hasWindow &&
      (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window))
    );
  }, []);

  // NEW: keep a ref to the scrollable container and drive scrolling there (not the whole page)
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- TTS state ---
  const { voices, ready, speaking, paused, speak, cancel, pause, resume } = useTTS();

  // pick Google US English voice automatically (fallback to any en-US, else first)
  const [voiceIndex, setVoiceIndex] = useState<number>(0);
  const selectedVoice = useMemo(() => voices[voiceIndex], [voices, voiceIndex]);

  useEffect(() => {
    if (!ready || !voices.length) return;
    const googleUS = voices.findIndex(
      (v) => /en-US/i.test(v.lang) && /google/i.test(v.name)
    );
    const anyUS = voices.findIndex((v) => /en-US/i.test(v.lang));
    setVoiceIndex(googleUS >= 0 ? googleUS : anyUS >= 0 ? anyUS : 0);
  }, [ready, voices]);

  // single checkbox controls everything
  const [autoRead, setAutoRead] = useState<boolean>(false);

  // --- Speech to Text (Mic) ---
  const [listening, setListening] = useState(false);
  const listeningRef = useRef(false); // keep fresh listening state for timers
  useEffect(() => { listeningRef.current = listening; }, [listening]);

  const readDelayAfterMicRef = useRef(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (!sttSupported) return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;

    let finalTranscript = ""; // session buffer

    // Reset the buffer at the start of every mic session
    rec.onstart = () => {
      finalTranscript = "";
    };

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscript += t;
        else interim += t;
      }
      const combined = (finalTranscript + " " + interim).trim();
      setMessage(combined); // replaces textarea with just this session's text
    };

    rec.onerror = () => {
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);

      // Prime TTS (Safari/iOS), but DO NOT auto-send
      try {
        const synth = (window as any).speechSynthesis as SpeechSynthesis;
        const unlock = new SpeechSynthesisUtterance(" ");
        unlock.volume = 0;
        synth.speak(unlock);
        synth.cancel();
      } catch {}

      // Stop any pending TTS; require manual Send before reading again
      if (pendingSpeakRef.current) {
        clearTimeout(pendingSpeakRef.current);
        pendingSpeakRef.current = null;
      }
      readDelayAfterMicRef.current = true;

      finalTranscript = ""; // also clear on end to avoid carryover next time
    };

    recognitionRef.current = rec;
  }, [sttSupported]);

  const toggleMic = () => {
    const rec = recognitionRef.current;
    if (!rec) return;

    // clear any scheduled speak when starting the mic to avoid late TTS
    if (!listening && pendingSpeakRef.current) {
      clearTimeout(pendingSpeakRef.current);
      pendingSpeakRef.current = null;
    }

    cancel(); // stop any ongoing TTS before (re)starting the mic

    if (listening) {
      rec.stop();
    } else {
      setMessage("");
      rec.start();
      setListening(true);
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading]);

  function autoGrow() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    const next = Math.min(ta.scrollHeight, 200);
    ta.style.height = next + "px";
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? message).trim();
    if (!text || loading) return;

    setLoading(true);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }]);
    setMessage("");

    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }

      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      // Accept both stringified output and direct object
      let output = data?.output ?? data;
      let itinerary: ItineraryPayload | null = null;
      let botText = "";

      if (typeof output === "string") {
        itinerary = safeParseItinerary(output);
        botText = itinerary ? "" : String(output).trim();
      } else if (output && typeof output === "object") {
        itinerary = isItinerary(output) ? (output as ItineraryPayload) : null;
        botText = itinerary ? "" : JSON.stringify(output, null, 2);
      }

      const nextMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: botText || (itinerary ? "Here’s your itinerary ✨" : ""),
        itinerary: itinerary || undefined,
      };

      setMessages((prev) => [...prev, nextMsg]);

      // Auto-read assistant replies if enabled (delay slightly after mic)
      if (autoRead && ttsSupported) {
        const toSpeak = [stripMarkdown(nextMsg.content), summarizeItinerary(nextMsg.itinerary)]
          .filter(Boolean)
          .join(" \n");

        if (toSpeak) {
          // clear older scheduled speak, if any
          if (pendingSpeakRef.current) {
            clearTimeout(pendingSpeakRef.current);
            pendingSpeakRef.current = null;
          }

          // use a short, reliable delay after mic (was 6000)
          const delay = readDelayAfterMicRef.current ? 6000 : 0;
          readDelayAfterMicRef.current = false;

          const scheduleSpeak = () => {
            try { (window as any).speechSynthesis?.resume?.(); } catch {}
            // don't speak while mic is listening; retry until it's off
            if (listeningRef.current) {
              pendingSpeakRef.current = window.setTimeout(scheduleSpeak, 250);
              return;
            }
            speak(toSpeak, { voice: selectedVoice });
            pendingSpeakRef.current = null;
          };

          pendingSpeakRef.current = window.setTimeout(scheduleSpeak, delay);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "error", content: `Error: ${msg}` },
      ]);
      if (autoRead && ttsSupported) speak(`An error occurred: ${msg}`, { voice: selectedVoice });
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Read-as-you-type ONLY when not listening (prevents STT/TTS fighting)
  useEffect(() => {
    if (!autoRead || listening) return;
    if (readDelayAfterMicRef.current) return; // block auto-read until user clicks Send

    const text = message.trim();
    if (!text) return;

    const h = setTimeout(() => {
      speak(text, { voice: selectedVoice });
    }, 800);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, autoRead, listening]);

  useEffect(() => {
    if (!autoRead) {
      // also clear any scheduled speak
      if (pendingSpeakRef.current) {
        clearTimeout(pendingSpeakRef.current);
        pendingSpeakRef.current = null;
      }
      cancel();
    }
  }, [autoRead, cancel]);

  // Clear any pending timers on unmount
  useEffect(() => {
    return () => {
      if (pendingSpeakRef.current) {
        clearTimeout(pendingSpeakRef.current);
        pendingSpeakRef.current = null;
      }
    };
  }, []);

  const readVisible = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const text = (el.innerText || "").replace(/\s{2,}/g, " ").trim();
    if (text) speak(text, { voice: selectedVoice });
  }, [speak, selectedVoice]);

  // when enabling the single option, read what's on screen immediately
  useEffect(() => {
    if (autoRead) readVisible();
  }, [autoRead, readVisible]);

  const lastAssistantIndex = useMemo(
    () => [...messages].reverse().findIndex((m) => m.role === "assistant"),
    [messages]
  );

  const lastAssistantMsg = useMemo(() => {
    if (lastAssistantIndex === -1) return undefined;
    const idx = messages.length - 1 - lastAssistantIndex;
    return messages[idx];
  }, [lastAssistantIndex, messages]);

  return (
<main
  className={`ui-scale min-h-screen bg-gradient-to-b from-neutral-950 to-neutral-900 p-4 text-zinc-200 ${lightMode ? "light" : ""}`}
>
      <div className="mx-auto w-full max-w-7xl">
        {/* Header */}
        {/* Navbar */}
        <nav className="mb-4 border-b border-neutral-800/60">
          <div className="mx-auto w-full max-w-7xl">
            <div className="flex h-14 items-center justify-between px-4">
              {/* Left: brand + links */}
              <div className="flex items-center gap-8">
                <a href="#" className="text-1.5xl md:text-3xl font-semibold tracking-tight text-zinc-100">VoyAIge</a>
                <div className="hidden md:flex items-center gap-6 text-sm">
                  <a href="#" className="px-2 tracking-wide text-zinc-400 hover:text-zinc-200">Features</a>
                  <a href="#" className="px-2 tracking-wide text-zinc-400 hover:text-zinc-200">Pricing</a>
                  <a href="#" className="px-2 tracking-wide text-zinc-400 hover:text-zinc-200">About</a>
                  <a href="#" className="px-2 tracking-wide text-zinc-400 hover:text-zinc-200">Contact</a>
                </div>
              </div>

              {/* Right: theme + auto-read */}
              <div className="flex items-center gap-2">
                {/* Theme toggle (light by default) */}
                <button
                  onClick={() => setLightMode((v) => !v)}
                  className="h-9 w-9 rounded-lg border border-neutral-800 bg-neutral-950/60 text-zinc-200 flex items-center justify-center hover:bg-neutral-900"
                  aria-label="Toggle theme"
                  title="Toggle theme"
                  aria-pressed={lightMode}
                >
                  {lightMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>

                {/* Auto read toggle */}
                <label className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-sm text-zinc-200">
                  <input
                    type="checkbox"
                    checked={autoRead}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAutoRead(checked);
                      if (!checked) cancel();
                    }}
                    className="accent-zinc-200"
                    aria-label="Enable auto read"
                  />
                  Auto read
                </label>
              </div>
            </div>
          </div>
        </nav>

        {/* Chat card */}
        <div className="relative flex h-[760px] flex-col rounded-2xl border border-neutral-800/60 bg-neutral-950/60 shadow-2xl elev-2 backdrop-blur transition-shadow">
          <div
            ref={scrollRef}
            className="hide-scrollbar flex-1 space-y-4 overflow-y-auto p-4 overscroll-contain"
            aria-live="polite"
          >
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`flex max-w-[90%] items-start gap-2`}>
                    {m.role !== "user" && (
                      <div
                        className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          m.role === "error" ? "bg-neutral-900/60" : "bg-neutral-900/60"
                        }`}
                        aria-hidden
                      >
                        {m.role === "error" ? (
                          <AlertCircle className="h-4 w-4 text-stone-300" />
                        ) : (
                          <Image
                            src="/assistant.png"
                            alt="Assistant"
                            width={20}
                            height={20}
                            className="h-4 w-4 object-contain"
                          />
                        )}
                      </div>
                    )}

                    <div
                      data-role={m.role}
                      className={`rounded-2xl px-4 py-3 text-[17px] leading-relaxed ${
                        m.role === "user"
                          ? "bg-neutral-950 text-zinc-100 shadow-sm"
                          : m.role === "error"
                          ? "border border-neutral-800 bg-neutral-950/70 text-zinc-300"
                          : "border border-neutral-800 bg-neutral-950/70 text-zinc-300"
                      }`}
                    >
                      {/* Render markdown (###, *, **bold**) */}
                      {renderMarkdown(m.content)}

                      {/* If itinerary present, render pretty card */}
                      {m.itinerary && (
                        <div className="mt-2">
                          <ItineraryView data={m.itinerary} />
                        </div>
                      )}
                    </div>

                    {m.role === "user" && (
                      <div className="relative top-1.5 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900" aria-hidden>
                        <UserRound className="h-4 w-4 text-zinc-300" />
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {loading && (
              <div className="flex items-start gap-2">
                <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900/60" aria-hidden>
                  <Image
                    src="/assistant.png"
                    alt="Assistant"
                    width={16}
                    height={16}
                    className="h-10 w-10 object-contain opacity-90"
                  />
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3">
                  <TypingDots />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-neutral-800/80 p-3">
            <div className="flex items-end gap-2 rounded-xl border border-neutral-800 bg-neutral-950/70 p-2 shadow-sm focus-within:ring-2 focus-within:ring-neutral-800/30">
              {/* Mic button on the LEFT of the input */}
              <button
                onClick={toggleMic}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-950 text-sm font-medium text-white shadow-sm transition active:scale-[0.99] hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={listening ? "Stop voice input" : "Start voice input"}
                title={listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={listening}
              >
                {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>

              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  autoGrow();
                }}
                onKeyDown={onKeyDown}
                placeholder="How may I assist you today?"
                rows={1}
                className="max-h-48 w-full resize-none bg-transparent px-2 py-2 text-[16px] sm:text-[17px] text-zinc-200 outline-none placeholder:text-zinc-500"
                disabled={loading}
                aria-label="Message"
              />
              <button
                onClick={() => void send()}
                disabled={loading || !message.trim()}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-neutral-950 px-3 text-sm font-medium text-white shadow-sm transition active:scale-[0.99] hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Send message"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span className="hidden sm:inline">{loading ? "Sending" : "Send"}</span>
              </button>
            </div>

            {/* Hydration-safe TTS warning render */}
            {mounted && !ttsSupported && (
              <p className="mt-2 text-center text-[12px] text-rose-400">
                Your browser does not support Text-to-Speech (Web Speech API).
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tiny CSS helpers */}
      <style jsx global>{`
  .hide-scrollbar::-webkit-scrollbar { height: 0; width: 0; }

  /* Light mode via inversion */
  .light { filter: invert(1) hue-rotate(180deg); }

  /* Re-invert media only; keep SVG icons dark */
  .light img, .light video { filter: invert(1) hue-rotate(180deg); }
  .light svg { filter: none !important; }

  /* Borders: white pre-invert => black in light mode */
  .light .border-neutral-800,
  .light .border-neutral-800\/60,
  .light .border-neutral-800\/80 { border-color: #fff !important; }

  /* --- CLICK focus: remove outlines/rings in light mode --- */
  .light *:focus { outline: none !important; box-shadow: none !important; }
  .light *:focus-within { box-shadow: none !important; } /* kills Tailwind ring */

  /* --- KEYBOARD focus: keep visible (renders black after invert) --- */
  .light *:focus-visible {
    outline: 2px solid #fff !important;
    outline-offset: 2px;
    box-shadow: none !important;
  }

  
  /* Shadow tokens: flip to white in .light so they render dark after invert */
  :root {
    --e1: 0 6px 16px rgba(0,0,0,.28);
    --e2: 0 12px 32px rgba(0,0,0,.35);
    --e3: 0 20px 56px rgba(0,0,0,.45);
  }
  .light {
    --e1: 0 6px 16px rgba(255,255,255,.28);
    --e2: 0 12px 32px rgba(255,255,255,.35);
    --e3: 0 20px 56px rgba(255,255,255,.45);
  }
  .elev-1 { box-shadow: var(--e1) !important; }
  .elev-2 { box-shadow: var(--e2) !important; }
  .elev-3 { box-shadow: var(--e3) !important; }
`}</style>

    </main>
  );
}

// ---------- Typing dots ----------

function TypingDots() {
  return (
    <div className="flex items-center gap-1 text-zinc-400">
      <span className="sr-only">Assistant is typing…</span>
      <Dot />
      <Dot delay={0.12} />
      <Dot delay={0.24} />
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="inline-block h-2 w-2 animate-bounce rounded-full bg-zinc-500"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

// ---------- Pretty itinerary renderer (STRUCTURE UNCHANGED; COLORS ONLY) ----------

function ItineraryView({ data }: { data: ItineraryPayload }) {
  const { meta } = data;
  const [dayIndex, setDayIndex] = useState(0);
  const days = data.itinerary || [];
  const current = days[dayIndex];
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
      <div className="mb-2">
        <div className="text-[17px] font-semibold text-zinc-100 tracking-[-0.01em]">
          {meta?.destination} • <span suppressHydrationWarning>{fmtDate(meta?.start_date)}</span> → <span suppressHydrationWarning>{fmtDate(meta?.end_date)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" /> {meta?.days} days
          </span>
          <span className="opacity-40">•</span>
          <span>Timezone: {meta?.timezone}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
        <button
          onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-1.5 text-xs text-zinc-200 hover:bg-neutral-900 disabled:opacity-50"
          disabled={dayIndex === 0}
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </button>
        <div className="text-sm text-zinc-300">
          Day {current?.day} of {days.length} <span className="opacity-50">•</span> <span suppressHydrationWarning>{fmtDate(current?.date || "")}</span>
        </div>
        <button
          onClick={() => setDayIndex((i) => Math.min(days.length - 1, i + 1))}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-1.5 text-xs text-zinc-200 hover:bg-neutral-900 disabled:opacity-50"
          disabled={dayIndex >= days.length - 1}
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4">{current ? <DayCard day={current} /> : null}</div>
    </div>
  );
}

function DayCard({ day }: { day: DayPlan }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="mb-2 text-sm font-semibold text-zinc-300">
        Day {day.day} • <span suppressHydrationWarning>{fmtDate(day.date)}</span>
      </div>
      <div className="space-y-3">
        {day.activities?.map((a) => (
          <ActivityItem key={a.activity_id} activity={a} />
        ))}
      </div>
    </div>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const mapUrl = googleMapsLink(activity.location || undefined);
  const imgs = activity.images || [];
  const [idx, setIdx] = useState(0);
  const hasImages = imgs.length > 0;
  const safeIndex = (n: number) => (imgs.length ? ((n % imgs.length) + imgs.length) % imgs.length : 0);
  const current = hasImages ? imgs[safeIndex(idx)] : undefined;
  const prev = () => setIdx((i) => safeIndex(i - 1));
  const next = () => setIdx((i) => safeIndex(i + 1));

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">{activity.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            {activity.time && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {activity.time}
              </span>
            )}
            {activity.location?.name && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {activity.location.name}
              </span>
            )}
          </div>
          {activity.description && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">{activity.description}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {mapUrl && (
              <a
                href={mapUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950/60 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-neutral-900"
                title="Open in Maps"
              >
                <MapPin className="h-3.5 w-3.5" /> Open in Maps <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {activity.booking && (
              <a
                href={activity.booking}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-900"
                title="Booking / Details"
              >
                <Plane className="h-3.5 w-3.5" /> Book / Details
              </a>
            )}
          </div>
        </div>

        {hasImages ? (
          <div className="group relative block shrink-0 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/40">
            <AnimatePresence mode="wait" initial={false}>
              <motion.a
                key={current}
                href={current}
                target="_blank"
                rel="noreferrer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current}
                  alt="activity"
                  className="h-56 w-96 object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </motion.a>
            </AnimatePresence>

            {imgs.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={prev}
                  aria-label="Previous photo"
                  className="absolute left-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950/70 text-zinc-200 backdrop-blur hover:bg-neutral-950/80"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={next}
                  aria-label="Next photo"
                  className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950/70 text-zinc-200 backdrop-blur hover:bg-neutral-950/80"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-neutral-950/70 px-2 py-0.5 text-[11px] leading-none text-zinc-200">
                  {safeIndex(idx) + 1}/{imgs.length}
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="flex h-40 w-64 items-center justify-center rounded-md border border-dashed border-neutral-800 bg-neutral-950/30 text-zinc-500">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
      </div>
    </div>
  );
}
