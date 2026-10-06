import { useState, useEffect, useCallback } from "react";

/**
 * The panel's "now": re-read every minute (statuses and "today" stay true on a tab
 * left open), moved forward to the SERVER's time after every write, and never
 * backwards. Without the server's time, "→ Free" — which ends Premium at the
 * server's now — still read "has Premium" for up to a minute (or longer on a
 * laptop whose clock runs behind), because the page was asking "is the end after
 * now?" with an older now.
 *
 * @returns [now, bump] — bump(serverIso) after a write.
 */
export function useAdminClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow((n) => Math.max(n, Date.now())), 60000);
    return () => clearInterval(id);
  }, []);
  const bump = useCallback((serverIso) => {
    const server = serverIso ? Date.parse(serverIso) : NaN;
    setNow((n) => Math.max(n, Date.now(), Number.isFinite(server) ? server + 1 : 0));
  }, []);
  return [now, bump];
}
