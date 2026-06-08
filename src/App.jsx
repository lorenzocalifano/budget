import { useState, useEffect } from 'react';
import { redis } from './redisClient';

// Default categories to populate if database is empty
const DEFAULT_CATEGORIES = ['Spesa', 'Affitto', 'Trasporti', 'Intrattenimento', 'Stipendio'];

function App() {
  // --- DATABASE CONFIG CHECK ---
  const isConfigured = true; // Configuration handled by Vercel backend now

  // --- STATE SYSTEM ---
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [dbLoading, setDbLoading] = useState(true);

  // --- MULTI-PAGE NAVIGATION TABS ---
  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'storico' | 'analisi' | 'impostazioni'

  // --- FORM INPUTS STATE ---
  const [tipo, setTipo] = useState('uscita'); // 'uscita' | 'entrata'
  const [importo, setImporto] = useState('');
  const [titolo, setTitolo] = useState(''); // Causa / descrizione
  const [categoria, setCategoria] = useState('');
  const [destinatario, setDestinatario] = useState('me'); // 'me' | 'altri'
  const [necessita, setNecessita] = useState(5); // slider 1-10

  // --- HISTORY FILTERS & SEARCH ---
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilterType, setHistoryFilterType] = useState('tutti'); // 'tutti' | 'entrata' | 'uscita'

  // --- CATEGORIES MANAGEMENT STATE ---
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renamingId, setRenamingId] = useState(null); 
  const [renameValue, setRenameValue] = useState('');

  // --- AI ASSISTANT STATE ---
  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState(
    'Chiedimi ad esempio: "Quanto ho speso questo mese?", "Qual è la mia spesa più grande?" o "Quanto ho speso per Spesa?". Interrogherò direttamente Gemma in modo sicuro!'
  );
  const [aiLoading, setAiLoading] = useState(false);

  // --- INITIAL DATA FETCH ---
  useEffect(() => {
    if (!isConfigured) {
      setDbLoading(false);
      return;
    }

    async function loadData() {
      try {
        // 1. Fetch Categories Set
        let dbCategories = await redis.smembers('budget:categories');
        
        if (!dbCategories || dbCategories.length === 0) {
          await redis.sadd('budget:categories', ...DEFAULT_CATEGORIES);
          dbCategories = DEFAULT_CATEGORIES;
        }
        
        dbCategories = [...dbCategories].sort();
        setCategories(dbCategories);
        setCategoria(dbCategories[0] || 'Senza Categoria');

        // 2. Fetch Transaction IDs Set
        const txIds = await redis.smembers('budget:transaction_ids');
        
        if (txIds && txIds.length > 0) {
          const keys = txIds.map((id) => `budget:transaction:${id}`);
          const fetchedData = await redis.mget(...keys);
          
          const parsed = fetchedData
            .map((item) => {
              if (!item) return null;
              return typeof item === 'string' ? JSON.parse(item) : item;
            })
            .filter(Boolean)
            .sort((a, b) => b.id.localeCompare(a.id)); // Newest first
            
          setTransactions(parsed);
        } else {
          setTransactions([]);
        }
      } catch (err) {
        console.error('Errore caricamento dati Upstash Redis:', err);
      } finally {
        setDbLoading(false);
      }
    }

    loadData();
  }, [isConfigured]);

  // Sync category select default state
  useEffect(() => {
    if (categories.length > 0 && !categories.includes(categoria)) {
      setCategoria(categories[0]);
    }
  }, [categories]);

  // --- CALCULATE SUMMARY TOTALS ---
  const totalIncome = transactions
    .filter((t) => t.tipo === 'entrata')
    .reduce((acc, t) => acc + t.importo, 0);

  const totalExpense = transactions
    .filter((t) => t.tipo === 'uscita')
    .reduce((acc, t) => acc + t.importo, 0);

  const netBalance = totalIncome - totalExpense;

  // --- SUBMIT NEW TRANSACTION ---
  const handleAddTransaction = async (e) => {
    e.preventDefault();
    const parsedImporto = parseFloat(importo);
    const cleanTitolo = titolo.trim();

    if (!parsedImporto || parsedImporto <= 0) return;
    if (!cleanTitolo) return;

    const today = new Date().toISOString().split('T')[0];
    const newTransaction = {
      id: Date.now().toString(),
      tipo,
      importo: parsedImporto,
      titolo: cleanTitolo,
      categoria: categoria || 'Senza Categoria',
      data: today,
      ...(tipo === 'uscita' && {
        destinatario,
        necessita: parseInt(necessita, 10),
      }),
    };

    try {
      setTransactions((prev) => [newTransaction, ...prev]);

      await redis.set(`budget:transaction:${newTransaction.id}`, JSON.stringify(newTransaction));
      await redis.sadd('budget:transaction_ids', newTransaction.id);

      setImporto('');
      setTitolo('');
      setDestinatario('me');
      setNecessita(5);

      setActiveTab('storico');
    } catch (err) {
      console.error('Errore inserimento transazione:', err);
      alert('Impossibile salvare la transazione.');
    }
  };

  const handleDeleteTransaction = async (id) => {
    try {
      setTransactions((prev) => prev.filter((t) => t.id !== id));

      await redis.del(`budget:transaction:${id}`);
      await redis.srem('budget:transaction_ids', id);
    } catch (err) {
      console.error('Errore eliminazione transazione:', err);
      alert('Errore durante la cancellazione della transazione.');
    }
  };

  // --- CATEGORIES MANAGEMENT ---
  const handleAddCategory = async (e) => {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      alert('Questa categoria esiste già.');
      return;
    }

    try {
      setCategories((prev) => [...prev, trimmed].sort());
      await redis.sadd('budget:categories', trimmed);
      setNewCategoryName('');
    } catch (err) {
      console.error('Errore aggiunta categoria:', err);
      alert('Impossibile salvare la categoria.');
    }
  };

  const handleDeleteCategory = async (catName) => {
    try {
      setCategories((prev) => prev.filter((c) => c !== catName));
      await redis.srem('budget:categories', catName);
    } catch (err) {
      console.error('Errore rimozione categoria:', err);
      alert('Impossibile eliminare la categoria.');
    }
  };

  const handleSaveRename = async (oldName) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    if (trimmed === oldName) {
      setRenamingId(null);
      return;
    }
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase() && c !== oldName)) {
      alert('Questo nome categoria esiste già.');
      return;
    }

    try {
      await redis.srem('budget:categories', oldName);
      await redis.sadd('budget:categories', trimmed);

      const updatedTransactions = await Promise.all(
        transactions.map(async (t) => {
          if (t.categoria === oldName) {
            const updated = { ...t, categoria: trimmed };
            await redis.set(`budget:transaction:${t.id}`, JSON.stringify(updated));
            return updated;
          }
          return t;
        })
      );

      setCategories((prev) => prev.map((c) => (c === oldName ? trimmed : c)).sort());
      setTransactions(updatedTransactions);
      setRenamingId(null);
    } catch (err) {
      console.error('Errore rinomina categoria a cascata:', err);
      alert('Impossibile completare la modifica.');
    }
  };

  // --- GEMINI PROXY API CALL ---
  const runRealGeminiCall = async (query, transactionsData, categoriesData) => {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        transactionsData,
        categoriesData
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      console.error("Gemini API Error details:", errJson);
      throw new Error(errJson.error || "Errore nella comunicazione con il server.");
    }

    const resJson = await response.json();
    const reply = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!reply) {
      throw new Error("Nessuna risposta ricevuta dal modello.");
    }
    
    try {
        const parsed = JSON.parse(reply);
        return parsed.risposta || reply;
    } catch(e) {
        // Fallback to manual extraction as requested
        const match = reply.match(/"risposta"\s*:\s*"([\s\S]*?)"(?=\s*}| \`|$)/);
        if (match && match[1]) {
            return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
        return reply; // Ultimate fallback to raw text
    }
  };

  // --- SUBMIT AI ASSISTANT FORM ---
  const handleAiSubmit = async (e) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;

    setAiLoading(true);

    try {
      const reply = await runRealGeminiCall(aiQuery, transactions, categories);
      setAiResponse(reply);
    } catch (err) {
      console.error(err);
      
      // Fallback offline heuristics analyzer if server is down or Vercel API fails
      setTimeout(() => {
        const response = runAiHeuristics(aiQuery, transactions, categories);
        setAiResponse(
          response + 
          `\n\n*(Nota: Usa analisi offline. Errore API Serverless: ${err.message})*`
        );
      }, 500);
    } finally {
      setAiLoading(false);
    }
  };

  const runAiHeuristics = (query, data, catsList) => {
    const q = query.toLowerCase().trim();
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const formatEuro = (val) => `€${val.toFixed(2)}`;

    const expenses = data.filter((t) => t.tipo === 'uscita');
    const incomes = data.filter((t) => t.tipo === 'entrata');

    const isThisMonth = (dateStr) => {
      if (!dateStr) return false;
      const parts = dateStr.split('-');
      return parseInt(parts[0], 10) === currentYear && parseInt(parts[1], 10) === currentMonth;
    };

    const isLastMonth = (dateStr) => {
      if (!dateStr) return false;
      const parts = dateStr.split('-');
      let targetYear = currentYear;
      let targetMonth = currentMonth - 1;
      if (targetMonth === 0) {
        targetMonth = 12;
        targetYear -= 1;
      }
      return parseInt(parts[0], 10) === targetYear && parseInt(parts[1], 10) === targetMonth;
    };

    // Spent this month
    if (q.includes('questo mese') && (q.includes('speso') || q.includes('uscita') || q.includes('uscite'))) {
      const total = expenses.filter((t) => isThisMonth(t.data)).reduce((acc, t) => acc + t.importo, 0);
      return `Gemma: In questo mese corrente hai registrato uscite totali per ${formatEuro(total)}.`;
    }

    if (q.includes('questo mese') && (q.includes('guadagnato') || q.includes('entrata') || q.includes('entrate'))) {
      const total = incomes.filter((t) => isThisMonth(t.data)).reduce((acc, t) => acc + t.importo, 0);
      return `Gemma: In questo mese corrente hai registrato entrate totali per ${formatEuro(total)}.`;
    }

    // Spent last month
    if (q.includes('mese scorso') && (q.includes('speso') || q.includes('uscita') || q.includes('uscite'))) {
      const total = expenses.filter((t) => isLastMonth(t.data)).reduce((acc, t) => acc + t.importo, 0);
      return `Gemma: Nel mese scorso hai speso complessivamente ${formatEuro(total)}.`;
    }

    // Balance
    if (q.includes('saldo') || q.includes('bilancio') || q.includes('risparmi') || q.includes('totale')) {
      const balance = totalIncome - totalExpense;
      return `Gemma: Il tuo saldo storico complessivo è pari a ${formatEuro(balance)}. (Entrate: ${formatEuro(totalIncome)} | Uscite: ${formatEuro(totalExpense)}).`;
    }

    // Max expense
    if (q.includes('spesa più grande') || q.includes('spesa maggiore') || q.includes('uscita più alta') || q.includes('speso di più')) {
      if (expenses.length === 0) {
        return 'Gemma: Al momento non ho registrato uscite storiche nel database.';
      }
      const maxExp = expenses.reduce((max, t) => (t.importo > max.importo ? t : max), expenses[0]);
      return `Gemma: La spesa singola maggiore registrata è di ${formatEuro(maxExp.importo)} per "${maxExp.titolo}" (categoria: ${maxExp.categoria}) effettuata in data ${maxExp.data}.`;
    }

    // Average necessity
    if (q.includes('necessità') || q.includes('necessita')) {
      if (expenses.length === 0) {
        return 'Gemma: Non ci sono spese registrate per valutare il livello di necessità medio.';
      }
      const totalNeed = expenses.reduce((acc, t) => acc + (t.necessita || 0), 0);
      const avgNeed = totalNeed / expenses.length;
      return `Gemma: L'indice medio di necessità delle tue spese correnti è di ${avgNeed.toFixed(1)} su 10.`;
    }

    // Spent for others
    if (q.includes('per altri') || q.includes('altri')) {
      const totalAltri = expenses
        .filter((t) => t.destinatario === 'altri')
        .reduce((acc, t) => acc + t.importo, 0);
      return `Gemma: Hai registrato un totale di ${formatEuro(totalAltri)} per acquisti destinati ad altre persone.`;
    }

    // Spent for category or keyword search
    if (q.includes('speso per') || q.includes('uscite per')) {
      const match = q.match(/(?:speso per|uscite per)\s+([a-zA-Z0-9\s]+)/i);
      if (match && match[1]) {
        const catTarget = match[1].trim().toLowerCase();
        
        const matchedCat = catsList.find((c) => c.toLowerCase() === catTarget);
        if (matchedCat) {
          const totalCat = expenses
            .filter((t) => t.categoria.toLowerCase() === catTarget)
            .reduce((acc, t) => acc + t.importo, 0);
          return `Gemma: Per la categoria "${matchedCat}" hai speso complessivamente ${formatEuro(totalCat)}.`;
        }

        const matchedTxs = expenses.filter((t) => t.titolo.toLowerCase().includes(catTarget));
        if (matchedTxs.length > 0) {
          const totalTxs = matchedTxs.reduce((acc, t) => acc + t.importo, 0);
          return `Gemma: Trovate ${matchedTxs.length} spese contenenti "${catTarget}" nel titolo. Spesa totale: ${formatEuro(totalTxs)}.`;
        }
      }
    }

    // Analysis
    if (q.includes('consiglio') || q.includes('consigli') || q.includes('analisi') || q.includes('spese') || q.includes('come vado')) {
      if (data.length === 0) {
        return "Gemma: Non posso compilare un'analisi finanziaria poiché non ci sono ancora movimenti registrati.";
      }
      
      const savingRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;
      
      const catMap = {};
      expenses.forEach((t) => {
        catMap[t.categoria] = (catMap[t.categoria] || 0) + t.importo;
      });
      let topCat = '';
      let topCatAmt = 0;
      Object.keys(catMap).forEach((cat) => {
        if (catMap[cat] > topCatAmt) {
          topCat = cat;
          topCatAmt = catMap[cat];
        }
      });

      let advice = `Gemma: Analisi budget completata. Hai inserito ${data.length} transazioni storiche. `;
      advice += `Il saldo netto è ${formatEuro(totalIncome - totalExpense)}. `;
      
      if (totalIncome > 0) {
        if (savingRate > 0) {
          advice += `Risparmi circa il ${savingRate.toFixed(0)}% di ciò che guadagni. Mantieni questa rotta! `;
        } else {
          advice += `Attenzione: le tue spese superano le entrate registrate. `;
        }
      }
      
      if (topCat) {
        advice += `La tua voce di spesa più pesante riguarda la categoria "${topCat}" con un totale di ${formatEuro(topCatAmt)}.`;
      }
      
      return advice;
    }

    return `Gemma: Non sono riuscita a interpretare questa richiesta specifica. Puoi chiedermi ad esempio: "Quanto ho speso questo mese?", "Qual è il mio saldo?", "Analisi spese" o "Quanto ho speso per ${catsList[0] || 'Spesa'}?".`;
  };

  // --- BANKING STYLE DATE FORMATTER FOR HISTORY HEADERS ---
  const formatDateHeader = (dateStr) => {
    const today = new Date().toISOString().split('T')[0];
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().split('T')[0];
    
    if (dateStr === today) return 'Oggi';
    if (dateStr === yesterday) return 'Ieri';
    
    const d = new Date(dateStr);
    return d.toLocaleDateString('it-IT', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  };

  // --- FILTER & SEARCH HISTORY TRANSACTIONS ---
  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch = 
      t.titolo.toLowerCase().includes(historySearch.toLowerCase()) || 
      t.categoria.toLowerCase().includes(historySearch.toLowerCase());
      
    const matchesType = 
      historyFilterType === 'tutti' || 
      t.tipo === historyFilterType;

    return matchesSearch && matchesType;
  });

  // Group filtered transactions by date
  const groupedTransactions = {};
  filteredTransactions.forEach((t) => {
    if (!groupedTransactions[t.data]) {
      groupedTransactions[t.data] = [];
    }
    groupedTransactions[t.data].push(t);
  });

  const sortedDates = Object.keys(groupedTransactions).sort((a, b) => b.localeCompare(a));

  // --- ANALYTICS CALCULATIONS (SVG CHARTS) ---
  const categoryTotals = {};
  transactions
    .filter((t) => t.tipo === 'uscita')
    .forEach((t) => {
      categoryTotals[t.categoria] = (categoryTotals[t.categoria] || 0) + t.importo;
    });

  const sortedCategoryAnalytics = Object.keys(categoryTotals)
    .map((cat) => ({ name: cat, amount: categoryTotals[cat] }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5); 

  const maxCategoryAmt = sortedCategoryAnalytics.length > 0 
    ? Math.max(...sortedCategoryAnalytics.map((c) => c.amount)) 
    : 1;

  // Donut Chart Math
  const totalSum = totalIncome + totalExpense;
  const inRatio = totalSum > 0 ? totalIncome / totalSum : 0;
  const outRatio = totalSum > 0 ? totalExpense / totalSum : 0;
  const circumference = 314.159; 
  const inStrokeDash = inRatio * circumference;
  const outStrokeDash = outRatio * circumference;

  // --- ERROR BOUNDARY LAYOUT ---
  if (!isConfigured) {
    return null;
  }

  // --- LOADER LAYOUT ---
  if (dbLoading) {
    return (
      <div className="app-wrapper" style={{ justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid rgba(0, 0, 0, 0.05)',
            borderTopColor: 'var(--text-primary)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite'
          }}></div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', letterSpacing: '2px', textTransform: 'uppercase', fontWeight: '700' }}>
            Sincronizzazione Database...
          </span>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      {/* Top minimal header navigation */}
      <header className="app-header">
        <div className="logo-container">
          <span className="logo-title">Gemma Budget</span>
          <span className="logo-sub">Smart Tracker</span>
        </div>
        <nav className="nav-bar">
          <button
            className={`nav-btn ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => setActiveTab('home')}
          >
            Home
          </button>
          <button
            className={`nav-btn ${activeTab === 'storico' ? 'active' : ''}`}
            onClick={() => setActiveTab('storico')}
          >
            Storico
          </button>
          <button
            className={`nav-btn ${activeTab === 'analisi' ? 'active' : ''}`}
            onClick={() => setActiveTab('analisi')}
          >
            Analisi
          </button>
          <button
            className={`nav-btn ${activeTab === 'impostazioni' ? 'active' : ''}`}
            onClick={() => setActiveTab('impostazioni')}
          >
            Impostazioni
          </button>
        </nav>
      </header>

      {/* Pages View Router */}
      <main className="app-content">
        
        {/* ================= PAGE 1: HOME (QUICK INSERTION) ================= */}
        {activeTab === 'home' && (
          <div className="form-container-centered">
            {/* Added style minHeight: '520px' to keep the layout rigid when toggling transaction type */}
            <section className="glass-card" style={{ minHeight: '520px' }}>
              <h2 className="section-title">Nuovo Movimento</h2>
              
              <form onSubmit={handleAddTransaction}>
                {/* Switch Button (Entrata / Uscita) */}
                <div className="segment-control">
                  <button
                    type="button"
                    className={`segment-btn ${tipo === 'uscita' ? 'active' : ''}`}
                    onClick={() => setTipo('uscita')}
                  >
                    Uscita
                  </button>
                  <button
                    type="button"
                    className={`segment-btn ${tipo === 'entrata' ? 'active' : ''}`}
                    onClick={() => setTipo('entrata')}
                  >
                    Entrata
                  </button>
                </div>

                {/* Amount Numeric Input */}
                <div className="form-group">
                  <label htmlFor="amount-val" className="form-label">Importo</label>
                  <div className="amount-wrapper">
                    <span className="amount-currency">€</span>
                    <input
                      id="amount-val"
                      type="number"
                      step="0.01"
                      min="0.01"
                      inputMode="decimal"
                      placeholder="0,00"
                      className="amount-input"
                      value={importo}
                      onChange={(e) => setImporto(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Title Text Input (causa / descrizione) */}
                <div className="form-group">
                  <label htmlFor="title-val" className="form-label">Causa / Descrizione</label>
                  <input
                    id="title-val"
                    type="text"
                    placeholder="Es. Spesa Esselunga, Stipendio Maggio, Bolletta Luce..."
                    className="input-text"
                    value={titolo}
                    onChange={(e) => setTitolo(e.target.value)}
                    required
                  />
                </div>

                {/* Dynamic Category Selector */}
                <div className="form-group">
                  <label htmlFor="category-sel" className="form-label">Categoria</label>
                  <select
                    id="category-sel"
                    className="select-input"
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    {categories.length === 0 && (
                      <option value="Senza Categoria">Senza Categoria</option>
                    )}
                  </select>
                </div>

                {/* Conditional Fields: Only if 'uscita' (Expense) */}
                {tipo === 'uscita' && (
                  <>
                    {/* Toggle: Per me / Per altri */}
                    <div className="form-group">
                      <div className="toggle-wrapper">
                        <span className="toggle-label">Beneficiario</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="toggle-state-text">
                            {destinatario === 'me' ? 'Per Me' : 'Per Altri'}
                          </span>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={destinatario === 'altri'}
                              onChange={(e) => setDestinatario(e.target.checked ? 'altri' : 'me')}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Necessity range index slider (1-10) */}
                    <div className="form-group">
                      <div className="range-container">
                        <div className="range-header">
                          <label htmlFor="need-slider" className="form-label">Necessità Spesa</label>
                          <span className="range-value">{necessita}/10</span>
                        </div>
                        <input
                          id="need-slider"
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          className="range-input"
                          value={necessita}
                          onChange={(e) => setNecessita(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                <button type="submit" className="btn-primary">
                  Registra movimento
                </button>
              </form>
            </section>
          </div>
        )}

        {/* ================= PAGE 2: STORICO (BANKING STYLE LIST) ================= */}
        {activeTab === 'storico' && (
          /* Uses the history-layout class from index.css to stack properly on mobile devices */
          <div className="history-layout">
            
            {/* Left Column: Quick Stats & Filters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Financial Balance Summary Card */}
              <section className="glass-card" style={{ padding: '20px' }}>
                <h2 className="section-title" style={{ fontSize: '0.75rem' }}>Riepilogo Totali</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '10px' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Bilancio Disponibile
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: '800', wordBreak: 'break-all' }}>
                      €{netBalance.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ height: '1px', background: 'rgba(0,0,0,0.05)' }}></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Entrate:</span>
                    <span style={{ fontWeight: '700' }}>€{totalIncome.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Uscite:</span>
                    <span style={{ fontWeight: '700', color: 'var(--text-secondary)' }}>- €{totalExpense.toFixed(2)}</span>
                  </div>
                </div>
              </section>

              {/* Filtering Controls Card */}
              <section className="glass-card" style={{ padding: '20px' }}>
                <h2 className="section-title" style={{ fontSize: '0.75rem' }}>Filtri Ricerca</h2>
                
                {/* Search text input */}
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label htmlFor="h-search" className="form-label" style={{ fontSize: '0.6rem' }}>Cerca Causa o Categoria</label>
                  <input
                    id="h-search"
                    type="text"
                    placeholder="Cerca..."
                    className="search-input"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                </div>

                {/* Filter Tabs Type */}
                <div className="form-group" style={{ marginBottom: '0' }}>
                  <label className="form-label" style={{ fontSize: '0.6rem' }}>Filtra Tipo</label>
                  <div className="filter-pills">
                    <button
                      className={`filter-pill ${historyFilterType === 'tutti' ? 'active' : ''}`}
                      onClick={() => setHistoryFilterType('tutti')}
                    >
                      Tutti
                    </button>
                    <button
                      className={`filter-pill ${historyFilterType === 'entrata' ? 'active' : ''}`}
                      onClick={() => setHistoryFilterType('entrata')}
                    >
                      Entrate
                    </button>
                    <button
                      className={`filter-pill ${historyFilterType === 'uscita' ? 'active' : ''}`}
                      onClick={() => setHistoryFilterType('uscita')}
                    >
                      Uscite
                    </button>
                  </div>
                </div>
              </section>
            </div>

            {/* Right Column: Transactions List Grouped by Date */}
            <section className="glass-card">
              <h2 className="section-title">Lista Movimenti</h2>
              
              <div style={{ marginTop: '10px' }}>
                {sortedDates.length === 0 ? (
                  <p className="empty-msg">Nessun movimento corrisponde ai filtri impostati.</p>
                ) : (
                  sortedDates.map((dateStr) => (
                    <div key={dateStr} className="history-day-group">
                      <div className="history-day-header">
                        {formatDateHeader(dateStr)}
                      </div>
                      
                      {groupedTransactions[dateStr].map((t) => (
                        <div key={t.id} className="history-item">
                          <div className="h-info">
                            <span className="h-title">{t.titolo}</span>
                            <div className="h-meta">
                              <span className="h-tag category">{t.categoria}</span>
                              {t.tipo === 'uscita' && (
                                <>
                                  <span className="h-tag recipient">
                                    {t.destinatario === 'me' ? 'Per Me' : 'Per Altri'}
                                  </span>
                                  <span className="h-tag need">
                                    Nec: {t.necessita}/10
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          
                          <div className="h-right">
                            <span className={`h-amount ${t.tipo}`}>
                              {t.tipo === 'entrata' ? '+' : '-'} €{t.importo.toFixed(2)}
                            </span>
                            <button
                              onClick={() => handleDeleteTransaction(t.id)}
                              className="btn-icon-delete"
                            >
                              Elimina
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* ================= PAGE 3: ANALISI (SVG CHARTS & GEMMA AI) ================= */}
        {activeTab === 'analisi' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Top Stat Banner */}
            <div className="stats-banner">
              <div className="stat-card">
                <span className="stat-card-label">Entrate Totali</span>
                <span className="stat-card-val">€{totalIncome.toFixed(2)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card-label">Uscite Totali</span>
                <span className="stat-card-val">€{totalExpense.toFixed(2)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card-label">Risparmio Netto</span>
                <span className="stat-card-val">€{netBalance.toFixed(2)}</span>
              </div>
            </div>

            {/* Middle Section: SVG Charts Side-by-Side */}
            <div className="charts-grid">
              
              {/* Chart 1: Expenses Category Distribution */}
              <section className="glass-card chart-card">
                <h2 className="section-title">Spese per Categoria (Top 5)</h2>
                
                {sortedCategoryAnalytics.length === 0 ? (
                  <p className="empty-msg">Nessuna uscita registrata per generare le statistiche.</p>
                ) : (
                  <div className="svg-chart-container">
                    <svg width="100%" height={sortedCategoryAnalytics.length * 42} style={{ overflow: 'visible' }}>
                      {sortedCategoryAnalytics.map((cat, idx) => {
                        const barWidth = (cat.amount / maxCategoryAmt) * 80; 
                        return (
                          <g key={cat.name} transform={`translate(0, ${idx * 42})`}>
                            <text x="0" y="14" fill="var(--text-secondary)" fontSize="11" fontWeight="700" textTransform="uppercase" letterSpacing="0.5px">
                              {cat.name}
                            </text>
                            <rect x="0" y="22" width="100%" height="4" rx="2" fill="rgba(0, 0, 0, 0.03)" />
                            <rect x="0" y="22" width={`${barWidth}%`} height="4" rx="2" fill="var(--text-primary)" />
                            <text x="100%" textAnchor="end" y="14" fill="var(--text-primary)" fontSize="11" fontWeight="800">
                              €{cat.amount.toFixed(2)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                )}
              </section>

              {/* Chart 2: Income vs Expense Circle Donut */}
              <section className="glass-card chart-card" style={{ alignItems: 'center' }}>
                <h2 className="section-title" style={{ width: '100%' }}>Rapporto Entrate / Uscite</h2>
                
                {totalSum === 0 ? (
                  <p className="empty-msg">Nessuna transazione disponibile.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%' }}>
                    <div className="svg-chart-container" style={{ minHeight: '180px' }}>
                      <svg width="180" height="180" viewBox="0 0 180 180">
                        <circle
                          cx="90"
                          cy="90"
                          r="50"
                          fill="transparent"
                          stroke="rgba(0, 0, 0, 0.03)"
                          strokeWidth="12"
                        />
                        {totalIncome > 0 && (
                          <circle
                            cx="90"
                            cy="90"
                            r="50"
                            fill="transparent"
                            stroke="var(--text-primary)"
                            strokeWidth="12"
                            strokeDasharray={`${inStrokeDash} ${circumference}`}
                            strokeDashoffset="0"
                            strokeLinecap="round"
                            transform="rotate(-90 90 90)"
                          />
                        )}
                        {totalExpense > 0 && (
                          <circle
                            cx="90"
                            cy="90"
                            r="50"
                            fill="transparent"
                            stroke="var(--text-muted)"
                            strokeWidth="12"
                            strokeDasharray={`${outStrokeDash} ${circumference}`}
                            strokeDashoffset={-inStrokeDash}
                            strokeLinecap="round"
                            transform="rotate(-90 90 90)"
                          />
                        )}
                        <text x="90" y="86" textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontWeight="800" letterSpacing="1.5">
                          NETTO
                        </text>
                        <text x="90" y="104" textAnchor="middle" fill="var(--text-primary)" fontSize="16" fontWeight="800">
                          €{netBalance.toFixed(0)}
                        </text>
                      </svg>
                    </div>

                    <div className="chart-legend" style={{ width: '100%', maxWidth: '240px' }}>
                      <div className="legend-item">
                        <div className="legend-label-group">
                          <span className="legend-bullet" style={{ background: 'var(--text-primary)' }}></span>
                          <span className="legend-name">Entrate</span>
                        </div>
                        <span className="legend-value">{totalIncome > 0 ? ((totalIncome / totalSum) * 100).toFixed(0) : 0}%</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-label-group">
                          <span className="legend-bullet" style={{ background: 'var(--text-muted)' }}></span>
                          <span className="legend-name">Uscite</span>
                        </div>
                        <span className="legend-value">{totalExpense > 0 ? ((totalExpense / totalSum) * 100).toFixed(0) : 0}%</span>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Bottom Section: AI Assistant Gemma */}
            <section className="glass-card ai-section">
              <div className="ai-header">
                <span className="ai-indicator"></span>
                <h2 className="ai-title">Assistente Gemma AI</h2>
              </div>
              
              <form onSubmit={handleAiSubmit} className="ai-form">
                <input
                  type="text"
                  placeholder="Chiedi a Gemma..."
                  className="ai-input"
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  required
                />
                <button type="submit" className="ai-btn" disabled={aiLoading}>
                  Invia
                </button>
              </form>
              
              {aiLoading ? (
                <div className="ai-response-box loading">
                  <span>Analisi in corso...</span>
                </div>
              ) : (
                <div className="ai-response-box" style={{ whiteSpace: 'pre-line' }}>
                  {aiResponse}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ================= PAGE 4: IMPOSTAZIONI (CATEGORIES CRUD) ================= */}
        {activeTab === 'impostazioni' && (
          <div className="grid-2col" style={{ alignItems: 'start' }}>
            
            {/* Left column: Add Category Form */}
            <section className="glass-card">
              <h2 className="section-title">Aggiungi Categoria</h2>
              
              <form onSubmit={handleAddCategory}>
                <div className="form-group">
                  <label htmlFor="new-cat-inp" className="form-label">Nome Categoria</label>
                  <input
                    id="new-cat-inp"
                    type="text"
                    placeholder="Es. Ristoranti, Abbigliamento..."
                    className="input-text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary">
                  Crea Categoria
                </button>
              </form>
            </section>

            {/* Right column: Categories List with Cascade editing */}
            <section className="glass-card">
              <h2 className="section-title">Elenco Categorie</h2>
              
              <div style={{ marginTop: '10px' }}>
                {categories.length === 0 ? (
                  <p className="empty-msg">Nessuna categoria registrata.</p>
                ) : (
                  categories.map((cat) => (
                    <div key={cat} className="category-item">
                      {renamingId === cat ? (
                        <div className="cat-edit-wrapper">
                          <input
                            type="text"
                            className="cat-input-inline"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveRename(cat)}
                            className="btn-cat save"
                          >
                            Salva
                          </button>
                          <button
                            onClick={() => setRenamingId(null)}
                            className="btn-cat cancel"
                          >
                            Annulla
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="cat-name-display">{cat}</span>
                          <div className="cat-actions">
                            <button
                              onClick={() => handleStartRename(cat)}
                              className="btn-cat rename"
                            >
                              Rinomina
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(cat)}
                              className="btn-cat delete"
                            >
                              Elimina
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
        
      </main>
    </div>
  );
}

export default App;
