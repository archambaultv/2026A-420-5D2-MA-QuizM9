/**
 * Qui suis-je dans cette partie ? Animateur, ou joueur avec un pseudonyme.
 *
 * Retenu dans sessionStorage, le temps d'un onglet : recharger la page ne
 * fait pas perdre son rôle, fermer l'onglet oui. sessionStorage n'existe
 * que dans le navigateur — ces fonctions ne s'appellent jamais pendant le
 * rendu côté serveur (toujours dans un useEffect ou un gestionnaire
 * d'événement).
 */
export function saveSession(code, session) {
  sessionStorage.setItem(`quizm9:${code}`, JSON.stringify(session));
}

/** @returns {null | {role: 'host'} | {role: 'player', nickname: string, token: string}} */
export function getSession(code) {
  try {
    return JSON.parse(sessionStorage.getItem(`quizm9:${code}`));
  } catch {
    return null;
  }
}
