import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { nextQuestion, sendAnswer } from '../api.js';
import { useGame } from '../useGame.js';
import { getSession } from '../session.js';
import Countdown from '../components/Countdown.jsx';
import Leaderboard from '../components/Leaderboard.jsx';

/**
 * La salle de jeu : les questions défilent, le classement monte. La page
 * s'adapte au rôle retenu dans le salon — animateur, joueur, ou simple
 * spectateur.
 */
export default function Game() {
  const { code } = useParams();
  const navigate = useNavigate();
  const game = useGame(code);
  const [session, setSession] = useState(null);
  // L'index de la dernière question à laquelle on a répondu : le bouton se
  // désactive après un clic, puis se réactive à la question suivante.
  const [answeredIndex, setAnsweredIndex] = useState(null);

  useEffect(() => {
    setSession(getSession(code));
  }, [code]);

  useEffect(() => {
    if (game && game.state === 'lobby') {
      navigate(`/salon/${code}`, { replace: true });
    }
  }, [game, code, navigate]);

  if (!game) return <main className="screen">Chargement…</main>;

  const isHost = session?.role === 'host';
  const nickname = session?.role === 'player' ? session.nickname : null;
  const hasAnswered = answeredIndex === game.questionIndex;

  async function advance() {
    try {
      await nextQuestion(code);
    } catch {
      // L'état suivant arrivera par le WebSocket.
    }
  }

  async function answer(choiceId) {
    setAnsweredIndex(game.questionIndex);
    try {
      await sendAnswer(code, nickname, choiceId);
    } catch {
      // Trop tard, ou déjà répondu : le classement tranchera.
    }
  }

  return (
    <main className="screen">
      <header className="header">
        <h1>{game.title}</h1>
        <p className="code">
          {nickname ? `${nickname} — ` : ''}partie {game.code}
        </p>
      </header>

      {game.state === 'question' && (
        <>
          <p className="progress">
            Question {game.questionIndex + 1} / {game.questionCount}
          </p>
          <h2>{game.question.text}</h2>
          <Countdown deadline={game.question.deadline} />

          {isHost && (
            <>
              <p>
                {game.answerCount} / {game.players.length} réponse(s) reçue(s)
              </p>
              <button onClick={advance}>Clore la question</button>
            </>
          )}
          {nickname &&
            (hasAnswered ? (
              <p>Réponse envoyée. On attend les autres…</p>
            ) : (
              <div className="choices">
                {game.question.choices.map((c) => (
                  <button key={c.id} onClick={() => answer(c.id)}>
                    {c.text}
                  </button>
                ))}
              </div>
            ))}
        </>
      )}

      {game.state === 'results' && (
        <>
          <h2>Classement</h2>
          <Leaderboard players={game.players} currentNickname={nickname} />
          {isHost && (
            <button onClick={advance}>
              {game.questionIndex + 1 < game.questionCount
                ? 'Question suivante'
                : 'Terminer la partie'}
            </button>
          )}
        </>
      )}

      {game.state === 'finished' && (
        <>
          <h2>Partie terminée 🎉</h2>
          <Leaderboard players={game.players} currentNickname={nickname} />
        </>
      )}
    </main>
  );
}
