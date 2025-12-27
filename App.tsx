
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Peer } from 'peerjs';
import { SUPPORTED_LANGUAGES } from './types';
import LanguageSelector from './components/LanguageSelector';
import VoiceVisualizer from './components/VoiceVisualizer';
import { createBlob, decode, decodeAudioData } from './utils/audioUtils';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

const App: React.FC = () => {
  // UI State
  const [roomId, setRoomId] = useState<string | null>(null);
  const [myLang, setMyLang] = useState('en-US');
  const [theirLang, setTheirLang] = useState('hi-IN');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);

  // Connection Refs
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  
  // Audio Pipeline Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) setRoomId(hash);
  }, []);

  const generateRoom = () => {
    const newId = Math.random().toString(36).substring(2, 11);
    window.location.hash = newId;
    setRoomId(newId);
  };

  const cleanup = () => {
    if (sessionRef.current) try { sessionRef.current.close(); } catch(e) {}
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (peerRef.current) peerRef.current.destroy();
    if (audioContextRef.current) audioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
    
    setIsConnected(false);
    setIsConnecting(false);
    setIsLocalSpeaking(false);
    setIsRemoteSpeaking(false);
  };

  const startTranslationBridge = async (remoteStream: MediaStream) => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

    const sourceLang = SUPPORTED_LANGUAGES.find(l => l.code === theirLang)?.name || 'Foreign Language';
    const targetLang = SUPPORTED_LANGUAGES.find(l => l.code === myLang)?.name || 'My Language';

    const sessionPromise = ai.live.connect({
      model: MODEL_NAME,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        systemInstruction: `You are a real-time speech-to-speech translator. 
        Listen to the audio input which is in ${sourceLang}. 
        Translate it IMMEDIATELY and accurately into ${targetLang}. 
        Output ONLY the translated speech. 
        Preserve the speaker's emotional tone.`,
      },
      callbacks: {
        onopen: () => {
          if (!audioContextRef.current) return;
          const source = audioContextRef.current.createMediaStreamSource(remoteStream);
          const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
          
          processor.onaudioprocess = (e) => {
            const data = e.inputBuffer.getChannelData(0);
            const volume = data.reduce((a, b) => a + Math.abs(b), 0) / data.length;
            setIsRemoteSpeaking(volume > 0.015);
            
            sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(data) }));
          };
          source.connect(processor);
          processor.connect(audioContextRef.current.destination);
        },
        onmessage: async (msg: LiveServerMessage) => {
          const audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (audio && outputAudioContextRef.current) {
            const ctx = outputAudioContextRef.current;
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
            const buffer = await decodeAudioData(decode(audio), ctx, 24000, 1);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buffer.duration;
          }
        },
        onerror: (e) => { console.error('AI Error:', e); cleanup(); },
      }
    });

    sessionRef.current = await sessionPromise;
  };

  const initiateCall = async () => {
    if (!process.env.API_KEY) {
      setError("API Key missing. Please check configuration.");
      return;
    }
    setIsConnecting(true);
    
    try {
      // Get local mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      // Monitor local volume for visualizer
      const localCtx = new AudioContext();
      const localSource = localCtx.createMediaStreamSource(stream);
      const localProcessor = localCtx.createScriptProcessor(2048, 1, 1);
      localProcessor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        const vol = data.reduce((a, b) => a + Math.abs(b), 0) / data.length;
        setIsLocalSpeaking(vol > 0.015);
      };
      localSource.connect(localProcessor);
      localProcessor.connect(localCtx.destination);

      // Setup PeerJS
      const peer = new Peer(`${roomId}-${Math.random().toString(36).substr(2, 5)}`);
      peerRef.current = peer;

      peer.on('open', (id) => {
        console.log('Peer connected with ID:', id);
        // Call the other side
        // Try calling the "host" version of the room ID
        const conn = peer.call(`${roomId}-main`, stream);
        
        // If we are the first one, we act as host
        if (!conn) {
          // This logic is simplified: PeerJS doesn't have "rooms", so we use predictable IDs
        }
      });

      // Handle being the receiver (host)
      const hostPeer = new Peer(`${roomId}-main`);
      hostPeer.on('open', () => console.log('Hosting room:', roomId));
      hostPeer.on('call', (call) => {
        call.answer(stream);
        call.on('stream', (remoteStream) => {
          setIsConnected(true);
          setIsConnecting(false);
          startTranslationBridge(remoteStream);
        });
      });

      // Handle outgoing call response
      peer.on('call', (call) => {
        call.answer(stream);
        call.on('stream', (remoteStream) => {
          setIsConnected(true);
          setIsConnecting(false);
          startTranslationBridge(remoteStream);
        });
      });

    } catch (err: any) {
      setError(err.message || "Failed to start call");
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      {!roomId ? (
        <div className="glass p-12 rounded-[40px] w-full max-w-lg text-center animate-in fade-in slide-in-from-bottom-8 duration-1000">
          <div className="mb-8 relative inline-block">
            <div className="absolute -inset-4 bg-indigo-500/20 rounded-full blur-2xl animate-pulse" />
            <div className="w-24 h-24 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-3xl flex items-center justify-center relative shadow-2xl">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-4">BabelCall AI</h1>
          <p className="text-slate-400 mb-10 text-lg">Real-time translated voice calls. No matter the language, you're understood.</p>
          <button
            onClick={generateRoom}
            className="w-full bg-indigo-600 hover:bg-indigo-500 py-5 rounded-2xl font-bold text-xl transition-all hover:scale-105 active:scale-95 shadow-xl shadow-indigo-500/20"
          >
            Create Invite Link
          </button>
        </div>
      ) : (
        <div className="w-full max-w-5xl animate-in fade-in duration-700">
          {/* Dashboard Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12 glass p-6 rounded-3xl">
            <div>
              <h2 className="text-2xl font-bold text-indigo-400"># {roomId}</h2>
              <p className="text-slate-400 text-sm">Room is private and encrypted</p>
            </div>
            <div className="flex gap-3 w-full md:w-auto">
              <button
                onClick={() => { navigator.clipboard.writeText(window.location.href); alert("Link Copied!"); }}
                className="flex-1 md:flex-none px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-medium transition-all flex items-center justify-center gap-2 border border-white/10"
              >
                Copy Link
              </button>
              <button onClick={() => window.location.hash = ''} className="px-6 py-3 text-slate-400 hover:text-white transition-colors">Exit</button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
            {/* My Side */}
            <div className="glass p-8 rounded-[40px] flex flex-col gap-8 relative overflow-hidden group">
              <div className={`absolute inset-0 bg-indigo-600/5 transition-opacity duration-500 ${isLocalSpeaking ? 'opacity-100' : 'opacity-0'}`} />
              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-8">
                  <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-slate-600'}`} />
                  <h3 className="text-xl font-bold">You (Local)</h3>
                </div>
                <LanguageSelector label="I am speaking" selectedCode={myLang} onSelect={setMyLang} disabled={isConnected} />
              </div>
              <div className="flex-1 flex flex-center items-center justify-center min-h-[200px]">
                 <div className={`w-32 h-32 rounded-full border-2 border-indigo-500/30 flex items-center justify-center transition-all duration-500 ${isLocalSpeaking ? 'scale-110 border-indigo-500' : 'scale-100'}`}>
                    <div className={`w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center ${isLocalSpeaking ? 'animate-pulse' : ''}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                 </div>
              </div>
            </div>

            {/* Peer Side */}
            <div className="glass p-8 rounded-[40px] flex flex-col gap-8 relative overflow-hidden group border-indigo-500/20 border-2">
              <div className={`absolute inset-0 bg-purple-600/10 transition-opacity duration-500 ${isRemoteSpeaking ? 'opacity-100' : 'opacity-0'}`} />
              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-8">
                  <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-indigo-500 animate-pulse' : 'bg-slate-600'}`} />
                  <h3 className="text-xl font-bold">Peer (Remote)</h3>
                </div>
                <LanguageSelector label="I want to hear them in" selectedCode={theirLang} onSelect={setTheirLang} disabled={isConnected} />
              </div>
              <div className="flex-1 flex flex-col items-center justify-center min-h-[200px]">
                {isConnected ? (
                  <>
                    <div className="w-32 h-32 rounded-full bg-indigo-600 flex items-center justify-center shadow-2xl shadow-indigo-500/40 relative">
                      {isRemoteSpeaking && <div className="absolute inset-0 voice-ripple bg-indigo-500 rounded-full" />}
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                    <div className="mt-8 w-full">
                      <VoiceVisualizer isActive={isRemoteSpeaking} />
                    </div>
                  </>
                ) : (
                  <div className="text-center">
                    <div className="w-24 h-24 rounded-full bg-slate-800/50 flex items-center justify-center mx-auto mb-4 border border-dashed border-slate-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <p className="text-slate-500">Waiting for peer...</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-12 flex justify-center">
            {error && <div className="absolute top-8 p-4 bg-red-500/20 border border-red-500/50 rounded-2xl text-red-200 mb-4">{error}</div>}
            
            {!isConnected ? (
              <button
                disabled={isConnecting}
                onClick={initiateCall}
                className="px-12 py-6 bg-green-600 hover:bg-green-500 text-white rounded-3xl font-bold text-2xl transition-all shadow-2xl shadow-green-600/30 flex items-center gap-4 active:scale-95 disabled:opacity-50"
              >
                {isConnecting ? (
                  <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    Start Real-Time Session
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={cleanup}
                className="px-12 py-6 bg-red-600 hover:bg-red-500 text-white rounded-3xl font-bold text-2xl transition-all shadow-2xl shadow-red-600/30 flex items-center gap-4 active:scale-95"
              >
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                End Translation Call
              </button>
            )}
          </div>
        </div>
      )}
      
      <div className="fixed bottom-8 left-8 flex items-center gap-2 px-4 py-2 glass rounded-full text-xs text-slate-400">
        <div className="w-2 h-2 bg-green-500 rounded-full" />
        Gemini 2.5 Flash native-audio-bridge
      </div>
    </div>
  );
};

export default App;
