import React, { useState, useRef, useEffect } from 'react';
import { useGeminiLive } from './hooks/useGeminiLive';
import { Transcription } from './types';
import { StartIcon, StopIcon, ReloadIcon } from './components/Icons';
import { Spinner } from './components/Spinner';

const App: React.FC = () => {
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState(0);

  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { isConnecting, isConnected, startSession, stopSession, switchCamera, localStream } = useGeminiLive({
    onTranscriptionUpdate: (newTranscriptions) => {
      setTranscriptions([...newTranscriptions]);
    },
  });

  useEffect(() => {
    const getDevices = async () => {
      // Wait for permissions to be granted
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === 'videoinput');
      setVideoDevices(videoInputs);
    };
    getDevices();
  }, []);

  useEffect(() => {
    if (localStream && mainVideoRef.current) {
      mainVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions]);

  const handleToggleSession = () => {
    if (isConnected) {
      stopSession();
    } else if (!isConnecting) {
      const deviceId = videoDevices[currentDeviceIndex]?.deviceId;
      startSession(deviceId);
    }
  };

  const handleSwitchCamera = () => {
    if (videoDevices.length > 1) {
      const nextIndex = (currentDeviceIndex + 1) % videoDevices.length;
      setCurrentDeviceIndex(nextIndex);
      const nextDeviceId = videoDevices[nextIndex].deviceId;
      if (isConnected) {
        switchCamera(nextDeviceId);
      }
    }
  };

  return (
    <div className="h-screen w-screen bg-black text-white font-sans flex flex-col relative overflow-hidden">
        {/* Main Content Area */}
        <div className="relative flex-1 flex flex-col overflow-hidden">
          {/* Main User Video */}
          <div className="relative flex-1 bg-black flex items-center justify-center">
             <video
                ref={mainVideoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              ></video>
               {/* Show a message if the call is not active */}
              {!isConnected && !isConnecting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-50 text-gray-400">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-40 w-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <p className="text-center mt-2 text-lg">Your video will appear here</p>
                  </div>
              )}
          </div>
          
          {/* Transcription Overlay */}
          <div
            ref={scrollRef}
            className="absolute bottom-24 md:bottom-4 left-4 right-4 max-h-1/4 overflow-y-auto space-y-2 p-2 z-10 [mask-image:linear-gradient(to_bottom,transparent,black_50%)]"
          >
            {transcriptions.map((t) => (
              <div key={t.id} className={`flex ${t.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-sm md:max-w-md px-4 py-2 rounded-lg text-base ${t.sender === 'user' ? 'bg-blue-600' : 'bg-gray-700'} ${!t.isFinal ? 'opacity-70' : ''}`}>
                  <p className="font-bold capitalize text-sm mb-1">{t.sender}</p>
                  <p>{t.text}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Status Indicator */}
           <div className="absolute top-4 left-4 z-20 flex items-center space-x-2 bg-black bg-opacity-50 px-3 py-1 rounded-full">
              <span className={`h-3 w-3 rounded-full ${isConnected ? 'bg-green-500' : isConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`}></span>
              <span className="text-sm">{isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Not Connected'}</span>
          </div>
        </div>
        
        <footer className="p-4 border-t border-gray-800 bg-black bg-opacity-30 flex justify-center items-center space-x-4 z-20">
          <button
            onClick={handleToggleSession}
            disabled={isConnecting}
            className={`
              w-16 h-16 rounded-full flex items-center justify-center transition-colors duration-200
              ${isConnecting ? 'bg-gray-600 cursor-not-allowed' : ''}
              ${isConnected ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}
            `}
          >
            {isConnecting ? <Spinner /> : isConnected ? <StopIcon className="w-8 h-8 text-white" /> : <StartIcon className="w-8 h-8 text-white" />}
          </button>
          {videoDevices.length > 1 && (
              <button 
                  onClick={handleSwitchCamera}
                  className="w-12 h-12 rounded-full flex items-center justify-center bg-gray-600 hover:bg-gray-700 transition-colors duration-200"
              >
                  <ReloadIcon className="w-6 h-6 text-white" />
              </button>
          )}
        </footer>
    </div>
  );
};

export default App;