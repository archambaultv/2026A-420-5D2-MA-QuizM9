/**
 * La session : QUI est connecté, retenu d'une requête à l'autre.
 *
 * HTTP n'a pas de mémoire. Le serveur pose donc un cookie dans le
 * navigateur, et le navigateur le renvoie à chaque requête. Le cookie
 * contient la session elle-même ({ accountId, exp }), SIGNÉE avec
 * SESSION_SECRET : quelqu'un qui modifie le contenu ne peut pas refaire la
 * signature, et le serveur jette le cookie. Rien n'est chiffré : le contenu
 * se lit, mais ne se falsifie pas. Ne mettez jamais un secret dans une
 * session.
 *
 * Forme du cookie :  quizm9_session=<données en base64url>.<signature HMAC>
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'quizm9_session';
const SECRET = process.env.SESSION_SECRET ?? 'developpement-seulement';
// Durée de vie d'une session. Un jeton signé ne se révoque pas : c'est cette
// date d'expiration qui limite les dégâts d'un cookie volé.
const DUREE_MS = 7 * 24 * 60 * 60 * 1000; // une semaine

/** Signe une session, avec sa date d'expiration : la valeur du cookie. */
export function signSession(session) {
  const contenu = { ...session, exp: Date.now() + DUREE_MS };
  const data = Buffer.from(JSON.stringify(contenu)).toString('base64url');
  return `${data}.${signature(data)}`;
}

/** Relit une session signée ; {} si le cookie est absent, altéré, illisible ou expiré. */
export function verifySession(value) {
  const [data, sig] = (value ?? '').split('.');
  if (!data || !sig) return {};
  const expected = signature(data);
  // Une comparaison à temps constant : la durée ne trahit pas où ça diffère.
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return {};
  }
  try {
    const session = JSON.parse(Buffer.from(data, 'base64url').toString());
    // Signature valide, mais périmée : c'est le serveur qui vérifie la date,
    // jamais le navigateur. Une session sans exp n'est pas une des nôtres.
    if (!(session.exp > Date.now())) return {};
    return session;
  } catch {
    return {};
  }
}

function signature(data) {
  return createHmac('sha256', SECRET).update(data).digest('base64url');
}

/** La session portée par la requête (son cookie), ou {} s'il n'y en a pas. */
export function readSession(req) {
  const cookies = Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name]) => name),
  );
  return verifySession(cookies[COOKIE_NAME]);
}

/** Pose la session dans la réponse : le navigateur la renverra ensuite. */
export function writeSession(res, session) {
  res.cookie(COOKIE_NAME, signSession(session), {
    httpOnly: true, // invisible au JavaScript de la page : un XSS ne la vole pas
    sameSite: 'lax', // pas envoyé par un formulaire posté depuis un autre site
    maxAge: DUREE_MS, // le navigateur l'oublie au bout d'une semaine, lui aussi
    path: '/',
  });
}

/** Efface la session : la déconnexion. */
export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * Le jeton d'un joueur : la même idée que le cookie, des données signées.
 * Le serveur le remet au joueur qui rejoint une partie ; le joueur le
 * présente ensuite pour prouver qui il est (connexion Socket.IO, réponses).
 *
 * Pourquoi pas un cookie ? Un cookie est partagé par tous les onglets du
 * navigateur, alors que chaque onglet peut être un joueur différent. Le
 * jeton vit dans sessionStorage, un par onglet.
 */
export function signPlayerToken(code, nickname) {
  return signSession({ code, nickname });
}

/** Relit un jeton de joueur : { code, nickname }, ou null s'il n'est pas valide. */
export function verifyPlayerToken(token) {
  if (typeof token !== 'string') return null; // il vient du client : n'importe quoi
  const { code, nickname } = verifySession(token);
  return code && nickname ? { code, nickname } : null;
}

/** Le nom du cookie, pour les tests qui en fabriquent un. */
export { COOKIE_NAME };
