-- Le schéma de Quiz M9, version SQLite (poste sans Docker). Même sept tables
-- que schema.sql, la version PostgreSQL, qui reste la référence.
--
--   account ──< quiz ──< question ──< choice
--                │
--                └──< game ──< player ──< answer >── question
--
-- Les horodatages sont des entiers : millisecondes depuis le 1er janvier
-- 1970, l'horloge du SERVEUR (Date.now() côté Node). SQLite n'a ni BIGINT
-- ni BOOLEAN : ses entiers font 64 bits, et un booléen est 0 ou 1.

-- Un compte est une identité GitHub : pas de mot de passe chez nous.
CREATE TABLE IF NOT EXISTS account (
  id         INTEGER PRIMARY KEY,
  github_id  INTEGER NOT NULL UNIQUE,
  login      TEXT NOT NULL,
  name       TEXT,
  avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS quiz (
  id         INTEGER PRIMARY KEY,
  -- NULL pour les questionnaires de démonstration ; l'auteur, sinon.
  account_id INTEGER REFERENCES account(id),
  title      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question (
  id               INTEGER PRIMARY KEY,
  quiz_id          INTEGER NOT NULL REFERENCES quiz(id),
  -- La place de la question dans le questionnaire : 1, 2, 3, …
  position         INTEGER NOT NULL,
  text             TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  UNIQUE (quiz_id, position)
);

CREATE TABLE IF NOT EXISTS choice (
  id          INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES question(id),
  text        TEXT NOT NULL,
  is_correct  INTEGER NOT NULL DEFAULT 0   -- 0 ou 1
);

CREATE TABLE IF NOT EXISTS game (
  id                  INTEGER PRIMARY KEY,
  quiz_id             INTEGER NOT NULL REFERENCES quiz(id),
  -- Le code à six chiffres affiché par l'animateur.
  code                TEXT NOT NULL UNIQUE,
  -- 'lobby' | 'question' | 'results' | 'finished'
  state               TEXT NOT NULL DEFAULT 'lobby',
  -- -1 dans le salon d'attente, puis 0, 1, 2, …
  question_index      INTEGER NOT NULL DEFAULT -1,
  -- Ouverture de la question courante ; NULL hors d'une question.
  question_started_at INTEGER,
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player (
  id       INTEGER PRIMARY KEY,
  game_id  INTEGER NOT NULL REFERENCES game(id),
  -- Un pseudonyme, pas un compte : il n'existe que dans sa partie.
  nickname TEXT NOT NULL,
  score    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (game_id, nickname)
);

CREATE TABLE IF NOT EXISTS answer (
  id          INTEGER PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES game(id),
  player_id   INTEGER NOT NULL REFERENCES player(id),
  question_id INTEGER NOT NULL REFERENCES question(id),
  choice_id   INTEGER NOT NULL REFERENCES choice(id),
  -- L'horodatage du SERVEUR : le bonus de rapidité ne se négocie pas avec
  -- l'horloge du client.
  answered_at INTEGER NOT NULL,
  -- Points obtenus ; NULL tant que la question n'est pas close.
  points      INTEGER
);
-- (game_id, player_id, question_id) devrait être UNIQUE : un joueur, une
-- réponse par question. On y reviendra à la semaine 11.
