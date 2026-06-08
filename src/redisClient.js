// Proxied Redis client for Vercel
export const redis = {
  sadd: async (...args) => callRedis('sadd', args),
  smembers: async (...args) => callRedis('smembers', args),
  srem: async (...args) => callRedis('srem', args),
  get: async (...args) => callRedis('get', args),
  set: async (...args) => callRedis('set', args),
  del: async (...args) => callRedis('del', args),
  mget: async (...args) => callRedis('mget', args),
};

async function callRedis(command, args) {
  const res = await fetch('/api/redis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args }),
  });
  if (!res.ok) throw new Error('Errore di connessione al database backend');
  const data = await res.json();
  return data.result;
}
