import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../hooks/useRoom';

interface ChatPanelProps {
  messages: ChatMessage[];
  isOpen: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, isOpen, onClose, onSend }: ChatPanelProps) {
  const [text, setText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onSend(text);
      setText('');
    }
  };

  return (
    <div className={`chat-panel ${isOpen ? 'chat-panel--open' : ''}`}>
      <div className="chat-header">
        <h3>Room Chat</h3>
        <button type="button" className="chat-close-btn" onClick={onClose} title="Close Chat">
          ✖
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">No messages yet. Say hi!</div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-bubble-container ${
                msg.peerId === 'local' ? 'chat-bubble--local' : 'chat-bubble--remote'
              }`}
            >
              <div className="chat-bubble-sender">
                {msg.peerId === 'local' ? 'You' : msg.displayName}
                <span className="chat-bubble-time">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="chat-bubble-text">{msg.text}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSubmit}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="chat-input"
          autoComplete="off"
        />
        <button type="submit" className="chat-send-btn" disabled={!text.trim()}>
          ➤
        </button>
      </form>
    </div>
  );
}
