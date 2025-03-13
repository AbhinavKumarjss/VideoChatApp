'use client'

import React from 'react'
import { 
  FaMicrophone, 
  FaMicrophoneSlash, 
  FaVideo, 
  FaVideoSlash, 
  FaDesktop, 
  FaComments, 
  FaCommentSlash 
} from 'react-icons/fa'

interface ControlsProps {
  toggleMute: () => void
  toggleVideo: () => void
  toggleScreenShare: () => void
  toggleChat: () => void
  isMuted: boolean
  isVideoOff: boolean
  isScreenSharing: boolean
  isChatOpen: boolean
}

const Controls: React.FC<ControlsProps> = ({
  toggleMute,
  toggleVideo,
  toggleScreenShare,
  toggleChat,
  isMuted,
  isVideoOff,
  isScreenSharing,
  isChatOpen
}) => {
  return (
    <div className="bg-gray-800 border-t border-gray-700 p-4">
      <div className="container mx-auto flex justify-center">
        <div className="flex space-x-4">
          <button
            onClick={toggleMute}
            className={`btn ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'} rounded-full p-3 md:p-4`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <FaMicrophoneSlash size={20} /> : <FaMicrophone size={20} />}
          </button>
          
          <button
            onClick={toggleVideo}
            className={`btn ${isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'} rounded-full p-3 md:p-4`}
            title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
          >
            {isVideoOff ? <FaVideoSlash size={20} /> : <FaVideo size={20} />}
          </button>
          
          <button
            onClick={toggleScreenShare}
            className={`btn ${isScreenSharing ? 'bg-primary-600 hover:bg-primary-700' : 'bg-gray-700 hover:bg-gray-600'} rounded-full p-3 md:p-4`}
            title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
          >
            <FaDesktop size={20} />
          </button>
          
          <button
            onClick={toggleChat}
            className={`btn ${isChatOpen ? 'bg-primary-600 hover:bg-primary-700' : 'bg-gray-700 hover:bg-gray-600'} rounded-full p-3 md:p-4 sm:hidden`}
            title={isChatOpen ? 'Hide chat' : 'Show chat'}
          >
            {isChatOpen ? <FaCommentSlash size={20} /> : <FaComments size={20} />}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Controls 