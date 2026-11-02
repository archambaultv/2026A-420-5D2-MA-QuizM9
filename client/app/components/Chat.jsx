import { useEffect, useRef, useState } from 'react';
import { setChatEnabled } from '../api.js';

/**
 * Le chat de la partie. Un joueur lit et écrit ; l'animateur lit, et coupe
 * ou rouvre le chat à tout moment.
 */
export default function Chat({ code, chat, sendMessage, nickname, isHost }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const listRef = useRef(null);

  // Un nouveau message : on descend la liste jusqu'en bas.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat.messages.length]);

  async function send(event) {
    event.preventDefault();
    try {
      const reply = await sendMessage(text);
      if (reply.error) return setError(reply.error);
      setText('');
      setError(null);
    } catch {
      setError('Le serveur ne répond pas.');
    }
  }

  async function toggle() {
    try {
      await setChatEnabled(code, !chat.enabled);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="card chat">
      <h2>Chat</h2>
      <ul className="chat-messages" ref={listRef}>
        {chat.messages.map((m) => (
          <li key={m.id}>
            <strong>{m.nickname}</strong> {m.text}
          </li>
        ))}
      </ul>

      {!chat.enabled && <p className="notice">Chat désactivé par l'animateur.</p>}
      {isHost && (
        <button className="secondary" onClick={toggle}>
          {chat.enabled ? 'Désactiver le chat' : 'Réactiver le chat'}
        </button>
      )}
      {nickname && (
        <form className="chat-form" onSubmit={send}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            placeholder="Votre message"
            disabled={!chat.enabled}
          />
          <button disabled={!chat.enabled || text.trim() === ''}>Envoyer</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
