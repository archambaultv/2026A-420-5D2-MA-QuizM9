/**
 * Les appels à l'API du serveur, depuis le NAVIGATEUR. Chaque fonction
 * renvoie le JSON de la réponse, ou lève une Error portant le message
 * d'erreur du serveur.
 *
 * Les chemins sont relatifs (/api/…) : en développement, Vite les relaie au
 * serveur Express (voir vite.config.js). Un loader ne passe pas par ici —
 * il s'exécute côté serveur, où ce relais n'existe pas.
 */
async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `Erreur ${response.status}`);
  }
  return data;
}

/** Le catalogue ; avec `search`, seulement les titres qui contiennent ce texte. */
export function fetchQuizzes(search = '') {
  return request('GET', search ? `/api/quizzes?q=${encodeURIComponent(search)}` : '/api/quizzes');
}

export function fetchQuiz(id) {
  return request('GET', `/api/quizzes/${id}`);
}

export function createGame(quizId) {
  return request('POST', '/api/games', { quizId });
}

export function joinGame(code, nickname) {
  return request('POST', `/api/games/${code}/players`, { nickname });
}

export function nextQuestion(code) {
  return request('POST', `/api/games/${code}/next`);
}

export function sendAnswer(code, nickname, choiceId) {
  return request('POST', `/api/games/${code}/answers`, { nickname, choiceId });
}
