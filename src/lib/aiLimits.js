/**
 * AI assistant questions per day, by effective tier — ONE list.
 *
 * The server enforces it (api/ai/chat.js), the chat window shows the quota
 * (src/lib/useChat.js) and the Billing page sells it. Until 2026-10-06 each had
 * its own copy and Billing promised Premium "30 questions / day" while the
 * server cut a paying customer off at 15. A running trial counts as "paid".
 */
export const AI_DAILY_LIMITS = Object.freeze({ anon: 1, free: 3, paid: 15, admin: 100 });
