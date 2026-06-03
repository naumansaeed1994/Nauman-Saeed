/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  Volume2, 
  Trash2, 
  ChevronLeft, 
  ChevronRight, 
  ChevronUp,
  ChevronDown,
  Sparkles,
  Type,
  Clock,
  BookOpen,
  VolumeX,
  AlertCircle,
  CheckCircle,
  Cpu,
  Upload,
  RotateCw,
  RotateCcw,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const DEFAULT_SAMPLE_TEXT = `Welcome to your premium listening dashboard. Paste any text or upload a PDF document directly to begin reading with studio-quality depth.

To keep your eyes relaxed, this interface uses comfortable typography and ample negative space. Switch between 'Studio Human API' for high-fidelity cloud voices, or use the 'System Audio' toggle for local fallback speech.

When playing cloud audio, the listener automatically pre-caches upcoming sentences to ensure a continuous fluid streaming experience. You can easily adjust the playback speed, skip sentences, rewind or skip ahead using the control dock.`;

interface IndexedSentence {
  text: string;
  paragraphIndex: number;
}

export function TtsReader() {
  // Master active mode tab ('paste' Scratchpad or 'pdf' Document Reader)
  const [activeMode, setActiveMode] = useState<'paste' | 'pdf'>(() => {
    return (localStorage.getItem('ultra_tts_active_mode') as 'paste' | 'pdf') || 'paste';
  });

  // Dedicated copy/paste scratchpad state
  const [pastedText, setPastedText] = useState<string>(() => {
    return localStorage.getItem('ultra_tts_pasted_text') || DEFAULT_SAMPLE_TEXT;
  });

  // Dedicated PDF extracted text state
  const [pdfText, setPdfText] = useState<string>(() => {
    return localStorage.getItem('ultra_tts_pdf_text') || '';
  });

  // State for Uploaded PDF Url and File Name
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(() => {
    return localStorage.getItem('ultra_tts_pdf_file_name') || null;
  });

  // Scroll visibility and auto-snap back states
  const [isScrolledAway, setIsScrolledAway] = useState<boolean>(false);
  const [scrollDirectionToActive, setScrollDirectionToActive] = useState<'up' | 'down'>('up');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // State Management
  const [sentences, setSentences] = useState<IndexedSentence[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  
  // Custom states of feature sets
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [isParsingPdf, setIsParsingPdf] = useState<boolean>(false);
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [showLibraryModal, setShowLibraryModal] = useState<boolean>(false);
  const [activeWordStartIndex, setActiveWordStartIndex] = useState<number>(0);

  // Saved Sessions (Library)
  const [savedSessions, setSavedSessions] = useState<{
    id: string;
    mode: 'paste' | 'pdf';
    text: string;
    fileName: string | null;
    date: number;
  }[]>(() => {
    const saved = localStorage.getItem('ultra_tts_saved_sessions');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('ultra_tts_saved_sessions', JSON.stringify(savedSessions));
  }, [savedSessions]);

  // Engine Toggle: 'premium' (OpenAI / ElevenLabs) or 'local' (Browser SpeechSynthesis)
  const [engineMode, setEngineMode] = useState<'premium' | 'local'>(() => {
    return (localStorage.getItem('ultra_tts_engine_mode') as 'premium' | 'local') || 'premium';
  });

  // Cloud Premium settings
  const [premiumProvider, setPremiumProvider] = useState<'openai' | 'elevenlabs'>(() => {
    return (localStorage.getItem('ultra_tts_premium_provider') as 'openai' | 'elevenlabs') || 'openai';
  });

  const [premiumVoice, setPremiumVoice] = useState<string>(() => {
    return localStorage.getItem('ultra_tts_premium_voice') || 'alloy';
  });

  // Native Browser offline fallback voices
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedLocalVoiceURI, setSelectedLocalVoiceURI] = useState<string>(() => {
    return localStorage.getItem('ultra_tts_local_voice_uri') || '';
  });

  // Speed Rate State (0.6x - 2.0x)
  const [speedRate, setSpeedRate] = useState<number>(() => {
    const saved = localStorage.getItem('ultra_tts_speed_rate');
    return saved ? parseFloat(saved) : 1.0;
  });

  // Backend Key Health validation trackers
  const [apiHealth, setApiHealth] = useState<{
    loaded: boolean;
    openai: boolean;
    elevenlabs: boolean;
  }>({
    loaded: false,
    openai: false,
    elevenlabs: false
  });

  // Dynamic ElevenLabs Custom & Premade voices loaded via API Key
  const [elevenlabsVoices, setElevenlabsVoices] = useState<{ voice_id: string; name: string; category: string }[]>([]);
  const [hasLoadedElevenlabsVoices, setHasLoadedElevenlabsVoices] = useState<boolean>(false);

  // Asynchronous caching queues and state refs
  const activeSessionIdRef = useRef<number>(0);
  const sentencesRef = useRef<IndexedSentence[]>([]);
  const currentSentenceIdxRef = useRef<number>(-1);
  const activeScrollPositionRef = useRef<HTMLSpanElement | null>(null);
  
  // HTML5 audio stream handle
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  // SpeechUtterance handle for local GC protection bypass
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // High-fidelity prefetch pipeline cache lists (resolved URLs + pending Promises)
  const prefetchCacheRef = useRef<Map<number, string>>(new Map());
  const prefetchPromisesRef = useRef<Map<number, Promise<string>>>(new Map());
  const prefetchedIndicesRef = useRef<Set<number>>(new Set());

  // Input file uploading handles
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived primary active text representation
  const activeText = useMemo(() => {
    return activeMode === 'paste' ? pastedText : pdfText;
  }, [activeMode, pastedText, pdfText]);

  // Auto-persist setup profiles and states
  useEffect(() => {
    localStorage.setItem('ultra_tts_active_mode', activeMode);
    stopPlayback();
    setCurrentSentenceIndex(-1);
  }, [activeMode]);

  useEffect(() => {
    localStorage.setItem('ultra_tts_pasted_text', pastedText);
    if (activeMode === 'paste') {
      clearPrefetchCache();
    }
  }, [pastedText, activeMode]);

  useEffect(() => {
    localStorage.setItem('ultra_tts_pdf_text', pdfText);
    if (activeMode === 'pdf') {
      clearPrefetchCache();
    }
  }, [pdfText, activeMode]);

  useEffect(() => {
    if (pdfFileName) {
      localStorage.setItem('ultra_tts_pdf_file_name', pdfFileName);
    } else {
      localStorage.removeItem('ultra_tts_pdf_file_name');
    }
  }, [pdfFileName]);

  useEffect(() => {
    localStorage.setItem('ultra_tts_engine_mode', engineMode);
    clearPrefetchCache();
  }, [engineMode]);

  useEffect(() => {
    localStorage.setItem('ultra_tts_premium_provider', premiumProvider);
    clearPrefetchCache();
  }, [premiumProvider]);

  useEffect(() => {
    localStorage.setItem('ultra_tts_premium_voice', premiumVoice);
    clearPrefetchCache();
  }, [premiumVoice]);

  useEffect(() => {
    localStorage.setItem('ultra_tts_local_voice_uri', selectedLocalVoiceURI);
  }, [selectedLocalVoiceURI]);

  useEffect(() => {
    localStorage.setItem('ultra_tts_speed_rate', speedRate.toString());
    clearPrefetchCache();
  }, [speedRate]);

  // Keep voices sanitized in local selection
  useEffect(() => {
    if (!apiHealth.loaded) return;
    if (apiHealth.elevenlabs && !hasLoadedElevenlabsVoices) return;

    const openAiVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    const elevenlabsVoiceIds = elevenlabsVoices.length > 0
      ? elevenlabsVoices.map(v => v.voice_id)
      : [
          "21m00Tcm4TlvDq8ikWAM", // Rachel (US Female)
          "AZnzlk1XvdvUeBnXmlld", // Domi (US Female)
          "EXAVITQu4vr4xnSDXIFr", // Bella (US Female)
          "ErXwobaYiN019PkySvjV", // Antoni (US Male)
          "GBv7mTt0atIp3u8bJ6lh", // Thomas (US Male)
          "ODq5Z3HLgObAl8m6HqgE", // Marcus (US Male)
          "VR6A4UBYWhgESBE666XU", // Arnold (US Male)
          "pqHfZKP7ZaD6COStojSO", // Bill (US Male)
          "TX3851FmAxi1mzoGEFLW", // Liam (GB Male)
          "JbF274C2wbvOCYuTh39p", // George (GB Male)
          "Xb7hH9SSTgB667faAd9f", // Alice (GB Female)
          "N2lVSClvY4GKK9AV3Ocm", // Callum (GB Male)
          "piTKgcLEGmPEe24241g5", // Nicole (AUS Female)
          "IKne3meq5aSn9XLyUdCD"  // Charlie (AUS Male)
        ];

    if (premiumProvider === 'openai') {
      if (!openAiVoices.includes(premiumVoice)) {
        setPremiumVoice('alloy');
      }
    } else if (premiumProvider === 'elevenlabs') {
      if (!elevenlabsVoiceIds.includes(premiumVoice)) {
        setPremiumVoice('21m00Tcm4TlvDq8ikWAM');
      }
    }
  }, [premiumProvider, premiumVoice, elevenlabsVoices, hasLoadedElevenlabsVoices, apiHealth.loaded]);

  // Sync references to avoid scope closure timeouts
  useEffect(() => {
    sentencesRef.current = sentences;
  }, [sentences]);

  const checkActiveSentenceVisibility = () => {
    if (!scrollContainerRef.current || currentSentenceIndex === -1) {
      setIsScrolledAway(false);
      return;
    }
    const container = scrollContainerRef.current;
    const activeElement = container.querySelector(`#sentence-cursor-${currentSentenceIndex}`) as HTMLElement;
    if (!activeElement) return;

    const rect = activeElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const isAbove = rect.bottom < containerRect.top;
    const isBelow = rect.top > containerRect.bottom;
    const isOutOfView = isAbove || isBelow;

    setIsScrolledAway(isOutOfView);
    if (isAbove) {
      setScrollDirectionToActive('up');
    } else if (isBelow) {
      setScrollDirectionToActive('down');
    }
  };

  const scrollToActiveSentence = (smooth = true) => {
    if (currentSentenceIndex === -1) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const activeElement = container.querySelector(`#sentence-cursor-${currentSentenceIndex}`) as HTMLElement;
    if (activeElement) {
      activeElement.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'center'
      });
      setIsScrolledAway(false);
    }
  };

  useEffect(() => {
    currentSentenceIdxRef.current = currentSentenceIndex;
    
    if (activeScrollPositionRef.current) {
      activeScrollPositionRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
    
    const timer = setTimeout(() => {
      checkActiveSentenceVisibility();
    }, 100);
    return () => clearTimeout(timer);
  }, [currentSentenceIndex]);

  // Load PDF.js dependency dynamically on demand to bypass compilation errors
  const loadPdfJs = async () => {
    if ((window as any).pdfjsLib) return (window as any).pdfjsLib;
    
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        const pdfjsLib = (window as any).pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(pdfjsLib);
      };
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  };

  // PDF ingestion controller
  const handlePdfUpload = async (file: File) => {
    if (file.type !== 'application/pdf') {
      setPlaybackError("Supported formats are PDF documents only.");
      return;
    }

    setPlaybackError(null);
    setIsParsingPdf(true);

    try {
      const pdfjsLib: any = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += pageText + '\n\n';
      }

      if (fullText.trim()) {
        // Build direct PDF preview URL
        if (pdfUrl) {
          URL.revokeObjectURL(pdfUrl);
        }
        const url = URL.createObjectURL(file);
        setPdfUrl(url);
        setPdfFileName(file.name);

        setPdfText(fullText.trim());
        setActiveMode('pdf');
        stopPlayback();
        setCurrentSentenceIndex(-1);
      } else {
        setPlaybackError("Extracted outline contained no readable plain text.");
      }
    } catch (err: any) {
      console.error("PDF text extraction failed:", err);
      setPlaybackError("Could not retrieve text from the PDF file. Make sure it isn't password protected.");
    } finally {
      setIsParsingPdf(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') {
      handlePdfUpload(file);
    }
  };

  // Fetch verified active providers from our backend proxy
  const verifyBackendEngines = async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setApiHealth({
          loaded: true,
          openai: data.engines.openai,
          elevenlabs: data.engines.elevenlabs
        });
        
        if (!data.engines.openai && data.engines.elevenlabs) {
          setPremiumProvider('elevenlabs');
        }
      } else {
        setApiHealth(prev => ({ ...prev, loaded: true }));
      }
    } catch (e) {
      setApiHealth(prev => ({ ...prev, loaded: true }));
    }
  };

  useEffect(() => {
    verifyBackendEngines();
  }, []);

  // Fetch ElevenLabs voices when backend declares ElevenLabs API key is active
  useEffect(() => {
    if (apiHealth.elevenlabs) {
      fetch('/api/elevenlabs-voices')
        .then(res => {
          if (!res.ok) throw new Error("Failed to load voices");
          return res.json();
        })
        .then(data => {
          if (data && Array.isArray(data.voices)) {
            setElevenlabsVoices(data.voices);
          }
          setHasLoadedElevenlabsVoices(true);
        })
        .catch(err => {
          console.error("Failed to fetch ElevenLabs voices:", err);
          setHasLoadedElevenlabsVoices(true);
        });
    } else if (apiHealth.loaded) {
      setHasLoadedElevenlabsVoices(true);
    }
  }, [apiHealth.elevenlabs, apiHealth.loaded]);

  // Sync browsers native voices fallback list
  useEffect(() => {
    const fetchLocalVoices = () => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      const list = window.speechSynthesis.getVoices();
      
      const filtered = list.filter((v, idx, self) => 
        self.findIndex(t => t.name === v.name && t.lang === v.lang) === idx
      );

      filtered.sort((a, b) => {
        const aNat = a.name.toLowerCase().includes('natural') || a.name.toLowerCase().includes('google');
        const bNat = b.name.toLowerCase().includes('natural') || b.name.toLowerCase().includes('google');
        if (aNat && !bNat) return -1;
        if (!aNat && bNat) return 1;
        return a.lang.localeCompare(b.lang);
      });

      setSystemVoices(filtered);

      if (filtered.length > 0 && !selectedLocalVoiceURI) {
        const englishMatch = filtered.find(v => v.lang.startsWith('en'));
        if (englishMatch) {
          setSelectedLocalVoiceURI(englishMatch.voiceURI);
        } else {
          setSelectedLocalVoiceURI(filtered[0].voiceURI);
        }
      }
    };

    fetchLocalVoices();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = fetchLocalVoices;
    }
  }, [selectedLocalVoiceURI]);

  // Split standard document strings into clean paragraphs and segments
  useEffect(() => {
    const rawValue = activeText.trim();
    if (!rawValue) {
      setSentences([]);
      return;
    }

    const rawParagraphs = rawValue.split(/\n+/);
    const compiledSentences: IndexedSentence[] = [];

    rawParagraphs.forEach((paragraphVal, paragraphIdx) => {
      const trimmedPara = paragraphVal.trim();
      if (!trimmedPara) return;

      const matchedArray = trimmedPara.match(/[^.!?]+[.!?]*/g) || [trimmedPara];
      matchedArray.forEach(sentenceStr => {
        const trimmedSent = sentenceStr.trim();
        if (trimmedSent) {
          compiledSentences.push({
            text: trimmedSent,
            paragraphIndex: paragraphIdx
          });
        }
      });
    });

    setSentences(compiledSentences);
  }, [activeText]);

  // Read rate parameters evaluation
  const statistics = useMemo(() => {
    const rawTrimmed = activeText.trim();
    if (!rawTrimmed) return { characters: 0, words: 0, minutes: 0 };
    const words = rawTrimmed.split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.ceil(words / 150));
    return {
      characters: rawTrimmed.length,
      words: words,
      minutes: minutes
    };
  }, [activeText]);

  // Clear background prefetch entries
  const clearPrefetchCache = () => {
    prefetchCacheRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn("Clean prefetch cache revoke failed:", e);
      }
    });
    prefetchCacheRef.current.clear();
    prefetchPromisesRef.current.clear();
    prefetchedIndicesRef.current.clear();
  };

  // Pre-fetching worker pipeline to stream back-to-back sentences instantly
  const prefetchSentenceAtIndex = (idx: number): Promise<string> | undefined => {
    if (idx < 0 || idx >= sentencesRef.current.length) return;
    if (prefetchCacheRef.current.has(idx)) {
      return Promise.resolve(prefetchCacheRef.current.get(idx)!);
    }
    if (prefetchPromisesRef.current.has(idx)) {
      return prefetchPromisesRef.current.get(idx);
    }

    const sentenceObject = sentencesRef.current[idx];
    const queryParams = new URLSearchParams({
      text: sentenceObject.text,
      provider: premiumProvider,
      voice: premiumVoice,
      speed: speedRate.toString()
    });

    const audioStreamSource = `/api/tts?${queryParams.toString()}`;
    const currentPrefetchSessionId = activeSessionIdRef.current;

    const promise = fetch(audioStreamSource)
      .then(async (response) => {
        if (currentPrefetchSessionId !== activeSessionIdRef.current) {
          throw new Error("Prefetch cancelled: session changed");
        }
        if (!response.ok) {
          throw new Error("Prefetch response was not ok");
        }
        const blob = await response.blob();
        if (currentPrefetchSessionId !== activeSessionIdRef.current) {
          throw new Error("Prefetch cancelled: session changed");
        }
        const blobUrl = URL.createObjectURL(blob);
        prefetchCacheRef.current.set(idx, blobUrl);
        return blobUrl;
      })
      .catch((err) => {
        prefetchPromisesRef.current.delete(idx);
        throw err;
      });

    prefetchPromisesRef.current.set(idx, promise);
    return promise;
  };

  const activeBlobUrlRef = useRef<string | null>(null);

  // Stop vocal synthesis threads immediately
  const stopPlayback = () => {
    activeSessionIdRef.current++;

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.src = "";
      activeAudioRef.current = null;
    }

    if (activeBlobUrlRef.current) {
      try {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      } catch (e) {
        console.warn("Failed to revoke active object URL:", e);
      }
      activeBlobUrlRef.current = null;
    }

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      (window as any)._activeUtterance = null;
    }
    activeUtteranceRef.current = null;

    setIsPlaying(false);
    setIsPaused(false);
    setIsSynthesizing(false);
  };

  // Primary Speech Processing Driver Loop
  const playSentenceAtIndex = (idx: number) => {
    if (idx < 0 || idx >= sentences.length) {
      stopPlayback();
      setCurrentSentenceIndex(-1);
      return;
    }

    setPlaybackError(null);
    stopPlayback();
    
    const currentSessionPlayId = activeSessionIdRef.current;
    
    setCurrentSentenceIndex(idx);
    setIsPlaying(true);
    setIsPaused(false);
    setActiveWordStartIndex(0);

    const sentenceObject = sentences[idx];

    if (engineMode === 'premium') {
      const cachedUrl = prefetchCacheRef.current.get(idx);
      const pendingPromise = prefetchPromisesRef.current.get(idx);
      
      const playAudioStream = (audioUrl: string) => {
        const streamAudio = new Audio(audioUrl);
        activeAudioRef.current = streamAudio;
        setIsSynthesizing(false);

        // Adjust HTML5 speed parameter natively
        streamAudio.playbackRate = speedRate;

        // Dynamic 4-word reading track word-by-word highlighted interval updating
        streamAudio.ontimeupdate = () => {
          if (currentSessionPlayId !== activeSessionIdRef.current) return;
          const curTime = streamAudio.currentTime;
          const duration = streamAudio.duration || 1;
          const progress = curTime / duration;

          const wordsList = sentenceObject.text.split(/\s+/).filter(Boolean);
          const totalWords = wordsList.length;

          const rawIdx = Math.floor(progress * totalWords);
          const boundIdx = Math.max(0, Math.min(rawIdx, totalWords - 4));
          setActiveWordStartIndex(boundIdx);
        };

        streamAudio.oncanplaythrough = () => {
          if (currentSessionPlayId !== activeSessionIdRef.current) return;
          streamAudio.play().catch(err => {
            console.warn("Audio autoplay blocked by standard security settings:", err);
            setPlaybackError("Audio was blocked by browser autoplay rules. Toggle play again to trigger sound.");
            stopPlayback();
          });

          // PRE-FETCH EVENT OF NEIGHBOURING SEGMENTS (Fluid Continuous Streaming)
          const nextIndex = idx + 1;
          if (nextIndex < sentencesRef.current.length) {
            prefetchSentenceAtIndex(nextIndex);
          }
        };

        streamAudio.onended = () => {
          if (currentSessionPlayId === activeSessionIdRef.current) {
            const nextIndex = idx + 1;
            if (nextIndex < sentencesRef.current.length) {
              playSentenceAtIndex(nextIndex);
            } else {
              stopPlayback();
              setCurrentSentenceIndex(-1);
            }
          }
        };

        streamAudio.onerror = (e) => {
          if (currentSessionPlayId !== activeSessionIdRef.current) return;
          console.error("Audio pipeline crashed:", e);
          setPlaybackError("Audio stream timed out or format was non-compliant.");
          stopPlayback();
        };
      };

      const fetchNormal = () => {
        setIsSynthesizing(true);
        const queryParams = new URLSearchParams({
          text: sentenceObject.text,
          provider: premiumProvider,
          voice: premiumVoice,
          speed: speedRate.toString()
        });

        const audioStreamSource = `/api/tts?${queryParams.toString()}`;

        fetch(audioStreamSource)
          .then(async (response) => {
            if (currentSessionPlayId !== activeSessionIdRef.current) return;

            if (!response.ok) {
              const errorText = await response.text();
              let parsedError = "Neural voice server rejected payload request.";
              try {
                const errorObj = JSON.parse(errorText);
                parsedError = errorObj.error || parsedError;
              } catch (jsonErr) {
                parsedError = errorText || parsedError;
              }
              throw new Error(parsedError);
            }

            const blob = await response.blob();
            if (currentSessionPlayId !== activeSessionIdRef.current) return;

            const blobUrl = URL.createObjectURL(blob);
            activeBlobUrlRef.current = blobUrl;
            playAudioStream(blobUrl);
          })
          .catch((err: any) => {
            if (currentSessionPlayId !== activeSessionIdRef.current) return;
            console.error("Fetch request crashed:", err);
            setPlaybackError(err.message || "Failed to secure connection to voice generation server.");
            stopPlayback();
          });
      };

      if (cachedUrl) {
        playAudioStream(cachedUrl);
        prefetchCacheRef.current.delete(idx);
        prefetchPromisesRef.current.delete(idx);
      } else if (pendingPromise) {
        setIsSynthesizing(true);
        pendingPromise
          .then((url) => {
            if (currentSessionPlayId !== activeSessionIdRef.current) return;
            prefetchCacheRef.current.delete(idx);
            prefetchPromisesRef.current.delete(idx);
            playAudioStream(url);
          })
          .catch((err) => {
            if (currentSessionPlayId !== activeSessionIdRef.current) return;
            fetchNormal();
          });
      } else {
        fetchNormal();
      }

    } else {
      // Standard local system browser SpeechSynthesis
      const utterance = new SpeechSynthesisUtterance(sentenceObject.text);
      
      const localProfileObj = systemVoices.find(v => v.voiceURI === selectedLocalVoiceURI);
      if (localProfileObj) {
        utterance.voice = localProfileObj;
      }

      utterance.rate = speedRate;
      utterance.volume = 1.0;
      utterance.pitch = 1.0;

      // GC bypass protection
      activeUtteranceRef.current = utterance;
      if (typeof window !== 'undefined') {
        (window as any)._activeUtterance = utterance;
      }

      // Highlight estimate mapping loop for local synthesizer fallback
      let wordTimer: any = null;
      utterance.onstart = () => {
        const wordsList = sentenceObject.text.split(/\s+/).filter(Boolean);
        const totalWords = wordsList.length;
        // Assume standard WPM reading velocity to map synthetic local increments
        const millisecondsTotal = (totalWords / (150 * speedRate)) * 60 * 1000;
        const intervalStep = millisecondsTotal / totalWords;

        let elapsedStep = 0;
        wordTimer = setInterval(() => {
          elapsedStep++;
          if (elapsedStep >= totalWords) {
            clearInterval(wordTimer);
            return;
          }
          const boundIdx = Math.max(0, Math.min(elapsedStep, totalWords - 4));
          setActiveWordStartIndex(boundIdx);
        }, intervalStep);
      };

      utterance.onend = () => {
        if (wordTimer) clearInterval(wordTimer);
        if (currentSessionPlayId === activeSessionIdRef.current) {
          const nextIndex = idx + 1;
          if (nextIndex < sentencesRef.current.length) {
            playSentenceAtIndex(nextIndex);
          } else {
            stopPlayback();
            setCurrentSentenceIndex(-1);
          }
        }
      };

      utterance.onerror = (err) => {
        if (wordTimer) clearInterval(wordTimer);
        if (currentSessionPlayId !== activeSessionIdRef.current) return;
        if (err.error !== 'interrupted') {
          stopPlayback();
        }
      };

      setTimeout(() => {
        if (currentSessionPlayId === activeSessionIdRef.current && typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.speak(utterance);
        }
      }, 20);
    }
  };

  // Playback Control Toggle (Play / Pause / Resume)
  const togglePlayOrPause = () => {
    if (sentences.length === 0) return;

    if (engineMode === 'premium' && isApiKeyMissing) {
      setShowKeyModal(true);
      return;
    }

    if (isPlaying) {
      if (isPaused) {
        if (engineMode === 'premium') {
          if (activeAudioRef.current) {
            activeAudioRef.current.play().catch(err => console.error(err));
          }
        } else {
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.resume();
          }
        }
        setIsPaused(false);
      } else {
        if (engineMode === 'premium') {
          if (activeAudioRef.current) {
            activeAudioRef.current.pause();
          }
        } else {
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.pause();
          }
        }
        setIsPaused(true);
      }
    } else {
      const startIdx = currentSentenceIndex >= 0 ? currentSentenceIndex : 0;
      playSentenceAtIndex(startIdx);
    }
  };

  // Seek offset: skips forward/backward inside active sentence or segments
  const seekAudio = (offset: number) => {
    if (!isPlaying) return;
    setPlaybackError(null);

    if (engineMode === 'premium' && activeAudioRef.current) {
      const audio = activeAudioRef.current;
      const targetTime = audio.currentTime + offset;

      if (targetTime >= 0 && targetTime <= audio.duration) {
        audio.currentTime = targetTime;
      } else if (targetTime < 0) {
        if (currentSentenceIndex > 0) {
          playSentenceAtIndex(currentSentenceIndex - 1);
        } else {
          audio.currentTime = 0;
        }
      } else if (targetTime > audio.duration) {
        if (currentSentenceIndex < sentences.length - 1) {
          playSentenceAtIndex(currentSentenceIndex + 1);
        } else {
          stopPlayback();
          setCurrentSentenceIndex(-1);
        }
      }
    } else {
      if (offset > 0) {
        skipForward();
      } else {
        skipBackward();
      }
    }
  };

  const skipForward = () => {
    if (currentSentenceIndex < sentences.length - 1) {
      playSentenceAtIndex(currentSentenceIndex + 1);
    }
  };

  const skipBackward = () => {
    if (currentSentenceIndex > 0) {
      playSentenceAtIndex(currentSentenceIndex - 1);
    }
  };

  const handleSaveSession = () => {
    if (!activeText.trim()) return;
    
    // Don't save duplicates if the top session is exactly the same text
    if (savedSessions.length > 0 && savedSessions[0].text === activeText) {
      alert("This session is already saved at the top of your library.");
      return;
    }

    const newSession = {
      id: Date.now().toString(),
      mode: activeMode,
      text: activeText,
      fileName: activeMode === 'pdf' ? pdfFileName : null,
      date: Date.now()
    };
    setSavedSessions(prev => [newSession, ...prev]);
  };

  const handleClearOutput = () => {
    stopPlayback();
    if (activeMode === 'paste') {
      setPastedText("");
    } else {
      setPdfText("");
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
      setPdfFileName(null);
    }
    setCurrentSentenceIndex(-1);
    setPlaybackError(null);
  };

  useEffect(() => {
    return () => {
      stopPlayback();
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  // Filter keys status validations
  const isApiKeyMissing = useMemo(() => {
    if (engineMode === 'local') return false;
    if (premiumProvider === 'openai') {
      return !apiHealth.openai;
    }
    if (premiumProvider === 'elevenlabs') {
      return !apiHealth.elevenlabs;
    }
    return false;
  }, [engineMode, premiumProvider, apiHealth]);

  return (
    <div 
      id="tts-workspace-container" 
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center py-8 px-4 selection:bg-amber-400 selection:text-slate-950 font-sans relative overflow-x-hidden"
    >
      {/* Absolute Ambient Background Lights */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-amber-500/[0.04] rounded-full blur-[140px] pointer-events-none" />
      
      <div className="max-w-5xl w-full flex flex-col space-y-6 z-10">
        
        {/* ================= HEADER BRAND ================= */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-900">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/10 border border-amber-500/20 p-2 rounded-xl">
              <Volume2 className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">AudioBook Reader</h1>
              <p className="text-[11px] text-slate-500 font-mono">Continuous Studio-Quality Neural Voice Streaming</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLibraryModal(true)}
              className="text-[10px] font-mono uppercase tracking-wider font-semibold py-1.5 px-3 rounded-lg border bg-slate-900 border-slate-800 text-slate-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/30 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" /> Saved Sessions
            </button>
            <button
              onClick={() => {
                stopPlayback();
                setEngineMode(engineMode === 'premium' ? 'local' : 'premium');
              }}
              className={`text-[10px] font-mono uppercase tracking-wider font-semibold py-1.5 px-3 rounded-lg border transition-all cursor-pointer ${
                engineMode === 'premium' 
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' 
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              Mode: {engineMode === 'premium' ? '✨ Neural API' : '💻 Local Speech'}
            </button>
          </div>
        </header>

        {/* FEEDBACK & DIAGNOSTICS ERRORS CAPTURE PANEL */}
        {playbackError && (
          <div id="playback-error-view" className="bg-red-950/20 border border-red-500/20 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-red-200">
            <span className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-red-300">Playback Issue Identified</p>
                <p className="text-slate-400 mt-0.5">{playbackError}</p>
              </div>
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPlaybackError(null)}
                className="bg-red-900/30 hover:bg-red-900/50 border border-red-800/40 px-3 py-1.5 rounded-lg text-red-300 font-mono transition-all text-[10px] cursor-pointer"
              >
                Dismiss
              </button>
              <button
                onClick={() => {
                  setPlaybackError(null);
                  setEngineMode('local');
                  stopPlayback();
                }}
                className="bg-amber-500 text-slate-950 hover:bg-amber-400 font-semibold px-3 py-1.5 rounded-lg transition-all text-[10px] cursor-pointer animate-pulse"
              >
                Use Local Voice Fallback
              </button>
            </div>
          </div>
        )}

        {/* ================= TABS SELECTOR ================= */}
        <div className="flex bg-slate-900/50 p-1.5 rounded-2xl border border-slate-900 w-full md:w-fit self-center gap-1.5">
          <button
            onClick={() => setActiveMode('paste')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeMode === 'paste'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10'
                : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
            }`}
          >
            <Type className="w-4 h-4" />
            <span>Copy & Paste Scratchpad</span>
          </button>
          <button
            onClick={() => setActiveMode('pdf')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeMode === 'pdf'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10'
                : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>PDF Document Reader</span>
          </button>
        </div>

        {/* ================= MAIN INTERACTIVE WORKSPACE ================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* LEFT: PRIMARY DOCUMENT READER OR PASTE TEXTAREA */}
          <div className="lg:col-span-7 flex flex-col space-y-4">
            
            {activeMode === 'paste' ? (
              /* COPY & PASTE SCRATCHPAD PANEL */
              <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6 flex flex-col justify-between h-[520px] relative">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-900/60 font-mono text-[10px] tracking-wider uppercase text-slate-500">
                    <span className="flex items-center gap-1.5 font-bold text-slate-350">
                      <Type className="w-3.5 h-3.5 text-amber-500" />
                      <span>Paste Text Here</span>
                    </span>
                    {pastedText.length > 0 && (
                      <div className="flex items-center gap-4">
                        <button
                          onClick={handleSaveSession}
                          className="text-amber-500 hover:text-amber-400 flex items-center gap-1 transition-all cursor-pointer font-bold font-mono text-[9px]"
                        >
                          <BookOpen className="w-3 h-3" /> Save Session
                        </button>
                        <button
                          onClick={handleClearOutput}
                          className="text-red-400 hover:text-red-300 flex items-center gap-1 transition-all cursor-pointer font-bold font-mono text-[9px]"
                        >
                          <Trash2 className="w-3 h-3" /> Clear Text
                        </button>
                      </div>
                    )}
                  </div>

                  <textarea
                    id="document-textarea-box"
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Paste your custom documents, scripts, articles or lists of characters here..."
                    className="w-full h-[400px] bg-transparent text-slate-300 placeholder-slate-700 outline-none resize-none leading-relaxed text-sm font-sans pt-4 scrollbar-thin scrollbar-thumb-slate-900 border-0 focus:ring-0 text-left align-top"
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 border-t border-slate-900/60 pt-2.5">
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3 h-3 text-slate-600" /> {statistics.words.toLocaleString()} Words
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-600" /> ~{statistics.minutes} Min read
                  </span>
                </div>
              </div>
            ) : (
              /* PDF DOCUMENT READER PANEL (OPENED FULLY IN A PRESTIGE VIEWPORT) */
              <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6 flex flex-col justify-between h-[520px] lg:h-[650px] relative">
                <div className="flex-grow flex flex-col">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-900/60 font-mono text-[10px] tracking-wider uppercase text-slate-500">
                    <span className="flex items-center gap-1.5 font-bold text-slate-350 max-w-[65%] truncate" title={pdfFileName || 'PDF Document'}>
                      <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="truncate">{pdfFileName || 'PDF Document'}</span>
                    </span>
                    
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isParsingPdf}
                        className="text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-all cursor-pointer font-bold font-mono text-[9px] disabled:opacity-40"
                        title="Upload a PDF file to read"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{isParsingPdf ? 'Parsing...' : pdfUrl ? 'Change PDF' : 'Upload PDF'}</span>
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handlePdfUpload(f);
                        }}
                        accept="application/pdf"
                        className="hidden"
                      />

                      {pdfUrl && (
                        <>
                          <button
                            onClick={handleSaveSession}
                            className="text-amber-500 hover:text-amber-400 flex items-center gap-1 transition-all cursor-pointer font-bold font-mono text-[9px]"
                          >
                            <BookOpen className="w-3 h-3" /> Save Session
                          </button>
                          <button
                            onClick={handleClearOutput}
                            className="text-red-400 hover:text-red-300 flex items-center gap-1 transition-all cursor-pointer font-bold font-mono text-[9px]"
                          >
                            <Trash2 className="w-3 h-3" /> Clear PDF
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isParsingPdf ? (
                    <div className="flex-grow flex flex-col items-center justify-center space-y-3 text-xs font-mono text-amber-500">
                      <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      <span>Extracting complete document texts from PDF page nodes...</span>
                    </div>
                  ) : pdfUrl ? (
                    <iframe
                      id="pdf-document-viewer"
                      src={pdfUrl}
                      className="w-full flex-grow rounded-xl border border-slate-900 bg-slate-950 mt-4 h-[350px] lg:h-[480px]"
                      title="Real Document Preview"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-grow flex flex-col items-center justify-center border border-dashed border-slate-900 rounded-xl bg-slate-950/20 mt-4 cursor-pointer hover:bg-slate-900/10 transition-all p-8 text-center group"
                    >
                      <Upload className="w-10 h-10 opacity-30 group-hover:opacity-60 text-amber-500 mb-3 transition-opacity" />
                      <p className="text-xs font-mono text-slate-400 group-hover:text-amber-400 transition-colors font-semibold">
                        Drag and drop your PDF here, or click to upload
                      </p>
                      <p className="text-[10px] text-slate-600 mt-2">
                        Reads the entire document and displays the original PDF in this section for direct reading.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 border-t border-slate-900/60 pt-2.5 mt-3 shrink-0">
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3 h-3 text-slate-600" /> {statistics.words.toLocaleString()} Words
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-600" /> ~{statistics.minutes} Min read
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT SIDE: ACTIVE HIGHLIGHT TRACK SIDEBAR */}
          <div className="lg:col-span-5 flex flex-col space-y-4">
            
            <section className={`bg-slate-900/30 border border-slate-900 rounded-2xl p-6 flex flex-col justify-between relative ${
              activeMode === 'pdf' ? 'h-[520px] lg:h-[650px]' : 'h-[520px]'
            }`}>
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-900/60 font-mono text-[10px] tracking-wider uppercase text-slate-500">
                  <span>Highlighted Reading Track</span>
                  <span className="flex items-center gap-1.5 text-amber-500 font-bold">
                    {isPlaying ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                        {isPaused ? 'Paused' : 'Reading...'}
                      </>
                    ) : (
                      'Ready'
                    )}
                  </span>
                </div>

                {/* Central sentence highlighting tracking box */}
                <div 
                  ref={scrollContainerRef}
                  onScroll={checkActiveSentenceVisibility}
                  className={`overflow-y-auto pr-2 mt-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-900 ${
                    activeMode === 'pdf' ? 'h-[360px] lg:h-[480px]' : 'h-[360px]'
                  }`}
                >
                  {sentences.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-550 border border-dashed border-slate-900 rounded-xl bg-slate-950/20 py-20 p-4">
                      <VolumeX className="w-8 h-8 opacity-20 mb-2" />
                      <span className="text-xs font-mono">No document structure loaded</span>
                      <p className="text-[10px] text-slate-600 px-4 text-center mt-1">
                        {activeMode === 'paste' 
                          ? 'Paste text in the scratchpad to compile segments' 
                          : 'Load a PDF file on the left side to extract readable segments'
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="leading-relaxed text-slate-350 text-xs md:text-sm font-sans tracking-wide space-y-2">
                      {sentences.map((sent, index) => {
                        const isActive = index === currentSentenceIndex;

                        return (
                          <React.Fragment key={index}>
                            {index > 0 && sentences[index - 1].paragraphIndex !== sent.paragraphIndex && (
                              <span className="block h-3" />
                            )}

                            <span
                              ref={isActive ? activeScrollPositionRef : null}
                              onClick={() => playSentenceAtIndex(index)}
                              id={`sentence-cursor-${index}`}
                              className={`rounded-xl cursor-pointer transition-all duration-200 py-2.5 px-3 block border-l-2 ${
                                isActive 
                                  ? 'bg-amber-500/15 border-amber-500 text-amber-305 text-amber-300 font-semibold shadow-md shadow-amber-500/10 scale-[1.01]' 
                                  : 'border-transparent opacity-65 hover:opacity-100 text-slate-400 hover:bg-slate-900/30'
                              }`}
                            >
                              <span className="text-[9px] font-mono text-slate-600 mr-2 inline-block w-4 text-right">
                                {index + 1}
                              </span>
                              {sent.text}
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Floating Back to Active Sentence Indicator inside the track */}
              <AnimatePresence>
                {isScrolledAway && currentSentenceIndex !== -1 && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => scrollToActiveSentence(true)}
                    className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-amber-500 text-slate-950 font-mono text-[9px] uppercase font-bold py-2 px-3.5 rounded-full shadow-lg shadow-amber-500/30 hover:bg-amber-400 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer z-20 border border-amber-400/20 whitespace-nowrap animate-bounce"
                  >
                    {scrollDirectionToActive === 'up' ? (
                      <ChevronUp className="w-3 h-3 stroke-[3px]" />
                    ) : (
                      <ChevronDown className="w-3 h-3 stroke-[3px]" />
                    )}
                    <span>Active position</span>
                  </motion.button>
                )}
              </AnimatePresence>

              {/* Character voice dropdown and speed controller at the bottom of the right panel */}
              <div className="pt-3 border-t border-slate-900/60 space-y-3 bg-slate-950/20 rounded-xl p-3">
                <div className="flex flex-col space-y-1">
                  {engineMode === 'premium' ? (
                    <>
                      <div className="flex justify-between items-center text-[9px] uppercase font-mono tracking-wider text-slate-500">
                        <span>Studio Voice Accent</span>
                        <select
                          value={premiumProvider}
                          onChange={(e) => {
                            const prov = e.target.value as 'openai' | 'elevenlabs';
                            setPremiumProvider(prov);
                            setPremiumVoice(prov === 'openai' ? 'alloy' : '21m00Tcm4TlvDq8ikWAM');
                            stopPlayback();
                          }}
                          className="bg-slate-950 text-amber-500 border border-slate-900 px-1.5 py-0.5 rounded outline-none cursor-pointer text-[8px]"
                        >
                          <option value="elevenlabs">ElevenLabs</option>
                          <option value="openai">OpenAI</option>
                        </select>
                      </div>

                      <div className="relative">
                        <select
                          id="voice-character-dropdown"
                          value={premiumVoice}
                          onChange={(e) => {
                            setPremiumVoice(e.target.value);
                            if (isPlaying) {
                              playSentenceAtIndex(currentSentenceIndex >= 0 ? currentSentenceIndex : 0);
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-900 text-slate-300 text-[11px] rounded-lg p-2 outline-none focus:border-amber-500/50 appearance-none cursor-pointer font-mono"
                        >
                          {premiumProvider === 'elevenlabs' ? (
                            elevenlabsVoices.length > 0 ? (
                              <>
                                {(() => {
                                  const customVoices = elevenlabsVoices.filter(v => v.category !== 'premade');
                                  const premadeVoices = elevenlabsVoices.filter(v => v.category === 'premade');
                                  return (
                                    <>
                                      {customVoices.length > 0 && (
                                        <optgroup label="👤 Personal Cloned / Custom Voices">
                                          {customVoices.map(v => (
                                            <option key={v.voice_id} value={v.voice_id}>
                                              {v.name} ({v.category})
                                            </option>
                                          ))}
                                        </optgroup>
                                      )}
                                      {premadeVoices.length > 0 && (
                                        <optgroup label="✨ ElevenLabs Premade Voices">
                                          {premadeVoices.map(v => (
                                            <option key={v.voice_id} value={v.voice_id}>
                                              {v.name}
                                            </option>
                                          ))}
                                        </optgroup>
                                      )}
                                    </>
                                  );
                                })()}
                              </>
                            ) : (
                              <>
                                <optgroup label="🇺🇸 US Accents (Clear & Conversational)">
                                  <option value="21m00Tcm4TlvDq8ikWAM">Rachel (Vivid Narrator)</option>
                                  <option value="AZnzlk1XvdvUeBnXmlld">Domi (Conversational)</option>
                                  <option value="EXAVITQu4vr4xnSDXIFr">Bella (Clean, Professional)</option>
                                  <option value="ErXwobaYiN019PkySvjV">Antoni (Expressive Storyteller)</option>
                                  <option value="GBv7mTt0atIp3u8bJ6lh">Thomas (Polished Professional)</option>
                                  <option value="ODq5Z3HLgObAl8m6HqgE">Marcus (Warm Story)</option>
                                </optgroup>
                                <optgroup label="🇬🇧 GB Accents (British Delivery)">
                                  <option value="TX3851FmAxi1mzoGEFLW">Liam (Clear Professional)</option>
                                  <option value="JbF274C2wbvOCYuTh39p">George (Warm Narrative)</option>
                                </optgroup>
                              </>
                            )
                          ) : (
                            <>
                              <optgroup label="🇺🇸 OpenAI US Accents">
                                <option value="alloy">Alloy (Polished Neutral)</option>
                                <option value="echo">Echo (Crisp Warm Male)</option>
                                <option value="onyx">Onyx (Deep Immersive Tone)</option>
                              </optgroup>
                            </>
                          )}
                        </select>
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-[8px]">
                          ▼
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="text-[9px] uppercase font-mono tracking-wider text-slate-500">
                        Local Voice Profile
                      </label>
                      <div className="relative">
                        <select
                          value={selectedLocalVoiceURI}
                          onChange={(e) => {
                            setSelectedLocalVoiceURI(e.target.value);
                            if (isPlaying) {
                              playSentenceAtIndex(currentSentenceIndex >= 0 ? currentSentenceIndex : 0);
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-900 text-slate-300 text-xs rounded-xl p-2.5 outline-none appearance-none cursor-pointer"
                        >
                          {systemVoices.length === 0 ? (
                            <option>Retrieving native profiles...</option>
                          ) : (
                            systemVoices.map(v => (
                              <option key={v.voiceURI} value={v.voiceURI}>
                                {v.name} ({v.lang})
                              </option>
                            ))
                          )}
                        </select>
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-[8px]">
                          ▼
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex flex-col space-y-1">
                  <div className="flex justify-between items-center text-[9px] font-mono uppercase tracking-wider text-slate-500">
                    <span>Pace Rate</span>
                    <strong className="text-amber-500">{speedRate.toFixed(2)}x</strong>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.05"
                    value={speedRate}
                    onChange={(e) => setSpeedRate(parseFloat(e.target.value))}
                    className="w-full accent-amber-500 h-1 bg-slate-950 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>
            </section>
          </div>

        </div>

        {/* ================= SIMPLIFIED ULTRA CONTROL DECK ================= */}
        <section id="audio-control-deck" className="bg-slate-900/20 border border-slate-900 p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center justify-between shadow-lg">
          
          {/* Seek controls and sentence triggers */}
          <div className="flex items-center gap-2 w-full md:w-auto justify-center">
            
            {/* 10s Rewind button */}
            <button
              onClick={() => seekAudio(-10)}
              disabled={!isPlaying}
              className="bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white p-3 rounded-xl border border-slate-900 transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              title="Rewind 10 seconds"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] font-mono font-bold">-10s</span>
            </button>

            {/* Skip Backward sentence */}
            <button
              onClick={skipBackward}
              disabled={currentSentenceIndex <= 0}
              className="bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white p-3 rounded-xl border border-slate-900 transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
              title="Previous Sentence"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Main Play / Pause Button with direct resume */}
            <button
              onClick={togglePlayOrPause}
              disabled={sentences.length === 0}
              className="bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-600 hover:to-amber-500 text-slate-950 px-8 py-3 rounded-xl font-bold flex items-center gap-2 cursor-pointer transition-all active:scale-95 shadow-md shadow-amber-500/10 text-xs tracking-wider uppercase disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isSynthesizing ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Synthesizing...</span>
                </>
              ) : isPlaying && !isPaused ? (
                <>
                  <Pause className="w-3.5 h-3.5 text-slate-950 fill-slate-950" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-slate-950 fill-slate-950" />
                  <span>{isPaused ? 'Resume' : 'Listen'}</span>
                </>
              )}
            </button>

            {/* Skip Forward sentence */}
            <button
              onClick={skipForward}
              disabled={currentSentenceIndex >= sentences.length - 1}
              className="bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white p-3 rounded-xl border border-slate-900 transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
              title="Next Sentence"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* 30s Forward trigger */}
            <button
              onClick={() => seekAudio(30)}
              disabled={!isPlaying}
              className="bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white p-3 rounded-xl border border-slate-900 transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              title="Skip 30 seconds forward"
            >
              <span className="text-[10px] font-mono font-bold">+30s</span>
              <RotateCw className="w-3.5 h-3.5 text-slate-500" />
            </button>

            {/* Halt stop */}
            {isPlaying && (
              <button
                onClick={stopPlayback}
                className="bg-red-950/20 text-red-500 hover:bg-red-950 hover:text-red-400 p-3 rounded-xl border border-red-900/30 transition-all cursor-pointer"
                title="Halt streaming playback"
              >
                <Square className="w-3.5 h-3.5 fill-red-500" />
              </button>
            )}
          </div>

          <div className="text-[10px] font-mono text-slate-600 font-semibold text-center md:text-right">
            Sentence {currentSentenceIndex >= 0 ? currentSentenceIndex + 1 : 0} of {sentences.length}
          </div>

        </section>

      </div>

      {/* KEY CONFIGURATION MODAL OVERLAY */}
      <AnimatePresence>
        {showKeyModal && (
          <div id="setup-keys-modal" className="fixed inset-0 min-h-screen w-full z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl space-y-5"
            >
              <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Setup Neural Voices</h3>
              </div>

              <div className="space-y-3 text-xs leading-relaxed text-slate-400">
                <p>
                  To secure crystal-clear studio acoustics with natural breathing tones, connect your professional keys:
                </p>
                <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 space-y-2">
                  <p className="font-semibold text-amber-400 font-mono text-[10px] tracking-wider uppercase">
                    Setup Directions:
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-450 text-[11px]">
                    <li>Open workspace <strong className="text-white">Settings</strong> from upper toolbar.</li>
                    <li>Add <code className="text-amber-300 font-mono font-bold bg-amber-500/10 px-1 rounded">OPENAI_API_KEY</code> or <code className="text-amber-300 font-mono font-bold bg-amber-500/10 px-1 rounded">ELEVENLABS_API_KEY</code>.</li>
                    <li>Keys are validated instantly for high-fidelity audio streams.</li>
                  </ol>
                </div>
                <p className="text-[10px] text-slate-500">
                  Using local PC offline fallbacks sounds robotic as browsers rely on dusty native synthesizer firmware.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowKeyModal(false);
                    setEngineMode('local');
                    setTimeout(() => {
                      playSentenceAtIndex(currentSentenceIndex >= 0 ? currentSentenceIndex : 0);
                    }, 50);
                  }}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-4 rounded-xl transition-all cursor-pointer text-[11px] uppercase tracking-wider text-center"
                >
                  Local Fallback
                </button>
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="flex-1 bg-slate-950 hover:bg-slate-800 text-slate-350 border border-slate-800 py-2.5 px-4 rounded-xl transition-all cursor-pointer text-[11px] uppercase tracking-wider text-center"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SAVED SESSIONS LIBRARY MODAL */}
      <AnimatePresence>
        {showLibraryModal && (
          <div className="fixed inset-0 min-h-screen w-full z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 max-w-2xl w-full shadow-2xl flex flex-col h-[75vh]"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-amber-500" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Saved Sessions Library</h3>
                </div>
                <button
                  onClick={() => setShowLibraryModal(false)}
                  className="text-slate-400 hover:text-white transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 opacity-0 pointer-events-none" />
                  <span className="sr-only">Close</span>
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-800 pr-2">
                {savedSessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-3">
                    <BookOpen className="w-8 h-8 opacity-20" />
                    <p className="text-xs font-mono">Your library is currently empty.</p>
                  </div>
                ) : (
                  savedSessions.map((session) => (
                    <div key={session.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 group hover:border-slate-700 transition-all">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {session.mode === 'pdf' ? (
                            <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          ) : (
                            <Type className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          )}
                          <p className="text-xs font-bold text-slate-300 truncate">
                            {session.fileName || 'Pasted Text Scratchpad'}
                          </p>
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono truncate mb-2">
                          {new Date(session.date).toLocaleString()}
                        </p>
                        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                          {session.text.substring(0, 150)}...
                        </p>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                          onClick={() => {
                            setActiveMode(session.mode);
                            if (session.mode === 'paste') {
                              setPastedText(session.text);
                            } else {
                              setPdfText(session.text);
                              if (session.fileName) {
                                setPdfFileName(session.fileName);
                              }
                            }
                            setShowLibraryModal(false);
                            stopPlayback();
                            setCurrentSentenceIndex(-1);
                          }}
                          className="flex-1 sm:flex-none bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20 px-4 py-2 rounded-lg transition-all cursor-pointer text-[10px] uppercase font-bold font-mono tracking-wider"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => {
                            setSavedSessions(prev => prev.filter(s => s.id !== session.id));
                          }}
                          className="p-2 bg-red-950/20 text-red-500 hover:bg-red-900 border border-red-900/30 hover:text-red-400 rounded-lg transition-all cursor-pointer"
                          title="Delete Session"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-4 border-t border-slate-800 shrink-0 mt-auto">
                <button
                  onClick={() => setShowLibraryModal(false)}
                  className="w-full bg-slate-950 hover:bg-slate-800 text-slate-350 border border-slate-800 py-3 rounded-xl transition-all cursor-pointer text-[11px] uppercase tracking-wider text-center font-bold"
                >
                  Close Library
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
