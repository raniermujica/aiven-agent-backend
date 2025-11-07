export const authenticateAgent = (req, res, next) => {
  const agentKey = req.headers['x-agent-key'];

  if (!agentKey || agentKey !== process.env.N8N_SECRET_KEY) {
    console.warn(`[AuthAgent] ⚠️ Intento de acceso fallido de N8N. Key: ${agentKey}`);
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }
  next();
};