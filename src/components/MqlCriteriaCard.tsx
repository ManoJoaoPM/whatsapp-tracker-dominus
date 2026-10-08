import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Plus, Trash2 } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

type Criterion = {
  id: string;
  label: string;
  description: string;
  weight: number;
  source: 'lead' | 'any';
};

type Template = { id: string; name: string; description: string; criteria: Criterion[] };

const MAX_CRITERIA = 12;
const MAX_CONTEXT = 2000;

const slug = (value: string): string => {
  const base = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return /^[a-z]/.test(base) ? base : `c_${base}`;
};

const MqlCriteriaCard: React.FC = () => {
  const { user, selectedClientId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('generic');
  const [rules, setRules] = useState('');
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const config = useMemo(
    () => ({ headers: { Authorization: `Bearer ${user?.token}`, 'x-client-id': selectedClientId } }),
    [user?.token, selectedClientId],
  );

  const load = useCallback(async () => {
    if (!user || !selectedClientId) return;
    setLoading(true);
    setStatus(null);
    try {
      const { data } = await axios.get('/api/mql/config', config);
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
      setTemplateId(String(data?.template || 'generic'));
      setRules(String(data?.rules || ''));
      setCriteria(Array.isArray(data?.criteria) ? data.criteria : []);
    } catch (e: any) {
      setStatus(e?.response?.data?.message || 'Não foi possível carregar os critérios.');
    } finally {
      setLoading(false);
    }
  }, [user, selectedClientId, config]);

  useEffect(() => {
    load();
  }, [load]);

  const positiveTotal = criteria.filter((c) => c.weight > 0).reduce((sum, c) => sum + c.weight, 0);

  const applyTemplate = () => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    if (!window.confirm(`Aplicar o modelo "${template.name}"? Os critérios atuais serão substituídos (só vale depois de salvar).`)) return;
    setCriteria(template.criteria.map((c) => ({ ...c })));
    setStatus('Modelo aplicado. Clique em Salvar para confirmar.');
  };

  const update = (index: number, patch: Partial<Criterion>) => {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const addCriterion = () => {
    if (criteria.length >= MAX_CRITERIA) return;
    const used = new Set(criteria.map((c) => c.id));
    let n = criteria.length + 1;
    while (used.has(`criterio_${n}`)) n += 1;
    setCriteria((prev) => [
      ...prev,
      { id: `criterio_${n}`, label: '', description: '', weight: 10, source: 'lead' },
    ]);
  };

  const save = async () => {
    if (!user || !selectedClientId) return;
    setSaving(true);
    setStatus(null);
    try {
      // Criteria created in the UI get an id derived from the label
      const used = new Set<string>();
      const payload = criteria.map((c) => {
        const id = c.id.startsWith('criterio_') && c.label.trim() ? slug(c.label) : c.id;
        let candidate = id;
        let n = 2;
        while (used.has(candidate)) candidate = `${id}_${n++}`;
        used.add(candidate);
        return { ...c, id: candidate, weight: Number(c.weight) };
      });

      const { data } = await axios.put('/api/mql/config', { rules, criteria: payload, template: templateId }, config);
      setCriteria(Array.isArray(data?.criteria) ? data.criteria : payload);
      setStatus('Salvo. Vale para as próximas avaliações.');
    } catch (e: any) {
      setStatus(e?.response?.data?.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  if (!user || !selectedClientId) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-100 overflow-hidden">
      <div className="p-6 border-b border-zinc-100">
        <div className="text-lg font-semibold text-zinc-900">Qualificação por IA</div>
        <div className="text-sm text-zinc-500 mt-1">
          A IA lê a conversa e julga cada critério citando um trecho real. A nota é a soma dos pontos dos critérios comprovados:
          de 0 a 39 é frio, de 40 a 69 é morno e a partir de 70 é quente.
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-zinc-700 mb-2">Modelo por segmento</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={loading || saving}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.description}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={applyTemplate}
            disabled={loading || saving || templates.length === 0}
            className="px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            Aplicar modelo
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-2">
            Contexto do negócio <span className="text-zinc-400 font-normal">(o que vocês vendem e quem é o cliente ideal)</span>
          </label>
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value.slice(0, MAX_CONTEXT))}
            rows={3}
            disabled={loading || saving}
            placeholder="Ex.: Vendemos apartamentos de 2 e 3 quartos na zona sul de São Paulo, ticket a partir de R$ 400 mil."
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <div className="text-[11px] text-zinc-400 text-right">{rules.length}/{MAX_CONTEXT}</div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-zinc-700">Critérios</label>
            <span className={`text-xs ${positiveTotal === 100 ? 'text-zinc-500' : 'text-amber-600'}`}>
              Pontos positivos somam {positiveTotal}
              {positiveTotal !== 100 ? ' (recomendado: 100)' : ''}
            </span>
          </div>

          <div className="space-y-3">
            {criteria.map((c, i) => (
              <div key={`${c.id}-${i}`} className="border border-zinc-200 rounded-lg p-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    value={c.label}
                    onChange={(e) => update(i, { label: e.target.value.slice(0, 80) })}
                    placeholder="Nome do critério"
                    disabled={saving}
                    className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                  <input
                    type="number"
                    value={c.weight}
                    min={-50}
                    max={50}
                    onChange={(e) => update(i, { weight: Number(e.target.value) })}
                    disabled={saving}
                    title="Pontos (negativo = penalidade)"
                    className="w-20 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                  <select
                    value={c.source}
                    onChange={(e) => update(i, { source: e.target.value as 'lead' | 'any' })}
                    disabled={saving}
                    title="Quem precisa ter escrito a evidência"
                    className="w-40 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm outline-none"
                  >
                    <option value="lead">Fala do lead</option>
                    <option value="any">Lead ou empresa</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setCriteria((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={saving}
                    className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                    title="Remover"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <textarea
                  value={c.description}
                  onChange={(e) => update(i, { description: e.target.value.slice(0, 400) })}
                  rows={2}
                  placeholder="Quando este critério está atendido? Seja específico."
                  disabled={saving}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addCriterion}
            disabled={saving || criteria.length >= MAX_CRITERIA}
            className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            <Plus size={14} />
            Adicionar critério ({criteria.length}/{MAX_CRITERIA})
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-zinc-500 min-h-[16px]">{loading ? 'Carregando…' : status || ''}</div>
          <button
            type="button"
            onClick={save}
            disabled={loading || saving || criteria.length === 0}
            className="px-3 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MqlCriteriaCard;
