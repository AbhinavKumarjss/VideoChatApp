'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import Peer from 'simple-peer'
import VideoPlayer from '@/components/VideoPlayer'
import Controls from '@/components/Controls'

interface PeerConnection {
  peerId: string
  peer: Peer.Instance
  username: string
}

export default function Room() {
  const params = useParams()
  const searchParams = useSearchParams()
  const roomId = params.roomId as string
  const username = searchParams.get('username') || 'Anonymous'
  
  const [socket, setSocket] = useState<Socket | null>(null)
  const [myStream, setMyStream] = useState<MediaStream | null>(null)
  const [peers, setPeers] = useState<PeerConnection[]>([])
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [participants, setParticipants] = useState<{id: string, username: string}[]>([])
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [messages, setMessages] = useState<{sender: string, content: string, time: string}[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [connectionStatus, setConnectionStatus] = useState('connecting')

  const peersRef = useRef<PeerConnection[]>([])
  const myVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    // Connect to socket server
    // Ensure we always have a string URL
    const socketUrl: string = 'http://localhost:5000';
    console.log('Connecting to socket server at:', socketUrl);
    
    // Create a single socket instance
    const newSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
      autoConnect: false // Don't connect automatically
    });
    
    // Set up event listeners before connecting
    newSocket.on('connect', () => {
      console.log('Socket connected successfully with ID:', newSocket.id);
      setConnectionStatus('connected');
      
      // Only join room after successful connection
      console.log(`Joining room ${roomId} as ${username}`);
      newSocket.emit('join-room', { roomId, username });
      
      // Set up a ping interval to check connection
      const pingInterval = setInterval(() => {
        if (newSocket.connected) {
          console.log('Pinging server...');
          newSocket.emit('ping', (response: any) => {
            console.log('Ping response:', response);
            if (response && response.status === 'ok') {
              setConnectionStatus('connected');
            }
          });
        } else {
          console.log('Socket disconnected, attempting to reconnect...');
          newSocket.connect();
        }
      }, 15000); // Check every 15 seconds
      
      return () => clearInterval(pingInterval);
    });
    
    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setConnectionStatus('failed');
    });
    
    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setConnectionStatus('connecting');
      
      // Attempt to reconnect if not intentionally closed
      if (reason !== 'io client disconnect') {
        setTimeout(() => {
          console.log('Attempting to reconnect...');
          newSocket.connect();
        }, 2000);
      }
    });
    
    // Now connect
    newSocket.connect();
    setSocket(newSocket);

    // Get user media with higher quality
    navigator.mediaDevices.getUserMedia({ 
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
        frameRate: { ideal: 30 }
      }, 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    })
      .then(stream => {
        console.log('Got media stream with tracks:', stream.getTracks().map(t => `${t.kind}:${t.enabled}:${t.id}`).join(', '));
        setMyStream(stream);
        if (myVideoRef.current) {
          myVideoRef.current.srcObject = stream;
        }

        // Set up socket event listeners for room interactions
        newSocket.on('room-users', (users) => {
          console.log('Received room users:', users);
          setParticipants(users);
          
          // If we're getting room users but have no peers, we might need to reconnect to existing users
          if (users.length > 1 && peersRef.current.length === 0) {
            console.log('Detected other users but no peer connections, requesting reconnection');
            newSocket.emit('request-reconnection', { roomId });
          }
          
          // Also check if we're missing any peer connections for users in the room
          const missingPeers = users.filter((user: {id: string, username: string}) => 
            user.id !== newSocket.id && // Not ourselves
            !peersRef.current.some(p => p.peerId === user.id) // Not already connected
          );
          
          if (missingPeers.length > 0) {
            console.log(`Missing peer connections for ${missingPeers.length} users, requesting reconnection`);
            newSocket.emit('request-reconnection', { roomId });
            
            // Also directly initiate connections to missing peers
            missingPeers.forEach((user: {id: string, username: string}) => {
              console.log(`Directly initiating connection to ${user.username} (${user.id})`);
              const peer = createPeer(user.id, newSocket.id || '', stream, user.username);
              
              peersRef.current.push({
                peerId: user.id,
                peer,
                username: user.username
              });
              
              setPeers(prevPeers => [...prevPeers, { peerId: user.id, peer, username: user.username }]);
            });
          }
          
          // Check for stale peer connections (peers that are no longer in the room)
          const stalePeers = peersRef.current.filter(p => 
            !users.some((user: {id: string}) => user.id === p.peerId)
          );
          
          if (stalePeers.length > 0) {
            console.log(`Found ${stalePeers.length} stale peer connections, cleaning up`);
            stalePeers.forEach(p => {
              console.log(`Destroying stale peer connection with ${p.username} (${p.peerId})`);
              p.peer.destroy();
            });
            
            peersRef.current = peersRef.current.filter(p => !stalePeers.some(sp => sp.peerId === p.peerId));
            setPeers(prevPeers => prevPeers.filter(p => !stalePeers.some(sp => sp.peerId === p.peerId)));
          }
        });

        // Handle ICE candidates
        newSocket.on('ice-candidate', ({ candidate, from }) => {
          console.log(`Received ICE candidate from ${from}`);
          
          // Find the peer to send the candidate to
          const peerObj = peersRef.current.find(p => p.peerId === from);
          
          if (peerObj) {
            try {
              const peerAny = peerObj.peer as any;
              if (peerAny._pc && typeof peerAny._pc.addIceCandidate === 'function') {
                peerAny._pc.addIceCandidate(new RTCIceCandidate(candidate))
                  .then(() => {
                    console.log(`Added ICE candidate for peer ${from}`);
                  })
                  .catch((err: Error) => {
                    console.error(`Error adding ICE candidate for peer ${from}:`, err);
                  });
              }
            } catch (err) {
              console.error(`Error handling ICE candidate for peer ${from}:`, err);
            }
          } else {
            console.log(`No peer found for ICE candidate from ${from}`);
          }
        });

        newSocket.on('user-joined', (payload) => {
          console.log(`User joined: ${payload.username} (${payload.callerID})`);
          
          // Create a peer for the new user
          const peer = createPeer(payload.callerID, newSocket.id || '', stream, payload.username);
          
          peersRef.current.push({
            peerId: payload.callerID,
            peer,
            username: payload.username
          });
          
          setPeers(prevPeers => [...prevPeers, { peerId: payload.callerID, peer, username: payload.username }]);
        });

        newSocket.on('receiving-returned-signal', (payload) => {
          console.log(`Received returned signal from ${payload.id}`);
          
          const peerObj = peersRef.current.find(p => p.peerId === payload.id);
          if (peerObj) {
            console.log(`Found peer for ${payload.id}, signaling`);
            peerObj.peer.signal(payload.signal);
          } else {
            console.log(`No peer found for ${payload.id}, cannot signal`);
          }
        });
        
        newSocket.on('receiving-signal', (payload) => {
          console.log(`Received signal from ${payload.username} (${payload.callerID})`);
          
          // Check if we already have this peer
          const existingPeer = peersRef.current.find(p => p.peerId === payload.callerID);
          if (existingPeer) {
            console.log(`Already have a peer for ${payload.callerID}, destroying old one`);
            existingPeer.peer.destroy();
            peersRef.current = peersRef.current.filter(p => p.peerId !== payload.callerID);
            setPeers(prevPeers => prevPeers.filter(p => p.peerId !== payload.callerID));
          }
          
          // Create a new peer for the caller
          const peer = addPeer(payload.signal, payload.callerID, stream, payload.username);
          
          peersRef.current.push({
            peerId: payload.callerID,
            peer,
            username: payload.username
          });
          
          setPeers(prevPeers => [...prevPeers, { peerId: payload.callerID, peer, username: payload.username }]);
          
          // Send signal back to the caller
          newSocket.emit('returning-signal', { signal: peer.signal, callerID: payload.callerID });
        });

        newSocket.on('user-left', (peerId) => {
          console.log(`User left: ${peerId}`);
          // Remove the peer that left
          const peerObj = peersRef.current.find(p => p.peerId === peerId);
          if (peerObj) {
            console.log(`Destroying peer connection with ${peerId}`);
            peerObj.peer.destroy();
          } else {
            console.log(`No peer connection found for ${peerId}`);
          }
          
          peersRef.current = peersRef.current.filter(p => p.peerId !== peerId);
          setPeers(prevPeers => prevPeers.filter(p => p.peerId !== peerId));
          setParticipants(prev => prev.filter(p => p.id !== peerId));
        });

        // Handle reconnection requests
        newSocket.on('reconnect-with-peer', ({ peerId, username: peerUsername }) => {
          console.log(`Reconnection request with: ${peerUsername} (${peerId})`);
          
          // Check if we already have this peer
          const existingPeer = peersRef.current.find(p => p.peerId === peerId);
          if (existingPeer) {
            console.log(`Already have a peer connection with ${peerId}, checking if it's working`);
            
            // Check if the peer connection is working
            const peerAny = existingPeer.peer as any;
            let connectionOk = false;
            
            if (peerAny._pc) {
              const connectionState = peerAny._pc.connectionState || peerAny._pc.iceConnectionState;
              console.log(`Peer connection state with ${peerId}: ${connectionState}`);
              
              // Only consider the connection OK if it's connected or completed
              if (connectionState === 'connected' || connectionState === 'completed') {
                connectionOk = true;
              }
              
              // If we have a connection but no streams, it's not working properly
              if (peerAny._remoteStreams && peerAny._remoteStreams.length === 0) {
                console.log(`No remote streams from ${peerId}, connection not working properly`);
                connectionOk = false;
              }
            }
            
            if (!connectionOk) {
              console.log(`Connection with ${peerId} not working properly, recreating`);
              existingPeer.peer.destroy();
              peersRef.current = peersRef.current.filter(p => p.peerId !== peerId);
              setPeers(prevPeers => prevPeers.filter(p => p.peerId !== peerId));
              
              // Create a new peer connection
              const peer = createPeer(peerId, newSocket.id || '', stream, peerUsername);
              
              peersRef.current.push({
                peerId,
                peer,
                username: peerUsername
              });
              
              setPeers(prevPeers => [...prevPeers, { peerId, peer, username: peerUsername }]);
            } else {
              console.log(`Connection with ${peerId} seems to be working, keeping it`);
            }
          } else {
            console.log(`No existing peer connection with ${peerId}, creating new one`);
            // Create a new peer connection
            const peer = createPeer(peerId, newSocket.id || '', stream, peerUsername);
            
            peersRef.current.push({
              peerId,
              peer,
              username: peerUsername
            });
            
            setPeers(prevPeers => [...prevPeers, { peerId, peer, username: peerUsername }]);
          }
        });

        newSocket.on('receive-message', (message) => {
          console.log('Received message:', message);
          setMessages(prev => [...prev, message]);
        });
      })
      .catch(err => {
        console.error('Error accessing media devices:', err);
        setConnectionStatus('failed');
        
        // Try to join room even without media if that's the issue
        if (newSocket.connected) {
          console.log('Joining room without media');
          newSocket.emit('join-room', { roomId, username });
        }
      });

    // Clean up function
    return () => {
      console.log('Cleaning up component...');
      
      // Stop all media tracks
      if (myStream) {
        myStream.getTracks().forEach(track => {
          console.log(`Stopping track: ${track.kind}`);
          track.stop();
        });
      }
      
      if (screenStream) {
        screenStream.getTracks().forEach(track => {
          console.log(`Stopping screen track: ${track.kind}`);
          track.stop();
        });
      }
      
      // Destroy all peer connections
      peersRef.current.forEach(peerObj => {
        console.log(`Destroying peer: ${peerObj.username}`);
        peerObj.peer.destroy();
      });
      
      // Disconnect socket
      if (newSocket) {
        console.log('Disconnecting socket');
        newSocket.removeAllListeners(); // Remove all listeners first
        newSocket.disconnect();
      }
    };
  }, [roomId, username]); // Add dependencies to prevent stale closures

  const createPeer = (userToSignal: string, callerID: string, stream: MediaStream, username: string) => {
    console.log(`Creating peer to signal ${username} (${userToSignal})`);
    
    const peer = new Peer({
      initiator: true,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' }
        ]
      },
      stream: stream
    });

    // Log connection state changes
    const peerAny = peer as any;
    if (peerAny._pc) {
      peerAny._pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${username} (${userToSignal}): ${peerAny._pc.iceConnectionState}`);
        
        // If connection fails, try to restart ICE
        if (peerAny._pc.iceConnectionState === 'failed' || peerAny._pc.iceConnectionState === 'disconnected') {
          console.log(`Connection with ${username} failed or disconnected, attempting to restart ICE`);
          try {
            if (typeof peerAny._pc.restartIce === 'function') {
              peerAny._pc.restartIce();
            } else {
              // Fallback for browsers that don't support restartIce
              peer.destroy();
              const newPeer = createPeer(userToSignal, callerID, stream, username);
              
              // Update the peers array with the new peer
              const peerIndex = peersRef.current.findIndex(p => p.peerId === userToSignal);
              if (peerIndex !== -1) {
                peersRef.current[peerIndex].peer = newPeer;
                setPeers(prevPeers => {
                  const newPeers = [...prevPeers];
                  const idx = newPeers.findIndex(p => p.peerId === userToSignal);
                  if (idx !== -1) {
                    newPeers[idx].peer = newPeer;
                  }
                  return newPeers;
                });
              }
            }
          } catch (err) {
            console.error(`Error restarting ICE for peer ${username}:`, err);
          }
        }
      };
    }

    // Send ICE candidates to the other peer
    if (peerAny._pc) {
      peerAny._pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          console.log(`Generated ICE candidate for ${username} (${userToSignal})`);
          socket?.emit('ice-candidate', {
            candidate: event.candidate,
            to: userToSignal
          });
        }
      };
    }

    peer.on('signal', (data) => {
      console.log(`Generated signal for ${username} (${userToSignal})`);
      socket?.emit('sending-signal', { userToSignal, callerID, signal: data, username: username });
    });

    peer.on('stream', (currentStream) => {
      console.log(`Received stream from ${username} (${userToSignal})`);
      
      // Ensure we have the stream in our peers array
      const peerObj = peersRef.current.find(p => p.peerId === userToSignal);
      if (peerObj) {
        // Force update the stream
        setPeers(prevPeers => {
          return prevPeers.map(p => {
            if (p.peerId === userToSignal) {
              return { ...p, stream: currentStream };
            }
            return p;
          });
        });
      }
    });

    peer.on('error', (err) => {
      console.error(`Peer error with ${username} (${userToSignal}):`, err);
      
      // If there's a fatal error, try to recreate the peer after a short delay
      setTimeout(() => {
        try {
          if (peersRef.current.some(p => p.peerId === userToSignal)) {
            console.log(`Attempting to recreate peer connection with ${username} after error`);
            peer.destroy();
            
            const newPeer = createPeer(userToSignal, callerID, stream, username);
            
            // Update the peers array with the new peer
            const peerIndex = peersRef.current.findIndex(p => p.peerId === userToSignal);
            if (peerIndex !== -1) {
              peersRef.current[peerIndex].peer = newPeer;
              setPeers(prevPeers => {
                const newPeers = [...prevPeers];
                const idx = newPeers.findIndex(p => p.peerId === userToSignal);
                if (idx !== -1) {
                  newPeers[idx].peer = newPeer;
                }
                return newPeers;
              });
            }
          }
        } catch (err) {
          console.error(`Error recreating peer with ${username}:`, err);
        }
      }, 2000);
    });

    peer.on('close', () => {
      console.log(`Peer connection closed with ${username} (${userToSignal})`);
    });

    return peer;
  };

  const addPeer = (incomingSignal: any, callerID: string, stream: MediaStream, callerUsername: string) => {
    console.log(`Adding peer from ${callerUsername} (${callerID})`);
    
    const peer = new Peer({
      initiator: false,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' }
        ]
      },
      stream: stream
    });

    // Log connection state changes
    const peerAny = peer as any;
    if (peerAny._pc) {
      peerAny._pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${callerUsername} (${callerID}): ${peerAny._pc.iceConnectionState}`);
        
        // If connection fails, try to restart ICE
        if (peerAny._pc.iceConnectionState === 'failed' || peerAny._pc.iceConnectionState === 'disconnected') {
          console.log(`Connection with ${callerUsername} failed or disconnected, attempting to restart ICE`);
          try {
            if (typeof peerAny._pc.restartIce === 'function') {
              peerAny._pc.restartIce();
            } else {
              // Request reconnection through the server
              socket?.emit('request-reconnection', { roomId });
            }
          } catch (err) {
            console.error(`Error restarting ICE for peer ${callerUsername}:`, err);
          }
        }
      };
    }

    // Send ICE candidates to the other peer
    if (peerAny._pc) {
      peerAny._pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          console.log(`Generated ICE candidate for ${callerUsername} (${callerID})`);
          socket?.emit('ice-candidate', {
            candidate: event.candidate,
            to: callerID
          });
        }
      };
    }

    peer.on('signal', (data) => {
      console.log(`Generated signal for ${callerUsername} (${callerID})`);
      socket?.emit('returning-signal', { signal: data, callerID });
    });

    peer.on('stream', (currentStream) => {
      console.log(`Received stream from ${callerUsername} (${callerID})`);
      
      // Ensure we have the stream in our peers array
      const peerObj = peersRef.current.find(p => p.peerId === callerID);
      if (peerObj) {
        // Force update the stream
        setPeers(prevPeers => {
          return prevPeers.map(p => {
            if (p.peerId === callerID) {
              return { ...p, stream: currentStream };
            }
            return p;
          });
        });
      }
    });

    peer.on('error', (err) => {
      console.error(`Peer error with ${callerUsername} (${callerID}):`, err);
      
      // If there's a fatal error, request reconnection through the server
      setTimeout(() => {
        socket?.emit('request-reconnection', { roomId });
      }, 2000);
    });

    peer.on('close', () => {
      console.log(`Peer connection closed with ${callerUsername} (${callerID})`);
    });

    peer.signal(incomingSignal);
    return peer;
  };

  const toggleMute = () => {
    if (myStream) {
      myStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsMuted(!isMuted)
    }
  }

  const toggleVideo = () => {
    if (myStream) {
      myStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsVideoOff(!isVideoOff)
    }
  }

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        console.log('Starting screen sharing...');
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true,
          audio: false
        });
        
        console.log('Got screen sharing stream:', stream);
        setScreenStream(stream);
        
        // Listen for stream end
        stream.getVideoTracks()[0].onended = () => {
          console.log('Screen sharing ended by user');
          stopScreenSharing();
        };
        
        // Replace video track for all peers
        if (peersRef.current.length > 0) {
          console.log(`Replacing video track for ${peersRef.current.length} peers`);
          
          const videoTrack = stream.getVideoTracks()[0];
          
          peersRef.current.forEach(({ peer, peerId }) => {
            try {
              console.log(`Replacing track for peer: ${peerId}`);
              
              // For simple-peer, we need to use replaceTrack
              const peerAny = peer as any;
              
              // Method 1: Try using replaceTrack directly if available
              if (typeof peerAny.replaceTrack === 'function') {
                const oldTrack = myStream?.getVideoTracks()[0];
                if (oldTrack) {
                  console.log('Using peer.replaceTrack method');
                  peerAny.replaceTrack(oldTrack, videoTrack, myStream);
                }
              } 
              // Method 2: Try using _senders if available
              else if (peerAny._senders && peerAny._senders.length > 0) {
                console.log('Using _senders method');
                const sender = peerAny._senders.find((s: any) => s.track && s.track.kind === 'video');
                if (sender && sender.replaceTrack) {
                  sender.replaceTrack(videoTrack);
                }
              } 
              // Method 3: Recreate the peer connection
              else {
                console.log('No direct replacement method found, using stream.addTrack');
                // This is a fallback and may not work in all cases
                if (myStream) {
                  const oldTrack = myStream.getVideoTracks()[0];
                  if (oldTrack) {
                    myStream.removeTrack(oldTrack);
                  }
                  myStream.addTrack(videoTrack);
                }
              }
            } catch (err) {
              console.error('Error replacing track:', err);
            }
          });
        } else {
          console.log('No peers to share screen with');
        }
        
        // Show screen share in my video
        if (myVideoRef.current) {
          console.log('Updating my video to show screen share');
          myVideoRef.current.srcObject = stream;
        }
        
        setIsScreenSharing(true);
      } catch (err) {
        console.error('Error sharing screen:', err);
      }
    } else {
      stopScreenSharing();
    }
  };

  const stopScreenSharing = () => {
    console.log('Stopping screen sharing...');
    
    if (screenStream) {
      console.log('Stopping all screen share tracks');
      screenStream.getTracks().forEach(track => {
        track.stop();
      });
      setScreenStream(null);
    }
    
    // Restore video track for all peers
    if (myStream) {
      const videoTrack = myStream.getVideoTracks()[0];
      
      if (videoTrack) {
        console.log(`Restoring original video for ${peersRef.current.length} peers`);
        
        peersRef.current.forEach(({ peer, peerId }) => {
          try {
            console.log(`Restoring track for peer: ${peerId}`);
            
            // For simple-peer, we need to use replaceTrack
            const peerAny = peer as any;
            
            // Method 1: Try using replaceTrack directly if available
            if (typeof peerAny.replaceTrack === 'function') {
              const oldTrack = screenStream?.getVideoTracks()[0];
              if (oldTrack) {
                console.log('Using peer.replaceTrack method');
                peerAny.replaceTrack(oldTrack, videoTrack, myStream);
              }
            } 
            // Method 2: Try using _senders if available
            else if (peerAny._senders && peerAny._senders.length > 0) {
              console.log('Using _senders method');
              const sender = peerAny._senders.find((s: any) => s.track && s.track.kind === 'video');
              if (sender && sender.replaceTrack) {
                sender.replaceTrack(videoTrack);
              }
            }
          } catch (err) {
            console.error('Error restoring track:', err);
          }
        });
      } else {
        console.log('No video track to restore');
      }
      
      // Restore my video
      if (myVideoRef.current) {
        console.log('Restoring my video display');
        myVideoRef.current.srcObject = myStream;
      }
    }
    
    setIsScreenSharing(false);
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (newMessage.trim() && socket) {
      const messageData = {
        sender: username,
        content: newMessage,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
      socket.emit('send-message', { roomId, message: messageData })
      setMessages(prev => [...prev, messageData])
      setNewMessage('')
    }
  }

  const leaveRoom = () => {
    window.location.href = '/'
  }

  const reconnectSocket = () => {
    console.log('Manually reconnecting socket...');
    setConnectionStatus('connecting');
    
    if (socket) {
      // Disconnect existing socket
      socket.disconnect();
      
      // Reconnect after a short delay
      setTimeout(() => {
        socket.connect();
      }, 1000);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 p-4 shadow-md">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-primary-600 rounded-full flex items-center justify-center mr-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Video Chat</h1>
              <div className="flex items-center">
                <span className="text-sm text-gray-400 mr-2">Room: {roomId}</span>
                <div className="flex items-center">
                  <span className={`inline-block w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'} mr-1`}></span>
                  <span className="text-xs text-gray-400">
                    {connectionStatus === 'connected' ? 'Connected' : 
                     connectionStatus === 'connecting' ? 'Connecting...' : 'Connection failed'}
                  </span>
                  {connectionStatus === 'failed' && (
                    <button 
                      onClick={reconnectSocket}
                      className="ml-2 text-xs text-primary-400 hover:text-primary-300"
                    >
                      Reconnect
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center">
            <button 
              onClick={() => setIsChatOpen(!isChatOpen)}
              className="btn btn-secondary mr-2 hidden sm:block"
            >
              {isChatOpen ? 'Hide Chat' : 'Show Chat'}
            </button>
            <button 
              onClick={leaveRoom}
              className="btn btn-danger"
            >
              Leave
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video grid */}
        <div className={`flex-1 p-4 ${isChatOpen ? 'hidden md:block md:w-2/3' : 'w-full'}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full">
            {/* My video */}
            <div className="relative bg-gray-800 rounded-lg overflow-hidden shadow-lg">
              <video
                ref={myVideoRef}
                muted
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center mr-2">
                    <span className="text-white font-bold">{username.charAt(0).toUpperCase()}</span>
                  </div>
                  <span className="text-white">{username} (You)</span>
                </div>
              </div>
            </div>

            {/* Peer videos */}
            {peers.map((peerObj) => (
              <VideoPlayer 
                key={peerObj.peerId} 
                peer={peerObj.peer} 
                username={peerObj.username} 
              />
            ))}
          </div>
        </div>

        {/* Chat sidebar */}
        {isChatOpen && (
          <div className="w-full md:w-1/3 bg-gray-800 border-l border-gray-700 flex flex-col h-full">
            <div className="p-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Chat</h2>
              <p className="text-sm text-gray-400">{participants.length} participants</p>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, index) => (
                <div key={index} className={`flex ${msg.sender === username ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xs rounded-lg p-3 ${msg.sender === username ? 'bg-primary-600 text-white' : 'bg-gray-700 text-white'}`}>
                    <div className="flex items-center mb-1">
                      <span className="font-medium">{msg.sender}</span>
                      <span className="text-xs opacity-70 ml-2">{msg.time}</span>
                    </div>
                    <p>{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <form onSubmit={sendMessage} className="p-4 border-t border-gray-700">
              <div className="flex">
                <input
                  type="text"
                  className="input w-full rounded-r-none"
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                />
                <button 
                  type="submit" 
                  className="px-4 bg-primary-600 rounded-r-md hover:bg-primary-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Controls */}
      <Controls
        toggleMute={toggleMute}
        toggleVideo={toggleVideo}
        toggleScreenShare={toggleScreenShare}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        isScreenSharing={isScreenSharing}
        toggleChat={() => setIsChatOpen(!isChatOpen)}
        isChatOpen={isChatOpen}
      />
    </div>
  )
} 