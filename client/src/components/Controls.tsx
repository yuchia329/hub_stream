'use client';

import { useState, useEffect } from 'react';

interface ControlsProps {
  isMuted: boolean;
  isCamOff: boolean;
  roomId: string;
  participantCount: number;
  hasMultipleCameras?: boolean;
  mode?: 'sfu' | 'p2p';
  onToggleMic: () => void;
  onToggleCam: () => void;
  onSwitchCamera?: () => void;
  layoutMode: 'grid' | 'speaker';
  onToggleLayout: () => void;
  showFilmstrip?: boolean;
  onToggleFilmstrip?: () => void;
  onToggleChat: () => void;
  unreadCount?: number;
  onLeave: () => void;
}

export default function Controls({
  isMuted,
  isCamOff,
  roomId,
  participantCount,
  hasMultipleCameras,
  mode = 'sfu',
  onToggleMic,
  onToggleCam,
  onSwitchCamera,
  layoutMode,
  onToggleLayout,
  showFilmstrip,
  onToggleFilmstrip,
  onToggleChat,
  unreadCount = 0,
  onLeave,
}: ControlsProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    }
  }, []);

  async function handleCopyLink() {
    const url = `${window.location.origin}/room/${roomId}`;
    await navigator.clipboard.writeText(url);
  }

  return (
    <div className="controls-bar">
      {/* Room info */}
      <div className="room-info">
        <span className="room-id">#{roomId}</span>
        <span className={`mode-badge mode-badge--${mode}`}>
          {mode === 'sfu' ? '⚡ SFU' : '🔗 P2P'}
        </span>
        <span className="participant-count">
          <span className="dot" /> {participantCount} participant{participantCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Control buttons */}
      <div className="control-buttons">
        {/* Mic */}
        <button
          id="btn-toggle-mic"
          className={`ctrl-btn ${isMuted ? 'ctrl-btn--off' : ''}`}
          onClick={onToggleMic}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          <span className="ctrl-icon">{isMuted ? '🔇' : '🎤'}</span>
          <span className="ctrl-label">{isMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        {/* Camera */}
        <button
          id="btn-toggle-cam"
          className={`ctrl-btn ${isCamOff ? 'ctrl-btn--off' : ''}`}
          onClick={onToggleCam}
          title={isCamOff ? 'Start Camera' : 'Stop Camera'}
        >
          <span className="ctrl-icon">{isCamOff ? '📵' : '📷'}</span>
          <span className="ctrl-label">{isCamOff ? 'Start Cam' : 'Stop Cam'}</span>
        </button>

        {/* Switch Camera (Mobile Only) */}
        {isMobile && hasMultipleCameras && onSwitchCamera && (
          <button
            id="btn-switch-cam"
            className="ctrl-btn"
            onClick={onSwitchCamera}
            title="Switch Camera"
          >
            <span className="ctrl-icon">🔄</span>
            <span className="ctrl-label">Flip Cam</span>
          </button>
        )}

        {/* Layout Toggle */}
        <button
          id="btn-toggle-layout"
          className="ctrl-btn"
          onClick={onToggleLayout}
          title={layoutMode === 'grid' ? 'Switch to Speaker View' : 'Switch to Grid View'}
        >
          <span className="ctrl-icon">{layoutMode === 'grid' ? '🗣️' : '⏹️'}</span>
          <span className="ctrl-label">{layoutMode === 'grid' ? 'Speaker' : 'Grid'}</span>
        </button>

        {/* Filmstrip Toggle (Speaker Mode Only) */}
        {layoutMode === 'speaker' && onToggleFilmstrip && (
          <button
            id="btn-toggle-filmstrip"
            className="ctrl-btn"
            onClick={onToggleFilmstrip}
            title={showFilmstrip ? 'Hide other users' : 'Show other users'}
          >
            <span className="ctrl-icon">{showFilmstrip ? '🙈' : '🐵'}</span>
            <span className="ctrl-label">{showFilmstrip ? 'Hide' : 'Show'}</span>
          </button>
        )}

        {/* Chat Toggle */}
        <button
          id="btn-toggle-chat"
          className="ctrl-btn"
          onClick={onToggleChat}
          title="Open Chat"
          style={{ position: 'relative' }}
        >
          <span className="ctrl-icon">💬</span>
          <span className="ctrl-label">Chat</span>
          {unreadCount > 0 && (
            <span className="chat-badge">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Copy link */}
        <button
          id="btn-copy-link"
          className="ctrl-btn"
          onClick={handleCopyLink}
          title="Copy invite link"
        >
          <span className="ctrl-icon">🔗</span>
          <span className="ctrl-label">Invite</span>
        </button>

        {/* Leave */}
        <button
          id="btn-leave"
          className="ctrl-btn ctrl-btn--leave"
          onClick={onLeave}
          title="Leave room"
        >
          <span className="ctrl-icon">📴</span>
          <span className="ctrl-label">Leave</span>
        </button>
      </div>
    </div>
  );
}
