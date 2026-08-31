module.exports = async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });
  const { message } = request.body || {};
  if (!message || typeof message !== 'string') return response.status(400).json({ error: 'A message is required' });

  const businessContext = `You are Northstar Plumbing's concise and helpful website assistant. Northstar serves South East England and handles emergency leaks, burst pipes, blockages, no-hot-water issues, bathroom and kitchen plumbing, and maintenance. For emergencies advise customers to request a visit. Never invent prices, availability, certifications, or diagnostic certainty. Keep responses under 70 words and end with a helpful next step.`;
  if (!process.env.GEMINI_API_KEY) {
    return response.status(200).json({ answer: 'We handle emergency repairs, installations, and plumbing maintenance across South East England. Tell me what is happening and I can help you request a visit or quote.' });
  }

  try {
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${businessContext}\n\nCustomer: ${message}` }] }] })
    });
    const data = await geminiResponse.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!geminiResponse.ok || !answer) throw new Error('Gemini response invalid');
    return response.status(200).json({ answer });
  } catch {
    return response.status(200).json({ answer: 'I can help you request a visit or quote. Please share what is happening and where you are based.' });
  }
}
