// Request validation for the trade assistant (kept free of the SDK so the root Node tests can import it).
export const MAX_TURNS = 12, MAX_CHARS = 1500;

// Accept only a plain user/assistant history that ends with the user's question.
export function cleanMessages(input) {
  if (!Array.isArray(input) || !input.length) return null;
  const turns = input.slice(-MAX_TURNS).map(m => ({role: m?.role, content: typeof m?.content === 'string' ? m.content.trim().slice(0, MAX_CHARS) : ''}));
  if (turns.some(m => (m.role !== 'user' && m.role !== 'assistant') || !m.content)) return null;
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') return null;
  return turns;
}
