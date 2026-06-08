export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  
  const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key mancante sul server.' });

  const { query, transactionsData, categoriesData } = req.body;

  const promptText = `Sei "Gemma", un assistente finanziario personale. Rispondi in italiano in modo sintetico e professionale.

Dati attuali dell'utente:
Categorie: ${JSON.stringify(categoriesData)}
Transazioni: ${JSON.stringify(transactionsData)}
Domanda: "${query}"

DEVI restituire ESCLUSIVAMENTE un oggetto JSON valido con la singola chiave "risposta" contenente il testo della tua risposta. Non scrivere markdown al di fuori del JSON. Nessun ragionamento, nessuna bozza.
Esempio output: {"risposta": "Ciao! Sono Gemma. Al momento non hai transazioni."}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });
    
    if (!response.ok) {
        const err = await response.json().catch(()=>({}));
        return res.status(response.status).json({ error: err.error?.message || "Errore API Google" });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
