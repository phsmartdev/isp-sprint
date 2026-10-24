/** Abre o e-mail anexado à negociação (cópia do original): quem vê a negociação lê aqui, com os anexos de dentro do e-mail. */
import { useQuery } from '@tanstack/react-query';
import { Download, Paperclip } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { ErrorState, LoadingRows } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/overlay';

type Addr = { name: string | null; address: string };
type View = { filename: string; subject: string; date: string | null; from: Addr | null; to: Addr[]; cc: Addr[]; text: string | null; html: string | null; attachments: { index: number; filename: string; contentType: string; size: number }[] };

const who = (a: Addr) => (a.name ? `${a.name} <${a.address}>` : a.address);
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// o HTML do e-mail roda isolado: sem scripts, sem formulários, sem acesso à página; só imagens e estilos
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:">`;
const doc = (html: string) => `<!doctype html><html><head><meta charset="utf-8">${CSP}<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#1f2937;margin:12px;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;

export function EmailViewer({ oppId, attachmentId, onClose }: { oppId: string; attachmentId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['email-view', attachmentId], enabled: !!attachmentId, queryFn: () => api<View>(`/opportunities/${oppId}/attachments/${attachmentId}/email`) });
  const d = q.data;
  return (
    <Modal open={!!attachmentId} onClose={onClose} title={d?.subject || 'E-mail'} size="xl">
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && (
        <div className="space-y-3">
          <dl className="space-y-1 text-sm">
            {d.from && <div className="flex gap-3"><dt className="w-14 shrink-0 text-muted">De</dt><dd className="min-w-0 break-words text-text">{who(d.from)}</dd></div>}
            {!!d.to.length && <div className="flex gap-3"><dt className="w-14 shrink-0 text-muted">Para</dt><dd className="min-w-0 break-words text-text">{d.to.map(who).join(', ')}</dd></div>}
            {!!d.cc.length && <div className="flex gap-3"><dt className="w-14 shrink-0 text-muted">Cópia</dt><dd className="min-w-0 break-words text-text">{d.cc.map(who).join(', ')}</dd></div>}
            {d.date && <div className="flex gap-3"><dt className="w-14 shrink-0 text-muted">Data</dt><dd className="num text-text">{fmtDateTime(d.date)}</dd></div>}
          </dl>
          {!!d.attachments.length && (
            <ul className="flex flex-wrap gap-2" aria-label="Anexos do e-mail">
              {d.attachments.map((a) => (
                <li key={a.index}>
                  <a className="inline-flex items-center gap-2 border border-line px-3 py-1.5 text-sm text-text hover:border-primary hover:text-primary" href={`/api/v1/opportunities/${oppId}/attachments/${attachmentId}/email/parts/${a.index}`}>
                    <Paperclip className="h-4 w-4" aria-hidden />{a.filename}<span className="text-xs text-muted">{kb(a.size)}</span><Download className="h-4 w-4" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {d.html ? (
            <iframe title="Conteúdo do e-mail" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc(d.html)} className="h-[60vh] w-full border border-line bg-white" />
          ) : (
            <p className="whitespace-pre-line break-words border border-line p-3 text-sm text-text">{d.text || '(sem texto)'}</p>
          )}
          <p className="text-xs text-muted">Cópia do e-mail original, guardada na negociação ({d.filename}).</p>
        </div>
      )}
    </Modal>
  );
}
