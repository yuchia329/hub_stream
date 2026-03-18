'use client';

import { use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useCallback, useState, useRef } from 'react';
import { useRoomP2P } from '@/hooks/useRoomP2P';
import VideoTile from '@/components/VideoTile';
import Controls from '@/components/Controls';
import { ChatPanel } from '@/components/ChatPanel';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function RoomP2PPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const displayName = searchParams.get('name') || 'Anonymous';
  const roomId = resolvedParams.id;

  const {
    localStream,
    participants,
    isMuted,
    isCamOff,
    isConnected,
    error,
    hasMultipleCameras,
    activeSpeakerIds,
    dominantSpeakerId,
    localLastSpokeAt,
    chatMessages,
    toggleMic,
    toggleCam,
    switchCamera,
    sendChat,
    setWatchedVideoPeers,
    leave,
  } = useRoomP2P(roomId, displayName);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'grid' | 'speaker'>('grid');
  const [showFilmstrip, setShowFilmstrip] = useState(true);
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [filmstripIndex, setFilmstripIndex] = useState(0);
  const [gridPage, setGridPage] = useState(0);

  const [filmstripPageSize, setFilmstripPageSize] = useState(5);
  const [gridPageSize, setGridPageSize] = useState(12);

  const [isPortrait, setIsPortrait] = useState(false);
  const [sourceOrientation, setSourceOrientation] = useState<'landscape' | 'portrait'>('landscape');

  useEffect(() => {
    const handleResize = () => {
      const portrait = window.innerHeight > window.innerWidth;
      setIsPortrait(portrait);
      setFilmstripPageSize(portrait ? 2 : 3);
      setGridPageSize(portrait ? 4 : 9);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let landscape = 0;
    let portrait = 0;
    const allStreams = [localStream, ...participants.map(p => p.stream)].filter(Boolean) as MediaStream[];
    allStreams.forEach(s => {
      const vt = s.getVideoTracks()[0];
      if (vt) {
        const { width, height } = vt.getSettings();
        if (width && height) { if (width >= height) landscape++; else portrait++; }
        else { landscape++; }
      }
    });
    setSourceOrientation(portrait > landscape ? 'portrait' : 'landscape');
  }, [participants, localStream]);

  const [unreadCount, setUnreadCount] = useState(0);
  const lastMessageCountRef = useRef(chatMessages.length);

  useEffect(() => {
    if (isChatOpen) {
      setUnreadCount(0);
      lastMessageCountRef.current = chatMessages.length;
    } else {
      const newMessages = chatMessages.length - lastMessageCountRef.current;
      if (newMessages > 0) setUnreadCount(prev => prev + newMessages);
      lastMessageCountRef.current = chatMessages.length;
    }
  }, [chatMessages.length, isChatOpen]);

  const handleLeave = useCallback(() => {
    leave();
    router.push('/');
  }, [leave, router]);

  if (error) {
    return (
      <div className="error-screen">
        <div className="error-card">
          <span className="error-icon">⚠️</span>
          <h2>Connection Error</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => router.push('/')}>
            ← Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  const totalParticipants = participants.length + 1;

  let speakerStream = localStream;
  let speakerName = displayName;
  let speakerIsLocal = true;

  if (layoutMode === 'speaker') {
    if (pinnedUserId) {
      if (pinnedUserId === 'local') {
        speakerStream = localStream; speakerName = displayName; speakerIsLocal = true;
      } else {
        const pinnedPeer = participants.find((p) => p.peerId === pinnedUserId);
        if (pinnedPeer) { speakerStream = pinnedPeer.stream; speakerName = pinnedPeer.displayName; speakerIsLocal = false; }
        else if (dominantSpeakerId !== 'local' && dominantSpeakerId !== null && participants.length > 0) {
          const remoteActive = participants.find((p) => p.peerId === dominantSpeakerId) || participants[0];
          speakerStream = remoteActive.stream; speakerName = remoteActive.displayName; speakerIsLocal = false;
        }
      }
    } else if (dominantSpeakerId !== 'local' && dominantSpeakerId !== null && participants.length > 0) {
      const remoteActive = participants.find((p) => p.peerId === dominantSpeakerId) || participants[0];
      speakerStream = remoteActive.stream; speakerName = remoteActive.displayName; speakerIsLocal = false;
    }
  }

  const remoteIsCamOff = (s: MediaStream | null, paused?: boolean) => {
    if (!s) return true;
    if (s.getVideoTracks().length === 0) return true;
    return !!paused;
  };

  const speakerIsMuted = speakerIsLocal ? isMuted : false;
  const speakerIsCamOff = speakerIsLocal ? isCamOff : remoteIsCamOff(speakerStream, participants.find(p => p.stream === speakerStream)?.isCamPaused);

  const sortPeers = (
    a: { peerId: string; stream: MediaStream | null; isCamPaused?: boolean; lastSpokeAt?: number },
    b: { peerId: string; stream: MediaStream | null; isCamPaused?: boolean; lastSpokeAt?: number }
  ) => {
    const aSpeaking = activeSpeakerIds.includes(a.peerId);
    const bSpeaking = activeSpeakerIds.includes(b.peerId);
    if (aSpeaking && !bSpeaking) return -1;
    if (!aSpeaking && bSpeaking) return 1;
    const aCamOn = a.peerId === 'local' ? !isCamOff : !remoteIsCamOff(a.stream, a.isCamPaused);
    const bCamOn = b.peerId === 'local' ? !isCamOff : !remoteIsCamOff(b.stream, b.isCamPaused);
    if (aCamOn && !bCamOn) return -1;
    if (!aCamOn && bCamOn) return 1;
    const aSpokeAt = a.peerId === 'local' ? localLastSpokeAt : (a.lastSpokeAt || 0);
    const bSpokeAt = b.peerId === 'local' ? localLastSpokeAt : (b.lastSpokeAt || 0);
    if (aSpokeAt > bSpokeAt) return -1;
    if (aSpokeAt < bSpokeAt) return 1;
    return 0;
  };

  const filmstripPeers = participants.filter((p) => p.stream !== speakerStream);
  filmstripPeers.sort(sortPeers);
  const displayFilmstrip = filmstripPeers.slice(filmstripIndex, filmstripIndex + filmstripPageSize);

  const allGridPeers = participants.map((p) => ({
    peerId: p.peerId, stream: p.stream, displayName: p.displayName,
    isLocal: false, streamToMatch: p.stream, isCamPaused: p.isCamPaused, lastSpokeAt: p.lastSpokeAt,
  }));
  allGridPeers.sort(sortPeers);

  const gridTotalPages = Math.ceil(allGridPeers.length / (gridPageSize - 1)) || 1;
  const safeGridPage = Math.min(gridPage, Math.max(0, gridTotalPages - 1));
  const displayGridPeers = [
    { peerId: 'local', stream: localStream, displayName, isLocal: true, streamToMatch: localStream, isCamPaused: false, lastSpokeAt: localLastSpokeAt },
    ...allGridPeers.slice(safeGridPage * (gridPageSize - 1), (safeGridPage + 1) * (gridPageSize - 1))
  ];

  const getGridDimensions = (count: number, envP: boolean, sourceP: boolean) => {
    if (count === 0) return { c: 1, r: 1 };
    if (!envP && !sourceP) {
      if (count === 1) return { c: 1, r: 1 };
      if (count === 2) return { c: 2, r: 1 };
      if (count <= 4) return { c: 2, r: 2 };
      if (count <= 6) return { c: 3, r: 2 };
      if (count <= 9) return { c: 3, r: 3 };
      return { c: 4, r: Math.ceil(count / 4) };
    }
    if (count === 1) return { c: 1, r: 1 };
    if (count === 2) return { c: 2, r: 1 };
    if (count <= 4) return { c: 2, r: 2 };
    return { c: 3, r: Math.ceil(count / 3) };
  };

  const gridDims = getGridDimensions(displayGridPeers.length, isPortrait, sourceOrientation === 'portrait');

  // P2P has no server-side consumer pausing, but we call setWatchedVideoPeers (no-op) to satisfy the interface
  useEffect(() => {
    setWatchedVideoPeers([]);
  }, [setWatchedVideoPeers]);

  return (
    <div className={`room-page ${isChatOpen ? 'room-page--with-chat' : ''} ${isPortrait ? 'env-portrait' : 'env-landscape'}`}>
      {!isConnected && (
        <div className="connecting-banner">
          <span className="spinner" />
          Connecting to room…
        </div>
      )}

      <div className="room-main">
        {layoutMode === 'grid' ? (
          <div className="grid-layout-container">
            {gridTotalPages > 1 && safeGridPage > 0 && (
              <button className="grid-nav-btn prev" onClick={() => setGridPage(p => Math.max(0, p - 1))}>&#10094;</button>
            )}
            <div
              className="video-grid"
              style={{ display: 'grid', gridTemplateColumns: `repeat(${gridDims.c}, 1fr)`, gridTemplateRows: `repeat(${gridDims.r}, 1fr)` }}
            >
              {displayGridPeers.map((p, i) => (
                <VideoTile
                  key={p.peerId || i}
                  stream={p.stream}
                  displayName={p.displayName}
                  isMuted={p.isLocal ? isMuted : false}
                  isCamOff={p.isLocal ? isCamOff : remoteIsCamOff(p.stream, p.isCamPaused)}
                  isLocal={p.isLocal}
                  isSpeaking={activeSpeakerIds.includes(p.peerId)}
                  isPinned={pinnedUserId === p.peerId}
                  onPin={() => { setPinnedUserId(p.peerId); setLayoutMode('speaker'); }}
                  onUnpin={() => setPinnedUserId(null)}
                />
              ))}
            </div>
            {gridTotalPages > 1 && safeGridPage < gridTotalPages - 1 && (
              <button className="grid-nav-btn next" onClick={() => setGridPage(p => Math.min(gridTotalPages - 1, p + 1))}>&#10095;</button>
            )}
          </div>
        ) : (
          <div className="speaker-layout">
            <div className="speaker-main-tile">
              <VideoTile
                stream={speakerStream}
                displayName={speakerName}
                isMuted={speakerIsMuted}
                isCamOff={speakerIsCamOff}
                isLocal={speakerIsLocal}
                isSpeaking={speakerIsLocal ? activeSpeakerIds.includes('local') : activeSpeakerIds.includes((dominantSpeakerId || participants.find(p => p.stream === speakerStream)?.peerId) || '')}
                isPinned={speakerIsLocal ? pinnedUserId === 'local' : pinnedUserId === (participants.find(p => p.stream === speakerStream)?.peerId)}
                onPin={() => { setPinnedUserId(speakerIsLocal ? 'local' : participants.find(p => p.stream === speakerStream)?.peerId || null); setLayoutMode('speaker'); }}
                onUnpin={() => setPinnedUserId(null)}
              />
            </div>

            {layoutMode === 'speaker' && showFilmstrip && (
              <div className="speaker-filmstrip">
                {filmstripIndex > 0 && (
                  <button className="filmstrip-nav btn-prev" onClick={() => setFilmstripIndex((p) => Math.max(0, p - 1))}>▲</button>
                )}
                {displayFilmstrip.map((p) => (
                  <div key={p.peerId} className="filmstrip-tile-wrapper">
                    <VideoTile
                      stream={p.stream}
                      displayName={p.displayName}
                      isLocal={p.peerId === 'local'}
                      isMuted={false}
                      isCamOff={remoteIsCamOff(p.stream, p.isCamPaused)}
                      isSpeaking={activeSpeakerIds.includes(p.peerId)}
                      isPinned={pinnedUserId === p.peerId}
                      onPin={() => { setPinnedUserId(p.peerId); setLayoutMode('speaker'); }}
                      onUnpin={() => setPinnedUserId(null)}
                    />
                  </div>
                ))}
                {filmstripIndex + filmstripPageSize < filmstripPeers.length && (
                  <button className="filmstrip-nav btn-next" onClick={() => setFilmstripIndex((p) => p + 1)}>▼</button>
                )}
              </div>
            )}

            {!speakerIsLocal && (
              <div className="floating-self-view">
                <VideoTile
                  stream={localStream}
                  displayName={displayName}
                  isMuted={isMuted}
                  isCamOff={isCamOff}
                  isLocal
                  isSpeaking={activeSpeakerIds.includes('local')}
                  isPinned={pinnedUserId === 'local'}
                  onPin={() => { setPinnedUserId('local'); setLayoutMode('speaker'); }}
                  onUnpin={() => setPinnedUserId(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <ChatPanel isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} messages={chatMessages} onSend={sendChat} />

      <Controls
        isMuted={isMuted}
        isCamOff={isCamOff}
        roomId={roomId}
        participantCount={totalParticipants}
        hasMultipleCameras={hasMultipleCameras}
        mode="p2p"
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onSwitchCamera={switchCamera}
        onLeave={handleLeave}
        layoutMode={layoutMode}
        onToggleLayout={() => setLayoutMode((m) => m === 'grid' ? 'speaker' : 'grid')}
        showFilmstrip={showFilmstrip}
        onToggleFilmstrip={() => setShowFilmstrip((s) => !s)}
        onToggleChat={() => setIsChatOpen((c) => !c)}
        unreadCount={unreadCount}
      />
    </div>
  );
}
