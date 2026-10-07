import { useEffect, useState } from 'react';

/**
 * Le temps restant, calculé à partir de l'échéance donnée par le serveur.
 *
 * Le serveur n'envoie rien tant que la partie ne change pas : c'est le
 * composant qui se redessine, quatre fois par seconde. Un minuteur local,
 * sans aucune requête.
 */
export default function Countdown({ deadline }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <p className="countdown">{remaining} s</p>;
}
