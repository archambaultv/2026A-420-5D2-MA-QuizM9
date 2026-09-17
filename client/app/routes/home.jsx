import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { joinGame } from '../api.js';
import { saveSession } from '../session.js';

/** L'accueil : rejoindre une partie, ou aller en animer une. */
export default function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState(null);

  async function join(event) {
    event.preventDefault();
    try {
      await joinGame(code.trim(), nickname.trim());
      saveSession(code.trim(), { role: 'player', nickname: nickname.trim() });
      navigate(`/salon/${code.trim()}`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main className="screen">
      <h1>Super Quiz M9</h1>

      {/* Deux choix exclusifs, côte à côte : on joue OU on anime. */}
      <div className="home-choices">
        <section className="card">
          <h2>Jouer</h2>
          <p>Vous avez reçu un code de partie ?</p>
          <form onSubmit={join}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code de partie"
              inputMode="numeric"
            />
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Pseudonyme"
            />
            <button type="submit">Rejoindre la partie</button>
          </form>
        </section>

        <p className="or">ou</p>

        <section className="card">
          <h2>Animer</h2>
          <p>Choisissez un questionnaire, obtenez un code et invitez des joueurs.</p>
          <Link className="button" to="/catalogue">
            Ouvrir le catalogue
          </Link>
        </section>
      </div>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
