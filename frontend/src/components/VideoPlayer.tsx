'use client'

import { useEffect, useRef, useState } from 'react'
import Peer from 'simple-peer'

interface VideoPlayerProps {
  peer: Peer.Instance
  username: string
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ peer, username }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoActive, setVideoActive] = useState(false)
  const [audioMuted, setAudioMuted] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [streamAttempts, setStreamAttempts] = useState(0)

  // Force stream update
  const forceStreamUpdate = (stream: MediaStream) => {
    console.log(`Forcing stream update for ${username}`);
    if (videoRef.current) {
      // First detach any existing stream
      videoRef.current.srcObject = null;
      
      // Then attach the new stream
      videoRef.current.srcObject = stream;
      
      // Force play with proper error handling
      const playVideo = () => {
        if (videoRef.current) {
          videoRef.current.play()
            .then(() => {
              console.log(`Successfully playing video for ${username}`);
              setStreamError(null);
            })
            .catch(err => {
              console.error(`Error playing video for ${username}:`, err);
              
              // If the error is about interrupted play request, try again after a short delay
              if (err.message.includes('interrupted')) {
                console.log(`Play interrupted for ${username}, retrying after delay...`);
                setTimeout(playVideo, 500);
              } else {
                setStreamError(`Error playing video: ${err.message}`);
              }
            });
        }
      };
      
      // Add event listener for loadedmetadata to ensure we play only after the video is ready
      const handleMetadata = () => {
        console.log(`Video metadata loaded for ${username}, attempting to play`);
        playVideo();
      };
      
      // Clean up previous event listener if it exists
      videoRef.current.removeEventListener('loadedmetadata', handleMetadata);
      
      // Add the event listener
      videoRef.current.addEventListener('loadedmetadata', handleMetadata);
      
      // Also try to play directly in case the metadata is already loaded
      if (videoRef.current.readyState >= 2) { // HAVE_CURRENT_DATA or higher
        console.log(`Video already has metadata for ${username}, playing immediately`);
        playVideo();
      }
    }
  };

  useEffect(() => {
    console.log(`VideoPlayer for ${username} mounted`);
    let streamCheckInterval: NodeJS.Timeout | null = null;
    
    // Handle incoming stream
    const handleStream = (stream: MediaStream) => {
      console.log(`VideoPlayer: Received stream from ${username}`, stream);
      
      if (!stream) {
        console.error(`Stream from ${username} is null or undefined`);
        setStreamError('No stream received');
        return;
      }
      
      if (videoRef.current) {
        try {
          // Check if stream has video tracks
          const hasVideo = stream.getVideoTracks().length > 0;
          const hasAudio = stream.getAudioTracks().length > 0;
          
          console.log(`Stream from ${username} has video: ${hasVideo}, audio: ${hasAudio}`);
          console.log(`Video tracks:`, stream.getVideoTracks().map(t => `${t.kind}:${t.enabled}:${t.id}`));
          
          setVideoActive(hasVideo && stream.getVideoTracks()[0].enabled);
          
          if (hasAudio) {
            setAudioMuted(!stream.getAudioTracks()[0].enabled);
          }
          
          // Clear any previous errors
          setStreamError(null);
          
          // Use the forceStreamUpdate function to handle the video element properly
          forceStreamUpdate(stream);
          
          // Clear interval if we successfully got a stream
          if (streamCheckInterval) {
            clearInterval(streamCheckInterval);
            streamCheckInterval = null;
          }
        } catch (err) {
          console.error(`Error setting stream for ${username}:`, err);
          setStreamError(`Error setting stream: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        console.error(`Video ref for ${username} is null`);
        setStreamError('Video element not available');
      }
    };

    // Set up event listeners
    peer.on('stream', handleStream);
    
    // Check if peer already has a stream - using any type since the property is not in the type definition
    const peerAny = peer as any;
    
    // Function to check for streams
    const checkForStreams = () => {
      console.log(`Checking for streams from ${username}...`);
      
      // Direct access to internal properties of simple-peer
      if (peerAny._remoteStreams && peerAny._remoteStreams.length > 0) {
        console.log(`Found existing remote streams for ${username}:`, peerAny._remoteStreams.length);
        handleStream(peerAny._remoteStreams[0]);
        return true;
      } 
      
      // Try to access the stream through the peer connection
      if (peerAny._pc && peerAny._pc.getRemoteStreams && typeof peerAny._pc.getRemoteStreams === 'function') {
        const remoteStreams = peerAny._pc.getRemoteStreams();
        if (remoteStreams && remoteStreams.length > 0) {
          console.log(`Found remote streams via _pc for ${username}`);
          handleStream(remoteStreams[0]);
          return true;
        }
      }
      
      // Try to access the stream through the RTCPeerConnection's getReceivers method
      if (peerAny._pc && peerAny._pc.getReceivers && typeof peerAny._pc.getReceivers === 'function') {
        const receivers = peerAny._pc.getReceivers();
        const videoReceiver = receivers.find((r: any) => r.track && r.track.kind === 'video');
        if (videoReceiver && videoReceiver.track) {
          console.log(`Found video track via getReceivers for ${username}`);
          // Create a new MediaStream with the track
          const newStream = new MediaStream([videoReceiver.track]);
          
          // Add audio track if available
          const audioReceiver = receivers.find((r: any) => r.track && r.track.kind === 'audio');
          if (audioReceiver && audioReceiver.track) {
            newStream.addTrack(audioReceiver.track);
          }
          
          handleStream(newStream);
          return true;
        }
      }
      
      console.log(`No existing remote streams for ${username}`);
      setStreamAttempts(prev => prev + 1);
      
      // After several attempts, try more aggressive methods
      if (streamAttempts > 2) {
        console.log(`Multiple attempts to get stream from ${username} failed, trying more aggressive methods`);
        
        // Try to trigger renegotiation
        try {
          if (typeof (peer as any).negotiate === 'function') {
            console.log(`Calling negotiate() for peer ${username}`);
            (peer as any).negotiate();
          }
          
          // Try to manually trigger a new offer if we're the initiator
          if (peerAny._pc && peerAny._initiator) {
            console.log(`Manually creating new offer for ${username}`);
            peerAny._pc.createOffer()
              .then((offer: RTCSessionDescriptionInit) => {
                return peerAny._pc.setLocalDescription(offer);
              })
              .then(() => {
                console.log(`New offer created and set for ${username}`);
              })
              .catch((err: Error) => {
                console.error(`Error creating new offer for ${username}:`, err);
              });
          }
          
          // Check connection state and try to restart ICE if needed
          if (peerAny._pc && peerAny._pc.connectionState) {
            console.log(`Connection state for ${username}: ${peerAny._pc.connectionState}`);
            if (peerAny._pc.connectionState === 'failed' || peerAny._pc.connectionState === 'disconnected') {
              console.log(`Connection is ${peerAny._pc.connectionState}, trying to restart ICE`);
              if (typeof peerAny._pc.restartIce === 'function') {
                peerAny._pc.restartIce();
              }
            }
          }
        } catch (err) {
          console.error(`Error negotiating with peer ${username}:`, err);
        }
        
        // Reset attempts counter after 10 attempts
        if (streamAttempts > 10) {
          setStreamAttempts(0);
        }
      }
      
      return false;
    };
    
    // Initial check
    const hasStream = checkForStreams();
    
    // If no stream found initially, set up an interval to keep checking
    if (!hasStream) {
      console.log(`Setting up interval to check for streams from ${username}`);
      streamCheckInterval = setInterval(() => {
        const found = checkForStreams();
        if (found && streamCheckInterval) {
          clearInterval(streamCheckInterval);
          streamCheckInterval = null;
        }
      }, 1000); // Check every second
    }
    
    // Error handling
    peer.on('error', (err) => {
      console.error(`VideoPlayer: Peer error for ${username}:`, err.message);
      setStreamError(`Peer error: ${err.message}`);
      
      // Try to recover from error by checking for streams again
      setTimeout(checkForStreams, 2000);
    });
    
    // Track changes
    peer.on('track', (track, stream) => {
      console.log(`VideoPlayer: New ${track.kind} track from ${username}`, track);
      if (track.kind === 'video') {
        setVideoActive(track.enabled);
      } else if (track.kind === 'audio') {
        setAudioMuted(!track.enabled);
      }
      
      // When receiving a new track, update the video with the full stream
      if (stream) {
        handleStream(stream);
      } else if (track) {
        // If we only got a track but no stream, create a new stream with this track
        const newStream = new MediaStream([track]);
        handleStream(newStream);
      }
    });

    // Connection established
    peer.on('connect', () => {
      console.log(`VideoPlayer: Peer connection established with ${username}`);
      // Check for streams again after connection is established
      setTimeout(checkForStreams, 500);
      
      // And check again after a bit longer to catch any delayed streams
      setTimeout(checkForStreams, 2000);
    });

    // Add a manual refresh button
    const refreshButton = document.createElement('button');
    refreshButton.textContent = 'Refresh Video';
    refreshButton.className = 'absolute top-2 right-2 bg-primary-600 text-white px-2 py-1 rounded text-xs';
    refreshButton.onclick = () => {
      console.log(`Manual refresh for ${username}`);
      checkForStreams();
    };
    
    if (videoRef.current && videoRef.current.parentElement) {
      videoRef.current.parentElement.appendChild(refreshButton);
    }

    return () => {
      // Clean up event listeners
      console.log(`Cleaning up VideoPlayer for ${username}`);
      peer.removeListener('stream', handleStream);
      peer.removeListener('error', () => {});
      peer.removeListener('track', () => {});
      peer.removeListener('connect', () => {});
      
      // Clear interval if it exists
      if (streamCheckInterval) {
        clearInterval(streamCheckInterval);
      }
      
      // Remove refresh button
      if (videoRef.current && videoRef.current.parentElement) {
        const button = videoRef.current.parentElement.querySelector('button');
        if (button) {
          button.remove();
        }
      }
    };
  }, [peer, username, streamAttempts]);

  return (
    <div className="relative bg-gray-800 rounded-lg overflow-hidden shadow-lg">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full h-full object-cover ${!videoActive ? 'hidden' : ''}`}
      />
      
      {!videoActive && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 bg-primary-600 rounded-full flex items-center justify-center">
            <span className="text-white text-3xl font-bold">{username.charAt(0).toUpperCase()}</span>
          </div>
        </div>
      )}
      
      {streamError && (
        <div className="absolute top-0 left-0 right-0 bg-red-500 text-white text-xs p-1 text-center">
          {streamError}
        </div>
      )}
      
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center mr-2">
              <span className="text-white font-bold">{username.charAt(0).toUpperCase()}</span>
            </div>
            <span className="text-white">{username}</span>
          </div>
          
          {audioMuted && (
            <div className="bg-red-500 rounded-full p-1" title="Audio muted">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default VideoPlayer 