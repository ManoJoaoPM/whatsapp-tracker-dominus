import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

/**
 * Public page opened by a customer from the link sent by the agency. No login: the token in the
 * address is the only credential. The job of this page is one thing: get a WhatsApp number
 * linked with as little friction as possible, then say thanks.
 */

type View = 'loading' | 'invalid' | 'expired' | 'revoked' | 'error' | 'ready' | 'connecting' | 'connected';
type Mode = 'qr' | 'code';

const POLL_MS = 3000;
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';

const isPhone = (): boolean => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const qrSrc = (qr: string): string => (qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`);

/** "WZYEH1YY" -> "WZYE-H1YY" */
const formatPairingCode = (code: string): string => {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
};

const messageFrom = (error: any, fallback: string): string => {
  const status = error?.response?.status;
  if (status === 429) return 'Muitas tentativas seguidas. Aguarde um instante e tente de novo.';
  return error?.response?.data?.message || fallback;
};

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

const STYLE = `
.pc-root { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.pc-check-circle { stroke-dasharray: 164; stroke-dashoffset: 164; animation: pc-draw .7s ease-out .1s forwards; }
.pc-check-mark { stroke-dasharray: 40; stroke-dashoffset: 40; animation: pc-draw .45s ease-out .65s forwards; }
@keyframes pc-draw { to { stroke-dashoffset: 0; } }
.pc-pulse { animation: pc-pulse 1.6s ease-in-out infinite; }
@keyframes pc-pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .pc-check-circle, .pc-check-mark { animation: none; stroke-dashoffset: 0; }
  .pc-pulse { animation: none; opacity: 1; }
}
`;

const Path: React.FC<{ items: string[] }> = ({ items }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
    {items.map((item, i) => (
      <React.Fragment key={item}>
        {i > 0 && <span aria-hidden className="text-zinc-400">›</span>}
        <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[0.92em] font-semibold text-zinc-800">{item}</span>
      </React.Fragment>
    ))}
  </span>
);

const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center justify-center rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60 ${className}`}
  />
);

const LinkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', ...props }) => (
  <button
    {...props}
    className={`text-sm font-semibold text-primary-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded disabled:opacity-60 ${className}`}
  />
);

const Steps: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ol className="space-y-5">
    {items.map((item, i) => (
      <li key={i} className="flex gap-4">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white">
          {i + 1}
        </span>
        <div className="text-base leading-relaxed text-zinc-700">{item}</div>
      </li>
    ))}
  </ol>
);

