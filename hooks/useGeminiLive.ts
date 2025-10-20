import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Transcription } from '../types';
import { createPcmBlob, decode, decodeAudioData, blobToBase64 } from '../utils/audioUtils';

interface UseGeminiLiveProps {
  onTranscriptionUpdate: (transcriptions: Transcription[]) => void;
}

const FRAME_RATE = 1; // Send 1 frame per second
const JPEG_QUALITY = 0.7;

export const useGeminiLive = ({ onTranscriptionUpdate }: UseGeminiLiveProps) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  
  const sessionPromiseRef = useRef<any | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const outputGainNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<number | null>(null);

  const transcriptionsRef = useRef<Transcription[]>([]);
  const currentInputTranscriptionRef = useRef<Transcription | null>(null);
  const currentOutputTranscriptionRef = useRef<Transcription | null>(null);

  const generateId = () => Math.random().toString(36).substring(2, 9);

  const cleanup = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setLocalStream(null);

    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close();
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      outputAudioContextRef.current.close();
    }
    
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    nextStartTimeRef.current = 0;
    sessionPromiseRef.current = null;

    videoElementRef.current = null;
    canvasElementRef.current = null;

    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const stopSession = useCallback(async () => {
    if (sessionPromiseRef.current) {
      try {
        const session = await sessionPromiseRef.current;
        session.close();
      } catch (e) {
        console.error("Error closing session:", e);
      }
    }
    cleanup();
  }, [cleanup]);

  const startVideoFrameStreaming = useCallback(() => {
    if (!videoElementRef.current || !canvasElementRef.current) return;
    const videoEl = videoElementRef.current;
    const canvasEl = canvasElementRef.current;
    const ctx = canvasEl.getContext('2d');

    if (!ctx) return;

    frameIntervalRef.current = window.setInterval(() => {
      canvasEl.width = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);
      canvasEl.toBlob(
        async (blob) => {
          if (blob && sessionPromiseRef.current) {
            const base64Data = await blobToBase64(blob);
            sessionPromiseRef.current.then((session: any) => {
              session.sendRealtimeInput({
                media: { data: base64Data, mimeType: 'image/jpeg' }
              });
            });
          }
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    }, 1000 / FRAME_RATE);
  }, []);

  const startSession = useCallback(async (deviceId?: string) => {
    if (isConnected || isConnecting) return;
    setIsConnecting(true);
    transcriptionsRef.current = [];
    onTranscriptionUpdate([]);
    currentInputTranscriptionRef.current = null;
    currentOutputTranscriptionRef.current = null;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { deviceId: deviceId ? { exact: deviceId } : undefined }
      });
      mediaStreamRef.current = stream;
      setLocalStream(stream);

      videoElementRef.current = document.createElement('video');
      videoElementRef.current.srcObject = stream;
      videoElementRef.current.muted = true;
      videoElementRef.current.play();
      canvasElementRef.current = document.createElement('canvas');

      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputGainNodeRef.current = outputAudioContextRef.current.createGain();
      outputGainNodeRef.current.connect(outputAudioContextRef.current.destination);

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'You are a friendly AI video call assistant. Pay close attention to the full conversation history to provide coherent and contextually relevant responses.',
        },
        callbacks: {
          onopen: () => {
            setIsConnecting(false);
            setIsConnected(true);

            if (!inputAudioContextRef.current || !mediaStreamRef.current) return;
            
            startVideoFrameStreaming();
            
            const source = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
            scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then((session: any) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };

            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const { text } = message.serverContent.inputTranscription;
              if (!currentInputTranscriptionRef.current) {
                currentInputTranscriptionRef.current = { id: generateId(), sender: 'user', text: '', isFinal: false };
                transcriptionsRef.current = [...transcriptionsRef.current, currentInputTranscriptionRef.current];
              }
              currentInputTranscriptionRef.current.text += text;
            } else if (message.serverContent?.outputTranscription) {
              const { text } = message.serverContent.outputTranscription;
              if (!currentOutputTranscriptionRef.current) {
                currentOutputTranscriptionRef.current = { id: generateId(), sender: 'ai', text: '', isFinal: false };
                transcriptionsRef.current = [...transcriptionsRef.current, currentOutputTranscriptionRef.current];
              }
              currentOutputTranscriptionRef.current.text += text;
            }

            if (message.serverContent?.turnComplete) {
                if (currentInputTranscriptionRef.current) currentInputTranscriptionRef.current.isFinal = true;
                if (currentOutputTranscriptionRef.current) currentOutputTranscriptionRef.current.isFinal = true;
                currentInputTranscriptionRef.current = null;
                currentOutputTranscriptionRef.current = null;
            }
            onTranscriptionUpdate([...transcriptionsRef.current]);

            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current && outputGainNodeRef.current) {
              const audioContext = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);

              const decodedAudio = decode(audioData);
              const audioBuffer = await decodeAudioData(decodedAudio, audioContext, 24000, 1);
              
              const source = audioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputGainNodeRef.current);
              
              const currentSources = audioSourcesRef.current;
              source.addEventListener('ended', () => { currentSources.delete(source); });
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              currentSources.add(source);
            }
             
            if (message.serverContent?.interrupted) {
                audioSourcesRef.current.forEach(source => source.stop());
                audioSourcesRef.current.clear();
                nextStartTimeRef.current = 0;
            }
          },
          onclose: () => { cleanup(); },
          onerror: (e: ErrorEvent) => {
            console.error("Session error:", e);
            cleanup();
          },
        }
      });
    } catch (error) {
      console.error("Failed to start session:", error);
      cleanup();
    }
  }, [isConnected, isConnecting, onTranscriptionUpdate, cleanup, startVideoFrameStreaming]);
  
  const switchCamera = useCallback(async (newDeviceId: string) => {
    if (!mediaStreamRef.current) return;
  
    // Stop old video track
    const oldTrack = mediaStreamRef.current.getVideoTracks()[0];
    oldTrack.stop();
  
    // Get new video track
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: newDeviceId } },
    });
    const newTrack = newStream.getVideoTracks()[0];
  
    // Replace track in the main stream
    mediaStreamRef.current.removeTrack(oldTrack);
    mediaStreamRef.current.addTrack(newTrack);
    
    // Update local video element
    if (videoElementRef.current) {
      videoElementRef.current.srcObject = mediaStreamRef.current;
    }
    setLocalStream(mediaStreamRef.current);
  }, []);


  return { isConnecting, isConnected, startSession, stopSession, switchCamera, localStream };
};