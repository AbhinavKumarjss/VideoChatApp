'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function Home() {
  const [roomId, setRoomId] = useState('')
  const [username, setUsername] = useState('')
  const router = useRouter()

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault()
    if (roomId && username) {
      router.push(`/room/${roomId}?username=${encodeURIComponent(username)}`)
    }
  }

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 7)
    setRoomId(newRoomId)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md p-6 bg-gray-800 rounded-xl shadow-2xl">
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-20 h-20 mb-4">
            <div className="absolute inset-0 bg-primary-500 rounded-full opacity-20 animate-pulse-slow"></div>
            <div className="absolute inset-2 bg-primary-600 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">Video Chat</h1>
          <p className="text-gray-400 text-center">Connect with anyone, anywhere, anytime</p>
        </div>

        <form onSubmit={joinRoom} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-1">Your Name</label>
            <input
              type="text"
              id="username"
              className="input w-full"
              placeholder="Enter your name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          
          <div>
            <label htmlFor="roomId" className="block text-sm font-medium text-gray-300 mb-1">Room ID</label>
            <div className="flex">
              <input
                type="text"
                id="roomId"
                className="input w-full rounded-r-none"
                placeholder="Enter room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                required
              />
              <button 
                type="button" 
                onClick={createRoom}
                className="px-4 bg-gray-700 border border-gray-600 border-l-0 rounded-r-md hover:bg-gray-600"
                title="Generate random room ID"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
          
          <button type="submit" className="btn btn-primary w-full">
            Join Room
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-700">
          <p className="text-sm text-gray-400 text-center">
            By using this service, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  )
} 