const Message: React.FC<{ title: string; text: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <div className="mx-auto max-w-md py-16 text-center">
    <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900">{title}</h1>
    <p className="mt-3 text-base leading-relaxed text-zinc-600">{text}</p>
    {action && <div className="mt-6">{action}</div>}
  </div>
);

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const PublicConnect: React.FC = () => {
  const { token = '' } = useParams();
  const api = `/api/public/connect/${encodeURIComponent(token)}`;

  const [view, setView] = useState<View>('loading');
  const [companyName, setCompanyName] = useState('');
  const [label, setLabel] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>(isPhone() ? 'code' : 'qr');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const startRetries = useRef(0);

  useEffect(() => {
    document.title = 'Conectar WhatsApp';
    if (!document.querySelector('link[data-pc-font]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FONT_HREF;
      link.setAttribute('data-pc-font', '1');
      document.head.appendChild(link);
    }
  }, []);

  const applyEnded = useCallback((status: string) => {
    if (status === 'connected') setView('connected');
    else if (status === 'expired') setView('expired');
    else if (status === 'revoked') setView('revoked');
  }, []);

  const loadInfo = useCallback(async () => {
    setView('loading');
    try {
      const { data } = await axios.get(api);
      setCompanyName(String(data?.companyName || ''));
      setLabel(data?.label || null);
      if (data?.status === 'ready' || data?.status === 'in_progress') setView('ready');
      else applyEnded(String(data?.status));
    } catch (e: any) {
      setView(e?.response?.status === 404 ? 'invalid' : 'error');
    }
  }, [api, applyEnded]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  /** Asks for a fresh QR code (also creates the connection the first time) */
  const requestQr = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { status, data } = await axios.post(`${api}/start`);
      if (status === 202) {
        // the connection is still being prepared: try again shortly
        if (startRetries.current < 8) {
          startRetries.current += 1;
          window.setTimeout(() => void requestQr(), 2000);
        } else {
          setProblem('A conexão está demorando para ficar pronta. Tente de novo em instantes.');
        }
        return;
      }
      startRetries.current = 0;
      if (data?.status === 'connected') {
        setView('connected');
        return;
      }
      if (data?.qrCode) {
        setQrCode(String(data.qrCode));
        setSecondsLeft(Number(data.refreshAfterSeconds) || 25);
      }
    } catch (e: any) {
      if (e?.response?.status === 410) applyEnded(String(e.response.data?.status));
      else {
        setProblem(messageFrom(e, 'Não foi possível gerar o código. Tente de novo.'));
        setSecondsLeft(10);
      }
    } finally {
      setBusy(false);
    }
  }, [api, applyEnded]);

  const requestPairing = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { status, data } = await axios.post(`${api}/pairing`, { phone });
      if (status === 202) {
        setProblem('A conexão está sendo preparada. Toque em gerar código de novo em alguns segundos.');
        return;
      }
      if (data?.status === 'connected') {
        setView('connected');
        return;
      }
      if (data?.pairingCode) setPairingCode(String(data.pairingCode));
    } catch (e: any) {
      if (e?.response?.status === 410) applyEnded(String(e.response.data?.status));
      else setProblem(messageFrom(e, 'Não foi possível gerar o código. Tente de novo.'));
    } finally {
      setBusy(false);
    }
  }, [api, phone, applyEnded]);

  const begin = () => {
    setView('connecting');
    if (mode === 'qr') void requestQr();
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setProblem(null);
    if (next === 'qr' && !qrCode) void requestQr();
  };

  // While connecting: watch for the moment the number is linked
  useEffect(() => {
    if (view !== 'connecting') return;
    const timer = window.setInterval(async () => {
      try {
        const { data } = await axios.get(`${api}/status`);
        if (data?.status === 'connected' || data?.status === 'expired' || data?.status === 'revoked') {
          applyEnded(String(data.status));
        }
      } catch {
        // a failed check is not a problem: the next one will tell
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [view, api, applyEnded]);

  // QR codes rotate every few seconds: count down, then renew before it stops working
  useEffect(() => {
    if (view !== 'connecting' || mode !== 'qr' || !qrCode) return;
    const timer = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [view, mode, qrCode]);

  useEffect(() => {
    if (view === 'connecting' && mode === 'qr' && qrCode && secondsLeft === 0 && !busy) void requestQr();
  }, [secondsLeft, view, mode, qrCode, busy, requestQr]);

  const company = companyName || 'sua empresa';
  const onPhone = isPhone();

  /* ---------------- screens ---------------- */

  let body: React.ReactNode;

  if (view === 'loading') {
    body = (
      <div className="py-24 text-center text-zinc-500" role="status">
        Carregando…
      </div>
    );
  } else if (view === 'invalid') {
    body = (
      <Message
        title="Link não encontrado"
        text="Confira se o endereço está completo ou peça um novo link a quem enviou este."
      />
    );
  } else if (view === 'expired') {
    body = <Message title="Este link expirou" text="Peça um novo link a quem enviou este e conecte em um minuto." />;
  } else if (view === 'revoked') {
    body = <Message title="Este link foi cancelado" text="Peça um novo link a quem enviou este." />;
  } else if (view === 'error') {
    body = (
      <Message
        title="Não foi possível carregar"
        text="Verifique sua internet e tente de novo."
        action={<PrimaryButton onClick={() => void loadInfo()}>Tentar de novo</PrimaryButton>}
      />
    );
  } else if (view === 'ready') {
    body = (
      <div className="mx-auto max-w-xl py-10 sm:py-20">
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-5xl">
          Conecte o WhatsApp da {companyName || 'sua empresa'}
        </h1>
        <p className="mt-5 max-w-prose text-lg leading-relaxed text-zinc-600">
          Vamos ligar o número que atende seus clientes. Leva cerca de um minuto, e você só precisa do celular com o
          WhatsApp.
        </p>
        {label && (
          <p className="mt-3 text-base text-zinc-600">
            Este número vai aparecer como <strong className="font-semibold text-zinc-800">{label}</strong>.
          </p>
        )}
        <div className="mt-8">
          <PrimaryButton onClick={begin} className="w-full sm:w-auto">
            Conectar
          </PrimaryButton>
        </div>
        <p className="mt-8 max-w-prose text-sm leading-relaxed text-zinc-500">
          Ao conectar, {company} passa a acompanhar as conversas deste número para medir o resultado dos anúncios.
          Você pode desconectar quando quiser em Aparelhos conectados, no próprio WhatsApp.
        </p>
      </div>
    );
  } else if (view === 'connected') {
    body = (
      <div className="mx-auto max-w-md py-16 text-center sm:py-24" role="status">
        <svg viewBox="0 0 64 64" className="mx-auto h-24 w-24" fill="none" aria-hidden>
          <circle className="pc-check-circle" cx="32" cy="32" r="26" stroke="#16A34A" strokeWidth="4" strokeLinecap="round" />
          <path className="pc-check-mark" d="M20 33l8 8 16-17" stroke="#16A34A" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-zinc-900 sm:text-4xl">WhatsApp conectado</h1>
        <p className="mt-3 text-lg leading-relaxed text-zinc-600">Tudo certo. Você já pode fechar esta página.</p>
      </div>
    );
  } else {
    // connecting
    const menuPath = (
      <>
        <Path items={['Aparelhos conectados']} />, que fica em <Path items={['⋮']} /> no Android ou em{' '}
        <Path items={['Configurações']} /> no iPhone.
      </>
    );

    body =
      mode === 'qr' ? (
        <div className="grid gap-10 py-8 sm:py-14 lg:grid-cols-[1fr_auto] lg:gap-16">
          <div className="max-w-xl">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-4xl">
              Escaneie o código com o WhatsApp
            </h1>
            <div className="mt-8">
              <Steps
                items={[
                  <>Abra o WhatsApp no celular do número que atende seus clientes.</>,
                  <>Vá em {menuPath}</>,
                  <>
                    Toque em <Path items={['Conectar um aparelho']} />.
                  </>,
                  <>Aponte a câmera do celular para o código {onPhone ? 'em outra tela' : 'ao lado'}.</>,
                ]}
              />
            </div>
            <div className="mt-8 border-t border-zinc-200 pt-5">
              <p className="text-sm text-zinc-600">
                {onPhone ? 'Este celular é o mesmo do WhatsApp? ' : 'Prefere conectar sem escanear? '}
                <LinkButton onClick={() => switchMode('code')}>Conectar com um código</LinkButton>
              </p>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[320px] lg:mx-0">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-4 ring-primary">
              <div className="flex aspect-square w-full items-center justify-center">
                {qrCode ? (
                  <img src={qrSrc(qrCode)} alt="QR code para conectar o WhatsApp" className="h-full w-full object-contain" />
                ) : (
                  <span className="pc-pulse text-sm text-zinc-500" role="status">
                    Gerando o código…
                  </span>
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 text-sm text-zinc-600">
              <span aria-live="polite">{qrCode ? `O código se renova em ${secondsLeft} s` : ' '}</span>
              <LinkButton onClick={() => void requestQr()} disabled={busy}>
                Gerar novo código
              </LinkButton>
            </div>
            {problem && <p className="mt-3 text-sm text-red-600" role="alert">{problem}</p>}
            <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500" aria-live="polite">
              <span className="pc-pulse inline-block h-2 w-2 rounded-full bg-primary" aria-hidden />
              Aguardando você escanear o código
            </p>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-xl py-8 sm:py-14">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-4xl">
            Conecte com um código
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-600">
            Funciona direto no celular, sem precisar escanear nada.
          </p>

          <form
            className="mt-8"
            onSubmit={(e) => {
              e.preventDefault();
              void requestPairing();
            }}
          >
            <label htmlFor="pc-phone" className="block text-sm font-semibold text-zinc-800">
              Número do WhatsApp que você vai conectar
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="pc-phone"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 91234-5678"
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3.5 text-base text-zinc-900 placeholder-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <PrimaryButton type="submit" disabled={busy || phone.replace(/\D/g, '').length < 10} className="sm:shrink-0">
                {pairingCode ? 'Gerar outro código' : 'Gerar código'}
              </PrimaryButton>
            </div>
          </form>

          {problem && <p className="mt-4 text-sm text-red-600" role="alert">{problem}</p>}

          {pairingCode && (
            <div className="mt-8">
              <div className="rounded-2xl bg-white px-6 py-6 text-center shadow-sm ring-4 ring-primary">
                <div
                  className="text-4xl font-extrabold tracking-[0.18em] text-zinc-900 sm:text-5xl"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                  aria-label={`Código ${formatPairingCode(pairingCode).split('').join(' ')}`}
                >
                  {formatPairingCode(pairingCode)}
                </div>
              </div>
              <div className="mt-8">
                <Steps
                  items={[
                    <>Abra o WhatsApp e vá em {menuPath}</>,
                    <>
                      Toque em <Path items={['Conectar um aparelho']} />.
                    </>,
                    <>
                      Escolha <Path items={['Conectar com número de telefone']} />.
                    </>,
                    <>Digite o código acima. Ele vale por pouco tempo; se não funcionar, gere outro.</>,
                  ]}
                />
              </div>
              <p className="mt-6 flex items-center gap-2 text-sm text-zinc-500" aria-live="polite">
                <span className="pc-pulse inline-block h-2 w-2 rounded-full bg-primary" aria-hidden />
                Aguardando você digitar o código
              </p>
            </div>
          )}

          <div className="mt-8 border-t border-zinc-200 pt-5">
            <p className="text-sm text-zinc-600">
              Está em um computador? <LinkButton onClick={() => switchMode('qr')}>Escanear um QR code</LinkButton>
            </p>
          </div>
        </div>
      );
  }

  return (
    <div className="pc-root min-h-screen bg-[#fafafa] text-zinc-900">
      <style>{STYLE}</style>
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 pt-6 sm:px-8">
        <img src="/logo-institucional.png" alt="Astro Dominus" className="h-8 object-contain" />
        {companyName && view !== 'loading' && view !== 'invalid' && (
          <span className="truncate text-sm font-semibold text-zinc-600">{companyName}</span>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-5 sm:px-8">{body}</main>
      <footer className="mx-auto max-w-5xl px-5 pb-8 pt-4 text-sm text-zinc-500 sm:px-8">
        {view !== 'connected' && view !== 'loading' && <p>Precisa de ajuda? Fale com quem enviou este link.</p>}
      </footer>
    </div>
  );
};

export default PublicConnect;
