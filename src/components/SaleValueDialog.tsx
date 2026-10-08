import React, { useEffect, useState } from 'react';
import { formatMoney, parseMoneyInput } from '../lib/money';

type Props = {
  open: boolean;
  leadName: string;
  /** value found by the AI in the conversation (a suggestion only) */
  suggested?: number;
  /** current value when editing an already closed sale */
  current?: number;
  /** true when the sale is already closed and only the value is being set */
  editing?: boolean;
  onConfirm: (value: number | null) => void;
  onCancel: () => void;
};

const SaleValueDialog: React.FC<Props> = ({ open, leadName, suggested, current, editing, onConfirm, onCancel }) => {
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText(current ? String(current).replace('.', ',') : '');
  }, [open, current]);

  if (!open) return null;

  const parsed = parseMoneyInput(text);
  const invalid = text.trim() !== '' && parsed === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-lg border border-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-zinc-200">
          <h4 className="font-semibold text-zinc-900">{editing ? 'Valor da venda' : 'Concluir venda'}</h4>
          <p className="text-xs text-zinc-500 truncate">{leadName}</p>
        </div>

        <div className="p-4 space-y-3">
          <label className="block text-sm text-zinc-700">
            Qual foi o valor total da venda?
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-zinc-500">R$</span>
              <input
                autoFocus
                inputMode="decimal"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && parsed) onConfirm(parsed);
                }}
                placeholder="0,00"
                className={`flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 ${
                  invalid ? 'border-red-300' : 'border-zinc-200 focus:border-primary'
                }`}
              />
            </div>
          </label>

          {invalid && <p className="text-xs text-red-600">Digite um valor válido, por exemplo 1.500,00.</p>}

          {typeof suggested === 'number' && suggested > 0 && (
            <button
              type="button"
              onClick={() => setText(String(suggested).replace('.', ','))}
              className="w-full text-left text-xs rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-700 hover:bg-zinc-100"
            >
              A IA encontrou <strong>{formatMoney(suggested)}</strong> na conversa. Clique para usar (confira antes).
            </button>
          )}

          <p className="text-xs text-zinc-500">
            O valor é enviado ao Meta no evento de compra e permite otimizar os anúncios por retorno. Sem valor, a venda é registrada, mas o evento de compra não é enviado.
          </p>
        </div>

        <div className="p-4 border-t border-zinc-200 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm px-3 py-2 rounded border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
          >
            Cancelar
          </button>
          <div className="flex gap-2">
            {!editing && (
              <button
                type="button"
                onClick={() => onConfirm(null)}
                className="text-sm px-3 py-2 rounded border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              >
                Concluir sem valor
              </button>
            )}
            <button
              type="button"
              disabled={!parsed}
              onClick={() => parsed && onConfirm(parsed)}
              className="text-sm px-3 py-2 rounded bg-primary text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {editing ? 'Salvar valor' : 'Concluir venda'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaleValueDialog;
