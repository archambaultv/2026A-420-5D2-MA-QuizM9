import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { nextQuestion } from '../api.js';
import { useGame } from '../useGame.js';
import { getSession } from '../session.js';
import Leaderboard from '../components/Leaderboard.jsx';
import Chat from '../components/Chat.jsx';

/**
 * Le salon d'attente : le code s'affiche, les joueurs arrivent. Dès que
 * l'animateur lance la partie, tout le monde passe à la salle de jeu.
 */
export default function Lobby() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { game, chat, sendMessage } = useGame(code);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  // sessionStorage n'existe pas côté serveur : on lit le rôle après coup.
  useEffect(() => {
    setSession(getSession(code));
  }, [code]);

  useEffect(() => {
    if (game && game.state !== 'lobby') {
      navigate(`/jeu/${code}`, { replace: true });
    }
  }, [game, code, navigate]);

  if (!game) return <main className="screen">Chargement…</main>;

  async function start() {
    try {
      await nextQuestion(code);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main className="screen">
      <header className="header">
        <h1>{game.title}</h1>
        <p className="code">
          Code de partie : <strong>{game.code}</strong>
        </p>
      </header>

      <h2>Salon d'attente — {game.players.length} joueur(s)</h2>
      <Leaderboard players={game.players} currentNickname={session?.nickname} />

      {session?.role === 'host' ? (
        <button onClick={start} disabled={game.players.length === 0}>
          Commencer la partie
        </button>
      ) : (
        <p>En attente de l'animateur…</p>
      )}
      {error && <p className="error">{error}</p>}

      <Chat
        code={code}
        chat={chat}
        sendMessage={sendMessage}
        nickname={session?.role === 'player' ? session.nickname : null}
        isHost={session?.role === 'host'}
      />
    </main>
  );
}
