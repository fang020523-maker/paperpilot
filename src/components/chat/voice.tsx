"use client";

/**
 * 语音输入（Web Speech API）+ 回答朗读（SpeechSynthesis）
 * 零依赖、纯浏览器能力 —— 多模态交互（赛题加分项）
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function VoiceInput({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const bufRef = useRef("");

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    setSupported(true);
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let last = "";
      for (let i = 0; i < e.results.length; i++) {
        last += e.results[i][0].transcript;
      }
      bufRef.current = last;
    };
    rec.onend = () => {
      setListening(false);
      if (bufRef.current.trim()) onTranscript(bufRef.current.trim());
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    };
  }, [onTranscript]);

  if (!supported) return null;

  const toggle = () => {
    if (!recRef.current) return;
    if (listening) {
      recRef.current.stop();
    } else {
      bufRef.current = "";
      try {
        recRef.current.start();
        setListening(true);
      } catch {
        /* already started */
      }
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-8 rounded-xl", listening && "text-destructive animate-pulse")}
      onClick={toggle}
      title={listening ? "停止语音输入（自动填入）" : "语音输入（中文）"}
    >
      <Mic className="size-4" />
    </Button>
  );
}

export function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const speak = () => {
    if (!("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const clean = text.replace(/\[\d+\]/g, "").replace(/[#*`>|]/g, "").slice(0, 800);
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "zh-CN";
    u.rate = 1.05;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      onClick={speak}
      title={speaking ? "停止朗读" : "朗读回答"}
    >
      {speaking ? <VolumeX className="size-3.5 text-primary" /> : <Volume2 className="size-3.5 text-muted-foreground" />}
    </Button>
  );
}
